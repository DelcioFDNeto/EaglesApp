import { z } from 'zod';

/**
 * Variáveis de ambiente, validadas na subida.
 *
 * O app falha alto e cedo se faltar algo, em vez de descobrir a ausência no
 * meio de uma requisição. Segredos nunca entram no repositório — ver
 * `.env.example` para a lista completa.
 */
const schema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

	DATABASE_URL: z.string().url(),

	/** Origem pública, usada em links de convite. Ex.: https://app.eagles.com.br */
	PUBLIC_ORIGIN: z.string().url(),

	/** Dias de validade da sessão. 30 é conforto no celular (ADR 0004). */
	SESSION_TTL_DAYS: z.coerce.number().int().positive().max(90).default(30),

	/** Dias de validade de um convite. */
	INVITE_TTL_DAYS: z.coerce.number().int().positive().max(60).default(7),

	/** Tentativas de senha antes do bloqueio progressivo. */
	MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),

	/**
	 * Tentativas de login por IP em 5 minutos.
	 *
	 * Precisa ser configurável porque o valor certo depende de como o app está
	 * exposto. Atrás de um proxy sem `ADDRESS_HEADER`, TODA a comunidade chega
	 * com o mesmo IP — e 20 tentativas travariam todo mundo numa noite de PG.
	 * O padrão vale para o caso correto: cada pessoa com seu próprio IP.
	 */
	LOGIN_MAX_POR_IP: z.coerce.number().int().positive().default(20)
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
	if (cached) return cached;

	const parsed = schema.safeParse(process.env);
	if (!parsed.success) {
		const faltando = parsed.error.issues
			.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
			.join('\n');
		throw new Error(
			`Configuração de ambiente inválida. Corrija o .env:\n${faltando}\n\n` +
				`Use .env.example como referência.`
		);
	}

	cached = parsed.data;
	return cached;
}

/** Apenas para testes: descarta o cache entre suítes. */
export function resetEnvCache(): void {
	cached = null;
}
