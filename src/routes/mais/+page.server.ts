import { redirect } from '@sveltejs/kit';
import { can } from '$server/policy/policy';
import type { PageServerLoad } from './$types';

/**
 * "Mais" — o que é de uso eventual (D-M05-9).
 *
 * PERMISSÃO: nenhuma — PRÓPRIA CONTA. A página só lista destinos; cada
 * destino continua verificando a própria permissão. Esconder um item aqui é
 * conveniência, a proteção é a rota.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.actor || !locals.session) redirect(303, '/entrar');

	return {
		nome: locals.displayName ?? null,
		// Sem contexto: só o escopo global administra acesso e configuração.
		podeAdministrarAcessos: can(locals.actor, 'rbac.manage'),
		podeConfigurar: can(locals.actor, 'settings.manage')
	};
};
