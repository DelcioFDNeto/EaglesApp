import { json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$server/db';
import { groupMember, person, personProfile, userAccount } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { issueInvite } from '$server/auth/invite';
import { naoEhMaster } from '$server/lideranca/regras';
import { audit } from '$server/audit/log';
import { contatoEmUso, contatoSchema, MENSAGEM_CONTATO_EM_USO } from '$server/pessoas/contato';
import {
	formatarTelefone,
	linkWhatsApp,
	normalizarTelefone,
	telefoneValido
} from '$shared/telefone';

/**
 * Emite (ou renova) o convite de acesso de uma pessoa — RF-01.2, ADR 0004.
 *
 * PERMISSÃO: `person.invite` sobre a pessoa — líder em qualquer uma,
 * conselheiro só nas do próprio grupo.
 *
 * Fluxo da tela: "Convidar" → este endpoint devolve o link e a mensagem
 * pronta → o WhatsApp abre já na conversa da pessoa. Emitir de novo revoga
 * o link anterior (`issueInvite`).
 *
 * A pessoa precisa de um contato de LOGIN (e-mail ou telefone): é com ele que
 * ela vai entrar depois de definir a senha. Se o cadastro ainda não tem, o
 * corpo pode trazer; se nem assim houver, a resposta pede.
 */
export const POST = async ({ request, params, locals, getClientAddress }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}
	const { actor } = auth;

	const personId = params.id;
	if (!isUuid(personId)) {
		return json({ erro: 'Identificador inválido.' }, { status: 400 });
	}

	const [alvo] = await banco
		.select({
			id: person.id,
			nome: person.fullName,
			groupId: groupMember.groupId,
			perfilTelefone: personProfile.whatsapp,
			perfilFone: personProfile.phone,
			perfilEmail: personProfile.email
		})
		.from(person)
		.leftJoin(groupMember, eq(groupMember.personId, person.id))
		.leftJoin(personProfile, eq(personProfile.personId, person.id))
		.where(
			and(
				eq(person.id, personId),
				eq(person.teamId, actor.teamId),
				isNull(person.deletedAt),
				naoEhMaster(person.id)
			)
		)
		.limit(1);

	// Outra equipe ou inexistente: mesma resposta (anti-IDOR).
	if (!alvo) {
		return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });
	}

	if (!can(actor, 'person.invite', { personId: alvo.id, groupId: alvo.groupId })) {
		return json({ erro: 'Você não pode convidar esta pessoa.' }, { status: 403 });
	}

	if (alvo.id === actor.personId) {
		return json({ erro: 'Você já tem acesso.' }, { status: 400 });
	}

	const corpo = await request.json().catch(() => ({}));
	const parsed = contatoSchema.safeParse(corpo ?? {});
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return json(
			{ erro: issue?.message ?? 'Dados inválidos.', campo: issue?.path[0] ?? null },
			{ status: 400 }
		);
	}

	const [conta] = await banco
		.select({
			id: userAccount.id,
			email: userAccount.email,
			telefone: userAccount.phone,
			temSenha: userAccount.passwordHash
		})
		.from(userAccount)
		.where(eq(userAccount.personId, alvo.id))
		.limit(1);

	if (conta?.temSenha) {
		return json(
			{
				erro: 'Esta pessoa já tem acesso. Se esqueceu a senha, ela pode usar "Esqueci minha senha".',
				codigo: 'ja_tem_acesso'
			},
			{ status: 409 }
		);
	}

	// Contato de login: o que a conta já tem; senão, o informado agora; senão,
	// o do perfil. O perfil é o melhor palpite — quem cadastrou digitou ali.
	const email = conta?.email ?? parsed.data.email ?? alvo.perfilEmail?.toLowerCase() ?? null;
	const telefone = conta?.telefone ?? parsed.data.telefone ?? null;
	const telefoneDoPerfil = alvo.perfilTelefone ?? alvo.perfilFone ?? null;
	// Telefone mal digitado no perfil é ignorado, não derruba o convite.
	const telefoneLogin =
		telefone ??
		(telefoneDoPerfil && telefoneValido(telefoneDoPerfil)
			? normalizarTelefone(telefoneDoPerfil)
			: null);

	if (!email && !telefoneLogin) {
		return json(
			{
				erro: 'Informe o telefone (ou e-mail) da pessoa: é com ele que ela vai entrar.',
				codigo: 'sem_contato',
				campo: 'telefone'
			},
			{ status: 400 }
		);
	}

	const emUso = await contatoEmUso(banco, { email, telefone: telefoneLogin }, alvo.id);
	if (emUso) {
		return json(
			{ erro: MENSAGEM_CONTATO_EM_USO[emUso], campo: emUso, codigo: 'contato_em_uso' },
			{ status: 409 }
		);
	}

	if (conta) {
		if (conta.email !== email || conta.telefone !== telefoneLogin) {
			await banco
				.update(userAccount)
				.set({ email, phone: telefoneLogin, updatedAt: new Date() })
				.where(eq(userAccount.id, conta.id));
		}
	} else {
		await banco.insert(userAccount).values({ personId: alvo.id, email, phone: telefoneLogin });
	}

	const convite = await issueInvite(banco, {
		teamId: actor.teamId,
		personId: alvo.id,
		createdByPersonId: actor.personId
	});

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'invite.emitido',
		entity: 'person',
		entityId: alvo.id,
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent')
	});

	const primeiroNome = alvo.nome.split(' ')[0];
	const validade = convite.expiresAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
	const mensagem =
		`Oi, ${primeiroNome}! Você foi convidado(a) para o app dos Eagles. ` +
		`Toque no link para criar sua senha (vale até ${validade}):\n\n${convite.url}`;

	return json(
		{
			ok: true,
			url: convite.url,
			expiraEm: convite.expiresAt,
			login: telefoneLogin
				? { tipo: 'telefone', valor: formatarTelefone(telefoneLogin) }
				: { tipo: 'email', valor: email },
			mensagem,
			whatsapp: linkWhatsApp(mensagem, telefoneLogin)
		},
		{ status: 201 }
	);
};
