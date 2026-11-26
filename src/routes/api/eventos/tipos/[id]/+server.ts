import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { eventType } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { audit } from '$server/audit/log';

const editarTipoSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		description: z.string().trim().max(300).nullable(),
		color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
		active: z.boolean()
	})
	.partial()
	.strict();

/**
 * Edita ou desativa um tipo de evento (RN-10).
 *
 * Exige `event.manage` GLOBAL: o tipo vale para a equipe inteira, então um
 * conselheiro de um PG não muda o que os outros PGs veem. (Criar continua
 * aberto a conselheiros: acrescentar um tipo não tira nada de ninguém.)
 *
 * O `slug` não muda: é o identificador estável. E não há exclusão: desativar
 * esconde o tipo dos eventos novos sem tocar nos que já o usam.
 */
export const PUT = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'event.manage')) {
		return json(
			{ erro: 'Apenas quem gerencia eventos da equipe toda pode editar tipos de evento.' },
			{ status: 403 }
		);
	}

	const tipoId = params.id;
	if (!isUuid(tipoId)) {
		return json({ erro: 'Identificador inválido.' }, { status: 400 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = editarTipoSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [atual] = await banco
		.select()
		.from(eventType)
		.where(and(eq(eventType.id, tipoId), eq(eventType.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Tipo de evento não encontrado.' }, { status: 404 });
	}

	const dados = resultado.data;
	const mudancas = {
		...(dados.name !== undefined && { name: dados.name }),
		...(dados.description !== undefined && { description: dados.description || null }),
		...(dados.color !== undefined && { color: dados.color }),
		...(dados.active !== undefined && { active: dados.active })
	};

	const antes: Record<string, unknown> = {};
	const depois: Record<string, unknown> = {};
	for (const [campo, valor] of Object.entries(mudancas)) {
		const anterior = atual[campo as keyof typeof atual];
		if (anterior !== valor) {
			antes[campo] = anterior;
			depois[campo] = valor;
		}
	}

	if (Object.keys(depois).length === 0) {
		return json({ ok: true, alterado: false, tipo: atual });
	}

	const [tipo] = await banco
		.update(eventType)
		.set({ ...mudancas, updatedAt: new Date() })
		.where(eq(eventType.id, atual.id))
		.returning();

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'event_type.atualizado',
		entity: 'event_type',
		entityId: atual.id,
		before: antes,
		after: depois
	});

	return json({ ok: true, alterado: true, tipo });
};
