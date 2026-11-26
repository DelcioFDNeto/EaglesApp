import { json } from '@sveltejs/kit';
import { and, asc, count, desc, eq, gte, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	event,
	group,
	groupMember,
	groupMemberHistory,
	person,
	personProfile
} from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { naoEhMaster } from '$server/lideranca/regras';

/** Quantos dias de "quem chegou e quem saiu" o PG mostra. */
const DIAS_MOVIMENTACAO = 60;

/**
 * Detalhe de um PG: integrantes, quem chegou e saiu recentemente, e o que
 * quem pergunta pode fazer nele.
 *
 * "Quem chegou" existe por causa da decisão de 26/11/2026: um conselheiro
 * pode mover alguém do PG dele para o de outro. O conselheiro que recebe
 * precisa ver quem chegou, de onde e por quê.
 */
export const GET = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const grupoId = params.id;
	if (!isUuid(grupoId)) {
		return json({ erro: 'Identificador de grupo inválido.' }, { status: 400 });
	}

	if (!can(actor, 'group.view', { groupId: grupoId, personId: actor.personId })) {
		return json({ erro: 'Sem permissão para ver este grupo.' }, { status: 403 });
	}

	const [grupo] = await banco
		.select()
		.from(group)
		.where(and(eq(group.id, grupoId), eq(group.teamId, actor.teamId)))
		.limit(1);

	if (!grupo) {
		return json({ erro: 'Grupo não encontrado.' }, { status: 404 });
	}

	const podeVerSensivel = can(actor, 'person.view_sensitive', { groupId: grupoId });
	const podeAcompanhar = can(actor, 'person.view', { groupId: grupoId });

	const membros = await banco
		.select({
			id: person.id,
			nome: person.fullName,
			grupoFuncao: groupMember.roleKey,
			entrouEm: groupMember.joinedAt,
			telefone: personProfile.phone,
			whatsapp: personProfile.whatsapp,
			status: personProfile.status
		})
		.from(groupMember)
		.innerJoin(person, eq(person.id, groupMember.personId))
		.leftJoin(personProfile, eq(personProfile.personId, person.id))
		.where(and(eq(groupMember.groupId, grupoId), naoEhMaster(person.id)))
		.orderBy(asc(person.fullName));

	// Movimentação recente: só para quem acompanha as pessoas do PG.
	let movimentacao: Array<Record<string, unknown>> = [];
	if (podeAcompanhar) {
		const desde = new Date(Date.now() - DIAS_MOVIMENTACAO * 86_400_000);
		const linhas = await banco
			.select()
			.from(groupMemberHistory)
			.where(
				and(
					or(
						eq(groupMemberHistory.toGroupId, grupoId),
						eq(groupMemberHistory.fromGroupId, grupoId)
					),
					gte(groupMemberHistory.occurredAt, desde),
					ne(groupMemberHistory.origin, 'cadastro')
				)
			)
			.orderBy(desc(groupMemberHistory.occurredAt))
			.limit(50);

		const idsPessoas = [
			...new Set(
				linhas.flatMap((l) => [l.personId, l.changedByPersonId]).filter((x): x is string => !!x)
			)
		];
		const idsGrupos = [
			...new Set(
				linhas.flatMap((l) => [l.fromGroupId, l.toGroupId]).filter((x): x is string => !!x)
			)
		];
		const [nomesPessoas, nomesGrupos] = await Promise.all([
			idsPessoas.length
				? banco
						.select({ id: person.id, nome: person.fullName })
						.from(person)
						.where(and(inArray(person.id, idsPessoas), naoEhMaster(person.id)))
				: Promise.resolve([]),
			idsGrupos.length
				? banco
						.select({ id: group.id, nome: group.name })
						.from(group)
						.where(inArray(group.id, idsGrupos))
				: Promise.resolve([])
		]);
		const pessoaNome = new Map(nomesPessoas.map((p) => [p.id, p.nome]));
		const grupoNome = new Map(nomesGrupos.map((g) => [g.id, g.nome]));

		movimentacao = linhas
			.filter((l) => pessoaNome.has(l.personId))
			.map((l) => ({
				id: l.id,
				tipo: l.toGroupId === grupoId ? 'chegou' : 'saiu',
				pessoa: { id: l.personId, nome: pessoaNome.get(l.personId) },
				// O outro lado do movimento: de onde veio, ou para onde foi.
				outroGrupo:
					l.toGroupId === grupoId
						? l.fromGroupId
							? (grupoNome.get(l.fromGroupId) ?? null)
							: null
						: l.toGroupId
							? (grupoNome.get(l.toGroupId) ?? null)
							: null,
				motivo: l.reason,
				origem: l.origin,
				por: l.changedByPersonId ? (pessoaNome.get(l.changedByPersonId) ?? null) : null,
				em: l.occurredAt
			}));
	}

	return json({
		grupo: {
			id: grupo.id,
			name: grupo.name,
			slug: grupo.slug,
			description: grupo.description,
			arquivado: grupo.archivedAt !== null,
			createdAt: grupo.createdAt
		},
		permissoes: {
			podeEditar: can(actor, 'group.manage') || can(actor, 'group.update', { groupId: grupoId }),
			podeArquivar: can(actor, 'group.manage'),
			podeTransferir:
				grupo.archivedAt === null && can(actor, 'group.assign_member', { groupId: grupoId }),
			podeTirarDeTodos: can(actor, 'group.assign_member'),
			podeVerPessoas: podeAcompanhar
		},
		membros: membros.map((m) => ({
			id: m.id,
			nome: m.nome,
			funcao: m.grupoFuncao,
			entrouEm: m.entrouEm,
			telefone: podeVerSensivel || m.id === actor.personId ? m.telefone : null,
			whatsapp: podeVerSensivel || m.id === actor.personId ? m.whatsapp : null,
			status: m.status
		})),
		movimentacao
	});
};

const editarSchema = z
	.object({
		name: z.string().trim().min(1, 'Dê um nome ao PG.').max(100),
		description: z
			.string()
			.trim()
			.max(500)
			.nullable()
			.transform((v) => v || null),
		arquivado: z.boolean()
	})
	.partial()
	.strict();

/**
 * Edita ou arquiva um PG.
 *
 *   - Nome e descrição: líder (`group.manage`) ou conselheiro do próprio PG
 *     (`group.update` no escopo do grupo). Decisão do usuário, 26/11/2026.
 *   - Arquivar e reativar: só `group.manage` global. Arquivar exige o PG
 *     vazio e sem eventos futuros: ninguém fica num PG que sumiu, e nenhum
 *     encontro marcado perde o seu PG.
 *
 * O `slug` não muda: é o identificador estável.
 */
export const PATCH = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	const grupoId = params.id;
	if (!isUuid(grupoId)) return json({ erro: 'Identificador de grupo inválido.' }, { status: 400 });

	const parsed = editarSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
	}
	const dados = parsed.data;

	const [atual] = await banco
		.select()
		.from(group)
		.where(and(eq(group.id, grupoId), eq(group.teamId, actor.teamId)))
		.limit(1);
	if (!atual) return json({ erro: 'Grupo não encontrado.' }, { status: 404 });

	const editaDados = dados.name !== undefined || dados.description !== undefined;
	if (
		editaDados &&
		!can(actor, 'group.manage') &&
		!can(actor, 'group.update', { groupId: grupoId })
	) {
		return json({ erro: 'Sem permissão para editar este PG.' }, { status: 403 });
	}

	const estaArquivado = atual.archivedAt !== null;
	const arquivando = dados.arquivado === true && !estaArquivado;
	const reativando = dados.arquivado === false && estaArquivado;

	if ((arquivando || reativando) && !can(actor, 'group.manage')) {
		return json({ erro: 'Só os líderes arquivam ou reativam PGs.' }, { status: 403 });
	}

	if (arquivando) {
		const [{ total: integrantes } = { total: 0 }] = await banco
			.select({ total: count() })
			.from(groupMember)
			.where(eq(groupMember.groupId, grupoId));
		if (Number(integrantes) > 0) {
			return json(
				{
					erro: `Mova as ${integrantes} pessoas deste PG para outro antes de arquivá-lo.`,
					codigo: 'pg_com_integrantes'
				},
				{ status: 409 }
			);
		}

		const [{ total: futuros } = { total: 0 }] = await banco
			.select({ total: count() })
			.from(event)
			.where(
				and(
					eq(event.groupId, grupoId),
					gte(event.startsAt, new Date()),
					ne(event.status, 'cancelled')
				)
			);
		if (Number(futuros) > 0) {
			return json(
				{
					erro: `Este PG tem ${futuros} evento(s) marcado(s). Cancele ou mude de PG antes de arquivar.`,
					codigo: 'pg_com_eventos'
				},
				{ status: 409 }
			);
		}
	}

	const mudancas: Partial<typeof group.$inferInsert> = {};
	if (dados.name !== undefined && dados.name !== atual.name) mudancas.name = dados.name;
	if (dados.description !== undefined && dados.description !== atual.description) {
		mudancas.description = dados.description;
	}
	if (arquivando) {
		mudancas.archivedAt = new Date();
		mudancas.archivedByPersonId = actor.personId;
	}
	if (reativando) {
		mudancas.archivedAt = null;
		mudancas.archivedByPersonId = null;
	}

	if (Object.keys(mudancas).length === 0) {
		return json({ ok: true, alterado: false, mensagem: 'Nada mudou.' });
	}

	await banco
		.update(group)
		.set({ ...mudancas, updatedAt: new Date() })
		.where(eq(group.id, grupoId));

	const antes: Record<string, unknown> = {};
	const depois: Record<string, unknown> = {};
	if ('name' in mudancas) [antes.name, depois.name] = [atual.name, mudancas.name];
	if ('description' in mudancas) {
		[antes.description, depois.description] = [atual.description, mudancas.description];
	}

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: arquivando ? 'group.arquivado' : reativando ? 'group.reativado' : 'group.atualizado',
		entity: 'group',
		entityId: grupoId,
		before: antes,
		after: depois
	});

	return json({
		ok: true,
		alterado: true,
		mensagem: arquivando ? 'PG arquivado.' : reativando ? 'PG reativado.' : 'PG atualizado.'
	});
};
