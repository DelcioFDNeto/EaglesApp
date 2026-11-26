import { json } from '@sveltejs/kit';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { person, userAccount } from '$server/db/schema';
import { env } from '$server/env';
import { audit } from '$server/audit/log';
import { registrarSenhaErrada } from '$server/auth/bloqueio';
import { verifyPassword } from '$server/auth/password';
import { createSession } from '$server/auth/session';
import { checkRateLimit, clearRateLimit, RULES } from '$server/auth/ratelimit';
import { gerarToken } from '$lib/server/auth/jwt';
import { normalizarTelefone } from '$shared/telefone';

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
	// Mesma forma em que o cadastro grava: só dígitos, sem o 55.
	const telefoneLimpo = normalizarTelefone(identificador);

	const ip = getClientAddress();
	const limiteIp = checkRateLimit(`login:ip:${ip}`, RULES.loginPorIp);
	if (!limiteIp.allowed) return respostaBloqueada(limiteIp.retryAfterSeconds);

	const chaveConta = `login:conta:${emailNormalizado}`;
	const limiteConta = checkRateLimit(chaveConta, RULES.loginPorConta);
	if (!limiteConta.allowed) return respostaBloqueada(limiteConta.retryAfterSeconds);

	const banco = db();
	const userAgent = request.headers.get('user-agent');
	const [linha] = await banco
		.select({ conta: userAccount, teamId: person.teamId })
		.from(userAccount)
		.innerJoin(person, eq(person.id, userAccount.personId))
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

	const conta = linha?.conta;

	// Conta bloqueada por senhas erradas: recusa ANTES do Argon2id, com a mesma
	// resposta do rate limit (não confirma que a conta existe).
	if (conta?.lockedUntil && conta.lockedUntil > new Date()) {
		return respostaBloqueada(Math.ceil((conta.lockedUntil.getTime() - Date.now()) / 1000));
	}

	const senhaConfere = conta?.passwordHash
		? await verifyPassword(conta.passwordHash, senha)
		: false;

	if (!conta || !linha || !senhaConfere) {
		if (conta && linha) {
			await registrarSenhaErrada(banco, {
				contaId: conta.id,
				personId: conta.personId,
				teamId: linha.teamId,
				ip,
				userAgent,
				maximo: env().MAX_LOGIN_ATTEMPTS
			});
		}
		return json({ erro: 'E-mail/telefone ou senha incorretos.' }, { status: 401 });
	}

	clearRateLimit(chaveConta);

	const { record } = await createSession(banco, conta.id, { ip, userAgent });

	await banco
		.update(userAccount)
		.set({ lastLoginAt: new Date(), failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
		.where(eq(userAccount.id, conta.id));

	await audit(banco, {
		teamId: linha.teamId,
		actorPersonId: conta.personId,
		action: 'auth.login',
		entity: 'session',
		entityId: record.id,
		ip,
		userAgent
	});

	const token = gerarToken(
		{ personId: conta.personId, email: conta.email ?? undefined, sessionId: record.id },
		record.expiresAt
	);

	return json({
		token,
		pessoa: { id: conta.personId, email: conta.email }
	});
};
