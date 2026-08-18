/**
 * Rate limit em memória, com janela deslizante.
 *
 * Roda ANTES de qualquer verificação de senha (ver `password.ts`): o Argon2id
 * custa ~610 ms de CPU, então deixar um atacante chegar até ele é entregar o
 * servidor. Limite primeiro, hash depois.
 *
 * Em memória é suficiente porque a aplicação roda em uma VPS. Com as duas
 * réplicas do deploy sem queda, cada uma tem seu próprio contador — na prática
 * dobra o limite efetivo por alguns segundos durante a troca, o que é
 * aceitável. Se um dia houver mais réplicas, mover para o Postgres (a fila
 * pg-boss já está lá) é uma troca local a este arquivo.
 *
 * O Caddy aplica um limite global mais grosso na borda; este aqui é o limite
 * fino, por conta e por rota.
 */

type Bucket = {
	/** Marcas temporais das tentativas dentro da janela. */
	hits: number[];
	/** Enquanto isto estiver no futuro, tudo é recusado. */
	blockedUntil: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitRule = {
	/** Tentativas permitidas dentro da janela. */
	limit: number;
	/** Tamanho da janela em segundos. */
	windowSeconds: number;
	/** Bloqueio aplicado ao estourar o limite, em segundos. */
	blockSeconds: number;
};

export const RULES = {
	/** Login por conta: protege a senha de uma pessoa específica. */
	loginPorConta: { limit: 5, windowSeconds: 300, blockSeconds: 900 },
	/** Login por IP: protege o servidor de varredura em muitas contas. */
	loginPorIp: { limit: 20, windowSeconds: 300, blockSeconds: 900 },
	/** Tentativas de resgatar convite: evita adivinhação de token. */
	convitePorIp: { limit: 10, windowSeconds: 600, blockSeconds: 1800 }
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitResult =
	{ allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
	const agora = Date.now();
	const bucket = buckets.get(key) ?? { hits: [], blockedUntil: 0 };

	if (bucket.blockedUntil > agora) {
		return { allowed: false, retryAfterSeconds: Math.ceil((bucket.blockedUntil - agora) / 1000) };
	}

	const inicioJanela = agora - rule.windowSeconds * 1000;
	bucket.hits = bucket.hits.filter((t) => t > inicioJanela);

	if (bucket.hits.length >= rule.limit) {
		bucket.blockedUntil = agora + rule.blockSeconds * 1000;
		bucket.hits = [];
		buckets.set(key, bucket);
		return { allowed: false, retryAfterSeconds: rule.blockSeconds };
	}

	bucket.hits.push(agora);
	buckets.set(key, bucket);
	return { allowed: true, remaining: rule.limit - bucket.hits.length };
}

/** Zera o contador após sucesso — quem acertou a senha não deve ficar penalizado. */
export function clearRateLimit(key: string): void {
	buckets.delete(key);
}

/** Remove baldes ociosos. Chamado periodicamente para não vazar memória. */
export function pruneRateLimits(): number {
	const agora = Date.now();
	let removidos = 0;
	for (const [key, bucket] of buckets) {
		const ultimo = bucket.hits.at(-1) ?? 0;
		if (bucket.blockedUntil < agora && ultimo < agora - 3_600_000) {
			buckets.delete(key);
			removidos++;
		}
	}
	return removidos;
}

/** Apenas para testes. */
export function resetRateLimits(): void {
	buckets.clear();
}
