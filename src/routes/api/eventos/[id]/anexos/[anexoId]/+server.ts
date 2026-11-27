import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$server/db';
import { event as eventTable, eventAttachment, fileAsset } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { audit } from '$server/audit/log';

/**
 * Remove um anexo vinculado a um evento e o arquivo correspondente.
 */
export const DELETE = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const eventoId = params.id;
	const anexoId = params.anexoId;
	if (!isUuid(eventoId) || !isUuid(anexoId)) {
		return json({ erro: 'Identificador inválido.' }, { status: 400 });
	}

	const [evento] = await banco
		.select({
			id: eventTable.id,
			groupId: eventTable.groupId
		})
		.from(eventTable)
		.where(and(eq(eventTable.id, eventoId), eq(eventTable.teamId, actor.teamId)))
		.limit(1);

	if (!evento) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (!can(actor, 'event.manage', { groupId: evento.groupId })) {
		return json({ erro: 'Sem permissão para remover anexos deste evento.' }, { status: 403 });
	}

	const [anexo] = await banco
		.select({
			id: eventAttachment.id,
			fileAssetId: eventAttachment.fileAssetId,
			titulo: eventAttachment.title,
			filename: fileAsset.filename,
			mimeType: fileAsset.mimeType,
			sizeBytes: fileAsset.sizeBytes
		})
		.from(eventAttachment)
		.innerJoin(fileAsset, eq(fileAsset.id, eventAttachment.fileAssetId))
		.where(and(eq(eventAttachment.id, anexoId), eq(eventAttachment.eventId, evento.id)))
		.limit(1);

	if (!anexo) {
		return json({ erro: 'Anexo não encontrado.' }, { status: 404 });
	}

	await banco.transaction(async (tx) => {
		await tx
			.delete(eventAttachment)
			.where(and(eq(eventAttachment.id, anexo.id), eq(eventAttachment.eventId, evento.id)));

		await tx
			.delete(fileAsset)
			.where(and(eq(fileAsset.id, anexo.fileAssetId), eq(fileAsset.teamId, actor.teamId)));
	});

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'event.anexo_removido',
		entity: 'event_attachment',
		entityId: anexo.id,
		before: {
			eventId: evento.id,
			fileAssetId: anexo.fileAssetId,
			titulo: anexo.titulo,
			filename: anexo.filename,
			mimeType: anexo.mimeType,
			sizeBytes: anexo.sizeBytes
		},
		userAgent: request.headers.get('user-agent')
	});

	return json({ ok: true, mensagem: 'Anexo removido.' });
};
