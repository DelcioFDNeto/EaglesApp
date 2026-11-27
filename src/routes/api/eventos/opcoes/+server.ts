import { json } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$server/db';
import { eventType, group, groupMember, person } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { naoEhMaster } from '$server/lideranca/regras';

/**
 * O que o formulário de evento pode oferecer a quem o abre.
 *
 * A tela não decide nada: só mostra as escolhas que o servidor aceitaria.
 *   - `podeSemGrupo`: evento da equipe toda (sem PG) exige `event.manage` global.
 *   - `grupos`: global vê todos; conselheiro vê só os PGs em que tem `event.manage`.
 *   - `pessoas`: candidatos a responsável. Global vê a equipe; conselheiro vê
 *     quem está nos seus PGs (e a si mesmo). Só nome: nada de contato.
 *   - `tipos`: só os ativos. Tipo desativado não serve para evento novo.
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const global = can(actor, 'event.manage');
	const gruposDoEscopo = groupsWhere(actor, 'event.manage');

	if (!global && gruposDoEscopo.length === 0) {
		return json({ erro: 'Sem permissão para criar ou editar eventos.' }, { status: 403 });
	}

	const [tiposRaw, grupos] = await Promise.all([
		banco
			.select({
				id: eventType.id,
				name: eventType.name,
				slug: eventType.slug,
				color: eventType.color
			})
			.from(eventType)
			.where(and(eq(eventType.teamId, actor.teamId), eq(eventType.active, true)))
			.orderBy(asc(eventType.name)),
		banco
			.select({ id: group.id, name: group.name })
			.from(group)
			.where(
				and(
					eq(group.teamId, actor.teamId),
					isNull(group.archivedAt),
					global ? undefined : inArray(group.id, gruposDoEscopo)
				)
			)
			.orderBy(asc(group.name))
	]);
	const tipos = [...tiposRaw].sort((a, b) =>
		a.slug === 'pg' ? -1 : b.slug === 'pg' ? 1 : a.name.localeCompare(b.name, 'pt-BR')
	);

	const filtroEscopo = global
		? undefined
		: inArray(
				person.id,
				banco
					.select({ id: groupMember.personId })
					.from(groupMember)
					.where(inArray(groupMember.groupId, gruposDoEscopo))
			);

	const pessoas = await banco
		.select({ id: person.id, nome: person.fullName })
		.from(person)
		.where(
			and(
				eq(person.teamId, actor.teamId),
				isNull(person.deletedAt),
				naoEhMaster(person.id),
				filtroEscopo
			)
		)
		.orderBy(asc(person.fullName));

	if (!global && !pessoas.some((p) => p.id === actor.personId)) {
		const [eu] = await banco
			.select({ id: person.id, nome: person.fullName })
			.from(person)
			.where(eq(person.id, actor.personId))
			.limit(1);
		if (eu) pessoas.unshift(eu);
	}

	return json({ podeSemGrupo: global, tipos, grupos, pessoas });
};
