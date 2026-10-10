import type { Database } from '$server/db';
import type { Actor } from '$server/policy/policy';
import {
	aceitaResposta,
	minhasRespostas,
	totaisDoEvento,
	type EventoParaResposta,
	type MinhaResposta,
	type TotalDaResposta
} from './rsvp';
import { respostasDosTipos, type Resposta } from './respostas';

/**
 * O bloco "Você vai?" — o mesmo no evento, no início e no link público.
 *
 * Montado num lugar só para que as três telas ofereçam exatamente as mesmas
 * respostas, nas mesmas condições: evento publicado, não cancelado, que ainda
 * não terminou (D-M06-3).
 */

export type { EventoParaResposta };

export type PainelDeResposta = {
	podeResponder: boolean;
	respostas: Resposta[];
	minha: MinhaResposta | null;
	totais: TotalDaResposta[];
};

export async function paineisDeResposta(
	db: Database,
	actor: Actor,
	eventos: EventoParaResposta[],
	opcoes: { comTotais?: boolean } = {}
): Promise<Map<string, PainelDeResposta>> {
	const [porTipo, minhas] = await Promise.all([
		respostasDosTipos(
			db,
			actor.teamId,
			eventos.map((e) => e.tipo.id)
		),
		minhasRespostas(
			db,
			actor,
			eventos.map((e) => e.id)
		)
	]);

	const mapa = new Map<string, PainelDeResposta>();
	for (const e of eventos) {
		mapa.set(e.id, {
			podeResponder: aceitaResposta(e),
			respostas: porTipo.get(e.tipo.id) ?? [],
			minha: minhas.get(e.id) ?? null,
			totais: opcoes.comTotais ? await totaisDoEvento(db, e.id) : []
		});
	}
	return mapa;
}
