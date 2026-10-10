import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { canAnywhere, type Actor } from '$server/policy/policy';
import { eventoPorCodigo, verEvento } from '$server/modules/eventos/eventos';
import { EventoRecusado, statusDaRecusaDeEvento } from '$server/modules/eventos/regras';
import { paineisDeResposta } from '$server/modules/presenca/painel';
import { responder } from '$server/modules/presenca/rsvp';
import { funcionalidadeLigada } from '$server/settings/flags';
import type { Actions, PageServerLoad } from './$types';

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
 * "Você vai?" (D-M06-3): só para quem já entrou E vê o evento pela regra de
 * visibilidade de sempre — o link não abre a agenda de ninguém. Sem sessão,
 * a página mostra "entrar para confirmar"; não há resposta anônima.
 */

/** O painel de resposta, se quem abriu o link pode responder a ESTE evento. */
async function painelDe(actor: Actor | null, eventId: string) {
	if (!actor || !canAnywhere(actor, 'event.view')) return null;
	const banco = db();
	const evento = await verEvento(banco, actor, eventId);
	if (!evento) return null;
	return (await paineisDeResposta(banco, actor, [evento])).get(evento.id) ?? null;
}

export const load: PageServerLoad = async ({ params, setHeaders, locals }) => {
	const evento = await eventoPorCodigo(db(), params.codigo);
	if (!evento) error(404, 'Este link de evento não existe ou não está mais disponível.');

	setHeaders({ 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'private, no-store' });

	const { teamId, id, ...publico } = evento;
	const actor = locals.actor ?? null;
	return {
		evento: publico,
		// Primeira vez? Só oferece o autocadastro se a liderança o ligou.
		autocadastro: await funcionalidadeLigada(db(), teamId, 'autocadastro_visitante'),
		autenticado: !!actor,
		// Outra equipe não vê nada além do que o anônimo vê.
		resposta: actor?.teamId === teamId ? await painelDe(actor, id) : null
	};
};

export const actions: Actions = {
	/** Responder pelo link — exige sessão (D-M06-3). */
	responder: async ({ locals, params, request, url }) => {
		if (!locals.actor) redirect(303, `/entrar?voltar=${encodeURIComponent(url.pathname)}`);
		if (!canAnywhere(locals.actor, 'event.view')) error(403, 'Sem permissão para responder.');

		const evento = await eventoPorCodigo(db(), params.codigo);
		if (!evento) error(404, 'Este link de evento não existe ou não está mais disponível.');

		const form = await request.formData();
		try {
			await responder(db(), locals.actor, evento.id, {
				respostaId: String(form.get('respostaId') ?? ''),
				convidados: Number(form.get('convidados') ?? 0) || 0
			});
			return { sucesso: 'Resposta registrada.' };
		} catch (erro) {
			if (erro instanceof EventoRecusado) {
				return fail(statusDaRecusaDeEvento(erro.motivo), { erro: erro.message });
			}
			throw erro;
		}
	}
};
