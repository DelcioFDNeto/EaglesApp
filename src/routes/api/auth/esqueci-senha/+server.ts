import { json } from '@sveltejs/kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { env } from '$server/env';
import { senhaReset, userAccount } from '$server/db/schema';
import { generateToken, hashToken } from '$server/auth/token';
import { checkRateLimit, RULES } from '$server/auth/ratelimit';
import { enviarEmailReset } from '$lib/server/auth/email';

/**
 * Pedido de redefinição de senha.
 *
 * PERMISSÃO: pública (quem esqueceu a senha não tem como se autenticar).
 *
 * A resposta é sempre a mesma, exista a conta ou não, e mesmo se o envio do
 * e-mail falhar: qualquer diferença viraria um oráculo para descobrir quais
 * e-mails têm conta no Eagles.
 */

const VALIDADE_MS = 15 * 60 * 1000;

const RESPOSTA = {
	ok: true,
	mensagem: 'Se houver uma conta cadastrada, você receberá instruções de redefinição.'
};

const schema = z.object({ email: z.string().trim().toLowerCase().email() });

export const POST = async ({ request, getClientAddress }) => {
	const limiteIp = checkRateLimit(`reset:ip:${getClientAddress()}`, RULES.resetPorIp);
	if (!limiteIp.allowed) {
		return json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
	}

	const corpo = await request.json().catch(() => null);
	const parsed = schema.safeParse(corpo);
	if (!parsed.success) {
		return json({ erro: 'Informe um e-mail válido.' }, { status: 400 });
	}

	const { email } = parsed.data;

	// Por e-mail, sem revelar o estouro: quem pede demais recebe a mesma
	// resposta, só deixa de disparar e-mails.
	if (!checkRateLimit(`reset:email:${email}`, RULES.resetPorEmail).allowed) {
		return json(RESPOSTA);
	}

	const banco = db();
	const [conta] = await banco
		.select({ personId: userAccount.personId, email: userAccount.email })
		.from(userAccount)
		.where(and(sql`lower(${userAccount.email}) = ${email}`, isNull(userAccount.disabledAt)))
		.limit(1);

	if (!conta?.email) {
		return json(RESPOSTA);
	}

	// Um link por vez: pedir de novo invalida o anterior.
	await banco
		.update(senhaReset)
		.set({ usedAt: new Date() })
		.where(and(eq(senhaReset.personId, conta.personId), isNull(senhaReset.usedAt)));

	// Como na sessão, o banco guarda só o hash: um dump não entrega links válidos.
	const token = generateToken();
	await banco.insert(senhaReset).values({
		personId: conta.personId,
		token: hashToken(token),
		expiresAt: new Date(Date.now() + VALIDADE_MS)
	});

	const link = `${env().PUBLIC_ORIGIN}/resetar-senha?token=${encodeURIComponent(token)}`;

	try {
		await enviarEmailReset(conta.email, link);
	} catch (erro) {
		console.error('[RESET] falha ao enviar e-mail de redefinição', erro);
	}

	return json(RESPOSTA);
};
