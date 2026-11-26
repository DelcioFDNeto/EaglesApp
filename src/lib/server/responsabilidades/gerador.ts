/**
 * Motor determinístico de sugestão de escala (RN-17, RN-18, RN-19, RF-07.4, RF-07.6).
 *
 * Princípio central: o motor apenas PROPÕE. Nenhuma escala sugerida se torna
 * oficial sem confirmação humana explícita (`status = 'proposta'`).
 */

export type CandidatoEscala = {
	personId: string;
	nome: string;
};

export type ResponsabilidadeParaEscala = {
	id: string;
	nome: string;
	intervaloMinimoDias: number;
	ordem: number;
};

export type RegistroHistoricoEscala = {
	personId: string;
	responsabilidadeId: string;
	eventoInicio: Date;
};

export type ItemPropostaGerada = {
	responsabilidadeId: string;
	responsabilidadeNome: string;
	personId: string;
	pessoaNome: string;
	ordem: number;
	respeitouIntervalo: boolean;
	justificativa: string;
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Calcula uma proposta de escala justa e determinística evitando repetições
 * excessivas e respeitando `intervaloMinimoDias` de cada responsabilidade.
 */
export function gerarPropostaDeEscala(params: {
	dataEvento: Date;
	responsabilidades: ResponsabilidadeParaEscala[];
	candidatos: CandidatoEscala[];
	historico: RegistroHistoricoEscala[];
	jaEscaladosNoEvento?: Set<string>;
	responsabilidadesJaPreenchidas?: Set<string>;
}): ItemPropostaGerada[] {
	const {
		dataEvento,
		responsabilidades,
		candidatos,
		historico,
		jaEscaladosNoEvento = new Set<string>(),
		responsabilidadesJaPreenchidas = new Set<string>()
	} = params;

	if (candidatos.length === 0 || responsabilidades.length === 0) {
		return [];
	}

	const janelaCargaInicio = dataEvento.getTime() - 90 * MS_POR_DIA;
	const ocupadosNesteEvento = new Set<string>(jaEscaladosNoEvento);

	// Estatísticas históricas por pessoa
	const carga90Dias = new Map<string, number>();
	const ultimaGeral = new Map<string, number>();
	const ultimaPorResp = new Map<string, number>();

	for (const h of historico) {
		const ts = h.eventoInicio.getTime();
		if (ts > dataEvento.getTime()) continue;

		if (ts >= janelaCargaInicio) {
			carga90Dias.set(h.personId, (carga90Dias.get(h.personId) ?? 0) + 1);
		}

		const prevGeral = ultimaGeral.get(h.personId);
		if (prevGeral === undefined || ts > prevGeral) {
			ultimaGeral.set(h.personId, ts);
		}

		const chave = `${h.personId}:${h.responsabilidadeId}`;
		const prevResp = ultimaPorResp.get(chave);
		if (prevResp === undefined || ts > prevResp) {
			ultimaPorResp.set(chave, ts);
		}
	}

	const ordenadas = [...responsabilidades].sort(
		(a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR')
	);

	const proposta: ItemPropostaGerada[] = [];

	for (const resp of ordenadas) {
		if (responsabilidadesJaPreenchidas.has(resp.id)) continue;

		const intervaloMs = resp.intervaloMinimoDias * MS_POR_DIA;

		// Evita acumular duas funções no mesmo evento enquanto houver gente livre
		const livres = candidatos.filter((c) => !ocupadosNesteEvento.has(c.personId));
		const pool = livres.length > 0 ? livres : candidatos;

		const pontuar = (c: CandidatoEscala) => {
			const chave = `${c.personId}:${resp.id}`;
			const ultResp = ultimaPorResp.get(chave) ?? null;
			const diasDesdeResp =
				ultResp === null ? Infinity : Math.floor((dataEvento.getTime() - ultResp) / MS_POR_DIA);
			const respeitaIntervalo =
				ultResp === null || dataEvento.getTime() - ultResp >= intervaloMs;
			const carga = carga90Dias.get(c.personId) ?? 0;
			const ultQualquer = ultimaGeral.get(c.personId) ?? -Infinity;

			return { c, respeitaIntervalo, diasDesdeResp, carga, ultQualquer, ultResp };
		};

		const avaliados = pool.map(pontuar).sort((a, b) => {
			// 1. Quem respeita o intervalo mínimo sempre vem antes
			if (a.respeitaIntervalo !== b.respeitaIntervalo) {
				return a.respeitaIntervalo ? -1 : 1;
			}
			// 2. Quem tem menos atribuições nos últimos 90 dias
			if (a.carga !== b.carga) {
				return a.carga - b.carga;
			}
			// 3. Quem fez esta responsabilidade há mais tempo (ou nunca fez)
			const aUltResp = a.ultResp ?? -Infinity;
			const bUltResp = b.ultResp ?? -Infinity;
			if (aUltResp !== bUltResp) {
				return aUltResp - bUltResp;
			}
			// 4. Quem fez qualquer responsabilidade há mais tempo
			if (a.ultQualquer !== b.ultQualquer) {
				return a.ultQualquer - b.ultQualquer;
			}
			// 5. Desempate determinístico
			return a.c.personId.localeCompare(b.c.personId);
		});

		const escolhido = avaliados[0];
		if (!escolhido) continue;

		ocupadosNesteEvento.add(escolhido.c.personId);
		carga90Dias.set(escolhido.c.personId, (carga90Dias.get(escolhido.c.personId) ?? 0) + 1);
		ultimaGeral.set(escolhido.c.personId, dataEvento.getTime());
		ultimaPorResp.set(`${escolhido.c.personId}:${resp.id}`, dataEvento.getTime());

		const justificativa = !escolhido.respeitaIntervalo
			? `Todos os candidatos atuaram nos últimos ${resp.intervaloMinimoDias} dias; sugerido por menor carga recente.`
			: escolhido.ultResp === null
				? 'Ainda não assumiu esta função recentemente.'
				: `Última vez nesta função há ${escolhido.diasDesdeResp} dias.`;

		proposta.push({
			responsabilidadeId: resp.id,
			responsabilidadeNome: resp.nome,
			personId: escolhido.c.personId,
			pessoaNome: escolhido.c.nome,
			ordem: resp.ordem,
			respeitouIntervalo: escolhido.respeitaIntervalo,
			justificativa
		});
	}

	return proposta;
}
