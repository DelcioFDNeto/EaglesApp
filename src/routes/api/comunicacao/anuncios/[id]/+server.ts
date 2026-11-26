import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { announcement, auditLog } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const patchAnuncioSchema = z.object({
	title: z.string().trim().min(1).max(160).optional(),
	body: z.string().trim().min(1).max(4000).optional(),
	status: z.enum(['draft', 'published', 'archived']).optional()
});

/**
 * Edita, publica ou arquiva um anúncio existente.
 */
export const PATCH = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const id = params.id;
	if (!isUuid(id)) {
		return json({ erro: 'Identificador inválido.' }, { status: 400 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = patchAnuncioSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [atual] = await banco
		.select()
		.from(announcement)
		.where(and(eq(announcement.id, id), eq(announcement.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Aviso não encontrado.' }, { status: 404 });
	}

	const ctxEscopo = { groupId: atual.audienceScope === 'group' ? atual.groupId : null };
	const dados = resultado.data;

	if (dados.status === 'published' && atual.status !== 'published') {
		if (!can(actor, 'announcement.send', ctxEscopo)) {
			return json({ erro: 'Sem permissão para publicar este aviso.' }, { status: 403 });
		}
	} else if (!can(actor, 'announcement.create', ctxEscopo)) {
		return json({ erro: 'Sem permissão para alterar este aviso.' }, { status: 403 });
	}

	const agora = new Date();
	const novoStatus = dados.status ?? atual.status;
	const [atualizado] = await banco
		.update(announcement)
		.set({
			title: dados.title ?? atual.title,
			body: dados.body ?? atual.body,
			status: novoStatus,
			publishedAt:
				novoStatus === 'published' && !atual.publishedAt ? agora : atual.publishedAt,
			updatedAt: agora
		})
		.where(eq(announcement.id, id))
		.returning();

	if (novoStatus !== atual.status) {
		await banco.insert(auditLog).values({
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			action: `announcement.${novoStatus}`,
			entity: 'announcement',
			entityId: id,
			before: { status: atual.status },
			after: { status: novoStatus }
		});
	}

	return json({ ok: true, anuncio: atualizado });
};

/**
 * Exclui um anúncio e registra em auditoria.
 */
export const DELETE = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const id = params.id;
	if (!isUuid(id)) {
		return json({ erro: 'Identificador inválido.' }, { status: 400 });
	}

	const [atual] = await banco
		.select()
		.from(announcement)
		.where(and(eq(announcement.id, id), eq(announcement.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Aviso não encontrado.' }, { status: 404 });
	}

	const ctxEscopo = { groupId: atual.audienceScope === 'group' ? atual.groupId : null };
	if (!can(actor, 'announcement.create', ctxEscopo)) {
		return json({ erro: 'Sem permissão para remover este aviso.' }, { status: 403 });
	}

	await banco.delete(announcement).where(eq(announcement.id, id));

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'announcement.deleted',
		entity: 'announcement',
		entityId: id,
		before: { title: atual.title, status: atual.status }
	});

	return json({ ok: true, mensagem: 'Aviso removido.' });
};
