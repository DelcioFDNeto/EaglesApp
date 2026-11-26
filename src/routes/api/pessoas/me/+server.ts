import { json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { person, personProfile, personStatusHistory, userAccount } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { CAMPOS_RESTRITOS_MENOR, validarIdade } from '$server/pessoas/menores';

const atualizarPerfilSchema = z.object({
	nome: z.string().trim().min(1).max(200).optional(),
	telefone: z.string().trim().max(40).optional().nullable(),
	whatsapp: z.string().trim().max(40).optional().nullable(),
	email: z
		.union([z.string().trim().email(), z.literal('')])
		.optional()
		.nullable(),
	dataNascimento: z.string().trim().optional().nullable(),
	fotoUrl: z
		.union([z.string().trim().url(), z.literal('')])
		.optional()
		.nullable(),
	relacionamento: z.string().trim().max(80).optional().nullable(),
	irmaos: z.string().trim().max(250).optional().nullable(),
	vinculosFamiliares: z.string().trim().max(500).optional().nullable(),
	// O estágio na jornada não muda aqui: é de líder/conselheiro, com histórico
	// (POST /api/pessoas/[id]/estagio). Aceito e ignorado, por compatibilidade.
	status: z.string().optional(),
	observacoes: z.string().trim().max(1000).optional().nullable()
});

function vazioParaNull(v: string | null | undefined): string | null {
	if (v == null) return null;
	const limpo = v.trim();
	return limpo.length > 0 ? limpo : null;
}

/**
 * Retorna o perfil completo da pessoa autenticada e seu histórico de status.
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'person.view', { personId: actor.personId })) {
		return json({ erro: 'Sem permissão para ver este perfil.' }, { status: 403 });
	}

	const [pessoa] = await banco
		.select({
			id: person.id,
			fullName: person.fullName,
			birthDate: person.birthDate,
			createdAt: person.createdAt
		})
		.from(person)
		.where(eq(person.id, actor.personId))
		.limit(1);

	if (!pessoa) {
		return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });
	}

	const [perfil] = await banco
		.select()
		.from(personProfile)
		.where(eq(personProfile.personId, actor.personId))
		.limit(1);

	const historico = await banco
		.select()
		.from(personStatusHistory)
		.where(eq(personStatusHistory.personId, actor.personId))
		.orderBy(desc(personStatusHistory.occurredAt))
		.limit(30);

	return json({
		id: pessoa.id,
		nome: pessoa.fullName,
		dataNascimento: pessoa.birthDate,
		criadoEm: pessoa.createdAt,
		podeAlterarStatus: false,
		perfil: perfil
			? {
					telefone: perfil.phone,
					whatsapp: perfil.whatsapp,
					email: perfil.email,
					// A data que vale é a de `person` (ADR 0003).
					dataNascimento: pessoa.birthDate ?? perfil.birthDate,
					fotoUrl: perfil.photoUrl,
					relacionamento: perfil.relationshipStatus,
					irmaos: perfil.siblings,
					vinculosFamiliares: perfil.familyTies,
					status: perfil.status,
					dataEntrada: perfil.joinedAt,
					frequencia: perfil.frequency,
					observacoes: perfil.notes
				}
			: null,
		historico: historico.map((h) => ({
			id: h.id,
			deStatus: h.fromStatus,
			paraStatus: h.toStatus,
			motivo: h.reason,
			mudadoPor: h.changedByPersonId,
			eventoId: h.eventId,
			grupoId: h.groupId,
			ocorridoEm: h.occurredAt
		}))
	});
};

/**
 * Atualiza o perfil da pessoa autenticada (cadastro progressivo).
 * Mudança de status só é permitida a quem tem `person.update` global (RN-04).
 */
export const PUT = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'person.view', { personId: actor.personId })) {
		return json({ erro: 'Sem permissão para editar este perfil.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = atualizarPerfilSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = resultado.data;

	const [perfilExistente] = await banco
		.select()
		.from(personProfile)
		.where(eq(personProfile.personId, actor.personId))
		.limit(1);

	const [eu] = await banco
		.select({ birthDate: person.birthDate })
		.from(person)
		.where(eq(person.id, actor.personId))
		.limit(1);

	const valor = <T>(novo: string | null | undefined, atual: T | null | undefined) =>
		novo !== undefined ? vazioParaNull(novo) : (atual ?? null);

	const perfilParaSalvar = {
		personId: actor.personId,
		phone: valor(dados.telefone, perfilExistente?.phone),
		whatsapp: valor(dados.whatsapp, perfilExistente?.whatsapp),
		email: valor(dados.email, perfilExistente?.email),
		// A data que vale é a de `person` (ADR 0003); o perfil guarda uma cópia.
		birthDate: valor(dados.dataNascimento, eu?.birthDate ?? perfilExistente?.birthDate),
		photoUrl: valor(dados.fotoUrl, perfilExistente?.photoUrl),
		relationshipStatus: valor(dados.relacionamento, perfilExistente?.relationshipStatus),
		siblings: valor(dados.irmaos, perfilExistente?.siblings),
		familyTies: valor(dados.vinculosFamiliares, perfilExistente?.familyTies),
		notes: valor(dados.observacoes, perfilExistente?.notes),
		updatedAt: new Date()
	};

	// Regra de idade (ADR 0003). Quem está logado tem conta com contato, então
	// um menor sem consentimento do responsável não passa daqui.
	const [conta] = await banco
		.select({ email: userAccount.email, phone: userAccount.phone })
		.from(userAccount)
		.where(eq(userAccount.personId, actor.personId))
		.limit(1);
	const restritos = {
		telefone: perfilParaSalvar.phone,
		whatsapp: perfilParaSalvar.whatsapp,
		email: perfilParaSalvar.email,
		observacoes: perfilParaSalvar.notes,
		relacionamento: perfilParaSalvar.relationshipStatus,
		irmaos: perfilParaSalvar.siblings,
		vinculosFamiliares: perfilParaSalvar.familyTies
	};
	const erroIdade = validarIdade(
		perfilParaSalvar.birthDate,
		CAMPOS_RESTRITOS_MENOR.filter((c) => restritos[c] !== null),
		Boolean(conta?.email || conta?.phone)
	);
	if (erroIdade) {
		return json({ erro: erroIdade, detalhes: { dataNascimento: [erroIdade] } }, { status: 400 });
	}

	await banco.transaction(async (tx) => {
		if (dados.nome !== undefined || dados.dataNascimento !== undefined) {
			await tx
				.update(person)
				.set({
					...(dados.nome !== undefined && { fullName: dados.nome }),
					...(dados.dataNascimento !== undefined && { birthDate: perfilParaSalvar.birthDate }),
					updatedAt: new Date()
				})
				.where(eq(person.id, actor.personId));
		}

		if (perfilExistente) {
			await tx
				.update(personProfile)
				.set(perfilParaSalvar)
				.where(eq(personProfile.personId, actor.personId));
		} else {
			await tx.insert(personProfile).values(perfilParaSalvar);
		}
	});

	return json({ ok: true, mensagem: 'Perfil atualizado com sucesso.' });
};
