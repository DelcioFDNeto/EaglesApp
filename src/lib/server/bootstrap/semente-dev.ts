import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db';
import {
	group,
	groupMember,
	mandatoLider,
	person,
	personProfile,
	personRole,
	userAccount
} from '../db/schema';
import { hashPassword } from '../auth/password';
import { issueInvite } from '../auth/invite';
import { garantirCatalogo } from './catalogo';

/**
 * Semeadura do ambiente de DESENVOLVIMENTO (`npm run db:seed`).
 *
 * Nomes plausíveis de propósito, não "Teste 1": bug de layout aparece com nome
 * comprido de verdade, e a primeira demonstração precisa parecer um sistema.
 *
 * IDEMPOTENTE: pode rodar quantas vezes quiser. Nada é duplicado.
 * NUNCA em produção — a senha é conhecida (o CLI recusa NODE_ENV=production).
 */

export const SENHA_DEV = 'eagles-desenvolvimento';

const GRUPOS = [
	{ slug: 'pg-a', nome: 'PG A — Quinta à noite', descricao: 'Encontro semanal na casa da Marina.' },
	{ slug: 'pg-b', nome: 'PG B — Sábado à tarde', descricao: 'Encontro quinzenal no salão.' }
] as const;

type Semente = {
	nome: string;
	papel: 'master' | 'lider' | 'conselheiro' | 'membro' | 'visitante';
	email?: string;
	telefone?: string;
	grupo?: (typeof GRUPOS)[number]['slug'];
};

const PESSOAS: Semente[] = [
	{ nome: 'Dev Master', papel: 'master', email: 'dev@eagles.local' },
	{ nome: 'Ana Beatriz Nogueira', papel: 'lider', email: 'ana@eagles.local' },
	{ nome: 'Bruno Henrique Lima', papel: 'lider', email: 'bruno@eagles.local' },
	{
		nome: 'Pedro Henrique Vasconcelos',
		papel: 'conselheiro',
		email: 'pedro@eagles.local',
		grupo: 'pg-a'
	},
	{
		nome: 'Marina Souza Albuquerque',
		papel: 'conselheiro',
		email: 'marina@eagles.local',
		grupo: 'pg-b'
	},
	{ nome: 'João Vitor Cavalcanti', papel: 'membro', email: 'joao@eagles.local', grupo: 'pg-a' },
	{
		nome: 'Letícia Ferreira dos Santos',
		papel: 'membro',
		email: 'leticia@eagles.local',
		grupo: 'pg-b'
	},
	// Sem conta: entram por convite, que é o caminho real (ADR 0004).
	{ nome: 'Rafael Monteiro', papel: 'membro', telefone: '91988880001', grupo: 'pg-a' },
	{ nome: 'Camila Rodrigues Nascimento', papel: 'membro', grupo: 'pg-a' },
	{ nome: 'Gustavo Lima', papel: 'membro', grupo: 'pg-b' },
	{ nome: 'Isabela Martins Carvalho', papel: 'visitante' },
	{ nome: 'Thiago Barbosa', papel: 'visitante' }
];

export const CONTAS_DEV = PESSOAS.filter((p) => p.email).map((p) => ({
	email: p.email!,
	papel: p.papel,
	grupo: p.grupo ?? null
}));

function somarDoisAnos(data: string) {
	const [a, m, d] = data.split('-').map(Number) as [number, number, number];
	const ultimo = new Date(Date.UTC(a + 2, m, 0)).getUTCDate();
	return `${a + 2}-${String(m).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

export async function semearDesenvolvimento(db: Database) {
	const { teamId, papeis } = await garantirCatalogo(db);

	// --- Grupos ----------------------------------------------------------------
	const idGrupo: Record<string, string> = {};
	for (const g of GRUPOS) {
		await db
			.insert(group)
			.values({ teamId, slug: g.slug, name: g.nome, description: g.descricao })
			.onConflictDoNothing();
		const [linha] = await db
			.select({ id: group.id })
			.from(group)
			.where(and(eq(group.teamId, teamId), eq(group.slug, g.slug)))
			.limit(1);
		idGrupo[g.slug] = linha!.id;
	}

	// --- Pessoas ---------------------------------------------------------------
	const senhaHash = await hashPassword(SENHA_DEV);
	const ids: Record<string, string> = {};
	let criadas = 0;

	for (const p of PESSOAS) {
		const [jaExiste] = await db
			.select({ id: person.id })
			.from(person)
			.where(and(eq(person.teamId, teamId), eq(person.fullName, p.nome)))
			.limit(1);
		if (jaExiste) {
			ids[p.nome] = jaExiste.id;
			continue;
		}

		const [criada] = await db
			.insert(person)
			.values({ teamId, fullName: p.nome })
			.returning({ id: person.id });
		const id = criada!.id;
		ids[p.nome] = id;
		criadas++;

		await db
			.insert(personProfile)
			.values({ personId: id, phone: p.telefone ?? null, whatsapp: p.telefone ?? null });

		await db.insert(personRole).values({
			personId: id,
			roleId: papeis[p.papel]!,
			scopeType:
				p.papel === 'master' || p.papel === 'lider'
					? 'global'
					: p.papel === 'conselheiro'
						? 'group'
						: 'self',
			scopeId: p.papel === 'conselheiro' ? idGrupo[p.grupo!]! : null
		});

		if (p.grupo) {
			await db.insert(groupMember).values({
				groupId: idGrupo[p.grupo]!,
				personId: id,
				roleKey: p.papel === 'conselheiro' ? 'conselheiro' : 'membro'
			});
		}

		if (p.email) {
			await db
				.insert(userAccount)
				.values({ personId: id, email: p.email, passwordHash: senhaHash });
		} else if (p.telefone) {
			// Conta sem senha, com o telefone de login: pronta para o convite.
			await db.insert(userAccount).values({ personId: id, phone: p.telefone });
		}
	}

	// --- Mandatos dos 2 líderes (regra da liderança) ---------------------------
	const hoje = new Date().toISOString().slice(0, 10);
	for (const p of PESSOAS.filter((x) => x.papel === 'lider')) {
		const personId = ids[p.nome]!;
		const [aberto] = await db
			.select({ id: mandatoLider.id })
			.from(mandatoLider)
			.where(and(eq(mandatoLider.personId, personId), isNull(mandatoLider.encerradoEm)))
			.limit(1);
		if (!aberto) {
			await db
				.insert(mandatoLider)
				.values({ teamId, personId, inicio: hoje, fim: somarDoisAnos(hoje) });
		}
	}

	// --- Um convite aberto, para testar o fluxo de entrada ---------------------
	const convite = await issueInvite(db, {
		teamId,
		personId: ids['Rafael Monteiro']!,
		createdByPersonId: ids['Ana Beatriz Nogueira']!
	});

	return { criadas, total: PESSOAS.length, grupos: GRUPOS.length, conviteUrl: convite.url };
}
