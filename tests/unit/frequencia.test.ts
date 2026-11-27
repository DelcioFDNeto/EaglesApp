import { describe, expect, it } from 'vitest';
import {
	eventosDaEquipe,
	frequenciaDaEquipe,
	frequenciaDaPessoa,
	frequenciaDoSubgrupo,
	type DadosFrequencia,
	type EventoF
} from '../../src/lib/server/presenca/frequencia';
import { chavesQueConfirmam, opcaoConfirma } from '../../src/lib/shared/rsvp';

const CONFIRMAM = new Set(['confirmado', 'atrasado', 'convidado']);
const dia = (d: number) => new Date(2026, 8, d, 19, 30); // setembro de 2026

const encontroSubgrupo = (id: string, d: number, groupId = 'A'): EventoF => ({
	id,
	titulo: `Encontro Subgrupo ${d}/09`,
	groupId,
	tipoId: 't-sub',
	tipoSlug: 'subgrupo',
	tipoNome: 'Subgrupo',
	inicio: dia(d),
	confirmam: CONFIRMAM
});

const encontroPg = (id: string, d: number): EventoF => ({
	id,
	titulo: `PG ${d}/09`,
	groupId: null,
	tipoId: 't-pg',
	tipoSlug: 'pg',
	tipoNome: 'PG (Pequeno Grupo)',
	inicio: dia(d),
	confirmam: CONFIRMAM
});

/**
 * Cenário de subgrupo A com quatro encontros (dias 3, 10, 17, 24); o do dia 24 não teve chamada.
 *   - Ana: no subgrupo A desde sempre; veio nos dias 3 e 17; no dia 10 respondeu "não vou".
 *   - Bia: no subgrupo A desde sempre; confirmou no dia 17 e não veio; faltou nos outros.
 *   - Caio: entrou no subgrupo A no dia 12 (vindo do B): só conta a partir do dia 17.
 *   - Davi: do subgrupo B; veio ao encontro do A no dia 3 como convidado (não é esperado ali).
 */
function cenarioSubgrupo(): DadosFrequencia {
	return {
		eventos: [
			encontroSubgrupo('e3', 3),
			encontroSubgrupo('e10', 10),
			encontroSubgrupo('e17', 17),
			encontroSubgrupo('e24', 24),
			{
				id: 'outside',
				titulo: 'Outside',
				groupId: null,
				tipoId: 't-out',
				tipoSlug: 'outside',
				tipoNome: 'Outside',
				inicio: dia(20),
				confirmam: CONFIRMAM
			}
		],
		presencas: [
			{ eventId: 'e3', personId: 'ana', status: 'present' },
			{ eventId: 'e3', personId: 'davi', status: 'present' },
			{ eventId: 'e10', personId: 'caio', status: 'present' }, // ainda era do B
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
			{ id: 'bia', nome: 'Bia', ehMembro: true },
			{ id: 'ana', nome: 'Ana', ehMembro: true },
			{ id: 'caio', nome: 'Caio', ehMembro: true },
			{ id: 'davi', nome: 'Davi', ehMembro: true }
		]
	};
}

/**
 * Cenário de PGs da equipe toda (reuniões abertas a membros e visitantes):
 *   - Ana: membro desde sempre; veio nos dias 3 e 17; avisou "não vou" no dia 10.
 *   - Bia: membro desde sempre; confirmou no dia 17 e não veio; 3 faltas seguidas.
 *   - Caio: era visitante e virou membro no dia 12 (veio no dia 10 como visitante e no dia 17 como membro).
 *   - Eva: visitante; veio no dia 3 (entra na média de presentes, mas nunca leva falta).
 */
function cenarioPgEquipe(): DadosFrequencia {
	return {
		eventos: [
			encontroPg('pg3', 3),
			encontroPg('pg10', 10),
			encontroPg('pg17', 17),
			encontroPg('pg24', 24), // sem chamada
			{
				id: 'outside',
				titulo: 'Outside',
				groupId: null,
				tipoId: 't-out',
				tipoSlug: 'outside',
				tipoNome: 'Outside',
				inicio: dia(20),
				confirmam: CONFIRMAM
			}
		],
		presencas: [
			{ eventId: 'pg3', personId: 'ana', status: 'present' },
			{ eventId: 'pg3', personId: 'eva', status: 'present' },
			{ eventId: 'pg10', personId: 'caio', status: 'present' },
			{ eventId: 'pg17', personId: 'ana', status: 'late' },
			{ eventId: 'pg17', personId: 'caio', status: 'present' },
			{ eventId: 'pg17', personId: 'bia', status: 'absent' },
			{ eventId: 'outside', personId: 'ana', status: 'present' }
		],
		respostas: [
			{ eventId: 'pg10', personId: 'ana', option: 'nao_vou' },
			{ eventId: 'pg17', personId: 'bia', option: 'confirmado' },
			{ eventId: 'pg17', personId: 'ana', option: 'confirmado' }
		],
		mudancas: [],
		atuais: [],
		estagios: [
			{ personId: 'caio', de: null, para: 'visitante', em: new Date(2026, 0, 1) },
			{ personId: 'caio', de: 'visitante', para: 'membro', em: dia(12) },
			{ personId: 'eva', de: null, para: 'visitante', em: new Date(2026, 0, 1) }
		],
		pessoas: [
			{ id: 'bia', nome: 'Bia', ehMembro: true },
			{ id: 'ana', nome: 'Ana', ehMembro: true },
			{ id: 'caio', nome: 'Caio', ehMembro: true },
			{ id: 'eva', nome: 'Eva', ehMembro: false }
		]
	};
}

describe('frequência dos PGs da equipe (membros ativos esperados)', () => {
	const f = frequenciaDaEquipe(cenarioPgEquipe(), undefined, { tipoSlug: 'pg' });

	it('evento sem chamada não conta; apenas membros ativos na data entram como esperados', () => {
		expect(f.chamadas).toBe(3);
		expect(f.semChamada).toBe(1);
		// Caio só virou membro dia 12 → esperado apenas no PG do dia 17.
		expect(f.pessoas.find((p) => p.id === 'caio')).toMatchObject({
			esperados: 1,
			presencas: 1,
			taxa: 100
		});
		// Eva é visitante → nunca entra como esperada nem leva falta.
		expect(f.pessoas.find((p) => p.id === 'eva')).toBeUndefined();
		expect(f.pessoas.map((p) => p.nome)).toEqual(['Ana', 'Bia', 'Caio']);
	});

	it('presença média inclui visitantes; confirmação × presença e evolução funcionam', () => {
		// Presentes por chamada: pg3 (Ana, Eva = 2), pg10 (Caio = 1), pg17 (Ana, Caio = 2).
		expect(f.presencaMedia).toBe(1.7);
		expect(f.taxaPresenca).toBe(43); // 3 presenças de 7 esperados (Ana 2/3, Bia 0/3, Caio 1/1)
		expect(f.confirmacao).toEqual({
			esperados: 7,
			responderam: 3,
			confirmaram: 2,
			confirmaramEVieram: 1,
			vieramSemConfirmar: 4
		});
		expect(f.evolucao).toEqual([{ mes: '2026-09', chamadas: 3, taxa: 43 }]);
	});

	it('ficha individual: membro vê % dos PGs e Outside separado; visitante vê PGs sem faltas', () => {
		const ana = frequenciaDaPessoa('ana', cenarioPgEquipe());
		expect(ana.pg).toEqual({ esperados: 3, presencas: 2, taxa: 67 });
		expect(ana.outrosEventos).toEqual([{ tipo: 'Outside', presencas: 1 }]);
		expect(ana.recentes.find((r) => r.id === 'pg24')).toMatchObject({
			veio: null,
			contaNaFrequencia: false
		});

		const eva = frequenciaDaPessoa('eva', cenarioPgEquipe());
		expect(eva.pg).toEqual({ esperados: 0, presencas: 0, taxa: null });
		expect(eva.outrosEventos).toEqual([{ tipo: 'PG (Pequeno Grupo)', presencas: 1 }]);
	});
});

describe('frequência de um subgrupo', () => {
	const f = frequenciaDoSubgrupo('A', cenarioSubgrupo());

	it('evento sem chamada não conta; os outros contam', () => {
		expect(f.chamadas).toBe(3);
		expect(f.semChamada).toBe(1);
	});

	it('cada pessoa só é esperada enquanto estava no subgrupo', () => {
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
		expect(f.confirmacao).toEqual({
			esperados: 7,
			responderam: 3,
			confirmaram: 2,
			confirmaramEVieram: 1,
			vieramSemConfirmar: 4
		});
		expect(f.taxaPresenca).toBe(43);
		expect(f.presencaMedia).toBe(1.7);
	});

	it('evolução por mês', () => {
		expect(f.evolucao).toEqual([{ mes: '2026-09', chamadas: 3, taxa: 43 }]);
	});
});

describe('outros eventos da equipe e ficha em subgrupo', () => {
	it('resume outros eventos da equipe por tipo', () => {
		expect(eventosDaEquipe(cenarioSubgrupo())).toEqual([
			{ tipo: 'Outside', eventos: 1, chamadas: 1, presencaMedia: 1 }
		]);
		expect(eventosDaEquipe(cenarioPgEquipe(), undefined, 't-pg')).toEqual([
			{ tipo: 'Outside', eventos: 1, chamadas: 1, presencaMedia: 1 }
		]);
	});

	it('a pessoa vê o próprio subgrupo em %, os outros eventos em contagem e a linha do tempo', () => {
		const ana = frequenciaDaPessoa('ana', cenarioSubgrupo());
		expect(ana.pg).toEqual({ esperados: 3, presencas: 2, taxa: 67 });
		expect(ana.outrosEventos).toEqual([{ tipo: 'Outside', presencas: 1 }]);
		const e24 = ana.recentes.find((r) => r.id === 'e24')!;
		expect(e24).toMatchObject({ veio: null, contaNaFrequencia: false });
		const e10 = ana.recentes.find((r) => r.id === 'e10')!;
		expect(e10).toMatchObject({ resposta: 'nao_vou', confirmou: false, veio: false });
	});

	it('visita a outro subgrupo aparece como presença, não como frequência', () => {
		const davi = frequenciaDaPessoa('davi', cenarioSubgrupo());
		expect(davi.pg.esperados).toBe(0);
		expect(davi.outrosEventos).toEqual([{ tipo: 'Subgrupo', presencas: 1 }]);
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
