/**
 * Primeiro acesso em produção (deploy/primeiro-master.ts) contra um banco
 * recém-migrado e VAZIO — sem a semeadura dos testes, como na VPS.
 *
 * Prova o caminho inteiro: catálogo criado, convite do Master, o Master define a
 * senha pela rota real, entra, e nomeia o primeiro líder.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { count, eq } from 'drizzle-orm';
import { join } from 'node:path';
import * as schema from '../../src/lib/server/db/schema';
import { setTestDatabase, type Database } from '../../src/lib/server/db';
import { garantirCatalogo, FUNCIONALIDADES } from '../../src/lib/server/bootstrap/catalogo';
import { convidarMaster } from '../../src/lib/server/bootstrap/primeiro-master';
import { ALL_PERMISSIONS } from '../../src/lib/server/policy/permissions';
import { ROLE_SEEDS } from '../../src/lib/server/policy/roles';
import { resetRateLimits } from '../../src/lib/server/auth/ratelimit';
import { resetEnvCache } from '../../src/lib/server/env';

import * as conviteRoute from '../../src/routes/api/auth/convite/[token]/+server';
import * as loginRoute from '../../src/routes/api/auth/login/+server';
import * as inicioRoute from '../../src/routes/api/inicio/+server';
import * as pessoasRoute from '../../src/routes/api/pessoas/+server';
import * as liderancaRoute from '../../src/routes/api/lideranca/+server';

const { featureFlag, permission, person, role, rolePermission, team } = schema;

let cliente: PGlite;
let jwtMaster: string;
let db: Database;

const SENHA = 'a primeira senha do lider';

function evento(
	method: string,
	path: string,
	opts: { body?: unknown; params?: any; token?: string }
) {
	return {
		request: new Request(`https://api.eagles.test${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {})
			},
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
		}),
		params: opts.params ?? {},
		locals: {},
		url: new URL(`https://api.eagles.test${path}`),
		getClientAddress: () => '203.0.113.30'
	} as any;
}

async function contar(tabela: any) {
	const [linha] = await db.select({ n: count() }).from(tabela);
	return Number(linha!.n);
}

describe('primeiro acesso num banco vazio', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'https://eagles.web.app';
		process.env.NODE_ENV = 'test';
		resetEnvCache();
		resetRateLimits();

		cliente = new PGlite();
		db = drizzle(cliente, { schema }) as unknown as Database;
		await migrate(db as never, {
			migrationsFolder: join(process.cwd(), 'src', 'lib', 'server', 'db', 'migrations')
		});
		setTestDatabase(db);
	}, 60_000);

	afterAll(async () => {
		setTestDatabase(null);
		await cliente?.close();
	});

	it('o banco recém-migrado não tem equipe nem papéis (por isso o script existe)', async () => {
		expect(await contar(team)).toBe(0);
		expect(await contar(role)).toBe(0);
	});

	it('garantirCatalogo é idempotente e respeita ajustes feitos nos papéis', async () => {
		const primeiro = await garantirCatalogo(db);
		expect(await contar(permission)).toBe(ALL_PERMISSIONS.length);
		expect(await contar(role)).toBe(ROLE_SEEDS.length);
		const flags = await db.select({ enabled: featureFlag.enabled }).from(featureFlag);
		expect(flags).toHaveLength(FUNCIONALIDADES.length);
		expect(flags.every((f) => !f.enabled)).toBe(true);

		// A liderança tira uma permissão do conselheiro pela administração...
		await db.delete(rolePermission).where(eq(rolePermission.roleId, primeiro.papeis.conselheiro!));
		const permissoesAntes = await contar(rolePermission);

		// ...e rodar de novo não a devolve nem duplica nada.
		const segundo = await garantirCatalogo(db);
		expect(segundo).toEqual(primeiro);
		expect(await contar(team)).toBe(1);
		expect(await contar(role)).toBe(ROLE_SEEDS.length);
		expect(await contar(rolePermission)).toBe(permissoesAntes);
	});

	it('convida o Master, que define a senha, entra com o e-mail e tem o catálogo inteiro', async () => {
		const resultado = await convidarMaster(db, { nome: 'Dev Master', email: 'Dev@Exemplo.com' });
		expect(resultado.ok).toBe(true);
		if (!resultado.ok) return;
		expect(resultado.convite.url.startsWith('https://eagles.web.app/convite/')).toBe(true);

		// Rodar de novo antes do aceite só renova o convite, sem duplicar a pessoa.
		const renovado = await convidarMaster(db, { nome: 'Dev Master', email: 'dev@exemplo.com' });
		expect(renovado.ok && renovado.personId).toBe(resultado.personId);
		expect(await contar(person)).toBe(1);
		if (!renovado.ok) return;

		// O primeiro convite foi revogado ao emitir o segundo.
		const antigo = await conviteRoute.GET(
			evento('GET', '/api/auth/convite/x', { params: { token: resultado.convite.token } })
		);
		expect((await antigo.json()).estado).toBe('invalido');

		const token = renovado.convite.token;
		const aceite = await conviteRoute.POST(
			evento('POST', `/api/auth/convite/${token}`, {
				params: { token },
				body: { senha: SENHA, confirmacao: SENHA }
			})
		);
		expect(aceite.status).toBe(201);

		const login = await loginRoute.POST(
			evento('POST', '/api/auth/login', {
				body: { identificador: 'dev@exemplo.com', senha: SENHA }
			})
		);
		expect(login.status).toBe(200);
		jwtMaster = (await login.json()).token;

		const inicio = await (
			await inicioRoute.GET(evento('GET', '/api/inicio', { token: jwtMaster }))
		).json();
		expect(inicio.papeis).toEqual(['master']);
		expect([...inicio.permissoes].sort()).toEqual([...ALL_PERMISSIONS].sort());
		// Sem líderes ainda: o Início avisa o Master.
		expect(inicio.avisoLideranca).toBe('A equipe está sem líderes. Nomeie em Liderança.');
	});

	it('o Master cadastra e nomeia o primeiro líder, e continua invisível na lista', async () => {
		const criado = await pessoasRoute.POST(
			evento('POST', '/api/pessoas', {
				token: jwtMaster,
				body: { nome: 'Ana Líder', telefone: '91988887777' }
			})
		);
		expect(criado.status).toBe(201);
		const anaId = (await criado.json()).pessoa.id;

		const nomeado = await liderancaRoute.POST(
			evento('POST', '/api/lideranca', { token: jwtMaster, body: { personId: anaId } })
		);
		expect(nomeado.status).toBe(201);

		const lista = await (
			await pessoasRoute.GET(evento('GET', '/api/pessoas', { token: jwtMaster }))
		).json();
		expect(lista.pessoas.map((p: any) => p.nome)).toEqual(['Ana Líder']);
	});

	it('com um Master ativo, recusa criar outro (a não ser com forcar)', async () => {
		const recusa = await convidarMaster(db, { nome: 'Intruso', email: 'x@exemplo.com' });
		expect(recusa).toEqual({ ok: false, motivo: 'master_ja_existe' });

		const forcado = await convidarMaster(db, {
			nome: 'Dev Novo',
			email: 'devnovo@exemplo.com',
			forcar: true
		});
		expect(forcado.ok).toBe(true);
	});
});
