import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$server/db';
import { INVITE_REASON_MESSAGE } from '$server/auth/invite';
import { abrirConvite, aceitarConviteDeAcesso } from '$server/modules/rbac/convites';
import { createSession, setSessionCookie } from '$server/auth/session';
import { chaveDeIp, checkRateLimit, RULES } from '$server/auth/ratelimit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Aceite de convite — a porta de entrada de todo usuário (ADR 0004).
 *
 * PERMISSÃO: pública, protegida pelo token de 256 bits + rate limit por IP.
 *
 * Serve a dois casos: PRIMEIRO ACESSO e RECUPERAÇÃO de acesso (quem esqueceu a
 * senha recebe um novo convite). A regra de cada um vive em
 * `$server/auth/conta`, e não aqui — foi a lógica inline nesta rota que deixou
 * passar a conta criada sem identificador de entrada.
 *
 * A rota passa por `rbac/convites`, nunca direto pelo auth: é lá que o convite
 * só vale enquanto quem o emitiu ainda poderia emiti-lo (trava 5 no aceite).
 * `tests/unit/convite-passa-pela-trava.test.ts` impede o atalho.
 */

/**
 * Forma única dos erros de campo.
 *
 * Declarar o tipo importa: o SvelteKit descarta propriedades cujo valor é
 * literalmente `undefined` ao inferir o `ActionData`, e dois `fail()` com
 * formas diferentes viram uma união onde nenhuma chave existe com segurança.
 */
type ErrosConvite = { identificador?: string; senha?: string; confirmacao?: string };
type FalhaConvite = { erro?: string; erros?: ErrosConvite; identificador?: string };

const schema = z
	.object({
		identificador: z.string().trim().min(1, 'Informe seu e-mail ou telefone.'),
		senha: z.string().min(1, 'Escolha uma senha.'),
		confirmacao: z.string().min(1, 'Repita a senha.')
	})
	.refine((d) => d.senha === d.confirmacao, {
		path: ['confirmacao'],
		message: 'As senhas não são iguais.'
	});

export const load: PageServerLoad = async ({ params, getClientAddress }) => {
	const limite = checkRateLimit(`convite:ip:${chaveDeIp(getClientAddress())}`, RULES.convitePorIp);
	if (!limite.allowed) {
		return { estado: 'bloqueado' as const, mensagem: 'Muitas tentativas. Aguarde alguns minutos.' };
	}

	const resultado = await abrirConvite(db(), params.token);

	if (!resultado.ok) {
		return { estado: 'invalido' as const, mensagem: INVITE_REASON_MESSAGE[resultado.reason] };
	}

	return {
		estado: 'valido' as const,
		nome: resultado.fullName,
		recuperacao: resultado.recuperacao
	};
};

export const actions: Actions = {
	default: async ({ params, request, cookies, getClientAddress }) => {
		const ip = getClientAddress();
		const userAgent = request.headers.get('user-agent');

		const limite = checkRateLimit(`convite:ip:${chaveDeIp(ip)}`, RULES.convitePorIp);
		if (!limite.allowed) {
			const falha: FalhaConvite = { erro: 'Muitas tentativas. Aguarde alguns minutos.' };
			return fail(429, falha);
		}

		const form = await request.formData();
		const identificadorDigitado = String(form.get('identificador') ?? '');
		const parsed = schema.safeParse({
			identificador: identificadorDigitado,
			senha: form.get('senha'),
			confirmacao: form.get('confirmacao')
		});

		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			const falha: FalhaConvite = {
				identificador: identificadorDigitado,
				erros: {
					identificador: campos.identificador?.[0],
					senha: campos.senha?.[0],
					confirmacao: campos.confirmacao?.[0]
				}
			};
			return fail(400, falha);
		}

		const banco = db();
		const resultado = await aceitarConviteDeAcesso(banco, {
			token: params.token,
			senha: parsed.data.senha,
			identificador: parsed.data.identificador,
			ip,
			userAgent
		});

		if (!resultado.ok) {
			const falha: FalhaConvite = resultado.campo
				? { identificador: identificadorDigitado, erros: { [resultado.campo]: resultado.mensagem } }
				: { identificador: identificadorDigitado, erro: resultado.mensagem };
			return fail(400, falha);
		}

		const { token, record } = await createSession(banco, resultado.contaId, { ip, userAgent });
		setSessionCookie(cookies, token, record.expiresAt);

		redirect(303, resultado.recuperacao ? '/inicio?acesso-recuperado=1' : '/inicio?boas-vindas=1');
	}
};
