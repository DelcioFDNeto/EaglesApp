import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	ne,
	or,
	sql
} from 'drizzle-orm';
import type { Database } from '$server/db';
import {
	groupMembership,
	membershipStatus,
	person,
	personRelation,
	personRole,
	role,
	smallGroup,
	userAccount
} from '$server/db/schema';
import { audit } from '$server/audit/log';
import { authorize, authorizeAnywhere, can, type Actor } from '$server/policy/policy';
import { consentimentosDeVarias } from '$server/modules/pessoas/consentimento';
import { sinaisDeIdade } from '$server/modules/pessoas/pessoas';
import { regimeDe } from '$server/modules/pessoas/regime';
import { GrupoRecusado } from './regras';
import type { DadosDoGrupo } from './validacao';

/**
 * Grupos / PGs (RF-04.1, RF-04.3).
 *
 * Ler é aberto a quem tem `group.view` em qualquer escopo: quais PGs existem
 * e quem está em cada um é informação da equipe, como a lista de pessoas do
 * M02. O que é sensível — contato e pendências de cada pessoa — é decidido
 * LINHA A LINHA, com o grupo como contexto (D-M04-4).
 *
 * Escrever segue a tabela de D-M04-3: criar e arquivar exigem escopo global;
 * editar o combinado vale no escopo do próprio grupo.
 */

export type Responsavel = {
	atribuicaoId: string;
	personId: string;
	nome: string;
	papel: string;
};

export type GrupoResumo = {
	id: string;
	nome: string;
	cor: string | null;
	diaDaSemana: number | null;
	horario: string | null;
	local: string | null;
	arquivadoEm: Date | null;
	membros: number;
	responsaveis: Responsavel[];
};

/** O que só aparece para quem pode ver os dados sensíveis daquela pessoa. */
export type Pendencia = 'regime_restrito' | 'sem_acesso';

export type MembroDoGrupo = {
	personId: string;
	nome: string;
	desde: Date;
	estagioNome: string | null;
	estagioCor: string | null;
	ehMenor: boolean | null;
	/** Nulo para quem não tem `person.view_sensitive` no grupo. */
	telefone: string | null;
	/** Vazio para quem não tem `person.view_sensitive` no grupo. */
	pendencias: Pendencia[];
};

export type ExMembro = {
	personId: string;
	nome: string;
	saiuEm: Date;
	motivo: string | null;
};

export type GrupoDetalhe = GrupoResumo & {
	descricao: string | null;
	pessoas: MembroDoGrupo[];
	/** Quem saiu nos últimos 90 dias — para o conselheiro não perder ninguém de vista. */
	sairamRecentemente: ExMembro[];
};

const vigente = () => or(isNull(personRole.expiresAt), gt(personRole.expiresAt, new Date()));

/** Responsáveis por grupo: papéis em vigor com escopo apontando para ele. */
async function responsaveisDe(
	db: Database,
	groupIds: string[]
): Promise<Map<string, Responsavel[]>> {
	const mapa = new Map<string, Responsavel[]>();
	if (groupIds.length === 0) return mapa;

	const linhas = await db
		.select({
			atribuicaoId: personRole.id,
			groupId: personRole.scopeId,
			personId: person.id,
			nome: person.fullName,
			papel: role.name
		})
		.from(personRole)
		.innerJoin(role, eq(role.id, personRole.roleId))
		.innerJoin(person, eq(person.id, personRole.personId))
		.where(
			and(
				eq(personRole.scopeType, 'group'),
				inArray(personRole.scopeId, groupIds),
				isNull(person.deletedAt),
				vigente()
			)
		)
		.orderBy(asc(person.fullNameNormalized));

	for (const l of linhas) {
		if (!l.groupId) continue;
		const lista = mapa.get(l.groupId) ?? [];
		lista.push({
			atribuicaoId: l.atribuicaoId,
			personId: l.personId,
			nome: l.nome,
			papel: l.papel
		});
		mapa.set(l.groupId, lista);
	}
	return mapa;
}

/** Quantas pessoas (não removidas) estão hoje em cada grupo. */
async function contagemDeMembros(db: Database, groupIds: string[]): Promise<Map<string, number>> {
	const mapa = new Map<string, number>();
	if (groupIds.length === 0) return mapa;

	const linhas = await db
		.select({ groupId: groupMembership.groupId, total: count() })
		.from(groupMembership)
		.innerJoin(person, eq(person.id, groupMembership.personId))
		.where(
			and(
				inArray(groupMembership.groupId, groupIds),
				isNull(groupMembership.leftAt),
				isNull(person.deletedAt)
			)
		)
		.groupBy(groupMembership.groupId);

	for (const l of linhas) mapa.set(l.groupId, Number(l.total));
	return mapa;
}

function resumir(
	g: typeof smallGroup.$inferSelect,
	membros: Map<string, number>,
	responsaveis: Map<string, Responsavel[]>
): GrupoResumo {
	return {
		id: g.id,
		nome: g.name,
		cor: g.color,
		diaDaSemana: g.meetingWeekday,
		horario: g.meetingTime,
		local: g.location,
		arquivadoEm: g.archivedAt,
		membros: membros.get(g.id) ?? 0,
		responsaveis: responsaveis.get(g.id) ?? []
	};
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function listarGrupos(
	db: Database,
	actor: Actor,
	opcoes: { arquivados?: boolean } = {}
): Promise<GrupoResumo[]> {
	authorizeAnywhere(actor, 'group.view');

	const grupos = await db
		.select()
		.from(smallGroup)
		.where(
			and(
				eq(smallGroup.teamId, actor.teamId),
				opcoes.arquivados ? isNotNull(smallGroup.archivedAt) : isNull(smallGroup.archivedAt)
			)
		)
		.orderBy(asc(sql`lower(${smallGroup.name})`));

	const ids = grupos.map((g) => g.id);
	const [membros, responsaveis] = await Promise.all([
		contagemDeMembros(db, ids),
		responsaveisDe(db, ids)
	]);

	return grupos.map((g) => resumir(g, membros, responsaveis));
}

/**
 * Opções de grupo ativo para um seletor — nome e id, nada mais.
 *
 * Quem chama decide quais o ator pode escolher (por exemplo, só aqueles onde
 * pode colocar pessoas); aqui só se lista o que existe.
 */
export async function gruposAtivos(
	db: Database,
	teamId: string
): Promise<{ id: string; nome: string; cor: string | null }[]> {
	return db
		.select({ id: smallGroup.id, nome: smallGroup.name, cor: smallGroup.color })
		.from(smallGroup)
		.where(and(eq(smallGroup.teamId, teamId), isNull(smallGroup.archivedAt)))
		.orderBy(asc(sql`lower(${smallGroup.name})`));
}

export async function verGrupo(
	db: Database,
	actor: Actor,
	groupId: string
): Promise<GrupoDetalhe | null> {
	authorizeAnywhere(actor, 'group.view');

	const [grupo] = await db
		.select()
		.from(smallGroup)
		.where(and(eq(smallGroup.id, groupId), eq(smallGroup.teamId, actor.teamId)))
		.limit(1);
	if (!grupo) return null;

	const linhas = await db
		.select({
			personId: person.id,
			nome: person.fullName,
			telefone: person.phone,
			desde: groupMembership.joinedAt,
			estagioNome: membershipStatus.name,
			estagioCor: membershipStatus.color
		})
		.from(groupMembership)
		.innerJoin(person, eq(person.id, groupMembership.personId))
		.leftJoin(membershipStatus, eq(membershipStatus.id, person.currentStatusId))
		.where(
			and(
				eq(groupMembership.groupId, groupId),
				isNull(groupMembership.leftAt),
				isNull(person.deletedAt)
			)
		)
		.orderBy(asc(person.fullNameNormalized));

	// Contato e pendências: o contexto é o grupo, e todas as pessoas desta
	// lista estão nele. A decisão continua linha a linha — `can` com o
	// personId inclui o escopo `self` de quem está olhando a si mesmo.
	const visiveis = linhas
		.filter(
			(l) =>
				can(actor, 'person.view_sensitive', { personId: l.personId, groupId }) ||
				l.personId === actor.personId
		)
		.map((l) => l.personId);
	const podeVer = new Set(visiveis);

	const ids = linhas.map((l) => l.personId);
	const [idades, pendencias, responsaveis, sairam] = await Promise.all([
		sinaisDeIdade(db, ids),
		pendenciasDe(db, visiveis),
		responsaveisDe(db, [groupId]),
		db
			.select({
				personId: person.id,
				nome: person.fullName,
				saiuEm: groupMembership.leftAt,
				motivo: groupMembership.leftReason
			})
			.from(groupMembership)
			.innerJoin(person, eq(person.id, groupMembership.personId))
			.where(
				and(
					eq(groupMembership.groupId, groupId),
					isNotNull(groupMembership.leftAt),
					gt(groupMembership.leftAt, sql`now() - interval '90 days'`),
					isNull(person.deletedAt)
				)
			)
			.orderBy(desc(groupMembership.leftAt))
			.limit(20)
	]);

	const pessoas: MembroDoGrupo[] = linhas.map((l) => {
		const idade = idades.get(l.personId) ?? { ehMenor: null, idadeAnos: null };
		return {
			personId: l.personId,
			nome: l.nome,
			desde: l.desde,
			estagioNome: l.estagioNome,
			estagioCor: l.estagioCor,
			ehMenor: idade.ehMenor,
			telefone: podeVer.has(l.personId) ? l.telefone : null,
			pendencias: pendencias.get(l.personId) ?? []
		};
	});

	return {
		...resumir(grupo, new Map([[groupId, pessoas.length]]), responsaveis),
		descricao: grupo.description,
		pessoas,
		// Quem saiu e voltou ao grupo não aparece como "saiu"; quem saiu mais de
		// uma vez aparece uma vez só, pela saída mais recente (a lista já vem
		// da mais recente para a mais antiga).
		sairamRecentemente: sairam
			.filter((s) => s.saiuEm !== null && !ids.includes(s.personId))
			.filter((s, i, todas) => todas.findIndex((o) => o.personId === s.personId) === i)
			.map((s) => ({
				personId: s.personId,
				nome: s.nome,
				saiuEm: s.saiuEm as Date,
				motivo: s.motivo
			}))
	};
}

/**
 * Pendências que já se podem calcular (D-M04-6).
 *
 * Só para as pessoas que o ator pode ver por inteiro: "esta pessoa está em
 * regime restrito" diz algo sobre a idade dela, e "não tem acesso ao app" é
 * informação de quem administra.
 */
async function pendenciasDe(db: Database, ids: string[]): Promise<Map<string, Pendencia[]>> {
	const mapa = new Map<string, Pendencia[]>();
	if (ids.length === 0) return mapa;

	const [idades, consentimentos, comResponsavel, comAcesso] = await Promise.all([
		sinaisDeIdade(db, ids),
		consentimentosDeVarias(db, ids),
		db
			.select({ id: personRelation.personB })
			.from(personRelation)
			.where(
				and(
					inArray(personRelation.personB, ids),
					eq(personRelation.relationType, 'responsavel_legal')
				)
			),
		db
			.select({ id: userAccount.personId })
			.from(userAccount)
			.where(
				and(
					inArray(userAccount.personId, ids),
					isNotNull(userAccount.passwordHash),
					isNull(userAccount.disabledAt)
				)
			)
	]);

	const responsavel = new Set(comResponsavel.map((r) => r.id));
	const acesso = new Set(comAcesso.map((r) => r.id));

	for (const id of ids) {
		const lista: Pendencia[] = [];
		const regime = regimeDe(
			{ ehMenor: idades.get(id)?.ehMenor ?? null },
			consentimentos.get(id) ?? {},
			{ temResponsavelVinculado: responsavel.has(id) }
		);
		if (regime.restrito) lista.push('regime_restrito');
		if (!acesso.has(id)) lista.push('sem_acesso');
		mapa.set(id, lista);
	}
	return mapa;
}

/**
 * Grupos em que o ator está — como membro ou como responsável.
 *
 * É o "meus grupos" do topo da lista e do início: o conselheiro abre o app e
 * o PG dele está à mão, sem procurar.
 */
export async function meusGrupos(db: Database, actor: Actor): Promise<string[]> {
	const [comoMembro, comoResponsavel] = await Promise.all([
		db
			.select({ id: groupMembership.groupId })
			.from(groupMembership)
			.where(and(eq(groupMembership.personId, actor.personId), isNull(groupMembership.leftAt))),
		db
			.select({ id: personRole.scopeId })
			.from(personRole)
			.where(
				and(eq(personRole.personId, actor.personId), eq(personRole.scopeType, 'group'), vigente())
			)
	]);

	return [
		...new Set([...comoMembro, ...comoResponsavel].map((l) => l.id).filter((x): x is string => !!x))
	];
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

type ContextoDeRequisicao = { ip?: string | null; userAgent?: string | null };

async function exigirNomeLivre(
	db: Database,
	teamId: string,
	nome: string,
	excetoId?: string
): Promise<void> {
	const [mesmoNome] = await db
		.select({ id: smallGroup.id })
		.from(smallGroup)
		.where(
			and(
				eq(smallGroup.teamId, teamId),
				isNull(smallGroup.archivedAt),
				eq(sql`lower(${smallGroup.name})`, nome.toLowerCase()),
				excetoId ? ne(smallGroup.id, excetoId) : undefined
			)
		)
		.limit(1);

	if (mesmoNome) {
		throw new GrupoRecusado('nome_em_uso', `Já existe um grupo ativo chamado "${nome}".`);
	}
}

async function grupoDaEquipe(db: Database, actor: Actor, groupId: string) {
	const [grupo] = await db
		.select()
		.from(smallGroup)
		.where(and(eq(smallGroup.id, groupId), eq(smallGroup.teamId, actor.teamId)))
		.limit(1);
	if (!grupo) throw new GrupoRecusado('nao_encontrado', 'Esse grupo não existe.');
	return grupo;
}

/** Cria um grupo. Escopo global: grupo novo ainda não é escopo de ninguém. */
export async function criarGrupo(
	db: Database,
	actor: Actor,
	dados: DadosDoGrupo,
	contexto: ContextoDeRequisicao = {}
): Promise<string> {
	authorize(actor, 'group.manage');
	await exigirNomeLivre(db, actor.teamId, dados.name);

	const [criado] = await db
		.insert(smallGroup)
		.values({ ...dados, teamId: actor.teamId })
		.returning({ id: smallGroup.id });
	if (!criado) throw new Error('não foi possível criar o grupo');

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'group.criado',
		entity: 'small_group',
		entityId: criado.id,
		after: dados,
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});

	return criado.id;
}

/** Edita o combinado do grupo. Vale no escopo do próprio grupo (D-M04-3). */
export async function atualizarGrupo(
	db: Database,
	actor: Actor,
	groupId: string,
	dados: DadosDoGrupo,
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	authorize(actor, 'group.manage', { groupId });

	const antes = await grupoDaEquipe(db, actor, groupId);
	if (antes.archivedAt) {
		throw new GrupoRecusado('arquivado', 'Grupo arquivado não se edita. Reative-o antes.');
	}
	await exigirNomeLivre(db, actor.teamId, dados.name, groupId);

	await db
		.update(smallGroup)
		.set({ ...dados, updatedAt: new Date() })
		.where(eq(smallGroup.id, groupId));

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'group.editado',
		entity: 'small_group',
		entityId: groupId,
		before: {
			name: antes.name,
			color: antes.color,
			description: antes.description,
			meetingWeekday: antes.meetingWeekday,
			meetingTime: antes.meetingTime,
			location: antes.location
		},
		after: dados,
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});
}

/**
 * Arquiva um grupo vazio — sem pessoas e sem responsáveis.
 *
 * O gatilho da migração 0006 recusa o mesmo no banco; a verificação aqui
 * existe para devolver a explicação certa em vez de um erro de banco.
 */
export async function arquivarGrupo(
	db: Database,
	actor: Actor,
	groupId: string,
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	authorize(actor, 'group.manage');

	const grupo = await grupoDaEquipe(db, actor, groupId);
	if (grupo.archivedAt) return;

	const [membros] = await db
		.select({ total: count() })
		.from(groupMembership)
		.where(and(eq(groupMembership.groupId, groupId), isNull(groupMembership.leftAt)));
	if (Number(membros?.total ?? 0) > 0) {
		throw new GrupoRecusado(
			'tem_membros',
			'O grupo ainda tem pessoas. Transfira cada uma para outro grupo antes de arquivar.'
		);
	}

	const [responsaveis] = await db
		.select({ total: count() })
		.from(personRole)
		.where(eq(personRole.scopeId, groupId));
	if (Number(responsaveis?.total ?? 0) > 0) {
		throw new GrupoRecusado(
			'tem_responsaveis',
			'O grupo ainda tem responsáveis. Retire o papel de cada um antes de arquivar.'
		);
	}

	await db
		.update(smallGroup)
		.set({ archivedAt: new Date(), updatedAt: new Date() })
		.where(eq(smallGroup.id, groupId));

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'group.arquivado',
		entity: 'small_group',
		entityId: groupId,
		before: { name: grupo.name },
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});
}

/** Reativa um grupo arquivado, se o nome continuar livre. */
export async function reativarGrupo(
	db: Database,
	actor: Actor,
	groupId: string,
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	authorize(actor, 'group.manage');

	const grupo = await grupoDaEquipe(db, actor, groupId);
	if (!grupo.archivedAt) return;
	await exigirNomeLivre(db, actor.teamId, grupo.name, groupId);

	await db
		.update(smallGroup)
		.set({ archivedAt: null, updatedAt: new Date() })
		.where(eq(smallGroup.id, groupId));

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'group.reativado',
		entity: 'small_group',
		entityId: groupId,
		after: { name: grupo.name },
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});
}
