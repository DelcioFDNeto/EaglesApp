import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

/**
 * Tipo agnóstico de driver, de propósito.
 *
 * Em produção o driver é o postgres.js; nos testes é o PGlite (Postgres
 * compilado para WASM). Amarrar as assinaturas a `PostgresJsDatabase` obrigaria
 * a duplicar código ou a fazer casts nos testes — e teste que precisa de cast
 * para chamar a função real não testa a função real.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

let client: postgres.Sql | null = null;
let database: Database | null = null;
let testDatabaseOverride: Database | null = null;

/**
 * Permite injetar o banco PGlite nos testes de integração para testar
 * os handlers reais das rotas contra PostgreSQL em memória.
 */
export function setTestDatabase(override: Database | null): void {
	if (process.env.NODE_ENV !== 'test') {
		throw new Error('setTestDatabase só pode ser usado em NODE_ENV=test');
	}
	testDatabaseOverride = override;
}

/**
 * Conexão com o PostgreSQL de produção/desenvolvimento.
 *
 * Nos testes a conexão NÃO passa por aqui: `tests/integration/helpers/db.ts`
 * monta um PGlite (Postgres compilado para WASM) em memória. É o mesmo motor
 * e a mesma sintaxe, sem exigir Docker na máquina de quem desenvolve.
 */
export function db(): Database {
	if (testDatabaseOverride) return testDatabaseOverride;
	if (database) return database;

	const { DATABASE_URL } = env();

	client = postgres(DATABASE_URL, {
		// Uma VPS pequena não ganha nada com pool grande, e perde memória.
		max: 10,
		idle_timeout: 20,
		connect_timeout: 10,
		// Datas voltam como string; a conversão é explícita na camada de serviço.
		types: {
			date: {
				to: 1184,
				from: [1082, 1114, 1184],
				serialize: (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)),
				parse: (v: string) => v
			}
		}
	});

	database = drizzle(client, { schema });
	return database;
}

export async function closeDb(): Promise<void> {
	if (client) {
		await client.end({ timeout: 5 });
		client = null;
		database = null;
	}
}

export { schema };
