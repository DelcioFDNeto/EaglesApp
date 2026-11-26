import { json } from '@sveltejs/kit';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { db } from '$server/db';
import { event, eventRegistration, person, personProfile, presence } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const OPCOES_CONFIRMACAO_POSITIVA = ['confirmado', 'atrasado', 'convidado'];

/**
 * Relatório de presença de um evento.
 * Exige `attendance.report` (nunca exposto como ranking entre pares — anti-"o fiscal").
 * Ausência de RSVP ou resposta negativa nunca é tratada como falta (RN-15).
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
		.select({ id: event.id, groupId: event.groupId })
		.from(event)
		.where(and(eq(event.id, eventoId), eq(event.teamId, actor.teamId)))
		.limit(1);

	if (!evento) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (!can(actor, 'attendance.report', { groupId: evento.groupId })) {
		return json({ erro: 'Sem permissão para ver relatórios de presença.' }, { status: 403 });
	}

	const [totalConfirmadosRow] = await banco
		.select({ count: count() })
		.from(eventRegistration)
		.where(
			and(
				eq(eventRegistration.eventId, eventoId),
				inArray(eventRegistration.option, OPCOES_CONFIRMACAO_POSITIVA)
			)
		);

	const [totalPresentRow] = await banco
		.select({ count: count() })
		.from(presence)
		.where(and(eq(presence.eventId, eventoId), eq(presence.status, 'present')));

	const [totalLateRow] = await banco
		.select({ count: count() })
		.from(presence)
		.where(and(eq(presence.eventId, eventoId), eq(presence.status, 'late')));

	const [totalAbsentRow] = await banco
		.select({ count: count() })
		.from(presence)
		.where(and(eq(presence.eventId, eventoId), eq(presence.status, 'absent')));

	const podeVerSensivel = can(actor, 'person.view_sensitive', { groupId: evento.groupId });

	const presencas = await banco
		.select({
			id: presence.id,
			status: presence.status,
			registrationMethod: presence.registrationMethod,
			registeredAt: presence.registeredAt,
			personId: person.id,
			nome: person.fullName,
			telefone: personProfile.phone,
			whatsapp: personProfile.whatsapp,
			rsvpOption: eventRegistration.option
		})
		.from(presence)
		.innerJoin(person, eq(person.id, presence.personId))
		.leftJoin(personProfile, eq(personProfile.personId, person.id))
		.leftJoin(
			eventRegistration,
			and(eq(eventRegistration.eventId, eventoId), eq(eventRegistration.personId, person.id))
		)
		.where(eq(presence.eventId, eventoId))
		.orderBy(asc(person.fullName));

	const totalInscritos = Number(totalConfirmadosRow?.count ?? 0);
	const totalPresent = Number(totalPresentRow?.count ?? 0);
	const totalLate = Number(totalLateRow?.count ?? 0);
	const totalAusentes = Number(totalAbsentRow?.count ?? 0);
	const totalPresencas = totalPresent + totalLate;

	return json({
		eventoId,
		resumo: {
			totalInscritos,
			totalPresencas,
			totalPresent,
			totalLate,
			totalAusentes,
			taxaPresenca:
				totalInscritos > 0 ? Math.min(100, Math.round((totalPresencas / totalInscritos) * 100)) : 0
		},
		presencas: presencas.map((p) => ({
			id: p.id,
			personId: p.personId,
			nome: p.nome,
			telefone: podeVerSensivel ? p.telefone : null,
			whatsapp: podeVerSensivel ? p.whatsapp : null,
			status: p.status,
			metodo: p.registrationMethod,
			registradoEm: p.registeredAt,
			rsvpOption: p.rsvpOption
		}))
	});
};
