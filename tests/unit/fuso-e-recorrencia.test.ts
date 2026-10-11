import { describe, expect, it } from 'vitest';
import {
	dataNoFuso,
	dataPorExtenso,
	diaDaSemana,
	ehData,
	hojeNoFuso,
	horaNoFuso,
	instanteLocal,
	limitesDoMes,
	somarDias,
	somarMeses
} from '../../src/lib/shared/fuso';
import { datasEntre, primeiraOcorrencia } from '../../src/lib/server/modules/eventos/recorrencia';

/**
 * Fuso e recorrência (D-M05-1, D-M05-3).
 *
 * O Brasil não tem horário de verão desde 2019, e é justamente por isso que os
 * testes usam Nova York: se a regra voltar, o código já foi provado contra um
 * fuso que muda de hora duas vezes por ano.
 */

describe('instante local → UTC', () => {
	it('quinta às 20h em São Paulo é 23h UTC', () => {
		expect(instanteLocal('2026-10-15', '20:00', 'America/Sao_Paulo').toISOString()).toBe(
			'2026-10-15T23:00:00.000Z'
		);
	});

	it('mesma hora local antes e depois do horário de verão vira instantes diferentes', () => {
		// 8/3/2026: Nova York adianta o relógio. EST é UTC−5; EDT, UTC−4.
		expect(instanteLocal('2026-03-05', '20:00', 'America/New_York').toISOString()).toBe(
			'2026-03-06T01:00:00.000Z'
		);
		expect(instanteLocal('2026-03-12', '20:00', 'America/New_York').toISOString()).toBe(
			'2026-03-13T00:00:00.000Z'
		);
	});

	it('hora que não existe (o relógio pula) vira a primeira hora válida depois', () => {
		// Em 8/3/2026, 2h00 vira 3h00 em Nova York: 2h30 não existe.
		const instante = instanteLocal('2026-03-08', '02:30', 'America/New_York');
		expect(horaNoFuso(instante, 'America/New_York')).toBe('03:30');
	});

	it('hora que existe duas vezes (o relógio volta) fica com a primeira', () => {
		// Em 1/11/2026, 1h59 EDT volta para 1h00 EST: 1h30 acontece duas vezes.
		expect(instanteLocal('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe(
			'2026-11-01T05:30:00.000Z'
		);
	});

	it('ida e volta: a hora local exibida é a mesma que foi pedida', () => {
		for (const fuso of ['America/Sao_Paulo', 'America/New_York', 'Europe/Lisbon', 'Asia/Tokyo']) {
			const i = instanteLocal('2026-07-20', '19:45', fuso);
			expect(dataNoFuso(i, fuso)).toBe('2026-07-20');
			expect(horaNoFuso(i, fuso)).toBe('19:45');
		}
	});
});

describe('"hoje" é o da equipe, não o do servidor', () => {
	it('às 2h UTC ainda é ontem em São Paulo', () => {
		const agora = new Date('2026-10-10T02:00:00Z');
		expect(hojeNoFuso('America/Sao_Paulo', agora)).toBe('2026-10-09');
		expect(hojeNoFuso('UTC', agora)).toBe('2026-10-10');
	});
});

describe('data que não existe no calendário (varredura de 11/10/2026)', () => {
	it('recusa 31 de fevereiro e 31 de abril — o V8 os empurraria para março e maio', () => {
		expect(ehData('2026-02-31')).toBe(false);
		expect(ehData('2026-02-29')).toBe(false);
		expect(ehData('2026-04-31')).toBe(false);
		expect(ehData('2026-13-01')).toBe(false);
	});

	it('aceita o que existe, inclusive 29 de fevereiro de ano bissexto', () => {
		expect(ehData('2024-02-29')).toBe(true);
		expect(ehData('2026-12-31')).toBe(true);
	});
});

describe('aritmética de datas', () => {
	it('soma dias atravessando mês e ano', () => {
		expect(somarDias('2026-12-30', 3)).toBe('2027-01-02');
		expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
	});

	it('limites e navegação de mês', () => {
		expect(limitesDoMes('2028-02')).toEqual({ inicio: '2028-02-01', fim: '2028-02-29' });
		expect(somarMeses('2026-12', 1)).toBe('2027-01');
		expect(somarMeses('2026-01', -1)).toBe('2025-12');
	});

	it('data por extenso, sem depender do fuso de quem roda', () => {
		expect(dataPorExtenso('2026-10-15')).toBe('quinta, 15 de outubro');
	});
});

describe('série semanal', () => {
	const quinta = { diaDaSemana: 4, intervaloSemanas: 1, inicio: '2026-10-10', fim: null };

	it('a primeira ocorrência é o primeiro dia certo a partir do início', () => {
		const primeira = primeiraOcorrencia(quinta);
		expect(diaDaSemana(primeira)).toBe(4);
		expect(primeira).toBe('2026-10-15');
	});

	it('início no próprio dia conta', () => {
		expect(primeiraOcorrencia({ diaDaSemana: 4, inicio: '2026-10-15' })).toBe('2026-10-15');
	});

	it('toda semana, dentro do intervalo pedido', () => {
		expect(datasEntre(quinta, '2026-10-01', '2026-11-05')).toEqual([
			'2026-10-15',
			'2026-10-22',
			'2026-10-29',
			'2026-11-05'
		]);
	});

	it('quinzenal conta a partir da primeira ocorrência, de qualquer ponto de partida', () => {
		const quinzenal = { ...quinta, intervaloSemanas: 2 };
		const tudo = datasEntre(quinzenal, '2026-10-01', '2026-12-31');
		expect(tudo.slice(0, 3)).toEqual(['2026-10-15', '2026-10-29', '2026-11-12']);

		// Pedir a partir do meio de uma quinzena não muda a paridade.
		expect(datasEntre(quinzenal, '2026-10-20', '2026-11-30')).toEqual(
			tudo.filter((d) => d >= '2026-10-20' && d <= '2026-11-30')
		);
	});

	it('o fim é inclusivo e corta o que vem depois', () => {
		expect(datasEntre({ ...quinta, fim: '2026-10-22' }, '2026-10-01', '2026-12-31')).toEqual([
			'2026-10-15',
			'2026-10-22'
		]);
	});

	it('série que ainda não começou não tem nada antes do início', () => {
		expect(datasEntre(quinta, '2026-09-01', '2026-10-14')).toEqual([]);
	});
});
