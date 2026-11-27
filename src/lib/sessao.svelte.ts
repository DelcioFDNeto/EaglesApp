import { goto } from '$app/navigation';
import { api, apiCache, type Inicio } from '$lib/api';
import { limparCacheLocal } from '$lib/cache/sync';

/**
 * Quem está usando o app: nome e permissões, para a moldura (menu) montar os
 * itens. Vem do mesmo `/api/inicio` da tela inicial, com cache local, então
 * abrir o app não custa uma chamada a mais.
 *
 * Isto só decide o que MOSTRAR. Quem decide o que a pessoa PODE é o servidor.
 */

type DadosSessao = { nome: string; permissoes: string[] };

let dados = $state<DadosSessao | null>(null);
let pendente: Promise<void> | null = null;

export const sessao = {
	get dados() {
		return dados;
	},

	/** Atualiza com o que a tela inicial acabou de receber (evita outra chamada). */
	definir(inicio: Pick<Inicio, 'nome' | 'permissoes'>) {
		dados = { nome: inicio.nome, permissoes: inicio.permissoes };
	},

	/** Carrega uma vez; chamadas seguintes reaproveitam a mesma promessa. */
	carregar(): Promise<void> {
		if (dados) return Promise.resolve();
		pendente ??= apiCache
			.inicio()
			.then((inicio) => {
				dados = { nome: inicio.nome, permissoes: inicio.permissoes };
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
			// Aparelho compartilhado: o próximo a entrar não pode ver, nem offline,
			// o que ficou guardado da sessão anterior.
			await limparCacheLocal().catch(() => {});
			await goto('/entrar');
		}
	}
};
