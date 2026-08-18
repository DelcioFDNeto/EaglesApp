import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { userAccount } from '$server/db/schema';
import { consumeInvite, INVITE_REASON_MESSAGE, lookupInvite } from '$server/auth/invite';
import { hashPassword, PASSWORD_PROBLEM_MESSAGE, validatePassword } from '$server/auth/password';
import { createSession, setSessionCookie } from '$server/auth/session';
import { checkRateLimit, RULES } from '$server/auth/ratelimit';
import { audit } from '$server/audit/log';
import type { Actions, PageServerLoad } from './$types';

/**
 * Aceite de convite — a porta de entrada de todo usuário (ADR 0004).
 *
 * PERMISSÃO: pública, protegida pelo token de 256 bits + rate limit por IP.
 *
 * Fluxo: a pessoa abre o link do WhatsApp, vê o próprio nome, define a senha
 * uma vez e já entra autenticada. Nada de "confirme seu e-mail" no meio.
 */

/**
 * Forma única dos erros de campo.
 *
 * Declarar o tipo importa: o SvelteKit descarta propriedades cujo valor é
 * literalmente `undefined` ao inferir o `ActionData`, e dois `fail()` com
 * formas diferentes viram uma união onde nenhuma chave existe com segurança.
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

export const load: PageServerLoad = async ({ params, getClientAddress }) => {
	const limite = checkRateLimit(`convite:ip:${getClientAddress()}`, RULES.convitePorIp);
	if (!limite.allowed) {
		return { estado: 'bloqueado' as const, mensagem: 'Muitas tentativas. Aguarde alguns minutos.' };
	}

	const resultado = await lookupInvite(db(), params.token);

	if (!resultado.ok) {
		return { estado: 'invalido' as const, mensagem: INVITE_REASON_MESSAGE[resultado.reason] };
	}

	return { estado: 'valido' as const, nome: resultado.fullName };
};

export const actions: Actions = {
	default: async ({ params, request, cookies, getClientAddress }) => {
		const ip = getClientAddress();
		const userAgent = request.headers.get('user-agent');

		const limite = checkRateLimit(`convite:ip:${ip}`, RULES.convitePorIp);
		if (!limite.allowed) {
			return fail(429, { erro: 'Muitas tentativas. Aguarde alguns minutos.' });
		}

		const banco = db();

		// Revalida o convite no envio: entre carregar a página e enviar o
		// formulário, ele pode ter sido usado ou revogado.
		const convite = await lookupInvite(banco, params.token);
		if (!convite.ok) {
			return fail(400, { erro: INVITE_REASON_MESSAGE[convite.reason] });
		}

		const form = await request.formData();
		const parsed = schema.safeParse({
			senha: form.get('senha'),
			confirmacao: form.get('confirmacao')
		});

		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			const erros: ErrosConvite = {
				senha: campos.senha?.[0],
				confirmacao: campos.confirmacao?.[0]
			};
			return fail(400, { erros });
		}

		const problema = validatePassword(parsed.data.senha, convite.fullName);
		if (problema) {
			const erros: ErrosConvite = { senha: PASSWORD_PROBLEM_MESSAGE[problema] };
			return fail(400, { erros });
		}

		// Consome o convite ANTES de criar a conta: se dois envios chegarem
		// juntos, só um passa pelo UPDATE condicional. Sem isso, um clique
		// duplo criaria duas contas para a mesma pessoa.
		const consumido = await consumeInvite(banco, convite.inviteId);
		if (!consumido) {
			return fail(400, { erro: INVITE_REASON_MESSAGE.usado });
		}

		const passwordHash = await hashPassword(parsed.data.senha);

		const existentes = await banco
			.select({ id: userAccount.id })
			.from(userAccount)
			.where(eq(userAccount.personId, convite.personId))
			.limit(1);

		let contaId: string;

		if (existentes[0]) {
			contaId = existentes[0].id;
			await banco
				.update(userAccount)
				.set({ passwordHash, updatedAt: new Date() })
				.where(eq(userAccount.id, contaId));
		} else {
			const [criada] = await banco
				.insert(userAccount)
				.values({ personId: convite.personId, passwordHash })
				.returning({ id: userAccount.id });
			if (!criada) return fail(500, { erro: 'Não foi possível criar seu acesso. Tente de novo.' });
			contaId = criada.id;
		}

		const { token, record } = await createSession(banco, contaId, { ip, userAgent });
		setSessionCookie(cookies, token, record.expiresAt);

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

		redirect(303, '/inicio?boas-vindas=1');
	}
};
