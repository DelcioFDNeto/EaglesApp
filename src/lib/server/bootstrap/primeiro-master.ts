import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../db';
import { person, personRole, userAccount } from '../db/schema';
import { issueInvite, type InviteIssued } from '../auth/invite';
import { PAPEL_MASTER } from '../policy/roles';
import { garantirCatalogo } from './catalogo';

/**
 * Núcleo do primeiro acesso (CLI em `deploy/primeiro-master.ts`).
 *
 * Garante o catálogo e cria o acesso Master (o desenvolvedor): acima dos
 * líderes, invisível para a equipe. É o Master quem nomeia os 2 primeiros
 * líderes, pela tela de Liderança — os líderes nunca nascem por script.
 *
 * Se já existir um Master com senha definida, recusa — a não ser com `forcar`
 * (ex.: o dev perdeu o acesso ao e-mail).
 */

export type ResultadoPrimeiroMaster =
	{ ok: true; convite: InviteIssued; personId: string } | { ok: false; motivo: 'master_ja_existe' };

export async function convidarMaster(
	db: Database,
	dados: { nome: string; email: string; forcar?: boolean }
): Promise<ResultadoPrimeiroMaster> {
	const email = dados.email.trim().toLowerCase();
	const nome = dados.nome.trim();

	const { teamId, papeis } = await garantirCatalogo(db);
	const papelMaster = papeis[PAPEL_MASTER];
	if (!papelMaster) throw new Error('papel master não encontrado no catálogo');

	const [masterAtivo] = await db
		.select({ id: person.id })
		.from(personRole)
		.innerJoin(person, eq(person.id, personRole.personId))
		.innerJoin(userAccount, eq(userAccount.personId, person.id))
		.where(
			and(
				eq(personRole.roleId, papelMaster),
				eq(person.teamId, teamId),
				isNotNull(userAccount.passwordHash)
			)
		)
		.limit(1);

	if (masterAtivo && !dados.forcar) {
		return { ok: false, motivo: 'master_ja_existe' };
	}

	// Reaproveita a conta se o e-mail já existir: rodar duas vezes não cria
	// duas pessoas, só renova o convite.
	const [contaExistente] = await db
		.select({ personId: userAccount.personId })
		.from(userAccount)
		.where(sql`lower(${userAccount.email}) = ${email}`)
		.limit(1);

	let personId = contaExistente?.personId;

	if (!personId) {
		const [criada] = await db
			.insert(person)
			.values({ teamId, fullName: nome })
			.returning({ id: person.id });
		if (!criada) throw new Error('não foi possível criar a pessoa');
		personId = criada.id;

		// Conta sem senha: o convite define a senha; o e-mail é o login.
		await db.insert(userAccount).values({ personId, email });
	}

	await db
		.insert(personRole)
		.values({ personId, roleId: papelMaster, scopeType: 'global', scopeId: null })
		.onConflictDoNothing();

	const convite = await issueInvite(db, { teamId, personId, createdByPersonId: personId });
	return { ok: true, convite, personId };
}
