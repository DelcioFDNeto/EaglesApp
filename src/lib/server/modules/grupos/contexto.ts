import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '$server/db';
import { groupMembership } from '$server/db/schema';

/**
 * O grupo é o contexto da pessoa (D-M04-4).
 *
 * Toda verificação de permissão SOBRE uma pessoa precisa saber em que grupo
 * ela está: sem isso, a atribuição de escopo de grupo nunca autoriza nada — e
 * a alternativa, `canAnywhere`, autoriza demais. O M02 escolheu a segunda por
 * falta de grupos, e o conselheiro via o contato de todo mundo.
 *
 * Este arquivo só lê o vínculo aberto. Não importa nada de `pessoas`, para
 * que o serviço de pessoas possa usá-lo sem dependência circular.
 */

/** Contexto de política de uma pessoa: ela mesma e o grupo em que está. */
export type ContextoDaPessoa = {
	personId: string;
	/** Nulo quando a pessoa não está em grupo nenhum. */
	groupId: string | null;
};

/** Grupo em que a pessoa está agora, ou nulo. */
export async function grupoAtualDe(db: Database, personId: string): Promise<string | null> {
	const [linha] = await db
		.select({ groupId: groupMembership.groupId })
		.from(groupMembership)
		.where(and(eq(groupMembership.personId, personId), isNull(groupMembership.leftAt)))
		.limit(1);
	return linha?.groupId ?? null;
}

export async function contextoDaPessoa(db: Database, personId: string): Promise<ContextoDaPessoa> {
	return { personId, groupId: await grupoAtualDe(db, personId) };
}

/** Grupo atual de várias pessoas de uma vez — para listas, sem N+1. */
export async function gruposAtuaisDe(
	db: Database,
	personIds: string[]
): Promise<Map<string, string>> {
	const mapa = new Map<string, string>();
	if (personIds.length === 0) return mapa;

	const linhas = await db
		.select({ personId: groupMembership.personId, groupId: groupMembership.groupId })
		.from(groupMembership)
		.where(and(inArray(groupMembership.personId, personIds), isNull(groupMembership.leftAt)));

	for (const l of linhas) mapa.set(l.personId, l.groupId);
	return mapa;
}
