import { json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$server/db';
import { event as eventTable, eventAttachment, fileAsset } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { lerEntradaUpload, validarArquivo } from '$server/arquivos/validacao';

/**
 * Lista os anexos de um evento (roteiros, avisos em PDF, mapas em imagem).
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
			id: eventTable.id,
			groupId: eventTable.groupId
		})
		.from(eventTable)
		.where(and(eq(eventTable.id, eventoId), eq(eventTable.teamId, actor.teamId)))
		.limit(1);

	if (!evento) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (!can(actor, 'event.view', { groupId: evento.groupId, personId: actor.personId })) {
		return json({ erro: 'Sem permissão para ver os anexos deste evento.' }, { status: 403 });
	}

	const linhas = await banco
		.select({
			id: eventAttachment.id,
			fileAssetId: eventAttachment.fileAssetId,
			titulo: eventAttachment.title,
			filename: fileAsset.filename,
			mimeType: fileAsset.mimeType,
			sizeBytes: fileAsset.sizeBytes,
			criadoEm: eventAttachment.createdAt
		})
		.from(eventAttachment)
		.innerJoin(fileAsset, eq(fileAsset.id, eventAttachment.fileAssetId))
		.where(eq(eventAttachment.eventId, evento.id))
		.orderBy(desc(eventAttachment.createdAt));

	return json({
		anexos: linhas.map((a) => ({
			id: a.id,
			fileAssetId: a.fileAssetId,
			titulo: a.titulo,
			url: `/api/arquivos/${a.fileAssetId}`,
			filename: a.filename,
			mimeType: a.mimeType,
			sizeBytes: a.sizeBytes,
			criadoEm: a.criadoEm
		}))
	});
};

/**
 * Adiciona um anexo (PDF ou imagem até 3 MB) a um evento.
 * Aceita `multipart/form-data` (`file`, `titulo?`) ou JSON (`{ filename, mimeType?, dataBase64, titulo? }`).
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
		return json({ erro: 'Sem permissão para adicionar anexos a este evento.' }, { status: 403 });
	}

	const entrada = await lerEntradaUpload(request);
	if (!entrada.ok) {
		return json({ erro: entrada.erro }, { status: 400 });
	}

	const validado = validarArquivo({
		bytes: entrada.bytes,
		filename: entrada.filename,
		mimeType: entrada.mimeType,
		scope: 'evento_anexo'
	});

	if (!validado.ok) {
		return json({ erro: validado.erro }, { status: 400 });
	}

	const tituloBruto = entrada.titulo?.trim() ?? '';
	if (tituloBruto.length > 160) {
		return json({ erro: 'O título do anexo deve ter no máximo 160 caracteres.' }, { status: 400 });
	}
	const titulo = tituloBruto || validado.filename;

	const resultado = await banco.transaction(async (tx) => {
		const [arquivo] = await tx
			.insert(fileAsset)
			.values({
				teamId: actor.teamId,
				scope: 'evento_anexo',
				ownerPersonId: null,
				filename: validado.filename,
				mimeType: validado.mimeType,
				sizeBytes: validado.sizeBytes,
				dataBase64: validado.dataBase64,
				uploadedByPersonId: actor.personId
			})
			.returning({
				id: fileAsset.id,
				filename: fileAsset.filename,
				mimeType: fileAsset.mimeType,
				sizeBytes: fileAsset.sizeBytes
			});

		if (!arquivo) return null;

		const [anexo] = await tx
			.insert(eventAttachment)
			.values({
				eventId: evento.id,
				fileAssetId: arquivo.id,
				title: titulo,
				uploadedByPersonId: actor.personId
			})
			.returning({
				id: eventAttachment.id,
				title: eventAttachment.title,
				createdAt: eventAttachment.createdAt
			});

		if (!anexo) return null;
		return { arquivo, anexo };
	});

	if (!resultado) {
		return json({ erro: 'Não foi possível salvar o anexo.' }, { status: 500 });
	}

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'event.anexo_adicionado',
		entity: 'event_attachment',
		entityId: resultado.anexo.id,
		after: {
			eventId: evento.id,
			fileAssetId: resultado.arquivo.id,
			titulo: resultado.anexo.title,
			filename: resultado.arquivo.filename,
			mimeType: resultado.arquivo.mimeType,
			sizeBytes: resultado.arquivo.sizeBytes
		},
		userAgent: request.headers.get('user-agent')
	});

	return json(
		{
			ok: true,
			anexo: {
				id: resultado.anexo.id,
				fileAssetId: resultado.arquivo.id,
				titulo: resultado.anexo.title,
				url: `/api/arquivos/${resultado.arquivo.id}`,
				filename: resultado.arquivo.filename,
				mimeType: resultado.arquivo.mimeType,
				sizeBytes: resultado.arquivo.sizeBytes,
				criadoEm: resultado.anexo.createdAt
			}
		},
		{ status: 201 }
	);
};
