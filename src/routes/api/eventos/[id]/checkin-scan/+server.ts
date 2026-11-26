import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { checkinScan, event, eventCheckin, presence } from '$server/db/schema';
import { autenticarAtor, flagAtiva, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const scanSchema = z.object({
	qrCode: z.string().trim().min(1)
});

/**
 * Escaneia um QR Code de check-in e registra a presença da PRÓPRIA pessoa autenticada.
 * Exige feature flag `checkin_qrcode` ligada (RN-14 / RN-29).
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

	if (!(await flagAtiva(banco, actor.teamId, 'checkin_qrcode'))) {
		return json(
			{ erro: 'Check-in por QR Code está desativado nas configurações.' },
			{ status: 403 }
		);
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = scanSchema.safeParse(corpo);
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

	if (!can(actor, 'event.view', { groupId: evento.groupId, personId: actor.personId })) {
		return json({ erro: 'Sem permissão para fazer check-in neste evento.' }, { status: 403 });
	}

	const [checkin] = await banco
		.select()
		.from(eventCheckin)
		.where(
			and(
				eq(eventCheckin.eventId, eventoId),
				eq(eventCheckin.qrCode, resultado.data.qrCode),
				eq(eventCheckin.isActive, true)
			)
		)
		.limit(1);

	if (!checkin) {
		return json({ erro: 'QR Code inválido ou inativo.' }, { status: 400 });
	}

	if (checkin.expiresAt < new Date()) {
		return json({ erro: 'QR Code expirado.' }, { status: 400 });
	}

	const personId = actor.personId;

	await banco.insert(checkinScan).values({
		checkinId: checkin.id,
		personId,
		ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
		userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null
	});

	const [presencaExistente] = await banco
		.select()
		.from(presence)
		.where(and(eq(presence.eventId, eventoId), eq(presence.personId, personId)))
		.limit(1);

	if (presencaExistente) {
		await banco
			.update(presence)
			.set({
				status: 'present',
				registrationMethod: 'qr_code',
				registeredByPersonId: personId,
				registeredAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(presence.id, presencaExistente.id));
	} else {
		await banco.insert(presence).values({
			eventId: eventoId,
			personId,
			status: 'present',
			registrationMethod: 'qr_code',
			registeredByPersonId: personId
		});
	}

	return json({
		ok: true,
		mensagem: 'Check-in realizado com sucesso.',
		personId
	});
};
