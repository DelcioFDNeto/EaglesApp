import { expect, test, type Page } from '@playwright/test';
import { ESTADO_DE_SESSAO, removerPessoasDeTeste } from './contas';

/**
 * Módulo 04 — Grupos, no navegador.
 *
 * As regras de banco e de escopo têm cobertura completa em
 * `tests/integration/grupos.test.ts`. Aqui fica o que só a tela prova: que o
 * conselheiro enxerga o próprio PG e não o vizinho, que os formulários levam
 * ao resultado certo e que a reorganização mostra antes de aplicar.
 *
 * Semente: PG Azul (Pedro, conselheiro; João, membro) e PG Verde (Marina,
 * conselheira; Letícia, membro). Ana, a líder, não está em grupo nenhum.
 */

/** Abre um grupo pela lista, como a pessoa faria. */
async function abrirGrupo(page: Page, nome: string) {
	await page.goto('/grupos');
	await page.getByRole('link', { name: new RegExp(nome) }).click();
	await expect(page.getByRole('heading', { level: 1, name: nome })).toBeVisible();
}

/** Muda o grupo de alguém pelo perfil, como a liderança faria. */
async function mudarPeloPerfil(page: Page, pessoa: string, destino: string) {
	await page.goto(`/pessoas?busca=${encodeURIComponent(pessoa)}`);
	await page.getByRole('link', { name: new RegExp(pessoa) }).click();
	await page.getByLabel('Mudar para').selectOption({ label: destino });
	await page.getByRole('button', { name: 'Mudar de grupo' }).click();
	await expect(
		page.getByText(new RegExp(`^Mudança registrada: .+ → ${destino}\\.$`))
	).toBeVisible();
}

test.describe('conselheiro — o próprio PG, e só ele (lacuna G1)', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.conselheiro });

	test('o início leva ao grupo em um toque', async ({ page }) => {
		await page.goto('/inicio');
		const cartao = page.getByRole('region', { name: 'Seu grupo' });
		await cartao.getByRole('link', { name: /PG Azul/ }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'PG Azul' })).toBeVisible();
	});

	test('vê o telefone de quem está no PG Azul', async ({ page }) => {
		await abrirGrupo(page, 'PG Azul');
		await expect(page.getByText('(11) 98765-0004')).toBeVisible();
	});

	test('vê quem está no PG Verde, mas não o telefone de ninguém', async ({ page }) => {
		await abrirGrupo(page, 'PG Verde');
		await expect(page.getByRole('link', { name: /Letícia Ferreira/ })).toBeVisible();
		await expect(page.getByText('(11) 98765-0005')).toBeHidden();
	});

	test('na lista de pessoas, o telefone é decidido pessoa a pessoa', async ({ page }) => {
		await page.goto('/pessoas');
		await expect(page.getByText('(11) 98765-0004')).toBeVisible();
		await expect(page.getByText('(11) 98765-0005')).toBeHidden();
	});

	test('edita quem é do próprio grupo, e não quem é do outro (lacuna G2)', async ({ page }) => {
		await page.goto('/pessoas?busca=joao');
		await page.getByRole('link', { name: /João Vitor/ }).click();
		await expect(page.getByRole('link', { name: 'Editar' })).toBeVisible();

		await page.goto('/pessoas?busca=leticia');
		await page.getByRole('link', { name: /Letícia Ferreira/ }).click();
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Letícia');
		await expect(page.getByRole('link', { name: 'Editar' })).toBeHidden();
	});

	test.describe('cadastro no próprio grupo', () => {
		test.afterAll(async () => {
			await removerPessoasDeTeste('Visitante E2E');
		});

		test('o grupo já vem escolhido, e a pessoa nasce dentro dele', async ({ page }) => {
			await page.goto('/pessoas/nova');
			await expect(page.getByLabel(/^Grupo/)).toHaveValue(/.+/);

			await page.getByLabel('Nome completo').fill(`Visitante E2E ${Date.now()}`);
			await page.getByRole('button', { name: 'Cadastrar', exact: true }).click();
			await page.waitForURL(/\/pessoas\/[0-9a-f-]+\?criada=1/);

			await expect(page.getByRole('region', { name: 'Grupo' }).getByText('PG Azul')).toBeVisible();
			// Continua enxergando o cadastro que acabou de criar.
			await expect(page.getByRole('link', { name: 'Editar' })).toBeVisible();
		});
	});

	test('criar grupo e reorganizar são da liderança geral', async ({ page }) => {
		expect((await page.goto('/grupos/novo'))?.status()).toBe(403);
		expect((await page.goto('/grupos/reorganizar'))?.status()).toBe(403);
	});
});

test.describe('líder — ciclo de vida de um grupo', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.lider });

	test('cria, coloca alguém, devolve e arquiva', async ({ page }) => {
		const nome = `PG E2E ${Date.now().toString().slice(-6)}`;

		// --- Cria ---------------------------------------------------------------
		await page.goto('/grupos');
		await page.getByRole('link', { name: 'Novo grupo' }).click();
		await page.getByLabel('Nome do grupo').fill(nome);
		await page.getByText('Roxo').click();
		await page.getByLabel('Dia do encontro').selectOption({ label: 'Quinta' });
		await page.getByLabel('Horário').fill('20:00');
		await page.getByRole('button', { name: 'Criar grupo' }).click();

		await expect(page.getByText('Grupo criado')).toBeVisible();
		await expect(page.getByText('Quinta, 20h')).toBeVisible();

		// --- Coloca alguém vindo de outro grupo ---------------------------------
		await page
			.getByLabel('Colocar no grupo')
			.selectOption({ label: 'Thiago Barbosa (hoje em PG Verde)' });
		await page.getByRole('button', { name: 'Colocar no grupo' }).click();
		await expect(page.getByText('Thiago Barbosa veio de PG Verde para este grupo.')).toBeVisible();
		await expect(
			page.getByRole('region', { name: 'Pessoas do grupo' }).getByRole('link', { name: /Thiago/ })
		).toBeVisible();

		// Com gente dentro, a tela nem oferece o botão de arquivar.
		await expect(page.getByRole('button', { name: 'Arquivar' })).toBeHidden();

		// --- A linha do tempo da pessoa registra a passagem ---------------------
		await mudarPeloPerfil(page, 'Thiago Barbosa', 'PG Verde');
		const tempo = page.getByRole('region', { name: 'Linha do tempo' });
		await expect(tempo.getByText(`${nome} → PG Verde`)).toBeVisible();
		await expect(tempo.getByText(`PG Verde → ${nome}`)).toBeVisible();

		// --- Vazio de novo: arquiva ---------------------------------------------
		await abrirGrupo(page, nome);
		await page.getByRole('button', { name: 'Arquivar' }).click();
		await expect(page.getByText('Grupo arquivado.')).toBeVisible();

		await page.goto('/grupos');
		await expect(page.getByRole('link', { name: new RegExp(nome) })).toBeHidden();
		await page.goto('/grupos?arquivados=1');
		await expect(page.getByRole('link', { name: new RegExp(nome) })).toBeVisible();
	});

	test('reorganização: confere antes, aplica só o que ficou marcado', async ({ page }) => {
		await page.goto('/grupos/reorganizar');

		await page.getByLabel('Gustavo Lima', { exact: true }).selectOption({ label: 'PG Azul' });
		await page.getByLabel('Thiago Barbosa', { exact: true }).selectOption({ label: 'PG Azul' });
		await page.getByRole('button', { name: 'Ver o que muda' }).click();

		const conferencia = page.getByRole('region', { name: 'Conferir antes de aplicar' });
		await expect(conferencia.getByText('entram: Gustavo Lima, Thiago Barbosa')).toBeVisible();

		// Nada mudou ainda (RN-09): em outra aba, o PG Verde continua com os dois.
		const outraAba = await page.context().newPage();
		await abrirGrupo(outraAba, 'PG Verde');
		const doVerde = outraAba.getByRole('region', { name: 'Pessoas do grupo' });
		await expect(doVerde.getByRole('link', { name: /Gustavo Lima/ })).toBeVisible();
		await expect(doVerde.getByRole('link', { name: /Thiago Barbosa/ })).toBeVisible();
		await outraAba.close();

		// Aceite parcial: desmarca o Thiago.
		await conferencia.getByRole('checkbox', { name: /Thiago Barbosa/ }).uncheck();
		await page.getByRole('button', { name: 'Aplicar as mudanças marcadas' }).click();
		await expect(page.getByText('1 mudança registrada')).toBeVisible();

		await abrirGrupo(page, 'PG Azul');
		const pessoas = page.getByRole('region', { name: 'Pessoas do grupo' });
		await expect(pessoas.getByRole('link', { name: /Gustavo Lima/ })).toBeVisible();
		await expect(pessoas.getByRole('link', { name: /Thiago Barbosa/ })).toBeHidden();

		// Devolve o Gustavo, para não mexer no PG Azul dos outros testes.
		await mudarPeloPerfil(page, 'Gustavo Lima', 'PG Verde');
	});
});
