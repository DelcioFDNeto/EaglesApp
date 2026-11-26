import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { event, eventRegistration } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const fazerInscricaoSchema = z.object({
	option: z.string().trim().min(1).max(50),
	guests: z.number().int().min(0).max(50).default(0),
	notes: z.string().trim().max(500).optional()
});

/**
 * Registra ou atualiza o RSVP da pessoa autenticada em um evento da sua equipe.
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

	const resultado = fazerInscricaoSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [evento] = await banco
		.select({
			id: event.id,
			groupId: event.groupId,
			rsvpEnabled: event.rsvpEnabled,
			rsvpOptions: event.rsvpOptions,
			status: event.status
		})
		.from(event)
		.where(and(eq(event.id, eventoId), eq(event.teamId, actor.teamId)))
		.limit(1);

	if (!evento) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (!can(actor, 'event.view', { groupId: evento.groupId, personId: actor.personId })) {
		return json({ erro: 'Sem permissão para confirmar presença neste evento.' }, { status: 403 });
	}

	if (!evento.rsvpEnabled || evento.status === 'cancelled') {
		return json({ erro: 'Este evento não aceita confirmações no momento.' }, { status: 400 });
	}

	const opcoesValidas = Array.isArray(evento.rsvpOptions)
		? (evento.rsvpOptions as Array<{ key: string; label: string }>).map((o) => o.key)
		: [];

	const { option, guests, notes } = resultado.data;
	if (opcoesValidas.length > 0 && !opcoesValidas.includes(option)) {
		return json({ erro: 'Opção de participação inválida para este evento.' }, { status: 400 });
	}

	const [inscricaoExistente] = await banco
		.select()
		.from(eventRegistration)
		.where(
			and(eq(eventRegistration.eventId, eventoId), eq(eventRegistration.personId, actor.personId))
		)
		.limit(1);

	if (inscricaoExistente) {
		await banco
			.update(eventRegistration)
			.set({ option, guests, notes: notes ?? null, updatedAt: new Date() })
			.where(eq(eventRegistration.id, inscricaoExistente.id));
	} else {
		await banco.insert(eventRegistration).values({
			eventId: eventoId,
			personId: actor.personId,
			option,
			guests,
			notes: notes ?? null
		});
	}

	return json({ ok: true, mensagem: 'Participação registrada com sucesso.' });
};
