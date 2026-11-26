/**
 * Utilitários puros do Módulo 09 — Financeiro.
 *
 * Regra inegociável (seção 12.3): valores SEMPRE em centavos inteiros.
 * Nenhum float em cálculos de soma, subtração ou saldo.
 */

export type ResumoFinanceiro = {
	arrecadadoCents: number;
	despesasCents: number;
	saldoCents: number;
	pendentesAprovacaoCents: number;
	totalMovimentacoes: number;
};

export type MovimentacaoParaCalculo = {
	kind: 'entrada' | 'saida' | string;
	amountCents: number;
	status: string;
	reversesTransactionId?: string | null;
};

/**
 * Converte uma entrada textual em reais (ex.: "125,50", "1.200,00", "50") para
 * centavos inteiros sem usar aritmética de ponto flutuante.
 * Retorna `null` se inválido ou <= 0.
 */
export function reaisParaCentavos(valorTexto: string): number | null {
	const limpo = valorTexto
		.trim()
		.replace(/^R\$\s*/i, '')
		.replace(/\s+/g, '');
	if (!limpo) return null;

	// Aceita formato pt-BR (1.234,56) ou ponto decimal (1234.56)
	let normalizado = limpo;
	if (limpo.includes(',')) {
		normalizado = limpo.replace(/\./g, '').replace(',', '.');
	}

	if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) {
		return null;
	}

	const [reaisParte, centavosParte = ''] = normalizado.split('.');
	const reais = Number.parseInt(reaisParte ?? '0', 10);
	const centavos = Number.parseInt(centavosParte.padEnd(2, '0'), 10);

	if (!Number.isSafeInteger(reais) || !Number.isSafeInteger(centavos)) {
		return null;
	}

	const total = reais * 100 + centavos;
	return total > 0 && Number.isSafeInteger(total) ? total : null;
}

/**
 * Formata centavos inteiros para exibição pt-BR (ex.: 12550 -> "R$ 125,50", -500 -> "-R$ 5,00").
 */
export function formatarCentavos(cents: number): string {
	const inteiro = Math.trunc(cents);
	const negativo = inteiro < 0;
	const abs = Math.abs(inteiro);
	const reais = Math.floor(abs / 100);
	const resto = abs % 100;
	const reaisFmt = reais.toLocaleString('pt-BR');
	const restoFmt = String(resto).padStart(2, '0');
	return `${negativo ? '-' : ''}R$ ${reaisFmt},${restoFmt}`;
}

/**
 * Calcula o painel Arrecadado → Despesas → Saldo apenas com inteiros (RF-08.4).
 *
 * Semântica de estorno (RN-21):
 *   - Estorno de uma entrada entra como `saida` com `reversesTransactionId != null`
 *     → reduz `arrecadadoCents` (e o saldo), em vez de inflar despesas.
 *   - Estorno de uma saída entra como `entrada` com `reversesTransactionId != null`
 *     → reduz `despesasCents` (e recompõe o saldo), em vez de inflar arrecadação.
 */
export function calcularResumoFinanceiro(
	movimentacoes: MovimentacaoParaCalculo[]
): ResumoFinanceiro {
	let arrecadadoCents = 0;
	let despesasCents = 0;
	let pendentesAprovacaoCents = 0;
	let totalMovimentacoes = 0;

	for (const m of movimentacoes) {
		const valor = Math.trunc(m.amountCents);
		if (m.status === 'pendente_aprovacao') {
			pendentesAprovacaoCents += valor;
			continue;
		}
		if (m.status !== 'confirmada') continue;

		totalMovimentacoes += 1;
		const ehEstorno = Boolean(m.reversesTransactionId);

		if (m.kind === 'entrada') {
			if (ehEstorno) {
				despesasCents -= valor;
			} else {
				arrecadadoCents += valor;
			}
		} else if (m.kind === 'saida') {
			if (ehEstorno) {
				arrecadadoCents -= valor;
			} else {
				despesasCents += valor;
			}
		}
	}

	return {
		arrecadadoCents,
		despesasCents,
		saldoCents: arrecadadoCents - despesasCents,
		pendentesAprovacaoCents,
		totalMovimentacoes
	};
}

/**
 * Escapa uma célula CSV protegendo contra injeção de fórmulas (=, +, -, @, tab).
 */
export function escaparCelulaCsv(valor: string | number | null | undefined): string {
	let texto = valor == null ? '' : String(valor);
	if (/^[=+\-@\t\r]/.test(texto)) {
		texto = `'${texto}`;
	}
	if (/[";,\n\r]/.test(texto)) {
		return `"${texto.replace(/"/g, '""')}"`;
	}
	return texto;
}

export type LinhaExportacaoCsv = {
	data: string;
	tipo: string;
	categoria: string;
	descricao: string;
	metodo: string;
	valorCents: number;
	status: string;
	responsavel: string;
	grupo?: string | null;
	evento?: string | null;
	estornoDe?: string | null;
};

/**
 * Gera CSV compatível com Excel em pt-BR (separador `;` e BOM UTF-8).
 */
export function gerarCsvPrestacaoDeContas(linhas: LinhaExportacaoCsv[]): string {
	const cabecalho = [
		'Data',
		'Tipo',
		'Categoria',
		'Descrição',
		'Método',
		'Valor (R$)',
		'Status',
		'Responsável',
		'Grupo',
		'Evento',
		'Estorno de'
	];

	const corpo = linhas.map((l) => {
		const sinal = l.tipo === 'saida' ? -l.valorCents : l.valorCents;
		return [
			l.data,
			l.tipo === 'entrada' ? 'Entrada' : 'Saída',
			l.categoria,
			l.descricao,
			l.metodo,
			formatarCentavos(sinal),
			l.status,
			l.responsavel,
			l.grupo ?? '',
			l.evento ?? '',
			l.estornoDe ?? ''
		]
			.map(escaparCelulaCsv)
			.join(';');
	});

	return '\uFEFF' + [cabecalho.join(';'), ...corpo].join('\r\n');
}

/**
 * Gera resumo enxuto de prestação de contas pronto para compartilhar no WhatsApp (F5).
 * Não inclui contatos nem dados sensíveis (RN-33).
 */
export function formatarPrestacaoWhatsapp(params: {
	titulo: string;
	resumo: ResumoFinanceiro;
	periodo?: string;
}): string {
	const linhas = [
		`*Prestação de contas — ${params.titulo}*`,
		params.periodo ? `Período: ${params.periodo}` : null,
		'',
		`• Arrecadado: ${formatarCentavos(params.resumo.arrecadadoCents)}`,
		`• Despesas: ${formatarCentavos(params.resumo.despesasCents)}`,
		`• *Saldo: ${formatarCentavos(params.resumo.saldoCents)}*`,
		`(${params.resumo.totalMovimentacoes} movimentações confirmadas)`
	].filter((l) => l !== null);

	return linhas.join('\n');
}
