import { expect, test } from '@playwright/test';

/**
 * O app precisa ser instalável no celular — é a alternativa à loja de
 * aplicativos que o ADR 0001 escolheu para evitar US$ 124/ano e a revisão de
 * 1 a 7 dias por correção.
 *
 * Instalação de verdade não dá para automatizar; o que dá é garantir que os
 * pré-requisitos estão publicados e válidos.
 */

test('o manifesto está declarado e é válido', async ({ page, request }) => {
	await page.goto('/entrar');

	const href = await page.locator('link[rel="manifest"]').getAttribute('href');
	expect(href, 'a página não declara <link rel="manifest">').toBeTruthy();

	const resposta = await request.get(href!);
	expect(resposta.ok()).toBe(true);

	const manifesto = await resposta.json();
	expect(manifesto.display).toBe('standalone');
	expect(manifesto.start_url).toBeTruthy();
	expect(manifesto.lang).toBe('pt-BR');

	// 192 para a tela de início do Android, 512 para a splash, e uma maskable
	// para o ícone não sair cortado nos lançadores que recortam.
	const tamanhos = manifesto.icons.map((i: { sizes: string }) => i.sizes);
	expect(tamanhos).toContain('192x192');
	expect(tamanhos).toContain('512x512');
	expect(manifesto.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
});

test('os ícones do manifesto existem de verdade', async ({ request }) => {
	for (const caminho of ['/icone-192.png', '/icone-512.png', '/apple-touch-icon.png']) {
		const resposta = await request.get(caminho);
		expect(resposta.ok(), `${caminho} não foi encontrado`).toBe(true);
		expect(resposta.headers()['content-type']).toContain('image');
	}
});

test('a verificação de saúde responde — é o que o deploy consulta', async ({ request }) => {
	const resposta = await request.get('/api/health');
	expect(resposta.ok()).toBe(true);

	const corpo = await resposta.json();
	expect(corpo).toMatchObject({ status: 'ok', banco: true });
});
