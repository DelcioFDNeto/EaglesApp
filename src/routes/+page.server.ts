import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Raiz: encaminha para o lugar certo conforme o estado da sessão.
 *
 * Permissão: nenhuma — só decide para onde ir, não expõe dado.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (locals.actor) redirect(303, '/inicio');
	redirect(303, '/entrar');
};
