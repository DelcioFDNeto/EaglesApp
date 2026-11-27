/**
 * Camada de cache local em IndexedDB.
 *
 * Armazena dados que precisam estar disponíveis offline ou em rede fraca:
 *   - perfil da pessoa logada (/api/auth/me)
 *   - dispositivos conectados (/api/sessoes)
 *   - dados do início (/inicio)
 *
 * Cada "especialidade" (tipo de dado) tem sua própria store. Os dados são
 * salvos com timestamp para saber quando estão desatualizados e precisam de
 * revalidação contra a API.
 */

type StoreNome = 'perfil' | 'sessoes' | 'inicio';

const DB_NAME = 'eagles-cache';
const DB_VERSION = 1;

// TTL padrão: 5 minutos. Após isso, o dado é considerado expirado e a API é
// consultada novamente se houver conexão.
const TTL_PADRAO = 5 * 60 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;

function abrirBanco(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;

	dbPromise = new Promise((resolve, reject) => {
		const requisicao = indexedDB.open(DB_NAME, DB_VERSION);

		requisicao.onupgradeneeded = () => {
			const banco = requisicao.result;
			for (const store of ['perfil', 'sessoes', 'inicio'] as StoreNome[]) {
				if (!banco.objectStoreNames.contains(store)) {
					banco.createObjectStore(store, { keyPath: 'chave' });
				}
			}
		};

		requisicao.onsuccess = () => {
			const banco = requisicao.result;
			banco.onclose = () => {
				dbPromise = null;
			};
			banco.onversionchange = () => {
				banco.close();
				dbPromise = null;
			};
			resolve(banco);
		};
		requisicao.onerror = () => {
			dbPromise = null;
			reject(requisicao.error);
		};
	});

	return dbPromise;
}

async function transacao<T>(
	store: StoreNome,
	mode: IDBTransactionMode,
	acao: (loja: IDBObjectStore) => T
): Promise<T> {
	const banco = await abrirBanco();
	return new Promise((resolve, reject) => {
		const tx = banco.transaction([store], mode);
		const loja = tx.objectStore(store);
		try {
			resolve(acao(loja));
		} catch (erro) {
			reject(erro);
		}
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Salva (ou atualiza) um dado na store. `chave` costuma ser o endpoint ou um
 * identificador único da especialidade.
 */
export async function cacheSalvar(
	store: StoreNome,
	chave: string,
	dado: unknown,
	ttlMs: number = TTL_PADRAO
): Promise<void> {
	await transacao(store, 'readwrite', (loja) => {
		loja.put({
			chave,
			dado,
			expiraEm: Date.now() + ttlMs,
			atualizadoEm: Date.now()
		});
	});
}

/**
 * Lê um dado da cache. Retorna null se não existir ou se expirou.
 */
export async function cacheLer<T>(
	store: StoreNome,
	chave: string
): Promise<{ dado: T; atualizadoEm: number } | null> {
	const resultado = await transacao(store, 'readonly', (loja) => {
		return new Promise<
			{ chave: string; dado: T; expiraEm: number; atualizadoEm: number } | undefined
		>((resolve, reject) => {
			const requisicao = loja.get(chave);
			requisicao.onsuccess = () => resolve(requisicao.result);
			requisicao.onerror = () => reject(requisicao.error);
		});
	});

	if (!resultado) return null;

	const registro = resultado;

	if (Date.now() > registro.expiraEm) {
		return null; // expirado
	}

	return { dado: registro.dado, atualizadoEm: registro.atualizadoEm };
}

/**
 * Remove um dado da cache (ex: após logout).
 */
export async function cacheRemover(store: StoreNome, chave: string): Promise<void> {
	await transacao(store, 'readwrite', (loja) => {
		loja.delete(chave);
	});
}

/**
 * Limpa toda a cache (ex: logout ou troca de conta).
 */
export async function cacheLimparTudo(): Promise<void> {
	for (const store of ['perfil', 'sessoes', 'inicio'] as StoreNome[]) {
		await transacao(store, 'readwrite', (loja) => {
			loja.clear();
		});
	}
}
