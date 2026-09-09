import { expect, test } from '@playwright/test';
import { ESTADO_DE_SESSAO, removerPessoasDeTeste } from './contas';

/**
 * Módulo 02 — Pessoas, no navegador.
 *
 * O que aqui NÃO é repetido: regime de dados de menor, duplicidade e
 * append-only já têm cobertura em `tests/integration/pessoas.test.ts`, que roda
 * em milissegundos contra Postgres real. Este arquivo cobre o que só existe no
 * navegador — o formulário, a navegação e o que cada papel enxerga na tela.
 *
 * A sessão vem pronta de `auth.setup.ts`: entrar pelo formulário a cada teste
 * esgotaria o limite de tentativas por IP, já que a suíte inteira sai do mesmo
 * endereço.
 */

test.describe('lista de pessoas — como líder', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.lider });

	test('o líder vê a lista com as pessoas semeadas', async ({ page }) => {
		await page.goto('/pessoas');

		await expect(page.getByRole('link', { name: /Ana Beatriz Nogueira/ })).toBeVisible();
		await expect(page.getByRole('link', { name: /Rafael Monteiro/ })).toBeVisible();
	});

	test('a busca funciona por formulário GET, com o resultado no endereço', async ({ page }) => {
		await page.goto('/pessoas');

		await page.getByPlaceholder('Buscar por nome').fill('rafael');
		await page.getByRole('button', { name: 'Filtrar' }).click();

		await expect(page).toHaveURL(/busca=rafael/);
		await expect(page.getByRole('link', { name: /Rafael Monteiro/ })).toBeVisible();
		await expect(page.getByRole('link', { name: /Ana Beatriz/ })).toBeHidden();
	});

	test('a busca ignora acento — quem digita não sabe como o nome foi gravado', async ({ page }) => {
		await page.goto('/pessoas?busca=leticia');
		await expect(page.getByRole('link', { name: /Letícia Ferreira/ })).toBeVisible();
	});

	test('busca sem resultado mostra estado vazio com saída', async ({ page }) => {
		await page.goto('/pessoas?busca=zzzznaoexiste');

		await expect(page.getByText('Ninguém com esse filtro')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Limpar filtro' })).toBeVisible();
	});
});

test.describe('lista de pessoas — como membro', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.membro });

	test('membro NÃO vê o botão de cadastrar nem telefone de ninguém', async ({ page }) => {
		await page.goto('/pessoas');

		// A lista aparece: nome de quem faz parte não é dado sensível.
		await expect(page.getByRole('link', { name: /Ana Beatriz Nogueira/ })).toBeVisible();

		await expect(page.getByRole('link', { name: 'Cadastrar' })).toBeHidden();
		// O telefone da semente é 11987650001 e não pode aparecer em lugar nenhum.
		await expect(page.getByText(/98765-0001/)).toBeHidden();
	});
});

test.describe('cadastro — como líder', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.lider });

	test.afterEach(async () => {
		await removerPessoasDeTeste('Teste E2E');
	});

	test('cadastra alguém informando apenas o nome (RN-05)', async ({ page }) => {
		await page.goto('/pessoas/nova');

		await page.getByLabel('Nome completo').fill('Teste E2E Só Nome');
		await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();

		await page.waitForURL(/\/pessoas\/[0-9a-f-]+/);
		await expect(page.getByText('Pessoa cadastrada')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Teste E2E Só Nome' })).toBeVisible();
	});

	test('nome vazio volta com mensagem em português', async ({ page }) => {
		await page.goto('/pessoas/nova');

		await page.locator('form').evaluate((f: HTMLFormElement) => f.setAttribute('novalidate', ''));
		await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();

		await expect(page.getByText('Informe o nome completo.')).toBeVisible();
	});

	test('avisa sobre possível duplicata e deixa continuar mesmo assim', async ({ page }) => {
		// Cadastra alguém com o nome de uma pessoa que já existe na semente.
		await page.goto('/pessoas/nova');
		await page.getByLabel('Nome completo').fill('Rafael Monteiro');
		await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();

		await expect(page.getByText('Confira antes de continuar')).toBeVisible();
		await expect(page.getByText(/Já existe alguém com o mesmo nome/)).toBeVisible();

		// O botão muda de rótulo: a decisão de duplicar é consciente.
		const continuar = page.getByRole('button', { name: 'Cadastrar mesmo assim' });
		await expect(continuar).toBeVisible();

		// Não segue adiante nesta suíte — a pessoa duplicada sujaria a semente.
		await expect(page).toHaveURL(/\/pessoas\/nova/);
	});
});

test.describe('cadastro — como membro', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.membro });

	test('membro não alcança a tela de cadastro nem pela URL', async ({ page }) => {
		await page.goto('/pessoas/nova');
		await expect(page).toHaveURL(/\/pessoas$/);
	});
});

test.describe('perfil — como líder', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.lider });

	test('mostra estágio, contato e linha do tempo para o líder', async ({ page }) => {
		await page.goto('/pessoas?busca=rafael');
		await page.getByRole('link', { name: /Rafael Monteiro/ }).click();

		const identificacao = page.getByRole('region', { name: 'Identificação' });
		await expect(identificacao.getByRole('heading', { name: 'Rafael Monteiro' })).toBeVisible();
		await expect(identificacao.getByText('Membro Eagles')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Linha do tempo' })).toBeVisible();
		await expect(page.getByText('Entrou como Membro Eagles')).toBeVisible();
	});

	test('o líder muda o estágio e a mudança entra na linha do tempo', async ({ page }) => {
		await page.goto('/pessoas?busca=gustavo');
		await page.getByRole('link', { name: /Gustavo Lima/ }).click();

		await page.getByLabel('Novo estágio').selectOption({ label: 'Membro Eagles' });
		await page.getByLabel('Motivo (opcional)').fill('Teste de ponta a ponta');
		await page.getByRole('button', { name: 'Registrar mudança' }).click();

		await expect(page.getByText('Estágio atualizado.')).toBeVisible();
		await expect(page.getByText('Participante recorrente → Membro Eagles')).toBeVisible();
		await expect(page.getByText('Teste de ponta a ponta')).toBeVisible();
	});
});

test.describe('perfil — como membro', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.membro });

	test('membro vê o perfil, mas não o contato nem o botão de editar', async ({ page }) => {
		await page.goto('/pessoas?busca=ana');
		await page.getByRole('link', { name: /Ana Beatriz Nogueira/ }).click();

		await expect(page.getByRole('heading', { name: 'Ana Beatriz Nogueira' })).toBeVisible();
		await expect(page.getByText(/visíveis apenas para quem tem permissão/)).toBeVisible();
		await expect(page.getByRole('link', { name: 'Editar' })).toBeHidden();
	});
});
