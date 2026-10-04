import { and, countDistinct, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '$server/db';
import { person, personRole, role, rolePermission, userAccount } from '$server/db/schema';
import { AcessoRecusado } from './regras';

/**
 * Trava 4 — sempre resta um administrador ativo.
 *
 * "Administrador ativo" é quem consegue, HOJE, entrar e administrar acesso:
 *   - tem `rbac.manage` num papel atribuído em escopo GLOBAL
 *   - a atribuição não venceu
 *   - a pessoa não foi removida
 *   - a conta existe, não está desativada, tem senha e tem identificador de
 *     entrada (e-mail ou telefone)
 *
 * O último item não é zelo: o M01 criava contas por convite sem identificador.
 * Um "administrador" assim existe no banco e não destranca nada — contá-lo
 * deixaria a trava aprovar exatamente o trancamento que ela existe para evitar.
 */
export async function contarAdministradoresAtivos(db: Database, teamId: string): Promise<number> {
	const [linha] = await db
		.select({ total: countDistinct(person.id) })
		.from(personRole)
		.innerJoin(role, eq(role.id, personRole.roleId))
		.innerJoin(
			rolePermission,
			and(eq(rolePermission.roleId, role.id), eq(rolePermission.permissionKey, 'rbac.manage'))
		)
		.innerJoin(person, eq(person.id, personRole.personId))
		.innerJoin(userAccount, eq(userAccount.personId, person.id))
		.where(
			and(
				eq(role.teamId, teamId),
				eq(personRole.scopeType, 'global'),
				or(isNull(personRole.expiresAt), gt(personRole.expiresAt, new Date())),
				isNull(person.deletedAt),
				isNull(userAccount.disabledAt),
				isNotNull(userAccount.passwordHash),
				or(isNotNull(userAccount.email), isNotNull(userAccount.phone))
			)
		);

	return Number(linha?.total ?? 0);
}

/**
 * Confere a trava sobre o estado RESULTANTE.
 *
 * Chamada DENTRO da transação, depois da alteração e antes do commit. Se não
 * sobrar ninguém, lança — e a transação inteira volta. Conferir antes, com
 * uma regra separada ("esta remoção tiraria o último?"), duplicaria a lógica,
 * e duas versões da mesma regra divergem em silêncio.
 */
export async function exigirAdministradorRestante(db: Database, teamId: string): Promise<void> {
	if ((await contarAdministradoresAtivos(db, teamId)) === 0) {
		throw new AcessoRecusado(
			'ultimo_administrador',
			'Esta alteração deixaria os Eagles sem ninguém capaz de administrar acessos. ' +
				'Dê esse acesso a outra pessoa primeiro.'
		);
	}
}

/**
 * Serializa, por equipe, as alterações que podem REDUZIR o número de
 * administradores.
 *
 * Sem isto há uma corrida real: os dois únicos administradores retiram o papel
 * um do outro no mesmo instante. Em READ COMMITTED, cada transação confere a
 * trava enxergando o outro ainda lá — as duas passam, as duas confirmam, e a
 * equipe fica com zero.
 *
 * O lock é transacional (`xact`): é liberado sozinho no commit ou no rollback,
 * então não há como esquecê-lo preso. Chame como PRIMEIRA instrução da
 * transação.
 */
export async function travarAdministracao(db: Database, teamId: string): Promise<void> {
	await db.execute(sql`select pg_advisory_xact_lock(hashtext(${'eagles:rbac:' + teamId}))`);
}
