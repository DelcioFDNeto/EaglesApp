import { json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { person, personProfile, personStatusHistory } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const atualizarPerfilSchema = z.object({
	nome: z.string().trim().min(1).max(200).optional(),
	telefone: z.string().trim().max(40).optional().nullable(),
	whatsapp: z.string().trim().max(40).optional().nullable(),
	email: z.union([z.string().trim().email(), z.literal('')]).optional().nullable(),
	dataNascimento: z.string().trim().optional().nullable(),
	fotoUrl: z.union([z.string().trim().url(), z.literal('')]).optional().nullable(),
	relacionamento: z.string().trim().max(80).optional().nullable(),
	irmaos: z.string().trim().max(250).optional().nullable(),
	vinculosFamiliares: z.string().trim().max(500).optional().nullable(),
	status: z
		.enum(['visitante', 'recorrente', 'membro', 'conselheiro', 'lider'])
		.optional(),
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
		podeAlterarStatus: can(actor, 'person.update'),
		perfil: perfil
			? {
					telefone: perfil.phone,
					whatsapp: perfil.whatsapp,
					email: perfil.email,
					dataNascimento: perfil.birthDate,
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

	if (dados.nome !== undefined) {
		await banco
			.update(person)
			.set({ fullName: dados.nome, updatedAt: new Date() })
			.where(eq(person.id, actor.personId));
	}

	const [perfilExistente] = await banco
		.select()
		.from(personProfile)
		.where(eq(personProfile.personId, actor.personId))
		.limit(1);

	const podeAlterarStatus = can(actor, 'person.update');
	const statusAtual = perfilExistente?.status ?? 'visitante';
	const novoStatus =
		dados.status !== undefined && podeAlterarStatus ? dados.status : statusAtual;

	const perfilParaSalvar = {
		personId: actor.personId,
		phone: dados.telefone !== undefined ? vazioParaNull(dados.telefone) : (perfilExistente?.phone ?? null),
		whatsapp: dados.whatsapp !== undefined ? vazioParaNull(dados.whatsapp) : (perfilExistente?.whatsapp ?? null),
		email: dados.email !== undefined ? vazioParaNull(dados.email) : (perfilExistente?.email ?? null),
		birthDate:
			dados.dataNascimento !== undefined
				? vazioParaNull(dados.dataNascimento)
				: (perfilExistente?.birthDate ?? null),
		photoUrl: dados.fotoUrl !== undefined ? vazioParaNull(dados.fotoUrl) : (perfilExistente?.photoUrl ?? null),
		relationshipStatus:
			dados.relacionamento !== undefined
				? vazioParaNull(dados.relacionamento)
				: (perfilExistente?.relationshipStatus ?? null),
		siblings: dados.irmaos !== undefined ? vazioParaNull(dados.irmaos) : (perfilExistente?.siblings ?? null),
		familyTies:
			dados.vinculosFamiliares !== undefined
				? vazioParaNull(dados.vinculosFamiliares)
				: (perfilExistente?.familyTies ?? null),
		notes: dados.observacoes !== undefined ? vazioParaNull(dados.observacoes) : (perfilExistente?.notes ?? null),
		status: novoStatus,
		updatedAt: new Date()
	};

	if (perfilExistente) {
		await banco
			.update(personProfile)
			.set(perfilParaSalvar)
			.where(eq(personProfile.personId, actor.personId));
	} else {
		await banco.insert(personProfile).values(perfilParaSalvar);
	}

	if (novoStatus !== statusAtual) {
		await banco.insert(personStatusHistory).values({
			personId: actor.personId,
			fromStatus: statusAtual,
			toStatus: novoStatus,
			reason: 'Atualização no perfil',
			changedByPersonId: actor.personId
		});
	}

	return json({ ok: true, mensagem: 'Perfil atualizado com sucesso.' });
};
