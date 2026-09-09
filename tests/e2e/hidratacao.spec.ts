import { expect, test } from '@playwright/test';
import { ESTADO_DE_SESSAO } from './contas';

/**
 * Guarda: o aplicativo precisa HIDRATAR.
 *
 * Existe por causa de um defeito que sobreviveu ao módulo inteiro sem ninguém
 * notar. Uma CSP escrita à mão com `script-src 'self'` bloqueava o script
 * inline que o SvelteKit emite para iniciar a aplicação. Como as telas são
 * renderizadas no servidor e os formulários funcionam sem JavaScript, tudo
 * continuava "funcionando" — só que sem navegação no cliente, sem
 * `use:enhance`, sem service worker e sem nenhuma reatividade.
 *
 * Nenhum teste pegava, porque todos verificavam RESULTADO, e o resultado era o
 * mesmo. O que denuncia a falha é o console do navegador e o comportamento da
 * navegação, que é o que estes testes olham.
 */

test.describe('hidratação', () => {
	test.use({ storageState: ESTADO_DE_SESSAO.lider });

	test('nenhuma violação de CSP no console', async ({ page }) => {
		const violacoes: string[] = [];
		page.on('console', (m) => {
			if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) {
				violacoes.push(m.text().slice(0, 200));
			}
		});

		await page.goto('/pessoas');
		await page.waitForTimeout(1500);

		expect(violacoes, 'a CSP está bloqueando script do próprio app — ele não vai hidratar').toEqual(
			[]
		);
	});

	test('a navegação interna acontece no cliente, sem recarregar a página', async ({ page }) => {
		await page.goto('/pessoas?busca=rafael');

		// Com o app hidratado, o roteador do SvelteKit intercepta o clique e
		// busca só os dados. Sem hidratar, o navegador faz uma navegação de
		// documento — que é o sintoma que passou despercebido.
		const documentos: string[] = [];
		page.on('request', (r) => {
			if (r.resourceType() === 'document') documentos.push(r.url());
		});

		await page.getByRole('link', { name: /Rafael Monteiro/ }).click();
		await expect(page.getByRole('heading', { name: 'Rafael Monteiro' })).toBeVisible();

		expect(documentos, 'houve recarga completa: o app não hidratou').toEqual([]);
	});
});
