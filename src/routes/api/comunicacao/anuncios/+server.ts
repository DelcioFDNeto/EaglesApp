import { json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	announcement,
	auditLog,
	event as eventTable,
	group as groupTable,
	groupMember,
	person as personTable,
	personProfile
} from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const criarAnuncioSchema = z.object({
	title: z.string().trim().min(1).max(160),
	body: z.string().trim().min(1).max(4000),
	audienceScope: z.enum(['all', 'group', 'status']).default('all'),
	groupId: z.string().uuid().optional().nullable(),
	targetStatus: z
		.enum(['visitante', 'recorrente', 'membro', 'conselheiro', 'lider'])
		.optional()
		.nullable(),
	eventId: z.string().uuid().optional().nullable(),
	publicarAgora: z.boolean().default(false)
});

/**
 * Lista anúncios visíveis para a pessoa autenticada (RF-09.2).
 * Membros veem apenas publicados direcionados a 'all', ao seu grupo ou ao seu status.
 * Líderes e conselheiros também veem rascunhos no seu escopo.
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeLer =
		can(actor, 'event.view', { personId: actor.personId }) ||
		can(actor, 'person.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'announcement.create').length > 0;
	if (!podeLer) {
		return json({ erro: 'Sem permissão para ver avisos.' }, { status: 403 });
	}

	const podeCriarGlobal = can(actor, 'announcement.create');
	const gruposGerenciados = groupsWhere(actor, 'announcement.create');
	const podeCriar = podeCriarGlobal || gruposGerenciados.length > 0;
	const podePublicar =
		can(actor, 'announcement.send') || groupsWhere(actor, 'announcement.send').length > 0;

	const [vinculoGrupo] = await banco
		.select({ groupId: groupMember.groupId })
		.from(groupMember)
		.where(eq(groupMember.personId, actor.personId))
		.limit(1);

	const [perfil] = await banco
		.select({ status: personProfile.status })
		.from(personProfile)
		.where(eq(personProfile.personId, actor.personId))
		.limit(1);

	const meuGrupoId = vinculoGrupo?.groupId ?? null;
	const meuStatus = perfil?.status ?? 'visitante';

	const linhas = await banco
		.select({
			id: announcement.id,
			title: announcement.title,
			body: announcement.body,
			audienceScope: announcement.audienceScope,
			groupId: announcement.groupId,
			groupName: groupTable.name,
			targetStatus: announcement.targetStatus,
			eventId: announcement.eventId,
			eventTitle: eventTable.title,
			status: announcement.status,
			authorPersonId: announcement.authorPersonId,
			authorName: personTable.fullName,
			publishedAt: announcement.publishedAt,
			createdAt: announcement.createdAt
		})
		.from(announcement)
		.innerJoin(personTable, eq(personTable.id, announcement.authorPersonId))
		.leftJoin(groupTable, eq(groupTable.id, announcement.groupId))
		.leftJoin(eventTable, eq(eventTable.id, announcement.eventId))
		.where(eq(announcement.teamId, actor.teamId))
		.orderBy(desc(announcement.publishedAt), desc(announcement.createdAt))
		.limit(50);

	const visiveis = linhas.filter((a) => {
		if (a.status === 'archived') {
			return podeCriarGlobal;
		}
		if (a.status === 'draft') {
			if (podeCriarGlobal) return true;
			return (
				a.authorPersonId === actor.personId ||
				(a.groupId !== null && gruposGerenciados.includes(a.groupId))
			);
		}
		// published
		if (podeCriarGlobal) return true;
		if (a.audienceScope === 'all') return true;
		if (a.audienceScope === 'group') {
			return (
				(meuGrupoId !== null && a.groupId === meuGrupoId) ||
				(a.groupId !== null && gruposGerenciados.includes(a.groupId))
			);
		}
		if (a.audienceScope === 'status') {
			return a.targetStatus === meuStatus;
		}
		return false;
	});

	return json({
		podeCriar,
		podePublicar,
		anuncios: visiveis
	});
};

/**
 * Cria um anúncio interno (rascunho ou já publicado).
 * Exige `announcement.create` (e `announcement.send` se `publicarAgora = true`).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarAnuncioSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = resultado.data;

	if (dados.audienceScope === 'group' && !dados.groupId) {
		return json({ erro: 'Selecione o grupo de destino para este aviso.' }, { status: 400 });
	}
	if (dados.audienceScope === 'status' && !dados.targetStatus) {
		return json({ erro: 'Selecione o status de destino para este aviso.' }, { status: 400 });
	}

	const contextoEscopo = { groupId: dados.audienceScope === 'group' ? dados.groupId : null };

	if (!can(actor, 'announcement.create', contextoEscopo)) {
		return json(
			{ erro: 'Você não tem permissão para criar avisos para este público.' },
			{ status: 403 }
		);
	}

	if (dados.publicarAgora && !can(actor, 'announcement.send', contextoEscopo)) {
		return json(
			{ erro: 'Você não tem permissão para publicar avisos para este público.' },
			{ status: 403 }
		);
	}

	if (dados.groupId) {
		const [grupo] = await banco
			.select({ id: groupTable.id })
			.from(groupTable)
			.where(and(eq(groupTable.id, dados.groupId), eq(groupTable.teamId, actor.teamId)))
			.limit(1);
		if (!grupo) {
			return json({ erro: 'Grupo não encontrado.' }, { status: 404 });
		}
	}

	if (dados.eventId) {
		const [ev] = await banco
			.select({ id: eventTable.id })
			.from(eventTable)
			.where(and(eq(eventTable.id, dados.eventId), eq(eventTable.teamId, actor.teamId)))
			.limit(1);
		if (!ev) {
			return json({ erro: 'Evento não encontrado.' }, { status: 404 });
		}
	}

	const agora = new Date();
	const [criado] = await banco
		.insert(announcement)
		.values({
			teamId: actor.teamId,
			title: dados.title,
			body: dados.body,
			audienceScope: dados.audienceScope,
			groupId: dados.audienceScope === 'group' ? (dados.groupId ?? null) : null,
			targetStatus: dados.audienceScope === 'status' ? (dados.targetStatus ?? null) : null,
			eventId: dados.eventId ?? null,
			status: dados.publicarAgora ? 'published' : 'draft',
			authorPersonId: actor.personId,
			publishedAt: dados.publicarAgora ? agora : null
		})
		.returning();

	if (!criado) {
		return json({ erro: 'Não foi possível criar o aviso.' }, { status: 500 });
	}

	if (dados.publicarAgora) {
		await banco.insert(auditLog).values({
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			action: 'announcement.published',
			entity: 'announcement',
			entityId: criado.id,
			after: { title: criado.title, audienceScope: criado.audienceScope }
		});
	}

	return json({ ok: true, anuncio: criado }, { status: 201 });
};
