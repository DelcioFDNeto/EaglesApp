import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tokens opacos para sessão e convite.
 *
 * O token em claro só existe em dois lugares: no cookie do usuário e no link
 * do convite. O banco guarda apenas o SHA-256. Assim, um dump do banco não
 * entrega sessão de ninguém.
 *
 * SHA-256 sem sal e sem alongamento é adequado AQUI e não seria numa senha:
 * o token tem 256 bits de entropia gerada por CSPRNG, então não há dicionário
 * nem força bruta viável. Alongar seria custo sem ganho.
 */

const TOKEN_BYTES = 32;

/** Base64url sem preenchimento — seguro em URL de convite. */
export function generateToken(): string {
	return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Comparação em tempo constante entre dois hashes hexadecimais. */
export function tokensMatch(hashA: string, hashB: string): boolean {
	const a = Buffer.from(hashA, 'hex');
	const b = Buffer.from(hashB, 'hex');
	if (a.length !== b.length || a.length === 0) return false;
	return timingSafeEqual(a, b);
}
