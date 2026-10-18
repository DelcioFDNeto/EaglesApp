import { env } from '../env';

/**
 * Rate limit em memória, com janela deslizante.
 *
 * Roda ANTES de qualquer verificação de senha (ver `password.ts`): o Argon2id
 * custa ~610 ms de CPU, então deixar um atacante chegar até ele é entregar o
 * servidor. Limite primeiro, hash depois.
 *
 * Em memória é suficiente porque a aplicação roda em uma VPS, com uma réplica
 * por padrão. Com `APP_REPLICAS=2`, cada uma tem seu próprio contador — dobra
 * o limite efetivo, o que é aceitável. Se um dia houver mais réplicas, mover
 * para o Postgres (a fila pg-boss já está lá) é uma troca local a este arquivo.
 *
 * Não há outro limite antes deste: o `rate_limit` do Caddy é plugin e saiu na
 * varredura de 11/10/2026. Este é o único — por isso as chaves por IP passam
 * por `chaveDeIp`.
 */

type Bucket = {
	/** Marcas temporais das tentativas dentro da janela. */
	hits: number[];
	/** Enquanto isto estiver no futuro, tudo é recusado. */
	blockedUntil: number;
};

const buckets = new Map<string, Bucket>();

/**
 * Poda oportunista: a cada 10 minutos, quem consulta o limite limpa os baldes
 * ociosos. `pruneRateLimits` existia e ninguém a chamava — as chaves são
 * escolhidas por quem tenta entrar, e o mapa crescia até o processo reiniciar
 * (varredura de 11/10/2026). Sem `setInterval`: nada de timer segurando o
 * processo vivo nem atravessando os testes.
 */
const INTERVALO_DE_PODA_MS = 10 * 60_000;
let ultimaPoda = 0;

/**
 * A chave de limite de um endereço IP.
 *
 * IPv6 conta pelo prefixo /64: é o bloco que a operadora entrega a UM cliente,
 * e dentro dele o aparelho troca de endereço à vontade — por endereço, o
 * limite por IP não limitaria nada (revisão de 17/10/2026). IPv4 mapeado em
 * IPv6 (`::ffff:a.b.c.d`) é o próprio IPv4.
 */
export function chaveDeIp(ip: string): string {
	const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
	if (mapeado) return mapeado[1]!;
	if (!ip.includes(':')) return ip;

	const [cabeca = '', cauda] = ip.split('%')[0]!.toLowerCase().split('::');
	const inicio = cabeca ? cabeca.split(':') : [];
	const fim = cauda ? cauda.split(':') : [];
	const zeros =
		cauda === undefined ? [] : Array(Math.max(0, 8 - inicio.length - fim.length)).fill('0');
	const grupos = [...inicio, ...zeros, ...fim].slice(0, 4);
	return `${grupos.map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

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
	convitePorIp: { limit: 10, windowSeconds: 600, blockSeconds: 1800 },
	/**
	 * Autocadastro de visitante: é o único formulário público que ESCREVE no
	 * banco. O limite é generoso o bastante para várias pessoas atrás do mesmo
	 * Wi-Fi na porta do PG, e apertado o bastante para não virar porta de robô.
	 */
	autocadastroPorIp: { limit: 5, windowSeconds: 600, blockSeconds: 1800 },
	/**
	 * Envios do autocadastro, válidos ou não: só contra robô. Erro de digitação
	 * não pode gastar a cota de CADASTROS de quem divide o Wi-Fi do PG
	 * (varredura de 11/10/2026).
	 */
	autocadastroTentativasPorIp: { limit: 30, windowSeconds: 600, blockSeconds: 600 }
} as const satisfies Record<string, RateLimitRule>;

/**
 * Limite de login por IP, com o teto vindo do ambiente.
 *
 * Existe como função, e não como constante, porque o valor correto depende do
 * deploy — ver `LOGIN_MAX_POR_IP` em `env.ts`.
 */
export function regraLoginPorIp(): RateLimitRule {
	return { ...RULES.loginPorIp, limit: env().LOGIN_MAX_POR_IP };
}

export type RateLimitResult =
	{ allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
	const agora = Date.now();
	if (agora - ultimaPoda > INTERVALO_DE_PODA_MS) {
		ultimaPoda = agora;
		pruneRateLimits();
	}
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
	ultimaPoda = 0;
}

/** Apenas para testes: quantos baldes estão em memória. */
export function contarBaldes(): number {
	return buckets.size;
}
