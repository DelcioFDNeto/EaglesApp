/**
 * Testes de integração reais do M11 (Administração) e M03 (RBAC) contra PGlite.
 * Cobre RF-03.2, RF-03.3, RF-03.4, RF-11.1, RF-11.2, RN-28 e RN-29.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoDeTeste, type BancoDeTeste } from './helpers/banco';
import { setTestDatabase } from '../../src/lib/server/db';
import {
	group as groupTable,
	person as personTable,
	personRole as personRoleTable,
	userAccount as userAccountTable
} from '../../src/lib/server/db/schema';
import { hashPassword } from '../../src/lib/server/auth/password';
import { tokenPara } from './helpers/token';
import { resetEnvCache } from '../../src/lib/server/env';

import * as flagsRoute from '../../src/routes/api/admin/flags/+server';
import * as papeisRoute from '../../src/routes/api/admin/papeis/+server';
import * as papelIdRoute from '../../src/routes/api/admin/papeis/[id]/+server';
import * as atribuicoesRoute from '../../src/routes/api/admin/atribuicoes/+server';
import * as atribuicaoIdRoute from '../../src/routes/api/admin/atribuicoes/[id]/+server';
import * as auditoriaRoute from '../../src/routes/api/admin/auditoria/+server';

let ctx: BancoDeTeste;
let liderId: string;
let membroId: string;
let tokenLider: string;
let tokenMembro: string;
let grupoId: string;

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

describe('M11 — Administração (feature flags, RBAC e auditoria imutável)', () => {
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

		liderId = await criarPessoa('Líder Ana', 'ana@eagles.test', ctx.papeis.lider!, 'global');
		membroId = await criarPessoa('Membro Pedro', 'pedro@eagles.test', ctx.papeis.membro!, 'self');

		tokenLider = await tokenPara(ctx.db, liderId);
		tokenMembro = await tokenPara(ctx.db, membroId);
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await ctx?.fechar();
	});

	it('bloqueia acesso de membro comum (403) e alterna feature flags gravando auditoria (RN-28/RN-29)', async () => {
		// Membro comum não acessa flags, papéis nem auditoria
		expect(
			(
				await flagsRoute.GET({
					request: req('GET', '/api/admin/flags', tokenMembro),
					locals: {}
				} as any)
			).status
		).toBe(403);

		expect(
			(
				await papeisRoute.GET({
					request: req('GET', '/api/admin/papeis', tokenMembro),
					locals: {}
				} as any)
			).status
		).toBe(403);

		expect(
			(
				await auditoriaRoute.GET({
					request: req('GET', '/api/admin/auditoria', tokenMembro),
					url: new URL('https://app.eagles.test/api/admin/auditoria'),
					locals: {}
				} as any)
			).status
		).toBe(403);

		// Por padrão todas as flags nascem desligadas (RN-29)
		const resFlags = await flagsRoute.GET({
			request: req('GET', '/api/admin/flags', tokenLider),
			locals: {}
		} as any);
		expect(resFlags.status).toBe(200);
		const inicial = await resFlags.json();
		expect(inicial.flags.every((f: any) => f.enabled === false)).toBe(true);

		// Líder liga checkin_qrcode
		const resPut = await flagsRoute.PUT({
			request: req('PUT', '/api/admin/flags', tokenLider, {
				key: 'checkin_qrcode',
				enabled: true
			}),
			locals: {}
		} as any);
		expect(resPut.status).toBe(200);

		const resAud = await auditoriaRoute.GET({
			request: req('GET', '/api/admin/auditoria?entidade=feature_flag', tokenLider),
			url: new URL('https://app.eagles.test/api/admin/auditoria?entidade=feature_flag'),
			locals: {}
		} as any);
		expect(resAud.status).toBe(200);
		const aud = await resAud.json();
		expect(aud.registros.some((r: any) => r.action === 'settings.feature_flag_updated')).toBe(true);
	});

	it('protege papéis de sistema, bloqueia auto-bloqueio de rbac.manage e gerencia papel personalizado + atribuições', async () => {
		// Não permite excluir papel básico do sistema (lider)
		const resDelSys = await papelIdRoute.DELETE({
			request: req('DELETE', `/api/admin/papeis/${ctx.papeis.lider}`, tokenLider),
			params: { id: ctx.papeis.lider! },
			locals: {}
		} as any);
		expect(resDelSys.status).toBe(400);

		// Impede o único líder global de remover `rbac.manage` do próprio papel
		const resLockout = await papelIdRoute.PUT({
			request: req('PUT', `/api/admin/papeis/${ctx.papeis.lider}`, tokenLider, {
				permissions: ['event.view']
			}),
			params: { id: ctx.papeis.lider! },
			locals: {}
		} as any);
		expect(resLockout.status).toBe(400);

		// Cria papel personalizado (RF-03.4)
		const resCriar = await papeisRoute.POST({
			request: req('POST', '/api/admin/papeis', tokenLider, {
				key: 'tesoureiro',
				name: 'Tesoureiro',
				description: 'Apoio financeiro',
				permissions: ['finance.view_all', 'finance.create']
			}),
			locals: {}
		} as any);
		expect(resCriar.status).toBe(201);
		const { papel: tesoureiro } = await resCriar.json();

		// Atribui papel com escopo de grupo a membroId (RF-03.2)
		const resAtrib = await atribuicoesRoute.POST({
			request: req('POST', '/api/admin/atribuicoes', tokenLider, {
				personId: membroId,
				roleId: tesoureiro.id,
				scopeType: 'group',
				scopeId: grupoId
			}),
			locals: {}
		} as any);
		expect(resAtrib.status).toBe(201);
		const { atribuicao } = await resAtrib.json();

		// Revoga atribuição e exclui papel personalizado
		const resRev = await atribuicaoIdRoute.DELETE({
			request: req('DELETE', `/api/admin/atribuicoes/${atribuicao.id}`, tokenLider),
			params: { id: atribuicao.id },
			locals: {}
		} as any);
		expect(resRev.status).toBe(200);

		const resDelCustom = await papelIdRoute.DELETE({
			request: req('DELETE', `/api/admin/papeis/${tesoureiro.id}`, tokenLider),
			params: { id: tesoureiro.id },
			locals: {}
		} as any);
		expect(resDelCustom.status).toBe(200);
	});
});
