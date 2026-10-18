import { randomBytes } from 'node:crypto';
import {
	and,
	asc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { ehId } from '$shared/formulario';
import type { Database } from '$server/db';
import {
	attendance,
	event,
	eventAudience,
	eventSeries,
	eventType,
	person,
	rsvp,
	smallGroup,
	team
} from '$server/db/schema';
import { audit, type AuditAction } from '$server/audit/log';
import {
	authorize,
	authorizeAnywhere,
	can,
	canAnywhere,
	groupsWhere,
	type Actor
} from '$server/policy/policy';
import { grupoAtualDe } from '$server/modules/grupos/contexto';
import {
	FUSO_PADRAO,
	dataNoFuso,
	diaDaSemana,
	hojeNoFuso,
	horaNoFuso,
	instanteLocal,
	limitesDoMes,
	somarDias
} from '$shared/fuso';
import { datasEntre } from './recorrencia';
import { alvosForaDoEscopo, EventoRecusado, podeVerEvento, type Alvo } from './regras';
import {
	fimLocal,
	minutosEntre,
	type EventoEntrada,
	type OcorrenciaEntrada,
	type SerieEntrada
} from './validacao';

/**
 * Eventos (RF-05).
 *
 * Três ideias atravessam o arquivo:
 *   - o instante vai para o banco; a hora local fica na série (D-M05-3);
 *   - as ocorrências de uma série existem como linhas, 12 semanas à frente,
 *     criadas quando alguém olha a agenda (D-M05-2);
 *   - quem vê o quê é uma regra só (D-M05-7), escrita em `regras.ts` e
 *     repetida aqui em SQL para a listagem — com teste que confere as duas.
 */

/** Janela de materialização, em semanas (A-04). */
export const HORIZONTE_SEMANAS = 12;

/**
 * Série em andamento: ainda tem alguma data de `hoje` em diante. Uma série
 * encerrada antes de começar termina na véspera do início — e não está.
 */
function emAndamento(hoje: string): SQL {
	return sql`(${eventSeries.endsOn} is null or (${eventSeries.endsOn} >= ${hoje} and ${eventSeries.endsOn} >= ${eventSeries.startsOn}))`;
}

type ContextoDeRequisicao = { ip?: string | null; userAgent?: string | null };

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

export async function fusoDaEquipe(db: Database, teamId: string): Promise<string> {
	const [t] = await db
		.select({ fuso: team.timezone })
		.from(team)
		.where(eq(team.id, teamId))
		.limit(1);
	return t?.fuso ?? FUSO_PADRAO;
}

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Código do link público (D-M05-8): 10 caracteres de 62, ~59 bits.
 *
 * Amostragem por rejeição: 256 não é múltiplo de 62, e `byte % 62` favoreceria
 * as primeiras letras. Descartar os bytes ≥ 248 (62 × 4) mantém a distribuição
 * uniforme.
 */
export function novoCodigoPublico(): string {
	let codigo = '';
	while (codigo.length < 10) {
		for (const byte of randomBytes(16)) {
			if (byte < 248 && codigo.length < 10) codigo += ALFABETO[byte % 62];
		}
	}
	return codigo;
}

function linhasDoPublico(
	publico: Alvo[],
	dono: { eventId: string } | { seriesId: string }
): (typeof eventAudience.$inferInsert)[] {
	return publico.map((a) => ({
		...dono,
		kind: a.tipo,
		groupId: a.tipo === 'grupo' ? a.groupId : null,
		personId: a.tipo === 'pessoa' ? a.personId : null
	}));
}

/** Linha de `event_audience` → alvo. Uma tradução só, também para a frequência (M06). */
export function alvoDaLinha(l: {
	kind: string;
	groupId: string | null;
	personId: string | null;
}): Alvo {
	if (l.kind === 'grupo') return { tipo: 'grupo', groupId: l.groupId! };
	if (l.kind === 'pessoa') return { tipo: 'pessoa', personId: l.personId! };
	return { tipo: 'equipe' };
}

/** Confere que tipo, grupo, responsável e convidados existem e estão ativos. */
async function exigirReferencias(
	db: Database,
	teamId: string,
	ref: {
		tipoId?: string;
		grupoId?: string | null;
		responsavelId?: string | null;
		publico?: Alvo[];
	}
): Promise<void> {
	if (ref.tipoId) {
		const [t] = await db
			.select({ arquivado: eventType.archivedAt })
			.from(eventType)
			.where(and(eq(eventType.id, ref.tipoId), eq(eventType.teamId, teamId)))
			.limit(1);
		if (!t) throw new EventoRecusado('nao_encontrado', 'Esse tipo de evento não existe.');
		if (t.arquivado) {
			throw new EventoRecusado('tipo_arquivado', 'Esse tipo de evento foi arquivado.');
		}
	}

	const grupos = [
		...(ref.grupoId ? [ref.grupoId] : []),
		...(ref.publico ?? []).flatMap((a) => (a.tipo === 'grupo' ? [a.groupId] : []))
	];
	if (grupos.length > 0) {
		const encontrados = await db
			.select({ id: smallGroup.id, arquivado: smallGroup.archivedAt })
			.from(smallGroup)
			.where(and(inArray(smallGroup.id, grupos), eq(smallGroup.teamId, teamId)));
		if (encontrados.length !== new Set(grupos).size) {
			throw new EventoRecusado('nao_encontrado', 'Um dos grupos não existe.');
		}
		if (encontrados.some((g) => g.arquivado)) {
			throw new EventoRecusado('grupo_arquivado', 'Grupo arquivado não tem nem recebe eventos.');
		}
	}

	const pessoas = [
		...(ref.responsavelId ? [ref.responsavelId] : []),
		...(ref.publico ?? []).flatMap((a) => (a.tipo === 'pessoa' ? [a.personId] : []))
	];
	if (pessoas.length > 0) {
		const encontradas = await db
			.select({ id: person.id })
			.from(person)
			.where(and(inArray(person.id, pessoas), eq(person.teamId, teamId), isNull(person.deletedAt)));
		if (encontradas.length !== new Set(pessoas).size) {
			throw new EventoRecusado('nao_encontrado', 'Uma das pessoas escolhidas não existe.');
		}
	}
}

/** D-M05-5, verificado no servidor: escopo de grupo não convida a equipe. */
function exigirPublicoNoEscopo(actor: Actor, publico: Alvo[]): void {
	if (publico.length === 0) {
		throw new EventoRecusado('sem_publico', 'Escolha quem está convidado.');
	}
	if (alvosForaDoEscopo(actor, publico).length > 0) {
		throw new EventoRecusado(
			'publico_fora_do_escopo',
			'Convidar a equipe inteira ou outros grupos é tarefa da liderança geral. ' +
				'Convide o seu grupo e, se quiser, pessoas avulsas.'
		);
	}
}

// ---------------------------------------------------------------------------
// Materialização (D-M05-2)
// ---------------------------------------------------------------------------

/**
 * Completa as ocorrências das séries até 12 semanas à frente.
 *
 * Idempotente e segura sob concorrência: cada série é travada (`FOR UPDATE`)
 * enquanto é completada, e o índice único `série + data` recusa repetição.
 * Duas pessoas abrindo a agenda no mesmo segundo não duplicam nada — a
 * segunda espera a primeira e encontra o trabalho feito.
 *
 * Devolve quantas ocorrências criou.
 */
export async function garantirOcorrencias(
	db: Database,
	teamId: string,
	opcoes: { serieId?: string; agora?: Date } = {}
): Promise<number> {
	const fuso = await fusoDaEquipe(db, teamId);
	const hoje = hojeNoFuso(fuso, opcoes.agora);
	const horizonte = somarDias(hoje, HORIZONTE_SEMANAS * 7);

	const pendentes = await db
		.select({ id: eventSeries.id })
		.from(eventSeries)
		.where(
			and(
				eq(eventSeries.teamId, teamId),
				lt(eventSeries.materializedUntil, horizonte),
				or(isNull(eventSeries.endsOn), gt(eventSeries.endsOn, eventSeries.materializedUntil)),
				opcoes.serieId ? eq(eventSeries.id, opcoes.serieId) : undefined
			)
		);

	let criadas = 0;
	for (const { id } of pendentes) {
		criadas += await db.transaction(async (tx) => {
			const [s] = await tx
				.select()
				.from(eventSeries)
				.where(eq(eventSeries.id, id))
				.for('update')
				.limit(1);
			if (!s || s.materializedUntil >= horizonte) return 0;

			const datas = datasEntre(
				{
					diaDaSemana: s.weekday,
					intervaloSemanas: s.intervalWeeks,
					inicio: s.startsOn,
					fim: s.endsOn
				},
				somarDias(s.materializedUntil, 1),
				horizonte
			);

			const molde = await tx.select().from(eventAudience).where(eq(eventAudience.seriesId, s.id));

			let novas = 0;
			for (const data of datas) {
				const inicio = instanteLocal(data, s.localTime.slice(0, 5), fuso);
				const [criada] = await tx
					.insert(event)
					.values({
						teamId: s.teamId,
						typeId: s.typeId,
						seriesId: s.id,
						occurrenceDate: data,
						title: s.title,
						description: s.description,
						location: s.location,
						startsAt: inicio,
						endsAt: s.durationMinutes
							? new Date(inicio.getTime() + s.durationMinutes * 60_000)
							: null,
						groupId: s.groupId,
						ownerPersonId: s.ownerPersonId,
						publishedAt: s.publishedAt,
						publicCode: novoCodigoPublico(),
						createdByPersonId: s.createdByPersonId
					})
					.onConflictDoNothing()
					.returning({ id: event.id });

				if (!criada) continue;
				novas++;
				if (molde.length > 0) {
					await tx.insert(eventAudience).values(
						molde.map((m) => ({
							eventId: criada.id,
							kind: m.kind,
							groupId: m.groupId,
							personId: m.personId
						}))
					);
				}
			}

			await tx
				.update(eventSeries)
				.set({ materializedUntil: horizonte })
				.where(eq(eventSeries.id, s.id));
			return novas;
		});
	}
	return criadas;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export type EventoResumo = {
	id: string;
	titulo: string;
	tipo: { id: string; nome: string; cor: string | null };
	inicio: Date;
	fim: Date | null;
	/** Data e hora locais, no fuso da equipe — prontas para a tela. */
	data: string;
	hora: string;
	/** Data local do fim — difere de `data` em evento de vários dias. */
	dataFim: string | null;
	horaFim: string | null;
	local: string | null;
	grupo: { id: string; nome: string; cor: string | null } | null;
	cancelado: boolean;
	publicado: boolean;
	serieId: string | null;
	ehExcecao: boolean;
};

export type AlvoComNome = Alvo & { nome: string };

export type EventoDetalhe = EventoResumo & {
	descricao: string | null;
	motivoDoCancelamento: string | null;
	responsavel: { id: string; nome: string } | null;
	publico: AlvoComNome[];
	codigoPublico: string;
	jaAconteceu: boolean;
	/** Lista de presença feita (M06) — nulo enquanto ninguém a fez. */
	listaFeitaEm: Date | null;
};

const colunasDoResumo = {
	id: event.id,
	titulo: event.title,
	inicio: event.startsAt,
	fim: event.endsAt,
	local: event.location,
	status: event.status,
	publicadoEm: event.publishedAt,
	serieId: event.seriesId,
	ehExcecao: event.isException,
	tipoId: eventType.id,
	tipoNome: eventType.name,
	tipoCor: eventType.color,
	grupoId: smallGroup.id,
	grupoNome: smallGroup.name,
	grupoCor: smallGroup.color
};

type LinhaDoResumo = {
	id: string;
	titulo: string;
	inicio: Date;
	fim: Date | null;
	local: string | null;
	status: string;
	publicadoEm: Date | null;
	serieId: string | null;
	ehExcecao: boolean;
	tipoId: string;
	tipoNome: string;
	tipoCor: string | null;
	grupoId: string | null;
	grupoNome: string | null;
	grupoCor: string | null;
};

function resumir(l: LinhaDoResumo, fuso: string): EventoResumo {
	return {
		id: l.id,
		titulo: l.titulo,
		tipo: { id: l.tipoId, nome: l.tipoNome, cor: l.tipoCor },
		inicio: l.inicio,
		fim: l.fim,
		data: dataNoFuso(l.inicio, fuso),
		hora: horaNoFuso(l.inicio, fuso),
		dataFim: l.fim ? dataNoFuso(l.fim, fuso) : null,
		horaFim: l.fim ? horaNoFuso(l.fim, fuso) : null,
		local: l.local,
		grupo: l.grupoId ? { id: l.grupoId, nome: l.grupoNome!, cor: l.grupoCor } : null,
		cancelado: l.status === 'cancelado',
		publicado: l.publicadoEm !== null,
		serieId: l.serieId,
		ehExcecao: l.ehExcecao
	};
}

export type EscopoDaAgenda =
	{ tipo: 'minha' } | { tipo: 'tudo' } | { tipo: 'grupo'; groupId: string };

/**
 * A regra de D-M05-7 em SQL — a mesma de `podeVerEvento`.
 *
 * 'tudo' é exatamente `podeVerEvento`; 'minha' é o que foi publicado PARA o
 * ator (mais os rascunhos que ele mesmo pode gerenciar, para não sumirem da
 * vista de quem os criou).
 */
function visibilidade(actor: Actor, meuGrupo: string | null, escopo: EscopoDaAgenda): SQL {
	const gerencioTudo = can(actor, 'event.manage');
	const gruposQueGerencio = groupsWhere(actor, 'event.manage');
	const vejoTudo = can(actor, 'event.view');
	const gruposQueVejo = groupsWhere(actor, 'event.view');
	const vejoAlgo = canAnywhere(actor, 'event.view');

	const nenhum = sql`false`;
	const gerenciaveis = gerencioTudo
		? sql`true`
		: gruposQueGerencio.length > 0
			? inArray(event.groupId, gruposQueGerencio)
			: nenhum;

	const gruposDoConvite = [...new Set([...gruposQueVejo, ...(meuGrupo ? [meuGrupo] : [])])];
	// `exists()` do Drizzle espera um subquery do construtor; com SQL cru, os
	// parênteses são nossos.
	const convidado = sql`exists (select 1 from ${eventAudience} where ${eventAudience.eventId} = ${event.id} and (
			${eventAudience.kind} = 'equipe'
			or (${eventAudience.kind} = 'pessoa' and ${eventAudience.personId} = ${actor.personId})
			${
				gruposDoConvite.length > 0
					? sql`or (${eventAudience.kind} = 'grupo' and ${inArray(eventAudience.groupId, gruposDoConvite)})`
					: sql``
			}
		))`;
	const publicado = isNotNull(event.publishedAt);

	if (escopo.tipo === 'minha') {
		return and(convidado, or(and(publicado, vejoAlgo ? sql`true` : nenhum), gerenciaveis))!;
	}

	const tudo = or(
		gerenciaveis,
		and(
			publicado,
			or(
				vejoTudo ? sql`true` : nenhum,
				gruposQueVejo.length > 0 ? inArray(event.groupId, gruposQueVejo) : nenhum,
				vejoAlgo ? convidado : nenhum
			)
		)
	)!;

	if (escopo.tipo === 'grupo') {
		return and(
			tudo,
			or(
				eq(event.groupId, escopo.groupId),
				sql`exists (select 1 from ${eventAudience} where ${eventAudience.eventId} = ${event.id}
					and ${eventAudience.kind} = 'grupo' and ${eventAudience.groupId} = ${escopo.groupId})`
			)
		)!;
	}
	return tudo;
}

async function listar(
	db: Database,
	actor: Actor,
	filtro: {
		de: Date;
		ate?: Date;
		escopo: EscopoDaAgenda;
		limite?: number;
		/** Inclui também o que começou antes de `de` e ainda não terminou neste instante. */
		emAndamentoEm?: Date;
	}
): Promise<EventoResumo[]> {
	// Em QUALQUER escopo: o conselheiro tem `event.view` só no grupo, e ainda
	// assim tem agenda. O que cada um vê sai da regra de visibilidade, abaixo.
	authorizeAnywhere(actor, 'event.view');

	await garantirOcorrencias(db, actor.teamId);
	const [fuso, meuGrupo] = await Promise.all([
		fusoDaEquipe(db, actor.teamId),
		grupoAtualDe(db, actor.personId)
	]);

	const consulta = db
		.select(colunasDoResumo)
		.from(event)
		.innerJoin(eventType, eq(eventType.id, event.typeId))
		.leftJoin(smallGroup, eq(smallGroup.id, event.groupId))
		.where(
			and(
				eq(event.teamId, actor.teamId),
				filtro.emAndamentoEm
					? or(gte(event.startsAt, filtro.de), gt(event.endsAt, filtro.emAndamentoEm))
					: gte(event.startsAt, filtro.de),
				filtro.ate ? lt(event.startsAt, filtro.ate) : undefined,
				visibilidade(actor, meuGrupo, filtro.escopo)
			)
		)
		.orderBy(asc(event.startsAt), asc(event.title));

	const linhas = filtro.limite ? await consulta.limit(filtro.limite) : await consulta;
	return linhas.map((l) => resumir(l, fuso));
}

export type DiaDaAgenda = { data: string; eventos: EventoResumo[] };

/** A agenda de um mês `AAAA-MM`, agrupada por dia local (RF-05.4). */
export async function agendaDoMes(
	db: Database,
	actor: Actor,
	mes: string,
	escopo: EscopoDaAgenda
): Promise<DiaDaAgenda[]> {
	const fuso = await fusoDaEquipe(db, actor.teamId);
	const { inicio, fim } = limitesDoMes(mes);
	const eventos = await listar(db, actor, {
		de: instanteLocal(inicio, '00:00', fuso),
		ate: instanteLocal(somarDias(fim, 1), '00:00', fuso),
		escopo
	});

	const dias = new Map<string, EventoResumo[]>();
	for (const e of eventos) dias.set(e.data, [...(dias.get(e.data) ?? []), e]);
	return [...dias.entries()].map(([data, lista]) => ({ data, eventos: lista }));
}

/** Os próximos eventos — do ator ("minha agenda") ou de um grupo. */
export async function proximosEventos(
	db: Database,
	actor: Actor,
	opcoes: { limite: number; grupoId?: string; agora?: Date }
): Promise<EventoResumo[]> {
	const agora = opcoes.agora ?? new Date();
	// Começou há menos de 3 horas ainda é "o encontro de agora". E o que ainda
	// não terminou também: o retiro de sexta a domingo sumia do início no
	// sábado, no meio dele (revisão de 17/10/2026).
	const de = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
	const eventos = await listar(db, actor, {
		de,
		emAndamentoEm: agora,
		escopo: opcoes.grupoId ? { tipo: 'grupo', groupId: opcoes.grupoId } : { tipo: 'minha' },
		limite: opcoes.limite + 10
	});
	return eventos.filter((e) => !e.cancelado || e.inicio > agora).slice(0, opcoes.limite);
}

async function publicoComNomes(db: Database, eventId: string): Promise<AlvoComNome[]> {
	const linhas = await db
		.select({
			kind: eventAudience.kind,
			groupId: eventAudience.groupId,
			personId: eventAudience.personId,
			grupoNome: smallGroup.name,
			pessoaNome: person.fullName
		})
		.from(eventAudience)
		.leftJoin(smallGroup, eq(smallGroup.id, eventAudience.groupId))
		.leftJoin(person, eq(person.id, eventAudience.personId))
		.where(eq(eventAudience.eventId, eventId));

	return linhas
		.map((l) => {
			const alvo = alvoDaLinha(l);
			const nome =
				alvo.tipo === 'equipe'
					? 'Toda a equipe'
					: alvo.tipo === 'grupo'
						? (l.grupoNome ?? 'grupo')
						: (l.pessoaNome ?? 'pessoa');
			return { ...alvo, nome };
		})
		.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Detalhe de um evento — `null` quando não existe OU o ator não pode vê-lo. */
export async function verEvento(
	db: Database,
	actor: Actor,
	eventId: string
): Promise<EventoDetalhe | null> {
	if (!ehId(eventId)) return null;
	const [linha] = await db
		.select({
			...colunasDoResumo,
			descricao: event.description,
			motivo: event.cancelReason,
			codigo: event.publicCode,
			listaFeitaEm: event.attendanceTakenAt,
			responsavelId: person.id,
			responsavelNome: person.fullName
		})
		.from(event)
		.innerJoin(eventType, eq(eventType.id, event.typeId))
		.leftJoin(smallGroup, eq(smallGroup.id, event.groupId))
		.leftJoin(person, eq(person.id, event.ownerPersonId))
		.where(and(eq(event.id, eventId), eq(event.teamId, actor.teamId)))
		.limit(1);
	if (!linha) return null;

	const [fuso, meuGrupo, publico] = await Promise.all([
		fusoDaEquipe(db, actor.teamId),
		grupoAtualDe(db, actor.personId),
		publicoComNomes(db, eventId)
	]);

	const visivel = podeVerEvento(
		actor,
		{ groupId: linha.grupoId, publicado: linha.publicadoEm !== null },
		publico,
		meuGrupo
	);
	if (!visivel) return null;

	return {
		...resumir(linha, fuso),
		descricao: linha.descricao,
		motivoDoCancelamento: linha.motivo,
		responsavel: linha.responsavelId
			? { id: linha.responsavelId, nome: linha.responsavelNome! }
			: null,
		publico,
		codigoPublico: linha.codigo,
		jaAconteceu: linha.inicio <= new Date(),
		listaFeitaEm: linha.listaFeitaEm
	};
}

export type EventoPublico = {
	titulo: string;
	tipo: string;
	data: string;
	hora: string;
	dataFim: string | null;
	horaFim: string | null;
	local: string | null;
	descricao: string | null;
	grupo: string | null;
	cancelado: boolean;
	equipe: string;
	/** Para a rota decidir sobre o autocadastro; não vai para a página. */
	teamId: string;
	/** Para quem já entrou responder (D-M06-3); também não vai para a página. */
	id: string;
};

/**
 * O que o link público mostra (D-M05-8) — SEM ator, e por isso sem nada sobre
 * pessoas: nem quem vai, nem quem organiza. Rascunho não existe para o link.
 */
export async function eventoPorCodigo(db: Database, codigo: string): Promise<EventoPublico | null> {
	if (!/^[A-Za-z0-9]{10}$/.test(codigo)) return null;

	const [linha] = await db
		.select({
			id: event.id,
			titulo: event.title,
			tipo: eventType.name,
			inicio: event.startsAt,
			fim: event.endsAt,
			local: event.location,
			descricao: event.description,
			grupo: smallGroup.name,
			status: event.status,
			equipe: team.name,
			teamId: team.id,
			fuso: team.timezone
		})
		.from(event)
		.innerJoin(eventType, eq(eventType.id, event.typeId))
		.innerJoin(team, eq(team.id, event.teamId))
		.leftJoin(smallGroup, eq(smallGroup.id, event.groupId))
		.where(and(eq(event.publicCode, codigo), isNotNull(event.publishedAt)))
		.limit(1);
	if (!linha) return null;

	return {
		titulo: linha.titulo,
		tipo: linha.tipo,
		data: dataNoFuso(linha.inicio, linha.fuso),
		hora: horaNoFuso(linha.inicio, linha.fuso),
		dataFim: linha.fim ? dataNoFuso(linha.fim, linha.fuso) : null,
		horaFim: linha.fim ? horaNoFuso(linha.fim, linha.fuso) : null,
		local: linha.local,
		descricao: linha.descricao,
		grupo: linha.grupo,
		cancelado: linha.status === 'cancelado',
		equipe: linha.equipe,
		teamId: linha.teamId,
		id: linha.id
	};
}

// ---------------------------------------------------------------------------
// Escrita — evento avulso e série
// ---------------------------------------------------------------------------

async function auditar(
	db: Database,
	actor: Actor,
	action: AuditAction,
	entity: 'event' | 'event_series',
	entityId: string,
	extra: { before?: unknown; after?: unknown } & ContextoDeRequisicao = {}
) {
	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action,
		entity,
		entityId,
		before: extra.before,
		after: extra.after,
		ip: extra.ip,
		userAgent: extra.userAgent
	});
}

/**
 * Cria um evento avulso ou uma série semanal.
 *
 * Permissão no grupo do evento — ou global, para evento geral. Publicar no
 * mesmo passo exige `event.publish` ali (D-M05-6); sem pedir, nasce rascunho.
 */
export async function criarEvento(
	db: Database,
	actor: Actor,
	dados: EventoEntrada,
	publico: Alvo[],
	contexto: ContextoDeRequisicao = {}
): Promise<{ tipo: 'evento' | 'serie'; id: string }> {
	authorize(actor, 'event.manage', { groupId: dados.grupoId });
	if (dados.publicar) authorize(actor, 'event.publish', { groupId: dados.grupoId });
	exigirPublicoNoEscopo(actor, publico);
	await exigirReferencias(db, actor.teamId, {
		tipoId: dados.tipoId,
		grupoId: dados.grupoId,
		responsavelId: dados.responsavelId,
		publico
	});

	const fuso = await fusoDaEquipe(db, actor.teamId);
	const publicadoEm = dados.publicar ? new Date() : null;

	if (dados.recorrencia === 'semanal') {
		const hoje = hojeNoFuso(fuso);
		const serieId = await db.transaction(async (tx) => {
			const [serie] = await tx
				.insert(eventSeries)
				.values({
					teamId: actor.teamId,
					typeId: dados.tipoId,
					groupId: dados.grupoId,
					title: dados.titulo,
					description: dados.descricao,
					location: dados.local,
					ownerPersonId: dados.responsavelId,
					weekday: diaDaSemana(dados.data),
					localTime: dados.horaInicio,
					durationMinutes: dados.horaFim ? minutosEntre(dados.horaInicio, dados.horaFim) : null,
					intervalWeeks: dados.intervaloSemanas,
					startsOn: dados.data,
					endsOn: dados.terminaEm,
					// Série que "já existe há anos" não materializa o passado: o
					// app começa a contar de hoje.
					materializedUntil: somarDias(dados.data > hoje ? dados.data : hoje, -1),
					publishedAt: publicadoEm,
					createdByPersonId: actor.personId
				})
				.returning({ id: eventSeries.id });
			await tx.insert(eventAudience).values(linhasDoPublico(publico, { seriesId: serie!.id }));
			return serie!.id;
		});

		await garantirOcorrencias(db, actor.teamId, { serieId });
		await auditar(db, actor, 'event.serie_criada', 'event_series', serieId, {
			after: { ...dados, publico },
			...contexto
		});
		return { tipo: 'serie', id: serieId };
	}

	const inicio = instanteLocal(dados.data, dados.horaInicio, fuso);
	const ate = fimLocal(dados);
	const fim = ate ? instanteLocal(ate.data, ate.hora, fuso) : null;
	if (fim && fim <= inicio) {
		throw new EventoRecusado('periodo_invalido', 'O evento termina antes de começar.');
	}

	const eventoId = await db.transaction(async (tx) => {
		const [criado] = await tx
			.insert(event)
			.values({
				teamId: actor.teamId,
				typeId: dados.tipoId,
				title: dados.titulo,
				description: dados.descricao,
				location: dados.local,
				startsAt: inicio,
				endsAt: fim,
				groupId: dados.grupoId,
				ownerPersonId: dados.responsavelId,
				publishedAt: publicadoEm,
				publicCode: novoCodigoPublico(),
				createdByPersonId: actor.personId
			})
			.returning({ id: event.id });
		await tx.insert(eventAudience).values(linhasDoPublico(publico, { eventId: criado!.id }));
		return criado!.id;
	});

	await auditar(db, actor, 'event.criado', 'event', eventoId, {
		after: { ...dados, publico },
		...contexto
	});
	return { tipo: 'evento', id: eventoId };
}

async function eventoDaEquipe(db: Database, actor: Actor, eventId: string) {
	const [e] = await db
		.select()
		.from(event)
		.where(and(eq(event.id, eventId), eq(event.teamId, actor.teamId)))
		.limit(1);
	if (!e) throw new EventoRecusado('nao_encontrado', 'Esse evento não existe.');
	return e;
}

/** O público atual de um evento, como alvos. */
export async function publicoDoEvento(db: Database, eventId: string): Promise<Alvo[]> {
	const linhas = await db
		.select({
			kind: eventAudience.kind,
			groupId: eventAudience.groupId,
			personId: eventAudience.personId
		})
		.from(eventAudience)
		.where(eq(eventAudience.eventId, eventId));
	return linhas.map(alvoDaLinha);
}

/**
 * Edita UMA ocorrência ou um evento avulso. Ocorrência de série editada vira
 * exceção (D-M05-4): a próxima edição da série não a sobrescreve.
 */
export async function editarEvento(
	db: Database,
	actor: Actor,
	eventId: string,
	dados: OcorrenciaEntrada,
	publico: Alvo[],
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	const antes = await eventoDaEquipe(db, actor, eventId);
	authorize(actor, 'event.manage', { groupId: antes.groupId });
	exigirPublicoNoEscopo(actor, publico);
	await exigirReferencias(db, actor.teamId, { responsavelId: dados.responsavelId, publico });

	// Uma data de encontro semanal começa e termina no mesmo dia, como a série.
	if (antes.seriesId !== null && dados.dataFim && dados.dataFim !== dados.data) {
		throw new EventoRecusado(
			'periodo_invalido',
			'Uma data do encontro semanal começa e termina no mesmo dia.'
		);
	}

	// O fim se calcula como na criação. Antes, a edição o refazia na data de
	// INÍCIO: mudar só o título de um retiro de sexta a domingo o encurtava
	// para sexta (varredura de 11/10/2026).
	const fuso = await fusoDaEquipe(db, actor.teamId);
	const inicio = instanteLocal(dados.data, dados.horaInicio, fuso);
	const ate = fimLocal(dados);
	const fim = ate ? instanteLocal(ate.data, ate.hora, fuso) : null;
	if (fim && fim <= inicio) {
		throw new EventoRecusado('periodo_invalido', 'O evento termina antes de começar.');
	}

	await db.transaction(async (tx) => {
		await tx
			.update(event)
			.set({
				title: dados.titulo,
				description: dados.descricao,
				location: dados.local,
				ownerPersonId: dados.responsavelId,
				startsAt: inicio,
				endsAt: fim,
				isException: antes.seriesId !== null,
				updatedAt: new Date()
			})
			.where(eq(event.id, eventId));
		await tx.delete(eventAudience).where(eq(eventAudience.eventId, eventId));
		await tx.insert(eventAudience).values(linhasDoPublico(publico, { eventId }));
	});

	await auditar(db, actor, 'event.editado', 'event', eventId, {
		before: {
			titulo: antes.title,
			inicio: antes.startsAt,
			fim: antes.endsAt,
			local: antes.location
		},
		after: { ...dados, publico },
		...contexto
	});
}

/** Publica um rascunho (D-M05-6). Já publicado: nada a fazer. */
export async function publicarEvento(
	db: Database,
	actor: Actor,
	eventId: string,
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	const e = await eventoDaEquipe(db, actor, eventId);
	authorize(actor, 'event.publish', { groupId: e.groupId });
	if (e.publishedAt) return;

	await db
		.update(event)
		.set({ publishedAt: new Date(), updatedAt: new Date() })
		.where(eq(event.id, eventId));
	await auditar(db, actor, 'event.publicado', 'event', eventId, contexto);
}

/**
 * Cancela — nunca apaga (seção 12.2). O motivo aparece para quem abre o
 * evento, inclusive pelo link público: quem recebeu o link precisa saber.
 */
export async function cancelarEvento(
	db: Database,
	actor: Actor,
	eventId: string,
	motivo: string | null,
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	const e = await eventoDaEquipe(db, actor, eventId);
	authorize(actor, 'event.manage', { groupId: e.groupId });
	if (e.status === 'cancelado') return;

	await db
		.update(event)
		.set({
			status: 'cancelado',
			cancelReason: motivo,
			isException: e.seriesId !== null,
			updatedAt: new Date()
		})
		.where(eq(event.id, eventId));
	await auditar(db, actor, 'event.cancelado', 'event', eventId, { after: { motivo }, ...contexto });
}

export async function reativarEvento(
	db: Database,
	actor: Actor,
	eventId: string,
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	const e = await eventoDaEquipe(db, actor, eventId);
	authorize(actor, 'event.manage', { groupId: e.groupId });
	if (e.status !== 'cancelado') return;

	await db
		.update(event)
		.set({ status: 'agendado', cancelReason: null, updatedAt: new Date() })
		.where(eq(event.id, eventId));
	await auditar(db, actor, 'event.reativado', 'event', eventId, contexto);
}

// ---------------------------------------------------------------------------
// Série
// ---------------------------------------------------------------------------

export type SerieDetalhe = {
	id: string;
	titulo: string;
	descricao: string | null;
	local: string | null;
	tipo: { id: string; nome: string };
	grupo: { id: string; nome: string } | null;
	responsavelId: string | null;
	diaDaSemana: number;
	hora: string;
	horaFim: string | null;
	intervaloSemanas: number;
	inicio: string;
	fim: string | null;
	publicada: boolean;
	encerrada: boolean;
	publico: Alvo[];
	proximas: EventoResumo[];
};

async function serieDaEquipe(db: Database, actor: Actor, serieId: string) {
	const [s] = await db
		.select()
		.from(eventSeries)
		.where(and(eq(eventSeries.id, serieId), eq(eventSeries.teamId, actor.teamId)))
		.limit(1);
	if (!s) throw new EventoRecusado('nao_encontrado', 'Esse encontro semanal não existe.');
	return s;
}

/** A série, para quem pode gerenciá-la. */
export async function verSerie(
	db: Database,
	actor: Actor,
	serieId: string
): Promise<SerieDetalhe | null> {
	const [s] = await db
		.select({
			serie: eventSeries,
			tipoNome: eventType.name,
			grupoNome: smallGroup.name
		})
		.from(eventSeries)
		.innerJoin(eventType, eq(eventType.id, eventSeries.typeId))
		.leftJoin(smallGroup, eq(smallGroup.id, eventSeries.groupId))
		.where(and(eq(eventSeries.id, serieId), eq(eventSeries.teamId, actor.teamId)))
		.limit(1);
	if (!s) return null;
	authorize(actor, 'event.manage', { groupId: s.serie.groupId });

	await garantirOcorrencias(db, actor.teamId, { serieId });
	const fuso = await fusoDaEquipe(db, actor.teamId);
	const hoje = hojeNoFuso(fuso);

	const [publico, proximas] = await Promise.all([
		db
			.select({
				kind: eventAudience.kind,
				groupId: eventAudience.groupId,
				personId: eventAudience.personId
			})
			.from(eventAudience)
			.where(eq(eventAudience.seriesId, serieId)),
		db
			.select(colunasDoResumo)
			.from(event)
			.innerJoin(eventType, eq(eventType.id, event.typeId))
			.leftJoin(smallGroup, eq(smallGroup.id, event.groupId))
			.where(and(eq(event.seriesId, serieId), gte(event.startsAt, new Date())))
			.orderBy(asc(event.startsAt))
			.limit(6)
	]);

	const hora = s.serie.localTime.slice(0, 5);
	const minutos = s.serie.durationMinutes;
	const horaFim = minutos
		? horaNoFuso(new Date(instanteLocal(hoje, hora, fuso).getTime() + minutos * 60_000), fuso)
		: null;

	return {
		id: s.serie.id,
		titulo: s.serie.title,
		descricao: s.serie.description,
		local: s.serie.location,
		tipo: { id: s.serie.typeId, nome: s.tipoNome },
		grupo: s.serie.groupId ? { id: s.serie.groupId, nome: s.grupoNome! } : null,
		responsavelId: s.serie.ownerPersonId,
		diaDaSemana: s.serie.weekday,
		hora,
		horaFim,
		intervaloSemanas: s.serie.intervalWeeks,
		inicio: s.serie.startsOn,
		fim: s.serie.endsOn,
		publicada: s.serie.publishedAt !== null,
		encerrada:
			s.serie.endsOn !== null && (s.serie.endsOn < hoje || s.serie.endsOn < s.serie.startsOn),
		publico: publico.map(alvoDaLinha),
		proximas: proximas.map((l) => resumir(l, fuso))
	};
}

/**
 * Edita a série: título, descrição, local, horário, responsável e público.
 *
 * Alcança as ocorrências FUTURAS que não são exceção (D-M05-4). O passado não
 * muda — é história — e as exceções foram ajustadas à mão por alguém.
 */
export async function editarSerie(
	db: Database,
	actor: Actor,
	serieId: string,
	dados: SerieEntrada,
	publico: Alvo[],
	contexto: ContextoDeRequisicao = {}
): Promise<number> {
	const s = await serieDaEquipe(db, actor, serieId);
	authorize(actor, 'event.manage', { groupId: s.groupId });
	exigirPublicoNoEscopo(actor, publico);
	await exigirReferencias(db, actor.teamId, { responsavelId: dados.responsavelId, publico });

	const fuso = await fusoDaEquipe(db, actor.teamId);
	const duracao = dados.horaFim ? minutosEntre(dados.horaInicio, dados.horaFim) : null;

	const alcancadas = await db.transaction(async (tx) => {
		await tx
			.update(eventSeries)
			.set({
				title: dados.titulo,
				description: dados.descricao,
				location: dados.local,
				ownerPersonId: dados.responsavelId,
				localTime: dados.horaInicio,
				durationMinutes: duracao,
				updatedAt: new Date()
			})
			.where(eq(eventSeries.id, serieId));
		await tx.delete(eventAudience).where(eq(eventAudience.seriesId, serieId));
		await tx.insert(eventAudience).values(linhasDoPublico(publico, { seriesId: serieId }));

		const futuras = await tx
			.select({ id: event.id, data: event.occurrenceDate })
			.from(event)
			.where(
				and(
					eq(event.seriesId, serieId),
					eq(event.isException, false),
					gt(event.startsAt, new Date())
				)
			);

		for (const o of futuras) {
			const inicio = instanteLocal(o.data!, dados.horaInicio, fuso);
			await tx
				.update(event)
				.set({
					title: dados.titulo,
					description: dados.descricao,
					location: dados.local,
					ownerPersonId: dados.responsavelId,
					startsAt: inicio,
					endsAt: duracao ? new Date(inicio.getTime() + duracao * 60_000) : null,
					updatedAt: new Date()
				})
				.where(eq(event.id, o.id));
		}

		if (futuras.length > 0) {
			const ids = futuras.map((o) => o.id);
			await tx.delete(eventAudience).where(inArray(eventAudience.eventId, ids));
			await tx
				.insert(eventAudience)
				.values(ids.flatMap((eventId) => linhasDoPublico(publico, { eventId })));
		}
		return futuras.length;
	});

	await auditar(db, actor, 'event.serie_editada', 'event_series', serieId, {
		before: { titulo: s.title, hora: s.localTime, local: s.location },
		after: { ...dados, publico, ocorrenciasAlcancadas: alcancadas },
		...contexto
	});
	return alcancadas;
}

/** Publica a série: as ocorrências futuras e as que ainda serão criadas. */
export async function publicarSerie(
	db: Database,
	actor: Actor,
	serieId: string,
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	const s = await serieDaEquipe(db, actor, serieId);
	authorize(actor, 'event.publish', { groupId: s.groupId });
	if (s.publishedAt) return;

	const agora = new Date();
	await db.transaction(async (tx) => {
		await tx
			.update(eventSeries)
			.set({ publishedAt: agora, updatedAt: agora })
			.where(eq(eventSeries.id, serieId));
		await tx
			.update(event)
			.set({ publishedAt: agora, updatedAt: agora })
			.where(
				and(eq(event.seriesId, serieId), isNull(event.publishedAt), gt(event.startsAt, agora))
			);
	});
	await auditar(db, actor, 'event.serie_publicada', 'event_series', serieId, contexto);
}

/**
 * Encerra a série: ela não acontece mais a partir de `aPartirDe` (inclusive).
 *
 * As ocorrências futuras não desprendidas deixam de existir; as exceções
 * ficam, porque alguém as ajustou à mão (D-M05-4). O passado não muda.
 *
 * Desde o M06, ocorrência futura com RSVP ou presença é CANCELADA em vez de
 * apagada (D-M06-9) — e a chave estrangeira recusaria o contrário.
 */
export async function encerrarSerie(
	db: Database,
	actor: Actor,
	serieId: string,
	aPartirDe: string,
	contexto: ContextoDeRequisicao = {}
): Promise<{ removidas: number; canceladas: number }> {
	const s = await serieDaEquipe(db, actor, serieId);
	authorize(actor, 'event.manage', { groupId: s.groupId });

	const fuso = await fusoDaEquipe(db, actor.teamId);
	const hoje = hojeNoFuso(fuso);
	if (aPartirDe < hoje) {
		throw new EventoRecusado(
			'ja_aconteceu',
			'O que já aconteceu não se desfaz. Encerre a partir de hoje ou de uma data futura.'
		);
	}
	if (s.endsOn !== null && s.endsOn < aPartirDe) {
		throw new EventoRecusado('serie_encerrada', 'Este encontro semanal já termina antes disso.');
	}

	// Encerrar antes da primeira data é terminar na véspera do início: uma
	// série que nunca aconteceu (o CHECK do banco aceita exatamente isso).
	const ultimo = somarDias(aPartirDe, -1);
	const vespera = somarDias(s.startsOn, -1);
	const fim = ultimo < vespera ? vespera : ultimo;

	const { removidas, canceladas } = await db.transaction(async (tx) => {
		await tx
			.update(eventSeries)
			.set({
				endsOn: fim,
				// Sem isto, uma série encerrada antes de materializar a primeira
				// data a materializaria de novo na próxima leitura da agenda.
				materializedUntil: s.materializedUntil > fim ? s.materializedUntil : fim,
				updatedAt: new Date()
			})
			.where(eq(eventSeries.id, serieId));

		const futuras = and(
			eq(event.seriesId, serieId),
			eq(event.isException, false),
			gte(event.occurrenceDate, aPartirDe),
			gt(event.startsAt, new Date())
		);
		// Ocorrência com resposta ou presença presa a ela é CANCELADA, nunca
		// apagada (D-M06-9): apagar levaria junto a resposta de alguém.
		const comDados = sql`(exists (select 1 from ${rsvp} where ${rsvp.eventId} = ${event.id})
			or exists (select 1 from ${attendance} where ${attendance.eventId} = ${event.id}))`;

		const canceladas = await tx
			.update(event)
			.set({
				status: 'cancelado',
				cancelReason: 'Encontro semanal encerrado',
				updatedAt: new Date()
			})
			.where(and(futuras, eq(event.status, 'agendado'), comDados))
			.returning({ id: event.id });

		const apagadas = await tx
			.delete(event)
			.where(and(futuras, sql`not ${comDados}`))
			.returning({ id: event.id });
		return { removidas: apagadas.length, canceladas: canceladas.length };
	});

	await auditar(db, actor, 'event.serie_encerrada', 'event_series', serieId, {
		after: { aPartirDe, ocorrenciasRemovidas: removidas, ocorrenciasCanceladas: canceladas },
		...contexto
	});
	return { removidas, canceladas };
}

/** Série em andamento de um grupo — para o atalho da tela do grupo. */
export async function serieAtivaDoGrupo(
	db: Database,
	teamId: string,
	groupId: string
): Promise<{ id: string; titulo: string } | null> {
	const fuso = await fusoDaEquipe(db, teamId);
	const [s] = await db
		.select({ id: eventSeries.id, titulo: eventSeries.title })
		.from(eventSeries)
		.where(
			and(
				eq(eventSeries.teamId, teamId),
				eq(eventSeries.groupId, groupId),
				emAndamento(hojeNoFuso(fuso))
			)
		)
		.limit(1);
	return s ?? null;
}

async function hojeDoGrupo(db: Database, groupId: string): Promise<string> {
	const [g] = await db
		.select({ fuso: team.timezone })
		.from(smallGroup)
		.innerJoin(team, eq(team.id, smallGroup.teamId))
		.where(eq(smallGroup.id, groupId))
		.limit(1);
	return hojeNoFuso(g?.fuso ?? FUSO_PADRAO);
}

/** Grupo tem algo marcado? (D-M04-2 revisado: impede arquivar.) */
export async function grupoTemEncontrosMarcados(db: Database, groupId: string): Promise<boolean> {
	const [serie] = await db
		.select({ id: eventSeries.id })
		.from(eventSeries)
		.where(and(eq(eventSeries.groupId, groupId), emAndamento(await hojeDoGrupo(db, groupId))))
		.limit(1);
	if (serie) return true;

	const [futuro] = await db
		.select({ id: event.id })
		.from(event)
		.where(
			and(eq(event.groupId, groupId), eq(event.status, 'agendado'), gt(event.startsAt, new Date()))
		)
		.limit(1);
	return !!futuro;
}
