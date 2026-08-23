import postgres from 'postgres';
import { E2E_DATABASE_URL } from './ambiente';

/**
 * Contas criadas por `seed/seed.ts`. A senha é conhecida de propósito —
 * o próprio seed avisa que nunca deve rodar em produção.
 */
export const SENHA = 'eagles-desenvolvimento';

export const CONTAS = {
	lider: 'ana@eagles.local',
	conselheiro: 'pedro@eagles.local',
	membro: 'joao@eagles.local',
	/** Usada só nos testes de bloqueio, para não travar as demais. */
	bloqueio: 'leticia@eagles.local'
} as const;

/**
 * Devolve a conta ao estado limpo: sem tentativas falhas e sem bloqueio.
 *
 * O bloqueio progressivo grava no banco, então o teste que o exercita deixaria
 * a conta travada para a execução seguinte.
 */
export async function limparBloqueio(email: string): Promise<void> {
	const sql = postgres(E2E_DATABASE_URL, { max: 1 });
	try {
		await sql`
			UPDATE user_account
			SET failed_attempts = 0, locked_until = NULL
			WHERE lower(email) = ${email.toLowerCase()}
		`;
	} finally {
		await sql.end({ timeout: 5 });
	}
}
