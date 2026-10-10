import { diaDaSemana, diasEntre, somarDias } from '$shared/fuso';

/**
 * Datas de uma série semanal (D-M05-1). Pura: sem banco, sem relógio.
 *
 * A primeira ocorrência é o primeiro dia da semana certo a partir do início;
 * as seguintes, a cada `intervaloSemanas` semanas. "A cada duas semanas" conta
 * a partir da PRIMEIRA ocorrência, não de uma data arbitrária — senão abrir a
 * agenda em semanas diferentes daria quinzenas diferentes.
 */

export type DefinicaoDaSerie = {
	/** 0 = domingo … 6 = sábado. */
	diaDaSemana: number;
	intervaloSemanas: number;
	/** `AAAA-MM-DD` */
	inicio: string;
	/** `AAAA-MM-DD`, inclusive. Nulo = sem fim. */
	fim: string | null;
};

export function primeiraOcorrencia(
	serie: Pick<DefinicaoDaSerie, 'diaDaSemana' | 'inicio'>
): string {
	const avanco = (serie.diaDaSemana - diaDaSemana(serie.inicio) + 7) % 7;
	return somarDias(serie.inicio, avanco);
}

/** Datas da série no intervalo fechado [de, ate]. */
export function datasEntre(serie: DefinicaoDaSerie, de: string, ate: string): string[] {
	const limite = serie.fim && serie.fim < ate ? serie.fim : ate;
	const primeira = primeiraOcorrencia(serie);
	const passo = serie.intervaloSemanas * 7;

	// Pula direto para a primeira ocorrência >= de, sem iterar desde o início
	// da série: uma série de dois anos não deveria custar cem voltas.
	let data = primeira;
	if (de > primeira) {
		const saltos = Math.ceil(diasEntre(primeira, de) / passo);
		data = somarDias(primeira, saltos * passo);
	}

	const datas: string[] = [];
	while (data <= limite) {
		datas.push(data);
		data = somarDias(data, passo);
	}
	return datas;
}
