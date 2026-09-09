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
		},

		/**
		 * CSP declarada AQUI, e não à mão nos hooks.
		 *
		 * O SvelteKit emite um `<script>` inline para inicializar a aplicação.
		 * Uma CSP escrita à mão com `script-src 'self'` bloqueia esse script — e
		 * o efeito é silencioso da pior forma: como as telas são renderizadas no
		 * servidor e os formulários funcionam sem JavaScript, o app CONTINUA
		 * funcionando, só que sem hidratar nunca. Sem navegação no cliente, sem
		 * `use:enhance`, sem service worker, sem nenhuma reatividade.
		 *
		 * Foi exatamente o que aconteceu entre o M01 e o M02, e só apareceu
		 * quando uma tela passou a depender de reatividade de verdade.
		 *
		 * Com `mode: 'auto'` o próprio SvelteKit acrescenta nonce ou hash aos
		 * scripts que ele gera, e a CSP continua sem `unsafe-inline`.
		 */
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				// `unsafe-inline` em estilo é necessário para os estilos que o
				// Svelte injeta. Script não recebe essa concessão.
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self'],
				'connect-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
		// CSRF: a verificação de origem em requisições mutantes é padrão do
		// SvelteKit e fica ligada. Só configure `csrf.trustedOrigins` se um dia
		// houver um domínio adicional legítimo enviando formulários.
	}
};

export default config;
