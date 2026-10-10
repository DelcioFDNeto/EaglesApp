import { error } from '@sveltejs/kit';
import { db } from '$server/db';
import { eventoPorCodigo } from '$server/modules/eventos/eventos';
import { funcionalidadeLigada } from '$server/settings/flags';
import type { PageServerLoad } from './$types';

/**
 * Link público do evento (D-M05-8) — o que circula no WhatsApp.
 *
 * PERMISSÃO: pública POR DECISÃO, cercada por:
 *   1. código de 10 caracteres aleatórios (~59 bits): o local de um PG
 *      costuma ser a casa de alguém, e um código curto se adivinha;
 *   2. só evento PUBLICADO — rascunho responde 404, como inexistente;
 *   3. nenhum dado de pessoa: nem quem vai, nem quem organiza;
 *   4. `noindex`: o link é para quem o recebeu, não para buscador.
 *
 * O "confirmar presença" deste link chega com o M06.
 */
export const load: PageServerLoad = async ({ params, setHeaders, locals }) => {
	const evento = await eventoPorCodigo(db(), params.codigo);
	if (!evento) error(404, 'Este link de evento não existe ou não está mais disponível.');

	setHeaders({ 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'private, no-store' });

	const { teamId, ...publico } = evento;
	return {
		evento: publico,
		// Primeira vez? Só oferece o autocadastro se a liderança o ligou.
		autocadastro: await funcionalidadeLigada(db(), teamId, 'autocadastro_visitante'),
		autenticado: !!locals.actor
	};
};
