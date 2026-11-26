import { eq } from 'drizzle-orm';
import type { Database } from '../../../src/lib/server/db';
import { userAccount } from '../../../src/lib/server/db/schema';
import { createSession } from '../../../src/lib/server/auth/session';
import { gerarToken } from '../../../src/lib/server/auth/jwt';

/**
 * Emite o JWT como o login de verdade emite: com uma sessão viva no banco.
 *
 * O middleware recusa token sem `sessionId` válido (a revogação precisa valer
 * na hora), então um `gerarToken({ personId })` solto não autentica mais.
 * Devolve também o id da sessão, para testes que revogam.
 */
export async function emitirToken(
	db: Database,
	personId: string
): Promise<{ token: string; sessionId: string }> {
	const [conta] = await db
		.select({ id: userAccount.id, email: userAccount.email })
		.from(userAccount)
		.where(eq(userAccount.personId, personId))
		.limit(1);

	if (!conta) throw new Error(`pessoa ${personId} não tem conta de usuário`);

	const { record } = await createSession(db, conta.id);
	const token = gerarToken({ personId, email: conta.email ?? undefined, sessionId: record.id });
	return { token, sessionId: record.id };
}

/** Atalho quando só o token interessa. */
export async function tokenPara(db: Database, personId: string): Promise<string> {
	return (await emitirToken(db, personId)).token;
}
