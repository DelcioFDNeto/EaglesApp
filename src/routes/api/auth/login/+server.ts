import { json } from '@sveltejs/kit';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { userAccount } from '$server/db/schema';
import { verifyPassword } from '$server/auth/password';
import { createSession } from '$server/auth/session';
import { checkRateLimit, clearRateLimit, RULES } from '$server/auth/ratelimit';
import { gerarToken } from '$lib/server/auth/jwt';

const loginSchema = z.object({
	identificador: z.string().trim().min(1),
	senha: z.string().min(1)
});

function respostaBloqueada(retryAfterSeconds: number) {
	return json(
		{ erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
		{ status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
	);
}

/**
 * PERMISSÃO: pública. Limite por IP e por identificador ANTES do Argon2id
 * (ver ratelimit.ts): cada verificação de senha custa ~600 ms de CPU.
 */
export const POST = async ({ request, getClientAddress }) => {
	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = loginSchema.safeParse(corpo);
	if (!resultado.success) {
		return json({ erro: 'Informe e-mail ou telefone e senha.' }, { status: 400 });
	}

	const { identificador, senha } = resultado.data;
	const emailNormalizado = identificador.toLowerCase();
	const telefoneLimpo = identificador.replace(/\D/g, '');

	const ip = getClientAddress();
	const limiteIp = checkRateLimit(`login:ip:${ip}`, RULES.loginPorIp);
	if (!limiteIp.allowed) return respostaBloqueada(limiteIp.retryAfterSeconds);

	const chaveConta = `login:conta:${emailNormalizado}`;
	const limiteConta = checkRateLimit(chaveConta, RULES.loginPorConta);
	if (!limiteConta.allowed) return respostaBloqueada(limiteConta.retryAfterSeconds);

	const banco = db();
	const [linha] = await banco
		.select()
		.from(userAccount)
		.where(
			and(
				isNull(userAccount.disabledAt),
				or(
					sql`lower(${userAccount.email}) = ${emailNormalizado}`,
					telefoneLimpo.length >= 8
						? eq(userAccount.phone, telefoneLimpo)
						: eq(userAccount.phone, identificador)
				)
			)
		)
		.limit(1);

	if (!linha || !linha.passwordHash || !(await verifyPassword(linha.passwordHash, senha))) {
		return json({ erro: 'E-mail/telefone ou senha incorretos.' }, { status: 401 });
	}

	clearRateLimit(chaveConta);

	const { record } = await createSession(banco, linha.id, {
		ip,
		userAgent: request.headers.get('user-agent')
	});

	await banco
		.update(userAccount)
		.set({ lastLoginAt: new Date(), failedAttempts: 0, updatedAt: new Date() })
		.where(eq(userAccount.id, linha.id));

	const token = gerarToken({
		personId: linha.personId,
		email: linha.email ?? undefined,
		sessionId: record.id
	});

	return json({
		token,
		pessoa: { id: linha.personId, email: linha.email }
	});
};
