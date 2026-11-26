import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { messageTemplate } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const atualizarModeloSchema = z.object({
	name: z.string().trim().min(1).max(100).optional(),
	category: z.enum(['evento', 'escala', 'lembrete', 'aviso']).optional(),
	content: z.string().trim().min(1).max(4000).optional(),
	active: z.boolean().optional()
});

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
		can(actor, 'announcement.create') || groupsWhere(actor, 'announcement.create').length > 0;
	if (!podeGerenciar) {
		return json({ erro: 'Sem permissão para editar modelos.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = atualizarModeloSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [atual] = await banco
		.select()
		.from(messageTemplate)
		.where(and(eq(messageTemplate.id, id), eq(messageTemplate.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Modelo não encontrado.' }, { status: 404 });
	}

	const dados = resultado.data;
	const [atualizado] = await banco
		.update(messageTemplate)
		.set({
			name: dados.name ?? atual.name,
			category: dados.category ?? atual.category,
			content: dados.content ?? atual.content,
			active: dados.active ?? atual.active,
			updatedAt: new Date()
		})
		.where(eq(messageTemplate.id, id))
		.returning();

	return json({ ok: true, modelo: atualizado });
};

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
		can(actor, 'announcement.create') || groupsWhere(actor, 'announcement.create').length > 0;
	if (!podeGerenciar) {
		return json({ erro: 'Sem permissão para desativar modelos.' }, { status: 403 });
	}

	const [atual] = await banco
		.select({ id: messageTemplate.id })
		.from(messageTemplate)
		.where(and(eq(messageTemplate.id, id), eq(messageTemplate.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Modelo não encontrado.' }, { status: 404 });
	}

	await banco
		.update(messageTemplate)
		.set({ active: false, updatedAt: new Date() })
		.where(eq(messageTemplate.id, id));

	return json({ ok: true, mensagem: 'Modelo desativado.' });
};
