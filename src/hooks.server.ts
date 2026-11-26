import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { iniciarManutencao } from '$server/manutencao';
import { randomUUID } from 'node:crypto';
import { db } from '$server/db';
import { person } from '$server/db/schema';
import { eq } from 'drizzle-orm';
import { clearSessionCookie, SESSION_COOKIE, validateSession } from '$server/auth/session';
import { loadActor } from '$server/policy/actor';
import { PolicyDenied } from '$server/policy/policy';

/**
 * Ponto por onde passa toda requisição.
 *
 * Responsabilidades, nesta ordem:
 *   1. Identificar a requisição (para correlacionar log e mensagem de erro)
 *   2. Resolver a sessão do cookie
 *   3. Montar o Actor com papéis e permissões
 *   4. Aplicar cabeçalhos de segurança
 *
 * O que este arquivo NÃO faz: decidir se a rota é permitida. Isso é de cada
 * rota, que declara sua permissão e chama `authorize`. Um guarda genérico aqui
 * daria a falsa sensação de proteção sem saber o contexto (qual grupo? qual
 * pessoa?), e contexto é metade da decisão neste modelo.
 */

const handleSessao: Handle = async ({ event, resolve }) => {
	event.locals.requestId = randomUUID();
	event.locals.actor = null;
	event.locals.session = null;
	event.locals.displayName = null;

	const token = event.cookies.get(SESSION_COOKIE);

	if (token) {
		const banco = db();
		const sessao = await validateSession(banco, token);

		if (sessao) {
			event.locals.session = sessao.session;
			event.locals.actor = await loadActor(banco, sessao.personId);

			const [pessoa] = await banco
				.select({ nome: person.fullName })
				.from(person)
				.where(eq(person.id, sessao.personId))
				.limit(1);
			event.locals.displayName = pessoa?.nome ?? null;
		} else {
			// Cookie apontando para sessão morta: limpa, para o navegador parar
			// de mandar e o usuário ver a tela de entrada em vez de um erro.
			clearSessionCookie(event.cookies);
		}
	}

	return resolve(event);
};

const handleSeguranca: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// CSP é gerada pelo SvelteKit via `kit.csp` (svelte.config.js) em modo
	// auto: adiciona nonce aos scripts inline do SvelteKit e permite hidratação,
	// use:enhave e service worker. Não duplicar aqui para evitar conflito.
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), payment=(), usb=()');

	// HSTS só sob HTTPS — em desenvolvimento (http://localhost) prenderia o
	// navegador a um esquema que a máquina local não serve.
	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
	}

	return response;
};

/**
 * Origens que podem chamar a API pelo navegador.
 *
 * `CORS_ORIGINS` (lista separada por vírgula) cobre os endereços do mesmo
 * frontend: `<projeto>.web.app`, `<projeto>.firebaseapp.com` e o APK do
 * Capacitor (`https://localhost`). `FRONTEND_URL` entra sempre.
 * Fora de produção, o Vite local também é aceito.
 */
function origensPermitidas(): Set<string> {
	const lista = [process.env.FRONTEND_URL, ...(process.env.CORS_ORIGINS ?? '').split(',')]
		.map((o) => o?.trim().replace(/\/+$/, ''))
		.filter((o): o is string => Boolean(o));

	if (process.env.NODE_ENV !== 'production') {
		lista.push('http://localhost:5173', 'http://127.0.0.1:5173');
	}
	return new Set(lista);
}

const ORIGENS = origensPermitidas();

function cabecalhosCors(headers: Headers, origin: string | null) {
	// A resposta muda conforme a origem: sem Vary, um cache intermediário
	// poderia servir a resposta de uma origem para outra.
	headers.append('Vary', 'Origin');
	if (origin && ORIGENS.has(origin)) {
		headers.set('Access-Control-Allow-Origin', origin);
		headers.set('Access-Control-Allow-Credentials', 'true');
		headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
		headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
		headers.set('Access-Control-Max-Age', '600');
	}
}

const handleCors: Handle = async ({ event, resolve }) => {
	const origin = event.request.headers.get('origin');

	if (event.request.method === 'OPTIONS') {
		const headers = new Headers();
		cabecalhosCors(headers, origin);
		return new Response(null, { status: 204, headers });
	}

	const response = await resolve(event);
	cabecalhosCors(response.headers, origin);
	return response;
};

export const handle: Handle = sequence(handleCors, handleSessao, handleSeguranca);

/**
 * Roda uma vez quando o servidor sobe. Durante o `vite build` (análise e
 * geração do SPA) não há servidor de verdade, então nada é agendado.
 */
export const init: ServerInit = () => {
	if (building) return;
	iniciarManutencao(db);
};

/**
 * Erros que escapam viram uma resposta sem detalhe interno.
 * O detalhe vai para o log do servidor, correlacionado pelo requestId.
 */
export const handleError: HandleServerError = ({ error, event, status }) => {
	const requestId = event.locals.requestId ?? 'sem-id';

	if (error instanceof PolicyDenied) {
		console.warn('[ACESSO NEGADO]', {
			requestId,
			permission: error.permission,
			context: error.context,
			personId: event.locals.actor?.personId ?? null,
			path: event.url.pathname
		});
		return {
			message: 'Você não tem permissão para acessar isto.',
			code: 'acesso_negado',
			requestId
		};
	}

	if (status !== 404) {
		console.error('[ERRO]', { requestId, path: event.url.pathname, error });
	}

	return {
		message: 'Algo deu errado do nosso lado. Tente de novo em instantes.',
		code: 'erro_interno',
		requestId
	};
};
