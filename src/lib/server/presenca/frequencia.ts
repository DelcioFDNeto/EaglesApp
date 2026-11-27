import { and, asc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import type { Database } from '../db';
import {
	event,
	eventRegistration,
	eventType,
	group,
	groupMember,
	groupMemberHistory,
	person,
	presence
} from '../db/schema';
import { lerOpcoes } from '../eventos/regras';
import { naoEhMaster } from '../lideranca/regras';
import { chavesQueConfirmam } from '$shared/rsvp';

/**
 * Frequência (RF-06.3, RF-06.4).
 *
 * Definições, todas explícitas para ninguém tirar conclusão errada:
 *
 *   - **Chamada feita:** o evento tem ao menos um registro de presença. Evento
 *     sem chamada não conta para ninguém: não há como saber quem veio.
 *   - **Esperado num encontro de PG:** quem estava naquele PG NA DATA do
 *     encontro (pelo histórico de PGs). Mudar de PG não puxa faltas antigas.
 *   - **Frequência em %:** só nos encontros do PG da pessoa. Em evento da
 *     equipe toda não há como saber quem era esperado (reunião do conselho,
 *     Outside...), então ali só se contam presenças, sem %.
 *   - **Veio:** presença "presente" ou "atrasado".
 *   - **RN-15:** não responder NÃO é falta, e responder "não vou" também não
 *     muda nada na conta. A resposta só aparece como contexto ("avisou").
 *
 * Nada aqui ordena pessoas por frequência: listas saem em ordem alfabética
 * (persona negativa "o fiscal", seção 4).
 */

// ---------------------------------------------------------------------------
// Dados de entrada (já carregados)
// ---------------------------------------------------------------------------

export type EventoF = {
	id: string;
	titulo: string;
	groupId: string | null;
	tipoNome: string | null;
	inicio: Date;
	confirmam: Set<string>;
};

export type DadosFrequencia = {
	eventos: EventoF[];
	/** Registros de presença dos eventos acima. */
	presencas: Array<{ eventId: string; personId: string; status: string }>;
	/** Resposta ATUAL de cada pessoa em cada evento. */
	respostas: Array<{ eventId: string; personId: string; option: string }>;
	/** Mudanças de PG da equipe (histórico), em qualquer ordem. */
	mudancas: Array<{ personId: string; para: string | null; em: Date }>;
	/** PG atual de cada pessoa, para quem não tem histórico. */
	atuais: Array<{ personId: string; groupId: string; desde: Date }>;
	pessoas: Array<{ id: string; nome: string }>;
};

const VEIO = new Set(['present', 'late']);
const pct = (parte: number, total: number) =>
	total > 0 ? Math.round((parte / total) * 100) : null;
const mesDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Índices
// ---------------------------------------------------------------------------

type Indice = {
	pgNaData: (personId: string, data: Date) => string | null;
	veio: (eventId: string, personId: string) => boolean;
	chamadaFeita: (eventId: string) => boolean;
	resposta: (eventId: string, personId: string) => string | null;
	presentesNoEvento: (eventId: string) => string[];
};

export function indexar(dados: DadosFrequencia): Indice {
	const mudancasPorPessoa = new Map<string, Array<{ para: string | null; em: Date }>>();
	for (const m of dados.mudancas) {
		const lista = mudancasPorPessoa.get(m.personId) ?? [];
		lista.push({ para: m.para, em: m.em });
		mudancasPorPessoa.set(m.personId, lista);
	}
	for (const lista of mudancasPorPessoa.values()) lista.sort((a, b) => +a.em - +b.em);
	const atual = new Map(dados.atuais.map((a) => [a.personId, a]));

	const status = new Map<string, string>();
	const comChamada = new Set<string>();
	const presentes = new Map<string, string[]>();
	for (const p of dados.presencas) {
		status.set(`${p.eventId}|${p.personId}`, p.status);
		comChamada.add(p.eventId);
		if (VEIO.has(p.status))
			presentes.set(p.eventId, [...(presentes.get(p.eventId) ?? []), p.personId]);
	}
	const respostas = new Map(dados.respostas.map((r) => [`${r.eventId}|${r.personId}`, r.option]));

	return {
		pgNaData(personId, data) {
			const lista = mudancasPorPessoa.get(personId);
			if (lista && lista.length > 0) {
				let pg: string | null = null;
				for (const m of lista) {
					if (+m.em > +data) break;
					pg = m.para;
				}
				return pg;
			}
			const a = atual.get(personId);
			return a && +a.desde <= +data ? a.groupId : null;
		},
		veio: (e, p) => VEIO.has(status.get(`${e}|${p}`) ?? ''),
		chamadaFeita: (e) => comChamada.has(e),
		resposta: (e, p) => respostas.get(`${e}|${p}`) ?? null,
		presentesNoEvento: (e) => presentes.get(e) ?? []
	};
}

// ---------------------------------------------------------------------------
// Um PG
// ---------------------------------------------------------------------------

export type ResumoConfirmacao = {
	/** Esperados nos encontros com chamada (soma por encontro). */
	esperados: number;
	/** Desses, quantos responderam qualquer coisa. */
	responderam: number;
	/** Desses, quantos responderam um "vou". */
	confirmaram: number;
	/** Dos que confirmaram, quantos vieram. */
	confirmaramEVieram: number;
	/** Quantos vieram sem ter confirmado (inclui quem não respondeu). */
	vieramSemConfirmar: number;
};

export type FrequenciaPessoaNoPg = {
	id: string;
	nome: string;
	esperados: number;
	presencas: number;
	taxa: number | null;
	/** Faltas seguidas nas chamadas mais recentes (0 se veio na última). */
	faltasSeguidas: number;
	/** Faltas em que a pessoa tinha avisado que não ia. */
	faltasAvisadas: number;
	ultimaPresenca: Date | null;
};

export type FrequenciaPg = {
	chamadas: number;
	semChamada: number;
	/** Média de presentes por chamada (todos que vieram, esperados ou não). */
	presencaMedia: number | null;
	taxaPresenca: number | null;
	confirmacao: ResumoConfirmacao;
	evolucao: Array<{ mes: string; chamadas: number; taxa: number | null }>;
	pessoas: FrequenciaPessoaNoPg[];
};

export function frequenciaDoPg(
	grupoId: string,
	dados: DadosFrequencia,
	indice: Indice = indexar(dados)
): FrequenciaPg {
	const eventos = dados.eventos
		.filter((e) => e.groupId === grupoId)
		.sort((a, b) => +a.inicio - +b.inicio);
	const comChamada = eventos.filter((e) => indice.chamadaFeita(e.id));

	const porPessoa = new Map<
		string,
		{
			esperados: number;
			presencas: number;
			avisadas: number;
			linha: boolean[];
			ultima: Date | null;
		}
	>();
	const porMes = new Map<string, { chamadas: number; esperados: number; vieram: number }>();
	const conf: ResumoConfirmacao = {
		esperados: 0,
		responderam: 0,
		confirmaram: 0,
		confirmaramEVieram: 0,
		vieramSemConfirmar: 0
	};
	let somaPresentes = 0;

	for (const e of comChamada) {
		const esperados = dados.pessoas.filter((p) => indice.pgNaData(p.id, e.inicio) === grupoId);
		const presentes = indice.presentesNoEvento(e.id);
		somaPresentes += presentes.length;

		const mes = porMes.get(mesDe(e.inicio)) ?? { chamadas: 0, esperados: 0, vieram: 0 };
		mes.chamadas += 1;

		for (const p of esperados) {
			const veio = indice.veio(e.id, p.id);
			const resposta = indice.resposta(e.id, p.id);
			const confirmou = resposta !== null && e.confirmam.has(resposta);

			const reg = porPessoa.get(p.id) ?? {
				esperados: 0,
				presencas: 0,
				avisadas: 0,
				linha: [],
				ultima: null
			};
			reg.esperados += 1;
			reg.linha.push(veio);
			if (veio) {
				reg.presencas += 1;
				reg.ultima = e.inicio;
			} else if (resposta !== null && !confirmou) {
				reg.avisadas += 1;
			}
			porPessoa.set(p.id, reg);

			mes.esperados += 1;
			if (veio) mes.vieram += 1;

			conf.esperados += 1;
			if (resposta !== null) conf.responderam += 1;
			if (confirmou) {
				conf.confirmaram += 1;
				if (veio) conf.confirmaramEVieram += 1;
			}
		}
		for (const id of presentes) {
			const r = indice.resposta(e.id, id);
			if (r === null || !e.confirmam.has(r)) conf.vieramSemConfirmar += 1;
		}
		porMes.set(mesDe(e.inicio), mes);
	}

	const nomes = new Map(dados.pessoas.map((p) => [p.id, p.nome]));
	const pessoas = [...porPessoa.entries()]
		.map(([id, r]) => {
			let faltasSeguidas = 0;
			for (let i = r.linha.length - 1; i >= 0 && !r.linha[i]; i--) faltasSeguidas++;
			return {
				id,
				nome: nomes.get(id) ?? '',
				esperados: r.esperados,
				presencas: r.presencas,
				taxa: pct(r.presencas, r.esperados),
				faltasSeguidas,
				faltasAvisadas: r.avisadas,
				ultimaPresenca: r.ultima
			};
		})
		// Ordem alfabética, sempre: isto não é ranking.
		.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

	const somaEsperados = pessoas.reduce((s, p) => s + p.esperados, 0);
	const somaVieram = pessoas.reduce((s, p) => s + p.presencas, 0);

	return {
		chamadas: comChamada.length,
		semChamada: eventos.length - comChamada.length,
		presencaMedia:
			comChamada.length > 0 ? Math.round((somaPresentes / comChamada.length) * 10) / 10 : null,
		taxaPresenca: pct(somaVieram, somaEsperados),
		confirmacao: conf,
		evolucao: [...porMes.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([mes, m]) => ({ mes, chamadas: m.chamadas, taxa: pct(m.vieram, m.esperados) })),
		pessoas
	};
}

// ---------------------------------------------------------------------------
// Eventos da equipe toda (sem PG): só contagem, sem %
// ---------------------------------------------------------------------------

export function eventosDaEquipe(dados: DadosFrequencia, indice: Indice = indexar(dados)) {
	const porTipo = new Map<string, { eventos: number; chamadas: number; presentes: number }>();
	for (const e of dados.eventos.filter((x) => x.groupId === null)) {
		const chave = e.tipoNome ?? 'Outros';
		const t = porTipo.get(chave) ?? { eventos: 0, chamadas: 0, presentes: 0 };
		t.eventos += 1;
		if (indice.chamadaFeita(e.id)) {
			t.chamadas += 1;
			t.presentes += indice.presentesNoEvento(e.id).length;
		}
		porTipo.set(chave, t);
	}
	return [...porTipo.entries()]
		.map(([tipo, t]) => ({
			tipo,
			eventos: t.eventos,
			chamadas: t.chamadas,
			presencaMedia: t.chamadas > 0 ? Math.round((t.presentes / t.chamadas) * 10) / 10 : null
		}))
		.sort((a, b) => a.tipo.localeCompare(b.tipo, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Uma pessoa
// ---------------------------------------------------------------------------

export function frequenciaDaPessoa(
	personId: string,
	dados: DadosFrequencia,
	indice: Indice = indexar(dados)
) {
	let esperados = 0;
	let presencas = 0;
	const outras = new Map<string, number>();
	const porMes = new Map<string, { esperados: number; vieram: number }>();
	const linha: Array<{
		id: string;
		titulo: string;
		inicio: Date;
		resposta: string | null;
		confirmou: boolean;
		/** null = sem chamada; true/false = veio ou não. */
		veio: boolean | null;
		contaNaFrequencia: boolean;
	}> = [];

	for (const e of [...dados.eventos].sort((a, b) => +b.inicio - +a.inicio)) {
		const chamada = indice.chamadaFeita(e.id);
		const veio = chamada ? indice.veio(e.id, personId) : null;
		const resposta = indice.resposta(e.id, personId);
		const doMeuPg = e.groupId !== null && indice.pgNaData(personId, e.inicio) === e.groupId;
		const conta = doMeuPg && chamada;

		if (conta) {
			esperados += 1;
			if (veio) presencas += 1;
			const m = porMes.get(mesDe(e.inicio)) ?? { esperados: 0, vieram: 0 };
			m.esperados += 1;
			if (veio) m.vieram += 1;
			porMes.set(mesDe(e.inicio), m);
		} else if (veio) {
			const chave = e.tipoNome ?? 'Outros';
			outras.set(chave, (outras.get(chave) ?? 0) + 1);
		}

		// Na linha do tempo, só o que diz respeito à pessoa.
		if (doMeuPg || veio || resposta !== null) {
			linha.push({
				id: e.id,
				titulo: e.titulo,
				inicio: e.inicio,
				resposta,
				confirmou: resposta !== null && e.confirmam.has(resposta),
				veio,
				contaNaFrequencia: conta
			});
		}
	}

	return {
		pg: { esperados, presencas, taxa: pct(presencas, esperados) },
		outrosEventos: [...outras.entries()]
			.map(([tipo, presencas]) => ({ tipo, presencas }))
			.sort((a, b) => a.tipo.localeCompare(b.tipo, 'pt-BR')),
		evolucao: [...porMes.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([mes, m]) => ({ mes, taxa: pct(m.vieram, m.esperados) })),
		recentes: linha.slice(0, 12)
	};
}

// ---------------------------------------------------------------------------
// Carga do banco
// ---------------------------------------------------------------------------

/**
 * Tudo o que o cálculo precisa de um período. Só eventos que já aconteceram
 * e não foram cancelados. O volume de uma comunidade cabe em memória folgado.
 */
export async function carregarDados(
	banco: Database,
	teamId: string,
	periodo: { de: Date; ate: Date }
): Promise<DadosFrequencia> {
	const ate = new Date(Math.min(+periodo.ate, Date.now()));

	const eventos = await banco
		.select({
			id: event.id,
			titulo: event.title,
			groupId: event.groupId,
			inicio: event.startsAt,
			rsvpOptions: event.rsvpOptions,
			tipoNome: eventType.name
		})
		.from(event)
		.leftJoin(eventType, eq(eventType.id, event.eventTypeId))
		.where(
			and(
				eq(event.teamId, teamId),
				ne(event.status, 'cancelled'),
				gte(event.startsAt, periodo.de),
				lte(event.startsAt, ate)
			)
		)
		.orderBy(asc(event.startsAt));

	const ids = eventos.map((e) => e.id);
	const [presencas, respostas, mudancas, atuais, pessoas] = await Promise.all([
		ids.length
			? banco
					.select({
						eventId: presence.eventId,
						personId: presence.personId,
						status: presence.status
					})
					.from(presence)
					.where(inArray(presence.eventId, ids))
			: Promise.resolve([]),
		ids.length
			? banco
					.select({
						eventId: eventRegistration.eventId,
						personId: eventRegistration.personId,
						option: eventRegistration.option
					})
					.from(eventRegistration)
					.where(inArray(eventRegistration.eventId, ids))
			: Promise.resolve([]),
		banco
			.select({
				personId: groupMemberHistory.personId,
				para: groupMemberHistory.toGroupId,
				em: groupMemberHistory.occurredAt
			})
			.from(groupMemberHistory)
			.where(eq(groupMemberHistory.teamId, teamId)),
		banco
			.select({
				personId: groupMember.personId,
				groupId: groupMember.groupId,
				desde: groupMember.joinedAt
			})
			.from(groupMember)
			.innerJoin(group, eq(group.id, groupMember.groupId))
			.where(eq(group.teamId, teamId)),
		banco
			.select({ id: person.id, nome: person.fullName })
			.from(person)
			.where(and(eq(person.teamId, teamId), isNull(person.deletedAt), naoEhMaster(person.id)))
	]);

	return {
		eventos: eventos.map((e) => ({
			id: e.id,
			titulo: e.titulo,
			groupId: e.groupId,
			tipoNome: e.tipoNome,
			inicio: e.inicio,
			confirmam: chavesQueConfirmam(lerOpcoes(e.rsvpOptions))
		})),
		presencas,
		respostas,
		mudancas,
		atuais,
		pessoas
	};
}

/** Período a partir de `?de=AAAA-MM-DD&ate=AAAA-MM-DD`; padrão: últimos 90 dias. */
export function lerPeriodo(url: URL | undefined): { de: Date; ate: Date } | null {
	const ate = url?.searchParams.get('ate');
	const de = url?.searchParams.get('de');
	const fim = ate ? new Date(`${ate}T23:59:59`) : new Date();
	const inicio = de ? new Date(`${de}T00:00:00`) : new Date(+fim - 90 * 86_400_000);
	if (Number.isNaN(+inicio) || Number.isNaN(+fim) || inicio > fim) return null;
	// Teto de 2 anos por consulta: o relatório é para olhar a caminhada, não o arquivo inteiro.
	if (+fim - +inicio > 731 * 86_400_000) return null;
	return { de: inicio, ate: fim };
}
