import { json } from '@sveltejs/kit';
import { db } from '$server/db';
import { revokeSession } from '$server/auth/session';
import { autenticar, isUuid } from '$lib/server/auth/middleware';

/**
 * Encerra a sessão atual no banco (quando vinculada a sessionId no JWT).
 * O frontend também remove o token do localStorage.
 */
export const POST = async ({ request }) => {
	try {
		const payload = autenticar(request);
		if (isUuid(payload.sessionId)) {
			await revokeSession(db(), payload.sessionId);
		}
	} catch {
		// Sem token válido, logout é idempotente.
	}

	return json({ ok: true });
};
