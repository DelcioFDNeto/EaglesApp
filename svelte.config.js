import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Dois alvos a partir do mesmo código:
 *
 *   npm run build          → SPA estático em build/ (Firebase Hosting, PWA, Capacitor)
 *   npm run build:api      → servidor Node em build-api/ (a API da VPS, ver deploy/)
 *
 * O SPA estático não executa os +server.ts: eles só existem no build da API.
 */
const alvoApi = process.env.BUILD_TARGET === 'api';

const adapter = alvoApi
	? adapterNode({ out: 'build-api', precompress: false })
	: adapterStatic({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: false
		});

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter,
		alias: {
			$ui: 'src/lib/ui',
			$server: 'src/lib/server',
			$shared: 'src/lib/shared'
		},
		csp: {
			mode: 'auto',
			directives: {
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self'],
				'connect-src': ['self', 'http://164.152.195.199:3001', 'https://seuapp.web.app'],
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
