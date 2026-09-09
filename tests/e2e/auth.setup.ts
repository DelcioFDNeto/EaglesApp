import { test as setup, expect } from '@playwright/test';
import { CONTAS, SENHA, ESTADO_DE_SESSAO, limparBloqueio } from './contas';

/**
 * Autentica uma vez por papel e guarda a sessão em disco.
 *
 * Sem isto, cada teste faria seu próprio login e a suíte inteira — que sai de
 * um único endereço — esgotaria o limite de tentativas por IP. Os testes
 * começavam a falhar com "Muitas tentativas deste dispositivo", que é a
 * proteção funcionando, não um defeito.
 *
 * Os testes que exercitam o LOGIN em si continuam entrando pelo formulário:
 * `entrar.spec.ts` e `sem-javascript.spec.ts` não usam estes estados.
 */
for (const [papel, email] of Object.entries(CONTAS)) {
	setup(`autentica como ${papel}`, async ({ page }) => {
		// A conta de bloqueio pode ter ficado travada por um teste anterior.
		await limparBloqueio(email);
		await page.goto('/entrar');
		await page.getByLabel('E-mail ou telefone').fill(email);
		await page.getByLabel('Senha').fill(SENHA);
		await page.getByRole('button', { name: 'Entrar' }).click();

		await page.waitForURL('**/inicio');
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Olá');

		await page.context().storageState({ path: ESTADO_DE_SESSAO[papel as keyof typeof CONTAS] });
	});
}
