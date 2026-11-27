import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$server/db';
import { event as eventTable, eventAttachment, fileAsset } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { cabecalhoContentDisposition } from '$server/arquivos/validacao';

/**
 * Entrega segura de arquivo autenticado com verificação de equipe e RBAC por escopo.
 */
export const GET = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const arquivoId = params.id;
	if (!isUuid(arquivoId)) {
		return json({ erro: 'Identificador de arquivo inválido.' }, { status: 400 });
	}

	const [row] = await banco
		.select({
			id: fileAsset.id,
			teamId: fileAsset.teamId,
			scope: fileAsset.scope,
			ownerPersonId: fileAsset.ownerPersonId,
			filename: fileAsset.filename,
			mimeType: fileAsset.mimeType,
			sizeBytes: fileAsset.sizeBytes,
			dataBase64: fileAsset.dataBase64,
			uploadedByPersonId: fileAsset.uploadedByPersonId
		})
		.from(fileAsset)
		.where(and(eq(fileAsset.id, arquivoId), eq(fileAsset.teamId, actor.teamId)))
		.limit(1);

	if (!row) {
		return json({ erro: 'Arquivo não encontrado.' }, { status: 404 });
	}

	let autorizado = false;
	if (row.scope === 'perfil_foto') {
		autorizado =
			can(actor, 'person.view') ||
			can(actor, 'person.view', { personId: actor.personId }) ||
			groupsWhere(actor, 'person.view').length > 0;
	} else if (row.scope === 'evento_anexo') {
		autorizado =
			can(actor, 'event.view') ||
			can(actor, 'event.view', { personId: actor.personId }) ||
			groupsWhere(actor, 'event.view').length > 0;
	} else if (row.scope === 'comprovante') {
		autorizado =
			can(actor, 'finance.view_all') ||
			can(actor, 'finance.view_group') ||
			groupsWhere(actor, 'finance.view_group').length > 0 ||
			can(actor, 'finance.view_own', { personId: actor.personId });
	}

	if (!autorizado) {
		return json({ erro: 'Sem permissão para acessar este arquivo.' }, { status: 403 });
	}

	const bytes = Buffer.from(row.dataBase64, 'base64');

	return new Response(bytes, {
		status: 200,
		headers: {
			'Content-Type': row.mimeType,
			'Content-Length': String(bytes.byteLength),
			'X-Content-Type-Options': 'nosniff',
			'Content-Disposition': cabecalhoContentDisposition(row.filename),
			'Cache-Control': 'private, max-age=3600'
		}
	});
};

/**
 * Remove um arquivo enviado pelo próprio autor, pela administração ou (para anexos)
 * por quem gerencia o evento vinculado.
 */
export const DELETE = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const arquivoId = params.id;
	if (!isUuid(arquivoId)) {
		return json({ erro: 'Identificador de arquivo inválido.' }, { status: 400 });
	}

	const [row] = await banco
		.select({
			id: fileAsset.id,
			teamId: fileAsset.teamId,
			scope: fileAsset.scope,
			filename: fileAsset.filename,
			mimeType: fileAsset.mimeType,
			sizeBytes: fileAsset.sizeBytes,
			uploadedByPersonId: fileAsset.uploadedByPersonId
		})
		.from(fileAsset)
		.where(and(eq(fileAsset.id, arquivoId), eq(fileAsset.teamId, actor.teamId)))
		.limit(1);

	if (!row) {
		return json({ erro: 'Arquivo não encontrado.' }, { status: 404 });
	}

	let podeRemover = row.uploadedByPersonId === actor.personId || can(actor, 'settings.manage');

	if (!podeRemover && row.scope === 'evento_anexo') {
		const [vinculo] = await banco
			.select({ groupId: eventTable.groupId })
			.from(eventAttachment)
			.innerJoin(eventTable, eq(eventTable.id, eventAttachment.eventId))
			.where(eq(eventAttachment.fileAssetId, row.id))
			.limit(1);

		podeRemover = vinculo
			? can(actor, 'event.manage', { groupId: vinculo.groupId })
			: can(actor, 'event.manage');
	}

	if (!podeRemover) {
		return json({ erro: 'Sem permissão para remover este arquivo.' }, { status: 403 });
	}

	await banco
		.delete(fileAsset)
		.where(and(eq(fileAsset.id, row.id), eq(fileAsset.teamId, actor.teamId)));

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'file.removido',
		entity: 'file_asset',
		entityId: row.id,
		before: {
			scope: row.scope,
			filename: row.filename,
			mimeType: row.mimeType,
			sizeBytes: row.sizeBytes
		},
		userAgent: request.headers.get('user-agent')
	});

	return json({ ok: true, mensagem: 'Arquivo removido.' });
};
