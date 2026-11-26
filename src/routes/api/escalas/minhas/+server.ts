import { json } from '@sveltejs/kit';
import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '$server/db';
import {
	escala,
	event as eventTable,
	responsabilidade as responsabilidadeTable
} from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

/**
 * Visão "Minhas responsabilidades" para o membro autenticado (RF-07.3).
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'responsibility.view', { personId: actor.personId })) {
		return json({ erro: 'Sem permissão para ver suas responsabilidades.' }, { status: 403 });
	}

	const itens = await banco
		.select({
			id: escala.id,
			eventId: escala.eventId,
			eventoTitulo: eventTable.title,
			eventoInicio: eventTable.startsAt,
			eventoLocal: eventTable.location,
			responsabilidadeId: escala.responsabilidadeId,
			responsabilidadeNome: responsabilidadeTable.nome,
			status: escala.status,
			origem: escala.origem,
			observacoes: escala.observacoes
		})
		.from(escala)
		.innerJoin(eventTable, eq(eventTable.id, escala.eventId))
		.innerJoin(responsabilidadeTable, eq(responsabilidadeTable.id, escala.responsabilidadeId))
		.where(
			and(
				eq(escala.personId, actor.personId),
				eq(eventTable.teamId, actor.teamId),
				ne(escala.status, 'trocada')
			)
		)
		.orderBy(asc(eventTable.startsAt));

	return json({ escalas: itens });
};
