import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$server/db';
import { cadastroPendente } from '$server/db/schema';
import { checkRateLimit, RULES } from '$server/auth/ratelimit';

/**
 * Solicitação de cadastro.
 *
 * PERMISSÃO: pública. O produto Eagles só entra por convite do conselheiro
 * (não há cadastro livre): este endpoint só registra o interesse e devolve um
 * link do WhatsApp para a pessoa avisar o conselheiro.
 */

const schema = z.object({
	nome: z.string().trim().min(2, 'Informe seu nome.').max(120),
	email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(200),
	telefone: z
		.string()
		.trim()
		.max(30)
		.optional()
		.transform((t) => (t ? t : null))
});

export const POST = async ({ request, getClientAddress }) => {
	if (!checkRateLimit(`cadastro:ip:${getClientAddress()}`, RULES.cadastroPorIp).allowed) {
		return json({ erro: 'Muitas solicitações. Tente de novo mais tarde.' }, { status: 429 });
	}

	const corpo = await request.json().catch(() => null);
	const parsed = schema.safeParse(corpo);
	if (!parsed.success) {
		const primeiro = parsed.error.issues[0]?.message ?? 'Dados inválidos.';
		return json({ erro: primeiro }, { status: 400 });
	}

	const { nome, email, telefone } = parsed.data;

	// Pedido repetido com o mesmo e-mail não é erro para quem pede: a
	// solicitação já está registrada (índice único em `email`).
	await db()
		.insert(cadastroPendente)
		.values({ nome, email, telefone })
		.onConflictDoNothing({ target: cadastroPendente.email });

	const numeroConselheiro = process.env.WHATSAPP_CONSELHEIRO;
	const texto = encodeURIComponent(
		`Novo cadastro solicitado:\nNome: ${nome}\nE-mail: ${email}\nTelefone: ${telefone ?? 'não informado'}`
	);

	return json({
		ok: true,
		mensagem: 'Solicitação enviada. Aguarde o convite do seu conselheiro.',
		linkWhatsApp: numeroConselheiro ? `https://wa.me/${numeroConselheiro}?text=${texto}` : null
	});
};
