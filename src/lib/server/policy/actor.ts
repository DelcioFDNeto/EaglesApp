import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Database } from '../db';
import { person, personRole, role, rolePermission } from '../db/schema';
import { isPermission, type Permission, type ScopeType } from './permissions';
import type { Actor, RoleAssignment } from './policy';

/**
 * Monta o Actor a partir do banco: papéis da pessoa, cada um com seu escopo e
 * o conjunto de permissões daquele papel.
 *
 * Chamado uma vez por requisição em `hooks.server.ts`. É uma consulta só, com
 * junção — não N+1.
 *
 * Papel com `expires_at` no passado é ignorado: atribuição temporária que
 * venceu não autoriza nada.
 */
export async function loadActor(db: Database, personId: string): Promise<Actor | null> {
	const pessoas = await db
		.select({ id: person.id, teamId: person.teamId })
		.from(person)
		.where(and(eq(person.id, personId), isNull(person.deletedAt)))
		.limit(1);

	const pessoa = pessoas[0];
	if (!pessoa) return null;

	const linhas = await db
		.select({
			roleKey: role.key,
			scopeType: personRole.scopeType,
			scopeId: personRole.scopeId,
			permissionKey: rolePermission.permissionKey
		})
		.from(personRole)
		.innerJoin(role, eq(personRole.roleId, role.id))
		.leftJoin(rolePermission, eq(rolePermission.roleId, role.id))
		.where(
			and(
				eq(personRole.personId, personId),
				or(isNull(personRole.expiresAt), gt(personRole.expiresAt, new Date()))
			)
		);

	// Agrupa por (papel, escopo) — uma pessoa pode ter o mesmo papel em grupos
	// diferentes, e cada combinação é uma atribuição distinta.
	const porAtribuicao = new Map<string, RoleAssignment>();

	for (const linha of linhas) {
		const chave = `${linha.roleKey}|${linha.scopeType}|${linha.scopeId ?? ''}`;

		let atribuicao = porAtribuicao.get(chave);
		if (!atribuicao) {
			atribuicao = {
				roleKey: linha.roleKey,
				scopeType: linha.scopeType as ScopeType,
				scopeId: linha.scopeId,
				permissions: new Set<Permission>()
			};
			porAtribuicao.set(chave, atribuicao);
		}

		// Permissão que saiu do catálogo é ignorada em vez de derrubar a sessão:
		// o banco pode ter uma linha antiga de uma permissão já removida do código.
		if (linha.permissionKey && isPermission(linha.permissionKey)) {
			(atribuicao.permissions as Set<Permission>).add(linha.permissionKey);
		}
	}

	return {
		personId: pessoa.id,
		teamId: pessoa.teamId,
		assignments: [...porAtribuicao.values()]
	};
}
