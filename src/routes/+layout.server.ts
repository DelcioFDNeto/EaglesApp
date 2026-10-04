import { can, canAnywhere } from '$server/policy/policy';
import type { ItemDeNavegacao } from '$ui/BarraInferior.svelte';
import type { LayoutServerLoad } from './$types';

/**
 * Navegação principal, montada a partir das permissões de quem está usando.
 *
 * PERMISSÃO: cada item verifica a sua. Não expõe dado nenhum além da própria
 * lista de destinos — e cada destino continua verificando por conta própria:
 * esconder o item é conveniência, a proteção é a rota.
 *
 * Existe desde o M03. As telas de pessoas do M02 foram entregues sem nenhum
 * caminho até elas; só se chegava digitando o endereço.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.actor) return { navegacao: null };

	const itens: ItemDeNavegacao[] = [{ href: '/inicio', rotulo: 'Início', icone: 'inicio' }];

	if (canAnywhere(locals.actor, 'person.view')) {
		itens.push({ href: '/pessoas', rotulo: 'Pessoas', icone: 'pessoas' });
	}

	// Sem contexto: só o escopo global administra acesso.
	if (can(locals.actor, 'rbac.manage')) {
		itens.push({ href: '/admin/papeis', rotulo: 'Acessos', icone: 'acessos' });
	}

	itens.push({ href: '/conta/sessoes', rotulo: 'Conta', icone: 'conta' });

	return { navegacao: itens };
};
