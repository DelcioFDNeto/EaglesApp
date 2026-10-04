import { error, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can } from '$server/policy/policy';
import { listarPapeis } from '$server/modules/rbac/papeis';
import type { PageServerLoad } from './$types';

/**
 * Papéis da equipe.
 *
 * PERMISSÃO: `rbac.manage` em escopo GLOBAL — `can` sem contexto só aceita o
 * global. Recusa com 403 explícito: deixar a política lançar dentro do
 * serviço produziria a mensagem certa com o código HTTP errado (500).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!can(locals.actor, 'rbac.manage'))
		error(403, 'Você não tem permissão para administrar acessos.');

	return {
		papeis: await listarPapeis(db(), locals.actor),
		excluido: url.searchParams.get('excluido')
	};
};
