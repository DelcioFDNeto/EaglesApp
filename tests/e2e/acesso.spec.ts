import { expect, test } from '@playwright/test';
import {
	CONTAS,
	ESTADO_DE_SESSAO,
	envelhecerReautenticacao,
	removerPessoasDeTeste
} from './contas';

/**
 * Módulo 03 — gestão de acesso, no navegador.
 *
 * As travas (escalada, último administrador, própria conta) estão provadas em
 * `tests/integration/rbac.test.ts`, contra Postgres real e em milissegundos.
 * Aqui fica o que só o navegador prova: a navegação por papel, o pedido de
 * senha antes do formulário, e o caminho inteiro de um convite — até a pessoa
 * SAIR e conseguir ENTRAR DE NOVO, que é exatamente o que o M01 quebrava.
 */

test.describe('navegação por papel (lacuna G4)', () => {
	test.describe('líder', () => {
		test.use({ storageState: ESTADO_DE_SESSAO.lider });

		test('vê no máximo 5 itens — acessos e conta moram em "Mais" (D-M05-9)', async ({ page }) => {
			await page.goto('/inicio');
			const nav = page.getByRole('navigation', { name: 'Navegação principal' });
			await expect(nav.getByRole('link')).toHaveText([
				'Início',
				'Agenda',
				'Pessoas',
				'Grupos',
				'Mais'
			]);

			await nav.getByRole('link', { name: 'Mais' }).click();
			await page.getByRole('link', { name: /Papéis e acessos/ }).click();
			await expect(page).toHaveURL(/\/admin\/papeis$/);
		});

		test('chega às pessoas pelo menu, sem digitar endereço', async ({ page }) => {
			await page.goto('/inicio');
			await page
				.getByRole('navigation', { name: 'Navegação principal' })
				.getByRole('link', { name: 'Pessoas' })
				.click();
			await expect(page).toHaveURL(/\/pessoas$/);
			await expect(
				page
					.getByRole('link', { name: 'Pessoas', exact: true })
					.and(page.locator('[aria-current="page"]'))
			).toBeVisible();
		});
	});

	test.describe('membro', () => {
		test.use({ storageState: ESTADO_DE_SESSAO.membro });

		test('não vê o item de acessos — e a rota recusa com 403', async ({ page }) => {
			await page.goto('/inicio');
			const nav = page.getByRole('navigation', { name: 'Navegação principal' });
			await expect(nav.getByRole('link')).toHaveText([
				'Início',
				'Agenda',
				'Pessoas',
				'Grupos',
				'Mais'
			]);

			// Em "Mais", o membro não vê o que não pode abrir.
			await nav.getByRole('link', { name: 'Mais' }).click();
			await expect(page.getByRole('link', { name: /Minha conta/ })).toBeVisible();
			await expect(page.getByRole('link', { name: /Papéis e acessos/ })).toBeHidden();

			const resposta = await page.goto('/admin/papeis');
			expect(resposta?.status()).toBe(403);
		});
	});

	test.describe('conselheiro', () => {
		test.use({ storageState: ESTADO_DE_SESSAO.conselheiro });

		test('abre os próprios aparelhos conectados (lacuna G5)', async ({ page }) => {
			// Antes do M03, /conta/sessoes exigia uma permissão que o escopo de
			// grupo do conselheiro não satisfazia: ele recebia erro.
			const resposta = await page.goto('/conta/sessoes');
			expect(resposta?.status()).toBe(200);
		});
	});
});

test.describe('administração de papéis', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.lider });

	test('lista os quatro papéis básicos', async ({ page }) => {
		await page.goto('/admin/papeis');
		for (const nome of ['Líder', 'Conselheiro', 'Membro', 'Visitante']) {
			await expect(page.getByRole('link', { name: new RegExp(`^${nome}`) })).toBeVisible();
		}
	});

	test('pede a senha ANTES do formulário e volta para onde estava', async ({ page }) => {
		await envelhecerReautenticacao(CONTAS.lider);

		await page.goto('/admin/papeis/novo');
		await expect(page.getByText('Confirme sua senha para continuar')).toBeVisible();
		await expect(page.getByLabel('Nome do papel')).toBeHidden();

		await page.getByRole('link', { name: 'Confirmar senha' }).click();
		await page.getByLabel('Sua senha').fill('eagles-desenvolvimento');
		await page.getByRole('button', { name: 'Confirmar' }).click();

		await expect(page).toHaveURL(/\/admin\/papeis\/novo$/);
		await expect(page.getByLabel('Nome do papel')).toBeVisible();
	});

	test('cria, ajusta e exclui um papel personalizado', async ({ page }) => {
		await page.goto('/admin/papeis/novo');
		await page.getByLabel('Nome do papel').fill('Apoio de Teste');
		await page.getByLabel('Só os próprios dados').check();
		await page.getByRole('checkbox', { name: /Ver eventos/ }).check();
		await page.getByRole('button', { name: 'Criar papel' }).click();

		await expect(page.getByText('Papel criado')).toBeVisible();
		await expect(page.getByRole('checkbox', { name: /Ver eventos/ })).toBeChecked();

		await page.getByRole('checkbox', { name: /Ver grupos/ }).check();
		await page.getByRole('button', { name: 'Salvar alterações' }).click();
		await expect(page.getByText('Alterações salvas')).toBeVisible();
		await expect(page.getByRole('checkbox', { name: /Ver grupos/ })).toBeChecked();

		await page.getByText('Excluir este papel').click();
		await page.getByLabel(/Confirmo a exclusão/).check();
		await page.getByRole('button', { name: 'Excluir papel' }).click();

		await expect(page).toHaveURL(/\/admin\/papeis\?excluido=/);
		await expect(page.getByText('O papel "Apoio de Teste" foi excluído.')).toBeVisible();
	});

	test('papel básico não oferece exclusão', async ({ page }) => {
		await page.goto('/admin/papeis');
		await page.getByRole('link', { name: /^Visitante/ }).click();
		await expect(page.getByText(/Papel básico: não pode ser excluído/)).toBeVisible();
		await expect(page.getByText('Excluir este papel')).toBeHidden();
	});

	test('ninguém altera o próprio acesso — a tela explica em vez de oferecer', async ({ page }) => {
		await page.goto('/pessoas?busca=ana');
		await page.getByRole('link', { name: /Ana Beatriz Nogueira/ }).click();
		await page.getByRole('link', { name: 'Gerenciar acesso' }).click();

		await expect(page.getByText('Ninguém altera o próprio acesso')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Atribuir' })).toBeHidden();
		await expect(page.getByRole('button', { name: /Retirar/ })).toBeHidden();
	});
});

test.describe('convite de ponta a ponta (lacunas G1 e G2)', () => {
	test.afterAll(async () => {
		await removerPessoasDeTeste('Convidada E2E');
	});

	test('papel → convite → aceite → sair → ENTRAR DE NOVO', async ({ browser, baseURL }) => {
		const sufixo = Date.now().toString().slice(-7);
		const nome = `Convidada E2E ${sufixo}`;
		const telefone = `(11) 9${sufixo.slice(0, 4)}-${sufixo.slice(4)}0`;
		const senha = 'minha frase de quinta-feira';

		// --- O líder cadastra, dá o papel e gera o convite ------------------
		const lider = await browser.newContext({ storageState: ESTADO_DE_SESSAO.lider, baseURL });
		const telaDoLider = await lider.newPage();

		await telaDoLider.goto('/pessoas/nova');
		await telaDoLider.getByLabel('Nome completo').fill(nome);
		await telaDoLider.getByText('Adicionar mais informações').click();
		// Data de nascimento é exigência do convite: sem ela, o cadastro segue o
		// regime de proteção de menores (ADR 0003 + ADR 0004).
		await telaDoLider.getByLabel('Data de nascimento').fill('1998-06-20');
		await telaDoLider.getByRole('button', { name: 'Cadastrar', exact: true }).click();
		await telaDoLider.waitForURL(/\/pessoas\/[0-9a-f-]+\?criada=1/);

		await telaDoLider.getByRole('link', { name: 'Gerenciar acesso' }).click();
		await expect(telaDoLider.getByText('Ainda não tem acesso ao app.')).toBeVisible();

		await telaDoLider.getByLabel('Dar um papel').selectOption({ label: 'Membro' });
		await telaDoLider.getByRole('button', { name: 'Atribuir' }).click();
		await expect(telaDoLider.getByText('Papel atribuído')).toBeVisible();

		await telaDoLider.getByRole('button', { name: 'Gerar convite' }).click();
		await expect(telaDoLider.getByText('Convite pronto')).toBeVisible();
		await expect(telaDoLider.getByRole('link', { name: 'Enviar pelo WhatsApp' })).toHaveAttribute(
			'href',
			/^https:\/\/wa\.me\/\?text=/
		);
		const linkDoConvite = await telaDoLider.getByRole('textbox').inputValue();
		expect(linkDoConvite).toMatch(/\/convite\/[A-Za-z0-9_-]{40,}$/);
		await lider.close();

		// --- A pessoa, em outro aparelho, aceita ---------------------------
		const convidada = await browser.newContext({ baseURL });
		const tela = await convidada.newPage();
		await tela.goto(new URL(linkDoConvite).pathname);

		await expect(tela.getByRole('heading', { name: 'Oi, Convidada!' })).toBeVisible();
		await tela.getByLabel('E-mail ou telefone').fill(telefone);
		await tela.getByLabel('Sua senha').fill(senha);
		await tela.getByLabel('Repita a senha').fill(senha);
		await tela.getByRole('button', { name: 'Criar meu acesso' }).click();
		await tela.waitForURL('**/inicio?boas-vindas=1');

		// --- Sai, e entra de novo com o telefone escrito de outro jeito -----
		await tela.getByRole('button', { name: 'Sair' }).click();
		await tela.waitForURL('**/entrar');

		await tela.getByLabel('E-mail ou telefone').fill(telefone.replace(/\D/g, ''));
		await tela.getByLabel('Senha').fill(senha);
		await tela.getByRole('button', { name: 'Entrar' }).click();

		// O M01 parava aqui: a conta criada pelo convite não tinha telefone nem
		// e-mail, e o login não a encontrava.
		await tela.waitForURL('**/inicio');
		await expect(tela.getByRole('heading', { level: 1 })).toContainText('Olá, Convidada');
		await convidada.close();
	});
});
