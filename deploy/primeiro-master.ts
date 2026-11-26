/**
 * Primeiro acesso em produção: prepara o banco e convida o Master (o dev).
 *
 * As migrações criam só as tabelas. Sem equipe, papéis e alguém com acesso,
 * ninguém entra (o acesso é só por convite). Este script:
 *
 *   1. garante a equipe, o catálogo de permissões, os papéis e as
 *      funcionalidades (todas desligadas) — idempotente;
 *   2. cria (ou reaproveita) a pessoa do Master, com o e-mail de login;
 *   3. dá a ela o papel `master` (acima dos líderes, invisível para a equipe);
 *   4. imprime o link de convite (vale INVITE_TTL_DAYS dias, uso único).
 *
 * Depois, o Master entra no app, cadastra os 2 líderes e os nomeia em
 * Liderança (mandato de 2 anos). Líderes nunca nascem por script.
 *
 * Uso, dentro do container da API (console do serviço no Easypanel):
 *
 *   node tools/primeiro-master.mjs --nome "Seu Nome" --email voce@exemplo.com
 *
 * Se já houver um Master com senha definida, o script para. `--forcar`
 * ignora isso (ex.: o dev perdeu o acesso ao e-mail).
 *
 * Não há senha nem segredo aqui: quem tem o link define a própria senha.
 */

import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';
import type { Database } from '../src/lib/server/db';
import { convidarMaster } from '../src/lib/server/bootstrap/primeiro-master';
import { env } from '../src/lib/server/env';

const USO = 'Uso: node tools/primeiro-master.mjs --nome "Nome Completo" --email voce@exemplo.com';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const { values: args } = parseArgs({
	options: {
		nome: { type: 'string' },
		email: { type: 'string' },
		forcar: { type: 'boolean', default: false }
	}
});

const nome = args.nome?.trim() ?? '';
const email = args.email?.trim() ?? '';

if (nome.length < 3 || !EMAIL.test(email)) {
	console.error(USO);
	process.exit(1);
}

const cliente = postgres(env().DATABASE_URL, { max: 1 });
const db = drizzle(cliente, { schema }) as unknown as Database;

let codigo = 0;
try {
	const resultado = await convidarMaster(db, { nome, email, forcar: args.forcar });

	if (!resultado.ok) {
		console.error(
			'Já existe um Master com acesso. Se você perdeu o acesso, rode de novo com --forcar.'
		);
		codigo = 2;
	} else {
		const validade = resultado.convite.expiresAt.toLocaleDateString('pt-BR');
		console.log('Catálogo pronto: equipe, permissões, papéis e funcionalidades.');
		console.log(`\nMaster: ${nome} <${email.toLowerCase()}>`);
		console.log(`Link de convite (uso único, até ${validade}):\n\n  ${resultado.convite.url}\n`);
		console.log('Depois de entrar: cadastre os 2 líderes em Pessoas e nomeie-os em Liderança.');
	}
} catch (erro) {
	console.error('Falha no primeiro acesso:', erro);
	codigo = 1;
} finally {
	await cliente.end();
}
process.exit(codigo);
