import { json } from '@sveltejs/kit';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '$server/db';
import { session, userAccount } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

function descreverAparelho(ua: string | null): string {
	if (!ua) return 'Dispositivo desconhecido';
	if (/android/i.test(ua)) return 'Celular Android';
	if (/iphone|ipad/i.test(ua)) return 'iPhone / iPad';
	if (/windows/i.test(ua)) return 'Computador Windows';
	if (/mac os|macintosh/i.test(ua)) return 'Mac';
	if (/linux/i.test(ua)) return 'Computador Linux';
	return ua.slice(0, 60);
}

/**
 * Lista sessões ativas da conta autenticada.
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor, payload } = auth;
	if (!can(actor, 'person.view', { personId: actor.personId })) {
		return json({ erro: 'Sem permissão para consultar dispositivos.' }, { status: 403 });
	}

	const [conta] = await banco
		.select({ id: userAccount.id })
		.from(userAccount)
		.where(eq(userAccount.personId, actor.personId))
		.limit(1);

	if (!conta) {
		return json([]);
	}

	const sessoes = await banco
		.select({
			id: session.id,
			userAgent: session.userAgent,
			createdAt: session.createdAt
		})
		.from(session)
		.where(
			and(
				eq(session.accountId, conta.id),
				isNull(session.revokedAt),
				gt(session.expiresAt, new Date())
			)
		)
		.orderBy(desc(session.createdAt));

	const atualId = payload.sessionId ?? locals?.session?.id ?? sessoes[0]?.id;

	return json(
		sessoes.map((s) => ({
			id: s.id,
			aparelho: descreverAparelho(s.userAgent),
			criadaEm: s.createdAt,
			atual: s.id === atualId
		}))
	);
};
