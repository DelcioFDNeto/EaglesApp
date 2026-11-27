import {
	atributosCompletos,
	calcularEquilibrioTimes,
	calcularMediasTime,
	mediaAtributos,
	type ChaveAtributo,
	type EquilibrioDraft,
	type FocoDraft,
	type NotasAtributos,
	type TimeDraftCalculado
} from '$shared/atributos';

/**
 * Motor determinístico de balanceamento de Draft (sugerir → revisar → ajustar).
 *
 * Estratégia em duas fases:
 *   1. Snake draft ordenado pela nota ponderada segundo o foco escolhido
 *      (garante distribuição justa de tamanhos ±1 e boa solução inicial).
 *   2. Busca local determinística (2-opt swaps entre times) minimizando a
 *      variância entre times na média geral e em cada um dos 4 atributos
 *      individualmente, com altura média como desempate leve.
 *
 * Pessoas ainda sem nota em algum eixo entram no cálculo com peso neutro
 * (média da turma naquele eixo ou 5,0), sem gravar nota falsa no perfil.
 */

export type ParticipanteDraft = NotasAtributos & {
	personId: string;
	nome: string;
	alturaCm: number | null;
	pontosFortes: string | null;
};

export type EntradaBalanceamento = {
	participantes: ParticipanteDraft[];
	quantidadeTimes: number;
	nomesTimes?: string[];
	foco?: FocoDraft;
};

export type ResultadoBalanceamento = {
	foco: FocoDraft;
	times: TimeDraftCalculado[];
	equilibrio: EquilibrioDraft;
};

const PESOS_FOCO: Record<FocoDraft, Record<ChaveAtributo, number>> = {
	equilibrado: { fisico: 1, biblico: 1, mental: 1, coordenacaoMotora: 1 },
	fisico: { fisico: 2.2, biblico: 1, mental: 1, coordenacaoMotora: 1.2 },
	biblico: { fisico: 1, biblico: 2.2, mental: 1.2, coordenacaoMotora: 1 },
	mental: { fisico: 1, biblico: 1.2, mental: 2.2, coordenacaoMotora: 1 },
	coordenacao: { fisico: 1.2, biblico: 1, mental: 1, coordenacaoMotora: 2.2 }
};

type ParticipanteInterno = ParticipanteDraft & {
	efetivo: Record<ChaveAtributo, number>;
	scorePonderado: number;
	alturaEfetiva: number;
	semAvaliacao: boolean;
};

function variancia(valores: number[]): number {
	if (valores.length <= 1) return 0;
	const media = valores.reduce((a, b) => a + b, 0) / valores.length;
	return valores.reduce((acc, v) => acc + (v - media) ** 2, 0) / valores.length;
}

function custoDosTimes(
	grupos: ParticipanteInterno[][],
	pesos: Record<ChaveAtributo, number>
): number {
	const mediasGerais = grupos.map(
		(g) => g.reduce((acc, p) => acc + p.scorePonderado, 0) / Math.max(g.length, 1)
	);
	const varGeral = variancia(mediasGerais) * 3.0;

	const chaves: ChaveAtributo[] = ['fisico', 'biblico', 'mental', 'coordenacaoMotora'];
	let varEixos = 0;
	for (const chave of chaves) {
		const mediasEixo = grupos.map(
			(g) => g.reduce((acc, p) => acc + p.efetivo[chave], 0) / Math.max(g.length, 1)
		);
		varEixos += variancia(mediasEixo) * pesos[chave];
	}

	// Altura em metros como desempate suave para evitar um time inteiro muito mais alto.
	const mediasAlturaM = grupos.map(
		(g) => g.reduce((acc, p) => acc + p.alturaEfetiva / 100, 0) / Math.max(g.length, 1)
	);
	const varAltura = variancia(mediasAlturaM) * 0.25;

	return varGeral + varEixos + varAltura;
}

export function balancearDraft(entrada: EntradaBalanceamento): ResultadoBalanceamento {
	const foco: FocoDraft = entrada.foco ?? 'equilibrado';
	const pesos = PESOS_FOCO[foco];
	const k = Math.max(2, Math.min(8, Math.floor(entrada.quantidadeTimes)));

	if (entrada.participantes.length < k) {
		throw new Error(`Selecione pelo menos ${k} participantes para montar ${k} times.`);
	}

	// Calcula médias neutras da turma por eixo (fallback 5,0 se ninguém avaliado).
	const mediaTurma = (chave: ChaveAtributo) => {
		const vals = entrada.participantes
			.map((p) => p[chave])
			.filter((v): v is number => v !== null && Number.isFinite(v));
		if (vals.length === 0) return 5;
		return vals.reduce((a, b) => a + b, 0) / vals.length;
	};
	const neutro: Record<ChaveAtributo, number> = {
		fisico: mediaTurma('fisico'),
		biblico: mediaTurma('biblico'),
		mental: mediaTurma('mental'),
		coordenacaoMotora: mediaTurma('coordenacaoMotora')
	};
	const alturasValidas = entrada.participantes
		.map((p) => p.alturaCm)
		.filter((v): v is number => v !== null && Number.isFinite(v));
	const alturaNeutra =
		alturasValidas.length > 0
			? alturasValidas.reduce((a, b) => a + b, 0) / alturasValidas.length
			: 170;

	const somaPesos = pesos.fisico + pesos.biblico + pesos.mental + pesos.coordenacaoMotora;

	const internos: ParticipanteInterno[] = entrada.participantes.map((p) => {
		const efetivo: Record<ChaveAtributo, number> = {
			fisico: p.fisico ?? neutro.fisico,
			biblico: p.biblico ?? neutro.biblico,
			mental: p.mental ?? neutro.mental,
			coordenacaoMotora: p.coordenacaoMotora ?? neutro.coordenacaoMotora
		};
		const scorePonderado =
			(efetivo.fisico * pesos.fisico +
				efetivo.biblico * pesos.biblico +
				efetivo.mental * pesos.mental +
				efetivo.coordenacaoMotora * pesos.coordenacaoMotora) /
			somaPesos;
		return {
			...p,
			efetivo,
			scorePonderado,
			alturaEfetiva: p.alturaCm ?? alturaNeutra,
			semAvaliacao: !atributosCompletos(p)
		};
	});

	// Ordenação determinística: maior score ponderado, depois altura, depois nome.
	internos.sort((a, b) => {
		if (Math.abs(b.scorePonderado - a.scorePonderado) > 1e-9) {
			return b.scorePonderado - a.scorePonderado;
		}
		if (b.alturaEfetiva !== a.alturaEfetiva) return b.alturaEfetiva - a.alturaEfetiva;
		return a.nome.localeCompare(b.nome, 'pt-BR');
	});

	// Fase 1: Snake draft (0..k-1, k-1..0, ...)
	const grupos: ParticipanteInterno[][] = Array.from({ length: k }, () => []);
	for (let i = 0; i < internos.length; i++) {
		const rodada = Math.floor(i / k);
		const pos = i % k;
		const indiceTime = rodada % 2 === 0 ? pos : k - 1 - pos;
		grupos[indiceTime]!.push(internos[i]!);
	}

	// Fase 2: Busca local 2-opt (trocas 1-para-1 preservando tamanhos dos times)
	let melhorCusto = custoDosTimes(grupos, pesos);
	for (let iter = 0; iter < 150; iter++) {
		let melhorTroca: { t1: number; i1: number; t2: number; i2: number; custo: number } | null =
			null;

		for (let t1 = 0; t1 < k; t1++) {
			for (let t2 = t1 + 1; t2 < k; t2++) {
				const g1 = grupos[t1]!;
				const g2 = grupos[t2]!;
				for (let i1 = 0; i1 < g1.length; i1++) {
					for (let i2 = 0; i2 < g2.length; i2++) {
						const a = g1[i1]!;
						const b = g2[i2]!;
						g1[i1] = b;
						g2[i2] = a;
						const c = custoDosTimes(grupos, pesos);
						if (c + 1e-9 < (melhorTroca?.custo ?? melhorCusto)) {
							melhorTroca = { t1, i1, t2, i2, custo: c };
						}
						g1[i1] = a;
						g2[i2] = b;
					}
				}
			}
		}

		if (!melhorTroca) break;
		const { t1, i1, t2, i2, custo } = melhorTroca;
		const tmp = grupos[t1]![i1]!;
		grupos[t1]![i1] = grupos[t2]![i2]!;
		grupos[t2]![i2] = tmp;
		melhorCusto = custo;
	}

	const times: TimeDraftCalculado[] = grupos.map((membros, idx) => {
		const nomeCustom = entrada.nomesTimes?.[idx]?.trim();
		const ordenados = [...membros].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
		return {
			nome: nomeCustom || `Time ${idx + 1}`,
			membros: ordenados.map((m) => ({
				personId: m.personId,
				nome: m.nome,
				fisico: m.fisico,
				biblico: m.biblico,
				mental: m.mental,
				coordenacaoMotora: m.coordenacaoMotora,
				media: mediaAtributos(m),
				alturaCm: m.alturaCm,
				pontosFortes: m.pontosFortes,
				semAvaliacao: m.semAvaliacao
			})),
			totalMembros: ordenados.length,
			medias: calcularMediasTime(ordenados)
		};
	});

	return {
		foco,
		times,
		equilibrio: calcularEquilibrioTimes(times)
	};
}
