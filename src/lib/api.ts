/**
 * Camada de chamada à API da VPS (Opção B: Firebase Hosting + API separada).
 *
 * O frontend no Firebase é estático: não há server actions nem sessão
 * server-side. Toda chamada vai por fetch com JWT no header Authorization.
 *
 * Inclui cache local (IndexedDB) para especialidades críticas que precisam
 * funcionar offline ou em rede fraca.
 */

import { buscarComCache } from '$lib/cache/sync';

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://164.152.195.199:3001';

export async function apiFetch(
	path: string,
	opts: RequestInit = {}
): Promise<Response> {
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
	delete: (path: string, opts?: RequestInit) =>
		apiFetch(path, { ...opts, method: 'DELETE' })
};

export type Perfil = {
	id: string;
	nome: string;
	dataNascimento: string | null;
	criadoEm: string;
	podeAlterarStatus?: boolean;
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

export type Inicio = {
	nome: string;
	papeis: string[];
	permissoes: string[];
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
};

export const apiCache = {
	perfil: (ttlMs?: number) => buscarComCache<Perfil>('/api/pessoas/me', { ttlMs }),
	sessoes: (ttlMs?: number) => buscarComCache<Sessao[]>('/api/sessoes', { ttlMs }),
	inicio: (ttlMs?: number) => buscarComCache<Inicio>('/api/inicio', { ttlMs })
};
