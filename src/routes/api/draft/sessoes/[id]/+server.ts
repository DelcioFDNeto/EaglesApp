import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$server/db';
import { draftSession } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { audit } from '$server/audit/log';

/** Remove uma sessão de Draft salva da equipe (líderes, conselheiros e Master). */
export const DELETE = async ({ request, params, locals, getClientAddress }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	if (!can(actor, 'person.update')) {
		return json({ erro: 'Sem permissão para remover este draft.' }, { status: 403 });
	}
	if (!isUuid(params.id)) return json({ erro: 'Identificador inválido.' }, { status: 400 });

	const [removida] = await banco
		.delete(draftSession)
		.where(and(eq(draftSession.id, params.id), eq(draftSession.teamId, actor.teamId)))
		.returning({ id: draftSession.id, title: draftSession.title });

	if (!removida) return json({ erro: 'Draft não encontrado.' }, { status: 404 });

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'draft.removido',
		entity: 'draft_session',
		entityId: removida.id,
		before: { titulo: removida.title },
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent')
	});

	return json({ ok: true, mensagem: 'Draft removido.' });
};
