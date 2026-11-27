import { json } from '@sveltejs/kit';
import { and, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '$server/db';
import {
	escala,
	event as eventTable,
	eventRegistration,
	groupMember,
	person as personTable,
	presence,
	responsabilidade as responsabilidadeTable
} from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { naoEhMaster } from '$server/lideranca/regras';
import { classificarRsvpParaEscala, sugerirSubstitutos } from '$server/responsabilidades/gerador';
import { chavesQueConfirmam, type OpcaoRsvp } from '$shared/rsvp';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Retorna os top 3 substitutos sugeridos para uma atribuição de escala (RF-07.5),
 * ranqueados por disponibilidade (RSVP), intervalo mínimo, carga recente e frequência.
 */
export const GET = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const escalaId = params.id;
	if (!isUuid(escalaId)) {
		return json({ erro: 'Identificador de escala inválido.' }, { status: 400 });
	}

	const [registro] = await banco
		.select({
			id: escala.id,
			eventId: escala.eventId,
			personId: escala.personId,
			responsabilidadeId: escala.responsabilidadeId,
			groupId: eventTable.groupId,
			startsAt: eventTable.startsAt,
			rsvpOptions: eventTable.rsvpOptions,
			respNome: responsabilidadeTable.nome,
			respIntervalo: responsabilidadeTable.intervaloMinimoDias,
			respOrdem: responsabilidadeTable.ordem
		})
		.from(escala)
		.innerJoin(eventTable, eq(eventTable.id, escala.eventId))
		.innerJoin(responsabilidadeTable, eq(responsabilidadeTable.id, escala.responsabilidadeId))
		.where(and(eq(escala.id, escalaId), eq(eventTable.teamId, actor.teamId)))
		.limit(1);

	if (!registro) {
		return json({ erro: 'Escala não encontrada.' }, { status: 404 });
	}

	if (!can(actor, 'responsibility.manage', { groupId: registro.groupId })) {
		return json(
			{ erro: 'Apenas líderes e conselheiros autorizados podem consultar substitutos.' },
			{ status: 403 }
		);
	}

	// Pool de candidatos (subgrupo do evento, com fallback para membros ativos da equipe)
	let candidatosBase: Array<{ personId: string; nome: string }> = [];
	if (registro.groupId) {
		candidatosBase = await banco
			.select({ personId: personTable.id, nome: personTable.fullName })
			.from(groupMember)
			.innerJoin(personTable, eq(personTable.id, groupMember.personId))
			.where(
				and(
					eq(groupMember.groupId, registro.groupId),
					eq(personTable.teamId, actor.teamId),
					isNull(personTable.deletedAt),
					naoEhMaster(personTable.id)
				)
			);
	}

	if (candidatosBase.filter((c) => c.personId !== registro.personId).length === 0) {
		candidatosBase = await banco
			.select({ personId: personTable.id, nome: personTable.fullName })
			.from(personTable)
			.where(
				and(
					eq(personTable.teamId, actor.teamId),
					isNull(personTable.deletedAt),
					naoEhMaster(personTable.id)
				)
			);
	}

	// Quem já está escalado no mesmo evento (se já estiver na MESMA responsabilidade, não pode repetir)
	const existentesNoEvento = await banco
		.select({
			personId: escala.personId,
			responsabilidadeId: escala.responsabilidadeId
		})
		.from(escala)
		.where(and(eq(escala.eventId, registro.eventId), ne(escala.status, 'trocada')));

	const jaNaMesmaResp = new Set(
		existentesNoEvento
			.filter((e) => e.responsabilidadeId === registro.responsabilidadeId)
			.map((e) => e.personId)
	);
	const jaEscaladosNoEvento = new Set(
		existentesNoEvento
			.filter((e) => e.responsabilidadeId !== registro.responsabilidadeId)
			.map((e) => e.personId)
	);

	const candidatosFiltrados = candidatosBase.filter(
		(c) => c.personId === registro.personId || !jaNaMesmaResp.has(c.personId)
	);

	const candidatoIds = candidatosFiltrados.map((c) => c.personId);

	// RSVP do evento
	const opcoesEvento = Array.isArray(registro.rsvpOptions)
		? (registro.rsvpOptions as OpcaoRsvp[])
		: [];
	const chavesConfirmam = chavesQueConfirmam(opcoesEvento);

	const rsvps =
		candidatoIds.length > 0
			? await banco
					.select({ personId: eventRegistration.personId, option: eventRegistration.option })
					.from(eventRegistration)
					.where(
						and(
							eq(eventRegistration.eventId, registro.eventId),
							inArray(eventRegistration.personId, candidatoIds)
						)
					)
			: [];
	const mapaRsvp = new Map(
		rsvps.map((r) => [r.personId, classificarRsvpParaEscala(r.option, chavesConfirmam)])
	);

	// Frequência de presença efetiva nos últimos 90 dias
	const dataEvento = new Date(registro.startsAt);
	const janela90dInicio = new Date(Math.min(Date.now(), dataEvento.getTime()) - 90 * MS_POR_DIA);

	const presencas90d =
		candidatoIds.length > 0
			? await banco
					.select({ personId: presence.personId })
					.from(presence)
					.where(
						and(
							inArray(presence.personId, candidatoIds),
							inArray(presence.status, ['present', 'late']),
							gte(presence.registeredAt, janela90dInicio)
						)
					)
			: [];

	const mapaFrequencia90d = new Map<string, number>();
	for (const p of presencas90d) {
		mapaFrequencia90d.set(p.personId, (mapaFrequencia90d.get(p.personId) ?? 0) + 1);
	}

	// Histórico oficial (confirmadas ou cumpridas)
	const historico = await banco
		.select({
			personId: escala.personId,
			responsabilidadeId: escala.responsabilidadeId,
			eventoInicio: eventTable.startsAt
		})
		.from(escala)
		.innerJoin(eventTable, eq(eventTable.id, escala.eventId))
		.where(
			and(eq(eventTable.teamId, actor.teamId), inArray(escala.status, ['confirmada', 'cumprida']))
		);

	const substitutos = sugerirSubstitutos({
		dataEvento,
		responsabilidade: {
			id: registro.responsabilidadeId,
			nome: registro.respNome,
			intervaloMinimoDias: registro.respIntervalo,
			ordem: registro.respOrdem
		},
		candidatos: candidatosFiltrados.map((c) => ({
			personId: c.personId,
			nome: c.nome,
			rsvp: mapaRsvp.get(c.personId) ?? null,
			frequencia90d: mapaFrequencia90d.get(c.personId) ?? 0
		})),
		historico: historico.map((h) => ({
			personId: h.personId,
			responsabilidadeId: h.responsabilidadeId,
			eventoInicio: new Date(h.eventoInicio)
		})),
		pessoaAtualId: registro.personId,
		jaEscaladosNoEvento,
		limite: 3
	});

	return json({ ok: true, substitutos });
};
