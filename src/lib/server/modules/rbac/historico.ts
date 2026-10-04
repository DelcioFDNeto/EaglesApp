import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database } from '$server/db';
import { auditLog, person } from '$server/db/schema';
import { authorize, type Actor } from '$server/policy/policy';

/**
 * O que aconteceu com o acesso de uma pessoa — para quem tem `audit.view`.
 *
 * Responde a pergunta que aparece quando algo dá errado: "quem tirou o papel
 * dela, e quando?". Lê a auditoria, que o banco não deixa reescrever.
 */

const ACOES = [
	'rbac.papel_atribuido',
	'rbac.papel_removido',
	'invite.emitido',
	'invite.aceito',
	'auth.acesso_recuperado'
] as const;

export type EventoDeAcesso = {
	id: string;
	acao: (typeof ACOES)[number];
	quando: Date;
	quem: string | null;
	papel: string | null;
};

export async function historicoDeAcesso(
	db: Database,
	actor: Actor,
	personId: string
): Promise<EventoDeAcesso[]> {
	authorize(actor, 'audit.view');

	const linhas = await db
		.select({
			id: auditLog.id,
			acao: auditLog.action,
			quando: auditLog.at,
			quemId: auditLog.actorPersonId,
			papelDepois: sql<string | null>`${auditLog.after} ->> 'papel'`,
			papelAntes: sql<string | null>`${auditLog.before} ->> 'papel'`
		})
		.from(auditLog)
		.where(
			and(
				eq(auditLog.teamId, actor.teamId),
				inArray(auditLog.action, [...ACOES]),
				or(
					// atribuição e remoção guardam a pessoa DENTRO do registro
					sql`${auditLog.after} ->> 'personId' = ${personId}`,
					sql`${auditLog.before} ->> 'personId' = ${personId}`,
					// o convite emitido aponta para a pessoa
					and(eq(auditLog.action, 'invite.emitido'), eq(auditLog.entityId, personId)),
					// aceite e recuperação são feitos PELA própria pessoa
					and(
						inArray(auditLog.action, ['invite.aceito', 'auth.acesso_recuperado']),
						eq(auditLog.actorPersonId, personId)
					)
				)
			)
		)
		.orderBy(desc(auditLog.at))
		.limit(20);

	const ids = [...new Set(linhas.map((l) => l.quemId).filter((x): x is string => !!x))];
	const nomes = new Map(
		ids.length === 0
			? []
			: (
					await db
						.select({ id: person.id, nome: person.fullName })
						.from(person)
						.where(inArray(person.id, ids))
				).map((p) => [p.id, p.nome] as const)
	);

	return linhas.map((l) => ({
		id: l.id,
		acao: l.acao as EventoDeAcesso['acao'],
		quando: l.quando,
		quem: l.quemId ? (nomes.get(l.quemId) ?? null) : null,
		papel: l.papelDepois ?? l.papelAntes
	}));
}
