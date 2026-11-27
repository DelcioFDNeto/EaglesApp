import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$server/db';
import { fileAsset, person, personProfile } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { audit } from '$server/audit/log';
import { validarIdade } from '$server/pessoas/menores';
import { ehEscopoArquivo, lerEntradaUpload, validarArquivo } from '$server/arquivos/validacao';

/**
 * Upload seguro de arquivos (fotos de perfil, comprovantes e anexos de eventos).
 *
 * Aceita tanto `multipart/form-data` (`file`, `scope`) quanto JSON
 * (`{ scope, filename, mimeType?, dataBase64 }`).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const entrada = await lerEntradaUpload(request);
	if (!entrada.ok) {
		return json({ erro: entrada.erro }, { status: 400 });
	}

	if (!ehEscopoArquivo(entrada.scope)) {
		return json(
			{ erro: 'Escopo de arquivo inválido. Use perfil_foto, comprovante ou evento_anexo.' },
			{ status: 400 }
		);
	}

	const scope = entrada.scope;

	// Verificação RBAC por escopo (negação por padrão).
	if (scope === 'perfil_foto') {
		if (!can(actor, 'person.view', { personId: actor.personId })) {
			return json({ erro: 'Sem permissão para enviar foto de perfil.' }, { status: 403 });
		}

		// Regra de idade (ADR 0003 / LGPD): menor de 18 anos sem consentimento do
		// responsável não pode guardar foto de perfil.
		const [[pessoa], [perfil]] = await Promise.all([
			banco
				.select({ birthDate: person.birthDate })
				.from(person)
				.where(eq(person.id, actor.personId))
				.limit(1),
			banco
				.select({ birthDate: personProfile.birthDate })
				.from(personProfile)
				.where(eq(personProfile.personId, actor.personId))
				.limit(1)
		]);

		const dataNascimento = pessoa?.birthDate ?? perfil?.birthDate ?? null;
		const erroIdade = validarIdade(dataNascimento, ['foto'], false);
		if (erroIdade) {
			return json({ erro: erroIdade }, { status: 400 });
		}
	} else if (scope === 'comprovante') {
		const podeFinanceiro =
			can(actor, 'finance.create') || groupsWhere(actor, 'finance.create').length > 0;
		if (!podeFinanceiro) {
			return json({ erro: 'Sem permissão para enviar comprovantes financeiros.' }, { status: 403 });
		}
	} else {
		const podeEvento = can(actor, 'event.manage') || groupsWhere(actor, 'event.manage').length > 0;
		if (!podeEvento) {
			return json({ erro: 'Sem permissão para enviar anexos de evento.' }, { status: 403 });
		}
	}

	const validado = validarArquivo({
		bytes: entrada.bytes,
		filename: entrada.filename,
		mimeType: entrada.mimeType,
		scope
	});

	if (!validado.ok) {
		return json({ erro: validado.erro }, { status: 400 });
	}

	const [criado] = await banco
		.insert(fileAsset)
		.values({
			teamId: actor.teamId,
			scope,
			ownerPersonId: scope === 'perfil_foto' ? actor.personId : null,
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
			sizeBytes: fileAsset.sizeBytes,
			scope: fileAsset.scope
		});

	if (!criado) {
		return json({ erro: 'Não foi possível salvar o arquivo.' }, { status: 500 });
	}

	await audit(banco, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'file.enviado',
		entity: 'file_asset',
		entityId: criado.id,
		after: {
			scope: criado.scope,
			filename: criado.filename,
			mimeType: criado.mimeType,
			sizeBytes: criado.sizeBytes
		},
		userAgent: request.headers.get('user-agent')
	});

	return json(
		{
			ok: true,
			arquivo: {
				id: criado.id,
				url: `/api/arquivos/${criado.id}`,
				filename: criado.filename,
				mimeType: criado.mimeType,
				sizeBytes: criado.sizeBytes,
				scope: criado.scope
			}
		},
		{ status: 201 }
	);
};
