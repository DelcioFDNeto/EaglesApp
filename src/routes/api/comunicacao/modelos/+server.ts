import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { messageTemplate } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { MODELOS_PADRAO, VARIAVEIS_SUPORTADAS } from '$server/comunicacao/mensagens';

const criarModeloSchema = z.object({
	name: z.string().trim().min(1).max(100),
	category: z.enum(['evento', 'escala', 'lembrete', 'aviso']).default('aviso'),
	content: z.string().trim().min(1).max(4000)
});

/**
 * Lista modelos de mensagem reutilizáveis da equipe (RF-09.3).
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
		can(actor, 'announcement.create') ||
		groupsWhere(actor, 'announcement.create').length > 0;
	if (!podeLer) {
		return json({ erro: 'Sem permissão para consultar modelos.' }, { status: 403 });
	}

	const modelos = await banco
		.select()
		.from(messageTemplate)
		.where(and(eq(messageTemplate.teamId, actor.teamId), eq(messageTemplate.active, true)))
		.orderBy(asc(messageTemplate.name));

	const podeGerenciar =
		can(actor, 'announcement.create') || groupsWhere(actor, 'announcement.create').length > 0;

	return json({
		podeGerenciar,
		modelos,
		modelosPadrao: MODELOS_PADRAO,
		variaveis: VARIAVEIS_SUPORTADAS
	});
};

/**
 * Cria um modelo reutilizável de mensagem com variáveis (RF-09.3).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeGerenciar =
		can(actor, 'announcement.create') || groupsWhere(actor, 'announcement.create').length > 0;
	if (!podeGerenciar) {
		return json(
			{ erro: 'Apenas líderes e conselheiros podem criar modelos de mensagem.' },
			{ status: 403 }
		);
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarModeloSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [existe] = await banco
		.select({ id: messageTemplate.id })
		.from(messageTemplate)
		.where(
			and(eq(messageTemplate.teamId, actor.teamId), eq(messageTemplate.name, resultado.data.name))
		)
		.limit(1);

	if (existe) {
		return json({ erro: 'Já existe um modelo com este nome na equipe.' }, { status: 400 });
	}

	const [criado] = await banco
		.insert(messageTemplate)
		.values({
			teamId: actor.teamId,
			name: resultado.data.name,
			category: resultado.data.category,
			content: resultado.data.content,
			createdByPersonId: actor.personId
		})
		.returning();

	return json({ ok: true, modelo: criado }, { status: 201 });
};
