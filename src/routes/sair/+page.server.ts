import { redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { clearSessionCookie, revokeSession } from '$server/auth/session';
import { audit } from '$server/audit/log';
import type { Actions, PageServerLoad } from './$types';

/**
 * Saída.
 *
 * PERMISSÃO: autenticado (implícita — sem sessão não há o que revogar).
 *
 * Só por POST: um GET /sair permitiria que uma imagem de terceiros
 * (`<img src="https://app.eagles/sair">`) derrubasse a sessão de quem
 * visitasse a página. O SvelteKit já valida a origem em POST.
 */
export const load: PageServerLoad = async () => {
	redirect(303, '/inicio');
};

export const actions: Actions = {
	default: async ({ locals, cookies, request, getClientAddress }) => {
		if (locals.session) {
			const banco = db();
			await revokeSession(banco, locals.session.id);
			await audit(banco, {
				teamId: locals.actor?.teamId ?? null,
				actorPersonId: locals.actor?.personId ?? null,
				action: 'auth.logout',
				entity: 'session',
				entityId: locals.session.id,
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
		}

		clearSessionCookie(cookies);
		redirect(303, '/entrar');
	}
};
