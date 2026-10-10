import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import postgres from 'postgres';
import {
	event,
	eventSeries,
	eventType,
	eventTypeRsvpOption,
	rsvp,
	rsvpOption,
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
import { TIPOS_SEMENTE } from '../src/lib/server/modules/eventos/tipos-semente';
import { criarEvento } from '../src/lib/server/modules/eventos/eventos';
import { eventoSchema } from '../src/lib/server/modules/eventos/validacao';
import type { Alvo } from '../src/lib/server/modules/eventos/regras';
import { loadActor } from '../src/lib/server/policy/actor';
import { diaDaSemana, hojeNoFuso, somarDias } from '../src/lib/shared/fuso';
import type { Database } from '../src/lib/server/db';
import {
	RESPOSTAS_POR_TIPO,
	RESPOSTAS_SEMENTE
} from '../src/lib/server/modules/presenca/respostas-semente';
import { registrarLista } from '../src/lib/server/modules/presenca/lista';

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
			// Desde quatro meses atrás: o histórico de presença da semente (M06)
			// precisa encontrar as pessoas no grupo nas semanas passadas.
			.values({
				groupId: p.pg,
				personId: pessoa.id,
				addedByPersonId: liderId,
				joinedAt: new Date(Date.now() - 120 * 86_400_000)
			});
		distribuidas++;
	}
	console.log(`${distribuidas} pessoas colocadas nos grupos.`);

	// --- Agenda (M05) --------------------------------------------------------
	// Tipos de evento como dados (RN-10); o resto entra pelo serviço, com a
	// líder como autora — é o caminho de verdade, com materialização,
	// público-alvo e auditoria.
	await db
		.insert(eventType)
		.values(TIPOS_SEMENTE.map((t) => ({ ...t, teamId: equipe!.id })))
		.onConflictDoNothing();
	const tipos = await db
		.select({ id: eventType.id, key: eventType.key })
		.from(eventType)
		.where(eq(eventType.teamId, equipe.id));
	const tipoPorChave = new Map(tipos.map((t) => [t.key, t.id]));
	console.log(`${tipos.length} tipos de evento.`);

	const lider = liderId ? await loadActor(db as unknown as Database, liderId) : null;
	if (lider) {
		const hoje = hojeNoFuso(equipe.timezone);
		/** Próxima data (a partir de amanhã) com o dia da semana pedido. */
		const proximo = (dia: number, depoisDe = 1) => {
			let d = somarDias(hoje, depoisDe);
			while (diaDaSemana(d) !== dia) d = somarDias(d, 1);
			return d;
		};
		const pessoaPorEmail = async (email: string) => {
			const [c] = await db
				.select({ id: userAccount.personId })
				.from(userAccount)
				.where(eq(userAccount.email, email))
				.limit(1);
			return c?.id ?? null;
		};

		const AGENDA: Array<{
			titulo: string;
			tipo: string;
			grupoId?: string;
			semanal?: boolean;
			data: string;
			horaInicio: string;
			horaFim?: string;
			local?: string;
			publicar: boolean;
			publico: Alvo[];
		}> = [
			{
				titulo: 'PG Azul',
				tipo: 'encontro_pg',
				grupoId: PG_AZUL,
				semanal: true,
				data: proximo(4),
				horaInicio: '20:00',
				horaFim: '22:30',
				local: 'Casa do Pedro — Rua das Acácias, 120',
				publicar: true,
				publico: [{ tipo: 'grupo', groupId: PG_AZUL }]
			},
			{
				titulo: 'PG Verde',
				tipo: 'encontro_pg',
				grupoId: PG_VERDE,
				semanal: true,
				data: proximo(2),
				horaInicio: '19:30',
				horaFim: '21:30',
				local: 'Salão da igreja, sala 3',
				publicar: true,
				publico: [{ tipo: 'grupo', groupId: PG_VERDE }]
			},
			{
				titulo: 'Encontro geral dos Eagles',
				tipo: 'encontro_geral',
				data: proximo(6, 7),
				horaInicio: '19:00',
				horaFim: '21:00',
				local: 'Salão principal',
				publicar: true,
				publico: [{ tipo: 'equipe' }]
			},
			{
				titulo: 'Reunião de liderança',
				tipo: 'reuniao_lideranca',
				data: proximo(1),
				horaInicio: '20:00',
				local: 'Online',
				publicar: true,
				publico: (
					await Promise.all(
						['ana@eagles.local', 'pedro@eagles.local', 'marina@eagles.local'].map(pessoaPorEmail)
					)
				)
					.filter((id): id is string => !!id)
					.map((personId) => ({ tipo: 'pessoa' as const, personId }))
			},
			{
				// Rascunho de propósito: mostra que o rascunho só aparece para
				// quem pode gerenciá-lo (D-M05-6).
				titulo: 'Outside — inscrições',
				tipo: 'evento_especial',
				data: proximo(6, 35),
				horaInicio: '09:00',
				local: 'A definir',
				publicar: false,
				publico: [{ tipo: 'equipe' }]
			}
		];

		let novos = 0;
		for (const item of AGENDA) {
			const [jaTemEvento] = await db
				.select({ id: event.id })
				.from(event)
				.where(and(eq(event.teamId, equipe.id), eq(event.title, item.titulo)))
				.limit(1);
			const [jaTemSerie] = await db
				.select({ id: eventSeries.id })
				.from(eventSeries)
				.where(and(eq(eventSeries.teamId, equipe.id), eq(eventSeries.title, item.titulo)))
				.limit(1);
			if (jaTemEvento || jaTemSerie) continue;

			await criarEvento(
				db as unknown as Database,
				lider,
				eventoSchema.parse({
					tipoId: tipoPorChave.get(item.tipo),
					titulo: item.titulo,
					local: item.local,
					grupoId: item.grupoId,
					data: item.data,
					horaInicio: item.horaInicio,
					horaFim: item.horaFim,
					recorrencia: item.semanal ? 'semanal' : 'unica',
					publicar: item.publicar
				}),
				item.publico
			);
			novos++;
		}
		console.log(`${novos} eventos e encontros semanais criados.`);

		// --- Respostas de presença (M06) ---------------------------------------
		const respostas: Record<string, string> = {};
		for (const r of RESPOSTAS_SEMENTE) {
			const [existente] = await db
				.select({ id: rsvpOption.id })
				.from(rsvpOption)
				.where(and(eq(rsvpOption.teamId, equipe.id), eq(rsvpOption.label, r.label)))
				.limit(1);
			const id =
				existente?.id ??
				(
					await db
						.insert(rsvpOption)
						.values({
							teamId: equipe.id,
							label: r.label,
							semantic: r.semantic,
							allowsGuests: r.allowsGuests,
							position: r.position
						})
						.returning({ id: rsvpOption.id })
				)[0]!.id;
			respostas[r.key] = id;
		}
		for (const [tipo, chaves] of Object.entries(RESPOSTAS_POR_TIPO)) {
			const tipoId = tipoPorChave.get(tipo);
			if (!tipoId) continue;
			await db
				.insert(eventTypeRsvpOption)
				.values(chaves.map((k) => ({ typeId: tipoId, optionId: respostas[k]! })))
				.onConflictDoNothing();
		}
		console.log(`${RESPOSTAS_SEMENTE.length} respostas de presença.`);

		// --- Histórico de presença: 6 semanas de PG ----------------------------
		// Para a frequência e os sinais (D-M06-7) terem o que mostrar. Rafael
		// vinha e parou; Isabela, visitante, já veio três vezes.
		const [jaTemLista] = await db
			.select({ id: event.id })
			.from(event)
			.where(and(eq(event.teamId, equipe.id), isNotNull(event.attendanceTakenAt)))
			.limit(1);

		if (!jaTemLista) {
			// O cadastro precisa ser anterior aos encontros: quem não estava no
			// sistema não podia ser esperado (D-M06-5).
			await db
				.update(person)
				.set({ createdAt: new Date(Date.now() - 120 * 86_400_000) })
				.where(eq(person.teamId, equipe.id));

			const idPorNome = new Map(
				(
					await db
						.select({ id: person.id, nome: person.fullName })
						.from(person)
						.where(eq(person.teamId, equipe.id))
				).map((p) => [p.nome, p.id])
			);
			const quem = (nomes: string[]) =>
				nomes.map((n) => idPorNome.get(n)).filter((id): id is string => !!id);

			const HISTORICO: Array<{
				grupoId: string;
				titulo: string;
				dia: number;
				hora: string;
				semanas: Record<string, number[]>;
			}> = [
				{
					grupoId: PG_AZUL,
					titulo: 'PG Azul',
					dia: 4,
					hora: '20:00',
					// semana (1 = a mais recente) → presentes
					semanas: {
						'Pedro Henrique Vasconcelos': [1, 2, 3, 4, 5, 6],
						'João Vitor Cavalcanti': [1, 2, 4, 5, 6],
						'Camila Rodrigues Nascimento': [1, 2, 3, 4, 5, 6],
						'Rafael Monteiro': [4, 5, 6],
						'Isabela Martins Carvalho': [1, 3, 5]
					}
				},
				{
					grupoId: PG_VERDE,
					titulo: 'PG Verde',
					dia: 2,
					hora: '19:30',
					semanas: {
						'Marina Souza Albuquerque': [1, 2, 3, 4, 5, 6],
						'Letícia Ferreira dos Santos': [1, 2, 3, 5, 6],
						'Gustavo Lima': [1, 3, 4, 6],
						'Thiago Barbosa': [2]
					}
				}
			];

			let listas = 0;
			for (const h of HISTORICO) {
				// A data da semana n: n semanas antes do próximo encontro.
				const proximoEncontro = proximo(h.dia, 0);
				for (let semana = 1; semana <= 6; semana++) {
					const data = somarDias(proximoEncontro, -7 * semana);
					const { id } = await criarEvento(
						db as unknown as Database,
						lider,
						eventoSchema.parse({
							tipoId: tipoPorChave.get('encontro_pg'),
							titulo: h.titulo,
							grupoId: h.grupoId,
							data,
							horaInicio: h.hora,
							publicar: true
						}),
						[{ tipo: 'grupo', groupId: h.grupoId }]
					);
					const presentes = Object.entries(h.semanas)
						.filter(([, semanas]) => semanas.includes(semana))
						.map(([nome]) => nome);
					await registrarLista(db as unknown as Database, lider, id, quem(presentes));
					listas++;
				}
			}
			console.log(`${listas} listas de presença do histórico.`);

			// Respostas ao próximo PG Azul — para a lista do conselheiro mostrar
			// quem disse que vem.
			const [proximoPg] = await db
				.select({ id: event.id })
				.from(event)
				.where(
					and(eq(event.groupId, PG_AZUL), isNotNull(event.seriesId), sql`${event.startsAt} > now()`)
				)
				.orderBy(event.startsAt)
				.limit(1);
			if (proximoPg) {
				const respostasDoPg: Array<[string, string]> = [
					['João Vitor Cavalcanti', 'vou'],
					['Camila Rodrigues Nascimento', 'atrasado'],
					['Rafael Monteiro', 'nao_vou']
				];
				for (const [nome, chave] of respostasDoPg) {
					const personId = idPorNome.get(nome);
					if (!personId) continue;
					await db
						.insert(rsvp)
						.values({
							eventId: proximoPg.id,
							personId,
							optionId: respostas[chave]!,
							respondedByPersonId: personId
						})
						.onConflictDoNothing();
				}
			}
		}
	}

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
