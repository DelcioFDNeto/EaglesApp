import { json } from '@sveltejs/kit';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { lerOpcoes } from '$server/eventos/regras';
import { chavesQueConfirmam } from '$shared/rsvp';
import { naoEhMaster } from '$server/lideranca/regras';
import { db } from '$server/db';
import {
	event,
	eventRegistration,
	person,
	personProfile,
	presence,
	rsvpHistory
} from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

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
		.select({ id: event.id, groupId: event.groupId, rsvpOptions: event.rsvpOptions })
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
				inArray(eventRegistration.option, [...chavesQueConfirmam(lerOpcoes(evento.rsvpOptions))])
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

	// RN-12: quem mudou de resposta, e como. Só quem trocou ao menos uma vez.
	const respostas = await banco
		.select({
			personId: rsvpHistory.personId,
			nome: person.fullName,
			option: rsvpHistory.option,
			em: rsvpHistory.answeredAt
		})
		.from(rsvpHistory)
		.innerJoin(person, eq(person.id, rsvpHistory.personId))
		.where(and(eq(rsvpHistory.eventId, eventoId), naoEhMaster(person.id)))
		.orderBy(asc(rsvpHistory.answeredAt));

	const porPessoa = new Map<string, { nome: string; respostas: { option: string; em: Date }[] }>();
	for (const r of respostas) {
		const atual = porPessoa.get(r.personId) ?? { nome: r.nome, respostas: [] };
		atual.respostas.push({ option: r.option, em: r.em });
		porPessoa.set(r.personId, atual);
	}
	const mudancasDeResposta = [...porPessoa.entries()]
		.filter(([, v]) => v.respostas.length > 1)
		.map(([personId, v]) => ({ personId, nome: v.nome, respostas: v.respostas }))
		.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

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
		mudancasDeResposta,
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
