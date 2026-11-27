/**
 * Motor assistivo de IA do Eagles App (M10 — RF-10.1 a RF-10.7, RN-26, RN-27).
 *
 * Princípios de arquitetura:
 *   1. Determinístico por padrão (zero custo, zero dependência externa obrigatória).
 *   2. Pseudonimização obrigatória de menores (<18 anos — seção 12.6): nunca
 *      envia nome nem contato de menor no snapshot de entrada da IA.
 *   3. Toda sugestão de alteração organizacional (ex.: divisão de grupos) sai
 *      como proposta pendente e exige confirmação humana explícita (RN-27).
 */

import { formatarCentavos, type ResumoFinanceiro } from '$server/financeiro/calculos';

/** Calcula se uma data de nascimento (YYYY-MM-DD) corresponde a menor de 18 anos. */
export function ehMenorDeIdade(
	birthDate: string | null | undefined,
	referencia = new Date()
): boolean {
	if (!birthDate) return false;
	const partes = birthDate.split('-').map((n) => Number.parseInt(n, 10));
	if (partes.length !== 3 || partes.some((n) => Number.isNaN(n))) return false;
	const [ano, mes, dia] = partes as [number, number, number];
	let idade = referencia.getFullYear() - ano;
	const m = referencia.getMonth() + 1 - mes;
	if (m < 0 || (m === 0 && referencia.getDate() < dia)) {
		idade -= 1;
	}
	return idade < 18;
}

/**
 * Pseudonimiza pessoas menores de idade antes de montar qualquer snapshot/texto
 * para o pipeline de IA (seção 12.6 — LGPD art. 14).
 */
export function sanitizarPessoaParaIa(
	pessoa: { id: string; nome: string; birthDate?: string | null },
	indice: number,
	referencia = new Date()
): { id: string; rotulo: string; menor: boolean } {
	const menor = ehMenorDeIdade(pessoa.birthDate, referencia);
	return {
		id: pessoa.id,
		rotulo: menor ? `Participante P${indice + 1}` : pessoa.nome,
		menor
	};
}

/**
 * RF-10.1 — Redação e adaptação de avisos para a comunidade (direto, acolhedor, sem clichês).
 */
export function redigirAviso(params: {
	tema: string;
	detalhes: string;
	tom: 'acolhedor' | 'objetivo' | 'lembrete';
	publico?: string;
}): { tituloSugerido: string; textoApp: string; textoWhatsapp: string } {
	const tema = params.tema.trim();
	const detalhes = params.detalhes.trim();
	const publico = params.publico?.trim() || 'pessoal';

	let abertura = `Oi, ${publico}!`;
	let fechamento = 'Qualquer dúvida, fale com seu conselheiro.';

	if (params.tom === 'objetivo') {
		abertura = `Aviso importante para ${publico}:`;
		fechamento = 'Confirme as informações no Eagles App.';
	} else if (params.tom === 'lembrete') {
		abertura = `Passando para lembrar (${publico}):`;
		fechamento = 'Confirme sua presença em um toque no Eagles App.';
	}

	const textoApp = `${abertura}\n\n${detalhes}\n\n${fechamento}`;
	const textoWhatsapp = `*${tema}*\n\n${abertura}\n${detalhes}\n\n${fechamento}`;

	return {
		tituloSugerido: tema,
		textoApp,
		textoWhatsapp
	};
}

/**
 * RF-10.7 — Resumo de ata de reunião com extração objetiva de tarefas e decisões.
 */
export function resumirAtaComTarefas(textoAta: string): {
	resumo: string;
	decisoes: string[];
	tarefas: Array<{ descricao: string; responsavelSugerido: string | null }>;
} {
	const linhas = textoAta
		.split(/\r?\n/)
		.map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
		.filter((l) => l.length >= 4);

	const decisoes: string[] = [];
	const tarefas: Array<{ descricao: string; responsavelSugerido: string | null }> = [];

	const reDecisao = /\b(decidido|aprovado|definido|combinado|ficou definido|confirmado)\b/i;
	const reTarefa =
		/\b(fazer|preparar|comprar|enviar|organizar|avisar|confirmar|levar|verificar|atualizar|criar|agendar|ficou com|responsável)\b/i;

	for (const linha of linhas) {
		if (reDecisao.test(linha)) {
			decisoes.push(linha);
		}
		if (reTarefa.test(linha)) {
			// Tenta detectar padrão "Nome: tarefa" ou "(Nome)"
			const matchPrefixo = linha.match(
				/^([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)?)\s*[:—-]\s*(.+)$/
			);
			if (matchPrefixo) {
				tarefas.push({
					responsavelSugerido: matchPrefixo[1]!.trim(),
					descricao: matchPrefixo[2]!.trim()
				});
			} else {
				const matchParenteses = linha.match(/\(([^)]{2,40})\)\s*$/);
				tarefas.push({
					responsavelSugerido: matchParenteses ? matchParenteses[1]!.trim() : null,
					descricao: matchParenteses ? linha.replace(/\([^)]+\)\s*$/, '').trim() : linha
				});
			}
		}
	}

	const resumo =
		linhas.length <= 3
			? linhas.join(' ')
			: `${linhas.slice(0, 3).join(' ')} (${linhas.length} pontos registrados; ${decisoes.length} decisões e ${tarefas.length} tarefas identificadas).`;

	return { resumo, decisoes, tarefas };
}

export type CriteriosDivisaoGrupos = {
	agruparVinculosFamiliares?: boolean;
	equilibrarFaixaEtaria?: boolean;
	equilibrarFrequencia?: boolean;
};

export type PessoaParaDivisao = {
	id: string;
	nome: string;
	birthDate?: string | null;
	frequencia: number;
	grupoAtualId: string | null;
	relationshipStatus?: string | null;
	siblings?: string | null;
	familyTies?: string | null;
};

/** Tags genéricas que não representam um vínculo familiar compartilhado. */
const TAGS_FAMILIA_IGNORADAS = new Set([
	'nenhum',
	'nenhuma',
	'nao possui',
	'nao tem',
	'nao ha',
	'sem vinculo',
	'sem vinculos',
	'outro',
	'outros'
]);

/** Normaliza texto removendo acentos, pontuação e espaços extras para comparação segura. */
function normalizarTexto(texto: string | null | undefined): string {
	if (!texto) return '';
	return texto
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Calcula idade completa em anos a partir de `YYYY-MM-DD`, ou `null` se ausente/inválida. */
export function calcularIdadeAnos(
	birthDate: string | null | undefined,
	referencia = new Date()
): number | null {
	if (!birthDate) return null;
	const partes = birthDate.split('-').map((n) => Number.parseInt(n, 10));
	if (partes.length !== 3 || partes.some((n) => Number.isNaN(n))) return null;
	const [ano, mes, dia] = partes as [number, number, number];
	let idade = referencia.getFullYear() - ano;
	const m = referencia.getMonth() + 1 - mes;
	if (m < 0 || (m === 0 && referencia.getDate() < dia)) {
		idade -= 1;
	}
	return idade >= 0 ? idade : null;
}

/**
 * RF-10.4 / Fluxo F4 — Motor determinístico de sugestão de divisão equilibrada de grupos.
 * Considera vínculos familiares/casais (alocação atômica), equilíbrio de frequência,
 * equilíbrio de faixa etária e pseudonimização obrigatória de menores (ADR 0003).
 */
export function sugerirDivisaoGrupos(params: {
	grupos: Array<{ id: string; name: string }>;
	pessoas: PessoaParaDivisao[];
	criterios?: CriteriosDivisaoGrupos;
	referencia?: Date;
}): {
	resumo: string;
	alocacoes: Array<{
		personId: string;
		rotulo: string;
		menor: boolean;
		grupoAtualId: string | null;
		grupoSugeridoId: string;
		grupoSugeridoNome: string;
		mudou: boolean;
		justificativa: string;
	}>;
} {
	if (params.grupos.length === 0 || params.pessoas.length === 0) {
		return {
			resumo: 'Não há grupos ou pessoas suficientes para gerar uma proposta de divisão.',
			alocacoes: []
		};
	}

	const referencia = params.referencia ?? new Date();
	const usarVinculos = params.criterios?.agruparVinculosFamiliares !== false;
	const usarIdade = params.criterios?.equilibrarFaixaEtaria !== false;
	const usarFrequencia = params.criterios?.equilibrarFrequencia !== false;

	// Ordenação base determinística para índices de pseudonimização consistentes
	const baseOrdenada = [...params.pessoas].sort(
		(a, b) => b.frequencia - a.frequencia || a.id.localeCompare(b.id)
	);

	type PessoaInterna = {
		idx: number;
		pessoa: PessoaParaDivisao;
		sanitizada: { id: string; rotulo: string; menor: boolean };
		idade: number | null;
		nomeNorm: string;
		tokensNome: string[];
		primeiroUltimo: string | null;
		siblingsNorm: string;
		familyTiesNorm: string;
		relationshipNorm: string;
	};

	const internas: PessoaInterna[] = baseOrdenada.map((p, idx) => {
		const nomeNorm = normalizarTexto(p.nome);
		const tokensNome = nomeNorm.split(' ').filter(Boolean);
		const primeiroUltimo =
			tokensNome.length >= 2 ? `${tokensNome[0]} ${tokensNome[tokensNome.length - 1]}` : null;
		return {
			idx,
			pessoa: p,
			sanitizada: sanitizarPessoaParaIa(p, idx, referencia),
			idade: calcularIdadeAnos(p.birthDate, referencia),
			nomeNorm,
			tokensNome,
			primeiroUltimo,
			siblingsNorm: normalizarTexto(p.siblings),
			familyTiesNorm: normalizarTexto(p.familyTies),
			relationshipNorm: normalizarTexto(p.relationshipStatus)
		};
	});

	// Contagem de ocorrências para garantir que first+last e nomes simples sejam distintos
	const contagemNomeCompleto = new Map<string, number>();
	const contagemPrimeiroUltimo = new Map<string, number>();
	for (const item of internas) {
		if (item.nomeNorm) {
			contagemNomeCompleto.set(item.nomeNorm, (contagemNomeCompleto.get(item.nomeNorm) ?? 0) + 1);
		}
		if (item.primeiroUltimo) {
			contagemPrimeiroUltimo.set(
				item.primeiroUltimo,
				(contagemPrimeiroUltimo.get(item.primeiroUltimo) ?? 0) + 1
			);
		}
	}

	// Union-Find para montar clusters conectados de vínculos familiares/casais
	const pai = internas.map((_, i) => i);
	const find = (i: number): number => {
		let r = i;
		while (pai[r] !== r) r = pai[r]!;
		let cur = i;
		while (pai[cur] !== r) {
			const next = pai[cur]!;
			pai[cur] = r;
			cur = next;
		}
		return r;
	};
	const union = (a: number, b: number) => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) {
			if (ra < rb) pai[rb] = ra;
			else pai[ra] = rb;
		}
	};

	const contemTermo = (textoNorm: string, termo: string): boolean => {
		if (!textoNorm || !termo) return false;
		return ` ${textoNorm} `.includes(` ${termo} `);
	};

	if (usarVinculos) {
		// 1. Tag de `familyTies` idêntica não-vazia (len >= 4)
		const porTagFamilia = new Map<string, number[]>();
		for (let i = 0; i < internas.length; i++) {
			const tag = internas[i]!.familyTiesNorm;
			if (tag.length >= 4 && !TAGS_FAMILIA_IGNORADAS.has(tag)) {
				const lista = porTagFamilia.get(tag) ?? [];
				lista.push(i);
				porTagFamilia.set(tag, lista);
			}
		}
		for (const indices of porTagFamilia.values()) {
			for (let k = 1; k < indices.length; k++) {
				union(indices[0]!, indices[k]!);
			}
		}

		// 2. Menção ao nome completo (ou primeiro+último distinto) em `siblings` ou `familyTies`
		for (let i = 0; i < internas.length; i++) {
			const a = internas[i]!;
			const camposTexto = [a.siblingsNorm, a.familyTiesNorm].filter(Boolean);
			const temTextoRelacionamento = a.relationshipNorm.length > 0;
			if (camposTexto.length === 0 && !temTextoRelacionamento) continue;

			for (let j = 0; j < internas.length; j++) {
				if (i === j) continue;
				const b = internas[j]!;
				if (!b.nomeNorm) continue;

				const nomeCompletoElegivel =
					b.tokensNome.length >= 2
						? b.nomeNorm.length >= 4
						: b.nomeNorm.length >= 3 && (contagemNomeCompleto.get(b.nomeNorm) ?? 0) === 1;

				const primeiroUltimoElegivel =
					b.primeiroUltimo !== null &&
					b.primeiroUltimo !== b.nomeNorm &&
					(contagemPrimeiroUltimo.get(b.primeiroUltimo) ?? 0) === 1;

				let mencionou = false;
				for (const texto of camposTexto) {
					if (
						(nomeCompletoElegivel && contemTermo(texto, b.nomeNorm)) ||
						(primeiroUltimoElegivel && contemTermo(texto, b.primeiroUltimo!))
					) {
						mencionou = true;
						break;
					}
				}

				// Também reconhece menção explícita a nome composto em `relationshipStatus` (ex.: "Casado com Ana Silva")
				if (!mencionou && temTextoRelacionamento && b.tokensNome.length >= 2) {
					if (
						(nomeCompletoElegivel && contemTermo(a.relationshipNorm, b.nomeNorm)) ||
						(primeiroUltimoElegivel && contemTermo(a.relationshipNorm, b.primeiroUltimo!))
					) {
						mencionou = true;
					}
				}

				if (mencionou) {
					union(i, j);
				}
			}
		}
	}

	// Agrupa membros nos respectivos clusters
	const mapaClusters = new Map<number, PessoaInterna[]>();
	for (let i = 0; i < internas.length; i++) {
		const raiz = find(i);
		const lista = mapaClusters.get(raiz) ?? [];
		lista.push(internas[i]!);
		mapaClusters.set(raiz, lista);
	}

	type ClusterDivisao = {
		membros: PessoaInterna[];
		tamanho: number;
		somaFreq: number;
		mediaFreq: number;
		somaIdade: number;
		qtdIdade: number;
		mediaIdade: number | null;
		chave: string;
	};

	const clusters: ClusterDivisao[] = [...mapaClusters.values()].map((membros) => {
		const ordenados = [...membros].sort((a, b) => a.idx - b.idx);
		let somaFreq = 0;
		let somaIdade = 0;
		let qtdIdade = 0;
		for (const m of ordenados) {
			somaFreq += m.pessoa.frequencia;
			if (m.idade !== null) {
				somaIdade += m.idade;
				qtdIdade += 1;
			}
		}
		return {
			membros: ordenados,
			tamanho: ordenados.length,
			somaFreq,
			mediaFreq: somaFreq / ordenados.length,
			somaIdade,
			qtdIdade,
			mediaIdade: qtdIdade > 0 ? somaIdade / qtdIdade : null,
			chave: ordenados[0]!.pessoa.id
		};
	});

	// Ordena clusters maiores primeiro (alocação atômica preserva equilíbrio de tamanho),
	// depois por frequência (ou idade quando frequência desligada) decrescente e chave determinística.
	clusters.sort((a, b) => {
		if (b.tamanho !== a.tamanho) return b.tamanho - a.tamanho;
		if (usarFrequencia && b.mediaFreq !== a.mediaFreq) return b.mediaFreq - a.mediaFreq;
		if (usarIdade) {
			const aId = a.mediaIdade ?? -1;
			const bId = b.mediaIdade ?? -1;
			if (bId !== aId) return bId - aId;
		}
		return a.chave.localeCompare(b.chave);
	});

	// Alvos globais e escalas para balanceamento multi-critério
	const totalPessoas = internas.length;
	let somaFreqTotal = 0;
	let minFreq = Infinity;
	let maxFreq = -Infinity;
	let somaIdadeTotal = 0;
	let qtdIdadeTotal = 0;
	let minIdade = Infinity;
	let maxIdade = -Infinity;

	for (const m of internas) {
		somaFreqTotal += m.pessoa.frequencia;
		if (m.pessoa.frequencia < minFreq) minFreq = m.pessoa.frequencia;
		if (m.pessoa.frequencia > maxFreq) maxFreq = m.pessoa.frequencia;
		if (m.idade !== null) {
			somaIdadeTotal += m.idade;
			qtdIdadeTotal += 1;
			if (m.idade < minIdade) minIdade = m.idade;
			if (m.idade > maxIdade) maxIdade = m.idade;
		}
	}

	const mediaFreqAlvo = somaFreqTotal / totalPessoas;
	const escalaFreq = Math.max(1, maxFreq - minFreq);
	const temIdadeNoConjunto = usarIdade && qtdIdadeTotal > 0;
	const mediaIdadeAlvo = qtdIdadeTotal > 0 ? somaIdadeTotal / qtdIdadeTotal : null;
	const escalaIdade = qtdIdadeTotal > 0 ? Math.max(1, maxIdade - minIdade) : 1;

	const nGrupos = params.grupos.length;
	const estados = params.grupos.map((g, idx) => ({
		idx,
		grupo: g,
		qtd: 0,
		somaFreq: 0,
		somaIdade: 0,
		qtdIdade: 0
	}));

	const destinoPorPersonId = new Map<
		string,
		{ grupo: { id: string; name: string }; emCluster: boolean }
	>();
	let totalClustersFamiliares = 0;

	for (const cluster of clusters) {
		if (cluster.tamanho > 1) totalClustersFamiliares += 1;

		const menorQtd = Math.min(...estados.map((e) => e.qtd));
		const candidatosGrupo = estados.filter((e) => e.qtd === menorQtd);

		let melhor = candidatosGrupo[0]!;
		let melhorScore = Infinity;
		let melhorContinuidade = -1;

		for (const est of candidatosGrupo) {
			const novaQtd = est.qtd + cluster.tamanho;
			let score = 0;

			if (usarFrequencia) {
				const novaMediaFreq = (est.somaFreq + cluster.somaFreq) / novaQtd;
				score += Math.abs(novaMediaFreq - mediaFreqAlvo) / escalaFreq;
			}

			if (temIdadeNoConjunto && mediaIdadeAlvo !== null) {
				const novaQtdIdade = est.qtdIdade + cluster.qtdIdade;
				if (novaQtdIdade > 0) {
					const novaMediaIdade = (est.somaIdade + cluster.somaIdade) / novaQtdIdade;
					score += Math.abs(novaMediaIdade - mediaIdadeAlvo) / escalaIdade;
				}
			}

			const continuidade = cluster.membros.filter(
				(m) => m.pessoa.grupoAtualId === est.grupo.id
			).length;

			const epsilon = 1e-9;
			if (
				score < melhorScore - epsilon ||
				(Math.abs(score - melhorScore) <= epsilon &&
					(continuidade > melhorContinuidade ||
						(continuidade === melhorContinuidade &&
							(est.somaFreq < melhor.somaFreq ||
								(est.somaFreq === melhor.somaFreq && est.idx < melhor.idx)))))
			) {
				melhor = est;
				melhorScore = score;
				melhorContinuidade = continuidade;
			}
		}

		melhor.qtd += cluster.tamanho;
		melhor.somaFreq += cluster.somaFreq;
		melhor.somaIdade += cluster.somaIdade;
		melhor.qtdIdade += cluster.qtdIdade;

		for (const m of cluster.membros) {
			destinoPorPersonId.set(m.pessoa.id, {
				grupo: melhor.grupo,
				emCluster: cluster.tamanho > 1
			});
		}
	}

	const alocacoes = internas.map((item) => {
		const p = item.pessoa;
		const aloc = destinoPorPersonId.get(p.id)!;
		const destino = aloc.grupo;
		const mudou = p.grupoAtualId !== destino.id;

		const equilibrioPartes: string[] = [];
		if (usarFrequencia) equilibrioPartes.push('frequência');
		if (temIdadeNoConjunto && item.idade !== null) equilibrioPartes.push('faixa etária');
		const textoEquilibrio =
			equilibrioPartes.length === 0
				? 'tamanho'
				: equilibrioPartes.length === 1
					? equilibrioPartes[0]!
					: `${equilibrioPartes[0]} e ${equilibrioPartes[1]}`;

		let justificativa: string;
		if (aloc.emCluster) {
			justificativa = `Mantido junto ao vínculo familiar; equilíbrio de ${textoEquilibrio} (${p.frequencia} presenças registradas).`;
		} else if (mudou) {
			justificativa = `Equilíbrio de tamanho e ${textoEquilibrio} (${p.frequencia} presenças registradas).`;
		} else {
			justificativa = `Mantido em ${destino.name} para preservar continuidade com equilíbrio de ${textoEquilibrio}.`;
		}

		return {
			personId: p.id,
			rotulo: item.sanitizada.rotulo,
			menor: item.sanitizada.menor,
			grupoAtualId: p.grupoAtualId,
			grupoSugeridoId: destino.id,
			grupoSugeridoNome: destino.name,
			mudou,
			justificativa
		};
	});

	const transferencias = alocacoes.filter((a) => a.mudou).length;
	const criteriosAplicados: string[] = [];
	if (usarFrequencia) criteriosAplicados.push('frequência');
	if (usarVinculos) {
		criteriosAplicados.push(
			totalClustersFamiliares > 0
				? `vínculos familiares (${totalClustersFamiliares} ${totalClustersFamiliares === 1 ? 'núcleo mantido junto' : 'núcleos mantidos juntos'})`
				: 'vínculos familiares'
		);
	}
	if (temIdadeNoConjunto) criteriosAplicados.push('faixa etária');

	const sufixoCriterios =
		criteriosAplicados.length > 0 ? `; critérios: ${criteriosAplicados.join(', ')}` : '';

	return {
		resumo: `Proposta equilibrada para ${alocacoes.length} pessoas em ${nGrupos} grupos (${transferencias} transferências sugeridas${sufixoCriterios}). Revise antes de aplicar.`,
		alocacoes
	};
}

/**
 * RF-10.5 — Destaca pessoas que podem precisar de cuidado pastoral (sem ranking público).
 */
export function detectarSinaisDeAtencao(params: {
	pessoas: Array<{
		id: string;
		nome: string;
		birthDate?: string | null;
		status: string;
		presencasUltimos60Dias: number;
	}>;
}): {
	resumo: string;
	sinais: Array<{
		personId: string;
		rotulo: string;
		menor: boolean;
		tipo: 'visitante_pronto' | 'afastamento';
		mensagem: string;
	}>;
} {
	const sinais: Array<{
		personId: string;
		rotulo: string;
		menor: boolean;
		tipo: 'visitante_pronto' | 'afastamento';
		mensagem: string;
	}> = [];

	params.pessoas.forEach((p, idx) => {
		const s = sanitizarPessoaParaIa(p, idx);
		// Fluxo F1: visitante com 3+ presenças em 60 dias → sinaliza convite (nunca promove sozinho)
		if (p.status === 'visitante' && p.presencasUltimos60Dias >= 3) {
			sinais.push({
				personId: p.id,
				rotulo: s.rotulo,
				menor: s.menor,
				tipo: 'visitante_pronto',
				mensagem: `${s.rotulo} já participou ${p.presencasUltimos60Dias} vezes nos últimos 60 dias — vale conversar sobre convidá-lo para o grupo.`
			});
		} else if (
			(p.status === 'membro' || p.status === 'recorrente') &&
			p.presencasUltimos60Dias === 0
		) {
			sinais.push({
				personId: p.id,
				rotulo: s.rotulo,
				menor: s.menor,
				tipo: 'afastamento',
				mensagem: `${s.rotulo} não tem presença registrada nos últimos 60 dias — vale mandar uma mensagem para saber como está.`
			});
		}
	});

	return {
		resumo:
			sinais.length === 0
				? 'Nenhum sinal de atenção identificado nos últimos 60 dias.'
				: `${sinais.length} ${sinais.length === 1 ? 'pessoa pode' : 'pessoas podem'} precisar de atenção pastoral.`,
		sinais
	};
}

/**
 * RF-10.2 — Resumo em linguagem natural do livro-caixa (exige `ai.use_finance` + `finance.view_all`).
 */
export function resumirFinanceiroEmTexto(params: {
	resumo: ResumoFinanceiro;
	topCategoriasSaida: Array<{ nome: string; totalCents: number }>;
}): { resumo: string; destaques: string[] } {
	const { resumo, topCategoriasSaida } = params;
	const situacao =
		resumo.saldoCents > 0 ? 'positivo' : resumo.saldoCents === 0 ? 'zerado' : 'negativo (atenção)';

	const destaques = [
		`Arrecadado: ${formatarCentavos(resumo.arrecadadoCents)}`,
		`Despesas: ${formatarCentavos(resumo.despesasCents)}`,
		`Saldo atual: ${formatarCentavos(resumo.saldoCents)} (${situacao})`
	];

	if (resumo.pendentesAprovacaoCents > 0) {
		destaques.push(
			`Despesas aguardando aprovação: ${formatarCentavos(resumo.pendentesAprovacaoCents)}`
		);
	}

	if (topCategoriasSaida.length > 0) {
		const principal = topCategoriasSaida[0]!;
		destaques.push(
			`Maior categoria de despesa: ${principal.nome} (${formatarCentavos(principal.totalCents)}).`
		);
	}

	return {
		resumo: `Com ${resumo.totalMovimentacoes} movimentações confirmadas, o caixa está ${situacao} em ${formatarCentavos(resumo.saldoCents)}.`,
		destaques
	};
}
