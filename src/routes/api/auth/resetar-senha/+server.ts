import { json } from '@sveltejs/kit';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { person, senhaReset, session, userAccount } from '$server/db/schema';
import { hashPassword, PASSWORD_PROBLEM_MESSAGE, validatePassword } from '$server/auth/password';
import { hashToken } from '$server/auth/token';
import { checkRateLimit, RULES } from '$server/auth/ratelimit';
import { audit } from '$server/audit/log';

/**
 * Define a nova senha a partir do link de redefinição.
 *
 * PERMISSÃO: pública, protegida pelo token de uso único (256 bits, 15 min)
 * e por rate limit por IP.
 *
 * Ao trocar a senha, todas as sessões da conta caem: se a senha foi trocada
 * porque alguém a descobriu, esse alguém não pode continuar conectado.
 */

const INVALIDO = 'Link inválido ou expirado. Peça um novo.';

const schema = z.object({
	token: z.string().min(1).max(200),
	novaSenha: z.string().min(1, 'Escolha uma senha.')
});

export const POST = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	const userAgent = request.headers.get('user-agent');

	if (!checkRateLimit(`resetar:ip:${ip}`, RULES.resetarPorIp).allowed) {
		return json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
	}

	const corpo = await request.json().catch(() => null);
	const parsed = schema.safeParse(corpo);
	if (!parsed.success) {
		return json({ erro: INVALIDO }, { status: 400 });
	}

	const banco = db();
	const tokenHash = hashToken(parsed.data.token);

	const [registro] = await banco
		.select({
			id: senhaReset.id,
			personId: senhaReset.personId,
			nome: person.fullName,
			teamId: person.teamId
		})
		.from(senhaReset)
		.innerJoin(person, eq(senhaReset.personId, person.id))
		.where(
			and(
				eq(senhaReset.token, tokenHash),
				isNull(senhaReset.usedAt),
				gt(senhaReset.expiresAt, new Date())
			)
		)
		.limit(1);

	if (!registro) {
		return json({ erro: INVALIDO }, { status: 400 });
	}

	// Valida ANTES de consumir: uma senha fraca não deve queimar o link.
	const problema = validatePassword(parsed.data.novaSenha, registro.nome);
	if (problema) {
		return json({ erro: PASSWORD_PROBLEM_MESSAGE[problema] }, { status: 400 });
	}

	// Consumo condicional: dois envios simultâneos do mesmo link, só um passa.
	const [consumido] = await banco
		.update(senhaReset)
		.set({ usedAt: new Date() })
		.where(and(eq(senhaReset.id, registro.id), isNull(senhaReset.usedAt)))
		.returning({ id: senhaReset.id });

	if (!consumido) {
		return json({ erro: INVALIDO }, { status: 400 });
	}

	const passwordHash = await hashPassword(parsed.data.novaSenha);

	const [conta] = await banco
		.update(userAccount)
		.set({ passwordHash, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
		.where(eq(userAccount.personId, registro.personId))
		.returning({ id: userAccount.id });

	if (!conta) {
		return json({ erro: INVALIDO }, { status: 400 });
	}

	await banco
		.update(session)
		.set({ revokedAt: new Date() })
		.where(and(eq(session.accountId, conta.id), isNull(session.revokedAt)));

	await audit(banco, {
		teamId: registro.teamId,
		actorPersonId: registro.personId,
		action: 'auth.senha_redefinida',
		entity: 'user_account',
		entityId: conta.id,
		ip,
		userAgent
	});

	return json({ ok: true, mensagem: 'Senha redefinida. Entre com a nova senha.' });
};
