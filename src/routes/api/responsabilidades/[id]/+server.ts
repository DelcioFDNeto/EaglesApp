import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { responsabilidade } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const atualizarResponsabilidadeSchema = z.object({
	nome: z.string().trim().min(1).max(100).optional(),
	descricao: z.string().trim().max(500).nullable().optional(),
	intervaloMinimoDias: z.number().int().min(0).max(365).optional(),
	ativo: z.boolean().optional(),
	ordem: z.number().int().min(0).max(1000).optional()
});

/**
 * Atualiza um tipo de responsabilidade configurável (RF-07.1 / RF-07.6).
 */
export const PUT = async ({ request, params, locals }) => {
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

	const podeGerenciar =
		can(actor, 'responsibility.manage') ||
		groupsWhere(actor, 'responsibility.manage').length > 0;
	if (!podeGerenciar) {
		return json(
			{ erro: 'Apenas líderes e conselheiros podem editar responsabilidades.' },
			{ status: 403 }
		);
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = atualizarResponsabilidadeSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [atual] = await banco
		.select()
		.from(responsabilidade)
		.where(and(eq(responsabilidade.id, id), eq(responsabilidade.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Responsabilidade não encontrada.' }, { status: 404 });
	}

	const dados = resultado.data;
	const [atualizada] = await banco
		.update(responsabilidade)
		.set({
			nome: dados.nome ?? atual.nome,
			descricao: dados.descricao !== undefined ? dados.descricao : atual.descricao,
			intervaloMinimoDias: dados.intervaloMinimoDias ?? atual.intervaloMinimoDias,
			ativo: dados.ativo ?? atual.ativo,
			ordem: dados.ordem ?? atual.ordem,
			updatedAt: new Date()
		})
		.where(eq(responsabilidade.id, id))
		.returning();

	return json({ ok: true, responsabilidade: atualizada });
};

/**
 * Desativa um tipo de responsabilidade (preserva histórico de escalas passadas).
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

	const podeGerenciar =
		can(actor, 'responsibility.manage') ||
		groupsWhere(actor, 'responsibility.manage').length > 0;
	if (!podeGerenciar) {
		return json(
			{ erro: 'Apenas líderes e conselheiros podem desativar responsabilidades.' },
			{ status: 403 }
		);
	}

	const [atual] = await banco
		.select({ id: responsabilidade.id })
		.from(responsabilidade)
		.where(and(eq(responsabilidade.id, id), eq(responsabilidade.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Responsabilidade não encontrada.' }, { status: 404 });
	}

	await banco
		.update(responsabilidade)
		.set({ ativo: false, updatedAt: new Date() })
		.where(eq(responsabilidade.id, id));

	return json({ ok: true, mensagem: 'Responsabilidade desativada.' });
};
