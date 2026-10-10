import type { Alvo } from '$server/modules/eventos/regras';

/**
 * Cálculo de frequência (D-M06-4, D-M06-5, D-M06-7). Puro: sem banco, sem
 * relógio — o que mais importa acertar, testado em milissegundos.
 *
 * As três regras que dão sentido ao número:
 *   1. só entra evento COM LISTA FEITA — sem lista, ninguém faltou (RN-15);
 *   2. só conta como esperado quem era convidado NAQUELE DIA: a equipe, o
 *      grupo em que a pessoa estava na data, ou ela nominalmente;
 *   3. presença em evento para o qual não era esperada conta como presença,
 *      mas não entra no denominador — visitar outro PG não é faltar ao seu.
 */

/** Um evento cuja lista de presença foi feita. */
export type EventoComLista = { id: string; inicio: Date; publico: Alvo[] };

/** Uma passagem por um grupo — `group_membership`. */
export type Passagem = { personId: string; groupId: string; entrada: Date; saida: Date | null };

export type PessoaParaCalculo = { id: string; cadastradaEm: Date };

export const FALTAS_PARA_SINAL = 3;
export const PRESENCAS_DE_VISITANTE = 3;
export const JANELA_DE_VISITANTE_DIAS = 60;
export const JANELA_DE_FREQUENCIA_SEMANAS = 8;

export function estavaNoGrupo(
	passagens: Passagem[],
	personId: string,
	groupId: string,
	quando: Date
): boolean {
	return passagens.some(
		(p) =>
			p.personId === personId &&
			p.groupId === groupId &&
			p.entrada <= quando &&
			(p.saida === null || p.saida > quando)
	);
}

/** A pessoa era esperada neste evento? (D-M06-5) */
export function esperadoNo(
	evento: EventoComLista,
	pessoa: PessoaParaCalculo,
	passagens: Passagem[]
): boolean {
	// Quem ainda não estava no cadastro não podia ser esperado.
	if (pessoa.cadastradaEm > evento.inicio) return false;
	return evento.publico.some(
		(a) =>
			a.tipo === 'equipe' ||
			(a.tipo === 'pessoa' && a.personId === pessoa.id) ||
			(a.tipo === 'grupo' && estavaNoGrupo(passagens, pessoa.id, a.groupId, evento.inicio))
	);
}

export type Frequencia = {
	/** Eventos com lista em que a pessoa era esperada. */
	esperados: number;
	/** Desses, em quantos esteve. */
	presentes: number;
	/** Presenças em eventos para os quais NÃO era esperada. */
	foraDoEsperado: number;
	/** presentes / esperados, de 0 a 100; nulo sem nenhum esperado. */
	percentual: number | null;
	/** Ausências seguidas nos esperados mais recentes. */
	faltasSeguidas: number;
	/** Já esteve em algum esperado antes das faltas seguidas? */
	costumavaVir: boolean;
	/** Presenças (esperadas ou não) desde a data pedida. */
	presencasRecentes: number;
};

/**
 * Frequência de uma pessoa sobre os eventos dados — em qualquer ordem;
 * a função ordena.
 */
export function frequenciaDe(
	pessoa: PessoaParaCalculo,
	eventos: EventoComLista[],
	passagens: Passagem[],
	presencas: ReadonlySet<string>,
	opcoes: { recentesDesde?: Date } = {}
): Frequencia {
	const ordenados = [...eventos].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
	const esteve = (e: EventoComLista) => presencas.has(chaveDePresenca(e.id, pessoa.id));

	let esperados = 0;
	let presentes = 0;
	let foraDoEsperado = 0;
	let presencasRecentes = 0;
	const sequencia: boolean[] = [];

	for (const e of ordenados) {
		const presente = esteve(e);
		if (presente && opcoes.recentesDesde && e.inicio >= opcoes.recentesDesde) presencasRecentes++;

		if (esperadoNo(e, pessoa, passagens)) {
			esperados++;
			if (presente) presentes++;
			sequencia.push(presente);
		} else if (presente) {
			foraDoEsperado++;
		}
	}

	let faltasSeguidas = 0;
	for (let i = sequencia.length - 1; i >= 0 && !sequencia[i]; i--) faltasSeguidas++;

	return {
		esperados,
		presentes,
		foraDoEsperado,
		percentual: esperados === 0 ? null : Math.round((presentes / esperados) * 100),
		faltasSeguidas,
		costumavaVir: sequencia.slice(0, sequencia.length - faltasSeguidas).some(Boolean),
		presencasRecentes
	};
}

export type Sinal = 'sumiu' | 'visitante_frequente';

/**
 * Sinais de atenção (D-M06-7) — para quem cuida do grupo, nunca ranking.
 *
 * "Sumiu": costumava vir e faltou aos últimos três encontros com lista.
 * Quem nunca veio não "sumiu" — é outro tipo de conversa.
 *
 * "Visitante frequente": ainda no estágio de quem acabou de chegar e já veio
 * três vezes em 60 dias (F1). O sistema sinaliza; quem decide é o
 * conselheiro (RN-03).
 */
export function sinaisDe(f: Frequencia, ehVisitante: boolean): Sinal[] {
	const sinais: Sinal[] = [];
	if (f.faltasSeguidas >= FALTAS_PARA_SINAL && f.costumavaVir) sinais.push('sumiu');
	if (ehVisitante && f.presencasRecentes >= PRESENCAS_DE_VISITANTE)
		sinais.push('visitante_frequente');
	return sinais;
}

export function chaveDePresenca(eventId: string, personId: string): string {
	return `${eventId}:${personId}`;
}
