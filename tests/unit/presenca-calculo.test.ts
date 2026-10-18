import { describe, expect, it } from 'vitest';
import {
	agruparPorPessoa,
	chaveDePresenca,
	esperadoNo,
	estavaNoGrupo,
	frequenciaDe,
	sinaisDe,
	type EventoComLista,
	type Passagem,
	type PessoaParaCalculo
} from '../../src/lib/server/modules/presenca/calculo';
import { aceitaResposta } from '../../src/lib/server/modules/presenca/rsvp';

/**
 * O cálculo de frequência (D-M06-4, D-M06-5, D-M06-7), sem banco.
 *
 * As três regras que importam: só lista feita conta; esperado é quem era
 * convidado NAQUELE DIA; visitar outro PG não é faltar ao seu. A conferência
 * com o banco de verdade está em `tests/integration/presenca.test.ts`.
 */

const AZUL = 'azul';
const VERDE = 'verde';
const DIA = 86_400_000;
const BASE = Date.UTC(2026, 8, 3, 23, 0); // uma quinta, 20h em São Paulo

/** A n-ésima quinta-feira a partir da base. */
const semana = (n: number) => new Date(BASE + n * 7 * DIA);

const encontroAzul = (n: number): EventoComLista => ({
	id: `azul-${n}`,
	inicio: semana(n),
	publico: [{ tipo: 'grupo', groupId: AZUL }]
});
const encontroVerde = (n: number): EventoComLista => ({
	id: `verde-${n}`,
	inicio: semana(n),
	publico: [{ tipo: 'grupo', groupId: VERDE }]
});

const desdeSempre = new Date(BASE - 365 * DIA);
const pessoa = (id: string, cadastradaEm = desdeSempre): PessoaParaCalculo => ({
	id,
	cadastradaEm
});
const passagem = (
	personId: string,
	groupId: string,
	entrada: Date,
	saida: Date | null = null
): Passagem => ({ personId, groupId, entrada, saida });

const presencas = (...pares: [string, string][]) =>
	new Set(pares.map(([e, p]) => chaveDePresenca(e, p)));

describe('quem era esperado (D-M06-5)', () => {
	const joao = pessoa('joao');
	const passagens = [passagem('joao', AZUL, semana(2))];

	it('o grupo em que a pessoa estava NAQUELE DIA', () => {
		expect(esperadoNo(encontroAzul(1), joao, passagens)).toBe(false);
		expect(esperadoNo(encontroAzul(2), joao, passagens)).toBe(true);
		expect(esperadoNo(encontroAzul(3), joao, passagens)).toBe(true);
	});

	it('quem saiu deixa de ser esperado a partir da saída', () => {
		const saiu = [passagem('joao', AZUL, semana(0), semana(2))];
		expect(esperadoNo(encontroAzul(1), joao, saiu)).toBe(true);
		expect(esperadoNo(encontroAzul(2), joao, saiu)).toBe(false);
		expect(estavaNoGrupo(saiu, 'joao', AZUL, semana(3))).toBe(false);
	});

	it('evento da equipe espera todo mundo — que já estava cadastrado', () => {
		const geral: EventoComLista = { id: 'geral', inicio: semana(4), publico: [{ tipo: 'equipe' }] };
		expect(esperadoNo(geral, joao, [])).toBe(true);
		expect(esperadoNo(geral, pessoa('nova', semana(5)), [])).toBe(false);
	});

	it('convite nominal espera só a pessoa convidada', () => {
		const nominal: EventoComLista = {
			id: 'conversa',
			inicio: semana(4),
			publico: [{ tipo: 'pessoa', personId: 'joao' }]
		};
		expect(esperadoNo(nominal, joao, [])).toBe(true);
		expect(esperadoNo(nominal, pessoa('maria'), [])).toBe(false);
	});
});

describe('frequência', () => {
	it('presentes / esperados, só nos eventos dados — os com lista feita', () => {
		const eventos = [1, 2, 3, 4].map(encontroAzul);
		const f = frequenciaDe(
			pessoa('joao'),
			eventos,
			[passagem('joao', AZUL, semana(0))],
			presencas(['azul-1', 'joao'], ['azul-2', 'joao'], ['azul-4', 'joao'])
		);
		expect(f).toMatchObject({ esperados: 4, presentes: 3, percentual: 75, faltasSeguidas: 0 });
	});

	it('quem entrou no grupo depois não "faltou" aos encontros de antes', () => {
		const eventos = [1, 2, 3, 4].map(encontroAzul);
		const f = frequenciaDe(
			pessoa('joao'),
			eventos,
			[passagem('joao', AZUL, semana(3))],
			presencas(['azul-3', 'joao'], ['azul-4', 'joao'])
		);
		expect(f).toMatchObject({ esperados: 2, presentes: 2, percentual: 100 });
	});

	it('visitar outro PG conta como presença, mas não entra no denominador', () => {
		const eventos = [encontroAzul(1), encontroVerde(1), encontroAzul(2)];
		const f = frequenciaDe(
			pessoa('joao'),
			eventos,
			[passagem('joao', AZUL, semana(0))],
			presencas(['azul-1', 'joao'], ['verde-1', 'joao'])
		);
		expect(f).toMatchObject({ esperados: 2, presentes: 1, foraDoEsperado: 1, percentual: 50 });
	});

	it('sem nenhum encontro esperado, o percentual é nulo — não zero', () => {
		const f = frequenciaDe(pessoa('joao'), [encontroAzul(1)], [], new Set());
		expect(f.percentual).toBeNull();
		expect(f.esperados).toBe(0);
	});

	it('a ordem dos eventos não muda o resultado', () => {
		const eventos = [1, 2, 3, 4, 5].map(encontroAzul);
		const ps = [passagem('joao', AZUL, semana(0))];
		const pr = presencas(['azul-1', 'joao']);
		expect(frequenciaDe(pessoa('joao'), [...eventos].reverse(), ps, pr)).toEqual(
			frequenciaDe(pessoa('joao'), eventos, ps, pr)
		);
	});
});

describe('passagens por pessoa, sem cache escondido (revisão de 17/10/2026)', () => {
	it('agrupar não muda o resultado — só o custo', () => {
		const todas = [
			passagem('joao', AZUL, semana(0)),
			passagem('maria', VERDE, semana(0)),
			passagem('joao', VERDE, semana(5))
		];
		const porPessoa = agruparPorPessoa(todas);
		expect(porPessoa.get('joao')).toHaveLength(2);
		expect(porPessoa.get('maria')).toHaveLength(1);

		const eventos = [1, 2, 3, 6].map(encontroAzul);
		const pr = presencas(['azul-1', 'joao']);
		expect(frequenciaDe(pessoa('joao'), eventos, porPessoa.get('joao')!, pr)).toEqual(
			frequenciaDe(pessoa('joao'), eventos, todas, pr)
		);
	});

	it('a lista alterada depois de usada vale do jeito novo', () => {
		// Com o índice antigo (WeakMap pela identidade da lista), a segunda
		// pergunta reaproveitava o índice vazio da primeira — e errava calada.
		const ps: Passagem[] = [];
		expect(estavaNoGrupo(ps, 'joao', AZUL, semana(1))).toBe(false);
		ps.push(passagem('joao', AZUL, semana(0)));
		expect(estavaNoGrupo(ps, 'joao', AZUL, semana(1))).toBe(true);
	});
});

describe('sinais, não ranking (D-M06-7)', () => {
	const ps = [passagem('rafael', AZUL, semana(0))];
	const eventos = [1, 2, 3, 4, 5, 6].map(encontroAzul);

	it('"não vem há 3 encontros": costumava vir e faltou aos três últimos', () => {
		const f = frequenciaDe(
			pessoa('rafael'),
			eventos,
			ps,
			presencas(['azul-1', 'rafael'], ['azul-2', 'rafael'], ['azul-3', 'rafael'])
		);
		expect(f.faltasSeguidas).toBe(3);
		expect(sinaisDe(f, false)).toEqual(['sumiu']);
	});

	it('duas faltas seguidas ainda não é sinal', () => {
		const f = frequenciaDe(
			pessoa('rafael'),
			eventos,
			ps,
			presencas(['azul-1', 'rafael'], ['azul-4', 'rafael'])
		);
		expect(f.faltasSeguidas).toBe(2);
		expect(sinaisDe(f, false)).toEqual([]);
	});

	it('quem nunca veio não "sumiu" — é outra conversa', () => {
		const f = frequenciaDe(pessoa('rafael'), eventos, ps, new Set());
		expect(f.faltasSeguidas).toBe(6);
		expect(sinaisDe(f, false)).toEqual([]);
	});

	it('"já veio 3 vezes em 60 dias": só para quem ainda está no estágio de chegada', () => {
		const recentes = presencas(['azul-4', 'isa'], ['azul-5', 'isa'], ['azul-6', 'isa']);
		const f = frequenciaDe(pessoa('isa'), eventos, [passagem('isa', AZUL, semana(0))], recentes, {
			recentesDesde: semana(6 - 8)
		});
		expect(f.presencasRecentes).toBe(3);
		expect(sinaisDe(f, true)).toEqual(['visitante_frequente']);
		expect(sinaisDe(f, false), 'membro que vem sempre não é sinal de nada').toEqual([]);
	});

	it('presença fora da janela de 60 dias não conta para o visitante', () => {
		const f = frequenciaDe(
			pessoa('isa'),
			eventos,
			[passagem('isa', AZUL, semana(0))],
			presencas(['azul-1', 'isa'], ['azul-2', 'isa'], ['azul-6', 'isa']),
			{ recentesDesde: semana(5) }
		);
		expect(f.presencasRecentes).toBe(1);
		expect(sinaisDe(f, true)).toEqual([]);
	});
});

describe('até quando dá para responder (D-M06-3)', () => {
	const agora = new Date(BASE);
	const evento = (
		inicioEmHoras: number,
		extra: Partial<Parameters<typeof aceitaResposta>[0]> = {}
	) => ({
		id: 'e',
		tipo: { id: 't' },
		publicado: true,
		cancelado: false,
		inicio: new Date(BASE + inicioEmHoras * 3_600_000),
		fim: null,
		...extra
	});

	it('antes de começar e até 3 horas depois, sem hora de fim', () => {
		expect(aceitaResposta(evento(24), agora)).toBe(true);
		expect(aceitaResposta(evento(-2), agora)).toBe(true);
		expect(aceitaResposta(evento(-4), agora)).toBe(false);
	});

	it('com hora de fim, até o fim', () => {
		expect(aceitaResposta(evento(-4, { fim: new Date(BASE + 3_600_000) }), agora)).toBe(true);
		expect(aceitaResposta(evento(-4, { fim: new Date(BASE - 60_000) }), agora)).toBe(false);
	});

	it('rascunho e cancelado não aceitam', () => {
		expect(aceitaResposta(evento(24, { publicado: false }), agora)).toBe(false);
		expect(aceitaResposta(evento(24, { cancelado: true }), agora)).toBe(false);
	});
});
