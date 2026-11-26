import { describe, expect, it } from 'vitest';
import {
	detectarSinaisDeAtencao,
	ehMenorDeIdade,
	redigirAviso,
	resumirAtaComTarefas,
	resumirFinanceiroEmTexto,
	sanitizarPessoaParaIa,
	sugerirDivisaoGrupos
} from '../../src/lib/server/ia/motor';

describe('M10 — Motor assistivo de IA (puro)', () => {
	const ref = new Date('2026-11-26T12:00:00Z');

	it('identifica menor de 18 anos e pseudonimiza antes de expor para IA (seção 12.6)', () => {
		expect(ehMenorDeIdade('2010-05-10', ref)).toBe(true);
		expect(ehMenorDeIdade('2008-11-27', ref)).toBe(true); // faz 18 amanhã
		expect(ehMenorDeIdade('2008-11-26', ref)).toBe(false); // fez 18 hoje
		expect(ehMenorDeIdade('1998-03-14', ref)).toBe(false);
		expect(ehMenorDeIdade(null, ref)).toBe(false);

		const menor = sanitizarPessoaParaIa(
			{ id: 'p-menor', nome: 'Lucas Menor', birthDate: '2011-08-01' },
			0,
			ref
		);
		expect(menor.menor).toBe(true);
		expect(menor.rotulo).toBe('Participante P1');
		expect(menor.rotulo).not.toContain('Lucas');

		const adulto = sanitizarPessoaParaIa(
			{ id: 'p-adulto', nome: 'Ana Adulta', birthDate: '1999-01-10' },
			1,
			ref
		);
		expect(adulto.menor).toBe(false);
		expect(adulto.rotulo).toBe('Ana Adulta');
	});

	it('redige aviso com versões para app e WhatsApp conforme o tom (RF-10.1)', () => {
		const res = redigirAviso({
			tema: 'Retiro de fim de ano',
			detalhes: 'Será nos dias 12 e 13 de dezembro no sítio.',
			tom: 'lembrete',
			publico: 'PG Azul'
		});
		expect(res.tituloSugerido).toBe('Retiro de fim de ano');
		expect(res.textoApp).toContain('PG Azul');
		expect(res.textoApp).toContain('12 e 13 de dezembro');
		expect(res.textoWhatsapp).toContain('*Retiro de fim de ano*');
	});

	it('resume ata e extrai decisões e tarefas com responsável sugerido (RF-10.7)', () => {
		const ata = [
			'- Ficou definido que o encontro geral será dia 20.',
			'- Ana Silva: confirmar a reserva do salão.',
			'- Comprar café e descartáveis para o lanche (João)',
			'- Aprovado orçamento do retiro.'
		].join('\n');

		const res = resumirAtaComTarefas(ata);
		expect(res.decisoes.length).toBe(2);
		expect(res.tarefas).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ responsavelSugerido: 'Ana Silva' }),
				expect.objectContaining({ responsavelSugerido: 'João' })
			])
		);
		expect(res.resumo).toContain('2 decisões');
	});

	it('sugere divisão equilibrada por snake-draft e pseudonimiza menor (RF-10.4)', () => {
		const res = sugerirDivisaoGrupos({
			grupos: [
				{ id: 'g1', name: 'PG Azul' },
				{ id: 'g2', name: 'PG Verde' }
			],
			pessoas: [
				{ id: 'p1', nome: 'Ana', birthDate: '1998-01-01', frequencia: 10, grupoAtualId: 'g1' },
				{ id: 'p2', nome: 'Bia', birthDate: '1999-01-01', frequencia: 8, grupoAtualId: 'g1' },
				{ id: 'p3', nome: 'Caio Menor', birthDate: '2012-06-10', frequencia: 6, grupoAtualId: 'g1' },
				{ id: 'p4', nome: 'Davi', birthDate: '2000-01-01', frequencia: 2, grupoAtualId: null }
			]
		});

		expect(res.alocacoes).toHaveLength(4);
		const qtdG1 = res.alocacoes.filter((a) => a.grupoSugeridoId === 'g1').length;
		const qtdG2 = res.alocacoes.filter((a) => a.grupoSugeridoId === 'g2').length;
		expect(qtdG1).toBe(2);
		expect(qtdG2).toBe(2);

		const alocMenor = res.alocacoes.find((a) => a.personId === 'p3')!;
		expect(alocMenor.menor).toBe(true);
		expect(alocMenor.rotulo).toMatch(/^Participante P\d+$/);
		expect(alocMenor.rotulo).not.toContain('Caio');
	});

	it('detecta sinais de atenção (visitante pronto e membro afastado) (RF-10.5)', () => {
		const res = detectarSinaisDeAtencao({
			pessoas: [
				{ id: 'v1', nome: 'Visitante Fiel', status: 'visitante', presencasUltimos60Dias: 4 },
				{ id: 'm1', nome: 'Membro Sumido', status: 'membro', presencasUltimos60Dias: 0 },
				{ id: 'm2', nome: 'Membro Ativo', status: 'membro', presencasUltimos60Dias: 5 }
			]
		});

		expect(res.sinais).toHaveLength(2);
		expect(res.sinais.some((s) => s.personId === 'v1' && s.tipo === 'visitante_pronto')).toBe(true);
		expect(res.sinais.some((s) => s.personId === 'm1' && s.tipo === 'afastamento')).toBe(true);
		expect(res.sinais.some((s) => s.personId === 'm2')).toBe(false);
	});

	it('gera resumo financeiro claro em linguagem natural (RF-10.2)', () => {
		const res = resumirFinanceiroEmTexto({
			resumo: {
				arrecadadoCents: 100000,
				despesasCents: 35000,
				saldoCents: 65000,
				pendentesAprovacaoCents: 12000,
				totalMovimentacoes: 5
			},
			topCategoriasSaida: [{ nome: 'Lanche', totalCents: 20000 }]
		});

		expect(res.resumo).toContain('positivo');
		expect(res.destaques.some((d) => d.includes('Lanche'))).toBe(true);
		expect(res.destaques.some((d) => d.includes('aguardando aprovação'))).toBe(true);
	});
});
