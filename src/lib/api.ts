/**
 * Camada de chamada à API da VPS (Opção B: Firebase Hosting + API separada).
 *
 * O frontend no Firebase é estático: não há server actions nem sessão
 * server-side. Toda chamada vai por fetch com JWT no header Authorization.
 *
 * Inclui cache local (IndexedDB) para especialidades críticas que precisam
 * funcionar offline ou em rede fraca.
 */

import * as envPublico from '$env/static/public';
import { buscarComCache } from '$lib/cache/sync';
import type { AtributosPessoa } from '$shared/atributos';

/**
 * Endereço da API, fixado no build a partir de `PUBLIC_API_URL`
 * (`.env.production` para o Firebase/APK; ver DEPLOY.md).
 *
 * Sem a variável, usa a mesma origem: é o caso do `npm run dev`, em que os
 * `+server.ts` rodam no próprio servidor do Vite. O build de produção do SPA
 * se recusa a sair sem ela (svelte.config.js), então este padrão nunca chega
 * ao Firebase.
 *
 * Import por namespace porque a variável pode não existir: um import nomeado
 * de `$env/static/public` quebraria o build quando ela falta.
 */
const API_URL = ((envPublico as Record<string, string | undefined>).PUBLIC_API_URL ?? '').replace(
	/\/+$/,
	''
);

export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
	const token = typeof localStorage !== 'undefined' ? localStorage.getItem('eagles_token') : null;

	const res = await fetch(`${API_URL}${path}`, {
		...opts,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...opts.headers
		}
	});

	if (res.status === 401 && typeof window !== 'undefined') {
		localStorage.removeItem('eagles_token');
		if (!window.location.pathname.startsWith('/entrar')) {
			window.location.href = '/entrar';
		}
	}

	return res;
}

/** Helpers tipados para verbos comuns */
export const api = {
	get: (path: string, opts?: RequestInit) => apiFetch(path, { ...opts, method: 'GET' }),
	post: (path: string, body?: unknown, opts?: RequestInit) =>
		apiFetch(path, {
			...opts,
			method: 'POST',
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
	put: (path: string, body?: unknown, opts?: RequestInit) =>
		apiFetch(path, {
			...opts,
			method: 'PUT',
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
	patch: (path: string, body?: unknown, opts?: RequestInit) =>
		apiFetch(path, {
			...opts,
			method: 'PATCH',
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
	delete: (path: string, opts?: RequestInit) => apiFetch(path, { ...opts, method: 'DELETE' })
};

export type Perfil = {
	id: string;
	nome: string;
	dataNascimento: string | null;
	criadoEm: string;
	podeAlterarStatus?: boolean;
	podeAvaliarAtributos?: boolean;
	atributos?: AtributosPessoa;
	perfil: {
		telefone: string | null;
		whatsapp: string | null;
		email: string | null;
		dataNascimento: string | null;
		fotoUrl: string | null;
		relacionamento: string | null;
		irmaos: string | null;
		vinculosFamiliares: string | null;
		status: string;
		dataEntrada: string | null;
		frequencia: number;
		observacoes: string | null;
	} | null;
	historico: Array<{
		id: string;
		deStatus: string | null;
		paraStatus: string;
		motivo: string | null;
		mudadoPor: string | null;
		eventoId: string | null;
		grupoId: string | null;
		ocorridoEm: string;
	}>;
};

export type Sessao = { id: string; aparelho: string; criadaEm: string; atual: boolean };

export type DashboardPendencias = {
	convitesAbertos?: number;
	escalasPropostas?: number;
	despesasPendentes?: number;
	sugestoesIaPendentes?: number;
};

export type DashboardInicio =
	| {
			perfil: 'lider' | 'conselheiro';
			frequenciaPg30d?: {
				taxaPresenca: number | null;
				chamadas: number;
				mediaPresentes: number | null;
			};
			pessoasNovas30d?: number;
			subgrupos?: {
				ativos: number;
				pessoasAlocadas: number;
				membrosSemSubgrupo: number;
			};
			pendencias?: DashboardPendencias;
			financeiro?: {
				arrecadadoCents: number;
				despesasCents: number;
				saldoCents: number;
			};
	  }
	| {
			perfil: 'membro';
			meuSubgrupo: { id: string; nome: string } | null;
			minhaFrequencia90d?: {
				taxa: number | null;
				presencas: number;
				esperados: number;
			};
			minhasContribuicoes?: {
				totalCents: number;
				quantidade: number;
			};
	  }
	| {
			perfil: 'visitante';
	  };

export type Inicio = {
	nome: string;
	papeis: string[];
	permissoes: string[];
	notificacoesNaoLidas?: number;
	proximoEvento: {
		id: string;
		title: string;
		startsAt: string;
		location: string | null;
		status: string;
		tipoNome: string | null;
	} | null;
	proximasResponsabilidades: Array<{
		id: string;
		eventId: string;
		eventoTitulo: string;
		eventoInicio: string;
		responsabilidadeNome: string;
		status: string;
	}>;
	ultimoAviso?: {
		id: string;
		title: string;
		body: string;
		publishedAt: string | null;
	} | null;
	/** Só para Master e líderes: mandato vencendo/vencido ou vaga aberta. */
	avisoLideranca?: string | null;
	/** Para quem organiza: o que já foi feito (`null` = não se aplica a esta pessoa). */
	primeirosPassos?: {
		subgrupo?: boolean | null;
		pg?: boolean | null;
		tipoEvento: boolean | null;
		pessoas: boolean | null;
		evento: boolean | null;
	};
	/** Visão resumida da tela inicial, ajustada às permissões da pessoa (§22). */
	dashboard?: DashboardInicio;
};

export const apiCache = {
	perfil: (ttlMs?: number) => buscarComCache<Perfil>('/api/pessoas/me', { ttlMs }),
	sessoes: (ttlMs?: number) => buscarComCache<Sessao[]>('/api/sessoes', { ttlMs }),
	inicio: (ttlMs?: number) => buscarComCache<Inicio>('/api/inicio', { ttlMs })
};
