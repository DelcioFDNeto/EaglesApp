/**
 * Gerenciador de sincronização offline/online.
 *
 * - Quando há conexão: busca na API, salva no IndexedDB e retorna os dados.
 *   Se a API falhar, tenta o cache como fallback.
 * - Quando não há conexão: retorna direto do IndexedDB se existir.
 * - Quando a conexão volta: dispara sincronização automática das especialidades
 *   que estavam em uso.
 */

import { apiFetch } from '$lib/api';
import { cacheSalvar, cacheLer, cacheRemover, cacheLimparTudo } from './indexeddb';

type StoreNome = 'perfil' | 'sessoes' | 'inicio';

const MAPA_STORE_POR_ENDPOINT: Record<string, StoreNome> = {
	'/api/auth/me': 'perfil',
	'/api/sessoes': 'sessoes',
	'/api/inicio': 'inicio'
};

/** Lista de especialidades que precisam de revalidação quando volta online. */
const ESPECIALIDADES: StoreNome[] = ['perfil', 'sessoes', 'inicio'];

let ouvintesConectados: Array<(online: boolean) => void> = [];
let sincronizando = false;

/** Chama os ouvintes quando o estado de conexão muda. */
function notificarConectados(online: boolean) {
	for (const fn of ouvintesConectados) fn(online);
}

/** Detecta se está online agora. */
export function estaOnline(): boolean {
	return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/** Registra um ouvinte para mudanças de conexão. */
export function aoMudarConexao(callback: (online: boolean) => void) {
	ouvintesConectados.push(callback);

	if (typeof window !== 'undefined') {
		window.addEventListener('online', () => {
			notificarConectados(true);
			sincronizarEspecialidades();
		});
		window.addEventListener('offline', () => {
			notificarConectados(false);
		});
	}

	return () => {
		ouvintesConectados = ouvintesConectados.filter((f) => f !== callback);
	};
}

/**
 * Busca dados de um endpoint com cache local.
 * Prioridade: API (se online) → cache (se existir e não expirou) → erro.
 */
export async function buscarComCache<T>(
	endpoint: string,
	opcoes?: { forcarApi?: boolean; ttlMs?: number }
): Promise<T> {
	const store = MAPA_STORE_POR_ENDPOINT[endpoint];
	const forcarApi = opcoes?.forcarApi ?? false;
	const ttlMs = opcoes?.ttlMs ?? 5 * 60 * 1000;

	const online = estaOnline();

	// Se está online e não forçou cache, tenta a API primeiro.
	if (online && !forcarApi) {
		try {
			const resposta = await apiFetch(endpoint);
			if (resposta.ok) {
				const dados = (await resposta.json()) as T;
				if (store) {
					await cacheSalvar(store, endpoint, dados, ttlMs);
				}
				return dados;
			}
		} catch {
			// Falha na rede: cai para cache abaixo.
		}
	}

	// Fallback para cache.
	if (store) {
		const cache = await cacheLer<T>(store, endpoint);
		if (cache) {
			return cache.dado;
		}
	}

	// Se não tem cache nem conexão, lança erro acionável.
	if (!online) {
		throw new Error('sem_conexao');
	}

	throw new Error('erro_ao_buscar');
}

/**
 * Sincroniza todas as especialidades contra a API quando a conexão volta.
 * Lê do cache para saber o que precisa ser atualizado e dispara fetch em
 * paralelo.
 */
export async function sincronizarEspecialidades(): Promise<void> {
	if (sincronizando) return;
	sincronizando = true;

	try {
		const online = estaOnline();
		if (!online) return;

		await Promise.allSettled(
			ESPECIALIDADES.map(async (store) => {
				const endpoint = Object.entries(MAPA_STORE_POR_ENDPOINT).find(
					([, s]) => s === store
				)?.[0];
				if (!endpoint) return;

				try {
					const resposta = await apiFetch(endpoint);
					if (resposta.ok) {
						const dados = await resposta.json();
						await cacheSalvar(store, endpoint, dados);
					}
				} catch {
					// Ignora falhas individuais; a próxima tentativa será na
					// próxima mudança de conexão ou na próxima abertura da tela.
				}
			})
		);
	} finally {
		sincronizando = false;
	}
}

/**
 * Limpa toda a cache local. Chamada no logout ou troca de conta.
 */
export async function limparCacheLocal(): Promise<void> {
	await cacheLimparTudo();
}

/**
 * Remove o perfil da cache (ex: após alteração de dados cadastrais).
 */
export async function removerPerfilCache(): Promise<void> {
	await cacheRemover('perfil', '/api/auth/me');
}
