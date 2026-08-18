import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { join } from 'node:path';
import * as schema from '../../../src/lib/server/db/schema';
import type { Database } from '../../../src/lib/server/db';
import { ALL_PERMISSIONS, PERMISSIONS } from '../../../src/lib/server/policy/permissions';
import { ROLE_SEEDS } from '../../../src/lib/server/policy/roles';
import { permission, role, rolePermission, team } from '../../../src/lib/server/db/schema';

/**
 * Banco de teste: PostgreSQL de verdade, sem Docker.
 *
 * PGlite é o próprio Postgres compilado para WebAssembly. Roda em memória,
 * sobe em poucos segundos e aceita as mesmas migrações que a produção — view,
 * gatilho, constraint CHECK, índice parcial, tudo.
 *
 * Isso importa mais do que parece: um teste contra SQLite ou contra mock
 * passaria feliz enquanto a migração real quebra na VPS. Aqui, se o gatilho
 * append-only da auditoria não funcionar, o teste falha na máquina de quem
 * desenvolve, antes do deploy.
 */

const PASTA_MIGRACOES = join(process.cwd(), 'src', 'lib', 'server', 'db', 'migrations');

export type BancoDeTeste = {
	db: Database;
	cliente: PGlite;
	teamId: string;
	papeis: Record<string, string>;
	fechar: () => Promise<void>;
};

export async function criarBancoDeTeste(): Promise<BancoDeTeste> {
	const cliente = new PGlite();
	const db = drizzle(cliente, { schema }) as unknown as Database;

	await migrate(db as never, { migrationsFolder: PASTA_MIGRACOES });

	// --- Semeadura mínima: equipe, catálogo de permissões e papéis ----------

	const [equipe] = await db
		.insert(team)
		.values({ slug: 'eagles', name: 'Eagles' })
		.returning({ id: team.id });

	if (!equipe) throw new Error('não foi possível semear a equipe');

	await db
		.insert(permission)
		.values(ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSIONS[key] })));

	const papeis: Record<string, string> = {};

	for (const semente of ROLE_SEEDS) {
		const [criado] = await db
			.insert(role)
			.values({
				teamId: equipe.id,
				key: semente.key,
				name: semente.name,
				description: semente.description,
				isSystem: semente.isSystem
			})
			.returning({ id: role.id });

		if (!criado) throw new Error(`não foi possível semear o papel ${semente.key}`);
		papeis[semente.key] = criado.id;

		await db
			.insert(rolePermission)
			.values(semente.permissions.map((p) => ({ roleId: criado.id, permissionKey: p })));
	}

	return {
		db,
		cliente,
		teamId: equipe.id,
		papeis,
		fechar: () => cliente.close()
	};
}
