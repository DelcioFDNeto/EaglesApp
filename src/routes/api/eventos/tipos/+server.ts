import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { eventType } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const criarTipoSchema = z.object({
	name: z.string().trim().min(1).max(80),
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.min(1)
		.max(50)
		.regex(/^[a-z0-9-]+$/),
	description: z.string().trim().max(300).optional(),
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/)
		.default('#A91825')
});

/**
 * Lista tipos configuráveis de evento da equipe (RN-10).
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (
		!can(actor, 'event.view', { personId: actor.personId }) &&
		groupsWhere(actor, 'event.view').length === 0
	) {
		return json({ erro: 'Sem permissão para ver tipos de evento.' }, { status: 403 });
	}

	const tipos = await banco
		.select()
		.from(eventType)
		.where(eq(eventType.teamId, actor.teamId))
		.orderBy(asc(eventType.name));

	return json({ tipos });
};

/**
 * Cria um novo tipo de evento (RN-10). Exige `event.manage`.
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'event.manage') && groupsWhere(actor, 'event.manage').length === 0) {
		return json(
			{ erro: 'Apenas líderes e conselheiros podem criar tipos de evento.' },
			{ status: 403 }
		);
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarTipoSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [existe] = await banco
		.select({ id: eventType.id })
		.from(eventType)
		.where(and(eq(eventType.teamId, actor.teamId), eq(eventType.slug, resultado.data.slug)))
		.limit(1);

	if (existe) {
		return json({ erro: 'Já existe um tipo de evento com este identificador.' }, { status: 400 });
	}

	const [criado] = await banco
		.insert(eventType)
		.values({
			teamId: actor.teamId,
			name: resultado.data.name,
			slug: resultado.data.slug,
			description: resultado.data.description || null,
			color: resultado.data.color
		})
		.returning();

	return json({ ok: true, tipo: criado }, { status: 201 });
};
