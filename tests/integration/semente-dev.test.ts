/**
 * `npm run db:seed` contra um banco recém-migrado: cria um ambiente coerente
 * com as regras atuais (2 líderes com mandato, conselheiros nos próprios PGs,
 * Master invisível) e pode rodar de novo sem duplicar nada.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, count, eq, isNull } from 'drizzle-orm';
import { join } from 'node:path';
import * as schema from '../../src/lib/server/db/schema';
import { setTestDatabase, type Database } from '../../src/lib/server/db';
import { SENHA_DEV, semearDesenvolvimento } from '../../src/lib/server/bootstrap/semente-dev';
import { resetEnvCache } from '../../src/lib/server/env';
import { resetRateLimits } from '../../src/lib/server/auth/ratelimit';
import * as loginRoute from '../../src/routes/api/auth/login/+server';
import * as grupoRoute from '../../src/routes/api/grupos/[id]/+server';
import * as pessoasRoute from '../../src/routes/api/pessoas/+server';

const { group, groupMember, mandatoLider, person } = schema;

let cliente: PGlite;
let db: Database;

function evento(
	method: string,
	path: string,
	opts: { body?: unknown; token?: string; params?: any } = {}
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
		getClientAddress: () => '203.0.113.70'
	} as any;
}

async function entrar(email: string) {
	const res = await loginRoute.POST(
		evento('POST', '/api/auth/login', { body: { identificador: email, senha: SENHA_DEV } })
	);
	expect(res.status, email).toBe(200);
	return (await res.json()).token as string;
}

const contar = async (tabela: any) => Number((await db.select({ n: count() }).from(tabela))[0]!.n);

describe('semente de desenvolvimento', () => {
	beforeAll(async () => {
		process.env.DATABASE_URL = 'postgres://teste@localhost:5432/teste';
		process.env.PUBLIC_ORIGIN = 'http://localhost:5173';
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

	it('cria pessoas, grupos e os 2 líderes com mandato — e rodar de novo não duplica', async () => {
		const primeira = await semearDesenvolvimento(db);
		expect(primeira).toMatchObject({ criadas: 12, total: 12, grupos: 2 });
		expect(primeira.conviteUrl.startsWith('http://localhost:5173/convite/')).toBe(true);

		const segunda = await semearDesenvolvimento(db);
		expect(segunda.criadas).toBe(0);
		expect(await contar(person)).toBe(12);
		expect(await contar(group)).toBe(2);

		const abertos = await db
			.select({ n: count() })
			.from(mandatoLider)
			.where(isNull(mandatoLider.encerradoEm));
		expect(Number(abertos[0]!.n)).toBe(2);
	});

	it('as contas entram com a senha de desenvolvimento e cada papel vê o que deve', async () => {
		const tokenLider = await entrar('ana@eagles.local');
		const tokenConselheiro = await entrar('pedro@eagles.local');
		await entrar('dev@eagles.local');

		// O conselheiro do PG A vê o próprio grupo com os membros.
		const [pgA] = await db.select({ id: group.id }).from(group).where(eq(group.slug, 'pg-a'));
		const res = await grupoRoute.GET(
			evento('GET', '/x', { token: tokenConselheiro, params: { id: pgA!.id } })
		);
		expect(res.status).toBe(200);
		const membros = (await res.json()).membros.map((m: any) => m.nome);
		expect(membros).toEqual(
			expect.arrayContaining(['Pedro Henrique Vasconcelos', 'Rafael Monteiro'])
		);

		const membrosPgA = await db
			.select({ n: count() })
			.from(groupMember)
			.where(and(eq(groupMember.groupId, pgA!.id)));
		expect(Number(membrosPgA[0]!.n)).toBe(4);

		// O Master não aparece para a liderança.
		const pessoas = await (
			await pessoasRoute.GET(evento('GET', '/api/pessoas', { token: tokenLider }))
		).json();
		expect(pessoas.pessoas.some((p: any) => p.nome === 'Dev Master')).toBe(false);
		expect(pessoas.pessoas).toHaveLength(11);
	});
});
