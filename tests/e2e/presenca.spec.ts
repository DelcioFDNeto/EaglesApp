import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { E2E_DATABASE_URL } from './ambiente';
import { CONTAS, ESTADO_DE_SESSAO, removerPessoasDeTeste, SENHA } from './contas';

/**
 * Módulo 06 — Presença, no navegador.
 *
 * As regras (o que conta como falta, quem era esperado, escopo, versão do
 * RSVP) estão em `tests/integration/presenca.test.ts`. Aqui fica o que só a
 * tela prova: o toque responde, a lista se salva, os sinais aparecem para
 * quem cuida do grupo, e o relatório respeita o escopo.
 *
 * Semente: seis semanas de PG Azul e PG Verde com lista feita. Rafael vinha e
 * parou; Isabela, visitante, já veio três vezes; João disse "vou" ao próximo
 * PG Azul.
 */

const PREFIXO = 'Porta E2E';

/** Consulta direta: achar o encontro certo pela tela seria testar a agenda. */
async function consultar<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
	const sql = postgres(E2E_DATABASE_URL, { max: 1 });
	try {
		return await fn(sql);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

/** O PG Azul mais recente com lista feita. */
const ultimoPgAzulComLista = () =>
	consultar(async (sql) => {
		const [e] = await sql<{ id: string }[]>`
			SELECT e.id FROM event e JOIN small_group g ON g.id = e.group_id
			WHERE g.name = 'PG Azul' AND e.attendance_taken_at IS NOT NULL
			ORDER BY e.starts_at DESC LIMIT 1`;
		return e!.id;
	});

/** O próximo PG Azul — o que o João já respondeu. */
const proximoPgAzul = () =>
	consultar(async (sql) => {
		const [e] = await sql<{ id: string; public_code: string }[]>`
			SELECT e.id, e.public_code FROM event e JOIN small_group g ON g.id = e.group_id
			WHERE g.name = 'PG Azul' AND e.series_id IS NOT NULL AND e.starts_at > now()
			  AND e.status = 'agendado'
			ORDER BY e.starts_at LIMIT 1`;
		return e!;
	});

async function semRolagemLateral(page: Page, caminho: string) {
	const larguras = await page.evaluate(() => ({
		pagina: document.documentElement.scrollWidth,
		tela: document.documentElement.clientWidth
	}));
	expect(larguras.pagina, `${caminho} rola para o lado`).toBeLessThanOrEqual(larguras.tela);
}

test.describe('membro — você vai?', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.membro });

	test('responde em um toque no início, e a resposta fica', async ({ page }) => {
		await page.goto('/inicio');
		const proximos = page.getByRole('region', { name: 'Seus próximos encontros' });
		const botoes = proximos.getByRole('group', { name: 'Você vai?' });

		// A semente já tem o "Vou" do João.
		await expect(botoes.getByRole('button', { name: 'Vou', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		await botoes.getByRole('button', { name: 'Talvez' }).click();
		await expect(botoes.getByRole('button', { name: 'Talvez' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		await page.reload();
		await expect(botoes.getByRole('button', { name: 'Talvez' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		// Volta ao que a semente tinha.
		await botoes.getByRole('button', { name: 'Vou', exact: true }).click();
		await expect(botoes.getByRole('button', { name: 'Vou', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	test('pelo link do WhatsApp, logado, também responde', async ({ page }) => {
		const { public_code } = await proximoPgAzul();
		await page.goto(`/e/${public_code}`);
		const voceVai = page.getByRole('region', { name: 'Confirmar presença' });
		await expect(voceVai.getByRole('button', { name: 'Vou', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	});

	test('membro não vê nomes de quem respondeu, nem a lista, nem o relatório', async ({ page }) => {
		const { id } = await proximoPgAzul();
		await page.goto(`/agenda/${id}`);
		await expect(page.getByRole('region', { name: 'Você vai?' })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Quem respondeu' })).toHaveCount(0);

		expect((await page.goto(`/agenda/${await ultimoPgAzulComLista()}/presenca`))?.status()).toBe(
			403
		);
		expect((await page.goto('/frequencia'))?.status()).toBe(403);
		await page.goto('/mais');
		await expect(page.getByRole('link', { name: /Frequência/ })).toHaveCount(0);
	});
});

test.describe('quem recebeu o link e ainda não entrou', () => {
	test('vê o evento, e "entrar" traz de volta ao link para responder', async ({
		browser,
		baseURL
	}) => {
		const { public_code } = await proximoPgAzul();
		const anonimo = await browser.newContext({
			baseURL,
			storageState: { cookies: [], origins: [] }
		});
		const page = await anonimo.newPage();
		await page.goto(`/e/${public_code}`);

		await expect(page.getByText('Para confirmar presença, entre no app.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Vou', exact: true })).toHaveCount(0);

		await page.getByRole('link', { name: 'Entrar no app' }).click();
		await page.getByLabel('E-mail ou telefone').fill(CONTAS.membro);
		await page.getByLabel('Senha').fill(SENHA);
		await page.getByRole('button', { name: 'Entrar' }).click();

		await page.waitForURL(new RegExp(`/e/${public_code}$`));
		await expect(
			page
				.getByRole('region', { name: 'Confirmar presença' })
				.getByRole('button', { name: 'Talvez' })
		).toBeVisible();
		await anonimo.close();
	});
});

test.describe('conselheiro — a lista e os sinais', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.conselheiro });

	test.afterAll(async () => {
		await removerPessoasDeTeste(PREFIXO);
	});

	test('a visão do grupo mostra frequência e sinais — não ranking', async ({ page }) => {
		await page.goto('/grupos');
		await page.getByRole('link', { name: /PG Azul/ }).click();
		const pessoas = page.getByRole('region', { name: 'Pessoas do grupo' });

		const rafael = pessoas.getByRole('listitem').filter({ hasText: 'Rafael Monteiro' });
		await expect(rafael.getByText('Não vem há 3 encontros')).toBeVisible();

		const isabela = pessoas.getByRole('listitem').filter({ hasText: 'Isabela' });
		await expect(isabela.getByText(/Já veio 3 vezes em 60 dias/)).toBeVisible();

		// A lista continua em ordem de nome, e não de frequência.
		const nomes = await pessoas.locator('.nome').allInnerTexts();
		expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));
		await semRolagemLateral(page, 'visão do grupo');
	});

	test('rever a lista: marca, cadastra quem chegou na porta e salva de uma vez', async ({
		page
	}) => {
		const id = await ultimoPgAzulComLista();
		await page.goto(`/agenda/${id}`);
		const presenca = page.getByRole('region', { name: 'Presença' });
		const vieramAntes = Number(
			await presenca.locator('dt:text-is("Vieram") + dd').first().innerText()
		);

		await presenca.getByRole('link', { name: 'Rever a lista de presença' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect(page.getByText(/Esperados \(\d+\)/)).toBeVisible();
		await semRolagemLateral(page, 'lista de presença');

		// Quem já estava marcado continua marcado.
		await expect(page.getByRole('checkbox', { name: /Pedro Henrique/ })).toBeChecked();

		const nome = `${PREFIXO} ${Date.now().toString().slice(-6)}`;
		await page.getByLabel('Nome', { exact: true }).fill(nome);
		await page.getByRole('button', { name: 'Salvar a lista' }).click();
		await expect(page.getByText(`Lista salva: ${vieramAntes + 1} presentes.`)).toBeVisible();

		// Quem chegou na porta aparece entre "também vieram", já marcado — e o
		// campo esvaziou, para um segundo salvar não cadastrá-lo de novo.
		await expect(page.getByRole('checkbox', { name: new RegExp(nome) })).toBeChecked();
		await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('');

		await page.goto(`/agenda/${id}`);
		await expect(presenca.locator('dt:text-is("Vieram") + dd').first()).toHaveText(
			String(vieramAntes + 1)
		);
	});

	test('o relatório do conselheiro é só do grupo dele', async ({ page }) => {
		await page.goto('/mais');
		await page.getByRole('link', { name: /Frequência/ }).click();
		await expect(page).toHaveURL(/\/frequencia/);

		const grupo = page.getByLabel('Grupo');
		await expect(grupo.getByRole('option')).toHaveText(['PG Azul']);
		await expect(page.getByRole('region', { name: 'Pessoas' })).toContainText('Rafael Monteiro');
		await expect(page.getByRole('region', { name: 'Pessoas' })).not.toContainText('Thiago');
		await semRolagemLateral(page, '/frequencia');
	});
});

test.describe('líder — relatório e respostas', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.lider });

	test('relatório da equipe, em ordem alfabética, filtrável por grupo', async ({ page }) => {
		await page.goto('/frequencia');
		const pessoas = page.getByRole('region', { name: 'Pessoas' });
		const nomes = await pessoas.locator('.nome').allInnerTexts();
		expect(nomes.length).toBeGreaterThan(4);
		expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));
		expect(nomes.join('\n')).toContain('Thiago Barbosa');

		await page.getByLabel('Grupo').selectOption({ label: 'PG Verde' });
		await page.getByRole('button', { name: 'Ver' }).click();
		await expect(page).toHaveURL(/grupo=/);
		await expect(pessoas).toContainText('Thiago Barbosa');
		await expect(pessoas).not.toContainText('Rafael Monteiro');
	});

	test('respostas de presença: cria uma nova e arquiva', async ({ page }) => {
		const texto = `Tô dentro ${Date.now().toString().slice(-5)}`;
		await page.goto('/admin/tipos-de-evento');
		const respostas = page.getByRole('region', { name: 'Respostas de presença' });
		await expect(respostas.getByText('Vou chegar atrasado')).toBeVisible();

		await respostas.getByLabel('Texto').fill(texto);
		await respostas.getByRole('button', { name: 'Criar resposta' }).click();
		await expect(page.getByText(`Resposta "${texto}" criada.`)).toBeVisible();

		await respostas.getByRole('button', { name: `Arquivar ${texto}` }).click();
		await expect(page.getByText(/Resposta arquivada/)).toBeVisible();
		await expect(
			respostas.getByRole('listitem').filter({ hasText: texto }).getByText('arquivada', {
				exact: true
			})
		).toBeVisible();
	});
});
