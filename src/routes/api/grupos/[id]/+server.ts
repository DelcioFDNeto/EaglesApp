import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '$server/db';
import { group, groupMember, person, personProfile } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

/**
 * Retorna o detalhe de um grupo/PG com seus membros (isolado por teamId).
 */
export const GET = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const grupoId = params.id;
	if (!isUuid(grupoId)) {
		return json({ erro: 'Identificador de grupo inválido.' }, { status: 400 });
	}

	if (!can(actor, 'group.view', { groupId: grupoId, personId: actor.personId })) {
		return json({ erro: 'Sem permissão para ver este grupo.' }, { status: 403 });
	}

	const [grupo] = await banco
		.select()
		.from(group)
		.where(and(eq(group.id, grupoId), eq(group.teamId, actor.teamId)))
		.limit(1);

	if (!grupo) {
		return json({ erro: 'Grupo não encontrado.' }, { status: 404 });
	}

	const podeVerSensivel = can(actor, 'person.view_sensitive', { groupId: grupoId });

	const membros = await banco
		.select({
			id: person.id,
			nome: person.fullName,
			grupoFuncao: groupMember.roleKey,
			entrouEm: groupMember.joinedAt,
			telefone: personProfile.phone,
			whatsapp: personProfile.whatsapp,
			status: personProfile.status
		})
		.from(groupMember)
		.innerJoin(person, eq(person.id, groupMember.personId))
		.leftJoin(personProfile, eq(personProfile.personId, person.id))
		.where(eq(groupMember.groupId, grupoId))
		.orderBy(asc(person.fullName));

	return json({
		grupo: {
			id: grupo.id,
			name: grupo.name,
			slug: grupo.slug,
			description: grupo.description,
			createdAt: grupo.createdAt
		},
		membros: membros.map((m) => ({
			id: m.id,
			nome: m.nome,
			funcao: m.grupoFuncao,
			entrouEm: m.entrouEm,
			telefone: podeVerSensivel || m.id === actor.personId ? m.telefone : null,
			whatsapp: podeVerSensivel || m.id === actor.personId ? m.whatsapp : null,
			status: m.status
		}))
	});
};
