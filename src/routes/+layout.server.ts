import { canAnywhere } from '$server/policy/policy';
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
 *
 * Leva também o fuso da equipe: toda tela que formata uma data o usa, em vez
 * de uma constante própria (revisão de 17/10/2026).
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	const fuso = locals.fuso;
	if (!locals.actor) return { navegacao: null, fuso };

	// No máximo 5 itens (Anexo A.3). O que é de uso eventual — a própria
	// conta, papéis e acessos, tipos de evento — mora em "Mais" (D-M05-9).
	const itens: ItemDeNavegacao[] = [{ href: '/inicio', rotulo: 'Início', icone: 'inicio' }];

	if (canAnywhere(locals.actor, 'event.view')) {
		itens.push({ href: '/agenda', rotulo: 'Agenda', icone: 'agenda' });
	}

	if (canAnywhere(locals.actor, 'person.view')) {
		itens.push({ href: '/pessoas', rotulo: 'Pessoas', icone: 'pessoas' });
	}

	if (canAnywhere(locals.actor, 'group.view')) {
		itens.push({ href: '/grupos', rotulo: 'Grupos', icone: 'grupos' });
	}

	itens.push({ href: '/mais', rotulo: 'Mais', icone: 'mais' });

	return { navegacao: itens, fuso };
};
