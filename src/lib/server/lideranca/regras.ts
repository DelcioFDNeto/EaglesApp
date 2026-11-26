import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Actor } from '../policy/policy';
import { PAPEL_LIDER, PAPEL_MASTER } from '../policy/roles';

/**
 * Quem é quem no topo do acesso.
 *
 *   Master  — o desenvolvedor: acima de todos, invisível para a equipe.
 *   Líder   — o maior nível da equipe; no máximo 2, por mandato de 2 anos.
 */

export function ehMaster(actor: Actor | null): boolean {
	return Boolean(
		actor?.assignments.some((a) => a.roleKey === PAPEL_MASTER && a.scopeType === 'global')
	);
}

export function ehLider(actor: Actor | null): boolean {
	return Boolean(
		actor?.assignments.some((a) => a.roleKey === PAPEL_LIDER && a.scopeType === 'global')
	);
}

/**
 * Condição SQL "esta pessoa não é o Master", para as consultas que listam
 * pessoas da equipe. O Master não aparece em listas, escalas, análises nem
 * relatórios — só na auditoria, que registra o que ele fez.
 */
export function naoEhMaster(colunaPersonId: AnyPgColumn): SQL {
	return sql`not exists (
		select 1 from "person_role" pr_m
		join "role" r_m on r_m."id" = pr_m."role_id"
		where pr_m."person_id" = ${colunaPersonId} and r_m."key" = ${PAPEL_MASTER}
	)`;
}
