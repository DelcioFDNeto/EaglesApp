import { and, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import type { Database } from '../db';
import { person, session, userAccount } from '../db/schema';
import { env } from '../env';
import { generateToken, hashToken } from './token';
import { REAUTH_WINDOW_MINUTES } from '$shared/sessao';

/**
 * Sessões server-side.
 *
 * Por que tabela e não JWT (ADR 0004): sem revogação real, um token vazado
 * vale até expirar. Num sistema que guarda dados pessoais e vai guardar
 * movimentação financeira, esperar a expiração de um token comprometido é
 * inaceitável. Uma linha no banco permite encerrar o acesso agora.
 */

export const SESSION_COOKIE = 'eagles_sessao';

/** Janela em que uma reautenticação recente ainda vale — fonte em `$shared/sessao`. */
export { REAUTH_WINDOW_MINUTES };

export type SessionRecord = typeof session.$inferSelect;

function ttlMs(): number {
	return env().SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export async function createSession(
	db: Database,
	accountId: string,
	meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<{ token: string; record: SessionRecord }> {
	const token = generateToken();
	const now = new Date();

	const [record] = await db
		.insert(session)
		.values({
			accountId,
			tokenHash: hashToken(token),
			expiresAt: new Date(now.getTime() + ttlMs()),
			reauthenticatedAt: now,
			ip: meta.ip ?? null,
			userAgent: meta.userAgent?.slice(0, 500) ?? null
		})
		.returning();

	if (!record) throw new Error('não foi possível criar a sessão');
	return { token, record };
}

/**
 * Resolve o token do cookie numa sessão válida.
 * Devolve `null` para token inexistente, expirado ou revogado — sem distinguir
 * os casos, para não informar um atacante sobre qual token já existiu.
 *
 * Conta desativada e pessoa removida também não têm sessão. Antes, a sessão
 * de quem saiu do cadastro continuava "válida" e só não autorizava nada
 * porque `loadActor` devolvia nulo — por acaso, não por regra (revisão de
 * 17/10/2026).
 */
export async function validateSession(
	db: Database,
	token: string | undefined
): Promise<{ session: SessionRecord; accountId: string; personId: string } | null> {
	if (!token) return null;

	const rows = await db
		.select({ sessao: session, conta: userAccount })
		.from(session)
		.innerJoin(userAccount, eq(session.accountId, userAccount.id))
		.innerJoin(person, eq(person.id, userAccount.personId))
		.where(
			and(
				eq(session.tokenHash, hashToken(token)),
				isNull(session.revokedAt),
				gt(session.expiresAt, new Date()),
				isNull(userAccount.disabledAt),
				isNull(person.deletedAt)
			)
		)
		.limit(1);

	const row = rows[0];
	if (!row) return null;

	return {
		session: row.sessao,
		accountId: row.conta.id,
		personId: row.conta.personId
	};
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
	await db
		.update(session)
		.set({ revokedAt: new Date() })
		.where(and(eq(session.id, sessionId), isNull(session.revokedAt)));
}

/** Encerra todas as sessões abertas da pessoa, em qualquer aparelho. Devolve quantas. */
export async function revogarSessoesDaPessoa(db: Database, personId: string): Promise<number> {
	const revogadas = await db
		.update(session)
		.set({ revokedAt: new Date() })
		.where(
			and(
				isNull(session.revokedAt),
				inArray(
					session.accountId,
					db
						.select({ id: userAccount.id })
						.from(userAccount)
						.where(eq(userAccount.personId, personId))
				)
			)
		)
		.returning({ id: session.id });
	return revogadas.length;
}

/** Encerra todas as outras sessões da conta. Mantém a atual. */
export async function revokeOtherSessions(
	db: Database,
	accountId: string,
	keepSessionId: string
): Promise<number> {
	const revogadas = await db
		.update(session)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(session.accountId, accountId),
				ne(session.id, keepSessionId),
				isNull(session.revokedAt)
			)
		)
		.returning({ id: session.id });

	return revogadas.length;
}

/** Uma reautenticação recente ainda cobre esta ação sensível? */
export function hasFreshReauth(record: SessionRecord): boolean {
	if (!record.reauthenticatedAt) return false;
	const idadeMs = Date.now() - record.reauthenticatedAt.getTime();
	return idadeMs <= REAUTH_WINDOW_MINUTES * 60 * 1000;
}

export async function markReauthenticated(db: Database, sessionId: string): Promise<void> {
	await db.update(session).set({ reauthenticatedAt: new Date() }).where(eq(session.id, sessionId));
}

/** Remove sessões expiradas ou revogadas há mais de 30 dias. Roda na fila. */
export async function pruneSessions(db: Database): Promise<number> {
	const corte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	const removidas = await db
		.delete(session)
		.where(or(lt(session.expiresAt, corte), lt(session.revokedAt, corte)))
		.returning({ id: session.id });
	return removidas.length;
}

// --- Cookie ----------------------------------------------------------------

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		secure: env().NODE_ENV === 'production',
		sameSite: 'lax',
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
