import { fail, redirect } from '@sveltejs/kit';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '$server/db';
import { session } from '$server/db/schema';
import { authorize } from '$server/policy/policy';
import { revokeOtherSessions } from '$server/auth/session';
import { audit } from '$server/audit/log';
import type { Actions, PageServerLoad } from './$types';

/**
 * Dispositivos conectados.
 *
 * PERMISSÃO: `person.view` sobre a própria pessoa — é dado da própria conta.
 *
 * A tela existe no M01 porque é o outro lado da decisão de usar sessão em
 * banco (ADR 0004): revogação real só vale se a pessoa conseguir revogar.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.actor || !locals.session) redirect(303, '/entrar');

	authorize(locals.actor, 'person.view', { personId: locals.actor.personId });

	const ativas = await db()
		.select({
			id: session.id,
			criadaEm: session.createdAt,
			expiraEm: session.expiresAt,
			userAgent: session.userAgent,
			ip: session.ip
		})
		.from(session)
		.where(
			and(
				eq(session.accountId, locals.session.accountId),
				isNull(session.revokedAt),
				gt(session.expiresAt, new Date())
			)
		)
		.orderBy(desc(session.createdAt));

	return {
		sessaoAtualId: locals.session.id,
		sessoes: ativas.map((s) => ({
			id: s.id,
			atual: s.id === locals.session!.id,
			criadaEm: s.criadaEm.toISOString(),
			expiraEm: s.expiraEm.toISOString(),
			// Só o resumo do aparelho. O user-agent cru não diz nada a ninguém.
			aparelho: descreverAparelho(s.userAgent)
		}))
	};
};

function descreverAparelho(ua: string | null): string {
	if (!ua) return 'Dispositivo desconhecido';
	if (/iphone/i.test(ua)) return 'iPhone';
	if (/ipad/i.test(ua)) return 'iPad';
	if (/android/i.test(ua)) return 'Android';
	if (/windows/i.test(ua)) return 'Computador Windows';
	if (/macintosh|mac os/i.test(ua)) return 'Mac';
	if (/linux/i.test(ua)) return 'Computador Linux';
	return 'Outro dispositivo';
}

export const actions: Actions = {
	revogarOutras: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor || !locals.session) redirect(303, '/entrar');

		authorize(locals.actor, 'person.view', { personId: locals.actor.personId });

		const banco = db();
		const quantas = await revokeOtherSessions(banco, locals.session.accountId, locals.session.id);

		if (quantas === 0) {
			return fail(400, { erro: 'Não há outros dispositivos conectados.' });
		}

		await audit(banco, {
			teamId: locals.actor.teamId,
			actorPersonId: locals.actor.personId,
			action: 'auth.sessoes_revogadas',
			entity: 'session',
			after: { quantidade: quantas },
			ip: getClientAddress(),
			userAgent: request.headers.get('user-agent')
		});

		return {
			sucesso: `${quantas} ${quantas === 1 ? 'dispositivo foi desconectado' : 'dispositivos foram desconectados'}.`
		};
	}
};
