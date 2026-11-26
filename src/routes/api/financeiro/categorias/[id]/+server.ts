import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { auditLog, financeCategory } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const atualizarCategoriaSchema = z.object({
	name: z.string().trim().min(1).max(80).optional(),
	isDonation: z.boolean().optional(),
	active: z.boolean().optional()
});

export const PUT = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'finance.approve') && !can(actor, 'settings.manage')) {
		return json({ erro: 'Sem permissão para editar categorias financeiras.' }, { status: 403 });
	}

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

	const resultado = atualizarCategoriaSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [atual] = await banco
		.select()
		.from(financeCategory)
		.where(and(eq(financeCategory.id, id), eq(financeCategory.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Categoria não encontrada.' }, { status: 404 });
	}

	const dados = resultado.data;
	const [atualizada] = await banco
		.update(financeCategory)
		.set({
			name: dados.name ?? atual.name,
			isDonation: dados.isDonation ?? atual.isDonation,
			active: dados.active ?? atual.active,
			updatedAt: new Date()
		})
		.where(eq(financeCategory.id, id))
		.returning();

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'finance.category_updated',
		entity: 'finance_category',
		entityId: id,
		before: { name: atual.name, active: atual.active },
		after: { name: atualizada?.name, active: atualizada?.active }
	});

	return json({ ok: true, categoria: atualizada });
};

export const DELETE = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'finance.approve') && !can(actor, 'settings.manage')) {
		return json({ erro: 'Sem permissão para desativar categorias financeiras.' }, { status: 403 });
	}

	const id = params.id;
	if (!isUuid(id)) {
		return json({ erro: 'Identificador inválido.' }, { status: 400 });
	}

	const [atual] = await banco
		.select()
		.from(financeCategory)
		.where(and(eq(financeCategory.id, id), eq(financeCategory.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Categoria não encontrada.' }, { status: 404 });
	}

	await banco
		.update(financeCategory)
		.set({ active: false, updatedAt: new Date() })
		.where(eq(financeCategory.id, id));

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'finance.category_deactivated',
		entity: 'finance_category',
		entityId: id,
		before: { name: atual.name, active: atual.active },
		after: { active: false }
	});

	return json({ ok: true, mensagem: 'Categoria desativada.' });
};
