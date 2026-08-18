import { argon2idAsync } from '@noble/hashes/argon2';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
	MIN_PASSWORD_LENGTH,
	PASSWORD_PROBLEM_MESSAGE,
	type PasswordProblem
} from '../../shared/senha';

/**
 * Hash de senha com Argon2id.
 *
 * Parâmetros da recomendação atual da OWASP para Argon2id:
 *   m = 19456 KiB (19 MiB), t = 2, p = 1
 *
 * Implementação em JavaScript puro (@noble/hashes) e não binding nativo, de
 * propósito: elimina compilação nativa no Windows de quem desenvolve e no
 * contêiner Linux de produção. Custo medido nesta máquina: ~610 ms por hash.
 *
 * Esses 610 ms são aceitáveis num login que acontece uma vez a cada 30 dias,
 * MAS são um vetor de consumo de CPU: quem dispara mil tentativas ocupa o
 * servidor. Por isso o rate limit em `ratelimit.ts` roda ANTES de qualquer
 * chamada a esta função — nunca depois. Ver `routes/(auth)/entrar`.
 *
 * Se um dia o volume de login justificar, trocar por `@node-rs/argon2` é uma
 * mudança local a este arquivo: a interface permanece.
 *
 * Formato armazenado (compatível com a convenção PHC):
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt-b64>$<hash-b64>
 */

const M_COST = 19456; // KiB
const T_COST = 2;
const P_COST = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function b64(buf: Uint8Array): string {
	return Buffer.from(buf).toString('base64').replace(/=+$/, '');
}

function unb64(s: string): Buffer {
	return Buffer.from(s, 'base64');
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_BYTES);
	const hash = await argon2idAsync(password.normalize('NFKC'), salt, {
		m: M_COST,
		t: T_COST,
		p: P_COST,
		dkLen: HASH_BYTES
	});
	return `$argon2id$v=19$m=${M_COST},t=${T_COST},p=${P_COST}$${b64(salt)}$${b64(hash)}`;
}

/**
 * Verifica a senha contra o hash armazenado.
 *
 * Lê os parâmetros do próprio hash em vez de assumir as constantes atuais —
 * assim, aumentar o custo no futuro não invalida as senhas já existentes.
 */
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
	if (!stored) return false;

	const m = stored.match(/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/);
	if (!m) return false;

	const [, mCost, tCost, pCost, saltB64, hashB64] = m;
	const salt = unb64(saltB64!);
	const expected = unb64(hashB64!);

	const actual = await argon2idAsync(password.normalize('NFKC'), salt, {
		m: Number(mCost),
		t: Number(tCost),
		p: Number(pCost),
		dkLen: expected.length
	});

	if (actual.length !== expected.length) return false;
	return timingSafeEqual(Buffer.from(actual), expected);
}

/** O hash foi criado com parâmetros mais fracos que os atuais? */
export function needsRehash(stored: string): boolean {
	const m = stored.match(/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/);
	if (!m) return true;
	return Number(m[1]) < M_COST || Number(m[2]) < T_COST || Number(m[3]) < P_COST;
}

/**
 * Política de senha.
 *
 * Deliberadamente simples: comprimento mínimo generoso em vez de exigir
 * símbolo, maiúscula e número. Regras de composição empurram as pessoas para
 * "Senha@123" e para o papelzinho colado no monitor. Comprimento é o que
 * realmente protege.
 */
const SENHAS_COMUNS = new Set([
	'senha123456',
	'12345678901',
	'1234567890',
	'123456789',
	'eagles2026',
	'eaglesapp1',
	'qwertyuiop',
	'password12',
	'minhasenha'
]);

export function validatePassword(password: string, fullName?: string): PasswordProblem | null {
	const limpa = password.trim();

	if (limpa.length < MIN_PASSWORD_LENGTH) return 'curta';
	if (SENHAS_COMUNS.has(limpa.toLowerCase())) return 'comum';

	if (fullName) {
		const primeiro = fullName.trim().split(/\s+/)[0];
		if (primeiro && primeiro.length >= 4 && limpa.toLowerCase().includes(primeiro.toLowerCase())) {
			return 'contem_nome';
		}
	}

	return null;
}

export { MIN_PASSWORD_LENGTH, PASSWORD_PROBLEM_MESSAGE, type PasswordProblem };
