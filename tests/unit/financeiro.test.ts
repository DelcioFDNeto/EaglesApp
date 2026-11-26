import { describe, expect, it } from 'vitest';
import {
	calcularResumoFinanceiro,
	escaparCelulaCsv,
	formatarCentavos,
	formatarPrestacaoWhatsapp,
	gerarCsvPrestacaoDeContas,
	reaisParaCentavos
} from '../../src/lib/server/financeiro/calculos';

describe('M09 — Cálculos financeiros em centavos inteiros e exportação', () => {
	it('converte reais em centavos inteiros sem float', () => {
		expect(reaisParaCentavos('1.250,50')).toBe(125050);
		expect(reaisParaCentavos('R$ 50,00')).toBe(5000);
		expect(reaisParaCentavos('0,01')).toBe(1);
		expect(reaisParaCentavos('19.99')).toBe(1999);
		expect(reaisParaCentavos('120')).toBe(12000);
		expect(reaisParaCentavos('0')).toBeNull();
		expect(reaisParaCentavos('-10,00')).toBeNull();
		expect(reaisParaCentavos('abc')).toBeNull();
	});

	it('formata centavos inteiros corretamente em pt-BR', () => {
		expect(formatarCentavos(0)).toBe('R$ 0,00');
		expect(formatarCentavos(125050)).toBe('R$ 1.250,50');
		expect(formatarCentavos(-755)).toBe('-R$ 7,55');
	});

	it('calcula Arrecadado → Despesas → Saldo tratando estornos e pendências (RN-21/RN-23)', () => {
		const resumo = calcularResumoFinanceiro([
			{ kind: 'entrada', amountCents: 10000, status: 'confirmada' },
			{ kind: 'entrada', amountCents: 5000, status: 'confirmada' },
			{ kind: 'saida', amountCents: 3000, status: 'confirmada' },
			// Estorno da entrada de 5000 (entra como saída vinculada → reduz arrecadado)
			{
				kind: 'saida',
				amountCents: 5000,
				status: 'confirmada',
				reversesTransactionId: 'tx-original'
			},
			// Despesa pendente não altera saldo
			{ kind: 'saida', amountCents: 2500, status: 'pendente_aprovacao' },
			// Despesa rejeitada é ignorada
			{ kind: 'saida', amountCents: 9999, status: 'rejeitada' }
		]);

		expect(resumo.arrecadadoCents).toBe(10000);
		expect(resumo.despesasCents).toBe(3000);
		expect(resumo.saldoCents).toBe(7000);
		expect(resumo.pendentesAprovacaoCents).toBe(2500);
		expect(resumo.totalMovimentacoes).toBe(4);
	});

	it('protege células CSV contra injeção de fórmulas e gera resumo WhatsApp', () => {
		expect(escaparCelulaCsv('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
		expect(escaparCelulaCsv('Lanche; PG Azul')).toBe('"Lanche; PG Azul"');

		const csv = gerarCsvPrestacaoDeContas([
			{
				data: '26/11/2026',
				tipo: 'entrada',
				categoria: 'Contribuição',
				descricao: 'Mensalidade',
				metodo: 'pix',
				valorCents: 5000,
				status: 'confirmada',
				responsavel: 'Ana'
			}
		]);
		expect(csv.startsWith('\uFEFFData;Tipo;')).toBe(true);
		expect(csv).toContain('R$ 50,00');

		const texto = formatarPrestacaoWhatsapp({
			titulo: 'Acampamento',
			resumo: {
				arrecadadoCents: 50000,
				despesasCents: 32000,
				saldoCents: 18000,
				pendentesAprovacaoCents: 0,
				totalMovimentacoes: 5
			}
		});
		expect(texto).toContain('*Prestação de contas — Acampamento*');
		expect(texto).toContain('R$ 180,00');
	});
});
