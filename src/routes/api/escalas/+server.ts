import { json } from '@sveltejs/kit';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	escala,
	escalaHistorico,
	event as eventTable,
	person as personTable,
	responsabilidade as responsabilidadeTable
} from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const criarEscalaSchema = z.object({
	eventoId: z.string().uuid(),
	responsabilidadeId: z.string().uuid(),
	personId: z.string().uuid(),
	ordem: z.number().int().min(0).default(0),
	observacoes: z.string().trim().max(500).optional()
});

/**
 * Lista escalas de um evento (?eventoId=...) ou da equipe.
 */
export const GET = async ({ request, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeVer =
		can(actor, 'responsibility.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'responsibility.view').length > 0;
	if (!podeVer) {
		return json({ erro: 'Sem permissão para ver escalas.' }, { status: 403 });
	}

	const eventoId = url.searchParams.get('eventoId');
	const filtros = [eq(eventTable.teamId, actor.teamId)];
	if (eventoId) {
		if (!isUuid(eventoId)) {
			return json({ erro: 'Identificador de evento inválido.' }, { status: 400 });
		}
		filtros.push(eq(escala.eventId, eventoId));
	}

	const escalas = await banco
		.select({
			id: escala.id,
			eventId: escala.eventId,
			eventoTitulo: eventTable.title,
			eventoInicio: eventTable.startsAt,
			responsabilidadeId: escala.responsabilidadeId,
			personId: escala.personId,
			status: escala.status,
			origem: escala.origem,
			propostaId: escala.propostaId,
			substituidoPorPersonId: escala.substituidoPorPersonId,
			ordem: escala.ordem,
			observacoes: escala.observacoes,
			createdAt: escala.createdAt,
			pessoaNome: personTable.fullName,
			responsabilidadeNome: responsabilidadeTable.nome
		})
		.from(escala)
		.innerJoin(eventTable, eq(eventTable.id, escala.eventId))
		.innerJoin(personTable, eq(personTable.id, escala.personId))
		.innerJoin(responsabilidadeTable, eq(responsabilidadeTable.id, escala.responsabilidadeId))
		.where(and(...filtros))
		.orderBy(asc(eventTable.startsAt), asc(escala.ordem), asc(responsabilidadeTable.nome));

	return json({ escalas });
};

/**
 * Atribui manualmente uma responsabilidade a uma pessoa em um evento (RN-17 / RF-07.2).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarEscalaSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const { eventoId, responsabilidadeId, personId: pessoaAlvoId, ordem, observacoes } = resultado.data;

	const [evento] = await banco
		.select({ id: eventTable.id, groupId: eventTable.groupId })
		.from(eventTable)
		.where(and(eq(eventTable.id, eventoId), eq(eventTable.teamId, actor.teamId)))
		.limit(1);

	if (!evento) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (!can(actor, 'responsibility.manage', { groupId: evento.groupId })) {
		return json(
			{ erro: 'Apenas líderes e conselheiros autorizados podem gerenciar escalas.' },
			{ status: 403 }
		);
	}

	const [respEncontrada] = await banco
		.select({ id: responsabilidadeTable.id })
		.from(responsabilidadeTable)
		.where(
			and(
				eq(responsabilidadeTable.id, responsabilidadeId),
				eq(responsabilidadeTable.teamId, actor.teamId)
			)
		)
		.limit(1);

	if (!respEncontrada) {
		return json({ erro: 'Responsabilidade não encontrada.' }, { status: 404 });
	}

	const [pessoaAlvo] = await banco
		.select({ id: personTable.id })
		.from(personTable)
		.where(and(eq(personTable.id, pessoaAlvoId), eq(personTable.teamId, actor.teamId)))
		.limit(1);

	if (!pessoaAlvo) {
		return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });
	}

	const [escalaExistente] = await banco
		.select({ id: escala.id })
		.from(escala)
		.where(
			and(
				eq(escala.eventId, eventoId),
				eq(escala.responsabilidadeId, responsabilidadeId),
				eq(escala.personId, pessoaAlvoId),
				ne(escala.status, 'trocada')
			)
		)
		.limit(1);

	if (escalaExistente) {
		return json(
			{ erro: 'Esta pessoa já está escalada para esta responsabilidade neste evento.' },
			{ status: 400 }
		);
	}

	const agora = new Date();
	const [novaEscala] = await banco
		.insert(escala)
		.values({
			eventId: eventoId,
			responsabilidadeId,
			personId: pessoaAlvoId,
			status: 'confirmada',
			origem: 'manual',
			confirmadoPorPersonId: actor.personId,
			confirmadoEm: agora,
			ordem,
			observacoes: observacoes || null
		})
		.returning();

	if (!novaEscala) {
		return json({ erro: 'Não foi possível criar a escala.' }, { status: 500 });
	}

	await banco.insert(escalaHistorico).values({
		escalaId: novaEscala.id,
		acao: 'adicionada',
		pessoaAlvoId,
		alteradoPorPersonId: actor.personId,
		observacoes: observacoes || 'Atribuição manual'
	});

	return json(
		{
			ok: true,
			escala: {
				id: novaEscala.id,
				eventoId: novaEscala.eventId,
				responsabilidadeId: novaEscala.responsabilidadeId,
				personId: novaEscala.personId,
				status: novaEscala.status,
				origem: novaEscala.origem,
				ordem: novaEscala.ordem,
				observacoes: novaEscala.observacoes,
				criadaEm: novaEscala.createdAt
			}
		},
		{ status: 201 }
	);
};
