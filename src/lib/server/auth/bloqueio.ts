import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { userAccount } from '../db/schema';
import { audit } from '../audit/log';

/**
 * Bloqueio progressivo de conta por senha errada (ADR 0004, critério 6 do M01).
 *
 * Fica no BANCO (`failed_attempts`, `locked_until`), não na memória: reiniciar
 * a API ou ter duas instâncias não zera a contagem de quem está tentando
 * adivinhar a senha de alguém. O rate limit em memória (`ratelimit.ts`)
 * continua na frente, barrando volume antes do Argon2id.
 *
 * A cada `MAX_LOGIN_ATTEMPTS` erros seguidos (5 por padrão), a conta fica
 * bloqueada por um tempo que DOBRA: 15 min, 30 min, 1 h, 2 h… até 24 h. Uma
 * senha certa depois do bloqueio zera tudo.
 */

const BLOQUEIO_INICIAL_MIN = 15;
const BLOQUEIO_MAXIMO_MIN = 24 * 60;

/** Minutos de bloqueio ao atingir `tentativas` erros; 0 se ainda não bloqueia. */
export function minutosDeBloqueio(tentativas: number, maximo: number): number {
	if (tentativas <= 0 || tentativas % maximo !== 0) return 0;
	const rodada = tentativas / maximo; // 1ª, 2ª, 3ª vez que estoura
	return Math.min(BLOQUEIO_INICIAL_MIN * 2 ** (rodada - 1), BLOQUEIO_MAXIMO_MIN);
}

type Contexto = {
	contaId: string;
	personId: string;
	teamId: string;
	ip: string;
	userAgent: string | null;
	maximo: number;
};

/**
 * Conta mais um erro (incremento atômico no banco), registra na auditoria e,
 * se estourou o limite, bloqueia. Devolve o bloqueio aplicado, se houver.
 */
export async function registrarSenhaErrada(
	db: Database,
	ctx: Contexto
): Promise<{ tentativas: number; bloqueadaAte: Date | null }> {
	const [linha] = await db
		.update(userAccount)
		.set({ failedAttempts: sql`${userAccount.failedAttempts} + 1`, updatedAt: new Date() })
		.where(eq(userAccount.id, ctx.contaId))
		.returning({ tentativas: userAccount.failedAttempts });

	const tentativas = linha?.tentativas ?? 0;

	await audit(db, {
		teamId: ctx.teamId,
		actorPersonId: ctx.personId,
		action: 'auth.login_falhou',
		entity: 'user_account',
		entityId: ctx.contaId,
		after: { tentativas },
		ip: ctx.ip,
		userAgent: ctx.userAgent
	});

	const minutos = minutosDeBloqueio(tentativas, ctx.maximo);
	if (minutos === 0) return { tentativas, bloqueadaAte: null };

	const bloqueadaAte = new Date(Date.now() + minutos * 60_000);
	await db
		.update(userAccount)
		.set({ lockedUntil: bloqueadaAte, updatedAt: new Date() })
		.where(eq(userAccount.id, ctx.contaId));

	await audit(db, {
		teamId: ctx.teamId,
		actorPersonId: ctx.personId,
		action: 'auth.conta_bloqueada',
		entity: 'user_account',
		entityId: ctx.contaId,
		after: { tentativas, minutos, ate: bloqueadaAte.toISOString() },
		ip: ctx.ip,
		userAgent: ctx.userAgent
	});

	return { tentativas, bloqueadaAte };
}
