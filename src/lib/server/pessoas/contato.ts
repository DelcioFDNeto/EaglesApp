import { and, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db';
import { userAccount } from '../db/schema';
import { normalizarTelefone, telefoneValido } from '$shared/telefone';

/**
 * Contato de login (e-mail e/ou telefone) usado no cadastro e no convite.
 *
 * O telefone é gravado normalizado (ver `$shared/telefone`), que é a mesma
 * forma que o login procura. Campo vazio vira `null`.
 */
export const contatoSchema = z.object({
	email: z
		.union([z.string().trim().toLowerCase().email('Informe um e-mail válido.'), z.literal('')])
		.optional()
		.transform((v) => v || null),
	telefone: z
		.string()
		.trim()
		.optional()
		.refine((v) => !v || telefoneValido(v), 'Informe o telefone com DDD, ex.: (91) 99999-0001.')
		.transform((v) => (v ? normalizarTelefone(v) : null))
});

export type Contato = z.infer<typeof contatoSchema>;

/**
 * O e-mail ou o telefone já é o login de OUTRA pessoa?
 *
 * Login duplicado faria a mesma credencial abrir duas contas — o banco também
 * barra (índices únicos), mas aqui a resposta vira uma mensagem que a pessoa
 * entende em vez de um erro 500.
 */
export async function contatoEmUso(
	db: Database,
	contato: { email: string | null; telefone: string | null },
	excetoPersonId?: string
): Promise<'email' | 'telefone' | null> {
	const condicoes: SQL[] = [];
	if (contato.email) condicoes.push(sql`lower(${userAccount.email}) = ${contato.email}`);
	if (contato.telefone) condicoes.push(eq(userAccount.phone, contato.telefone));
	if (condicoes.length === 0) return null;

	const [conta] = await db
		.select({ email: userAccount.email, telefone: userAccount.phone })
		.from(userAccount)
		.where(
			and(or(...condicoes), excetoPersonId ? ne(userAccount.personId, excetoPersonId) : undefined)
		)
		.limit(1);

	if (!conta) return null;
	return contato.email && conta.email?.toLowerCase() === contato.email ? 'email' : 'telefone';
}

export const MENSAGEM_CONTATO_EM_USO = {
	email: 'Este e-mail já é o acesso de outra pessoa do cadastro.',
	telefone: 'Este telefone já é o acesso de outra pessoa do cadastro.'
} as const;
