import { json } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	event,
	eventRegistration,
	eventType,
	group,
	person,
	personProfile,
	presence
} from '$server/db/schema';
import { autenticarAtor, flagAtiva, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import {
	STATUS_EVENTO,
	lerOpcoes,
	opcoesRsvpSchema,
	validarPeriodo,
	validarReferencias,
	validarTrocaDeOpcoes
} from '$server/eventos/regras';

/**
 * Retorna o detalhe de um evento com rsvpOptions, inscrições e contexto da pessoa autenticada.
 */
export const GET = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const eventoId = params.id;
	if (!isUuid(eventoId)) {
		return json({ erro: 'Identificador de evento inválido.' }, { status: 400 });
	}

	const [evento] = await banco
		.select({
			id: event.id,
			teamId: event.teamId,
			title: event.title,
			description: event.description,
			startsAt: event.startsAt,
			endsAt: event.endsAt,
			location: event.location,
			status: event.status,
			cancelledAt: event.cancelledAt,
			cancelledByPersonId: event.cancelledByPersonId,
			cancelReason: event.cancelReason,
			rsvpEnabled: event.rsvpEnabled,
			rsvpOptions: event.rsvpOptions,
			eventTypeId: event.eventTypeId,
			groupId: event.groupId,
			responsiblePersonId: event.responsiblePersonId,
			createdAt: event.createdAt
		})
		.from(event)
		.where(and(eq(event.id, eventoId), eq(event.teamId, actor.teamId)))
		.limit(1);

	if (!evento) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (!can(actor, 'event.view', { groupId: evento.groupId, personId: actor.personId })) {
		return json({ erro: 'Sem permissão para ver este evento.' }, { status: 403 });
	}

	const [[tipo], grupoRow, checkinQrAtivo, [minhaPresenca]] = await Promise.all([
		banco
			.select({
				id: eventType.id,
				name: eventType.name,
				slug: eventType.slug,
				color: eventType.color
			})
			.from(eventType)
			.where(eq(eventType.id, evento.eventTypeId))
			.limit(1),
		evento.groupId
			? banco
					.select({ id: group.id, name: group.name })
					.from(group)
					.where(eq(group.id, evento.groupId))
					.limit(1)
					.then((rows) => rows[0] ?? null)
			: Promise.resolve(null),
		flagAtiva(banco, actor.teamId, 'checkin_qrcode'),
		banco
			.select({
				id: presence.id,
				status: presence.status,
				registrationMethod: presence.registrationMethod,
				registeredAt: presence.registeredAt
			})
			.from(presence)
			.where(and(eq(presence.eventId, eventoId), eq(presence.personId, actor.personId)))
			.limit(1)
	]);

	const meuCheckin =
		minhaPresenca && (minhaPresenca.status === 'present' || minhaPresenca.status === 'late')
			? {
					id: minhaPresenca.id,
					status: minhaPresenca.status,
					metodo: minhaPresenca.registrationMethod,
					registradoEm: minhaPresenca.registeredAt
				}
			: null;

	const podeVerSensivel = can(actor, 'person.view_sensitive', { groupId: evento.groupId });

	const idsComNome = [evento.responsiblePersonId, evento.cancelledByPersonId].filter(
		(id): id is string => id !== null
	);
	const nomes = new Map(
		idsComNome.length === 0
			? []
			: (
					await banco
						.select({ id: person.id, nome: person.fullName })
						.from(person)
						.where(inArray(person.id, idsComNome))
				).map((p) => [p.id, p.nome])
	);
	const nomeDe = (id: string | null) => (id ? (nomes.get(id) ?? null) : null);

	const inscricoes = await banco
		.select({
			id: eventRegistration.id,
			option: eventRegistration.option,
			guests: eventRegistration.guests,
			notes: eventRegistration.notes,
			createdAt: eventRegistration.createdAt,
			updatedAt: eventRegistration.updatedAt,
			personId: person.id,
			nome: person.fullName,
			telefone: personProfile.phone,
			whatsapp: personProfile.whatsapp,
			status: personProfile.status
		})
		.from(eventRegistration)
		.innerJoin(person, eq(person.id, eventRegistration.personId))
		.leftJoin(personProfile, eq(personProfile.personId, person.id))
		.where(eq(eventRegistration.eventId, eventoId))
		.orderBy(asc(person.fullName));

	const minha = inscricoes.find((i) => i.personId === actor.personId) ?? null;

	return json({
		evento: {
			id: evento.id,
			title: evento.title,
			description: evento.description,
			startsAt: evento.startsAt,
			endsAt: evento.endsAt,
			location: evento.location,
			status: evento.status,
			cancelamento: evento.cancelledAt
				? {
						em: evento.cancelledAt,
						por: nomeDe(evento.cancelledByPersonId),
						motivo: evento.cancelReason
					}
				: null,
			rsvpEnabled: evento.rsvpEnabled,
			rsvpOptions: evento.rsvpOptions,
			eventTypeId: evento.eventTypeId,
			eventType: tipo ?? null,
			groupId: evento.groupId,
			grupoNome: grupoRow?.name ?? null,
			responsiblePersonId: evento.responsiblePersonId,
			responsavelNome: nomeDe(evento.responsiblePersonId),
			createdAt: evento.createdAt
		},
		minhaInscricao: minha
			? {
					id: minha.id,
					option: minha.option,
					guests: minha.guests,
					notes: minha.notes,
					updatedAt: minha.updatedAt
				}
			: null,
		checkinQrAtivo,
		meuCheckin,
		permissoesEvento: {
			podeGerenciarEvento: can(actor, 'event.manage', { groupId: evento.groupId }),
			podeRegistrarPresenca: can(actor, 'attendance.record', { groupId: evento.groupId }),
			podeVerRelatorio: can(actor, 'attendance.report', { groupId: evento.groupId }),
			podeGerenciarEscala: can(actor, 'responsibility.manage', { groupId: evento.groupId })
		},
		inscricoes: inscricoes.map((i) => ({
			id: i.id,
			option: i.option,
			guests: i.guests,
			notes: i.notes,
			createdAt: i.createdAt,
			person: {
				id: i.personId,
				nome: i.nome,
				telefone: podeVerSensivel || i.personId === actor.personId ? i.telefone : null,
				whatsapp: podeVerSensivel || i.personId === actor.personId ? i.whatsapp : null,
				status: i.status
			}
		}))
	});
};

const editarEventoSchema = z
	.object({
		eventTypeId: z.string().uuid(),
		title: z.string().trim().min(1).max(200),
		description: z.string().trim().max(2000).nullable(),
		startsAt: z.string().datetime(),
		endsAt: z.string().datetime().nullable(),
		location: z.string().trim().max(200).nullable(),
		responsiblePersonId: z.string().uuid().nullable(),
		groupId: z.string().uuid().nullable(),
		status: z.enum(STATUS_EVENTO),
		motivoCancelamento: z.string().trim().max(500).nullable(),
		rsvpEnabled: z.boolean(),
		rsvpOptions: opcoesRsvpSchema
	})
	.partial()
	.strict();

/** Campos comparados para a auditoria: só o que mudou entra em before/after. */
const CAMPOS_AUDITADOS = [
	'eventTypeId',
	'title',
	'description',
	'startsAt',
	'endsAt',
	'location',
	'responsiblePersonId',
	'groupId',
	'status',
	'cancelReason',
	'rsvpEnabled',
	'rsvpOptions'
] as const;

function comparavel(v: unknown): string {
	return JSON.stringify(v instanceof Date ? v.toISOString() : (v ?? null));
}

/**
 * Edita, cancela ou reativa um evento.
 *
 * Exige `event.manage` no grupo atual do evento e, se ele mudar de grupo,
 * também no grupo de destino: um conselheiro não tira um evento do PG de
 * outro, nem põe um evento seu no PG de outro.
 *
 * Cancelar (`status: 'cancelled'`) não apaga nada: as respostas de presença
 * continuam no histórico. Por isso não existe DELETE de evento.
 */
export const PATCH = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const eventoId = params.id;
	if (!isUuid(eventoId)) {
		return json({ erro: 'Identificador de evento inválido.' }, { status: 400 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = editarEventoSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}
	const dados = resultado.data;

	const [atual] = await banco
		.select()
		.from(event)
		.where(and(eq(event.id, eventoId), eq(event.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	const mudaGrupo = dados.groupId !== undefined && dados.groupId !== atual.groupId;
	if (
		!can(actor, 'event.manage', { groupId: atual.groupId }) ||
		(mudaGrupo && !can(actor, 'event.manage', { groupId: dados.groupId ?? null }))
	) {
		return json({ erro: 'Sem permissão para editar este evento.' }, { status: 403 });
	}

	const inicio = dados.startsAt !== undefined ? new Date(dados.startsAt) : atual.startsAt;
	const fim =
		dados.endsAt !== undefined ? (dados.endsAt ? new Date(dados.endsAt) : null) : atual.endsAt;

	const mudaTipo = dados.eventTypeId !== undefined && dados.eventTypeId !== atual.eventTypeId;
	const mudaResponsavel =
		dados.responsiblePersonId !== undefined &&
		dados.responsiblePersonId !== atual.responsiblePersonId;

	const erroRegra =
		validarPeriodo(inicio, fim) ??
		(await validarReferencias(banco, actor.teamId, {
			eventTypeId: mudaTipo ? dados.eventTypeId : undefined,
			exigirTipoAtivo: true,
			groupId: mudaGrupo ? dados.groupId : undefined,
			responsiblePersonId: mudaResponsavel ? dados.responsiblePersonId : undefined
		})) ??
		(dados.rsvpOptions
			? await validarTrocaDeOpcoes(banco, atual.id, lerOpcoes(atual.rsvpOptions), dados.rsvpOptions)
			: null);
	if (erroRegra) {
		return json({ erro: erroRegra.erro }, { status: erroRegra.status });
	}

	const novoStatus = dados.status ?? atual.status;
	const cancelando = novoStatus === 'cancelled' && atual.status !== 'cancelled';
	const reativando = novoStatus !== 'cancelled' && atual.status === 'cancelled';
	const ajustandoMotivo =
		!cancelando && novoStatus === 'cancelled' && dados.motivoCancelamento !== undefined;

	const mudancas: Partial<typeof event.$inferInsert> = { status: novoStatus };
	if (dados.eventTypeId !== undefined) mudancas.eventTypeId = dados.eventTypeId;
	if (dados.title !== undefined) mudancas.title = dados.title;
	if (dados.description !== undefined) mudancas.description = dados.description || null;
	if (dados.startsAt !== undefined) mudancas.startsAt = inicio;
	if (dados.endsAt !== undefined) mudancas.endsAt = fim;
	if (dados.location !== undefined) mudancas.location = dados.location || null;
	if (dados.responsiblePersonId !== undefined)
		mudancas.responsiblePersonId = dados.responsiblePersonId;
	if (dados.groupId !== undefined) mudancas.groupId = dados.groupId;
	if (dados.rsvpEnabled !== undefined) mudancas.rsvpEnabled = dados.rsvpEnabled;
	if (dados.rsvpOptions !== undefined) mudancas.rsvpOptions = dados.rsvpOptions;
	if (cancelando) {
		mudancas.cancelledAt = new Date();
		mudancas.cancelledByPersonId = actor.personId;
		mudancas.cancelReason = dados.motivoCancelamento || null;
	}
	if (reativando) {
		mudancas.cancelledAt = null;
		mudancas.cancelledByPersonId = null;
		mudancas.cancelReason = null;
	}
	if (ajustandoMotivo) mudancas.cancelReason = dados.motivoCancelamento || null;

	const antes: Record<string, unknown> = {};
	const depois: Record<string, unknown> = {};
	for (const campo of CAMPOS_AUDITADOS) {
		if (!(campo in mudancas)) continue;
		const valorNovo = mudancas[campo];
		if (comparavel(atual[campo]) !== comparavel(valorNovo)) {
			antes[campo] = atual[campo];
			depois[campo] = valorNovo;
		}
	}

	if (Object.keys(depois).length === 0) {
		return json({ ok: true, alterado: false, mensagem: 'Nada mudou.' });
	}

	const [atualizado] = await banco
		.update(event)
		.set({ ...mudancas, updatedAt: new Date() })
		.where(eq(event.id, atual.id))
		.returning();

	if (!atualizado) {
		return json({ erro: 'Não foi possível salvar o evento.' }, { status: 500 });
	}

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: cancelando ? 'event.cancelado' : reativando ? 'event.reativado' : 'event.atualizado',
		entity: 'event',
		entityId: atual.id,
		before: antes,
		after: depois
	});

	return json({
		ok: true,
		alterado: true,
		mensagem: cancelando
			? 'Evento cancelado. As respostas de presença continuam guardadas.'
			: reativando
				? 'Evento reativado.'
				: 'Evento atualizado.',
		evento: {
			id: atualizado.id,
			title: atualizado.title,
			startsAt: atualizado.startsAt,
			endsAt: atualizado.endsAt,
			status: atualizado.status,
			cancelReason: atualizado.cancelReason
		}
	});
};
