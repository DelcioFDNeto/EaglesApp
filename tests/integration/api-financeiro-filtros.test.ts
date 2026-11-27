/**
 * Testes de integração reais (§13 & §14 — Financeiro: filtros completos,
 * lista de responsáveis com escopo RN-24 / exclusão de Master, exportação CSV
 * filtrada e comprovantes internos `/api/arquivos/<uuid>`) contra PGlite.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	event as eventTable,
	eventType as eventTypeTable,
	group as groupTable,
	person as personTable,
	personRole as personRoleTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as categoriasRoute from '../../src/routes/api/financeiro/categorias/+server';
import * as movsRoute from '../../src/routes/api/financeiro/movimentacoes/+server';
import * as exportarRoute from '../../src/routes/api/financeiro/exportar/+server';

let ctx: BancoDeTeste;
let masterId: string;
let liderId: string;
let conselheiroAId: string;
let conselheiroBId: string;
let membroId: string;

let tokenMaster: string;
let tokenLider: string;
let tokenConselheiroA: string;
let tokenConselheiroB: string;
let tokenMembro: string;

let grupoAId: string;
let grupoBId: string;
let evento1Id: string;
let evento2Id: string;

let catEntradaId: string;
let catDoacaoId: string;
let catDespesaId: string;

function req(method: string, path: string, token: string, body?: unknown): Request {
	return new Request(`https://app.eagles.test${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
}

async function criarPessoa(
	nome: string,
	email: string,
	roleId: string,
	scopeType: 'global' | 'group' | 'self',
	scopeId: string | null = null
) {
	const [p] = await ctx.db
		.insert(personTable)
		.values({ teamId: ctx.teamId, fullName: nome })
		.returning({ id: personTable.id });

	await ctx.db.insert(userAccountTable).values({
		personId: p!.id,
		email,
		passwordHash: await hashPassword('senha12345')
	});

	await ctx.db.insert(personRoleTable).values({
		personId: p!.id,
		roleId,
		scopeType,
		scopeId
	});

	return p!.id;
}

describe('§13 & §14 — Financeiro (filtros, responsáveis, CSV filtrado e comprovante interno)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const [gA] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Águia', slug: 'pg-aguia' })
			.returning({ id: groupTable.id });
		const [gB] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Falcão', slug: 'pg-falcao' })
			.returning({ id: groupTable.id });
		grupoAId = gA!.id;
		grupoBId = gB!.id;

		masterId = await criarPessoa('Dev Master', 'master@eagles.test', ctx.papeis.master!, 'global');
		liderId = await criarPessoa('Líder Beatriz', 'bia@eagles.test', ctx.papeis.lider!, 'global');
		conselheiroAId = await criarPessoa(
			'Conselheiro André',
			'andre@eagles.test',
			ctx.papeis.conselheiro!,
			'group',
			grupoAId
		);
		conselheiroBId = await criarPessoa(
			'Conselheiro Carlos',
			'carlos@eagles.test',
			ctx.papeis.conselheiro!,
			'group',
			grupoBId
		);
		membroId = await criarPessoa('Membro Clara', 'clara@eagles.test', ctx.papeis.membro!, 'self');

		tokenMaster = await tokenPara(ctx.db, masterId);
		tokenLider = await tokenPara(ctx.db, liderId);
		tokenConselheiroA = await tokenPara(ctx.db, conselheiroAId);
		tokenConselheiroB = await tokenPara(ctx.db, conselheiroBId);
		tokenMembro = await tokenPara(ctx.db, membroId);

		// Cria tipo e dois eventos reais
		const [evType] = await ctx.db
			.insert(eventTypeTable)
			.values({ teamId: ctx.teamId, name: 'Encontro Geral', slug: 'encontro-geral' })
			.returning({ id: eventTypeTable.id });

		const [ev1] = await ctx.db
			.insert(eventTable)
			.values({
				teamId: ctx.teamId,
				eventTypeId: evType!.id,
				title: 'Acampamento Maio',
				startsAt: new Date('2026-05-10T18:00:00.000Z')
			})
			.returning({ id: eventTable.id });
		const [ev2] = await ctx.db
			.insert(eventTable)
			.values({
				teamId: ctx.teamId,
				eventTypeId: evType!.id,
				title: 'Vigília Junho',
				startsAt: new Date('2026-06-15T20:00:00.000Z')
			})
			.returning({ id: eventTable.id });
		evento1Id = ev1!.id;
		evento2Id = ev2!.id;

		// Categorias
		const rEntrada = await categoriasRoute.POST({
			request: req('POST', '/api/financeiro/categorias', tokenLider, {
				name: 'Inscrição Acampamento',
				slug: 'inscricao-acampamento',
				kind: 'entrada',
				isDonation: false
			}),
			locals: {}
		} as any);
		catEntradaId = (await rEntrada.json()).categoria.id;

		const rDoacao = await categoriasRoute.POST({
			request: req('POST', '/api/financeiro/categorias', tokenLider, {
				name: 'Oferta Voluntária',
				slug: 'oferta-voluntaria',
				kind: 'entrada',
				isDonation: true
			}),
			locals: {}
		} as any);
		catDoacaoId = (await rDoacao.json()).categoria.id;

		const rDespesa = await categoriasRoute.POST({
			request: req('POST', '/api/financeiro/categorias', tokenLider, {
				name: 'Alimentação',
				slug: 'alimentacao',
				kind: 'saida'
			}),
			locals: {}
		} as any);
		catDespesaId = (await rDespesa.json()).categoria.id;

		// Movimentação 1: Líder Beatriz, entrada, catEntrada, evento1, grupoA, membro Clara, 2026-05-10 18:30Z
		const r1 = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenLider, {
				kind: 'entrada',
				categoryId: catEntradaId,
				amountCents: 12000,
				occurredAt: '2026-05-10T18:30:00.000Z',
				paymentMethod: 'pix',
				description: 'Inscrição Clara Acampamento',
				personId: membroId,
				eventId: evento1Id,
				groupId: grupoAId
			}),
			locals: {}
		} as any);
		expect(r1.status).toBe(201);

		// Movimentação 2: Conselheiro André, saída, catDespesa, evento1, grupoA, 2026-05-11 21:15Z
		const r2 = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenConselheiroA, {
				kind: 'saida',
				categoryId: catDespesaId,
				amountCents: 4500,
				occurredAt: '2026-05-11T21:15:00.000Z',
				paymentMethod: 'cartao',
				description: 'Lanche PG Águia',
				eventId: evento1Id,
				groupId: grupoAId
			}),
			locals: {}
		} as any);
		expect(r2.status).toBe(201);

		// Movimentação 3: Conselheiro Carlos, saída, catDespesa, evento2, grupoB, 2026-06-15 22:00Z
		const r3 = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenConselheiroB, {
				kind: 'saida',
				categoryId: catDespesaId,
				amountCents: 3000,
				occurredAt: '2026-06-15T22:00:00.000Z',
				paymentMethod: 'especie',
				description: 'Café Vigília PG Falcão',
				eventId: evento2Id,
				groupId: grupoBId
			}),
			locals: {}
		} as any);
		expect(r3.status).toBe(201);

		// Movimentação 4: Master lança doação, catDoacao, evento2, 2026-06-20 14:00Z
		const r4 = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenMaster, {
				kind: 'entrada',
				categoryId: catDoacaoId,
				amountCents: 8000,
				occurredAt: '2026-06-20T14:00:00.000Z',
				paymentMethod: 'pix',
				description: 'Oferta Anônima Junho',
				eventId: evento2Id
			}),
			locals: {}
		} as any);
		expect(r4.status).toBe(201);
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('filtra GET /api/financeiro/movimentacoes por de/ate (inclusive YYYY-MM-DD), categoriaId, responsavelId, eventoId, grupoId e tipo', async () => {
		// 1. Mesmo dia (de=2026-05-10&ate=2026-05-10) inclui lançamento às 18:30Z daquele dia
		const resDia = await movsRoute.GET({
			request: req('GET', '/api/financeiro/movimentacoes?de=2026-05-10&ate=2026-05-10', tokenLider),
			url: new URL(
				'https://app.eagles.test/api/financeiro/movimentacoes?de=2026-05-10&ate=2026-05-10'
			),
			locals: {}
		} as any);
		expect(resDia.status).toBe(200);
		const bodyDia = await resDia.json();
		expect(bodyDia.movimentacoes.map((m: any) => m.description)).toEqual([
			'Inscrição Clara Acampamento'
		]);

		// 2. Intervalo maio (de=2026-05-10&ate=2026-05-11) inclui 18:30Z do dia 10 e 21:15Z do dia 11
		const resMaio = await movsRoute.GET({
			request: req('GET', '/api/financeiro/movimentacoes?de=2026-05-10&ate=2026-05-11', tokenLider),
			url: new URL(
				'https://app.eagles.test/api/financeiro/movimentacoes?de=2026-05-10&ate=2026-05-11'
			),
			locals: {}
		} as any);
		const bodyMaio = await resMaio.json();
		expect(bodyMaio.movimentacoes).toHaveLength(2);

		// 3. Filtro por categoriaId
		const resCat = await movsRoute.GET({
			request: req('GET', `/api/financeiro/movimentacoes?categoriaId=${catDoacaoId}`, tokenLider),
			url: new URL(
				`https://app.eagles.test/api/financeiro/movimentacoes?categoriaId=${catDoacaoId}`
			),
			locals: {}
		} as any);
		const bodyCat = await resCat.json();
		expect(bodyCat.movimentacoes.map((m: any) => m.description)).toEqual(['Oferta Anônima Junho']);

		// 4. Filtro por responsavelId
		const resResp = await movsRoute.GET({
			request: req(
				'GET',
				`/api/financeiro/movimentacoes?responsavelId=${conselheiroAId}`,
				tokenLider
			),
			url: new URL(
				`https://app.eagles.test/api/financeiro/movimentacoes?responsavelId=${conselheiroAId}`
			),
			locals: {}
		} as any);
		const bodyResp = await resResp.json();
		expect(bodyResp.movimentacoes.map((m: any) => m.description)).toEqual(['Lanche PG Águia']);

		// 5. Filtro por eventoId
		const resEv = await movsRoute.GET({
			request: req('GET', `/api/financeiro/movimentacoes?eventoId=${evento2Id}`, tokenLider),
			url: new URL(`https://app.eagles.test/api/financeiro/movimentacoes?eventoId=${evento2Id}`),
			locals: {}
		} as any);
		const bodyEv = await resEv.json();
		expect(bodyEv.movimentacoes).toHaveLength(2);
		expect(bodyEv.movimentacoes.map((m: any) => m.description)).toContain('Café Vigília PG Falcão');
		expect(bodyEv.movimentacoes.map((m: any) => m.description)).toContain('Oferta Anônima Junho');

		// 6. Filtro por grupoId + tipo
		const resGrupoTipo = await movsRoute.GET({
			request: req(
				'GET',
				`/api/financeiro/movimentacoes?grupoId=${grupoAId}&tipo=saida`,
				tokenLider
			),
			url: new URL(
				`https://app.eagles.test/api/financeiro/movimentacoes?grupoId=${grupoAId}&tipo=saida`
			),
			locals: {}
		} as any);
		const bodyGrupoTipo = await resGrupoTipo.json();
		expect(bodyGrupoTipo.movimentacoes.map((m: any) => m.description)).toEqual(['Lanche PG Águia']);
	});

	it('retorna lista responsaveis distinta, ordenada alfabeticamente, sem Master e respeitando RN-24', async () => {
		// Líder vê todos os responsáveis não-Master ordenados alfabeticamente, mesmo filtrando por um deles
		const resLider = await movsRoute.GET({
			request: req(
				'GET',
				`/api/financeiro/movimentacoes?responsavelId=${conselheiroAId}`,
				tokenLider
			),
			url: new URL(
				`https://app.eagles.test/api/financeiro/movimentacoes?responsavelId=${conselheiroAId}`
			),
			locals: {}
		} as any);
		const bodyLider = await resLider.json();
		expect(bodyLider.responsaveis).toEqual([
			{ id: conselheiroAId, nome: 'Conselheiro André' },
			{ id: conselheiroBId, nome: 'Conselheiro Carlos' },
			{ id: liderId, nome: 'Líder Beatriz' }
		]);
		expect(bodyLider.responsaveis.some((r: any) => r.id === masterId)).toBe(false);

		// Conselheiro do PG Águia só vê responsáveis das movimentações do PG Águia (nunca Conselheiro Carlos do PG Falcão)
		const resConsA = await movsRoute.GET({
			request: req('GET', '/api/financeiro/movimentacoes', tokenConselheiroA),
			url: new URL('https://app.eagles.test/api/financeiro/movimentacoes'),
			locals: {}
		} as any);
		const bodyConsA = await resConsA.json();
		expect(bodyConsA.responsaveis).toEqual([
			{ id: conselheiroAId, nome: 'Conselheiro André' },
			{ id: liderId, nome: 'Líder Beatriz' }
		]);
		expect(bodyConsA.responsaveis.some((r: any) => r.id === conselheiroBId)).toBe(false);

		// Membro só vê responsável da própria contribuição (Líder Beatriz)
		const resMembro = await movsRoute.GET({
			request: req('GET', '/api/financeiro/movimentacoes', tokenMembro),
			url: new URL('https://app.eagles.test/api/financeiro/movimentacoes'),
			locals: {}
		} as any);
		const bodyMembro = await resMembro.json();
		expect(bodyMembro.responsaveis).toEqual([{ id: liderId, nome: 'Líder Beatriz' }]);
	});

	it('respeita tipo, categoriaId, responsavelId e de/ate (inclusive YYYY-MM-DD) em GET /api/financeiro/exportar', async () => {
		// Filtro por tipo=saida e responsavelId=conselheiroBId
		const urlResp = `https://app.eagles.test/api/financeiro/exportar?tipo=saida&responsavelId=${conselheiroBId}`;
		const resCsv1 = await exportarRoute.GET({
			request: req(
				'GET',
				`/api/financeiro/exportar?tipo=saida&responsavelId=${conselheiroBId}`,
				tokenLider
			),
			url: new URL(urlResp),
			locals: {}
		} as any);
		expect(resCsv1.status).toBe(200);
		const csv1 = await resCsv1.text();
		expect(csv1).toContain('Café Vigília PG Falcão');
		expect(csv1).not.toContain('Lanche PG Águia');
		expect(csv1).not.toContain('Inscrição Clara Acampamento');

		// Filtro por categoriaId=catEntradaId e mesmo dia de=2026-05-10&ate=2026-05-10
		const qs2 = `categoriaId=${catEntradaId}&de=2026-05-10&ate=2026-05-10`;
		const resCsv2 = await exportarRoute.GET({
			request: req('GET', `/api/financeiro/exportar?${qs2}`, tokenLider),
			url: new URL(`https://app.eagles.test/api/financeiro/exportar?${qs2}`),
			locals: {}
		} as any);
		expect(resCsv2.status).toBe(200);
		const csv2 = await resCsv2.text();
		expect(csv2).toContain('Inscrição Clara Acampamento');
		expect(csv2).not.toContain('Lanche PG Águia');
		expect(csv2).not.toContain('Oferta Anônima Junho');
	});

	it('aceita receiptUrl interno /api/arquivos/<uuid> e rejeita strings inválidas no POST', async () => {
		const caminhoInterno = '/api/arquivos/550e8400-e29b-41d4-a716-446655440000';
		const resInterno = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenLider, {
				kind: 'entrada',
				categoryId: catDoacaoId,
				amountCents: 2500,
				paymentMethod: 'pix',
				description: 'Doação com comprovante interno',
				receiptUrl: caminhoInterno
			}),
			locals: {}
		} as any);
		expect(resInterno.status).toBe(201);
		expect((await resInterno.json()).movimentacao.receiptUrl).toBe(caminhoInterno);

		// URL externa https:// continua aceita
		const resExterno = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenLider, {
				kind: 'entrada',
				categoryId: catDoacaoId,
				amountCents: 1500,
				paymentMethod: 'pix',
				description: 'Doação com link externo',
				receiptUrl: 'https://comprovantes.exemplo.org/recibo-123.pdf'
			}),
			locals: {}
		} as any);
		expect(resExterno.status).toBe(201);

		// Strings inválidas devem falhar com 400
		for (const invalida of [
			'nao-eh-uma-url',
			'javascript:alert(1)',
			'/api/arquivos/nao-e-uuid',
			'/api/outro/550e8400-e29b-41d4-a716-446655440000'
		]) {
			const resInvalida = await movsRoute.POST({
				request: req('POST', '/api/financeiro/movimentacoes', tokenLider, {
					kind: 'entrada',
					categoryId: catDoacaoId,
					amountCents: 1000,
					paymentMethod: 'pix',
					description: 'Tentativa comprovante inválido',
					receiptUrl: invalida
				}),
				locals: {}
			} as any);
			expect(resInvalida.status).toBe(400);
		}
	});
});
