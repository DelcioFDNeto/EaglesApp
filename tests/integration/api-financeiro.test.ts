/**
 * Testes de integração reais do M09 (Financeiro) contra PGlite.
 * Cobre RN-20, RN-21 (trigger imutável + estorno), RN-22 (mínimo vs doação),
 * RN-23/RN-29 (aprovação opcional), RN-24 (matriz dos 4 papéis) e RF-08.11 (CSV).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	auditLog,
	featureFlag,
	financeTransaction,
	group as groupTable,
	person as personTable,
	personRole as personRoleTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as categoriasRoute from '../../src/routes/api/financeiro/categorias/+server';
import * as regrasRoute from '../../src/routes/api/financeiro/regras/+server';
import * as movsRoute from '../../src/routes/api/financeiro/movimentacoes/+server';
import * as estornarRoute from '../../src/routes/api/financeiro/movimentacoes/[id]/estornar/+server';
import * as aprovarRoute from '../../src/routes/api/financeiro/movimentacoes/[id]/aprovar/+server';
import * as exportarRoute from '../../src/routes/api/financeiro/exportar/+server';

let ctx: BancoDeTeste;
let liderId: string;
let conselheiroAId: string;
let membroId: string;
let visitanteId: string;
let tokenLider: string;
let tokenConselheiroA: string;
let tokenMembro: string;
let tokenVisitante: string;
let grupoAId: string;
let grupoBId: string;
let catContribId: string;
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

describe('M09 — Financeiro (RN-20 a RN-25, RN-28, RN-29)', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const [gA] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Azul', slug: 'pg-azul' })
			.returning({ id: groupTable.id });
		const [gB] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Verde', slug: 'pg-verde' })
			.returning({ id: groupTable.id });
		grupoAId = gA!.id;
		grupoBId = gB!.id;

		liderId = await criarPessoa('Líder Ana', 'ana@eagles.test', ctx.papeis.lider!, 'global');
		conselheiroAId = await criarPessoa(
			'Conselheiro João',
			'joao@eagles.test',
			ctx.papeis.conselheiro!,
			'group',
			grupoAId
		);
		membroId = await criarPessoa('Membro Pedro', 'pedro@eagles.test', ctx.papeis.membro!, 'self');
		visitanteId = await criarPessoa(
			'Visitante Lucas',
			'lucas@eagles.test',
			ctx.papeis.visitante!,
			'self'
		);

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenConselheiroA = await tokenPara(ctx.db, conselheiroAId);
		tokenMembro = await tokenPara(ctx.db, membroId);
		tokenVisitante = await tokenPara(ctx.db, visitanteId);

		// Cria categorias base como líder
		const rContrib = await categoriasRoute.POST({
			request: req('POST', '/api/financeiro/categorias', tokenLider, {
				name: 'Contribuição mensal',
				slug: 'contribuicao-mensal',
				kind: 'entrada',
				isDonation: false
			}),
			locals: {}
		} as any);
		catContribId = (await rContrib.json()).categoria.id;

		const rDoacao = await categoriasRoute.POST({
			request: req('POST', '/api/financeiro/categorias', tokenLider, {
				name: 'Doação livre',
				slug: 'doacao-livre',
				kind: 'entrada',
				isDonation: true
			}),
			locals: {}
		} as any);
		catDoacaoId = (await rDoacao.json()).categoria.id;

		const rDespesa = await categoriasRoute.POST({
			request: req('POST', '/api/financeiro/categorias', tokenLider, {
				name: 'Lanche do PG',
				slug: 'lanche-pg',
				kind: 'saida'
			}),
			locals: {}
		} as any);
		catDespesaId = (await rDespesa.json()).categoria.id;
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('aplica RN-22: exige mínimo em contribuição mas proíbe mínimo em doação', async () => {
		// Doação NUNCA pode ter valor mínimo
		const resDoacaoMin = await regrasRoute.POST({
			request: req('POST', '/api/financeiro/regras', tokenLider, {
				categoryId: catDoacaoId,
				roleKey: 'membro',
				minAmountCents: 2000
			}),
			locals: {}
		} as any);
		expect(resDoacaoMin.status).toBe(400);

		// Contribuição pode ter valor mínimo (R$ 50,00)
		const resRegra = await regrasRoute.POST({
			request: req('POST', '/api/financeiro/regras', tokenLider, {
				categoryId: catContribId,
				roleKey: 'membro',
				minAmountCents: 5000,
				period: 'mensal'
			}),
			locals: {}
		} as any);
		expect(resRegra.status).toBe(201);

		// Contribuição abaixo do mínimo (R$ 30,00) é recusada
		const resAbaixo = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenLider, {
				kind: 'entrada',
				categoryId: catContribId,
				amountCents: 3000,
				paymentMethod: 'pix',
				description: 'Contribuição abaixo do mínimo',
				personId: membroId
			}),
			locals: {}
		} as any);
		expect(resAbaixo.status).toBe(400);

		// Contribuição de R$ 50,00 é aceita
		const resOk = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenLider, {
				kind: 'entrada',
				categoryId: catContribId,
				amountCents: 5000,
				paymentMethod: 'pix',
				description: 'Contribuição mensal Pedro',
				personId: membroId
			}),
			locals: {}
		} as any);
		expect(resOk.status).toBe(201);

		// Doação de R$ 5,00 é sempre aceita
		const resDoacao = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenLider, {
				kind: 'entrada',
				categoryId: catDoacaoId,
				amountCents: 500,
				paymentMethod: 'especie',
				description: 'Oferta livre'
			}),
			locals: {}
		} as any);
		expect(resDoacao.status).toBe(201);
	});

	it('aplica RN-24 (visibilidade por nível), RN-25 (despesa de PG) e RF-08.11 (CSV)', async () => {
		// Visitante tem ZERO acesso financeiro (403)
		const resVis = await movsRoute.GET({
			request: req('GET', '/api/financeiro/movimentacoes', tokenVisitante),
			url: new URL('https://app.eagles.test/api/financeiro/movimentacoes'),
			locals: {}
		} as any);
		expect(resVis.status).toBe(403);

		// Conselheiro do PG Azul NÃO pode lançar despesa no PG Verde (403)
		const resOutroPg = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenConselheiroA, {
				kind: 'saida',
				categoryId: catDespesaId,
				amountCents: 1500,
				paymentMethod: 'pix',
				description: 'Lanche PG Verde',
				groupId: grupoBId
			}),
			locals: {}
		} as any);
		expect(resOutroPg.status).toBe(403);

		// Conselheiro do PG Azul lança despesa no PG Azul → entra direto confirmada (flag desligada, RN-29)
		const resPgA = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenConselheiroA, {
				kind: 'saida',
				categoryId: catDespesaId,
				amountCents: 1500,
				paymentMethod: 'pix',
				description: 'Lanche PG Azul',
				groupId: grupoAId
			}),
			locals: {}
		} as any);
		expect(resPgA.status).toBe(201);
		expect((await resPgA.json()).movimentacao.status).toBe('confirmada');

		// Membro vê SOMENTE a própria contribuição (R$ 50,00), nunca a doação anônima ou despesa do PG
		const bodyMembro = await (
			await movsRoute.GET({
				request: req('GET', '/api/financeiro/movimentacoes', tokenMembro),
				url: new URL('https://app.eagles.test/api/financeiro/movimentacoes'),
				locals: {}
			} as any)
		).json();
		expect(bodyMembro.escopoVisibilidade).toBe('own');
		expect(bodyMembro.movimentacoes).toHaveLength(1);
		expect(bodyMembro.resumo.arrecadadoCents).toBe(5000);

		// Exportação CSV como líder contém todos os lançamentos
		const resCsv = await exportarRoute.GET({
			request: req('GET', '/api/financeiro/exportar', tokenLider),
			url: new URL('https://app.eagles.test/api/financeiro/exportar'),
			locals: {}
		} as any);
		expect(resCsv.status).toBe(200);
		expect(resCsv.headers.get('content-type')).toContain('text/csv');
		const csvText = await resCsv.text();
		expect(csvText).toContain('Lanche PG Azul');
		expect(csvText).toContain('Contribuição mensal Pedro');
	});

	it('garante imutabilidade no banco e estorno único rastreável (RN-21) + aprovação opcional (RN-23)', async () => {
		// Lança entrada de R$ 100,00
		const resTx = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenLider, {
				kind: 'entrada',
				categoryId: catDoacaoId,
				amountCents: 10000,
				paymentMethod: 'pix',
				description: 'Doação duplicada por engano'
			}),
			locals: {}
		} as any);
		const txId = (await resTx.json()).movimentacao.id;

		// Banco RECUSA delete físico e update de valor em movimentação confirmada (RN-21)
		await expect(
			ctx.db.delete(financeTransaction).where(eq(financeTransaction.id, txId))
		).rejects.toThrow(/estorno|RN-21/i);
		await expect(
			ctx.db
				.update(financeTransaction)
				.set({ amountCents: 1 })
				.where(eq(financeTransaction.id, txId))
		).rejects.toThrow(/imutável|RN-21/i);

		// Conselheiro sem finance.reverse não pode estornar (403)
		const resEstornoNegado = await estornarRoute.POST({
			request: req('POST', `/api/financeiro/movimentacoes/${txId}/estornar`, tokenConselheiroA, {
				motivo: 'Tentativa sem permissão'
			}),
			params: { id: txId },
			locals: {}
		} as any);
		expect(resEstornoNegado.status).toBe(403);

		// Líder estorna corretamente e não consegue estornar duas vezes
		const resEstorno = await estornarRoute.POST({
			request: req('POST', `/api/financeiro/movimentacoes/${txId}/estornar`, tokenLider, {
				motivo: 'Lançamento em duplicidade'
			}),
			params: { id: txId },
			locals: {}
		} as any);
		expect(resEstorno.status).toBe(201);

		const resEstornoDuplo = await estornarRoute.POST({
			request: req('POST', `/api/financeiro/movimentacoes/${txId}/estornar`, tokenLider, {
				motivo: 'Segunda tentativa'
			}),
			params: { id: txId },
			locals: {}
		} as any);
		expect(resEstornoDuplo.status).toBe(400);

		// Liga feature flag aprovacao_despesas (RN-23) → despesa de conselheiro entra pendente
		await ctx.db.insert(featureFlag).values({
			teamId: ctx.teamId,
			key: 'aprovacao_despesas',
			enabled: true
		});

		const resPend = await movsRoute.POST({
			request: req('POST', '/api/financeiro/movimentacoes', tokenConselheiroA, {
				kind: 'saida',
				categoryId: catDespesaId,
				amountCents: 4000,
				paymentMethod: 'pix',
				description: 'Compra de cadeiras PG Azul',
				groupId: grupoAId
			}),
			locals: {}
		} as any);
		expect(resPend.status).toBe(201);
		const pendTx = (await resPend.json()).movimentacao;
		expect(pendTx.status).toBe('pendente_aprovacao');

		// Líder aprova despesa → passa a confirmada e grava audit_log
		const resAprovar = await aprovarRoute.POST({
			request: req('POST', `/api/financeiro/movimentacoes/${pendTx.id}/aprovar`, tokenLider, {
				decisao: 'aprovar'
			}),
			params: { id: pendTx.id },
			locals: {}
		} as any);
		expect(resAprovar.status).toBe(200);
		expect((await resAprovar.json()).movimentacao.status).toBe('confirmada');

		const logs = await ctx.db.select().from(auditLog).where(eq(auditLog.entityId, pendTx.id));
		expect(logs.some((l) => l.action === 'finance.transaction_approved')).toBe(true);
	});
});
