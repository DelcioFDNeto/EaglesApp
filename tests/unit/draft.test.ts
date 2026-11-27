import { describe, expect, it } from 'vitest';
import {
	atributosCompletos,
	calcularEquilibrioTimes,
	calcularMediasTime,
	faixaNota,
	formatarAltura,
	formatarPeso,
	mediaAtributos,
	mensagemWhatsAppDraft,
	parsePesoTexto
} from '../../src/lib/shared/atributos';
import { balancearDraft, type ParticipanteDraft } from '../../src/lib/server/draft/balancear';

describe('utilitários de atributos e Draft', () => {
	it('calcula média e completude corretamente com notas parciais ou vazias', () => {
		expect(
			mediaAtributos({ fisico: null, biblico: null, mental: null, coordenacaoMotora: null })
		).toBeNull();
		expect(mediaAtributos({ fisico: 8, biblico: 7, mental: 9, coordenacaoMotora: 8 })).toBe(8);
		expect(mediaAtributos({ fisico: 9, biblico: null, mental: 6, coordenacaoMotora: null })).toBe(
			7.5
		);
		expect(atributosCompletos({ fisico: 8, biblico: 7, mental: 9, coordenacaoMotora: 8 })).toBe(
			true
		);
		expect(atributosCompletos({ fisico: 8, biblico: null, mental: 9, coordenacaoMotora: 8 })).toBe(
			false
		);
	});

	it('formata faixas, altura e peso em português', () => {
		expect(faixaNota(null)).toBe('Não avaliado');
		expect(faixaNota(2)).toBe('Inicial');
		expect(faixaNota(4)).toBe('Em desenvolvimento');
		expect(faixaNota(6)).toBe('Sólido');
		expect(faixaNota(8)).toBe('Forte');
		expect(faixaNota(10)).toBe('Destaque');

		expect(formatarAltura(178)).toBe('1,78 m');
		expect(formatarAltura(null)).toBeNull();
		expect(formatarPeso(72.5)).toBe('72,5 kg');
		expect(formatarPeso(80)).toBe('80 kg');
		expect(parsePesoTexto('72,5')).toBe(72.5);
		expect(parsePesoTexto('72.5')).toBe(72.5);
		expect(parsePesoTexto('')).toBeNull();
		expect(Number.isNaN(parsePesoTexto('abc'))).toBe(true);
	});

	it('formata mensagem do WhatsApp sem notas nem dados pessoais', () => {
		const texto = mensagemWhatsAppDraft(
			'Draft Gincana de Maio',
			[
				{ nome: 'Time Vermelho', membros: [{ nome: 'Ana' }, { nome: 'Bruno' }] },
				{ nome: 'Time Azul', membros: [{ nome: 'Camila' }, { nome: 'João' }] }
			],
			'Chegar às 15h'
		);
		expect(texto).toContain('*Draft Gincana de Maio*');
		expect(texto).toContain('*Time Vermelho* (2)');
		expect(texto).toContain('• Ana');
		expect(texto).toContain('*Time Azul* (2)');
		expect(texto).toContain('Chegar às 15h');
	});
});

describe('balanceamento determinístico do Draft', () => {
	const elenco: ParticipanteDraft[] = [
		{
			personId: 'p1',
			nome: 'Ana Beatriz',
			fisico: 7,
			biblico: 9,
			mental: 9,
			coordenacaoMotora: 7,
			alturaCm: 166,
			pontosFortes: 'Estratégia'
		},
		{
			personId: 'p2',
			nome: 'Bruno Henrique',
			fisico: 9,
			biblico: 8,
			mental: 8,
			coordenacaoMotora: 8,
			alturaCm: 181,
			pontosFortes: 'Corrida'
		},
		{
			personId: 'p3',
			nome: 'Camila Rodrigues',
			fisico: 6,
			biblico: 8,
			mental: 8,
			coordenacaoMotora: 6,
			alturaCm: 164,
			pontosFortes: 'Quiz bíblico'
		},
		{
			personId: 'p4',
			nome: 'Gustavo Lima',
			fisico: 7,
			biblico: 7,
			mental: 7,
			coordenacaoMotora: 7,
			alturaCm: 175,
			pontosFortes: 'Versátil'
		},
		{
			personId: 'p5',
			nome: 'João Vitor',
			fisico: 9,
			biblico: 5,
			mental: 6,
			coordenacaoMotora: 9,
			alturaCm: 184,
			pontosFortes: 'Velocidade'
		},
		{
			personId: 'p6',
			nome: 'Letícia Ferreira',
			fisico: 6,
			biblico: 9,
			mental: 8,
			coordenacaoMotora: 8,
			alturaCm: 168,
			pontosFortes: 'Precisão'
		}
	];

	it('divide em 2 times equilibrados com tamanhos iguais e resultado determinístico', () => {
		const r1 = balancearDraft({
			participantes: elenco,
			quantidadeTimes: 2,
			nomesTimes: ['Águias A', 'Águias B'],
			foco: 'equilibrado'
		});
		const r2 = balancearDraft({
			participantes: elenco,
			quantidadeTimes: 2,
			nomesTimes: ['Águias A', 'Águias B'],
			foco: 'equilibrado'
		});

		expect(r1).toEqual(r2);
		expect(r1.times).toHaveLength(2);
		expect(r1.times[0]!.nome).toBe('Águias A');
		expect(r1.times[1]!.nome).toBe('Águias B');
		expect(r1.times[0]!.totalMembros).toBe(3);
		expect(r1.times[1]!.totalMembros).toBe(3);
		expect(r1.equilibrio.diferencaGeral).toBeLessThanOrEqual(0.5);
		expect(r1.equilibrio.nivel).toBe('excelente');
	});

	it('suporta 3 times com distribuição ±1 e foco específico (ex.: físico)', () => {
		const r = balancearDraft({
			participantes: [
				...elenco,
				{
					personId: 'p7',
					nome: 'Rafael Monteiro',
					fisico: 8,
					biblico: 5,
					mental: 6,
					coordenacaoMotora: 8,
					alturaCm: 176,
					pontosFortes: null
				}
			],
			quantidadeTimes: 3,
			foco: 'fisico'
		});

		const tamanhos = r.times.map((t) => t.totalMembros).sort((a, b) => b - a);
		expect(tamanhos).toEqual([3, 2, 2]);
		expect(r.equilibrio.diferencas.fisico).toBeLessThanOrEqual(1.2);
	});

	it('trata pessoas sem notas com peso neutro sem inventar notas no retorno', () => {
		const r = balancearDraft({
			participantes: [
				...elenco.slice(0, 4),
				{
					personId: 'p-novo-1',
					nome: 'Visitante Novo',
					fisico: null,
					biblico: null,
					mental: null,
					coordenacaoMotora: null,
					alturaCm: null,
					pontosFortes: null
				},
				{
					personId: 'p-novo-2',
					nome: 'Outro Novo',
					fisico: null,
					biblico: null,
					mental: null,
					coordenacaoMotora: null,
					alturaCm: null,
					pontosFortes: null
				}
			],
			quantidadeTimes: 2
		});

		const novos = r.times.flatMap((t) => t.membros).filter((m) => m.personId.startsWith('p-novo'));
		expect(novos).toHaveLength(2);
		for (const n of novos) {
			expect(n.fisico).toBeNull();
			expect(n.media).toBeNull();
			expect(n.semAvaliacao).toBe(true);
		}
		expect(r.equilibrio.semAvaliacaoCount).toBe(2);
		expect(r.equilibrio.resumo).toContain('peso neutro');
	});

	it('recalcula médias e equilíbrio após ajuste manual', () => {
		const m1 = calcularMediasTime([elenco[0]!, elenco[1]!]);
		const m2 = calcularMediasTime([elenco[2]!, elenco[4]!]);
		const eq = calcularEquilibrioTimes([
			{ medias: m1, membros: [{ semAvaliacao: false }, { semAvaliacao: false }] },
			{ medias: m2, membros: [{ semAvaliacao: false }, { semAvaliacao: false }] }
		]);
		expect(m1.geral).toBe(8.2);
		expect(eq.diferencaGeral).toBeGreaterThan(0);
	});

	it('recusa montar mais times do que participantes', () => {
		expect(() =>
			balancearDraft({ participantes: elenco.slice(0, 2), quantidadeTimes: 3 })
		).toThrow();
	});
});
