import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { auditLog, financeCategory } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const criarCategoriaSchema = z.object({
	name: z.string().trim().min(1).max(80),
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.min(1)
		.max(50)
		.regex(/^[a-z0-9-]+$/, 'Use apenas letras minúsculas, números e hífen.'),
	kind: z.enum(['entrada', 'saida']),
	isDonation: z.boolean().default(false)
});

/**
 * Lista categorias financeiras configuráveis da equipe (RF-08.1).
 * Visitante sem permissão financeira recebe 403 (RN-24).
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeVer =
		can(actor, 'finance.view_all') ||
		can(actor, 'finance.view_group') ||
		groupsWhere(actor, 'finance.view_group').length > 0 ||
		can(actor, 'finance.view_own', { personId: actor.personId });

	if (!podeVer) {
		return json({ erro: 'Sem permissão para acessar o módulo financeiro.' }, { status: 403 });
	}

	const categorias = await banco
		.select()
		.from(financeCategory)
		.where(and(eq(financeCategory.teamId, actor.teamId), eq(financeCategory.active, true)))
		.orderBy(asc(financeCategory.kind), asc(financeCategory.name));

	return json({
		podeGerenciar: can(actor, 'finance.approve') || can(actor, 'settings.manage'),
		categorias
	});
};

/**
 * Cria uma categoria financeira configurável (RF-08.1).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'finance.approve') && !can(actor, 'settings.manage')) {
		return json(
			{ erro: 'Apenas líderes podem cadastrar categorias financeiras.' },
			{ status: 403 }
		);
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarCategoriaSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = resultado.data;
	if (dados.isDonation && dados.kind !== 'entrada') {
		return json({ erro: 'Doação precisa ser uma categoria de entrada.' }, { status: 400 });
	}

	const [existe] = await banco
		.select({ id: financeCategory.id })
		.from(financeCategory)
		.where(
			and(eq(financeCategory.teamId, actor.teamId), eq(financeCategory.slug, dados.slug))
		)
		.limit(1);

	if (existe) {
		return json({ erro: 'Já existe uma categoria com este identificador.' }, { status: 400 });
	}

	const [criada] = await banco
		.insert(financeCategory)
		.values({
			teamId: actor.teamId,
			name: dados.name,
			slug: dados.slug,
			kind: dados.kind,
			isDonation: dados.isDonation
		})
		.returning();

	if (criada) {
		await banco.insert(auditLog).values({
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			action: 'finance.category_created',
			entity: 'finance_category',
			entityId: criada.id,
			after: { name: criada.name, kind: criada.kind, isDonation: criada.isDonation }
		});
	}

	return json({ ok: true, categoria: criada }, { status: 201 });
};
