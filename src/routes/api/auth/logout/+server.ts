import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$server/db';
import { person } from '$server/db/schema';
import { revokeSession } from '$server/auth/session';
import { audit } from '$server/audit/log';
import { autenticar, isUuid } from '$lib/server/auth/middleware';

/**
 * Encerra a sessão atual no banco (a do `sessionId` do JWT) e registra na
 * auditoria. O frontend também apaga o token do aparelho.
 *
 * Idempotente: sem token válido, responde ok e não registra nada.
 */
export const POST = async ({ request, getClientAddress }) => {
	try {
		const payload = autenticar(request);
		if (isUuid(payload.sessionId) && isUuid(payload.personId)) {
			const banco = db();
			await revokeSession(banco, payload.sessionId);

			const [pessoa] = await banco
				.select({ teamId: person.teamId })
				.from(person)
				.where(eq(person.id, payload.personId))
				.limit(1);

			await audit(banco, {
				teamId: pessoa?.teamId ?? null,
				actorPersonId: payload.personId,
				action: 'auth.logout',
				entity: 'session',
				entityId: payload.sessionId,
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
		}
	} catch {
		// Sem token válido, logout é idempotente.
	}

	return json({ ok: true });
};
