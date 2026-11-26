import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { aiSuggestion, auditLog, groupMember } from '$server/db/schema';
import { autenticarAtor, flagAtiva, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const decidirSchema = z.object({
	decisao: z.enum(['aceitar', 'rejeitar']),
	/** Opcional: para `divisao_grupos`, permite aceitar parcialmente apenas estes `personId`s (RN-09 / F4). */
	personIdsAceitos: z.array(z.string().uuid()).optional()
});

/**
 * Decisão humana obrigatória sobre uma sugestão da IA (RN-09 / RN-27 / F4).
 * Nenhuma alteração administrativa acontece sem este passo explícito.
 */
export const POST = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!(await flagAtiva(banco, actor.teamId, 'ia_assistente'))) {
		return json(
			{ erro: 'O assistente de IA está desligado nas configurações da equipe.' },
			{ status: 403 }
		);
	}

	const id = params.id;
	if (!isUuid(id)) {
		return json({ erro: 'Identificador inválido.' }, { status: 400 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = decidirSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [sugestao] = await banco
		.select()
		.from(aiSuggestion)
		.where(and(eq(aiSuggestion.id, id), eq(aiSuggestion.teamId, actor.teamId)))
		.limit(1);

	if (!sugestao) {
		return json({ erro: 'Sugestão não encontrada.' }, { status: 404 });
	}

	if (sugestao.status !== 'pendente') {
		return json({ erro: 'Esta sugestão já foi decidida.' }, { status: 400 });
	}

	if (sugestao.expiresAt && sugestao.expiresAt < new Date()) {
		await banco.update(aiSuggestion).set({ status: 'expirada' }).where(eq(aiSuggestion.id, id));
		return json({ erro: 'Esta sugestão expirou. Gere uma nova proposta.' }, { status: 400 });
	}

	const { decisao, personIdsAceitos } = resultado.data;

	// Verificação de permissão conforme o tipo da sugestão (RN-26)
	if (sugestao.kind === 'divisao_grupos') {
		if (!can(actor, 'group.assign_member')) {
			return json(
				{ erro: 'Apenas líderes com permissão de transferência podem decidir divisões de grupos.' },
				{ status: 403 }
			);
		}
	} else if (sugestao.kind === 'resumo_financeiro') {
		if (!can(actor, 'ai.use_finance') || !can(actor, 'finance.view_all')) {
			return json({ erro: 'Sem permissão para esta sugestão financeira.' }, { status: 403 });
		}
	} else if (sugestao.kind === 'sinais_atencao') {
		if (!can(actor, 'ai.use_analytics') && groupsWhere(actor, 'ai.use_analytics').length === 0) {
			return json({ erro: 'Sem permissão para esta análise.' }, { status: 403 });
		}
	} else if (sugestao.requestedByPersonId !== actor.personId && !can(actor, 'ai.use_analytics')) {
		return json({ erro: 'Sem permissão para decidir esta sugestão.' }, { status: 403 });
	}

	const agora = new Date();
	let appliedChanges: Record<string, unknown> | null = null;

	if (decisao === 'aceitar' && sugestao.kind === 'divisao_grupos') {
		const output = sugestao.output as {
			alocacoes?: Array<{ personId: string; grupoSugeridoId: string; mudou: boolean }>;
		};
		const alocacoes = output.alocacoes ?? [];
		const filtro = personIdsAceitos ? new Set(personIdsAceitos) : null;
		let aplicadas = 0;

		for (const item of alocacoes) {
			if (!item.mudou) continue;
			if (filtro && !filtro.has(item.personId)) continue;

			const [existente] = await banco
				.select({ id: groupMember.id })
				.from(groupMember)
				.where(eq(groupMember.personId, item.personId))
				.limit(1);

			if (existente) {
				await banco
					.update(groupMember)
					.set({ groupId: item.grupoSugeridoId, joinedAt: agora, updatedAt: agora })
					.where(eq(groupMember.id, existente.id));
			} else {
				await banco.insert(groupMember).values({
					groupId: item.grupoSugeridoId,
					personId: item.personId,
					roleKey: 'membro',
					joinedAt: agora
				});
			}
			aplicadas += 1;
		}
		appliedChanges = { transferenciasAplicadas: aplicadas };
	}

	const novoStatus = decisao === 'aceitar' ? 'aceita' : 'rejeitada';
	const [atualizada] = await banco
		.update(aiSuggestion)
		.set({
			status: novoStatus,
			decidedByPersonId: actor.personId,
			decidedAt: agora,
			appliedChanges
		})
		.where(eq(aiSuggestion.id, id))
		.returning();

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: decisao === 'aceitar' ? 'ai.suggestion_accepted' : 'ai.suggestion_rejected',
		entity: 'ai_suggestion',
		entityId: id,
		before: { status: 'pendente', kind: sugestao.kind },
		after: { status: novoStatus, appliedChanges }
	});

	return json({
		ok: true,
		sugestao: atualizada,
		mensagem: decisao === 'aceitar' ? 'Sugestão confirmada com sucesso.' : 'Sugestão descartada.'
	});
};
