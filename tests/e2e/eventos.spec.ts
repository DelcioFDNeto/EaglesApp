import { expect, test, type Page } from '@playwright/test';
import { ESTADO_DE_SESSAO } from './contas';

/**
 * Módulo 05 — Eventos, no navegador.
 *
 * Fuso, materialização, visibilidade e escopo têm cobertura completa em
 * `tests/integration/eventos.test.ts`. Aqui fica o que só a tela prova: o
 * formulário leva ao evento certo, cada papel enxerga a própria agenda, e o
 * link público abre sem login.
 *
 * Semente: PG Azul (quinta, 20h) e PG Verde (terça, 19h30) semanais; um
 * encontro geral publicado para a equipe; e "Outside — inscrições", rascunho.
 */

/** Uma data daqui a `dias` dias, no formato do campo de data. */
function daquiA(dias: number): string {
	const d = new Date(Date.now() + dias * 86_400_000);
	return d.toISOString().slice(0, 10);
}

async function proximosDoInicio(page: Page) {
	await page.goto('/inicio');
	return page.getByRole('region', { name: 'Seus próximos encontros' });
}

test.describe('membro — a própria agenda', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.membro });

	test('o início mostra os próximos encontros dele, e não os do grupo vizinho', async ({
		page
	}) => {
		const proximos = await proximosDoInicio(page);
		await expect(proximos.getByRole('link', { name: /PG Azul/ }).first()).toBeVisible();
		await expect(proximos.getByRole('link', { name: /PG Verde/ })).toHaveCount(0);
	});

	test('a agenda tem o PG dele e o encontro geral — sem rascunho, sem PG Verde', async ({
		page
	}) => {
		await page.goto('/agenda');
		// O próximo mês também, para não depender do dia em que a suíte roda.
		const titulos = [
			...(await page.locator('main a[href^="/agenda/"]').allInnerTexts()),
			...(await (async () => {
				await page.getByRole('link', { name: 'Próximo mês' }).click();
				return page.locator('main a[href^="/agenda/"]').allInnerTexts();
			})())
		].join('\n');

		expect(titulos).toContain('PG Azul');
		expect(titulos).toContain('Encontro geral dos Eagles');
		expect(titulos).not.toContain('PG Verde');
		expect(titulos).not.toContain('Outside');
	});

	test('membro não cria evento', async ({ page }) => {
		await page.goto('/agenda');
		await expect(page.getByRole('link', { name: 'Novo evento' })).toBeHidden();
		expect((await page.goto('/agenda/novo'))?.status()).toBe(403);
	});
});

test.describe('conselheiro — evento do próprio PG, do formulário ao WhatsApp', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.conselheiro });

	test('cria, compartilha, o link abre sem login, e o cancelamento aparece no link', async ({
		page,
		browser,
		baseURL
	}) => {
		const titulo = `Churrasco E2E ${Date.now().toString().slice(-6)}`;

		await page.goto('/agenda');
		await page.getByRole('link', { name: 'Novo evento' }).click();

		// Escopo de grupo: "toda a equipe" nem aparece (D-M05-5), e o grupo já vem.
		await expect(page.getByLabel('Toda a equipe')).toHaveCount(0);
		await expect(page.locator('#grupoId')).toHaveValue(/.+/);

		await page.getByLabel(/^Tipo/).selectOption({ label: 'Evento especial' });
		await page.getByLabel(/^Título/).fill(titulo);
		await page.getByLabel(/^Data/).fill(daquiA(9));
		await page.getByLabel(/^Começa/).fill('12:00');
		await page.getByLabel(/^Local/).fill('Sítio do João');
		await page.getByRole('button', { name: 'Criar' }).click();

		await page.waitForURL(/\/agenda\/[0-9a-f-]+\?criado=1/);
		await expect(page.getByText('Evento publicado')).toBeVisible();
		await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible();

		const whatsapp = page.getByRole('link', { name: 'Compartilhar no WhatsApp' });
		await expect(whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
		const link = await page.getByLabel('Link do evento').inputValue();
		expect(link).toMatch(/\/e\/[A-Za-z0-9]{10}$/);

		// --- Quem recebeu o link no WhatsApp, sem conta ---------------------
		// Estado vazio explícito: sem isto, o contexto novo herda a sessão do
		// conselheiro que o `test.use` deste bloco define.
		const anonimo = await browser.newContext({
			baseURL,
			storageState: { cookies: [], origins: [] }
		});
		const tela = await anonimo.newPage();
		const resposta = await tela.goto(new URL(link).pathname);
		expect(resposta?.headers()['x-robots-tag']).toContain('noindex');
		await expect(tela.getByRole('heading', { level: 1, name: titulo })).toBeVisible();
		await expect(tela.getByText('Sítio do João')).toBeVisible();
		await expect(tela.getByRole('link', { name: 'Entrar no app' })).toBeVisible();

		// --- Cancela, e quem abrir o link de novo fica sabendo -----------------
		await page.getByLabel('Motivo do cancelamento (opcional)').fill('Previsão de chuva');
		await page.getByRole('button', { name: 'Cancelar este evento' }).click();
		await expect(page.getByText('Previsão de chuva')).toBeVisible();

		await tela.reload();
		await expect(tela.getByText('Evento cancelado')).toBeVisible();
		await anonimo.close();
	});

	test('a agenda do conselheiro mostra o PG dele, e não o vizinho', async ({ page }) => {
		await page.goto('/agenda');
		const titulos = (await page.locator('main a[href^="/agenda/"]').allInnerTexts()).join('\n');
		if (titulos) expect(titulos).not.toContain('PG Verde');
		await expect(page.getByRole('option', { name: 'PG Verde' })).toHaveCount(0);
	});
});

test.describe('líder — encontro semanal a partir do grupo', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.lider });

	test('grupo novo → encontro semanal com o combinado → encerrar → arquivar', async ({ page }) => {
		const nome = `PG Semanal ${Date.now().toString().slice(-6)}`;

		// --- O grupo, com o combinado ----------------------------------------
		await page.goto('/grupos/novo');
		await page.getByLabel('Nome do grupo').fill(nome);
		await page.getByLabel('Dia do encontro').selectOption({ label: 'Quarta' });
		await page.getByLabel('Horário').fill('19:45');
		await page.getByRole('button', { name: 'Criar grupo' }).click();
		await expect(page.getByText('Grupo criado')).toBeVisible();

		// --- O atalho traz o combinado para o formulário ----------------------
		await page.getByRole('link', { name: 'Criar o encontro semanal' }).click();
		await expect(page.getByLabel(/^Título/)).toHaveValue(nome);
		await expect(page.getByLabel(/^Começa/)).toHaveValue('19:45');
		await expect(page.getByLabel(/Toda semana/)).toBeChecked();
		await page.getByRole('button', { name: 'Criar' }).click();

		await page.waitForURL(/\/agenda\/series\/[0-9a-f-]+\?criada=1/);
		await expect(page.getByText('Encontro semanal criado')).toBeVisible();
		await expect(page.getByText(/Toda quarta, 19h45/)).toBeVisible();
		const datas = page.getByRole('region', { name: 'Próximas datas' }).getByRole('link');
		await expect(datas).toHaveCount(6);

		// --- Com encontro marcado, o grupo não se arquiva ----------------------
		await page.goto('/grupos');
		await page.getByRole('link', { name: new RegExp(nome) }).click();
		await expect(
			page
				.getByRole('region', { name: 'Próximos encontros' })
				.getByRole('link', { name: /19h45/ })
				.first()
		).toBeVisible();
		await page.getByRole('button', { name: 'Arquivar' }).click();
		await expect(page.getByText(/ainda tem encontros marcados/)).toBeVisible();

		// --- Encerra a partir de hoje, e aí o grupo vazio se arquiva -----------
		await page.getByRole('link', { name: 'Encontro semanal' }).click();
		await page.getByRole('button', { name: 'Encerrar o encontro semanal' }).click();
		await expect(
			page.getByText(/Encerrado\. \d+ datas? futuras? saíram? da agenda\./)
		).toBeVisible();

		await page.goto('/grupos');
		await page.getByRole('link', { name: new RegExp(nome) }).click();
		await page.getByRole('button', { name: 'Arquivar' }).click();
		await expect(page.getByText('Grupo arquivado.')).toBeVisible();
	});

	test('tipos de evento: chega por "Mais", cria e arquiva', async ({ page }) => {
		const nome = `Vigília E2E ${Date.now().toString().slice(-6)}`;
		await page.goto('/mais');
		await page.getByRole('link', { name: /Tipos de evento/ }).click();
		await expect(page.getByText('Encontro de PG')).toBeVisible();

		const novo = page.getByRole('region', { name: 'Novo tipo' });
		await novo.getByLabel('Nome').fill(nome);
		await novo.getByRole('button', { name: 'Criar tipo' }).click();
		await expect(page.getByText(`Tipo "${nome}" criado.`)).toBeVisible();

		const item = page.getByRole('listitem').filter({ hasText: nome });
		await item.getByRole('button', { name: 'Arquivar' }).click();
		await expect(page.getByText('Tipo arquivado.')).toBeVisible();
		await expect(item.getByText('arquivado', { exact: true })).toBeVisible();
	});

	test('o rascunho aparece para o líder, marcado como rascunho', async ({ page }) => {
		// O rascunho da semente fica ~5 semanas à frente: procura nos próximos meses.
		const hoje = new Date();
		let cartao = null;
		for (let i = 0; i < 3 && !cartao; i++) {
			const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + i, 1));
			await page.goto(`/agenda?ver=tudo&mes=${d.toISOString().slice(0, 7)}`);
			const achado = page
				.locator('main a[href^="/agenda/"]')
				.filter({ hasText: 'Outside — inscrições' });
			if ((await achado.count()) > 0) cartao = achado;
		}
		expect(cartao, 'o rascunho da semente não apareceu em três meses').not.toBeNull();
		await expect(cartao!.getByText('rascunho')).toBeVisible();
	});

	test('nenhuma tela de eventos rola para o lado no celular', async ({ page }) => {
		const serie = await (async () => {
			await page.goto('/grupos');
			await page.getByRole('link', { name: /PG Azul/ }).click();
			return page.getByRole('link', { name: 'Encontro semanal' }).getAttribute('href');
		})();

		for (const caminho of ['/agenda', '/agenda/novo', serie!, '/admin/tipos-de-evento', '/mais']) {
			await page.goto(caminho);
			const larguras = await page.evaluate(() => ({
				pagina: document.documentElement.scrollWidth,
				tela: document.documentElement.clientWidth
			}));
			expect(larguras.pagina, `${caminho} rola para o lado`).toBeLessThanOrEqual(larguras.tela);
		}
	});
});
