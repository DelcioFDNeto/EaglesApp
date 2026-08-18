import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { join } from 'node:path';

/**
 * Aplica as migrações pendentes.
 *
 * Roda no deploy, antes de trocar as réplicas do app. Se falhar, o deploy para
 * e a versão anterior continua no ar — é por isso que este script sai com
 * código diferente de zero em vez de apenas registrar o erro.
 */

const url = process.env.DATABASE_URL;

if (!url) {
	console.error('DATABASE_URL não definida. Configure o .env antes de migrar.');
	process.exit(1);
}

// max: 1 — migração é sequencial; pool não ajuda e atrapalha o lock.
const cliente = postgres(url, { max: 1 });

try {
	console.log('Aplicando migrações…');
	await migrate(drizzle(cliente), {
		migrationsFolder: join(import.meta.dirname, 'migrations')
	});
	console.log('Migrações aplicadas.');
	await cliente.end();
	process.exit(0);
} catch (erro) {
	console.error('Falha ao migrar:', erro);
	await cliente.end();
	process.exit(1);
}
