import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { loadEnv } from 'vite';

/**
 * Dois alvos a partir do mesmo código:
 *
 *   npm run build          → SPA estático em build/ (Firebase Hosting, PWA, Capacitor)
 *   npm run build:api      → servidor Node em build-api/ (a API da VPS, ver deploy/)
 *
 * O SPA estático não executa os +server.ts: eles só existem no build da API.
 */
const alvoApi = process.env.BUILD_TARGET === 'api';
const ehBuild = process.argv.includes('build');

/**
 * Endereço da API que o SPA vai chamar. Vem de `PUBLIC_API_URL` (variável de
 * ambiente ou `.env.production`), o mesmo valor que `src/lib/api.ts` usa.
 * Entra no CSP: sem isso o navegador bloqueia o fetch para a VPS.
 */
const apiUrl = loadEnv(
	ehBuild ? 'production' : 'development',
	process.cwd(),
	'PUBLIC_'
).PUBLIC_API_URL;

/** Origem da API (sem caminho), ou null se não configurada. */
function origemDaApi() {
	if (!apiUrl) return null;
	try {
		return new URL(apiUrl).origin;
	} catch {
		throw new Error(`PUBLIC_API_URL inválida: "${apiUrl}". Exemplo: https://api.exemplo.com.br`);
	}
}

const origemApi = origemDaApi();

// O SPA publicado no Firebase é servido em HTTPS: uma API em HTTP seria
// bloqueada pelo navegador (mixed content), e sem URL o app chamaria o próprio
// Firebase. Melhor o build falhar aqui do que o app subir quebrado.
if (ehBuild && !alvoApi && !origemApi?.startsWith('https://')) {
	throw new Error(
		'Build do SPA sem PUBLIC_API_URL em HTTPS. Defina em .env.production ' +
			'(ex.: PUBLIC_API_URL=https://api.164-152-195-199.sslip.io). Ver DEPLOY.md.'
	);
}

const adapter = alvoApi
	? adapterNode({ out: 'build-api', precompress: false })
	: adapterStatic({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: false
		});

/**
 * Versão do build, fixada UMA vez e herdada pelos processos filhos.
 *
 * O padrão do SvelteKit é `Date.now()` a cada carga desta configuração. O
 * build a carrega em mais de um processo (cliente, servidor, fallback do
 * SPA), e cada um ganhava uma versão diferente: o index.html do Firebase
 * definia `__sveltekit_<a>` e o JavaScript procurava `__sveltekit_<b>` —
 * página em branco. A variável de ambiente vale para o build inteiro.
 */
process.env.EAGLES_VERSAO_BUILD ??= Date.now().toString();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter,
		version: { name: process.env.EAGLES_VERSAO_BUILD },
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
				// https: — foto de perfil pode ser uma URL externa (RF do M02).
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'font-src': ['self'],
				'connect-src': origemApi ? ['self', origemApi] : ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				// No SPA estático a CSP vai numa <meta>, onde o navegador ignora
				// frame-ancestors; lá ela vem por cabeçalho (firebase.json).
				...(alvoApi ? { 'frame-ancestors': ['none'] } : {})
			}
		}
		// CSRF: a verificação de origem em requisições mutantes é padrão do
		// SvelteKit e fica ligada. Só configure `csrf.trustedOrigins` se um dia
		// houver um domínio adicional legítimo enviando formulários.
	}
};

export default config;
