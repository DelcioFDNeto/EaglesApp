import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { userAccount } from '$server/db/schema';
import { consumeInvite, INVITE_REASON_MESSAGE, lookupInvite } from '$server/auth/invite';
import { hashPassword, PASSWORD_PROBLEM_MESSAGE, validatePassword } from '$server/auth/password';
import { createSession } from '$server/auth/session';
import { checkRateLimit, RULES } from '$server/auth/ratelimit';
import { audit } from '$server/audit/log';
import { gerarToken } from '$lib/server/auth/jwt';
import { formatarTelefone } from '$shared/telefone';

/**
 * Aceite de convite — a porta de entrada de todo usuário (ADR 0004).
 *
 * PERMISSÃO: pública, protegida pelo token de 256 bits + rate limit por IP.
 *
 * Versão API da antiga action de `/convite/[token]`: o frontend é estático
 * (Firebase/Capacitor), então a tela chama estes dois verbos e guarda o JWT.
 *
 *   GET  → diz se o convite vale e de quem é (só o nome, para a saudação)
 *   POST → define a senha, consome o convite e já devolve a sessão
 */

type ErrosConvite = { senha?: string; confirmacao?: string };

const schema = z
	.object({
		senha: z.string().min(1, 'Escolha uma senha.'),
		confirmacao: z.string().min(1, 'Repita a senha.')
	})
	.refine((d) => d.senha === d.confirmacao, {
		path: ['confirmacao'],
		message: 'As senhas não são iguais.'
	});

const MENSAGEM_BLOQUEIO = 'Muitas tentativas. Aguarde alguns minutos.';

export const GET = async ({ params, getClientAddress }) => {
	const limite = checkRateLimit(`convite:ip:${getClientAddress()}`, RULES.convitePorIp);
	if (!limite.allowed) {
		return json({ estado: 'bloqueado', mensagem: MENSAGEM_BLOQUEIO }, { status: 429 });
	}

	const banco = db();
	const resultado = await lookupInvite(banco, params.token);

	if (!resultado.ok) {
		return json({ estado: 'invalido', mensagem: INVITE_REASON_MESSAGE[resultado.reason] });
	}

	// Com o que a pessoa vai entrar depois de criar a senha. É o contato dela
	// mesma, e quem tem o link é ela: mostrar evita o "e agora, qual é meu login?".
	const [conta] = await banco
		.select({ email: userAccount.email, telefone: userAccount.phone })
		.from(userAccount)
		.where(eq(userAccount.personId, resultado.personId))
		.limit(1);

	const login = conta?.telefone
		? { tipo: 'telefone', valor: formatarTelefone(conta.telefone) }
		: conta?.email
			? { tipo: 'email', valor: conta.email }
			: null;

	return json({ estado: 'valido', nome: resultado.fullName, login });
};

export const POST = async ({ params, request, getClientAddress }) => {
	const ip = getClientAddress();
	const userAgent = request.headers.get('user-agent');

	const limite = checkRateLimit(`convite:ip:${ip}`, RULES.convitePorIp);
	if (!limite.allowed) {
		return json({ erro: MENSAGEM_BLOQUEIO }, { status: 429 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const banco = db();

	// Revalida o convite no envio: entre carregar a tela e enviar, ele pode ter
	// sido usado ou revogado.
	const convite = await lookupInvite(banco, params.token);
	if (!convite.ok) {
		return json({ erro: INVITE_REASON_MESSAGE[convite.reason] }, { status: 400 });
	}

	const parsed = schema.safeParse(corpo);
	if (!parsed.success) {
		const campos = parsed.error.flatten().fieldErrors;
		const erros: ErrosConvite = {
			senha: campos.senha?.[0],
			confirmacao: campos.confirmacao?.[0]
		};
		return json({ erros }, { status: 400 });
	}

	const problema = validatePassword(parsed.data.senha, convite.fullName);
	if (problema) {
		const erros: ErrosConvite = { senha: PASSWORD_PROBLEM_MESSAGE[problema] };
		return json({ erros }, { status: 400 });
	}

	// Consome o convite ANTES de criar a conta: se dois envios chegarem juntos,
	// só um passa pelo UPDATE condicional. Sem isso, um clique duplo criaria
	// duas contas para a mesma pessoa.
	const consumido = await consumeInvite(banco, convite.inviteId);
	if (!consumido) {
		return json({ erro: INVITE_REASON_MESSAGE.usado }, { status: 400 });
	}

	const passwordHash = await hashPassword(parsed.data.senha);

	const [existente] = await banco
		.select({ id: userAccount.id, email: userAccount.email })
		.from(userAccount)
		.where(eq(userAccount.personId, convite.personId))
		.limit(1);

	let contaId: string;
	let email: string | null = null;

	if (existente) {
		contaId = existente.id;
		email = existente.email;
		await banco
			.update(userAccount)
			.set({ passwordHash, updatedAt: new Date() })
			.where(eq(userAccount.id, contaId));
	} else {
		const [criada] = await banco
			.insert(userAccount)
			.values({ personId: convite.personId, passwordHash })
			.returning({ id: userAccount.id });
		if (!criada) {
			return json({ erro: 'Não foi possível criar seu acesso. Tente de novo.' }, { status: 500 });
		}
		contaId = criada.id;
	}

	const { record } = await createSession(banco, contaId, { ip, userAgent });

	await audit(banco, {
		teamId: convite.teamId,
		actorPersonId: convite.personId,
		action: 'invite.aceito',
		entity: 'user_account',
		entityId: contaId,
		ip,
		userAgent
	});
	await audit(banco, {
		teamId: convite.teamId,
		actorPersonId: convite.personId,
		action: 'auth.senha_definida',
		entity: 'user_account',
		entityId: contaId,
		ip,
		userAgent
	});

	const token = gerarToken(
		{ personId: convite.personId, email: email ?? undefined, sessionId: record.id },
		record.expiresAt
	);

	return json({ token, pessoa: { id: convite.personId, email } }, { status: 201 });
};
