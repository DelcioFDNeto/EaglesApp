import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { E2E_DATABASE_URL, ORIGEM } from './ambiente';

/**
 * Prepara o banco da suíte de ponta a ponta: apaga, cria, migra e semeia.
 *
 * Recria do zero a cada execução. A suíte mexe em estado que persiste —
 * tentativas de senha, bloqueio de conta, sessões — e teste que depende da
 * execução anterior falha de madrugada, não na sua máquina.
 *
 * Roda como parte do comando do servidor no playwright.config.ts, e não como
 * `globalSetup`: o Playwright sobe o webServer ANTES do globalSetup, então o
 * health check bateria num banco que ainda não existe.
 */
export async function prepararBanco(): Promise<void> {
	const url = new URL(E2E_DATABASE_URL);
	const nome = decodeURIComponent(url.pathname.slice(1));

	if (!nome) {
		throw new Error(`E2E_DATABASE_URL sem nome de banco: ${E2E_DATABASE_URL}`);
	}
	if (!nome.endsWith('_e2e')) {
		// Trava contra apontar a suíte para o banco errado — o próximo comando
		// é um DROP DATABASE.
		throw new Error(`Recusando: o banco de e2e precisa terminar em "_e2e". Recebi "${nome}".`);
	}

	const administrativa = new URL(E2E_DATABASE_URL);
	administrativa.pathname = '/postgres';

	const sql = postgres(administrativa.toString(), { max: 1 });
	try {
		await sql.unsafe(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`);
		await sql.unsafe(`CREATE DATABASE "${nome}"`);
	} finally {
		await sql.end({ timeout: 5 });
	}

	const ambiente = {
		...process.env,
		DATABASE_URL: E2E_DATABASE_URL,
		PUBLIC_ORIGIN: ORIGEM,
		NODE_ENV: 'development'
	};

	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	execFileSync(npm, ['run', 'db:migrate'], { env: ambiente, stdio: 'inherit' });
	execFileSync(npm, ['run', 'db:seed'], { env: ambiente, stdio: 'inherit' });

	console.log(`Banco de e2e pronto: ${nome}`);
}

await prepararBanco();
