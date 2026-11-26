import { json } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	escala,
	escalaHistorico,
	event as eventTable,
	person as personTable
} from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const patchEscalaSchema = z.discriminatedUnion('acao', [
	z.object({
		acao: z.literal('confirmar'),
		observacoes: z.string().trim().max(500).optional()
	}),
	z.object({
		acao: z.literal('cumprida'),
		observacoes: z.string().trim().max(500).optional()
	}),
	z.object({
		acao: z.literal('trocar'),
		novoPersonId: z.string().uuid(),
		motivo: z.string().trim().max(500).optional()
	})
]);

/**
 * Atualiza uma atribuição de escala: confirmar proposta, marcar cumprida ou trocar responsável (RF-07.5 / RN-18).
 */
export const PATCH = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const escalaId = params.id;
	if (!isUuid(escalaId)) {
		return json({ erro: 'Identificador de escala inválido.' }, { status: 400 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = patchEscalaSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [registro] = await banco
		.select({
			escala,
			groupId: eventTable.groupId,
			teamId: eventTable.teamId
		})
		.from(escala)
		.innerJoin(eventTable, eq(eventTable.id, escala.eventId))
		.where(and(eq(escala.id, escalaId), eq(eventTable.teamId, actor.teamId)))
		.limit(1);

	if (!registro) {
		return json({ erro: 'Escala não encontrada.' }, { status: 404 });
	}

	if (!can(actor, 'responsibility.manage', { groupId: registro.groupId })) {
		return json(
			{ erro: 'Apenas líderes e conselheiros autorizados podem alterar esta escala.' },
			{ status: 403 }
		);
	}

	const dados = resultado.data;
	const atual = registro.escala;
	const agora = new Date();

	if (dados.acao === 'confirmar') {
		const [atualizada] = await banco
			.update(escala)
			.set({
				status: 'confirmada',
				confirmadoPorPersonId: actor.personId,
				confirmadoEm: agora,
				updatedAt: agora
			})
			.where(eq(escala.id, atual.id))
			.returning();

		await banco.insert(escalaHistorico).values({
			escalaId: atual.id,
			acao: 'confirmada',
			pessoaAlvoId: atual.personId,
			alteradoPorPersonId: actor.personId,
			observacoes: dados.observacoes || 'Confirmada pela liderança'
		});

		return json({ ok: true, escala: atualizada });
	}

	if (dados.acao === 'cumprida') {
		const [atualizada] = await banco
			.update(escala)
			.set({ status: 'cumprida', updatedAt: agora })
			.where(eq(escala.id, atual.id))
			.returning();

		await banco.insert(escalaHistorico).values({
			escalaId: atual.id,
			acao: 'cumprida',
			pessoaAlvoId: atual.personId,
			alteradoPorPersonId: actor.personId,
			observacoes: dados.observacoes || 'Responsabilidade cumprida'
		});

		return json({ ok: true, escala: atualizada });
	}

	// Troca / substituição (RF-07.5)
	if (dados.novoPersonId === atual.personId) {
		return json({ erro: 'Escolha uma pessoa diferente para realizar a troca.' }, { status: 400 });
	}

	const [substituto] = await banco
		.select({ id: personTable.id })
		.from(personTable)
		.where(and(eq(personTable.id, dados.novoPersonId), eq(personTable.teamId, actor.teamId)))
		.limit(1);

	if (!substituto) {
		return json({ erro: 'Pessoa substituta não encontrada.' }, { status: 404 });
	}

	const [jaExiste] = await banco
		.select({ id: escala.id })
		.from(escala)
		.where(
			and(
				eq(escala.eventId, atual.eventId),
				eq(escala.responsabilidadeId, atual.responsabilidadeId),
				eq(escala.personId, dados.novoPersonId),
				ne(escala.status, 'trocada')
			)
		)
		.limit(1);

	if (jaExiste) {
		return json(
			{ erro: 'A pessoa substituta já está escalada nesta responsabilidade.' },
			{ status: 400 }
		);
	}

	await banco
		.update(escala)
		.set({
			status: 'trocada',
			substituidoPorPersonId: dados.novoPersonId,
			updatedAt: agora
		})
		.where(eq(escala.id, atual.id));

	await banco.insert(escalaHistorico).values({
		escalaId: atual.id,
		acao: 'trocada',
		pessoaAlvoId: dados.novoPersonId,
		alteradoPorPersonId: actor.personId,
		observacoes: dados.motivo || 'Substituição registrada'
	});

	const [novaEscala] = await banco
		.insert(escala)
		.values({
			eventId: atual.eventId,
			responsabilidadeId: atual.responsabilidadeId,
			personId: dados.novoPersonId,
			status: 'confirmada',
			origem: 'manual',
			confirmadoPorPersonId: actor.personId,
			confirmadoEm: agora,
			ordem: atual.ordem,
			observacoes: dados.motivo || atual.observacoes
		})
		.returning();

	if (novaEscala) {
		await banco.insert(escalaHistorico).values({
			escalaId: novaEscala.id,
			acao: 'adicionada',
			pessoaAlvoId: dados.novoPersonId,
			alteradoPorPersonId: actor.personId,
			observacoes: `Substituiu atribuição anterior${dados.motivo ? `: ${dados.motivo}` : ''}`
		});
	}

	return json({
		ok: true,
		mensagem: 'Troca registrada com histórico preservado.',
		novaEscala
	});
};

/**
 * Remove uma atribuição de escala.
 */
export const DELETE = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const escalaId = params.id;
	if (!isUuid(escalaId)) {
		return json({ erro: 'Identificador de escala inválido.' }, { status: 400 });
	}

	const [registro] = await banco
		.select({ id: escala.id, groupId: eventTable.groupId })
		.from(escala)
		.innerJoin(eventTable, eq(eventTable.id, escala.eventId))
		.where(and(eq(escala.id, escalaId), eq(eventTable.teamId, actor.teamId)))
		.limit(1);

	if (!registro) {
		return json({ erro: 'Escala não encontrada.' }, { status: 404 });
	}

	if (!can(actor, 'responsibility.manage', { groupId: registro.groupId })) {
		return json(
			{ erro: 'Apenas líderes e conselheiros autorizados podem remover esta escala.' },
			{ status: 403 }
		);
	}

	await banco.delete(escala).where(eq(escala.id, escalaId));
	return json({ ok: true, mensagem: 'Atribuição removida.' });
};
