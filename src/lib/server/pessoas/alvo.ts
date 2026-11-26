import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db';
import { group, groupMember, person, personProfile, personRole, role } from '../db/schema';
import { ehLider, ehMaster, naoEhMaster } from '../lideranca/regras';
import type { Actor } from '../policy/policy';
import { PAPEL_LIDER, PAPEL_MASTER } from '../policy/roles';

/**
 * A pessoa sobre a qual alguém quer agir, com o que a autorização precisa
 * saber: o PG atual (escopo do conselheiro) e se ela está no topo do acesso.
 *
 * O Master não é encontrado (404): para a equipe, ele não existe.
 */
export type Alvo = {
	id: string;
	nome: string;
	birthDate: string | null;
	createdAt: Date;
	groupId: string | null;
	grupoNome: string | null;
	perfil: typeof personProfile.$inferSelect | null;
	/** Tem papel de líder (ou é o Master, o que aqui nunca acontece). */
	topo: boolean;
};

export async function carregarAlvo(
	banco: Database,
	teamId: string,
	personId: string
): Promise<Alvo | null> {
	const [p] = await banco
		.select({
			id: person.id,
			nome: person.fullName,
			birthDate: person.birthDate,
			createdAt: person.createdAt
		})
		.from(person)
		.where(
			and(
				eq(person.id, personId),
				eq(person.teamId, teamId),
				isNull(person.deletedAt),
				naoEhMaster(person.id)
			)
		)
		.limit(1);
	if (!p) return null;

	const [[vinculo], [perfil], topo] = await Promise.all([
		banco
			.select({ groupId: groupMember.groupId, nome: group.name })
			.from(groupMember)
			.innerJoin(group, eq(group.id, groupMember.groupId))
			.where(eq(groupMember.personId, p.id))
			.limit(1),
		banco.select().from(personProfile).where(eq(personProfile.personId, p.id)).limit(1),
		banco
			.select({ id: personRole.id })
			.from(personRole)
			.innerJoin(role, eq(role.id, personRole.roleId))
			.where(and(eq(personRole.personId, p.id), inArray(role.key, [PAPEL_LIDER, PAPEL_MASTER])))
			.limit(1)
	]);

	return {
		...p,
		groupId: vinculo?.groupId ?? null,
		grupoNome: vinculo?.nome ?? null,
		perfil: perfil ?? null,
		topo: topo.length > 0
	};
}

/**
 * Líder só é editado por líder (ou Master): quem está no topo do acesso não
 * fica à mercê do conselheiro do PG em que por acaso participa.
 */
export function alcancaAlvo(actor: Actor, alvo: Alvo): boolean {
	return !alvo.topo || ehLider(actor) || ehMaster(actor);
}
