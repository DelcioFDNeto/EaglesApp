import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$server/db';
import { auditLog, personRole, role } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { PAPEIS_RESERVADOS, PAPEL_LIDER } from '$server/policy/roles';
import { ehMaster, naoEhMaster } from '$server/lideranca/regras';

/**
 * Revoga uma atribuição de papel, impedindo auto-revogação do próprio papel global de administração.
 */
export const DELETE = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'rbac.manage')) {
		return json({ erro: 'Sem permissão para revogar papéis.' }, { status: 403 });
	}

	const id = params.id;
	if (!isUuid(id)) {
		return json({ erro: 'Identificador inválido.' }, { status: 400 });
	}

	const [atribuicao] = await banco
		.select({
			id: personRole.id,
			personId: personRole.personId,
			roleId: personRole.roleId,
			roleKey: role.key,
			scopeType: personRole.scopeType,
			scopeId: personRole.scopeId
		})
		.from(personRole)
		.innerJoin(role, eq(role.id, personRole.roleId))
		.where(
			and(
				eq(personRole.id, id),
				eq(role.teamId, actor.teamId),
				ehMaster(actor) ? undefined : naoEhMaster(personRole.personId)
			)
		)
		.limit(1);

	if (!atribuicao) {
		return json({ erro: 'Atribuição não encontrada.' }, { status: 404 });
	}

	// Líder sai encerrando o mandato (com as regras de sucessão); o Master não
	// sai por aqui. Para quem não é Master, a atribuição dele nem existe.
	if (PAPEIS_RESERVADOS.includes(atribuicao.roleKey)) {
		if (atribuicao.roleKey !== PAPEL_LIDER) {
			return json({ erro: 'Atribuição não encontrada.' }, { status: 404 });
		}
		return json(
			{
				erro: 'Para tirar um líder, encerre o mandato na tela de Liderança.',
				codigo: 'papel_reservado'
			},
			{ status: 400 }
		);
	}

	if (atribuicao.personId === actor.personId && atribuicao.scopeType === 'global') {
		const outrosGlobais = actor.assignments.filter(
			(a) => a.scopeType === 'global' && a.permissions.has('rbac.manage')
		);
		if (outrosGlobais.length <= 1) {
			return json(
				{ erro: 'Você não pode revogar seu próprio acesso global de administração.' },
				{ status: 400 }
			);
		}
	}

	await banco.delete(personRole).where(eq(personRole.id, id));

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'rbac.assignment_revoked',
		entity: 'person_role',
		entityId: id,
		before: {
			personId: atribuicao.personId,
			roleKey: atribuicao.roleKey,
			scopeType: atribuicao.scopeType,
			scopeId: atribuicao.scopeId
		}
	});

	return json({ ok: true, mensagem: 'Atribuição revogada.' });
};
