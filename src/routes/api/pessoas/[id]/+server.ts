import { json } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	group,
	groupMemberHistory,
	person,
	personAttribute,
	personProfile,
	personStatusHistory,
	userAccount
} from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { alcancaAlvo, carregarAlvo, type Alvo } from '$server/pessoas/alvo';
import { ESTAGIOS, ROTULO_ESTAGIO, podeMudarEstagio, type Estagio } from '$server/pessoas/jornada';
import { CAMPOS_RESTRITOS_MENOR, MAIORIDADE, idadeEm, validarIdade } from '$server/pessoas/menores';
import { naoEhMaster } from '$server/lideranca/regras';
import { podeTransferir } from '$server/grupos/transferencia';
import { serializarAtributos } from '$server/draft/atributos';
import { normalizarTelefone, telefoneValido } from '$shared/telefone';
import type { Actor } from '$server/policy/policy';

/**
 * Uma pessoa vista por quem cuida dela (líder, ou conselheiro do PG dela).
 *
 * GET   — dados, estágio na jornada e histórico. Contato, nascimento,
 *         observações e família só com `person.view_sensitive` (RN-32).
 * PATCH — edita os dados do cadastro progressivo. O estágio NÃO muda aqui:
 *         isso é `POST /api/pessoas/[id]/estagio`, que tem regras próprias.
 *
 * O contato editado aqui é o do cadastro (para falar com a pessoa). O
 * contato de LOGIN é outro, e só muda pelo convite.
 */

function estagiosPermitidos(actor: Actor, alvo: Alvo): Estagio[] {
	if (!alcancaAlvo(actor, alvo)) return [];
	const atual = alvo.perfil?.status ?? 'visitante';
	return ESTAGIOS.filter((e) => e !== atual && podeMudarEstagio(actor, atual, e, alvo.groupId));
}

export const GET = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	if (!isUuid(params.id)) return json({ erro: 'Identificador inválido.' }, { status: 400 });

	const alvo = await carregarAlvo(banco, actor.teamId, params.id);
	if (!alvo) return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });

	const contexto = { groupId: alvo.groupId, personId: alvo.id };
	if (!can(actor, 'person.view', contexto)) {
		return json({ erro: 'Sem permissão para ver esta pessoa.' }, { status: 403 });
	}

	const sensivel = can(actor, 'person.view_sensitive', contexto) || alvo.id === actor.personId;
	const perfil = alvo.perfil;

	const historico = await banco
		.select()
		.from(personStatusHistory)
		.where(eq(personStatusHistory.personId, alvo.id))
		.orderBy(desc(personStatusHistory.occurredAt))
		.limit(50);

	const caminho = await banco
		.select()
		.from(groupMemberHistory)
		.where(eq(groupMemberHistory.personId, alvo.id))
		.orderBy(desc(groupMemberHistory.occurredAt))
		.limit(50);

	// PGs para onde quem pergunta pode mover a pessoa (só ativos, sem o atual).
	const podeMover =
		alcancaAlvo(actor, alvo) &&
		(can(actor, 'group.assign_member') ||
			(alvo.groupId !== null && can(actor, 'group.assign_member', { groupId: alvo.groupId })));
	const ativos = podeMover
		? await banco
				.select({ id: group.id, nome: group.name })
				.from(group)
				.where(and(eq(group.teamId, actor.teamId), isNull(group.archivedAt)))
				.orderBy(asc(group.name))
		: [];
	const destinos = ativos.filter(
		(g) => g.id !== alvo.groupId && podeTransferir(actor, alvo.groupId, g.id)
	);

	const idsGrupos = [
		...new Set(caminho.flatMap((c) => [c.fromGroupId, c.toGroupId]).filter((x): x is string => !!x))
	];
	const nomeGrupo = new Map(
		idsGrupos.length === 0
			? []
			: (
					await banco
						.select({ id: group.id, nome: group.name })
						.from(group)
						.where(inArray(group.id, idsGrupos))
				).map((g) => [g.id, g.nome])
	);

	const [linhaAtributo] = await banco
		.select()
		.from(personAttribute)
		.where(eq(personAttribute.personId, alvo.id))
		.limit(1);

	// Nomes de quem fez cada mudança. O Master não tem nome para a equipe.
	const autores = [
		...new Set(
			[
				...historico.map((h) => h.changedByPersonId),
				...caminho.map((c) => c.changedByPersonId),
				linhaAtributo?.evaluatedByPersonId ?? null
			].filter((x): x is string => !!x)
		)
	];
	const nomes = new Map(
		autores.length === 0
			? []
			: (
					await banco
						.select({ id: person.id, nome: person.fullName })
						.from(person)
						.where(and(inArray(person.id, autores), naoEhMaster(person.id)))
				).map((p) => [p.id, p.nome])
	);

	const estagio = perfil?.status ?? 'visitante';
	const idade = alvo.birthDate ? idadeEm(alvo.birthDate) : null;
	const avaliadoPor = linhaAtributo?.evaluatedByPersonId
		? (nomes.get(linhaAtributo.evaluatedByPersonId) ?? null)
		: null;

	return json({
		pessoa: {
			id: alvo.id,
			nome: alvo.nome,
			estagio,
			estagioRotulo: ROTULO_ESTAGIO[estagio] ?? estagio,
			grupo: alvo.groupId ? { id: alvo.groupId, nome: alvo.grupoNome } : null,
			lider: alvo.topo,
			dataEntrada: perfil?.joinedAt ?? null,
			criadoEm: alvo.createdAt,
			ehMenor: sensivel && idade !== null ? idade < MAIORIDADE : null,
			atributos: serializarAtributos(linhaAtributo, avaliadoPor),
			dados: sensivel
				? {
						dataNascimento: alvo.birthDate,
						idade,
						telefone: perfil?.phone ?? null,
						whatsapp: perfil?.whatsapp ?? null,
						email: perfil?.email ?? null,
						relacionamento: perfil?.relationshipStatus ?? null,
						irmaos: perfil?.siblings ?? null,
						vinculosFamiliares: perfil?.familyTies ?? null,
						observacoes: perfil?.notes ?? null
					}
				: null
		},
		permissoes: {
			podeEditar: can(actor, 'person.update', contexto) && alcancaAlvo(actor, alvo) && sensivel,
			podeEditarAtributos: can(actor, 'person.update', contexto) && alcancaAlvo(actor, alvo),
			estagiosPermitidos: estagiosPermitidos(actor, alvo),
			mudarDePg: {
				destinos,
				// Tirar de todos os PGs: só líderes, e só se a pessoa estiver em um.
				podeTirarDeTodos:
					alvo.groupId !== null && podeMover && podeTransferir(actor, alvo.groupId, null)
			}
		},
		historicoGrupos: caminho.map((c) => ({
			id: c.id,
			de: c.fromGroupId ? (nomeGrupo.get(c.fromGroupId) ?? null) : null,
			para: c.toGroupId ? (nomeGrupo.get(c.toGroupId) ?? null) : null,
			motivo: c.reason,
			origem: c.origin,
			por: c.changedByPersonId ? (nomes.get(c.changedByPersonId) ?? null) : null,
			em: c.occurredAt
		})),
		historico: historico.map((h) => ({
			id: h.id,
			de: h.fromStatus,
			deRotulo: h.fromStatus ? (ROTULO_ESTAGIO[h.fromStatus] ?? h.fromStatus) : null,
			para: h.toStatus,
			paraRotulo: ROTULO_ESTAGIO[h.toStatus] ?? h.toStatus,
			motivo: h.reason,
			por: h.changedByPersonId ? (nomes.get(h.changedByPersonId) ?? null) : null,
			em: h.occurredAt
		}))
	});
};

const telefone = z
	.string()
	.trim()
	.nullable()
	.refine((v) => !v || telefoneValido(v), 'Informe o telefone com DDD, ex.: (91) 99999-0001.')
	.transform((v) => (v ? normalizarTelefone(v) : null));

const textoOpcional = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.nullable()
		.transform((v) => v || null);

const editarSchema = z
	.object({
		nome: z.string().trim().min(2, 'Informe o nome.').max(120, 'Nome longo demais.'),
		telefone,
		whatsapp: telefone,
		email: z
			.union([z.string().trim().toLowerCase().email('Informe um e-mail válido.'), z.literal('')])
			.nullable()
			.transform((v) => v || null),
		dataNascimento: z
			.string()
			.trim()
			.nullable()
			.transform((v) => v || null),
		relacionamento: textoOpcional(80),
		irmaos: textoOpcional(250),
		vinculosFamiliares: textoOpcional(500),
		observacoes: textoOpcional(1000)
	})
	.partial()
	.strict();

/** Nome no corpo da API → coluna do perfil. */
const COLUNA = {
	telefone: 'phone',
	whatsapp: 'whatsapp',
	email: 'email',
	relacionamento: 'relationshipStatus',
	irmaos: 'siblings',
	vinculosFamiliares: 'familyTies',
	observacoes: 'notes'
} as const;

export const PATCH = async ({ request, params, locals, getClientAddress }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	if (!isUuid(params.id)) return json({ erro: 'Identificador inválido.' }, { status: 400 });

	const corpo = await request.json().catch(() => null);
	const parsed = editarSchema.safeParse(corpo);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return json(
			{ erro: issue?.message ?? 'Dados inválidos.', campo: issue?.path[0] ?? null },
			{ status: 400 }
		);
	}
	const dados = parsed.data;

	const alvo = await carregarAlvo(banco, actor.teamId, params.id);
	if (!alvo) return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });

	const contexto = { groupId: alvo.groupId, personId: alvo.id };
	if (
		!can(actor, 'person.update', contexto) ||
		!can(actor, 'person.view_sensitive', contexto) ||
		!alcancaAlvo(actor, alvo)
	) {
		return json({ erro: 'Sem permissão para editar esta pessoa.' }, { status: 403 });
	}

	// Como ficará o perfil depois de gravar: é isso que a regra de menor confere.
	const perfil = alvo.perfil;
	const final: Record<keyof typeof COLUNA, string | null> = {
		telefone: perfil?.phone ?? null,
		whatsapp: perfil?.whatsapp ?? null,
		email: perfil?.email ?? null,
		relacionamento: perfil?.relationshipStatus ?? null,
		irmaos: perfil?.siblings ?? null,
		vinculosFamiliares: perfil?.familyTies ?? null,
		observacoes: perfil?.notes ?? null
	};
	for (const campo of Object.keys(COLUNA) as (keyof typeof COLUNA)[]) {
		if (dados[campo] !== undefined) final[campo] = dados[campo];
	}
	const nascimento = dados.dataNascimento !== undefined ? dados.dataNascimento : alvo.birthDate;

	const [[conta], [attrAtual]] = await Promise.all([
		banco
			.select({ email: userAccount.email, phone: userAccount.phone })
			.from(userAccount)
			.where(eq(userAccount.personId, alvo.id))
			.limit(1),
		banco.select().from(personAttribute).where(eq(personAttribute.personId, alvo.id)).limit(1)
	]);

	const temAtributos = Boolean(
		attrAtual &&
		(attrAtual.physical !== null ||
			attrAtual.biblical !== null ||
			attrAtual.mental !== null ||
			attrAtual.motor !== null ||
			attrAtual.heightCm !== null ||
			attrAtual.weightTenthsKg !== null ||
			attrAtual.dominantSide !== null ||
			attrAtual.shirtSize !== null ||
			attrAtual.strengths !== null ||
			attrAtual.draftNotes !== null)
	);

	const restritosPreenchidos: string[] = CAMPOS_RESTRITOS_MENOR.filter((c) => final[c] !== null);
	if (temAtributos) restritosPreenchidos.push('atributos');

	const erroIdade = validarIdade(
		nascimento,
		restritosPreenchidos,
		Boolean(conta?.email || conta?.phone)
	);
	if (erroIdade) return json({ erro: erroIdade, campo: 'dataNascimento' }, { status: 400 });

	// O que mudou de fato. A auditoria guarda o nome antes/depois, mas dos
	// demais campos só QUAIS mudaram: contato e observações não vão para o log.
	const camposMudados: string[] = [];
	const mudancasPerfil: Partial<typeof personProfile.$inferInsert> = {};
	for (const campo of Object.keys(COLUNA) as (keyof typeof COLUNA)[]) {
		if (dados[campo] === undefined) continue;
		const coluna = COLUNA[campo];
		if ((perfil?.[coluna] ?? null) !== dados[campo]) {
			mudancasPerfil[coluna] = dados[campo];
			camposMudados.push(campo);
		}
	}
	const mudaNome = dados.nome !== undefined && dados.nome !== alvo.nome;
	const mudaNascimento =
		dados.dataNascimento !== undefined && dados.dataNascimento !== alvo.birthDate;
	if (mudaNome) camposMudados.push('nome');
	if (mudaNascimento) camposMudados.push('dataNascimento');

	if (camposMudados.length === 0) {
		return json({ ok: true, alterado: false, mensagem: 'Nada mudou.' });
	}

	const agora = new Date();
	await banco.transaction(async (tx) => {
		if (mudaNome || mudaNascimento) {
			await tx
				.update(person)
				.set({
					...(mudaNome && { fullName: dados.nome }),
					...(mudaNascimento && { birthDate: dados.dataNascimento }),
					updatedAt: agora
				})
				.where(eq(person.id, alvo.id));
		}
		if (Object.keys(mudancasPerfil).length > 0 || mudaNascimento) {
			// A cópia do nascimento no perfil acompanha a de `person` (legado).
			const valores = {
				...mudancasPerfil,
				...(mudaNascimento && { birthDate: dados.dataNascimento }),
				updatedAt: agora
			};
			if (perfil) {
				await tx.update(personProfile).set(valores).where(eq(personProfile.id, perfil.id));
			} else {
				await tx.insert(personProfile).values({ personId: alvo.id, ...valores });
			}
		}
	});

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'person.atualizada',
		entity: 'person',
		entityId: alvo.id,
		before: mudaNome ? { nome: alvo.nome } : undefined,
		after: { campos: camposMudados, ...(mudaNome && { nome: dados.nome }) },
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent')
	});

	return json({ ok: true, alterado: true, mensagem: 'Dados atualizados.' });
};
