import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { event, eventType } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { opcoesRsvpSchema, validarPeriodo, validarReferencias } from '$server/eventos/regras';

const criarEventoSchema = z.object({
	eventTypeId: z.string().uuid(),
	title: z.string().trim().min(1).max(200),
	description: z.string().trim().max(2000).optional(),
	startsAt: z.string().datetime(),
	endsAt: z.string().datetime().optional(),
	location: z.string().trim().max(200).optional(),
	responsiblePersonId: z.string().uuid().optional(),
	groupId: z.string().uuid().optional(),
	rsvpEnabled: z.boolean().default(true),
	rsvpOptions: opcoesRsvpSchema.optional()
});

/**
 * Lista eventos da equipe da pessoa autenticada.
 */
export const GET = async ({ request, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeVer =
		can(actor, 'event.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'event.view').length > 0;
	if (!podeVer) {
		return json({ erro: 'Sem permissão para ver eventos.' }, { status: 403 });
	}

	const tipo = url.searchParams.get('tipo');
	const grupoId = url.searchParams.get('grupo');

	const where = [eq(event.teamId, actor.teamId)];
	if (tipo && isUuid(tipo)) where.push(eq(event.eventTypeId, tipo));
	if (grupoId && isUuid(grupoId)) where.push(eq(event.groupId, grupoId));

	const eventos = await banco
		.select({
			id: event.id,
			title: event.title,
			description: event.description,
			startsAt: event.startsAt,
			endsAt: event.endsAt,
			location: event.location,
			status: event.status,
			cancelReason: event.cancelReason,
			rsvpEnabled: event.rsvpEnabled,
			rsvpOptions: event.rsvpOptions,
			eventTypeId: event.eventTypeId,
			groupId: event.groupId,
			responsiblePersonId: event.responsiblePersonId,
			createdAt: event.createdAt
		})
		.from(event)
		.where(and(...where))
		.orderBy(asc(event.startsAt));

	const tipos = await banco
		.select({ id: eventType.id, name: eventType.name, color: eventType.color })
		.from(eventType)
		.where(eq(eventType.teamId, actor.teamId));

	const tiposMap = new Map(tipos.map((t) => [t.id, t]));

	return json({
		podeCriar: can(actor, 'event.manage') || groupsWhere(actor, 'event.manage').length > 0,
		eventos: eventos.map((e) => ({
			id: e.id,
			title: e.title,
			description: e.description,
			startsAt: e.startsAt,
			endsAt: e.endsAt,
			location: e.location,
			status: e.status,
			cancelReason: e.cancelReason,
			rsvpEnabled: e.rsvpEnabled,
			rsvpOptions: e.rsvpOptions,
			eventType: tiposMap.get(e.eventTypeId) ?? null,
			groupId: e.groupId,
			responsiblePersonId: e.responsiblePersonId,
			createdAt: e.createdAt
		}))
	});
};

/**
 * Cria um novo evento. Exige `event.manage` (global ou no escopo do grupo do evento).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarEventoSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const { actor } = auth;
	const { groupId, eventTypeId, startsAt, endsAt } = resultado.data;

	if (!can(actor, 'event.manage', { groupId: groupId ?? null })) {
		return json(
			{ erro: 'Apenas líderes e conselheiros autorizados podem criar eventos.' },
			{ status: 403 }
		);
	}

	const inicio = new Date(startsAt);
	const fim = endsAt ? new Date(endsAt) : null;
	const erroRegra =
		validarPeriodo(inicio, fim) ??
		(await validarReferencias(banco, actor.teamId, {
			eventTypeId,
			exigirTipoAtivo: true,
			groupId: groupId ?? null,
			responsiblePersonId: resultado.data.responsiblePersonId ?? null
		}));
	if (erroRegra) {
		return json({ erro: erroRegra.erro }, { status: erroRegra.status });
	}

	const [novoEvento] = await banco
		.insert(event)
		.values({
			teamId: actor.teamId,
			eventTypeId,
			title: resultado.data.title,
			description: resultado.data.description || null,
			startsAt: inicio,
			endsAt: fim,
			location: resultado.data.location || null,
			responsiblePersonId: resultado.data.responsiblePersonId ?? actor.personId,
			groupId: groupId ?? null,
			rsvpEnabled: resultado.data.rsvpEnabled,
			...(resultado.data.rsvpOptions ? { rsvpOptions: resultado.data.rsvpOptions } : {})
		})
		.returning();

	if (!novoEvento) {
		return json({ erro: 'Não foi possível criar o evento.' }, { status: 500 });
	}

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'event.criado',
		entity: 'event',
		entityId: novoEvento.id,
		after: {
			title: novoEvento.title,
			startsAt: novoEvento.startsAt,
			groupId: novoEvento.groupId,
			eventTypeId: novoEvento.eventTypeId
		}
	});

	return json(
		{
			ok: true,
			evento: {
				id: novoEvento.id,
				title: novoEvento.title,
				startsAt: novoEvento.startsAt,
				endsAt: novoEvento.endsAt,
				location: novoEvento.location,
				status: novoEvento.status,
				rsvpEnabled: novoEvento.rsvpEnabled,
				rsvpOptions: novoEvento.rsvpOptions,
				createdAt: novoEvento.createdAt
			}
		},
		{ status: 201 }
	);
};
