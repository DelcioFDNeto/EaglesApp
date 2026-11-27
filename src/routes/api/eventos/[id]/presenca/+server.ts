import { json } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull, notExists, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	event,
	eventRegistration,
	groupMember,
	person,
	personProfile,
	personRole,
	presence,
	role
} from '$server/db/schema';
import { lerOpcoes } from '$server/eventos/regras';
import { naoEhMaster } from '$server/lideranca/regras';
import { chavesQueConfirmam } from '$shared/rsvp';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

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
		.select({
			id: event.id,
			teamId: event.teamId,
			groupId: event.groupId,
			rsvpOptions: event.rsvpOptions
		})
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
			inscritosSemPresenca: [],
			paraChamada: []
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

	const confirmam = chavesQueConfirmam(lerOpcoes(evento.rsvpOptions));
	const totalConfirmadosRsvp = inscricoesTodas.filter((i) => confirmam.has(i.option)).length;

	/**
	 * Chamada: todo mundo que pode ter vindo e ainda não foi marcado.
	 *   - Num encontro da equipe toda (como os PGs): todos os membros ativos dos
	 *     Eagles e qualquer visitante/recorrente que respondeu ao RSVP.
	 *   - Num encontro de subgrupo específico: os integrantes do subgrupo e quem
	 *     respondeu ao RSVP.
	 * Quem veio sem responder também precisa poder ser marcado: a lista não
	 * pode depender de a pessoa ter usado o app antes.
	 */
	const semPresenca = notExists(
		banco
			.select({ id: presence.id })
			.from(presence)
			.where(and(eq(presence.eventId, eventoId), eq(presence.personId, person.id)))
	);
	const membrosAtivosDaEquipe = or(
		inArray(
			person.id,
			banco
				.select({ id: personProfile.personId })
				.from(personProfile)
				.where(inArray(personProfile.status, ['membro', 'conselheiro', 'lider']))
		),
		and(
			notExists(
				banco
					.select({ id: personProfile.id })
					.from(personProfile)
					.where(eq(personProfile.personId, person.id))
			),
			inArray(
				person.id,
				banco
					.select({ id: personRole.personId })
					.from(personRole)
					.innerJoin(role, eq(role.id, personRole.roleId))
					.where(
						and(
							eq(role.teamId, actor.teamId),
							inArray(role.key, ['membro', 'conselheiro', 'lider'])
						)
					)
			)
		)
	);
	const candidatos = or(
		inArray(
			person.id,
			banco
				.select({ id: eventRegistration.personId })
				.from(eventRegistration)
				.where(eq(eventRegistration.eventId, eventoId))
		),
		evento.groupId
			? inArray(
					person.id,
					banco
						.select({ id: groupMember.personId })
						.from(groupMember)
						.where(eq(groupMember.groupId, evento.groupId))
				)
			: membrosAtivosDaEquipe
	);
	const paraChamada = await banco
		.select({
			id: person.id,
			nome: person.fullName,
			rsvpOption: eventRegistration.option
		})
		.from(person)
		.leftJoin(
			eventRegistration,
			and(eq(eventRegistration.eventId, eventoId), eq(eventRegistration.personId, person.id))
		)
		.where(
			and(
				eq(person.teamId, actor.teamId),
				isNull(person.deletedAt),
				naoEhMaster(person.id),
				candidatos,
				semPresenca
			)
		)
		.orderBy(asc(person.fullName));
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
		paraChamada: paraChamada.map((p) => ({
			id: p.id,
			nome: p.nome,
			rsvpOption: p.rsvpOption,
			confirmou: p.rsvpOption ? confirmam.has(p.rsvpOption) : false
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

const desmarcarSchema = z.object({ personId: z.string().uuid() }).strict();

/**
 * Desfaz um registro de presença (toque errado na chamada). A pessoa volta
 * para a lista de chamada. Exige `attendance.record` no PG do evento.
 */
export const DELETE = async ({ request, params, locals }) => {
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

	const parsed = desmarcarSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ erro: 'Informe a pessoa.' }, { status: 400 });
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

	await banco
		.delete(presence)
		.where(and(eq(presence.eventId, eventoId), eq(presence.personId, parsed.data.personId)));

	return json({ ok: true, mensagem: 'Registro desfeito.' });
};
