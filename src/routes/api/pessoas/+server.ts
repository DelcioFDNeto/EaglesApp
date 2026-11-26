import { json } from '@sveltejs/kit';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	group,
	groupMember,
	invite,
	person,
	personProfile,
	personRole,
	personStatusHistory,
	role,
	userAccount
} from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere, type Actor } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { contatoEmUso, contatoSchema, MENSAGEM_CONTATO_EM_USO } from '$server/pessoas/contato';
import { naoEhMaster } from '$server/lideranca/regras';
import { ESTAGIOS, papelDoEstagio, podeMudarEstagio } from '$server/pessoas/jornada';

/**
 * Pessoas da equipe.
 *
 * GET  — lista (escalas, presença e a tela de pessoas), com o estado do acesso
 *        de cada uma e se quem pergunta pode convidá-la.
 * POST — cadastro progressivo (RF-02.1): só o nome é obrigatório.
 *
 * PERMISSÃO: `person.view` para listar; `person.create` para cadastrar —
 * global (líder) ou no grupo de destino (conselheiro, só no próprio PG).
 */

type Acesso = 'ativo' | 'convidado' | 'sem_acesso';

/** Grupos em que o ator pode cadastrar: todos da equipe, ou os do escopo dele. */
async function gruposParaCadastro(banco: ReturnType<typeof db>, actor: Actor) {
	const global = can(actor, 'person.create');
	const permitidos = groupsWhere(actor, 'person.create');
	if (!global && permitidos.length === 0) return { global, grupos: [] };

	const grupos = await banco
		.select({ id: group.id, nome: group.name })
		.from(group)
		.where(and(eq(group.teamId, actor.teamId), global ? undefined : inArray(group.id, permitidos)))
		.orderBy(asc(group.name));

	return { global, grupos };
}

export const GET = async ({ request, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const grupoId = url.searchParams.get('grupo');
	const podeVerGlobal = can(actor, 'person.view');
	const gruposPermitidos = groupsWhere(actor, 'person.view');

	if (!podeVerGlobal && gruposPermitidos.length === 0) {
		return json({ erro: 'Sem permissão para listar pessoas.' }, { status: 403 });
	}

	const linhas = await banco
		.select({
			id: person.id,
			nome: person.fullName,
			status: personProfile.status,
			groupId: groupMember.groupId,
			grupoNome: group.name,
			temSenha: userAccount.passwordHash,
			loginEmail: userAccount.email,
			loginTelefone: userAccount.phone,
			contatoTelefone: personProfile.phone,
			contatoEmail: personProfile.email
		})
		.from(person)
		.leftJoin(personProfile, eq(personProfile.personId, person.id))
		.leftJoin(groupMember, eq(groupMember.personId, person.id))
		.leftJoin(group, eq(group.id, groupMember.groupId))
		.leftJoin(userAccount, eq(userAccount.personId, person.id))
		// O Master (dev) não aparece para a equipe — nem para ele mesmo aqui.
		.where(and(eq(person.teamId, actor.teamId), isNull(person.deletedAt), naoEhMaster(person.id)))
		.orderBy(asc(person.fullName));

	const filtradas = linhas.filter((p) => {
		if (grupoId && p.groupId !== grupoId) return false;
		if (podeVerGlobal) return true;
		return p.groupId !== null && gruposPermitidos.includes(p.groupId);
	});

	// Convites ainda abertos: a pessoa recebeu o link e não definiu a senha.
	const ids = filtradas.map((p) => p.id);
	const abertos = new Set(
		ids.length === 0
			? []
			: (
					await banco
						.select({ personId: invite.personId })
						.from(invite)
						.where(
							and(
								inArray(invite.personId, ids),
								isNull(invite.usedAt),
								isNull(invite.revokedAt),
								gt(invite.expiresAt, new Date())
							)
						)
				).map((c) => c.personId)
	);

	const { global, grupos } = await gruposParaCadastro(banco, actor);

	return json({
		podeCadastrar: global || grupos.length > 0,
		// Estágios oferecidos no cadastro. Recorrente: quem edita pessoas (no PG
		// escolhido; o POST confere). Membro: só líderes (entrada nos Eagles).
		estagiosParaCadastro: ESTAGIOS.filter(
			(e) =>
				e === 'visitante' ||
				(e === 'recorrente' &&
					(can(actor, 'person.update') || groupsWhere(actor, 'person.update').length > 0)) ||
				(e === 'membro' && can(actor, 'person.update'))
		),
		gruposParaCadastro: grupos,
		pessoas: filtradas.map((p) => {
			const acesso: Acesso = p.temSenha ? 'ativo' : abertos.has(p.id) ? 'convidado' : 'sem_acesso';
			return {
				id: p.id,
				nome: p.nome,
				status: p.status ?? 'visitante',
				groupId: p.groupId,
				grupo: p.grupoNome,
				acesso,
				// Sem isto a tela teria de pedir o contato antes de convidar.
				temContato: Boolean(p.loginEmail || p.loginTelefone || p.contatoTelefone || p.contatoEmail),
				podeConvidar:
					acesso !== 'ativo' &&
					p.id !== actor.personId &&
					can(actor, 'person.invite', { personId: p.id, groupId: p.groupId })
			};
		})
	});
};

const cadastroSchema = z
	.object({
		nome: z.string().trim().min(2, 'Informe o nome.').max(120, 'Nome longo demais.'),
		grupoId: z.string().uuid().optional().nullable(),
		/**
		 * Estágio inicial na jornada. Visitante é o padrão: a porta de entrada.
		 * Cadastrar direto como membro é o mesmo que marcar a entrada nos
		 * Eagles, então segue a regra da jornada (só líderes).
		 */
		estagio: z.enum(ESTAGIOS).default('visitante')
	})
	.and(contatoSchema);

export const POST = async ({ request, locals, getClientAddress }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}
	const { actor } = auth;

	const corpo = await request.json().catch(() => null);
	const parsed = cadastroSchema.safeParse(corpo);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return json(
			{ erro: issue?.message ?? 'Dados inválidos.', campo: issue?.path[0] ?? null },
			{ status: 400 }
		);
	}
	const { nome, grupoId, estagio, email, telefone } = parsed.data;
	const papel = papelDoEstagio(estagio);

	// Conselheiro cadastra só no próprio PG; sem grupo, só quem tem alcance global.
	const contexto = grupoId ? { groupId: grupoId } : {};
	if (!can(actor, 'person.create', contexto)) {
		return json(
			{
				erro: grupoId
					? 'Você não pode cadastrar pessoas neste grupo.'
					: 'Escolha o grupo da pessoa.',
				campo: 'grupoId'
			},
			{ status: 403 }
		);
	}
	if (grupoId && !can(actor, 'group.assign_member', { groupId: grupoId })) {
		return json({ erro: 'Você não pode incluir pessoas neste grupo.' }, { status: 403 });
	}
	if (estagio !== 'visitante' && !podeMudarEstagio(actor, 'visitante', estagio, grupoId ?? null)) {
		return json(
			{
				erro:
					estagio === 'membro'
						? 'Só os líderes cadastram alguém direto como membro Eagles.'
						: 'Você não pode cadastrar alguém neste estágio.',
				campo: 'estagio'
			},
			{ status: 403 }
		);
	}

	if (grupoId) {
		const [grupo] = await banco
			.select({ id: group.id })
			.from(group)
			.where(and(eq(group.id, grupoId), eq(group.teamId, actor.teamId)))
			.limit(1);
		if (!grupo) return json({ erro: 'Grupo não encontrado.' }, { status: 404 });
	}

	const emUso = await contatoEmUso(banco, { email, telefone });
	if (emUso) {
		return json(
			{ erro: MENSAGEM_CONTATO_EM_USO[emUso], campo: emUso, codigo: 'contato_em_uso' },
			{ status: 409 }
		);
	}

	const [papelDestino] = await banco
		.select({ id: role.id })
		.from(role)
		.where(and(eq(role.teamId, actor.teamId), eq(role.key, papel)))
		.limit(1);
	if (!papelDestino) {
		return json({ erro: 'Papel não configurado na equipe.' }, { status: 500 });
	}

	const criada = await banco.transaction(async (tx) => {
		const [p] = await tx
			.insert(person)
			.values({ teamId: actor.teamId, fullName: nome })
			.returning({ id: person.id });
		if (!p) throw new Error('não foi possível criar a pessoa');

		await tx.insert(personProfile).values({
			personId: p.id,
			phone: telefone,
			whatsapp: telefone,
			email,
			groupId: grupoId ?? null,
			status: estagio,
			...(estagio === 'membro' && { joinedAt: new Date() })
		});

		// Primeiro registro da jornada: o primeiro contato (seção 10).
		await tx.insert(personStatusHistory).values({
			personId: p.id,
			fromStatus: null,
			toStatus: estagio,
			reason: 'Cadastro',
			changedByPersonId: actor.personId,
			groupId: grupoId ?? null
		});

		// A conta nasce sem senha, só com o contato de login: o convite define
		// a senha depois. Sem contato, a conta é criada no convite.
		if (email || telefone) {
			await tx.insert(userAccount).values({ personId: p.id, email, phone: telefone });
		}

		await tx
			.insert(personRole)
			.values({ personId: p.id, roleId: papelDestino.id, scopeType: 'self', scopeId: null });

		if (grupoId) {
			await tx.insert(groupMember).values({ groupId: grupoId, personId: p.id, roleKey: 'membro' });
		}

		return p;
	});

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.criada',
		entity: 'person',
		entityId: criada.id,
		after: { nome, grupoId: grupoId ?? null, estagio, papel },
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent')
	});

	return json({ ok: true, pessoa: { id: criada.id, nome } }, { status: 201 });
};
