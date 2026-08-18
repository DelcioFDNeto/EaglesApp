/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

/**
 * Service worker do Eagles App.
 *
 * Estratégia deliberadamente conservadora (RNF-04, seção 13.4):
 *
 *   - Arquivos do build e estáticos → cache primeiro. São versionados, então
 *     nunca servem conteúdo velho.
 *   - Navegação e dados → REDE PRIMEIRO, cache como rede de segurança. O
 *     inverso mostraria a agenda da semana passada como se fosse a desta, e
 *     dado errado com cara de certo é pior que tela de erro.
 *   - POST, PUT, DELETE → nunca passam pelo cache.
 *
 * Não há sincronização offline de escrita aqui. Fila de RSVP e presença é
 * assunto do M06, quando existir RSVP para enfileirar.
 */

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_APP = `eagles-app-${version}`;
const CACHE_DADOS = `eagles-dados-${version}`;

const ARQUIVOS_FIXOS = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_APP)
			.then((cache) => cache.addAll(ARQUIVOS_FIXOS))
			// Ativa imediatamente: um deploy de correção não deve esperar a
			// pessoa fechar todas as abas para valer.
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const chave of await caches.keys()) {
				if (chave !== CACHE_APP && chave !== CACHE_DADOS) {
					await caches.delete(chave);
				}
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;

	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== location.origin) return;

	// Autenticação nunca entra em cache: uma resposta guardada aqui poderia
	// mostrar a tela de login de outra pessoa em dispositivo compartilhado.
	if (
		url.pathname.startsWith('/entrar') ||
		url.pathname.startsWith('/convite') ||
		url.pathname.startsWith('/sair') ||
		url.pathname.startsWith('/api/health')
	) {
		return;
	}

	// Arquivos versionados: cache primeiro.
	if (ARQUIVOS_FIXOS.includes(url.pathname)) {
		event.respondWith(
			caches.open(CACHE_APP).then(async (cache) => {
				const guardado = await cache.match(url.pathname);
				return guardado ?? fetch(request);
			})
		);
		return;
	}

	// Navegação e dados: rede primeiro, cache como rede de segurança.
	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE_DADOS);

			try {
				const resposta = await fetch(request);
				if (resposta.ok && resposta.status === 200) {
					cache.put(request, resposta.clone());
				}
				return resposta;
			} catch {
				const guardado = await cache.match(request);
				if (guardado) return guardado;

				return new Response(
					'<!doctype html><html lang="pt-BR"><meta charset="utf-8">' +
						'<meta name="viewport" content="width=device-width,initial-scale=1">' +
						'<title>Sem conexão · Eagles</title>' +
						'<style>body{font-family:system-ui;display:grid;place-items:center;' +
						'min-height:100vh;margin:0;background:#FBF7F6;color:#241416;text-align:center;padding:2rem}' +
						'h1{font-size:1.5rem;margin:0 0 .5rem}p{color:#63494D;max-width:32ch}</style>' +
						'<div><h1>Você está sem conexão</h1>' +
						'<p>Assim que a internet voltar, é só recarregar. O que você já viu continua disponível.</p></div>',
					{ status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
				);
			}
		})()
	);
});
