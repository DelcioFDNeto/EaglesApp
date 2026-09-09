import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Configuração mínima para scripts avulsos (semeadura, preparação do banco de
 * ponta a ponta).
 *
 * Não carrega o plugin do SvelteKit de propósito: o script roda fora do ciclo
 * da aplicação e o plugin não resolve arquivos de `seed/` nem de `tests/`.
 *
 * Em compensação precisa REPETIR os aliases declarados em `svelte.config.js` —
 * é o plugin que normalmente os instala. Sem isto, qualquer módulo de servidor
 * que importe `$server/...` quebra só quando roda por script, e não na
 * aplicação, que é o pior tipo de divergência: some do olhar de quem programa
 * e aparece no CI.
 */
const raiz = (caminho: string) => fileURLToPath(new URL(caminho, import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			$ui: raiz('./src/lib/ui'),
			$server: raiz('./src/lib/server'),
			$shared: raiz('./src/lib/shared'),
			$lib: raiz('./src/lib')
		}
	}
});
