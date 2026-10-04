import postgres from 'postgres';
import { E2E_DATABASE_URL } from './ambiente';

/**
 * Contas criadas por `seed/seed.ts`. A senha é conhecida de propósito —
 * o próprio seed avisa que nunca deve rodar em produção.
 */
export const SENHA = 'eagles-desenvolvimento';

/** Onde a sessão de cada papel é guardada por `auth.setup.ts`. */
export const ESTADO_DE_SESSAO = {
	lider: 'tests/e2e/.sessoes/lider.json',
	conselheiro: 'tests/e2e/.sessoes/conselheiro.json',
	membro: 'tests/e2e/.sessoes/membro.json',
	bloqueio: 'tests/e2e/.sessoes/bloqueio.json'
} as const;

export const CONTAS = {
	lider: 'ana@eagles.local',
	conselheiro: 'pedro@eagles.local',
	membro: 'joao@eagles.local',
	/** Usada só nos testes de bloqueio, para não travar as demais. */
	bloqueio: 'leticia@eagles.local'
} as const;

/** Liga ou desliga uma chave de funcionalidade direto no banco. */
export async function definirFuncionalidade(chave: string, ligada: boolean): Promise<void> {
	const sql = postgres(E2E_DATABASE_URL, { max: 1 });
	try {
		await sql`UPDATE feature_flag SET enabled = ${ligada} WHERE key = ${chave}`;
	} finally {
		await sql.end({ timeout: 5 });
	}
}

/**
 * Tira da frente as pessoas criadas por um teste.
 *
 * Remoção LÓGICA, igual à de produção — e não por escolha de estilo: `person`
 * tem histórico de estágio, e essa tabela é append-only por gatilho. Um DELETE
 * em cascata bate no gatilho e falha. É a proteção fazendo o trabalho dela.
 */
export async function removerPessoasDeTeste(prefixo: string): Promise<void> {
	const sql = postgres(E2E_DATABASE_URL, { max: 1 });
	try {
		await sql`UPDATE person SET deleted_at = now() WHERE full_name LIKE ${prefixo + '%'}`;
	} finally {
		await sql.end({ timeout: 5 });
	}
}

/**
 * Faz a confirmação de senha das sessões de uma conta parecer antiga.
 *
 * O login conta como reautenticação, então toda sessão nasce "confirmada há
 * pouco". Para exercitar o pedido de senha antes de alterar acessos, é
 * preciso envelhecer essa marca.
 */
export async function envelhecerReautenticacao(email: string): Promise<void> {
	const sql = postgres(E2E_DATABASE_URL, { max: 1 });
	try {
		await sql`
			UPDATE session SET reauthenticated_at = now() - interval '1 hour'
			WHERE account_id IN (SELECT id FROM user_account WHERE lower(email) = ${email.toLowerCase()})
		`;
	} finally {
		await sql.end({ timeout: 5 });
	}
}

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
