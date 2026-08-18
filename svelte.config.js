import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		alias: {
			$ui: 'src/lib/ui',
			$server: 'src/lib/server',
			$shared: 'src/lib/shared'
		}
		// CSRF: a verificação de origem em requisições mutantes é padrão do
		// SvelteKit e fica ligada. Só configure `csrf.trustedOrigins` se um dia
		// houver um domínio adicional legítimo enviando formulários.
	}
};

export default config;
