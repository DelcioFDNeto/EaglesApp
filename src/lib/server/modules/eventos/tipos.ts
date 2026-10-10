import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '$server/db';
import { event, eventSeries, eventType } from '$server/db/schema';
import { audit } from '$server/audit/log';
import { authorize, type Actor } from '$server/policy/policy';
import { chaveDoNome } from '$server/modules/rbac/regras';
import { EventoRecusado } from './regras';
import type { TipoEntrada } from './validacao';

/**
 * Tipos de evento (RF-05.1, RN-10, D-M05-10).
 *
 * Ler é para quem cria eventos; alterar é configuração da equipe —
 * `settings.manage` global.
 */

export type TipoDeEvento = {
	id: string;
	key: string;
	nome: string;
	cor: string | null;
	ehEncontroDoGrupo: boolean;
	contaParaFrequencia: boolean;
	arquivado: boolean;
	eventos: number;
};

export async function listarTipos(
	db: Database,
	teamId: string,
	opcoes: { incluirArquivados?: boolean } = {}
): Promise<TipoDeEvento[]> {
	const linhas = await db
		.select()
		.from(eventType)
		.where(
			and(
				eq(eventType.teamId, teamId),
				opcoes.incluirArquivados ? undefined : isNull(eventType.archivedAt)
			)
		)
		.orderBy(asc(eventType.position), asc(eventType.name));

	const usos = await db
		.select({ typeId: event.typeId, total: count() })
		.from(event)
		.where(eq(event.teamId, teamId))
		.groupBy(event.typeId);
	const porTipo = new Map(usos.map((u) => [u.typeId, Number(u.total)]));

	return linhas.map((t) => ({
		id: t.id,
		key: t.key,
		nome: t.name,
		cor: t.color,
		ehEncontroDoGrupo: t.isGroupMeeting,
		contaParaFrequencia: t.countsForAttendance,
		arquivado: t.archivedAt !== null,
		eventos: porTipo.get(t.id) ?? 0
	}));
}

/** O tipo do encontro semanal do grupo, se houver um marcado. */
export async function tipoDoEncontroDoGrupo(
	db: Database,
	teamId: string
): Promise<{ id: string; nome: string } | null> {
	const [t] = await db
		.select({ id: eventType.id, nome: eventType.name })
		.from(eventType)
		.where(
			and(eq(eventType.teamId, teamId), eventType.isGroupMeeting, isNull(eventType.archivedAt))
		)
		.limit(1);
	return t ?? null;
}

type ContextoDeRequisicao = { ip?: string | null; userAgent?: string | null };

async function exigirNomeLivre(db: Database, teamId: string, nome: string, excetoId?: string) {
	const [igual] = await db
		.select({ id: eventType.id })
		.from(eventType)
		.where(
			and(
				eq(eventType.teamId, teamId),
				isNull(eventType.archivedAt),
				eq(sql`lower(${eventType.name})`, nome.toLowerCase()),
				excetoId ? ne(eventType.id, excetoId) : undefined
			)
		)
		.limit(1);
	if (igual) throw new EventoRecusado('nome_em_uso', `Já existe um tipo chamado "${nome}".`);
}

/**
 * Só um tipo é o do encontro do grupo: marcar um desmarca o anterior, na
 * mesma transação. O índice único parcial do banco garante o resto.
 */
async function desmarcarEncontroDoGrupo(db: Database, teamId: string, excetoId?: string) {
	await db
		.update(eventType)
		.set({ isGroupMeeting: false, updatedAt: new Date() })
		.where(
			and(
				eq(eventType.teamId, teamId),
				eventType.isGroupMeeting,
				excetoId ? ne(eventType.id, excetoId) : undefined
			)
		);
}

export async function criarTipo(
	db: Database,
	actor: Actor,
	dados: TipoEntrada,
	contexto: ContextoDeRequisicao = {}
): Promise<string> {
	authorize(actor, 'settings.manage');
	await exigirNomeLivre(db, actor.teamId, dados.nome);

	// A chave é derivada do nome e nunca exibida; colisão ganha um sufixo.
	const base = chaveDoNome(dados.nome);
	const existentes = new Set(
		(
			await db
				.select({ key: eventType.key })
				.from(eventType)
				.where(eq(eventType.teamId, actor.teamId))
		).map((t) => t.key)
	);
	let key = base;
	for (let i = 2; existentes.has(key); i++) key = `${base}_${i}`;

	const id = await db.transaction(async (tx) => {
		if (dados.ehEncontroDoGrupo)
			await desmarcarEncontroDoGrupo(tx as unknown as Database, actor.teamId);
		const [criado] = await tx
			.insert(eventType)
			.values({
				teamId: actor.teamId,
				key,
				name: dados.nome,
				color: dados.cor,
				isGroupMeeting: dados.ehEncontroDoGrupo,
				countsForAttendance: dados.contaParaFrequencia,
				position: 100
			})
			.returning({ id: eventType.id });
		return criado!.id;
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'event.tipo_criado',
		entity: 'event_type',
		entityId: id,
		after: dados,
		...contexto
	});
	return id;
}

export async function atualizarTipo(
	db: Database,
	actor: Actor,
	tipoId: string,
	dados: TipoEntrada,
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	authorize(actor, 'settings.manage');

	const [antes] = await db
		.select()
		.from(eventType)
		.where(and(eq(eventType.id, tipoId), eq(eventType.teamId, actor.teamId)))
		.limit(1);
	if (!antes) throw new EventoRecusado('nao_encontrado', 'Esse tipo de evento não existe.');
	await exigirNomeLivre(db, actor.teamId, dados.nome, tipoId);

	await db.transaction(async (tx) => {
		if (dados.ehEncontroDoGrupo) {
			await desmarcarEncontroDoGrupo(tx as unknown as Database, actor.teamId, tipoId);
		}
		await tx
			.update(eventType)
			.set({
				name: dados.nome,
				color: dados.cor,
				isGroupMeeting: dados.ehEncontroDoGrupo,
				countsForAttendance: dados.contaParaFrequencia,
				updatedAt: new Date()
			})
			.where(eq(eventType.id, tipoId));
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'event.tipo_editado',
		entity: 'event_type',
		entityId: tipoId,
		before: {
			nome: antes.name,
			cor: antes.color,
			ehEncontroDoGrupo: antes.isGroupMeeting,
			contaParaFrequencia: antes.countsForAttendance
		},
		after: dados,
		...contexto
	});
}

/**
 * Arquiva (ou reativa) um tipo. Arquivado, some dos formulários; os eventos
 * que já o usam continuam com ele. Não existe "apagar": evento passado
 * precisa continuar dizendo o que foi.
 */
export async function arquivarTipo(
	db: Database,
	actor: Actor,
	tipoId: string,
	arquivar: boolean,
	contexto: ContextoDeRequisicao = {}
): Promise<void> {
	authorize(actor, 'settings.manage');

	const [tipo] = await db
		.select()
		.from(eventType)
		.where(and(eq(eventType.id, tipoId), eq(eventType.teamId, actor.teamId)))
		.limit(1);
	if (!tipo) throw new EventoRecusado('nao_encontrado', 'Esse tipo de evento não existe.');

	if (arquivar) {
		// Série em andamento com este tipo continuaria criando eventos de um
		// tipo que não aparece mais em lugar nenhum.
		const [emUso] = await db
			.select({ id: eventSeries.id })
			.from(eventSeries)
			.where(
				and(
					eq(eventSeries.typeId, tipoId),
					sql`(${eventSeries.endsOn} is null or (${eventSeries.endsOn} >= current_date and ${eventSeries.endsOn} >= ${eventSeries.startsOn}))`
				)
			)
			.limit(1);
		if (emUso) {
			throw new EventoRecusado(
				'tipo_arquivado',
				'Há um encontro semanal em andamento com este tipo. Encerre a série antes de arquivar.'
			);
		}
	} else {
		await exigirNomeLivre(db, actor.teamId, tipo.name, tipoId);
	}

	await db
		.update(eventType)
		.set({
			archivedAt: arquivar ? new Date() : null,
			// Arquivado deixa de ser o tipo do encontro do grupo.
			isGroupMeeting: arquivar ? false : tipo.isGroupMeeting,
			updatedAt: new Date()
		})
		.where(eq(eventType.id, tipoId));

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: arquivar ? 'event.tipo_arquivado' : 'event.tipo_reativado',
		entity: 'event_type',
		entityId: tipoId,
		before: { nome: tipo.name },
		...contexto
	});
}
