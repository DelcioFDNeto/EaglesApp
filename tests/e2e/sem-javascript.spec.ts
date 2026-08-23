import { expect, test } from '@playwright/test';
import { CONTAS, SENHA } from './contas';

/**
 * O critério que sustenta a arquitetura.
 *
 * O M01 escolheu form actions do SvelteKit em vez de chamadas de API
 * justamente para que a aplicação continue funcionando quando o JavaScript
 * falha — rede ruim no salão do PG, celular antigo, script que não carregou.
 * Sem este teste, "funciona sem JavaScript" é uma intenção de projeto, não uma
 * propriedade verificada.
 *
 * Este arquivo roda no projeto `sem-javascript`, com `javaScriptEnabled: false`.
 */

test.describe('sem JavaScript', () => {
	/**
	 * Guarda de integridade — precisa ser o primeiro teste do arquivo.
	 *
	 * Se alguém mexer nos projetos do playwright.config.ts e este arquivo
	 * passar a rodar com JavaScript ligado, todos os testes abaixo continuariam
	 * verdes sem provar absolutamente nada. Este aqui falha na hora.
	 *
	 * O script vai num `setContent`, sem tocar na aplicação: é o navegador que
	 * está sendo interrogado, não o Eagles. (`page.evaluate` não serve — ele
	 * roda num mundo isolado e executa mesmo com o JavaScript da página
	 * desligado. `modulepreload` também não: o navegador baixa os módulos de
	 * qualquer jeito, só não os executa.)
	 */
	test('o JavaScript da página está realmente desligado', async ({ page }) => {
		await page.setContent(
			'<p id="alvo">nao-executou</p><script>document.getElementById("alvo").textContent="executou"</script>'
		);

		await expect(
			page.locator('#alvo'),
			'o projeto sem-javascript está rodando COM JavaScript — os testes deste arquivo perderam o sentido'
		).toHaveText('nao-executou');
	});

	test('a tela de entrada renderiza pelo servidor', async ({ page }) => {
		await page.goto('/entrar');

		await expect(page.getByLabel('E-mail ou telefone')).toBeVisible();
		await expect(page.getByLabel('Senha')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
	});

	test('o formulário é HTML puro: método POST e sem action de JavaScript', async ({ page }) => {
		await page.goto('/entrar');

		const formulario = page.locator('form');
		// `method` minúsculo é o que o DOM devolve; o atributo no fonte é POST.
		await expect(formulario).toHaveAttribute('method', /post/i);
	});

	test('login completo funciona e cria sessão', async ({ page }) => {
		await page.goto('/entrar');

		await page.getByLabel('E-mail ou telefone').fill(CONTAS.membro);
		await page.getByLabel('Senha').fill(SENHA);
		await page.getByRole('button', { name: 'Entrar' }).click();

		// Sem JavaScript o navegador segue o 303 do servidor.
		await page.waitForURL('**/inicio');
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Olá');

		// A sessão é um cookie httpOnly de verdade, não estado em memória.
		const cookies = await page.context().cookies();
		const sessao = cookies.find((c) => c.httpOnly);
		expect(sessao, 'nenhum cookie httpOnly foi definido').toBeDefined();
	});

	test('senha errada mostra o erro na página, sem JavaScript', async ({ page }) => {
		await page.goto('/entrar');

		await page.getByLabel('E-mail ou telefone').fill(CONTAS.membro);
		await page.getByLabel('Senha').fill('senha-que-nao-e-a-certa');
		await page.getByRole('button', { name: 'Entrar' }).click();

		await expect(page.getByText(/incorretos/i)).toBeVisible();
		await expect(page).toHaveURL(/\/entrar/);
	});

	test('sair encerra a sessão, também sem JavaScript', async ({ page }) => {
		await page.goto('/entrar');
		await page.getByLabel('E-mail ou telefone').fill(CONTAS.membro);
		await page.getByLabel('Senha').fill(SENHA);
		await page.getByRole('button', { name: 'Entrar' }).click();
		await page.waitForURL('**/inicio');

		await page.getByRole('button', { name: 'Sair' }).click();
		await page.waitForURL('**/entrar');

		// E a sessão realmente morreu: voltar para /inicio não entra.
		await page.goto('/inicio');
		await expect(page).toHaveURL(/\/entrar/);
	});
});
