/**
 * Testes de integração reais do M07 (Responsabilidades e Escalas) contra PGlite.
 * Cobre RN-16, RN-17, RN-18, RN-19 e RF-07.1 a RF-07.6.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	escala,
	escalaHistorico,
	event as eventTable,
	eventType,
	group as groupTable,
	groupMember,
	person as personTable,
	personRole as personRoleTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as respRoute from '../../src/routes/api/responsabilidades/+server';
import * as respIdRoute from '../../src/routes/api/responsabilidades/[id]/+server';
import * as escalasRoute from '../../src/routes/api/escalas/+server';
import * as escalaIdRoute from '../../src/routes/api/escalas/[id]/+server';
import * as minhasEscalasRoute from '../../src/routes/api/escalas/minhas/+server';
import * as gerarEscalaRoute from '../../src/routes/api/escalas/gerar/+server';
import * as confirmarEscalaRoute from '../../src/routes/api/escalas/confirmar/+server';

let ctx: BancoDeTeste;
let liderId: string;
let membro1Id: string;
let membro2Id: string;
let tokenLider: string;
let tokenMembro1: string;
let grupoId: string;
let eventoId: string;

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

async function criarPessoa(nome: string, email: string, roleId: string, scopeType: 'global' | 'self') {
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
		scopeId: null
	});

	return p!.id;
}

describe('M07 — Responsabilidades e Escalas', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://app.eagles.test';
		process.env.NODE_ENV = 'test';
		resetEnvCache();

		ctx = await criarBancoDeTeste();
		setTestDatabase(ctx.db);

		const [g] = await ctx.db
			.insert(groupTable)
			.values({ teamId: ctx.teamId, name: 'PG Azul', slug: 'pg-azul' })
			.returning({ id: groupTable.id });
		grupoId = g!.id;

		liderId = await criarPessoa('Líder Lucas', 'lucas@eagles.test', ctx.papeis.lider!, 'global');
		membro1Id = await criarPessoa('Membro Pedro', 'pedro@eagles.test', ctx.papeis.membro!, 'self');
		membro2Id = await criarPessoa('Membro Maria', 'maria@eagles.test', ctx.papeis.membro!, 'self');

		await ctx.db.insert(groupMember).values([
			{ groupId: grupoId, personId: membro1Id, roleKey: 'membro' },
			{ groupId: grupoId, personId: membro2Id, roleKey: 'membro' }
		]);

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenMembro1 = await tokenPara(ctx.db, membro1Id);

		const [te] = await ctx.db
			.insert(eventType)
			.values({ teamId: ctx.teamId, name: 'PG Semanal', slug: 'pg-semanal' })
			.returning({ id: eventType.id });

		const [ev] = await ctx.db
			.insert(eventTable)
			.values({
				teamId: ctx.teamId,
				eventTypeId: te!.id,
				groupId: grupoId,
				title: 'PG Azul — Semana 1',
				startsAt: new Date(Date.now() + 86_400_000)
			})
			.returning({ id: eventTable.id });
		eventoId = ev!.id;
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('gerencia tipos configuráveis (RN-16) respeitando RBAC', async () => {
		// Membro não pode criar tipo
		const resNegado = await respRoute.POST({
			request: req('POST', '/api/responsabilidades', tokenMembro1, { nome: 'Mensagem' }),
			locals: {}
		} as any);
		expect(resNegado.status).toBe(403);

		// Líder cria tipos com intervalo mínimo (RF-07.6)
		const resMensagem = await respRoute.POST({
			request: req('POST', '/api/responsabilidades', tokenLider, {
				nome: 'Mensagem',
				descricao: 'Palavra principal do encontro',
				intervaloMinimoDias: 21
			}),
			locals: {}
		} as any);
		expect(resMensagem.status).toBe(201);
		const { responsabilidade: rMensagem } = await resMensagem.json();
		expect(rMensagem.intervaloMinimoDias).toBe(21);

		const resMusica = await respRoute.POST({
			request: req('POST', '/api/responsabilidades', tokenLider, {
				nome: 'Música',
				intervaloMinimoDias: 14
			}),
			locals: {}
		} as any);
		expect(resMusica.status).toBe(201);

		// Atualiza tipo via PUT
		const resPut = await respIdRoute.PUT({
			request: req('PUT', `/api/responsabilidades/${rMensagem.id}`, tokenLider, {
				intervaloMinimoDias: 28
			}),
			params: { id: rMensagem.id },
			locals: {}
		} as any);
		expect(resPut.status).toBe(200);
		const atualizado = await resPut.json();
		expect(atualizado.responsabilidade.intervaloMinimoDias).toBe(28);

		// Membro consegue listar tipos (somente leitura)
		const resList = await respRoute.GET({
			request: req('GET', '/api/responsabilidades', tokenMembro1),
			url: new URL('https://app.eagles.test/api/responsabilidades'),
			locals: {}
		} as any);
		expect(resList.status).toBe(200);
		const lista = await resList.json();
		expect(lista.podeGerenciar).toBe(false);
		expect(lista.responsabilidades.length).toBeGreaterThanOrEqual(2);
	});

	it('gera proposta (RN-18), exige confirmação humana, permite troca (RF-07.5) e aparece em Minhas (RF-07.3)', async () => {
		// Gera proposta automática
		const resGerar = await gerarEscalaRoute.POST({
			request: req('POST', '/api/escalas/gerar', tokenLider, { eventoId }),
			locals: {}
		} as any);
		expect(resGerar.status).toBe(201);
		const gerada = await resGerar.json();
		expect(gerada.propostaId).toBeTruthy();
		expect(gerada.itens.length).toBeGreaterThanOrEqual(2);
		expect(gerada.itens.every((i: any) => i.status === 'proposta' && i.origem === 'gerada')).toBe(true);

		// Confirma proposta explicitamente
		const resConfirmar = await confirmarEscalaRoute.POST({
			request: req('POST', '/api/escalas/confirmar', tokenLider, {
				propostaId: gerada.propostaId
			}),
			locals: {}
		} as any);
		expect(resConfirmar.status).toBe(200);
		const conf = await resConfirmar.json();
		expect(conf.confirmadas).toBe(gerada.itens.length);

		// Lista escalas do evento via ?eventoId=...
		const resEscalas = await escalasRoute.GET({
			request: req('GET', `/api/escalas?eventoId=${eventoId}`, tokenMembro1),
			url: new URL(`https://app.eagles.test/api/escalas?eventoId=${eventoId}`),
			locals: {}
		} as any);
		expect(resEscalas.status).toBe(200);
		const { escalas } = await resEscalas.json();
		expect(escalas.every((e: any) => e.status === 'confirmada')).toBe(true);

		// Troca o responsável da primeira escala (RF-07.5)
		const primeira = escalas[0];
		const substituto = primeira.personId === membro1Id ? membro2Id : membro1Id;

		const resTroca = await escalaIdRoute.PATCH({
			request: req('PATCH', `/api/escalas/${primeira.id}`, tokenLider, {
				acao: 'trocar',
				novoPersonId: substituto,
				motivo: 'Viagem de trabalho'
			}),
			params: { id: primeira.id },
			locals: {}
		} as any);
		expect(resTroca.status).toBe(200);

		const [antiga] = await ctx.db.select().from(escala).where(eq(escala.id, primeira.id));
		expect(antiga?.status).toBe('trocada');
		expect(antiga?.substituidoPorPersonId).toBe(substituto);

		const historico = await ctx.db
			.select()
			.from(escalaHistorico)
			.where(eq(escalaHistorico.escalaId, primeira.id));
		expect(historico.some((h) => h.acao === 'trocada')).toBe(true);

		// Visão "Minhas responsabilidades" (RF-07.3): o substituto vê a nova atribuição e quem foi trocado não vê o item trocado
		const tokenSubstituto = await tokenPara(ctx.db, substituto);
		const resMinhas = await minhasEscalasRoute.GET({
			request: req('GET', '/api/escalas/minhas', tokenSubstituto),
			locals: {}
		} as any);
		expect(resMinhas.status).toBe(200);
		const minhas = await resMinhas.json();
		expect(minhas.escalas.length).toBeGreaterThanOrEqual(1);
		expect(minhas.escalas.every((e: any) => e.status !== 'trocada')).toBe(true);
	});
});
