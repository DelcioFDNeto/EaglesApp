import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$server/db';
import { userAccount } from '$server/db/schema';
import { verifyPassword } from '$server/auth/password';
import { hasFreshReauth, markReauthenticated, REAUTH_WINDOW_MINUTES } from '$server/auth/session';
import { checkRateLimit, clearRateLimit, RULES } from '$server/auth/ratelimit';
import { audit } from '$server/audit/log';
import { destinoInterno } from '$shared/redirecionamento';
import type { Actions, PageServerLoad } from './$types';

/**
 * Confirmar a própria senha antes de uma ação sensível (ADR 0004).
 *
 * PERMISSÃO: nenhuma — PRÓPRIA CONTA. Exige sessão.
 *
 * A confirmação vale por {@link REAUTH_WINDOW_MINUTES} minutos. É o que separa
 * "alguém pegou meu celular desbloqueado" de "alguém pegou meu celular e mudou
 * quem administra os Eagles".
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.actor || !locals.session) redirect(303, '/entrar');

	const voltar = destinoInterno(url.searchParams.get('voltar'));

	// Já confirmou há pouco: não pergunta de novo.
	if (hasFreshReauth(locals.session)) redirect(303, voltar);

	return {
		voltar,
		nome: locals.displayName ?? '',
		minutos: REAUTH_WINDOW_MINUTES
	};
};

export const actions: Actions = {
	default: async ({ locals, request, url, getClientAddress }) => {
		if (!locals.actor || !locals.session) redirect(303, '/entrar');

		const ip = getClientAddress();
		const userAgent = request.headers.get('user-agent');
		const voltar = destinoInterno(url.searchParams.get('voltar'));

		// Mesmo limite do login, por conta: a tela de confirmação não pode virar
		// um jeito de adivinhar a senha de quem deixou a sessão aberta.
		const chave = `reauth:conta:${locals.session.accountId}`;
		const limite = checkRateLimit(chave, RULES.loginPorConta);
		if (!limite.allowed) {
			return fail(429, {
				erro: `Muitas tentativas. Tente de novo em ${Math.ceil(limite.retryAfterSeconds / 60)} minutos.`
			});
		}

		const senha = String((await request.formData()).get('senha') ?? '');
		if (!senha) return fail(400, { erro: 'Digite sua senha.' });

		const banco = db();
		const [conta] = await banco
			.select({ hash: userAccount.passwordHash })
			.from(userAccount)
			.where(eq(userAccount.id, locals.session.accountId))
			.limit(1);

		const confere = conta?.hash ? await verifyPassword(conta.hash, senha) : false;

		await audit(banco, {
			teamId: locals.actor.teamId,
			actorPersonId: locals.actor.personId,
			action: confere ? 'auth.reautenticado' : 'auth.reautenticacao_falhou',
			entity: 'session',
			entityId: locals.session.id,
			ip,
			userAgent
		});

		if (!confere) return fail(400, { erro: 'Senha incorreta.' });

		clearRateLimit(chave);
		await markReauthenticated(banco, locals.session.id);
		redirect(303, voltar);
	}
};
