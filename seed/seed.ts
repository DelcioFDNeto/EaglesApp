/**
 * Semeadura do ambiente de desenvolvimento: `npm run db:seed`.
 *
 * A lógica mora em `src/lib/server/bootstrap/semente-dev.ts` (testada contra
 * Postgres em memória); aqui só conecta, chama e mostra o resultado.
 *
 * NUNCA rode isto em produção — a senha é conhecida.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';
import type { Database } from '../src/lib/server/db';
import {
	CONTAS_DEV,
	SENHA_DEV,
	semearDesenvolvimento
} from '../src/lib/server/bootstrap/semente-dev';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL não definida. Copie .env.example para .env.');
	process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
	console.error('Recusando semear em produção: isto cria contas com senha conhecida.');
	process.exit(1);
}
// O convite de teste usa PUBLIC_ORIGIN; em desenvolvimento, o Vite local.
process.env.PUBLIC_ORIGIN ??= 'http://localhost:5173';

const cliente = postgres(url, { max: 1 });
const db = drizzle(cliente, { schema }) as unknown as Database;

let codigo = 0;
try {
	const r = await semearDesenvolvimento(db);
	console.log(`${r.criadas} pessoas criadas (${r.total} no total), ${r.grupos} grupos.`);
	console.log(`\nConvite de teste (Rafael Monteiro, entra pelo telefone):\n  ${r.conviteUrl}`);
	console.log(`\nContas prontas — senha: ${SENHA_DEV}`);
	for (const c of CONTAS_DEV) {
		console.log(`  ${c.email.padEnd(22)} ${c.papel}${c.grupo ? ` (${c.grupo})` : ''}`);
	}
} catch (erro) {
	console.error('Falha ao semear:', erro);
	codigo = 1;
} finally {
	await cliente.end();
}
process.exit(codigo);
