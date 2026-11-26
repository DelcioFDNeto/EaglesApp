import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { auditLog, financeTransaction } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const estornarSchema = z.object({
	motivo: z.string().trim().min(3, 'Informe o motivo do estorno.').max(300)
});

/**
 * Estorna uma movimentação confirmada (RN-21 / RF-08.10).
 * Nunca edita ou apaga a original: cria um lançamento inverso vinculado + auditoria.
 */
export const POST = async ({ request, params, locals }) => {
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

	const resultado = estornarSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Informe o motivo do estorno.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [original] = await banco
		.select()
		.from(financeTransaction)
		.where(and(eq(financeTransaction.id, id), eq(financeTransaction.teamId, actor.teamId)))
		.limit(1);

	if (!original) {
		return json({ erro: 'Movimentação não encontrada.' }, { status: 404 });
	}

	if (!can(actor, 'finance.reverse', { groupId: original.groupId })) {
		return json({ erro: 'Apenas pessoas autorizadas podem estornar lançamentos.' }, { status: 403 });
	}

	if (original.status !== 'confirmada') {
		return json({ erro: 'Apenas movimentações confirmadas podem ser estornadas.' }, { status: 400 });
	}

	if (original.reversesTransactionId) {
		return json({ erro: 'Não é possível estornar um estorno.' }, { status: 400 });
	}

	const [jaEstornada] = await banco
		.select({ id: financeTransaction.id })
		.from(financeTransaction)
		.where(eq(financeTransaction.reversesTransactionId, original.id))
		.limit(1);

	if (jaEstornada) {
		return json({ erro: 'Esta movimentação já foi estornada anteriormente.' }, { status: 400 });
	}

	const tipoInverso = original.kind === 'entrada' ? 'saida' : 'entrada';
	const [estorno] = await banco
		.insert(financeTransaction)
		.values({
			teamId: actor.teamId,
			accountId: original.accountId,
			categoryId: original.categoryId,
			kind: tipoInverso,
			amountCents: original.amountCents,
			occurredAt: new Date(),
			paymentMethod: original.paymentMethod,
			description: `Estorno: ${original.description} (${resultado.data.motivo})`,
			responsiblePersonId: actor.personId,
			personId: original.personId,
			eventId: original.eventId,
			groupId: original.groupId,
			status: 'confirmada',
			reversesTransactionId: original.id
		})
		.returning();

	if (!estorno) {
		return json({ erro: 'Não foi possível registrar o estorno.' }, { status: 500 });
	}

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'finance.transaction_reversed',
		entity: 'finance_transaction',
		entityId: estorno.id,
		before: { originalId: original.id, amountCents: original.amountCents, kind: original.kind },
		after: { estornoId: estorno.id, motivo: resultado.data.motivo }
	});

	return json(
		{
			ok: true,
			estorno,
			mensagem: 'Estorno registrado. Ambos os lançamentos permanecem visíveis no livro-caixa.'
		},
		{ status: 201 }
	);
};
