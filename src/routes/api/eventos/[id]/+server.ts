import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '$server/db';
import { event, eventRegistration, eventType, person, personProfile } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

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

	const [tipo] = await banco
		.select({ id: eventType.id, name: eventType.name, color: eventType.color })
		.from(eventType)
		.where(eq(eventType.id, evento.eventTypeId))
		.limit(1);

	const podeVerSensivel = can(actor, 'person.view_sensitive', { groupId: evento.groupId });

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
			rsvpEnabled: evento.rsvpEnabled,
			rsvpOptions: evento.rsvpOptions,
			eventType: tipo ?? null,
			groupId: evento.groupId,
			responsiblePersonId: evento.responsiblePersonId,
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
