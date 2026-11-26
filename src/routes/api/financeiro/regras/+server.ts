import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { auditLog, contributionRule, financeCategory } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const criarRegraSchema = z.object({
	categoryId: z.string().uuid(),
	roleKey: z.string().trim().min(1).max(40).optional().nullable(),
	minAmountCents: z.number().int().positive(),
	period: z.enum(['mensal', 'avulso']).default('mensal')
});

/**
 * Lista regras de valor mínimo de contribuição (RN-22 / RF-08.6 / RF-08.7).
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
		return json({ erro: 'Sem permissão para ver regras de contribuição.' }, { status: 403 });
	}

	const regras = await banco
		.select({
			id: contributionRule.id,
			categoryId: contributionRule.categoryId,
			categoryName: financeCategory.name,
			roleKey: contributionRule.roleKey,
			minAmountCents: contributionRule.minAmountCents,
			period: contributionRule.period,
			active: contributionRule.active
		})
		.from(contributionRule)
		.innerJoin(financeCategory, eq(financeCategory.id, contributionRule.categoryId))
		.where(and(eq(contributionRule.teamId, actor.teamId), eq(contributionRule.active, true)))
		.orderBy(asc(financeCategory.name));

	return json({ regras });
};

/**
 * Cria regra de valor mínimo de contribuição (RN-22).
 * Doações NUNCA podem ter valor mínimo.
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'finance.approve') && !can(actor, 'settings.manage')) {
		return json({ erro: 'Apenas líderes podem definir regras de valor mínimo.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarRegraSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = resultado.data;
	const [categoria] = await banco
		.select()
		.from(financeCategory)
		.where(and(eq(financeCategory.id, dados.categoryId), eq(financeCategory.teamId, actor.teamId)))
		.limit(1);

	if (!categoria) {
		return json({ erro: 'Categoria não encontrada.' }, { status: 404 });
	}

	if (categoria.kind !== 'entrada') {
		return json(
			{ erro: 'Valor mínimo de contribuição só se aplica a categorias de entrada.' },
			{ status: 400 }
		);
	}

	if (categoria.isDonation) {
		return json({ erro: 'Doação nunca pode ter valor mínimo (RN-22).' }, { status: 400 });
	}

	const [criada] = await banco
		.insert(contributionRule)
		.values({
			teamId: actor.teamId,
			categoryId: dados.categoryId,
			roleKey: dados.roleKey ?? null,
			minAmountCents: dados.minAmountCents,
			period: dados.period
		})
		.returning();

	if (criada) {
		await banco.insert(auditLog).values({
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			action: 'finance.contribution_rule_created',
			entity: 'contribution_rule',
			entityId: criada.id,
			after: {
				categoryId: criada.categoryId,
				roleKey: criada.roleKey,
				minAmountCents: criada.minAmountCents
			}
		});
	}

	return json({ ok: true, regra: criada }, { status: 201 });
};
