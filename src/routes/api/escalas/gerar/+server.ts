import { json } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { uuidv7 } from '$server/db/id';
import {
	escala,
	escalaHistorico,
	event as eventTable,
	groupMember,
	person as personTable,
	responsabilidade as responsabilidadeTable
} from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { gerarPropostaDeEscala } from '$server/responsabilidades/gerador';
import { naoEhMaster } from '$server/lideranca/regras';

const gerarEscalaSchema = z.object({
	eventoId: z.string().uuid(),
	responsabilidadeIds: z.array(z.string().uuid()).optional(),
	candidatosIds: z.array(z.string().uuid()).optional()
});

/**
 * Gera uma PROPOSTA automática de escala para revisão humana (RN-18, RN-19, RF-07.4).
 * Itens nascem com `status = 'proposta'` e `origem = 'gerada'` — nunca entram
 * como escala oficial até confirmação explícita em POST /api/escalas/confirmar.
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

	const resultado = gerarEscalaSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const { eventoId, responsabilidadeIds, candidatosIds } = resultado.data;

	const [evento] = await banco
		.select({
			id: eventTable.id,
			teamId: eventTable.teamId,
			groupId: eventTable.groupId,
			startsAt: eventTable.startsAt
		})
		.from(eventTable)
		.where(and(eq(eventTable.id, eventoId), eq(eventTable.teamId, actor.teamId)))
		.limit(1);

	if (!evento) {
		return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (!can(actor, 'responsibility.manage', { groupId: evento.groupId })) {
		return json(
			{ erro: 'Apenas líderes e conselheiros autorizados podem gerar escalas.' },
			{ status: 403 }
		);
	}

	// Responsabilidades a escalar
	const filtrosResp = [
		eq(responsabilidadeTable.teamId, actor.teamId),
		eq(responsabilidadeTable.ativo, true)
	];
	if (responsabilidadeIds && responsabilidadeIds.length > 0) {
		filtrosResp.push(inArray(responsabilidadeTable.id, responsabilidadeIds));
	}

	const responsabilidades = await banco
		.select({
			id: responsabilidadeTable.id,
			nome: responsabilidadeTable.nome,
			intervaloMinimoDias: responsabilidadeTable.intervaloMinimoDias,
			ordem: responsabilidadeTable.ordem
		})
		.from(responsabilidadeTable)
		.where(and(...filtrosResp))
		.orderBy(asc(responsabilidadeTable.ordem), asc(responsabilidadeTable.nome));

	if (responsabilidades.length === 0) {
		return json(
			{ erro: 'Nenhuma responsabilidade ativa disponível para gerar escala.' },
			{ status: 400 }
		);
	}

	// Pool de candidatos
	let candidatos: Array<{ personId: string; nome: string }> = [];
	if (candidatosIds && candidatosIds.length > 0) {
		const pessoas = await banco
			.select({ personId: personTable.id, nome: personTable.fullName })
			.from(personTable)
			.where(
				and(
					eq(personTable.teamId, actor.teamId),
					isNull(personTable.deletedAt),
					naoEhMaster(personTable.id),
					inArray(personTable.id, candidatosIds)
				)
			);
		candidatos = pessoas;
	} else if (evento.groupId) {
		const membros = await banco
			.select({ personId: personTable.id, nome: personTable.fullName })
			.from(groupMember)
			.innerJoin(personTable, eq(personTable.id, groupMember.personId))
			.where(
				and(
					eq(groupMember.groupId, evento.groupId),
					eq(personTable.teamId, actor.teamId),
					isNull(personTable.deletedAt),
					naoEhMaster(personTable.id)
				)
			);
		candidatos = membros;
	}

	// Se o grupo estiver vazio ou evento for geral, usa membros ativos da equipe
	if (candidatos.length === 0) {
		candidatos = await banco
			.select({ personId: personTable.id, nome: personTable.fullName })
			.from(personTable)
			.where(
				and(
					eq(personTable.teamId, actor.teamId),
					isNull(personTable.deletedAt),
					naoEhMaster(personTable.id)
				)
			);
	}

	if (candidatos.length === 0) {
		return json({ erro: 'Não há pessoas disponíveis para montar a escala.' }, { status: 400 });
	}

	// Escalas já existentes no evento (para não duplicar)
	const existentesNoEvento = await banco
		.select({
			personId: escala.personId,
			responsabilidadeId: escala.responsabilidadeId
		})
		.from(escala)
		.where(and(eq(escala.eventId, eventoId), ne(escala.status, 'trocada')));

	const jaEscaladosNoEvento = new Set(existentesNoEvento.map((e) => e.personId));
	const responsabilidadesJaPreenchidas = new Set(
		existentesNoEvento.map((e) => e.responsabilidadeId)
	);

	// Histórico oficial (confirmadas ou cumpridas) para evitar repetição (RN-19)
	const historico = await banco
		.select({
			personId: escala.personId,
			responsabilidadeId: escala.responsabilidadeId,
			eventoInicio: eventTable.startsAt
		})
		.from(escala)
		.innerJoin(eventTable, eq(eventTable.id, escala.eventId))
		.where(
			and(eq(eventTable.teamId, actor.teamId), inArray(escala.status, ['confirmada', 'cumprida']))
		);

	const itensPropostos = gerarPropostaDeEscala({
		dataEvento: new Date(evento.startsAt),
		responsabilidades,
		candidatos,
		historico: historico.map((h) => ({
			personId: h.personId,
			responsabilidadeId: h.responsabilidadeId,
			eventoInicio: new Date(h.eventoInicio)
		})),
		jaEscaladosNoEvento,
		responsabilidadesJaPreenchidas
	});

	if (itensPropostos.length === 0) {
		return json({
			ok: true,
			propostaId: null,
			itens: [],
			mensagem: 'Todas as responsabilidades selecionadas já estão preenchidas neste evento.'
		});
	}

	const propostaId = uuidv7();
	const inseridos = [];

	for (const item of itensPropostos) {
		const [criada] = await banco
			.insert(escala)
			.values({
				eventId: eventoId,
				responsabilidadeId: item.responsabilidadeId,
				personId: item.personId,
				status: 'proposta',
				origem: 'gerada',
				propostaId,
				ordem: item.ordem,
				observacoes: item.justificativa
			})
			.returning();

		if (criada) {
			await banco.insert(escalaHistorico).values({
				escalaId: criada.id,
				acao: 'proposta',
				pessoaAlvoId: item.personId,
				alteradoPorPersonId: actor.personId,
				observacoes: item.justificativa
			});
			inseridos.push({
				id: criada.id,
				...item,
				status: criada.status,
				origem: criada.origem,
				propostaId
			});
		}
	}

	return json(
		{
			ok: true,
			propostaId,
			itens: inseridos,
			mensagem: 'Proposta gerada. Revise e confirme para torná-la oficial.'
		},
		{ status: 201 }
	);
};
