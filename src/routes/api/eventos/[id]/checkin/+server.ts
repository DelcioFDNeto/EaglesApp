import { json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { event, eventCheckin } from '$server/db/schema';
import { autenticarAtor, flagAtiva, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const gerarQrSchema = z.object({
	expiresInMinutes: z.number().int().min(1).max(1440).default(120)
});

/**
 * Obtém o QR Code ativo de check-in do evento.
 * Exige `checkin_qrcode` ligado (RN-14 / RN-29) e permissão `attendance.record`.
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

	if (!(await flagAtiva(banco, actor.teamId, 'checkin_qrcode'))) {
		return json(
			{ erro: 'Check-in por QR Code está desativado nas configurações.' },
			{ status: 403 }
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
			{ erro: 'Apenas líderes e conselheiros podem acessar o QR Code do evento.' },
			{ status: 403 }
		);
	}

	const [qrCode] = await banco
		.select()
		.from(eventCheckin)
		.where(and(eq(eventCheckin.eventId, eventoId), eq(eventCheckin.isActive, true)))
		.orderBy(desc(eventCheckin.createdAt))
		.limit(1);

	if (!qrCode) {
		return json({ erro: 'Nenhum QR Code ativo para este evento.' }, { status: 404 });
	}

	return json({
		qrCode: qrCode.qrCode,
		expiresAt: qrCode.expiresAt,
		isActive: qrCode.isActive,
		createdAt: qrCode.createdAt
	});
};

/**
 * Gera (ou regenera) o QR Code de check-in do evento.
 * Exige `checkin_qrcode` ligado (RN-14 / RN-29) e permissão `attendance.record`.
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

	const [evento] = await banco
		.select({ id: event.id, groupId: event.groupId })
		.from(event)
		.where(and(eq(event.id, eventoId), eq(event.teamId, actor.teamId)))
		.limit(1);

	if (!evento) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (!can(actor, 'attendance.record', { groupId: evento.groupId })) {
		return json({ erro: 'Apenas líderes e conselheiros podem gerar QR Code.' }, { status: 403 });
	}

	let corpo: unknown = {};
	try {
		corpo = await request.json();
	} catch {
		corpo = {};
	}

	const resultado = gerarQrSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const { expiresInMinutes } = resultado.data;

	await banco
		.update(eventCheckin)
		.set({ isActive: false })
		.where(eq(eventCheckin.eventId, eventoId));

	const qrCodeValue = `eagles-checkin-${eventoId}-${crypto.randomUUID()}`;
	const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

	const [novoQrCode] = await banco
		.insert(eventCheckin)
		.values({
			eventId: eventoId,
			qrCode: qrCodeValue,
			expiresAt,
			isActive: true,
			createdByPersonId: actor.personId
		})
		.returning();

	if (!novoQrCode) {
		return json({ erro: 'Não foi possível gerar o QR Code.' }, { status: 500 });
	}

	return json(
		{
			ok: true,
			qrCode: novoQrCode.qrCode,
			expiresAt: novoQrCode.expiresAt,
			isActive: novoQrCode.isActive
		},
		{ status: 201 }
	);
};
