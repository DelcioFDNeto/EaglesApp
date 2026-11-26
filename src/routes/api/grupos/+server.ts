import { json } from '@sveltejs/kit';
import { and, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { group, groupMember } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const criarGrupoSchema = z.object({
	name: z.string().trim().min(1).max(100),
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.min(1)
		.max(50)
		.regex(/^[a-z0-9-]+$/, 'Use apenas letras minúsculas, números e hífen.'),
	description: z.string().trim().max(500).optional()
});

/**
 * Lista grupos/PGs da equipe da pessoa autenticada com contagem de membros.
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeVer =
		can(actor, 'group.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'group.view').length > 0;

	if (!podeVer) {
		return json({ erro: 'Sem permissão para ver grupos.' }, { status: 403 });
	}

	const grupos = await banco
		.select({
			id: group.id,
			name: group.name,
			slug: group.slug,
			description: group.description,
			createdAt: group.createdAt
		})
		.from(group)
		.where(eq(group.teamId, actor.teamId))
		.orderBy(asc(group.name));

	const contagens = await banco
		.select({
			groupId: groupMember.groupId,
			total: count()
		})
		.from(groupMember)
		.innerJoin(group, eq(group.id, groupMember.groupId))
		.where(eq(group.teamId, actor.teamId))
		.groupBy(groupMember.groupId);

	const mapaContagem = new Map(contagens.map((c) => [c.groupId, Number(c.total)]));

	return json({
		podeGerenciar: can(actor, 'group.manage'),
		grupos: grupos.map((g) => ({
			...g,
			membroCount: mapaContagem.get(g.id) ?? 0
		}))
	});
};

/**
 * Cria um novo grupo/PG. Exige `group.manage` (líderes).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'group.manage')) {
		return json({ erro: 'Apenas líderes podem criar grupos.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarGrupoSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [slugExiste] = await banco
		.select({ id: group.id })
		.from(group)
		.where(and(eq(group.teamId, actor.teamId), eq(group.slug, resultado.data.slug)))
		.limit(1);

	if (slugExiste) {
		return json({ erro: 'Este identificador já está em uso na equipe.' }, { status: 400 });
	}

	const [novoGrupo] = await banco
		.insert(group)
		.values({
			teamId: actor.teamId,
			name: resultado.data.name,
			slug: resultado.data.slug,
			description: resultado.data.description || null,
			createdByPersonId: actor.personId
		})
		.returning();

	if (!novoGrupo) {
		return json({ erro: 'Não foi possível criar o grupo.' }, { status: 500 });
	}

	return json(
		{
			ok: true,
			grupo: {
				id: novoGrupo.id,
				name: novoGrupo.name,
				slug: novoGrupo.slug,
				description: novoGrupo.description,
				createdAt: novoGrupo.createdAt
			}
		},
		{ status: 201 }
	);
};
