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

/**
 * RF-10.4 / Fluxo F4 — Motor determinístico de sugestão de divisão equilibrada de grupos.
 * Distribui por snake-draft ordenado por frequência para equilibrar tamanho e engajamento.
 */
export function sugerirDivisaoGrupos(params: {
	grupos: Array<{ id: string; name: string }>;
	pessoas: Array<{
		id: string;
		nome: string;
		birthDate?: string | null;
		frequencia: number;
		grupoAtualId: string | null;
	}>;
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

	const ordenadas = [...params.pessoas].sort(
		(a, b) => b.frequencia - a.frequencia || a.id.localeCompare(b.id)
	);

	const nGrupos = params.grupos.length;
	const alocacoes = ordenadas.map((p, idx) => {
		const rodada = Math.floor(idx / nGrupos);
		const pos = idx % nGrupos;
		const indiceGrupo = rodada % 2 === 0 ? pos : nGrupos - 1 - pos;
		const destino = params.grupos[indiceGrupo]!;
		const sanitizada = sanitizarPessoaParaIa(p, idx);
		const mudou = p.grupoAtualId !== destino.id;

		return {
			personId: p.id,
			rotulo: sanitizada.rotulo,
			menor: sanitizada.menor,
			grupoAtualId: p.grupoAtualId,
			grupoSugeridoId: destino.id,
			grupoSugeridoNome: destino.name,
			mudou,
			justificativa: mudou
				? `Equilíbrio de tamanho e frequência (${p.frequencia} presenças registradas).`
				: `Mantido em ${destino.name} para preservar continuidade com equilíbrio.`
		};
	});

	const transferencias = alocacoes.filter((a) => a.mudou).length;
	return {
		resumo: `Proposta equilibrada para ${alocacoes.length} pessoas em ${nGrupos} grupos (${transferencias} transferências sugeridas). Revise antes de aplicar.`,
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
