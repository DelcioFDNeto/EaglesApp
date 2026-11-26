import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db';
import { personProfile, personRole, personStatusHistory, role } from '../db/schema';
import { can, type Actor } from '../policy/policy';

/**
 * Jornada da pessoa na comunidade (seção 10 do briefing):
 * visitante → participante recorrente → membro Eagles.
 *
 * Conselheiro e líder NÃO são estágios: são papéis de acesso (RBAC e mandato).
 * O campo `person_profile.status` ainda aceita esses valores por legado
 * (anúncios por status), mas a jornada só move entre os três abaixo.
 *
 * Decisões do usuário (26/11/2026):
 *   - Acesso: só o estágio `membro` dá o papel base `membro`. Visitante e
 *     recorrente ficam com o papel base `visitante`.
 *   - Quem muda: conselheiro, no próprio PG, entre visitante e recorrente.
 *     Qualquer mudança que entre em `membro` ou saia dele é dos líderes,
 *     porque é a entrada formal nos Eagles.
 */

export const ESTAGIOS = ['visitante', 'recorrente', 'membro'] as const;
export type Estagio = (typeof ESTAGIOS)[number];

export const ROTULO_ESTAGIO: Record<string, string> = {
	visitante: 'Visitante',
	recorrente: 'Participante recorrente',
	membro: 'Membro Eagles',
	conselheiro: 'Conselheiro',
	lider: 'Líder'
};

/** O papel base (escopo `self`) que cada estágio dá. */
export function papelDoEstagio(estagio: Estagio): 'visitante' | 'membro' {
	return estagio === 'membro' ? 'membro' : 'visitante';
}

/**
 * Pode mover de `de` para `para`? `groupId` é o PG atual da pessoa.
 *
 * `de` pode ser um valor legado (`conselheiro`, `lider`): conta como membro,
 * então mexer nele exige o alcance de líder.
 */
export function podeMudarEstagio(
	actor: Actor,
	de: string,
	para: Estagio,
	groupId: string | null
): boolean {
	const envolveMembro =
		para === 'membro' || !(ESTAGIOS as readonly string[]).includes(de) || de === 'membro';
	if (envolveMembro) return can(actor, 'person.update');
	return can(actor, 'person.update', { groupId });
}

/**
 * Aplica a mudança de estágio, numa transação já aberta: perfil, histórico e
 * papel base. Os papéis de escopo `group` e `global` (conselheiro, líder,
 * personalizados) não são tocados.
 */
export async function aplicarEstagio(
	tx: Database,
	args: {
		teamId: string;
		personId: string;
		de: string | null;
		para: Estagio;
		motivo: string | null;
		porPersonId: string;
		groupId: string | null;
	}
): Promise<{ papelAntes: string[]; papelDepois: string }> {
	const agora = new Date();

	const [perfil] = await tx
		.select({ id: personProfile.id, joinedAt: personProfile.joinedAt })
		.from(personProfile)
		.where(eq(personProfile.personId, args.personId))
		.limit(1);

	// "Data de entrada" nos Eagles: a primeira vez que vira membro.
	const entrada = args.para === 'membro' && !perfil?.joinedAt ? { joinedAt: agora } : {};

	if (perfil) {
		await tx
			.update(personProfile)
			.set({ status: args.para, updatedAt: agora, ...entrada })
			.where(eq(personProfile.id, perfil.id));
	} else {
		await tx
			.insert(personProfile)
			.values({ personId: args.personId, status: args.para, ...entrada });
	}

	await tx.insert(personStatusHistory).values({
		personId: args.personId,
		fromStatus: args.de,
		toStatus: args.para,
		reason: args.motivo,
		changedByPersonId: args.porPersonId,
		groupId: args.groupId,
		occurredAt: agora
	});

	// Papel base: troca `visitante` ↔ `membro` no escopo self.
	const papeisBase = await tx
		.select({ id: role.id, key: role.key })
		.from(role)
		.where(and(eq(role.teamId, args.teamId), inArray(role.key, ['visitante', 'membro'])));
	const idDe = new Map(papeisBase.map((r) => [r.key, r.id]));
	const desejado = papelDoEstagio(args.para);
	const idDesejado = idDe.get(desejado);
	if (!idDesejado) throw new Error(`papel base "${desejado}" não existe na equipe`);

	const atuais = await tx
		.select({ id: personRole.id, roleId: personRole.roleId })
		.from(personRole)
		.where(
			and(
				eq(personRole.personId, args.personId),
				eq(personRole.scopeType, 'self'),
				inArray(
					personRole.roleId,
					papeisBase.map((r) => r.id)
				)
			)
		);

	const papelAntes = atuais.map((a) => papeisBase.find((r) => r.id === a.roleId)?.key ?? a.roleId);
	const sobrando = atuais.filter((a) => a.roleId !== idDesejado).map((a) => a.id);
	if (sobrando.length > 0) {
		await tx.delete(personRole).where(inArray(personRole.id, sobrando));
	}
	if (!atuais.some((a) => a.roleId === idDesejado)) {
		await tx.insert(personRole).values({
			personId: args.personId,
			roleId: idDesejado,
			scopeType: 'self',
			scopeId: null,
			grantedByPersonId: args.porPersonId
		});
	}

	return { papelAntes, papelDepois: desejado };
}
