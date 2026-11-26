import { json } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '$server/db';
import { groupMember, person, personProfile } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

/**
 * Lista pessoas ativas da equipe (usado por líderes e conselheiros em escalas e presença).
 */
export const GET = async ({ request, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const grupoId = url.searchParams.get('grupo');
	const podeVerGlobal = can(actor, 'person.view');
	const gruposPermitidos = groupsWhere(actor, 'person.view');

	if (!podeVerGlobal && gruposPermitidos.length === 0) {
		return json({ erro: 'Sem permissão para listar pessoas.' }, { status: 403 });
	}

	const linhas = await banco
		.select({
			id: person.id,
			nome: person.fullName,
			status: personProfile.status,
			groupId: groupMember.groupId
		})
		.from(person)
		.leftJoin(personProfile, eq(personProfile.personId, person.id))
		.leftJoin(groupMember, eq(groupMember.personId, person.id))
		.where(and(eq(person.teamId, actor.teamId), isNull(person.deletedAt)))
		.orderBy(asc(person.fullName));

	const filtradas = linhas.filter((p) => {
		if (grupoId && p.groupId !== grupoId) return false;
		if (podeVerGlobal) return true;
		return p.groupId !== null && gruposPermitidos.includes(p.groupId);
	});

	return json({
		pessoas: filtradas.map((p) => ({
			id: p.id,
			nome: p.nome,
			status: p.status ?? 'visitante',
			groupId: p.groupId
		}))
	});
};
