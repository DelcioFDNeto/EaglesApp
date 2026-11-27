import { json } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$server/db';
import {
	group,
	groupMember,
	person,
	personAttribute,
	personProfile,
	personRole,
	role
} from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { ehLider, ehMaster, naoEhMaster } from '$server/lideranca/regras';
import { PAPEL_LIDER, PAPEL_MASTER } from '$server/policy/roles';
import { serializarAtributos } from '$server/draft/atributos';

/**
 * Perfis de atributos para visualização entre membros e montagem de Draft.
 *
 * PERMISSÃO: qualquer membro Eagles (`person.view` em qualquer escopo).
 * Visitantes não possuem `person.view` e recebem 403.
 *
 * PRIVACIDADE: expõe exclusivamente nome, estágio, subgrupo e perfil de
 * atributos/draft — nunca telefone, WhatsApp, e-mail, nascimento, família
 * nem observações pastorais (`person.view_sensitive`). Master é oculto.
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });

	const { actor } = auth;
	const podeVer =
		can(actor, 'person.view') ||
		can(actor, 'person.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'person.view').length > 0;
	if (!podeVer) {
		return json({ erro: 'Sem permissão para acessar o Draft.' }, { status: 403 });
	}

	const [linhas, subgrupos, lideresRows] = await Promise.all([
		banco
			.select({
				id: person.id,
				nome: person.fullName,
				status: personProfile.status,
				groupId: groupMember.groupId,
				grupoNome: group.name,
				atributo: personAttribute
			})
			.from(person)
			.leftJoin(personProfile, eq(personProfile.personId, person.id))
			.leftJoin(groupMember, eq(groupMember.personId, person.id))
			.leftJoin(group, eq(group.id, groupMember.groupId))
			.leftJoin(personAttribute, eq(personAttribute.personId, person.id))
			.where(and(eq(person.teamId, actor.teamId), isNull(person.deletedAt), naoEhMaster(person.id)))
			.orderBy(asc(person.fullName)),
		banco
			.select({ id: group.id, nome: group.name })
			.from(group)
			.where(and(eq(group.teamId, actor.teamId), isNull(group.archivedAt)))
			.orderBy(asc(group.name)),
		banco
			.select({ personId: personRole.personId })
			.from(personRole)
			.innerJoin(role, eq(role.id, personRole.roleId))
			.where(and(eq(role.teamId, actor.teamId), inArray(role.key, [PAPEL_LIDER, PAPEL_MASTER])))
	]);

	const lideres = new Set(lideresRows.map((l) => l.personId));

	const avaliadorIds = [
		...new Set(
			linhas.map((l) => l.atributo?.evaluatedByPersonId).filter((x): x is string => Boolean(x))
		)
	];
	const nomesAvaliadores = new Map(
		avaliadorIds.length === 0
			? []
			: (
					await banco
						.select({ id: person.id, nome: person.fullName })
						.from(person)
						.where(and(inArray(person.id, avaliadorIds), naoEhMaster(person.id)))
				).map((p) => [p.id, p.nome])
	);

	const atorEhTopo = ehLider(actor) || ehMaster(actor);

	return json({
		podeAvaliar: can(actor, 'person.update') || groupsWhere(actor, 'person.update').length > 0,
		podeSalvarDraft: can(actor, 'person.update'),
		podeAbrirFicha:
			can(actor, 'person.create') || can(actor, 'person.invite') || can(actor, 'person.update'),
		subgrupos,
		perfis: linhas.map((l) => {
			const alvoEhLider = lideres.has(l.id);
			const contexto = { groupId: l.groupId, personId: l.id };
			const podeEditar = can(actor, 'person.update', contexto) && (!alvoEhLider || atorEhTopo);
			return {
				id: l.id,
				nome: l.nome,
				estagio: l.status ?? 'visitante',
				grupo: l.groupId && l.grupoNome ? { id: l.groupId, nome: l.grupoNome } : null,
				ehLider: alvoEhLider,
				podeEditar,
				atributos: serializarAtributos(
					l.atributo,
					l.atributo?.evaluatedByPersonId
						? (nomesAvaliadores.get(l.atributo.evaluatedByPersonId) ?? null)
						: null
				)
			};
		})
	});
};
