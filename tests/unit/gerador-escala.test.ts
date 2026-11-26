import { describe, expect, it } from 'vitest';
import { gerarPropostaDeEscala } from '../../src/lib/server/responsabilidades/gerador';

describe('gerador determinístico de escala (RN-18, RN-19, RF-07.6)', () => {
	const dataEvento = new Date('2026-11-26T20:00:00Z');
	const candidatos = [
		{ personId: 'p1', nome: 'Ana' },
		{ personId: 'p2', nome: 'Bruno' },
		{ personId: 'p3', nome: 'Carla' }
	];
	const responsabilidades = [
		{ id: 'r1', nome: 'Mensagem', intervaloMinimoDias: 14, ordem: 1 },
		{ id: 'r2', nome: 'Música', intervaloMinimoDias: 14, ordem: 2 }
	];

	it('distribui sem repetir a mesma pessoa no mesmo evento', () => {
		const itens = gerarPropostaDeEscala({
			dataEvento,
			responsabilidades,
			candidatos,
			historico: []
		});

		expect(itens).toHaveLength(2);
		expect(itens[0]?.personId).not.toBe(itens[1]?.personId);
		expect(itens.every((i) => i.respeitouIntervalo)).toBe(true);
	});

	it('respeita o intervalo mínimo de dias evitando quem atuou recentemente', () => {
		const itens = gerarPropostaDeEscala({
			dataEvento,
			responsabilidades: [responsabilidades[0]!],
			candidatos,
			historico: [
				{
					personId: 'p1',
					responsabilidadeId: 'r1',
					eventoInicio: new Date('2026-11-20T20:00:00Z') // 6 dias atrás (< 14)
				},
				{
					personId: 'p2',
					responsabilidadeId: 'r1',
					eventoInicio: new Date('2026-11-22T20:00:00Z') // 4 dias atrás (< 14)
				}
			]
		});

		expect(itens).toHaveLength(1);
		expect(itens[0]?.personId).toBe('p3');
		expect(itens[0]?.respeitouIntervalo).toBe(true);
	});

	it('sinaliza quando todos os candidatos estão dentro do intervalo mínimo', () => {
		const itens = gerarPropostaDeEscala({
			dataEvento,
			responsabilidades: [responsabilidades[0]!],
			candidatos: [{ personId: 'p1', nome: 'Ana' }],
			historico: [
				{
					personId: 'p1',
					responsabilidadeId: 'r1',
					eventoInicio: new Date('2026-11-24T20:00:00Z')
				}
			]
		});

		expect(itens).toHaveLength(1);
		expect(itens[0]?.respeitouIntervalo).toBe(false);
		expect(itens[0]?.justificativa).toContain('14 dias');
	});

	it('pula responsabilidades já preenchidas no evento', () => {
		const itens = gerarPropostaDeEscala({
			dataEvento,
			responsabilidades,
			candidatos,
			historico: [],
			responsabilidadesJaPreenchidas: new Set(['r1']),
			jaEscaladosNoEvento: new Set(['p1'])
		});

		expect(itens).toHaveLength(1);
		expect(itens[0]?.responsabilidadeId).toBe('r2');
		expect(itens[0]?.personId).not.toBe('p1');
	});
});
