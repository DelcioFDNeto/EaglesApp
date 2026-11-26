import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db';
import { group, groupMember, groupMemberHistory, personProfile } from '../db/schema';
import { can, type Actor } from '../policy/policy';

/**
 * Mudança de PG: o único caminho que grava `group_member` (o PG atual) e
 * `group_member_history` (o caminho) juntos. Tela, cadastro e sugestão da IA
 * passam todos por aqui, para que nenhuma mudança fique sem história.
 *
 * Regras (decisão do usuário, 26/11/2026):
 *   - líder (`group.assign_member` global) move qualquer pessoa para qualquer
 *     PG, inclusive tirar de todos ou pôr quem não tem PG;
 *   - conselheiro move quem está no PG DELE para qualquer outro PG ativo.
 *     Não traz ninguém de outro PG, e não deixa ninguém sem PG.
 */

export type OrigemMudanca = 'cadastro' | 'manual' | 'ia';

export function podeTransferir(actor: Actor, de: string | null, para: string | null): boolean {
	if (can(actor, 'group.assign_member')) return true;
	return de !== null && para !== null && can(actor, 'group.assign_member', { groupId: de });
}

/** O PG existe na equipe e não está arquivado? */
export async function grupoAtivo(
	banco: Database,
	teamId: string,
	groupId: string
): Promise<{ id: string; name: string } | null> {
	const [g] = await banco
		.select({ id: group.id, name: group.name })
		.from(group)
		.where(and(eq(group.id, groupId), eq(group.teamId, teamId), isNull(group.archivedAt)))
		.limit(1);
	return g ?? null;
}

/**
 * Aplica a mudança numa transação já aberta. Não confere permissão: quem
 * chama já conferiu. `de` é o PG atual (lido por quem chama), `para` o novo.
 */
export async function moverPessoa(
	tx: Database,
	args: {
		teamId: string;
		personId: string;
		de: string | null;
		para: string | null;
		motivo: string | null;
		origem: OrigemMudanca;
		porPersonId: string | null;
	}
): Promise<void> {
	if (args.de === args.para) return;
	const agora = new Date();

	if (args.para === null) {
		await tx.delete(groupMember).where(eq(groupMember.personId, args.personId));
	} else if (args.de === null) {
		await tx
			.insert(groupMember)
			.values({ groupId: args.para, personId: args.personId, joinedAt: agora })
			.onConflictDoUpdate({
				target: groupMember.personId,
				set: { groupId: args.para, joinedAt: agora, updatedAt: agora }
			});
	} else {
		await tx
			.update(groupMember)
			.set({ groupId: args.para, joinedAt: agora, updatedAt: agora })
			.where(eq(groupMember.personId, args.personId));
	}

	// Cópia legada do PG no perfil: acompanha, para não contar outra história.
	await tx
		.update(personProfile)
		.set({ groupId: args.para, updatedAt: agora })
		.where(eq(personProfile.personId, args.personId));

	await tx.insert(groupMemberHistory).values({
		teamId: args.teamId,
		personId: args.personId,
		fromGroupId: args.de,
		toGroupId: args.para,
		reason: args.motivo,
		origin: args.origem,
		changedByPersonId: args.porPersonId,
		occurredAt: agora
	});
}
