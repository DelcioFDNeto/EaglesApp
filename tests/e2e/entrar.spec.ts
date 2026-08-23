import { expect, test } from '@playwright/test';
import { CONTAS, SENHA, limparBloqueio } from './contas';

/**
 * Entrada no sistema, no navegador, com JavaScript ligado.
 *
 * O que aqui NÃO é repetido: hash de senha, token de sessão e revogação já
 * têm cobertura em tests/integration/autenticacao.test.ts, que roda em
 * milissegundos. Este arquivo cobre só o que exige um navegador de verdade.
 */

test.describe('entrada', () => {
	test('a raiz encaminha quem não está autenticado para /entrar', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/entrar/);
	});

	test('rota protegida não abre sem sessão', async ({ page }) => {
		await page.goto('/inicio');
		await expect(page).toHaveURL(/\/entrar/);
	});

	test('login com credencial correta chega ao início', async ({ page }) => {
		await page.goto('/entrar');
		await page.getByLabel('E-mail ou telefone').fill(CONTAS.lider);
		await page.getByLabel('Senha').fill(SENHA);
		await page.getByRole('button', { name: 'Entrar' }).click();

		await page.waitForURL('**/inicio');
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Olá');
	});

	test('quem já entrou não vê a tela de login de novo', async ({ page }) => {
		await page.goto('/entrar');
		await page.getByLabel('E-mail ou telefone').fill(CONTAS.lider);
		await page.getByLabel('Senha').fill(SENHA);
		await page.getByRole('button', { name: 'Entrar' }).click();
		await page.waitForURL('**/inicio');

		await page.goto('/entrar');
		await expect(page).toHaveURL(/\/inicio/);
	});

	test('a mensagem de erro não revela se a conta existe', async ({ page }) => {
		await page.goto('/entrar');
		await page.getByLabel('E-mail ou telefone').fill('ninguem@eagles.local');
		await page.getByLabel('Senha').fill('qualquer-coisa');
		await page.getByRole('button', { name: 'Entrar' }).click();

		const inexistente = await page.getByText(/incorretos/i).textContent();

		await page.goto('/entrar');
		await page.getByLabel('E-mail ou telefone').fill(CONTAS.lider);
		await page.getByLabel('Senha').fill('senha-errada-mesmo');
		await page.getByRole('button', { name: 'Entrar' }).click();

		const senhaErrada = await page.getByText(/incorretos/i).textContent();

		// Mensagens diferentes entregariam quais e-mails estão cadastrados.
		expect(senhaErrada).toBe(inexistente);
	});

	test('campo vazio é barrado com mensagem em português', async ({ page }) => {
		await page.goto('/entrar');
		// `novalidate` deixa o servidor responder, que é quem realmente valida.
		await page.locator('form').evaluate((f: HTMLFormElement) => f.setAttribute('novalidate', ''));
		await page.getByRole('button', { name: 'Entrar' }).click();

		await expect(page.getByText(/Informe seu e-mail ou telefone/i)).toBeVisible();
	});
});

test.describe('bloqueio progressivo', () => {
	// MAX_LOGIN_ATTEMPTS = 5 no ambiente da suíte.
	test.beforeEach(async () => {
		await limparBloqueio(CONTAS.bloqueio);
	});

	test.afterEach(async () => {
		await limparBloqueio(CONTAS.bloqueio);
	});

	test('cinco senhas erradas bloqueiam a conta', async ({ page }) => {
		for (let tentativa = 1; tentativa <= 5; tentativa++) {
			await page.goto('/entrar');
			await page.getByLabel('E-mail ou telefone').fill(CONTAS.bloqueio);
			await page.getByLabel('Senha').fill(`errada-${tentativa}`);
			await page.getByRole('button', { name: 'Entrar' }).click();
			await expect(page.getByText(/incorretos|bloqueada|Muitas tentativas/i)).toBeVisible();
		}

		// Agora nem a senha certa entra — e a mensagem explica o que fazer.
		await page.goto('/entrar');
		await page.getByLabel('E-mail ou telefone').fill(CONTAS.bloqueio);
		await page.getByLabel('Senha').fill(SENHA);
		await page.getByRole('button', { name: 'Entrar' }).click();

		await expect(page.getByText(/bloqueada|Muitas tentativas/i)).toBeVisible();
		await expect(page).toHaveURL(/\/entrar/);
	});
});
