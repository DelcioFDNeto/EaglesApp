import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '$server/db';
import { event, person, rsvp, rsvpOption } from '$server/db/schema';
import { can, type Actor } from '$server/policy/policy';
import { verEvento } from '$server/modules/eventos/eventos';
import { EventoRecusado } from '$server/modules/eventos/regras';
import { respostasDoTipo, type Significado } from './respostas';

/**
 * RSVP — "você vai?" (RF-06.1, D-M06-2, D-M06-3).
 *
 * A pessoa responde por si, a qualquer evento publicado que ela pode ver,
 * até ele terminar. O histórico (RN-12) é do banco: o gatilho `rsvp_versiona`
 * grava cada resposta em `rsvp_history`, e este arquivo nem toca naquela
 * tabela.
 */

/** Depois de começar, ainda dá para responder por 3 horas — o "tô chegando". */
const TOLERANCIA_MS = 3 * 60 * 60 * 1000;

export type EventoParaResposta = {
	id: string;
	tipo: { id: string };
	publicado: boolean;
	cancelado: boolean;
	inicio: Date;
	fim: Date | null;
};

/** O evento ainda aceita resposta? Publicado, não cancelado, não terminado. */
export function aceitaResposta(e: EventoParaResposta, agora = new Date()): boolean {
	const termina = e.fim ?? new Date(e.inicio.getTime() + TOLERANCIA_MS);
	return e.publicado && !e.cancelado && termina > agora;
}

export type MinhaResposta = { respostaId: string; significado: Significado; convidados: number };

export async function responder(
	db: Database,
	actor: Actor,
	eventId: string,
	entrada: { respostaId: string; convidados?: number }
): Promise<void> {
	// `verEvento` aplica a regra de visibilidade inteira (D-M05-7): quem não
	// vê o evento recebe "não existe", e não "proibido".
	const evento = await verEvento(db, actor, eventId);
	if (!evento) throw new EventoRecusado('nao_encontrado', 'Esse evento não existe.');
	if (!evento.publicado) {
		throw new EventoRecusado('nao_encontrado', 'Esse evento ainda não foi publicado.');
	}
	if (evento.cancelado) {
		throw new EventoRecusado('ja_aconteceu', 'Esse evento foi cancelado.');
	}
	if (!aceitaResposta(evento)) {
		throw new EventoRecusado('ja_aconteceu', 'Esse evento já terminou.');
	}

	const oferecidas = await respostasDoTipo(db, actor.teamId, evento.tipo.id);
	const escolhida = oferecidas.find((r) => r.id === entrada.respostaId);
	if (!escolhida) {
		throw new EventoRecusado('nao_encontrado', 'Essa resposta não vale para este evento.');
	}
	const convidados = escolhida.aceitaConvidados
		? Math.max(0, Math.min(20, Math.trunc(entrada.convidados ?? 0)))
		: 0;

	const agora = new Date();
	await db
		.insert(rsvp)
		.values({
			eventId,
			personId: actor.personId,
			optionId: escolhida.id,
			guests: convidados,
			respondedByPersonId: actor.personId,
			respondedAt: agora
		})
		.onConflictDoUpdate({
			target: [rsvp.eventId, rsvp.personId],
			set: {
				optionId: escolhida.id,
				guests: convidados,
				respondedByPersonId: actor.personId,
				respondedAt: agora
			}
		});
}

/** As respostas do próprio ator a vários eventos — para o início e a agenda. */
export async function minhasRespostas(
	db: Database,
	actor: Actor,
	eventIds: string[]
): Promise<Map<string, MinhaResposta>> {
	const mapa = new Map<string, MinhaResposta>();
	if (eventIds.length === 0) return mapa;

	const linhas = await db
		.select({
			eventId: rsvp.eventId,
			respostaId: rsvp.optionId,
			significado: rsvpOption.semantic,
			convidados: rsvp.guests
		})
		.from(rsvp)
		.innerJoin(rsvpOption, eq(rsvpOption.id, rsvp.optionId))
		.where(and(eq(rsvp.personId, actor.personId), inArray(rsvp.eventId, eventIds)));

	for (const l of linhas) {
		mapa.set(l.eventId, {
			respostaId: l.respostaId,
			significado: l.significado as Significado,
			convidados: l.convidados
		});
	}
	return mapa;
}

export type TotalDaResposta = {
	respostaId: string;
	texto: string;
	significado: Significado;
	pessoas: number;
	convidados: number;
};

/**
 * Totais por resposta (D-M06-8): quem vê o evento vê quantos vão. Os nomes
 * ficam em `quemRespondeu`, com outra permissão.
 */
export async function totaisDoEvento(db: Database, eventId: string): Promise<TotalDaResposta[]> {
	const linhas = await db
		.select({
			respostaId: rsvpOption.id,
			texto: rsvpOption.label,
			significado: rsvpOption.semantic,
			posicao: rsvpOption.position,
			pessoas: count(rsvp.id),
			convidados: sql<number>`coalesce(sum(${rsvp.guests}), 0)`
		})
		.from(rsvp)
		.innerJoin(rsvpOption, eq(rsvpOption.id, rsvp.optionId))
		.where(eq(rsvp.eventId, eventId))
		.groupBy(rsvpOption.id, rsvpOption.label, rsvpOption.semantic, rsvpOption.position)
		.orderBy(asc(rsvpOption.position));

	return linhas.map((l) => ({
		respostaId: l.respostaId,
		texto: l.texto,
		significado: l.significado as Significado,
		pessoas: Number(l.pessoas),
		convidados: Number(l.convidados)
	}));
}

export type RespostaNominal = {
	personId: string;
	nome: string;
	texto: string;
	significado: Significado;
	convidados: number;
	quando: Date;
};

/**
 * Quem respondeu o quê — só com `attendance.view` no grupo do evento
 * (D-M06-8). Para os outros, `null`: nem a lista vazia, que diria algo.
 */
export async function quemRespondeu(
	db: Database,
	actor: Actor,
	eventId: string
): Promise<RespostaNominal[] | null> {
	const [e] = await db
		.select({ groupId: event.groupId, teamId: event.teamId })
		.from(event)
		.where(eq(event.id, eventId))
		.limit(1);
	if (!e || e.teamId !== actor.teamId) return null;
	if (!can(actor, 'attendance.view', { groupId: e.groupId })) return null;

	const linhas = await db
		.select({
			personId: person.id,
			nome: person.fullName,
			texto: rsvpOption.label,
			significado: rsvpOption.semantic,
			convidados: rsvp.guests,
			quando: rsvp.respondedAt
		})
		.from(rsvp)
		.innerJoin(person, eq(person.id, rsvp.personId))
		.innerJoin(rsvpOption, eq(rsvpOption.id, rsvp.optionId))
		.where(eq(rsvp.eventId, eventId))
		.orderBy(asc(rsvpOption.position), asc(person.fullNameNormalized));

	return linhas.map((l) => ({ ...l, significado: l.significado as Significado }));
}
