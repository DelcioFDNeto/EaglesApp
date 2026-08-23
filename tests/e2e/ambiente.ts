/**
 * Parâmetros compartilhados pela suíte de ponta a ponta.
 *
 * Vivem fora do playwright.config.ts porque o script que prepara o banco roda
 * pelo vite-node, antes de o Playwright existir — importar a configuração ali
 * arrastaria o @playwright/test para dentro de um script de banco.
 */

export const PORTA = Number(process.env.E2E_PORT ?? 4173);

export const ORIGEM = `http://127.0.0.1:${PORTA}`;

/** Banco separado do de desenvolvimento: a preparação o apaga e recria. */
export const E2E_DATABASE_URL =
	process.env.E2E_DATABASE_URL ?? 'postgres://eagles@127.0.0.1:5432/eagles_e2e';
