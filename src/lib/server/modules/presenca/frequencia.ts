import { and, asc, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import type { Database } from '$server/db';
import {
	attendance,
	event,
	eventAudience,
	eventType,
	groupMembership,
	membershipStatus,
	person,
	rsvp,
	rsvpOption,
	smallGroup
} from '$server/db/schema';
import { authorize, can, type Actor } from '$server/policy/policy';
import { contextoDaPessoa } from '$server/modules/grupos/contexto';
import { fusoDaEquipe } from '$server/modules/eventos/eventos';
import type { Alvo } from '$server/modules/eventos/regras';
import { dataNoFuso } from '$shared/fuso';
import {
	chaveDePresenca,
	esperadoNo,
	frequenciaDe,
	JANELA_DE_FREQUENCIA_SEMANAS,
	JANELA_DE_VISITANTE_DIAS,
	sinaisDe,
	type EventoComLista,
	type Frequencia,
	type Passagem,
	type PessoaParaCalculo,
	type Sinal
} from './calculo';

/**
 * Frequência (RF-06.3, RF-06.4, D-M06-7, D-M06-8).
 *
 * Carrega do banco o que o cálculo puro de `calculo.ts` precisa — eventos com
 * lista, passagens pelos grupos, presenças — e o aplica no escopo de quem
 * pede. Nesta escala (centenas de pessoas, dezenas de grupos) cabe na
 * memória; o dia em que não couber, o cálculo vira SQL sem mudar a regra.
 */

const DIA = 86_400_000;

export type EventoParaFrequencia = EventoComLista & {
	titulo: string;
	grupoId: string | null;
	tipoId: string;
};

/** Eventos com lista feita, não cancelados, de tipo que conta (G3). */
export async function eventosComLista(
	db: Database,
	teamId: string,
	filtro: { de: Date; ate?: Date; tipoId?: string | null }
): Promise<EventoParaFrequencia[]> {
	const linhas = await db
		.select({
			id: event.id,
			titulo: event.title,
			inicio: event.startsAt,
			grupoId: event.groupId,
			tipoId: event.typeId
		})
		.from(event)
		.innerJoin(eventType, eq(eventType.id, event.typeId))
		.where(
			and(
				eq(event.teamId, teamId),
				isNotNull(event.attendanceTakenAt),
				eq(event.status, 'agendado'),
				eq(eventType.countsForAttendance, true),
				gte(event.startsAt, filtro.de),
				filtro.ate ? lt(event.startsAt, filtro.ate) : undefined,
				filtro.tipoId ? eq(event.typeId, filtro.tipoId) : undefined
			)
		)
		.orderBy(asc(event.startsAt));

	const publicos = await publicosDe(
		db,
		linhas.map((l) => l.id)
	);
	return linhas.map((l) => ({ ...l, publico: publicos.get(l.id) ?? [] }));
}

export async function publicosDe(db: Database, eventIds: string[]): Promise<Map<string, Alvo[]>> {
	const mapa = new Map<string, Alvo[]>();
	if (eventIds.length === 0) return mapa;
	const linhas = await db
		.select({
			eventId: eventAudience.eventId,
			kind: eventAudience.kind,
			groupId: eventAudience.groupId,
			personId: eventAudience.personId
		})
		.from(eventAudience)
		.where(inArray(eventAudience.eventId, eventIds));
	for (const l of linhas) {
		const alvo: Alvo =
			l.kind === 'grupo'
				? { tipo: 'grupo', groupId: l.groupId! }
				: l.kind === 'pessoa'
					? { tipo: 'pessoa', personId: l.personId! }
					: { tipo: 'equipe' };
		mapa.set(l.eventId!, [...(mapa.get(l.eventId!) ?? []), alvo]);
	}
	return mapa;
}

export async function passagensDaEquipe(db: Database, teamId: string): Promise<Passagem[]> {
	const linhas = await db
		.select({
			personId: groupMembership.personId,
			groupId: groupMembership.groupId,
			entrada: groupMembership.joinedAt,
			saida: groupMembership.leftAt
		})
		.from(groupMembership)
		.innerJoin(person, eq(person.id, groupMembership.personId))
		.where(eq(person.teamId, teamId));
	return linhas;
}

export async function presencasDe(db: Database, eventIds: string[]): Promise<Set<string>> {
	if (eventIds.length === 0) return new Set();
	const linhas = await db
		.select({ eventId: attendance.eventId, personId: attendance.personId })
		.from(attendance)
		.where(inArray(attendance.eventId, eventIds));
	return new Set(linhas.map((l) => chaveDePresenca(l.eventId, l.personId)));
}

type PessoaDaEquipe = PessoaParaCalculo & {
	nome: string;
	ehVisitante: boolean;
	grupoAtual: { id: string; nome: string } | null;
};

/** Pessoas ativas, com o necessário para o cálculo e para a tela. */
export async function pessoasDaEquipe(db: Database, teamId: string): Promise<PessoaDaEquipe[]> {
	const linhas = await db
		.select({
			id: person.id,
			nome: person.fullName,
			cadastradaEm: person.createdAt,
			estagioPadrao: membershipStatus.isDefault,
			grupoId: smallGroup.id,
			grupoNome: smallGroup.name
		})
		.from(person)
		.leftJoin(membershipStatus, eq(membershipStatus.id, person.currentStatusId))
		.leftJoin(
			groupMembership,
			and(eq(groupMembership.personId, person.id), isNull(groupMembership.leftAt))
		)
		.leftJoin(smallGroup, eq(smallGroup.id, groupMembership.groupId))
		.where(and(eq(person.teamId, teamId), isNull(person.deletedAt)))
		.orderBy(asc(person.fullNameNormalized));

	return linhas.map((l) => ({
		id: l.id,
		nome: l.nome,
		cadastradaEm: l.cadastradaEm,
		// "Visitante" é o estágio PADRÃO — uma propriedade, não a chave (RN-02).
		ehVisitante: l.estagioPadrao === true,
		grupoAtual: l.grupoId ? { id: l.grupoId, nome: l.grupoNome! } : null
	}));
}

// ---------------------------------------------------------------------------
// Visão do grupo (D-M06-7)
// ---------------------------------------------------------------------------

export type FrequenciaNoGrupo = {
	percentual: number | null;
	esperados: number;
	presentes: number;
	sinais: Sinal[];
	/** Para o texto dos sinais: "não vem há N encontros", "já veio N vezes". */
	faltasSeguidas: number;
	presencasRecentes: number;
};

/**
 * Frequência das últimas 8 semanas e sinais de atenção de quem está no grupo.
 * Só para quem cuida dele: `attendance.report` no grupo.
 */
export async function frequenciaDoGrupo(
	db: Database,
	actor: Actor,
	groupId: string,
	agora: Date = new Date()
): Promise<Map<string, FrequenciaNoGrupo>> {
	authorize(actor, 'attendance.report', { groupId });

	const janela = new Date(agora.getTime() - JANELA_DE_FREQUENCIA_SEMANAS * 7 * DIA);
	const desdeVisitante = new Date(agora.getTime() - JANELA_DE_VISITANTE_DIAS * DIA);
	const de = janela < desdeVisitante ? janela : desdeVisitante;

	const [eventos, passagens, pessoas] = await Promise.all([
		eventosComLista(db, actor.teamId, { de, ate: agora }),
		passagensDaEquipe(db, actor.teamId),
		pessoasDaEquipe(db, actor.teamId)
	]);
	const presencas = await presencasDe(
		db,
		eventos.map((e) => e.id)
	);
	const naJanela = eventos.filter((e) => e.inicio >= janela);

	const mapa = new Map<string, FrequenciaNoGrupo>();
	for (const p of pessoas.filter((p) => p.grupoAtual?.id === groupId)) {
		const f = frequenciaDe(p, naJanela, passagens, presencas);
		const paraSinais = frequenciaDe(p, eventos, passagens, presencas, {
			recentesDesde: desdeVisitante
		});
		mapa.set(p.id, {
			percentual: f.percentual,
			esperados: f.esperados,
			presentes: f.presentes,
			sinais: sinaisDe(paraSinais, p.ehVisitante),
			faltasSeguidas: paraSinais.faltasSeguidas,
			presencasRecentes: paraSinais.presencasRecentes
		});
	}
	return mapa;
}

// ---------------------------------------------------------------------------
// Perfil da pessoa
// ---------------------------------------------------------------------------

export type FrequenciaDaPessoa = {
	frequencia: Frequencia;
	eventos: { id: string; titulo: string; data: string; esperado: boolean; presente: boolean }[];
};

/**
 * As últimas 8 semanas de uma pessoa — para ela mesma (escopo `self`) e para
 * quem tem `attendance.view` no grupo dela. `null` para os demais.
 */
export async function frequenciaDaPessoa(
	db: Database,
	actor: Actor,
	personId: string,
	agora: Date = new Date()
): Promise<FrequenciaDaPessoa | null> {
	if (!can(actor, 'attendance.view', await contextoDaPessoa(db, personId))) return null;

	const de = new Date(agora.getTime() - JANELA_DE_FREQUENCIA_SEMANAS * 7 * DIA);
	const [eventos, passagens, pessoas, fuso] = await Promise.all([
		eventosComLista(db, actor.teamId, { de, ate: agora }),
		passagensDaEquipe(db, actor.teamId),
		pessoasDaEquipe(db, actor.teamId),
		fusoDaEquipe(db, actor.teamId)
	]);
	const pessoa = pessoas.find((p) => p.id === personId);
	if (!pessoa) return null;

	const presencas = await presencasDe(
		db,
		eventos.map((e) => e.id)
	);
	const frequencia = frequenciaDe(pessoa, eventos, passagens, presencas);

	const lista = eventos
		.map((e) => ({
			id: e.id,
			titulo: e.titulo,
			data: dataNoFuso(e.inicio, fuso),
			esperado: esperadoNo(e, pessoa, passagens),
			presente: presencas.has(chaveDePresenca(e.id, personId))
		}))
		.filter((e) => e.esperado || e.presente)
		.reverse();

	return { frequencia, eventos: lista };
}

// ---------------------------------------------------------------------------
// Relatório (RF-06.3) e confirmação × presença (RF-06.4)
// ---------------------------------------------------------------------------

export type LinhaDoRelatorio = {
	personId: string;
	nome: string;
	grupo: string | null;
	esperados: number;
	presentes: number;
	foraDoEsperado: number;
	percentual: number | null;
};

export type ConfirmacaoXPresenca = {
	confirmaram: number;
	vieram: number;
	confirmaramEVieram: number;
	vieramSemConfirmar: number;
	confirmaramENaoVieram: number;
};

export type EventoDoRelatorio = {
	id: string;
	titulo: string;
	data: string;
	esperados: number;
} & ConfirmacaoXPresenca;

export type Relatorio = { pessoas: LinhaDoRelatorio[]; eventos: EventoDoRelatorio[] };

/**
 * Relatório de frequência por período, grupo e tipo.
 *
 * Com grupo: `attendance.report` naquele grupo, e as pessoas que passaram
 * por ele no período. Sem grupo: `attendance.report` global, a equipe toda.
 *
 * Em ORDEM ALFABÉTICA, de propósito (D-M06-7): ordenar por frequência seria
 * o ranking que a seção 4 pede para o produto não ter.
 */
export async function relatorio(
	db: Database,
	actor: Actor,
	filtro: { de: Date; ate: Date; grupoId?: string | null; tipoId?: string | null }
): Promise<Relatorio> {
	authorize(actor, 'attendance.report', { groupId: filtro.grupoId ?? null });

	const [todos, passagens, pessoas, fuso] = await Promise.all([
		eventosComLista(db, actor.teamId, filtro),
		passagensDaEquipe(db, actor.teamId),
		pessoasDaEquipe(db, actor.teamId),
		fusoDaEquipe(db, actor.teamId)
	]);
	const grupoId = filtro.grupoId ?? null;

	// Com grupo: os eventos do grupo ou que o convidavam.
	const eventos = grupoId
		? todos.filter(
				(e) =>
					e.grupoId === grupoId ||
					e.publico.some((a) => a.tipo === 'grupo' && a.groupId === grupoId)
			)
		: todos;
	const presencas = await presencasDe(
		db,
		eventos.map((e) => e.id)
	);

	// Com grupo: quem esteve nele em algum momento do período.
	const doEscopo = grupoId
		? pessoas.filter((p) =>
				passagens.some(
					(ps) =>
						ps.personId === p.id &&
						ps.groupId === grupoId &&
						ps.entrada < filtro.ate &&
						(ps.saida === null || ps.saida > filtro.de)
				)
			)
		: pessoas;

	const linhas: LinhaDoRelatorio[] = [];
	for (const p of doEscopo) {
		const f = frequenciaDe(p, eventos, passagens, presencas);
		if (f.esperados === 0 && f.foraDoEsperado === 0) continue;
		linhas.push({
			personId: p.id,
			nome: p.nome,
			grupo: p.grupoAtual?.nome ?? null,
			esperados: f.esperados,
			presentes: f.presentes,
			foraDoEsperado: f.foraDoEsperado,
			percentual: f.percentual
		});
	}

	const confirmacoes = await confirmacoesDe(
		db,
		eventos.map((e) => e.id)
	);
	const resumoDosEventos = eventos.map((e) => {
		const esperados = pessoas.filter((p) => esperadoNo(e, p, passagens)).length;
		return {
			id: e.id,
			titulo: e.titulo,
			data: dataNoFuso(e.inicio, fuso),
			esperados,
			...cruzar(confirmacoes.get(e.id) ?? new Set(), e.id, presencas)
		};
	});

	return { pessoas: linhas, eventos: resumoDosEventos.reverse() };
}

/** Quem respondeu "sim" em cada evento. */
async function confirmacoesDe(db: Database, eventIds: string[]): Promise<Map<string, Set<string>>> {
	const mapa = new Map<string, Set<string>>();
	if (eventIds.length === 0) return mapa;
	const linhas = await db
		.select({ eventId: rsvp.eventId, personId: rsvp.personId })
		.from(rsvp)
		.innerJoin(rsvpOption, eq(rsvpOption.id, rsvp.optionId))
		.where(and(inArray(rsvp.eventId, eventIds), eq(rsvpOption.semantic, 'sim')));
	for (const l of linhas) mapa.set(l.eventId, (mapa.get(l.eventId) ?? new Set()).add(l.personId));
	return mapa;
}

function cruzar(
	confirmaram: Set<string>,
	eventId: string,
	presencas: ReadonlySet<string>
): ConfirmacaoXPresenca {
	const vieram = [...presencas]
		.filter((k) => k.startsWith(`${eventId}:`))
		.map((k) => k.slice(eventId.length + 1));
	const vieramSet = new Set(vieram);
	const confirmaramEVieram = [...confirmaram].filter((p) => vieramSet.has(p)).length;
	return {
		confirmaram: confirmaram.size,
		vieram: vieram.length,
		confirmaramEVieram,
		vieramSemConfirmar: vieram.length - confirmaramEVieram,
		confirmaramENaoVieram: confirmaram.size - confirmaramEVieram
	};
}

/**
 * RF-06.4 de um evento — só depois da lista feita, e só para quem vê as
 * presenças do grupo do evento (D-M06-8).
 */
export async function confirmacaoXPresenca(
	db: Database,
	actor: Actor,
	eventId: string
): Promise<ConfirmacaoXPresenca | null> {
	const [e] = await db
		.select({ groupId: event.groupId, teamId: event.teamId, lista: event.attendanceTakenAt })
		.from(event)
		.where(eq(event.id, eventId))
		.limit(1);
	if (!e || e.teamId !== actor.teamId || !e.lista) return null;
	if (!can(actor, 'attendance.view', { groupId: e.groupId })) return null;

	const [confirmacoes, presencas] = await Promise.all([
		confirmacoesDe(db, [eventId]),
		presencasDe(db, [eventId])
	]);
	return cruzar(confirmacoes.get(eventId) ?? new Set(), eventId, presencas);
}
