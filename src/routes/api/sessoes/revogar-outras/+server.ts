import { json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$server/db';
import { session, userAccount } from '$server/db/schema';
import { revokeOtherSessions } from '$server/auth/session';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

/**
 * Revoga todas as sessões ativas da conta autenticada, preservando a atual.
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor, payload } = auth;
	if (!can(actor, 'person.view', { personId: actor.personId })) {
		return json({ erro: 'Sem permissão para gerenciar dispositivos.' }, { status: 403 });
	}

	const [conta] = await banco
		.select({ id: userAccount.id })
		.from(userAccount)
		.where(eq(userAccount.personId, actor.personId))
		.limit(1);

	if (!conta) {
		return json({ ok: true, revogadas: 0, mensagem: 'Nenhuma outra sessão encontrada.' });
	}

	const sessaoAtualId = payload.sessionId ?? locals?.session?.id;
	let revogadas = 0;

	if (isUuid(sessaoAtualId)) {
		revogadas = await revokeOtherSessions(banco, conta.id, sessaoAtualId);
	} else {
		const linhas = await banco
			.update(session)
			.set({ revokedAt: new Date() })
			.where(and(eq(session.accountId, conta.id), isNull(session.revokedAt)))
			.returning({ id: session.id });
		revogadas = linhas.length;
	}

	return json({
		ok: true,
		revogadas,
		mensagem: 'Outras sessões desconectadas com sucesso.'
	});
};
