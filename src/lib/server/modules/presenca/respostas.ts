import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '$server/db';
import { eventType, eventTypeRsvpOption, rsvpOption } from '$server/db/schema';
import { audit } from '$server/audit/log';
import { authorize, type Actor } from '$server/policy/policy';
import { EventoRecusado } from '$server/modules/eventos/regras';
import { ehId } from '$shared/formulario';

/**
 * Respostas de presença (RN-11, D-M06-1): o que a pessoa pode responder, e
 * quais delas cada tipo de evento oferece.
 *
 * Alterar é configuração da equipe — `settings.manage` global, como os tipos.
 */

export type Significado = 'sim' | 'talvez' | 'nao';

export type Resposta = {
	id: string;
	texto: string;
	significado: Significado;
	aceitaConvidados: boolean;
	arquivada: boolean;
};

function resposta(l: typeof rsvpOption.$inferSelect): Resposta {
	return {
		id: l.id,
		texto: l.label,
		significado: l.semantic as Significado,
		aceitaConvidados: l.allowsGuests,
		arquivada: l.archivedAt !== null
	};
}

export async function listarRespostas(
	db: Database,
	teamId: string,
	opcoes: { incluirArquivadas?: boolean } = {}
): Promise<Resposta[]> {
	const linhas = await db
		.select()
		.from(rsvpOption)
		.where(
			and(
				eq(rsvpOption.teamId, teamId),
				opcoes.incluirArquivadas ? undefined : isNull(rsvpOption.archivedAt)
			)
		)
		.orderBy(asc(rsvpOption.position), asc(rsvpOption.label));
	return linhas.map(resposta);
}

/**
 * Respostas que um tipo oferece. Tipo que não escolheu nenhuma oferece todas
 * as ativas — o padrão que não exige configuração para funcionar.
 */
export async function respostasDosTipos(
	db: Database,
	teamId: string,
	tipoIds: string[]
): Promise<Map<string, Resposta[]>> {
	const todas = await listarRespostas(db, teamId);
	const mapa = new Map<string, Resposta[]>();
	if (tipoIds.length === 0) return mapa;

	const escolhas = await db
		.select({ typeId: eventTypeRsvpOption.typeId, optionId: eventTypeRsvpOption.optionId })
		.from(eventTypeRsvpOption)
		.where(inArray(eventTypeRsvpOption.typeId, tipoIds));

	for (const tipoId of new Set(tipoIds)) {
		const dele = new Set(escolhas.filter((e) => e.typeId === tipoId).map((e) => e.optionId));
		mapa.set(tipoId, dele.size === 0 ? todas : todas.filter((r) => dele.has(r.id)));
	}
	return mapa;
}

export async function respostasDoTipo(db: Database, teamId: string, tipoId: string) {
	return (await respostasDosTipos(db, teamId, [tipoId])).get(tipoId) ?? [];
}

/** Ids escolhidos por tipo — para a tela de configuração. */
export async function escolhasPorTipo(
	db: Database,
	teamId: string
): Promise<Map<string, string[]>> {
	const linhas = await db
		.select({ typeId: eventTypeRsvpOption.typeId, optionId: eventTypeRsvpOption.optionId })
		.from(eventTypeRsvpOption)
		.innerJoin(eventType, eq(eventType.id, eventTypeRsvpOption.typeId))
		.where(eq(eventType.teamId, teamId));
	const mapa = new Map<string, string[]>();
	for (const l of linhas) mapa.set(l.typeId, [...(mapa.get(l.typeId) ?? []), l.optionId]);
	return mapa;
}

type ContextoDeRequisicao = { ip?: string | null; userAgent?: string | null };

export async function criarResposta(
	db: Database,
	actor: Actor,
	dados: { texto: string; significado: Significado; aceitaConvidados: boolean },
	contexto: ContextoDeRequisicao = {}
): Promise<string> {
	authorize(actor, 'settings.manage');
	const [criada] = await db
		.insert(rsvpOption)
		.values({
			teamId: actor.teamId,
			label: dados.texto,
			semantic: dados.significado,
			allowsGuests: dados.significado === 'sim' && dados.aceitaConvidados,
			position: 100
		})
		.returning({ id: rsvpOption.id });

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'attendance.resposta_criada',
		entity: 'rsvp_option',
		entityId: criada!.id,
		after: dados,
		...contexto
	});
	return criada!.id;
}

export async function arquivarResposta(
	db: Database,
	actor: Actor,
	respostaId: string,
	arquivar: boolean,
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	authorize(actor, 'settings.manage');
	if (!ehId(respostaId)) throw new EventoRecusado('nao_encontrado', 'Essa resposta não existe.');
	const [r] = await db
		.select()
		.from(rsvpOption)
		.where(and(eq(rsvpOption.id, respostaId), eq(rsvpOption.teamId, actor.teamId)))
		.limit(1);
	if (!r) throw new EventoRecusado('nao_encontrado', 'Essa resposta não existe.');

	await db
		.update(rsvpOption)
		.set({ archivedAt: arquivar ? new Date() : null, updatedAt: new Date() })
		.where(eq(rsvpOption.id, respostaId));

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: arquivar ? 'attendance.resposta_arquivada' : 'attendance.resposta_reativada',
		entity: 'rsvp_option',
		entityId: respostaId,
		before: { texto: r.label },
		...contexto
	});
}

/**
 * Escolhe as respostas que um tipo oferece. Lista vazia volta ao padrão:
 * todas as ativas.
 */
export async function definirRespostasDoTipo(
	db: Database,
	actor: Actor,
	tipoId: string,
	respostaIds: string[],
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	authorize(actor, 'settings.manage');
	if (!ehId(tipoId)) throw new EventoRecusado('nao_encontrado', 'Esse tipo de evento não existe.');

	const [tipo] = await db
		.select({ id: eventType.id })
		.from(eventType)
		.where(and(eq(eventType.id, tipoId), eq(eventType.teamId, actor.teamId)))
		.limit(1);
	if (!tipo) throw new EventoRecusado('nao_encontrado', 'Esse tipo de evento não existe.');

	respostaIds = respostaIds.filter(ehId);
	const validas = respostaIds.length
		? (
				await db
					.select({ id: rsvpOption.id })
					.from(rsvpOption)
					.where(and(inArray(rsvpOption.id, respostaIds), eq(rsvpOption.teamId, actor.teamId)))
			).map((r) => r.id)
		: [];

	await db.transaction(async (tx) => {
		await tx.delete(eventTypeRsvpOption).where(eq(eventTypeRsvpOption.typeId, tipoId));
		if (validas.length > 0) {
			await tx
				.insert(eventTypeRsvpOption)
				.values(validas.map((optionId) => ({ typeId: tipoId, optionId })));
		}
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'attendance.respostas_do_tipo',
		entity: 'event_type',
		entityId: tipoId,
		after: { respostas: validas },
		...contexto
	});
}
