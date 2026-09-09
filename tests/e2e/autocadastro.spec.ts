import { expect, test } from '@playwright/test';
import { removerPessoasDeTeste, definirFuncionalidade } from './contas';

/**
 * Autocadastro de visitante (RF-02.3) — e, principalmente, RN-29.
 *
 * "Funcionalidade opcional precisa funcionar DESLIGADA, e desligada é o estado
 * padrão de instalação." O primeiro teste é o que prova isso: sem ninguém ligar
 * nada, o endereço não existe.
 */

test.describe('com a chave desligada — o estado padrão', () => {
	test.beforeEach(async () => {
		await definirFuncionalidade('autocadastro_visitante', false);
	});

	test('a rota responde 404, e não uma página dizendo "desativado"', async ({ page }) => {
		const resposta = await page.goto('/sou-novo');
		expect(resposta?.status()).toBe(404);
	});

	test('o POST também é recusado — não basta esconder a tela', async ({ request, baseURL }) => {
		// O `Origin` correto é obrigatório: sem ele o SvelteKit barra por CSRF
		// (403) antes de a ação rodar, e o teste passaria sem nunca ter
		// exercitado a verificação da chave de funcionalidade.
		const resposta = await request.post('/sou-novo', {
			headers: { origin: baseURL! },
			form: { fullName: 'Invasor Silva' },
			failOnStatusCode: false
		});
		expect(resposta.status()).toBe(404);
	});
});

test.describe('com a chave ligada', () => {
	test.beforeAll(async () => {
		await definirFuncionalidade('autocadastro_visitante', true);
	});

	test.afterAll(async () => {
		await definirFuncionalidade('autocadastro_visitante', false);
		await removerPessoasDeTeste('Visitante E2E');
	});

	test('o formulário abre sem autenticação', async ({ page }) => {
		await page.goto('/sou-novo');
		await expect(page.getByRole('heading', { name: 'Que bom te ver aqui' })).toBeVisible();
		await expect(page.getByLabel('Seu nome')).toBeVisible();
	});

	test('um visitante adulto se cadastra e recebe confirmação', async ({ page }) => {
		await page.goto('/sou-novo');

		await page.getByLabel('Seu nome').fill('Visitante E2E Adulto');
		await page.getByLabel('Data de nascimento').fill('1998-04-15');
		await page.getByLabel('Telefone ou WhatsApp').fill('11955551234');
		await page.getByRole('button', { name: 'Enviar' }).click();

		await expect(page.getByText('Pronto!')).toBeVisible();
		await expect(page.getByText(/alguém dos Eagles vai te procurar/)).toBeVisible();
	});

	test('quem é menor passa a ver os campos do responsável, não os próprios', async ({ page }) => {
		await page.goto('/sou-novo');

		await page.getByLabel('Seu nome').fill('Visitante E2E Menor');
		const anoDeMenor = new Date().getFullYear() - 16;
		await page.getByLabel('Data de nascimento').fill(`${anoDeMenor}-04-15`);

		// A troca dos campos é reação à data — o formulário se adapta na hora.
		await expect(page.getByLabel('Nome do seu responsável')).toBeVisible();
		await expect(page.getByLabel('Telefone ou WhatsApp')).toBeHidden();

		await page.getByLabel('Nome do seu responsável').fill('Responsável E2E');
		await page.getByLabel('Telefone do responsável').fill('11944443333');
		await page.getByRole('button', { name: 'Enviar' }).click();

		await expect(page.getByText('Pronto!')).toBeVisible();
		await expect(page.getByText(/conversar com seu responsável/)).toBeVisible();
	});

	test('menor sem responsável informado é barrado pelo servidor', async ({ request, baseURL }) => {
		const anoDeMenor = new Date().getFullYear() - 16;

		// Vai direto ao POST, sem passar pela tela: é assim que a proteção real
		// é testada. Esconder o campo não protege nada.
		const resposta = await request.post('/sou-novo', {
			headers: { origin: baseURL! },
			form: {
				fullName: 'Visitante E2E Sem Responsavel',
				birthDate: `${anoDeMenor}-04-15`,
				phone: '11933332222',
				nomeDoResponsavel: '',
				telefoneDoResponsavel: ''
			},
			failOnStatusCode: false
		});

		// O SvelteKit devolve o resultado da ação como JSON com HTTP 200; o
		// status real da falha vem DENTRO do corpo. Conferir só o código HTTP
		// daria um teste que passa sem ter verificado nada.
		const corpo = await resposta.text();
		expect(corpo).toContain('"type":"failure"');
		expect(corpo).toContain('"status":400');
		expect(corpo).toMatch(/respons/i);
		expect(corpo, 'a pessoa NÃO pode ter sido criada').not.toContain('"pronto"');
	});
});
