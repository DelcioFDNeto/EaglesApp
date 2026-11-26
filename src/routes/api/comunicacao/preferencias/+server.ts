import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { notificationPreference } from '$server/db/schema';
import { autenticarAtor, flagAtiva } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const preferenciasSchema = z.object({
	announcementsEnabled: z.boolean(),
	eventRemindersEnabled: z.boolean(),
	rsvpRemindersEnabled: z.boolean(),
	responsibilityRemindersEnabled: z.boolean(),
	quietStartHour: z.number().int().min(0).max(23),
	quietEndHour: z.number().int().min(0).max(23)
});

/**
 * Consulta as preferências de notificação da pessoa autenticada (RF-09.4 / F6 / RN-29).
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'person.view', { personId: actor.personId })) {
		return json({ erro: 'Sem permissão para consultar preferências.' }, { status: 403 });
	}

	const [pref] = await banco
		.select()
		.from(notificationPreference)
		.where(eq(notificationPreference.personId, actor.personId))
		.limit(1);

	const notificacoesAtivasNoSistema = await flagAtiva(banco, actor.teamId, 'notificacoes_ativas');

	return json({
		notificacoesAtivasNoSistema,
		preferencias: {
			announcementsEnabled: pref?.announcementsEnabled ?? true,
			eventRemindersEnabled: pref?.eventRemindersEnabled ?? true,
			rsvpRemindersEnabled: pref?.rsvpRemindersEnabled ?? true,
			responsibilityRemindersEnabled: pref?.responsibilityRemindersEnabled ?? true,
			quietStartHour: pref?.quietStartHour ?? 22,
			quietEndHour: pref?.quietEndHour ?? 7
		}
	});
};

/**
 * Salva as preferências de notificação e janela de silêncio da própria pessoa (RF-09.4 / F6).
 */
export const PUT = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'person.view', { personId: actor.personId })) {
		return json({ erro: 'Sem permissão para atualizar preferências.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = preferenciasSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = resultado.data;
	const [existente] = await banco
		.select({ id: notificationPreference.id })
		.from(notificationPreference)
		.where(eq(notificationPreference.personId, actor.personId))
		.limit(1);

	if (existente) {
		await banco
			.update(notificationPreference)
			.set({ ...dados, updatedAt: new Date() })
			.where(eq(notificationPreference.id, existente.id));
	} else {
		await banco.insert(notificationPreference).values({
			personId: actor.personId,
			...dados
		});
	}

	return json({
		ok: true,
		preferencias: dados,
		mensagem: 'Preferências de notificação salvas.'
	});
};
