import { json } from '@sveltejs/kit';
import { and, asc, eq, notExists } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { event, eventRegistration, person, personProfile, presence } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const OPCOES_CONFIRMACAO_POSITIVA = new Set(['confirmado', 'atrasado', 'convidado']);

const marcarPresencaSchema = z.object({
	personId: z.string().uuid(),
	status: z.enum(['present', 'absent', 'late']).default('present'),
	registrationMethod: z.enum(['manual', 'qr_code', 'self']).default('manual')
});

/**
 * Lista presenças de um evento.
 * - Quem tem `attendance.report` vê lista completa, inscritos pendentes e resumo (RN-15).
 * - Membros comuns (anti-vigilância / persona negativa "o fiscal") veem apenas a própria presença.
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
		.select({ id: event.id, teamId: event.teamId, groupId: event.groupId })
		.from(event)
		.where(and(eq(event.id, eventoId), eq(event.teamId, actor.teamId)))
		.limit(1);

	if (!evento) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (!can(actor, 'attendance.view', { groupId: evento.groupId, personId: actor.personId })) {
		return json({ erro: 'Sem permissão para ver presença neste evento.' }, { status: 403 });
	}

	const podeVerRelatorio = can(actor, 'attendance.report', { groupId: evento.groupId });
	const podeVerSensivel = can(actor, 'person.view_sensitive', { groupId: evento.groupId });

	if (!podeVerRelatorio) {
		const [minhaPresenca] = await banco
			.select({
				id: presence.id,
				personId: presence.personId,
				status: presence.status,
				registrationMethod: presence.registrationMethod,
				registeredAt: presence.registeredAt,
				nome: person.fullName
			})
			.from(presence)
			.innerJoin(person, eq(person.id, presence.personId))
			.where(and(eq(presence.eventId, eventoId), eq(presence.personId, actor.personId)))
			.limit(1);

		return json({
			eventoId,
			escopo: 'self',
			resumo: null,
			presencas: minhaPresenca
				? [
						{
							id: minhaPresenca.id,
							personId: minhaPresenca.personId,
							nome: minhaPresenca.nome,
							telefone: null,
							whatsapp: null,
							status: minhaPresenca.status,
							metodo: minhaPresenca.registrationMethod,
							registradoEm: minhaPresenca.registeredAt
						}
					]
				: [],
			inscritosSemPresenca: []
		});
	}

	const presencas = await banco
		.select({
			id: presence.id,
			status: presence.status,
			registrationMethod: presence.registrationMethod,
			registeredAt: presence.registeredAt,
			registeredByPersonId: presence.registeredByPersonId,
			personId: person.id,
			nome: person.fullName,
			telefone: personProfile.phone,
			whatsapp: personProfile.whatsapp
		})
		.from(presence)
		.innerJoin(person, eq(person.id, presence.personId))
		.leftJoin(personProfile, eq(personProfile.personId, person.id))
		.where(eq(presence.eventId, eventoId))
		.orderBy(asc(person.fullName));

	const inscritosSemPresenca = await banco
		.select({
			id: person.id,
			nome: person.fullName,
			telefone: personProfile.phone,
			whatsapp: personProfile.whatsapp,
			rsvpOption: eventRegistration.option
		})
		.from(eventRegistration)
		.innerJoin(person, eq(person.id, eventRegistration.personId))
		.leftJoin(personProfile, eq(personProfile.personId, person.id))
		.where(
			and(
				eq(eventRegistration.eventId, eventoId),
				notExists(
					banco
						.select({ id: presence.id })
						.from(presence)
						.where(and(eq(presence.eventId, eventoId), eq(presence.personId, person.id)))
				)
			)
		)
		.orderBy(asc(person.fullName));

	const inscricoesTodas = await banco
		.select({ option: eventRegistration.option })
		.from(eventRegistration)
		.where(eq(eventRegistration.eventId, eventoId));

	const totalConfirmadosRsvp = inscricoesTodas.filter((i) =>
		OPCOES_CONFIRMACAO_POSITIVA.has(i.option)
	).length;
	const totalPresent = presencas.filter((p) => p.status === 'present').length;
	const totalLate = presencas.filter((p) => p.status === 'late').length;
	const totalAusentes = presencas.filter((p) => p.status === 'absent').length;
	const totalPresencas = totalPresent + totalLate;

	return json({
		eventoId,
		escopo: 'relatorio',
		resumo: {
			totalInscritos: totalConfirmadosRsvp,
			totalPresencas,
			totalPresent,
			totalLate,
			totalAusentes,
			taxaPresenca:
				totalConfirmadosRsvp > 0
					? Math.min(100, Math.round((totalPresencas / totalConfirmadosRsvp) * 100))
					: 0
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
			registradoPor: p.registeredByPersonId
		})),
		inscritosSemPresenca: inscritosSemPresenca.map((i) => ({
			id: i.id,
			nome: i.nome,
			telefone: podeVerSensivel ? i.telefone : null,
			whatsapp: podeVerSensivel ? i.whatsapp : null,
			rsvpOption: i.rsvpOption
		}))
	});
};

/**
 * Marca presença efetiva de uma pessoa em um evento. Exige `attendance.record`.
 */
export const POST = async ({ request, params, locals }) => {
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

	const resultado = marcarPresencaSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [evento] = await banco
		.select({ id: event.id, groupId: event.groupId })
		.from(event)
		.where(and(eq(event.id, eventoId), eq(event.teamId, actor.teamId)))
		.limit(1);

	if (!evento) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (!can(actor, 'attendance.record', { groupId: evento.groupId })) {
		return json(
			{ erro: 'Apenas líderes e conselheiros podem registrar presença.' },
			{ status: 403 }
		);
	}

	const { personId, status, registrationMethod } = resultado.data;

	const [pessoa] = await banco
		.select({ id: person.id })
		.from(person)
		.where(and(eq(person.id, personId), eq(person.teamId, actor.teamId)))
		.limit(1);

	if (!pessoa) {
		return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });
	}

	const [presencaExistente] = await banco
		.select()
		.from(presence)
		.where(and(eq(presence.eventId, eventoId), eq(presence.personId, personId)))
		.limit(1);

	if (presencaExistente) {
		await banco
			.update(presence)
			.set({
				status,
				registrationMethod,
				registeredByPersonId: actor.personId,
				registeredAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(presence.id, presencaExistente.id));
	} else {
		await banco.insert(presence).values({
			eventId: eventoId,
			personId,
			status,
			registrationMethod,
			registeredByPersonId: actor.personId
		});
	}

	return json({ ok: true, mensagem: 'Presença registrada com sucesso.' });
};
