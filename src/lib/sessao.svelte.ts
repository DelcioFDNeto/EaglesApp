import { goto } from '$app/navigation';
import { api, apiCache, type Inicio } from '$lib/api';
import { limparCacheLocal } from '$lib/cache/sync';

/**
 * Quem está usando o app: nome, permissões e contagem de notificações não lidas,
 * para a moldura (menu + sino) montar os itens. Vem do mesmo `/api/inicio` da tela
 * inicial, com cache local, então abrir o app não custa uma chamada a mais.
 *
 * Isto só decide o que MOSTRAR. Quem decide o que a pessoa PODE é o servidor.
 */

type DadosSessao = { nome: string; permissoes: string[]; notificacoesNaoLidas: number };

let dados = $state<DadosSessao | null>(null);
let naoLidas = $state(0);
let pendente: Promise<void> | null = null;
let buscouNaoLidas = false;

function normalizarTotal(valor: number): number {
	return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 0;
}

function sincronizarNaoLidasSilencioso() {
	if (buscouNaoLidas || typeof window === 'undefined') return;
	buscouNaoLidas = true;
	api
		.get('/api/notificacoes?apenasNaoLidas=1&limite=1')
		.then(async (res) => {
			if (!res.ok) return;
			const corpo = (await res.json().catch(() => null)) as { naoLidas?: number } | null;
			if (corpo && typeof corpo.naoLidas === 'number') {
				sessao.setNotificacoesNaoLidas(corpo.naoLidas);
			}
		})
		.catch(() => {
			// Offline ou indisponível: mantém o último valor conhecido.
		});
}

function aplicarInicio(inicio: Pick<Inicio, 'nome' | 'permissoes' | 'notificacoesNaoLidas'>) {
	if (typeof inicio.notificacoesNaoLidas === 'number') {
		naoLidas = normalizarTotal(inicio.notificacoesNaoLidas);
		buscouNaoLidas = true;
	}
	dados = {
		nome: inicio.nome,
		permissoes: inicio.permissoes,
		notificacoesNaoLidas: naoLidas
	};
	if (typeof inicio.notificacoesNaoLidas !== 'number') {
		sincronizarNaoLidasSilencioso();
	}
}

export const sessao = {
	get dados() {
		return dados;
	},

	get notificacoesNaoLidas() {
		return naoLidas;
	},

	/** Atualiza a contagem de notificações não lidas exibida no sino da moldura. */
	setNotificacoesNaoLidas(total: number) {
		naoLidas = normalizarTotal(total);
		buscouNaoLidas = true;
		if (dados) {
			dados = { ...dados, notificacoesNaoLidas: naoLidas };
		}
	},

	/** Atualiza com o que a tela inicial acabou de receber (evita outra chamada). */
	definir(inicio: Pick<Inicio, 'nome' | 'permissoes' | 'notificacoesNaoLidas'>) {
		aplicarInicio(inicio);
	},

	/** Carrega uma vez; chamadas seguintes reaproveitam a mesma promessa. */
	carregar(): Promise<void> {
		if (dados) return Promise.resolve();
		pendente ??= apiCache
			.inicio()
			.then((inicio) => {
				aplicarInicio(inicio);
			})
			.catch(() => {
				// Sem conexão e sem cache: o menu mostra só o básico. Um 401 já
				// leva para /entrar dentro de `apiFetch`.
			})
			.finally(() => {
				pendente = null;
			});
		return pendente;
	},

	async sair() {
		try {
			await api.post('/api/auth/logout');
		} catch {
			// Mesmo sem conexão, a sessão local é encerrada.
		} finally {
			localStorage.removeItem('eagles_token');
			dados = null;
			naoLidas = 0;
			buscouNaoLidas = false;
			// Aparelho compartilhado: o próximo a entrar não pode ver, nem offline,
			// o que ficou guardado da sessão anterior.
			await limparCacheLocal().catch(() => {});
			await goto('/entrar');
		}
	}
};
