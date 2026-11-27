/**
 * Motor determinístico de sugestão de escala e substitutos (RN-17, RN-18, RN-19, RF-07.4, RF-07.5, RF-07.6).
 *
 * Princípio central: o motor apenas PROPÕE. Nenhuma escala sugerida se torna
 * oficial sem confirmação humana explícita (`status = 'proposta'`).
 */

export type StatusRsvpEscala = 'confirmado' | 'talvez' | 'nao_vou' | null;

export type CandidatoEscala = {
	personId: string;
	nome: string;
	rsvp?: StatusRsvpEscala;
	frequencia90d?: number;
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

export type SugestaoSubstituto = {
	personId: string;
	nome: string;
	respeitaIntervalo: boolean;
	rsvp: StatusRsvpEscala;
	carga90Dias: number;
	frequencia90d: number;
	justificativa: string;
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Classifica a chave de RSVP de um evento para uso no motor de escalas,
 * respeitando o conjunto de chaves que contam como "vou" (`chavesQueConfirmam`).
 */
export function classificarRsvpParaEscala(
	option: string | null | undefined,
	chavesConfirmam: ReadonlySet<string>
): StatusRsvpEscala {
	if (!option) return null;
	if (chavesConfirmam.has(option)) return 'confirmado';
	if (/^talvez/i.test(option)) return 'talvez';
	return 'nao_vou';
}

function pesoRsvp(rsvp: StatusRsvpEscala | undefined): number {
	if (rsvp === 'confirmado') return 0;
	if (rsvp === 'talvez') return 2;
	if (rsvp === 'nao_vou') return 3;
	return 1; // null ou undefined (sem resposta)
}

function calcularEstatisticasHistorico(dataEvento: Date, historico: RegistroHistoricoEscala[]) {
	const janelaCargaInicio = dataEvento.getTime() - 90 * MS_POR_DIA;
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

	return { carga90Dias, ultimaGeral, ultimaPorResp };
}

type CandidatoPontuado = {
	c: CandidatoEscala;
	respeitaIntervalo: boolean;
	pesoRsvp: number;
	carga: number;
	frequencia90d: number;
	diasDesdeResp: number;
	ultQualquer: number;
	ultResp: number | null;
};

function pontuarCandidato(
	c: CandidatoEscala,
	resp: ResponsabilidadeParaEscala,
	dataEvento: Date,
	stats: ReturnType<typeof calcularEstatisticasHistorico>
): CandidatoPontuado {
	const intervaloMs = resp.intervaloMinimoDias * MS_POR_DIA;
	const chave = `${c.personId}:${resp.id}`;
	const ultResp = stats.ultimaPorResp.get(chave) ?? null;
	const diasDesdeResp =
		ultResp === null ? Infinity : Math.floor((dataEvento.getTime() - ultResp) / MS_POR_DIA);
	const respeitaIntervalo = ultResp === null || dataEvento.getTime() - ultResp >= intervaloMs;
	const carga = stats.carga90Dias.get(c.personId) ?? 0;
	const ultQualquer = stats.ultimaGeral.get(c.personId) ?? -Infinity;
	const frequencia90d = c.frequencia90d ?? 0;

	return {
		c,
		respeitaIntervalo,
		pesoRsvp: pesoRsvp(c.rsvp),
		carga,
		frequencia90d,
		diasDesdeResp,
		ultQualquer,
		ultResp
	};
}

function compararCandidatos(a: CandidatoPontuado, b: CandidatoPontuado): number {
	// 1. Quem respeita o intervalo mínimo sempre vem antes
	if (a.respeitaIntervalo !== b.respeitaIntervalo) {
		return a.respeitaIntervalo ? -1 : 1;
	}
	// 2. Prioridade de RSVP: confirmado > sem resposta > talvez (> nao_vou)
	if (a.pesoRsvp !== b.pesoRsvp) {
		return a.pesoRsvp - b.pesoRsvp;
	}
	// 3. Menor carga de responsabilidades nos últimos 90 dias
	if (a.carga !== b.carga) {
		return a.carga - b.carga;
	}
	// 4. Maior frequência de presença nos últimos 90 dias (membros mais assíduos)
	if (a.frequencia90d !== b.frequencia90d) {
		return b.frequencia90d - a.frequencia90d;
	}
	// 5. Quem fez esta responsabilidade há mais tempo (ou nunca fez)
	const aUltResp = a.ultResp ?? -Infinity;
	const bUltResp = b.ultResp ?? -Infinity;
	if (aUltResp !== bUltResp) {
		return aUltResp - bUltResp;
	}
	// 6. Quem fez qualquer responsabilidade há mais tempo
	if (a.ultQualquer !== b.ultQualquer) {
		return a.ultQualquer - b.ultQualquer;
	}
	// 7. Desempate determinístico por nome e id
	return a.c.nome.localeCompare(b.c.nome, 'pt-BR') || a.c.personId.localeCompare(b.c.personId);
}

function montarJustificativa(params: {
	avaliado: CandidatoPontuado;
	resp: ResponsabilidadeParaEscala;
	todosAusentes?: boolean;
	jaEscaladoNoEvento?: boolean;
}): string {
	const { avaliado, resp, todosAusentes = false, jaEscaladoNoEvento = false } = params;
	const partes: string[] = [];

	if (todosAusentes) {
		partes.push('Todos os candidatos marcaram ausência (não vou)');
	} else if (avaliado.c.rsvp === 'confirmado') {
		partes.push('Presença confirmada no encontro');
	} else if (avaliado.c.rsvp === 'talvez') {
		partes.push('Resposta "talvez" no encontro');
	}

	if (jaEscaladoNoEvento) {
		partes.push('já escalado em outra função neste encontro');
	}

	if (!avaliado.respeitaIntervalo) {
		partes.push(
			partes.length === 0
				? `Todos os candidatos atuaram nos últimos ${resp.intervaloMinimoDias} dias; sugerido por menor carga recente`
				: `atuou nos últimos ${resp.intervaloMinimoDias} dias (menor carga recente)`
		);
	} else if (avaliado.ultResp === null) {
		partes.push(
			partes.length === 0
				? 'Ainda não assumiu esta função recentemente'
				: 'sem repetições recentes nesta função'
		);
	} else {
		partes.push(
			partes.length === 0
				? `Última vez nesta função há ${avaliado.diasDesdeResp} dias`
				: `última vez nesta função há ${avaliado.diasDesdeResp} dias`
		);
	}

	if (avaliado.c.frequencia90d !== undefined && avaliado.c.frequencia90d > 0) {
		const qtd = avaliado.c.frequencia90d;
		partes.push(`${qtd} ${qtd === 1 ? 'presença' : 'presenças'} nos últimos 90 dias`);
	}

	return `${partes.join('; ')}.`;
}

/**
 * Calcula uma proposta de escala justa e determinística considerando RSVP,
 * intervalo mínimo, carga recente de responsabilidades e frequência de presença.
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

	const stats = calcularEstatisticasHistorico(dataEvento, historico);
	const ocupadosNesteEvento = new Set<string>(jaEscaladosNoEvento);

	// 1. Exclui quem marcou `nao_vou`, com fallback explícito apenas se todos marcaram ausência
	const disponiveis = candidatos.filter((c) => c.rsvp !== 'nao_vou');
	const todosAusentes = disponiveis.length === 0;
	const candidatosElegiveis = todosAusentes ? candidatos : disponiveis;

	const ordenadas = [...responsabilidades].sort(
		(a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR')
	);

	const proposta: ItemPropostaGerada[] = [];

	for (const resp of ordenadas) {
		if (responsabilidadesJaPreenchidas.has(resp.id)) continue;

		// Evita acumular duas funções no mesmo evento enquanto houver gente elegível livre
		const livres = candidatosElegiveis.filter((c) => !ocupadosNesteEvento.has(c.personId));
		const pool = livres.length > 0 ? livres : candidatosElegiveis;

		const avaliados = pool
			.map((c) => pontuarCandidato(c, resp, dataEvento, stats))
			.sort(compararCandidatos);

		const escolhido = avaliados[0];
		if (!escolhido) continue;

		ocupadosNesteEvento.add(escolhido.c.personId);
		stats.carga90Dias.set(
			escolhido.c.personId,
			(stats.carga90Dias.get(escolhido.c.personId) ?? 0) + 1
		);
		stats.ultimaGeral.set(escolhido.c.personId, dataEvento.getTime());
		stats.ultimaPorResp.set(`${escolhido.c.personId}:${resp.id}`, dataEvento.getTime());

		const justificativa = montarJustificativa({
			avaliado: escolhido,
			resp,
			todosAusentes
		});

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

/**
 * Sugere automaticamente os melhores substitutos (padrão: top 3) para uma atribuição
 * de escala, excluindo a pessoa atual e quem confirmou ausência (`nao_vou`).
 */
export function sugerirSubstitutos(params: {
	dataEvento: Date;
	responsabilidade: ResponsabilidadeParaEscala;
	candidatos: CandidatoEscala[];
	historico: RegistroHistoricoEscala[];
	pessoaAtualId: string;
	jaEscaladosNoEvento?: Set<string>;
	limite?: number;
}): SugestaoSubstituto[] {
	const {
		dataEvento,
		responsabilidade,
		candidatos,
		historico,
		pessoaAtualId,
		jaEscaladosNoEvento = new Set<string>(),
		limite = 3
	} = params;

	const maxItens = Math.max(0, limite);
	if (maxItens === 0 || candidatos.length === 0) return [];

	const elegiveis = candidatos.filter((c) => c.personId !== pessoaAtualId && c.rsvp !== 'nao_vou');
	if (elegiveis.length === 0) return [];

	const stats = calcularEstatisticasHistorico(dataEvento, historico);

	const avaliados = elegiveis
		.map((c) => ({
			pontuado: pontuarCandidato(c, responsabilidade, dataEvento, stats),
			jaEscalado: jaEscaladosNoEvento.has(c.personId)
		}))
		.sort((a, b) => {
			if (a.jaEscalado !== b.jaEscalado) {
				return a.jaEscalado ? 1 : -1;
			}
			return compararCandidatos(a.pontuado, b.pontuado);
		});

	return avaliados.slice(0, maxItens).map(({ pontuado, jaEscalado }) => ({
		personId: pontuado.c.personId,
		nome: pontuado.c.nome,
		respeitaIntervalo: pontuado.respeitaIntervalo,
		rsvp: pontuado.c.rsvp ?? null,
		carga90Dias: pontuado.carga,
		frequencia90d: pontuado.frequencia90d,
		justificativa: montarJustificativa({
			avaliado: pontuado,
			resp: responsabilidade,
			jaEscaladoNoEvento: jaEscalado
		})
	}));
}
