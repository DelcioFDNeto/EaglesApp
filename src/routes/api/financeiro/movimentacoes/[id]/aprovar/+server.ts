import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { auditLog, financeTransaction } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const aprovarSchema = z.object({
	decisao: z.enum(['aprovar', 'rejeitar']),
	motivo: z.string().trim().max(300).optional()
});

/**
 * Aprova ou rejeita uma despesa pendente quando o fluxo de aprovação está ligado (RN-23).
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

	const resultado = aprovarSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [atual] = await banco
		.select()
		.from(financeTransaction)
		.where(and(eq(financeTransaction.id, id), eq(financeTransaction.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Movimentação não encontrada.' }, { status: 404 });
	}

	if (!can(actor, 'finance.approve', { groupId: atual.groupId })) {
		return json({ erro: 'Você não tem permissão para aprovar despesas.' }, { status: 403 });
	}

	if (atual.status !== 'pendente_aprovacao') {
		return json({ erro: 'Esta movimentação não está aguardando aprovação.' }, { status: 400 });
	}

	const { decisao, motivo } = resultado.data;
	if (decisao === 'rejeitar' && (!motivo || motivo.length < 3)) {
		return json({ erro: 'Informe o motivo da rejeição.' }, { status: 400 });
	}

	const novoStatus = decisao === 'aprovar' ? 'confirmada' : 'rejeitada';
	const agora = new Date();

	const [atualizada] = await banco
		.update(financeTransaction)
		.set({
			status: novoStatus,
			approvedByPersonId: actor.personId,
			approvedAt: agora,
			rejectionReason: decisao === 'rejeitar' ? (motivo ?? null) : null
		})
		.where(eq(financeTransaction.id, id))
		.returning();

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: decisao === 'aprovar' ? 'finance.transaction_approved' : 'finance.transaction_rejected',
		entity: 'finance_transaction',
		entityId: id,
		before: { status: atual.status },
		after: { status: novoStatus, motivo: motivo ?? null }
	});

	return json({
		ok: true,
		movimentacao: atualizada,
		mensagem: decisao === 'aprovar' ? 'Despesa aprovada e confirmada no saldo.' : 'Despesa rejeitada.'
	});
};
