import { defineConfig, devices } from '@playwright/test';
import { E2E_DATABASE_URL, ORIGEM, PORTA } from './tests/e2e/ambiente';

/**
 * Testes de ponta a ponta.
 *
 * Existem para cobrir o que os testes de integração não alcançam: o navegador
 * de verdade — formulário, cookie, redirecionamento — e, principalmente, o
 * critério de aceitação do M01 de que o **login funciona com JavaScript
 * desligado**. Esse critério é a razão de a aplicação usar form actions em vez
 * de chamadas de API; sem teste, é só uma intenção.
 *
 * Precisam de um PostgreSQL de verdade (os de integração usam PGlite em WASM).
 * Local:  createdb eagles_e2e  ou  docker compose -f infra/docker-compose.yml up -d postgres
 * CI:     serviço postgres:16-alpine, ver .github/workflows/ci.yml
 */

/** Alvo real do produto é o celular, então o padrão é um viewport de celular. */
const CELULAR = devices['Pixel 7'];

export default defineConfig({
	testDir: 'tests/e2e',

	timeout: 30_000,
	expect: { timeout: 10_000 },

	// Um banco só e sessões compartilhadas: paralelizar daria falha
	// intermitente, que é pior que suíte lenta.
	fullyParallel: false,
	workers: 1,

	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

	use: {
		baseURL: ORIGEM,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},

	projects: [
		{
			name: 'celular',
			use: { ...CELULAR },
			testIgnore: /sem-javascript\.spec\.ts/
		},
		{
			// O projeto que justifica a arquitetura de formulários.
			name: 'sem-javascript',
			use: { ...CELULAR, javaScriptEnabled: false },
			testMatch: /sem-javascript\.spec\.ts/
		}
	],

	webServer: {
		// O banco é preparado AQUI, e não em `globalSetup`: o Playwright sobe o
		// webServer antes do globalSetup, então o health check bateria num banco
		// inexistente e a suíte morreria esperando.
		//
		// Build de produção, não `vite dev`: é o artefato que vai para a VPS.
		command: 'npm run db:e2e && npm run build && node build/index.js',
		url: `${ORIGEM}/api/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			NODE_ENV: 'production',
			DATABASE_URL: E2E_DATABASE_URL,
			E2E_DATABASE_URL,
			PUBLIC_ORIGIN: ORIGEM,
			// O adapter-node valida a origem em POST. Sem ORIGIN, todo envio de
			// formulário volta 403 — inclusive o login sem JavaScript.
			ORIGIN: ORIGEM,
			PORT: String(PORTA),
			SESSION_TTL_DAYS: '30',
			INVITE_TTL_DAYS: '7',
			MAX_LOGIN_ATTEMPTS: '5'
		}
	}
});
