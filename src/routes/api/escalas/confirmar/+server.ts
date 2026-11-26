import { json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	auditLog,
	escala,
	escalaHistorico,
	event as eventTable
} from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

const confirmarPropostaSchema = z.object({
	propostaId: z.string().uuid(),
	/** IDs específicos a aceitar. Se omitido e descartarTodos !== true, aceita todos da proposta. */
	aceitarIds: z.array(z.string().uuid()).optional(),
	/** Se true, descarta toda a proposta sem confirmar nenhum item. */
	descartarTodos: z.boolean().default(false)
});

/**
 * Confirma (total ou parcialmente) ou descarta uma proposta de escala gerada (RN-18).
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

	const resultado = confirmarPropostaSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const { propostaId, aceitarIds, descartarTodos } = resultado.data;

	const itensProposta = await banco
		.select({
			escala,
			groupId: eventTable.groupId
		})
		.from(escala)
		.innerJoin(eventTable, eq(eventTable.id, escala.eventId))
		.where(
			and(
				eq(escala.propostaId, propostaId),
				eq(escala.status, 'proposta'),
				eq(eventTable.teamId, actor.teamId)
			)
		);

	if (itensProposta.length === 0) {
		return json({ erro: 'Nenhuma proposta pendente encontrada com este identificador.' }, { status: 404 });
	}

	const groupId = itensProposta[0]?.groupId ?? null;
	if (!can(actor, 'responsibility.manage', { groupId })) {
		return json(
			{ erro: 'Apenas líderes e conselheiros autorizados podem confirmar propostas de escala.' },
			{ status: 403 }
		);
	}

	const idsProposta = itensProposta.map((i) => i.escala.id);
	const aceitarSet = descartarTodos
		? new Set<string>()
		: aceitarIds
			? new Set(aceitarIds.filter((id) => idsProposta.includes(id)))
			: new Set(idsProposta);

	const idsAceitos = idsProposta.filter((id) => aceitarSet.has(id));
	const idsDescartados = idsProposta.filter((id) => !aceitarSet.has(id));
	const agora = new Date();

	if (idsAceitos.length > 0) {
		await banco
			.update(escala)
			.set({
				status: 'confirmada',
				confirmadoPorPersonId: actor.personId,
				confirmadoEm: agora,
				updatedAt: agora
			})
			.where(inArray(escala.id, idsAceitos));

		for (const item of itensProposta) {
			if (!aceitarSet.has(item.escala.id)) continue;
			await banco.insert(escalaHistorico).values({
				escalaId: item.escala.id,
				acao: 'confirmada',
				pessoaAlvoId: item.escala.personId,
				alteradoPorPersonId: actor.personId,
				observacoes: 'Proposta revisada e confirmada'
			});
		}
	}

	if (idsDescartados.length > 0) {
		await banco.delete(escala).where(inArray(escala.id, idsDescartados));
	}

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: descartarTodos ? 'escala.proposta_descartada' : 'escala.proposta_confirmada',
		entity: 'escala',
		entityId: propostaId,
		after: {
			confirmadas: idsAceitos.length,
			descartadas: idsDescartados.length
		}
	});

	return json({
		ok: true,
		confirmadas: idsAceitos.length,
		descartadas: idsDescartados.length,
		mensagem: descartarTodos
			? 'Proposta descartada.'
			: `Escala confirmada (${idsAceitos.length} ${idsAceitos.length === 1 ? 'item' : 'itens'}).`
	});
};
