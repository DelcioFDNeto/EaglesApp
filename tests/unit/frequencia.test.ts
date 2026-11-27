import { describe, expect, it } from 'vitest';
import {
	eventosDaEquipe,
	frequenciaDaPessoa,
	frequenciaDoPg,
	type DadosFrequencia,
	type EventoF
} from '../../src/lib/server/presenca/frequencia';
import { chavesQueConfirmam, opcaoConfirma } from '../../src/lib/shared/rsvp';

const CONFIRMAM = new Set(['confirmado', 'atrasado', 'convidado']);
const dia = (d: number) => new Date(2026, 8, d, 19, 30); // setembro de 2026

const pg = (id: string, d: number, groupId = 'A'): EventoF => ({
	id,
	titulo: `PG ${d}/09`,
	groupId,
	tipoNome: 'PG',
	inicio: dia(d),
	confirmam: CONFIRMAM
});

/**
 * PG A com quatro encontros (dias 3, 10, 17, 24); o do dia 24 não teve chamada.
 *   - Ana: no PG desde sempre; veio nos dias 3 e 17; no dia 10 respondeu "não vou".
 *   - Bia: no PG desde sempre; confirmou no dia 17 e não veio; faltou nos outros.
 *   - Caio: entrou no PG A no dia 12 (vindo do B): só conta a partir do dia 17.
 *   - Davi: do PG B; veio ao PG A no dia 3 como convidado (não é esperado ali).
 */
function cenario(): DadosFrequencia {
	return {
		eventos: [
			pg('e3', 3),
			pg('e10', 10),
			pg('e17', 17),
			pg('e24', 24),
			{
				id: 'outside',
				titulo: 'Outside',
				groupId: null,
				tipoNome: 'Outside',
				inicio: dia(20),
				confirmam: CONFIRMAM
			}
		],
		presencas: [
			{ eventId: 'e3', personId: 'ana', status: 'present' },
			{ eventId: 'e3', personId: 'davi', status: 'present' },
			{ eventId: 'e10', personId: 'caio', status: 'present' }, // ainda era do PG B
			{ eventId: 'e17', personId: 'ana', status: 'late' },
			{ eventId: 'e17', personId: 'caio', status: 'present' },
			{ eventId: 'e17', personId: 'bia', status: 'absent' },
			{ eventId: 'outside', personId: 'ana', status: 'present' }
		],
		respostas: [
			{ eventId: 'e10', personId: 'ana', option: 'nao_vou' },
			{ eventId: 'e17', personId: 'bia', option: 'confirmado' },
			{ eventId: 'e17', personId: 'ana', option: 'confirmado' }
		],
		mudancas: [
			{ personId: 'caio', para: 'B', em: new Date(2026, 0, 1) },
			{ personId: 'caio', para: 'A', em: dia(12) }
		],
		atuais: [
			{ personId: 'ana', groupId: 'A', desde: new Date(2026, 0, 1) },
			{ personId: 'bia', groupId: 'A', desde: new Date(2026, 0, 1) },
			{ personId: 'caio', groupId: 'A', desde: dia(12) },
			{ personId: 'davi', groupId: 'B', desde: new Date(2026, 0, 1) }
		],
		pessoas: [
			{ id: 'bia', nome: 'Bia' },
			{ id: 'ana', nome: 'Ana' },
			{ id: 'caio', nome: 'Caio' },
			{ id: 'davi', nome: 'Davi' }
		]
	};
}

describe('frequência de um PG', () => {
	const f = frequenciaDoPg('A', cenario());

	it('evento sem chamada não conta; os outros contam', () => {
		expect(f.chamadas).toBe(3);
		expect(f.semChamada).toBe(1);
	});

	it('cada pessoa só é esperada enquanto estava no PG', () => {
		const caio = f.pessoas.find((p) => p.id === 'caio')!;
		expect(caio).toMatchObject({ esperados: 1, presencas: 1, taxa: 100 });
		expect(f.pessoas.find((p) => p.id === 'davi')).toBeUndefined();
	});

	it('atrasado conta como veio; "não vou" é falta avisada, não some da conta', () => {
		const ana = f.pessoas.find((p) => p.id === 'ana')!;
		expect(ana).toMatchObject({ esperados: 3, presencas: 2, taxa: 67, faltasAvisadas: 1 });
		expect(ana.faltasSeguidas).toBe(0);
		expect(ana.ultimaPresenca).toEqual(dia(17));
	});

	it('faltas seguidas contam a partir da chamada mais recente', () => {
		const bia = f.pessoas.find((p) => p.id === 'bia')!;
		expect(bia).toMatchObject({ esperados: 3, presencas: 0, faltasSeguidas: 3, taxa: 0 });
	});

	it('pessoas em ordem alfabética, nunca por frequência', () => {
		expect(f.pessoas.map((p) => p.nome)).toEqual(['Ana', 'Bia', 'Caio']);
	});

	it('confirmação × presença, e quem veio sem confirmar', () => {
		// Esperados por chamada: dia 3 (Ana, Bia), dia 10 (Ana, Bia), dia 17 (Ana, Bia, Caio).
		expect(f.confirmacao).toEqual({
			esperados: 7,
			responderam: 3,
			confirmaram: 2,
			confirmaramEVieram: 1,
			// Dia 3: Ana e Davi; dia 10: Caio (de outro PG); dia 17: Caio.
			vieramSemConfirmar: 4
		});
		expect(f.taxaPresenca).toBe(43); // 3 de 7
		expect(f.presencaMedia).toBe(1.7); // (2 + 1 + 2) / 3
	});

	it('evolução por mês', () => {
		expect(f.evolucao).toEqual([{ mes: '2026-09', chamadas: 3, taxa: 43 }]);
	});
});

describe('eventos da equipe e de uma pessoa', () => {
	it('evento sem PG só conta presenças, sem %', () => {
		expect(eventosDaEquipe(cenario())).toEqual([
			{ tipo: 'Outside', eventos: 1, chamadas: 1, presencaMedia: 1 }
		]);
	});

	it('a pessoa vê o próprio PG em %, os outros eventos em contagem e a linha do tempo', () => {
		const ana = frequenciaDaPessoa('ana', cenario());
		expect(ana.pg).toEqual({ esperados: 3, presencas: 2, taxa: 67 });
		expect(ana.outrosEventos).toEqual([{ tipo: 'Outside', presencas: 1 }]);
		const e24 = ana.recentes.find((r) => r.id === 'e24')!;
		expect(e24).toMatchObject({ veio: null, contaNaFrequencia: false });
		const e10 = ana.recentes.find((r) => r.id === 'e10')!;
		expect(e10).toMatchObject({ resposta: 'nao_vou', confirmou: false, veio: false });
	});

	it('visita a outro PG aparece como presença, não como frequência', () => {
		const davi = frequenciaDaPessoa('davi', cenario());
		expect(davi.pg.esperados).toBe(0);
		expect(davi.outrosEventos).toEqual([{ tipo: 'PG', presencas: 1 }]);
	});
});

describe('o que conta como "vou"', () => {
	it('padrão pela chave; marcação explícita vence', () => {
		expect(opcaoConfirma({ key: 'confirmado' })).toBe(true);
		expect(opcaoConfirma({ key: 'talvez' })).toBe(false);
		expect(opcaoConfirma({ key: 'nao_vou' })).toBe(false);
		expect(opcaoConfirma({ key: 'nao_posso' })).toBe(false);
		expect(opcaoConfirma({ key: 'vou_de_carona' })).toBe(true);
		expect(opcaoConfirma({ key: 'vou_de_carona', confirma: false })).toBe(false);
	});

	it('o conjunto do evento usa as opções dele', () => {
		const chaves = chavesQueConfirmam([
			{ key: 'vou', label: 'Vou' },
			{ key: 'talvez', label: 'Talvez' }
		]);
		expect(chaves.has('vou')).toBe(true);
		expect(chaves.has('talvez')).toBe(false);
	});
});
