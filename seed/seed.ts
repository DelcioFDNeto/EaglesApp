import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, isNull } from 'drizzle-orm';
import postgres from 'postgres';
import {
	featureFlag,
	groupMembership,
	membershipStatus,
	personStatusHistory,
	permission,
	person,
	personRole,
	role,
	rolePermission,
	smallGroup,
	team,
	userAccount
} from '../src/lib/server/db/schema';
import { ALL_PERMISSIONS, PERMISSIONS } from '../src/lib/server/policy/permissions';
import { FUNCIONALIDADES, TODAS_AS_FUNCIONALIDADES } from '../src/lib/server/settings/flags';
import { ESTAGIOS_SEMENTE } from '../src/lib/server/modules/pessoas/estagios-semente';
import { ROLE_SEEDS } from '../src/lib/server/policy/roles';
import { hashPassword } from '../src/lib/server/auth/password';
import { issueInvite } from '../src/lib/server/auth/invite';

/**
 * Semeadura do ambiente de desenvolvimento.
 *
 * Nomes plausíveis de propósito, não "Teste 1" e "Usuário 2": bug de layout
 * aparece com nome comprido de verdade, e a primeira demonstração para a
 * liderança precisa parecer um sistema, não um formulário vazio.
 *
 * IDEMPOTENTE: pode rodar quantas vezes quiser. Nada é duplicado.
 *
 * NUNCA rode isto em produção — a senha é conhecida.
 */

const SENHA_DEV = 'eagles-desenvolvimento';

const PG_AZUL = '018f0000-0000-7000-8000-00000000a001';
const PG_VERDE = '018f0000-0000-7000-8000-00000000a002';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL não definida.');
	process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
	console.error('Recusando semear em produção. Isto cria contas com senha conhecida.');
	process.exit(1);
}

const cliente = postgres(url, { max: 1 });
const db = drizzle(cliente);

try {
	// --- Equipe -------------------------------------------------------------
	let [equipe] = await db.select().from(team).where(eq(team.slug, 'eagles')).limit(1);
	if (!equipe) {
		[equipe] = await db.insert(team).values({ slug: 'eagles', name: 'Eagles' }).returning();
		console.log('Equipe Eagles criada.');
	}
	if (!equipe) throw new Error('falha ao criar a equipe');

	// --- Catálogo de permissões ---------------------------------------------
	await db
		.insert(permission)
		.values(ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSIONS[key] })))
		.onConflictDoNothing();
	console.log(`${ALL_PERMISSIONS.length} permissões no catálogo.`);

	// --- Papéis --------------------------------------------------------------
	const papeis: Record<string, string> = {};

	for (const semente of ROLE_SEEDS) {
		let [existente] = await db.select().from(role).where(eq(role.key, semente.key)).limit(1);

		if (!existente) {
			[existente] = await db
				.insert(role)
				.values({
					teamId: equipe.id,
					key: semente.key,
					name: semente.name,
					description: semente.description,
					isSystem: semente.isSystem,
					defaultScope: semente.defaultScope
				})
				.returning();
		}
		if (!existente) throw new Error(`falha ao criar o papel ${semente.key}`);

		papeis[semente.key] = existente.id;

		await db
			.insert(rolePermission)
			.values(semente.permissions.map((p) => ({ roleId: existente!.id, permissionKey: p })))
			.onConflictDoNothing();
	}
	console.log(`${ROLE_SEEDS.length} papéis semeados.`);

	// --- Chaves de funcionalidade: TODAS desligadas (RN-29) -----------------
	await db
		.insert(featureFlag)
		.values(
			TODAS_AS_FUNCIONALIDADES.map((key) => ({
				teamId: equipe!.id,
				key,
				description: FUNCIONALIDADES[key],
				enabled: false
			}))
		)
		.onConflictDoNothing();
	console.log(`${TODAS_AS_FUNCIONALIDADES.length} funcionalidades cadastradas, todas desligadas.`);

	// --- Estágios da jornada (RN-02) ----------------------------------------
	await db
		.insert(membershipStatus)
		.values(ESTAGIOS_SEMENTE.map((e) => ({ ...e, teamId: equipe!.id })))
		.onConflictDoNothing();

	const estagios = await db
		.select({ id: membershipStatus.id, key: membershipStatus.key })
		.from(membershipStatus)
		.where(eq(membershipStatus.teamId, equipe!.id));
	const estagioPorChave = new Map(estagios.map((e) => [e.key, e.id]));
	console.log(`${estagios.length} estágios da jornada semeados.`);

	// --- Grupos (M04) ---------------------------------------------------------
	// Ids fixos: a semente é idempotente, e as atribuições de conselheiro
	// apontam para eles desde antes de a tabela existir (a migração 0005 os
	// criou como "a nomear" num banco já semeado — aqui ganham nome).
	const GRUPOS = [
		{
			id: PG_AZUL,
			name: 'PG Azul',
			color: '#2563EB',
			meetingWeekday: 4,
			meetingTime: '20:00',
			location: 'Casa do Pedro — Rua das Acácias, 120'
		},
		{
			id: PG_VERDE,
			name: 'PG Verde',
			color: '#16A34A',
			meetingWeekday: 2,
			meetingTime: '19:30',
			location: 'Salão da igreja, sala 3'
		}
	];

	for (const g of GRUPOS) {
		await db
			.insert(smallGroup)
			.values({ ...g, teamId: equipe.id })
			.onConflictDoUpdate({
				target: smallGroup.id,
				set: {
					name: g.name,
					color: g.color,
					meetingWeekday: g.meetingWeekday,
					meetingTime: g.meetingTime,
					location: g.location
				}
			});
	}
	console.log(`${GRUPOS.length} grupos semeados.`);

	// --- Pessoas -------------------------------------------------------------
	const PESSOAS: Array<{
		nome: string;
		papel: string;
		email?: string;
		/** Grupo do ESCOPO do papel (conselheiro). */
		grupo?: string;
		/** Grupo de que a pessoa FAZ PARTE. Independente do papel (seção 5.2). */
		pg?: string;
		estagio?: string;
		telefone?: string;
		nascimento?: string;
	}> = [
		{
			nome: 'Ana Beatriz Nogueira',
			papel: 'lider',
			email: 'ana@eagles.local',
			estagio: 'membro',
			telefone: '11987650001',
			nascimento: '1994-03-12'
		},
		{
			nome: 'Pedro Henrique Vasconcelos',
			papel: 'conselheiro',
			email: 'pedro@eagles.local',
			grupo: PG_AZUL,
			estagio: 'membro',
			telefone: '11987650002',
			nascimento: '1996-05-18',
			pg: PG_AZUL
		},
		{
			nome: 'Marina Souza Albuquerque',
			papel: 'conselheiro',
			email: 'marina@eagles.local',
			grupo: PG_VERDE,
			estagio: 'membro',
			telefone: '11987650003',
			nascimento: '1997-09-02',
			pg: PG_VERDE
		},
		{
			nome: 'João Vitor Cavalcanti',
			papel: 'membro',
			email: 'joao@eagles.local',
			estagio: 'membro',
			telefone: '11987650004',
			nascimento: '2001-07-30',
			pg: PG_AZUL
		},
		{
			nome: 'Letícia Ferreira dos Santos',
			papel: 'membro',
			email: 'leticia@eagles.local',
			estagio: 'membro',
			telefone: '11987650005',
			nascimento: '2000-11-05',
			pg: PG_VERDE
		},
		{
			nome: 'Rafael Monteiro',
			papel: 'membro',
			estagio: 'membro',
			nascimento: '1999-01-22',
			pg: PG_AZUL
		},
		{
			nome: 'Camila Rodrigues Nascimento',
			papel: 'membro',
			estagio: 'participante_recorrente',
			pg: PG_AZUL
		},
		{ nome: 'Gustavo Lima', papel: 'membro', estagio: 'participante_recorrente', pg: PG_VERDE },
		{ nome: 'Isabela Martins Carvalho', papel: 'visitante', estagio: 'visitante', pg: PG_AZUL },
		{ nome: 'Thiago Barbosa', papel: 'visitante', estagio: 'visitante', pg: PG_VERDE }
	];

	const senhaHash = await hashPassword(SENHA_DEV);
	let criadas = 0;
	let liderId: string | null = null;

	for (const p of PESSOAS) {
		const [jaExiste] = await db
			.select({ id: person.id })
			.from(person)
			.where(eq(person.fullName, p.nome))
			.limit(1);

		if (jaExiste) {
			if (p.papel === 'lider') liderId = jaExiste.id;
			continue;
		}

		const estagioId = estagioPorChave.get(p.estagio ?? 'visitante') ?? null;

		const [criada] = await db
			.insert(person)
			.values({
				teamId: equipe.id,
				fullName: p.nome,
				phone: p.telefone ?? null,
				whatsapp: p.telefone ?? null,
				birthDate: p.nascimento ?? null,
				currentStatusId: estagioId
			})
			.returning({ id: person.id });
		if (!criada) continue;

		// A primeira atribuição também é histórico (RN-04): sem ela a linha do
		// tempo começaria no ar.
		if (estagioId) {
			await db.insert(personStatusHistory).values({
				personId: criada.id,
				fromStatusId: null,
				toStatusId: estagioId,
				reason: 'Semeadura de desenvolvimento'
			});
		}

		if (p.papel === 'lider') liderId = criada.id;

		await db.insert(personRole).values({
			personId: criada.id,
			roleId: papeis[p.papel]!,
			scopeType: p.grupo ? 'group' : p.papel === 'lider' ? 'global' : 'self',
			scopeId: p.grupo ?? null
		});

		// Só quem tem e-mail ganha conta pronta; o resto entra por convite,
		// que é o caminho real (ADR 0004).
		if (p.email) {
			await db
				.insert(userAccount)
				.values({ personId: criada.id, email: p.email, passwordHash: senhaHash });
		}

		criadas++;
	}

	console.log(`${criadas} pessoas criadas (${PESSOAS.length} no total).`);

	// --- Composição dos grupos ----------------------------------------------
	// Separada da criação para valer também num banco semeado antes do M04:
	// quem ainda não está em grupo nenhum entra no seu.
	let distribuidas = 0;
	for (const p of PESSOAS) {
		if (!p.pg) continue;

		const [pessoa] = await db
			.select({ id: person.id })
			.from(person)
			.where(eq(person.fullName, p.nome))
			.limit(1);
		if (!pessoa) continue;

		const [aberto] = await db
			.select({ id: groupMembership.id })
			.from(groupMembership)
			.where(and(eq(groupMembership.personId, pessoa.id), isNull(groupMembership.leftAt)))
			.limit(1);
		if (aberto) continue;

		await db
			.insert(groupMembership)
			.values({ groupId: p.pg, personId: pessoa.id, addedByPersonId: liderId });
		distribuidas++;
	}
	console.log(`${distribuidas} pessoas colocadas nos grupos.`);

	// --- Um convite aberto, para testar o fluxo de entrada -------------------
	if (liderId) {
		const [semConta] = await db
			.select({ id: person.id, nome: person.fullName })
			.from(person)
			.where(eq(person.fullName, 'Rafael Monteiro'))
			.limit(1);

		if (semConta) {
			const convite = await issueInvite(db as never, {
				teamId: equipe.id,
				personId: semConta.id,
				createdByPersonId: liderId
			});
			console.log(`\nConvite de teste para ${semConta.nome}:\n  ${convite.url}`);
		}
	}

	console.log(`\nContas prontas — senha: ${SENHA_DEV}`);
	console.log('  ana@eagles.local      líder (acesso total)');
	console.log('  pedro@eagles.local    conselheiro do PG Azul');
	console.log('  marina@eagles.local   conselheira do PG Verde');
	console.log('  joao@eagles.local     membro do PG Azul');
	console.log('  leticia@eagles.local  membro do PG Verde');

	await cliente.end();
	process.exit(0);
} catch (erro) {
	console.error('Falha ao semear:', erro);
	await cliente.end();
	process.exit(1);
}
