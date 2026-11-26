import { json } from '@sveltejs/kit';
import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	aiInteractionLog,
	aiSuggestion,
	financeCategory,
	financeTransaction,
	group as groupTable,
	groupMember,
	person as personTable,
	personProfile,
	presence
} from '$server/db/schema';
import { autenticarAtor, flagAtiva } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { calcularResumoFinanceiro } from '$server/financeiro/calculos';
import {
	detectarSinaisDeAtencao,
	resumirFinanceiroEmTexto,
	sugerirDivisaoGrupos
} from '$server/ia/motor';

const analisarSchema = z.object({
	tipo: z.enum(['sinais_atencao', 'divisao_grupos', 'resumo_financeiro'])
});

/**
 * Análises assistidas rigorosamente escopadas por permissão (RN-26, RN-27, RN-29):
 *   - `sinais_atencao` → `ai.use_analytics` (global ou escopo de grupo)
 *   - `divisao_grupos` → `ai.use_analytics` + `group.manage` (gera PROPOSTA pendente)
 *   - `resumo_financeiro` → `ai.use_finance` + `finance.view_all`
 */
export const POST = async ({ request, locals }) => {
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

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = analisarSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Tipo de análise inválido.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const { tipo } = resultado.data;
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

	if (tipo === 'resumo_financeiro') {
		if (!can(actor, 'ai.use_finance') || !can(actor, 'finance.view_all')) {
			return json(
				{ erro: 'Você não tem permissão para usar IA sobre dados financeiros.' },
				{ status: 403 }
			);
		}

		const txs = await banco
			.select({
				kind: financeTransaction.kind,
				amountCents: financeTransaction.amountCents,
				status: financeTransaction.status,
				reversesTransactionId: financeTransaction.reversesTransactionId,
				categoryName: financeCategory.name
			})
			.from(financeTransaction)
			.innerJoin(financeCategory, eq(financeCategory.id, financeTransaction.categoryId))
			.where(eq(financeTransaction.teamId, actor.teamId));

		const resumo = calcularResumoFinanceiro(txs);
		const porCat = new Map<string, number>();
		for (const t of txs) {
			if (t.status !== 'confirmada' || t.kind !== 'saida' || t.reversesTransactionId) continue;
			porCat.set(t.categoryName, (porCat.get(t.categoryName) ?? 0) + t.amountCents);
		}
		const topCategoriasSaida = [...porCat.entries()]
			.map(([nome, totalCents]) => ({ nome, totalCents }))
			.sort((a, b) => b.totalCents - a.totalCents)
			.slice(0, 3);

		const saida = resumirFinanceiroEmTexto({ resumo, topCategoriasSaida });

		const [sugestao] = await banco
			.insert(aiSuggestion)
			.values({
				teamId: actor.teamId,
				kind: 'resumo_financeiro',
				requestedByPersonId: actor.personId,
				inputSnapshot: { totalTransacoes: txs.length },
				output: saida,
				status: 'pendente',
				expiresAt
			})
			.returning();

		await banco.insert(aiInteractionLog).values({
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			kind: 'resumo_financeiro',
			permissionUsed: 'ai.use_finance',
			provider: 'deterministico',
			promptSummary: 'Resumo financeiro da equipe',
			tokensEstimated: txs.length * 8
		});

		return json({ ok: true, sugestao, resultado: saida }, { status: 201 });
	}

	// Análises de pessoas / participação / grupos
	const analyticsGlobal = can(actor, 'ai.use_analytics');
	const gruposAnalytics = groupsWhere(actor, 'ai.use_analytics');
	if (!analyticsGlobal && gruposAnalytics.length === 0) {
		return json(
			{ erro: 'Você não tem permissão para análises assistidas de participação.' },
			{ status: 403 }
		);
	}

	const sessentaDiasAtras = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

	const pessoasRaw = await banco
		.select({
			id: personTable.id,
			nome: personTable.fullName,
			birthDate: personTable.birthDate,
			status: personProfile.status,
			groupId: groupMember.groupId
		})
		.from(personTable)
		.leftJoin(personProfile, eq(personProfile.personId, personTable.id))
		.leftJoin(groupMember, eq(groupMember.personId, personTable.id))
		.where(and(eq(personTable.teamId, actor.teamId), isNull(personTable.deletedAt)))
		.orderBy(asc(personTable.fullName));

	// RN-26: conselheiro vê apenas pessoas dos próprios grupos
	const pessoasVisiveis = analyticsGlobal
		? pessoasRaw
		: pessoasRaw.filter((p) => p.groupId !== null && gruposAnalytics.includes(p.groupId));

	const idsVisiveis = pessoasVisiveis.map((p) => p.id);
	const presencasRecentes =
		idsVisiveis.length > 0
			? await banco
					.select({ personId: presence.personId, status: presence.status })
					.from(presence)
					.where(
						and(
							inArray(presence.personId, idsVisiveis),
							gte(presence.registeredAt, sessentaDiasAtras)
						)
					)
			: [];

	const mapaPresenca = new Map<string, number>();
	for (const pr of presencasRecentes) {
		if (pr.status === 'present' || pr.status === 'late') {
			mapaPresenca.set(pr.personId, (mapaPresenca.get(pr.personId) ?? 0) + 1);
		}
	}

	if (tipo === 'sinais_atencao') {
		const saida = detectarSinaisDeAtencao({
			pessoas: pessoasVisiveis.map((p) => ({
				id: p.id,
				nome: p.nome,
				birthDate: p.birthDate,
				status: p.status ?? 'visitante',
				presencasUltimos60Dias: mapaPresenca.get(p.id) ?? 0
			}))
		});

		const [sugestao] = await banco
			.insert(aiSuggestion)
			.values({
				teamId: actor.teamId,
				kind: 'sinais_atencao',
				requestedByPersonId: actor.personId,
				inputSnapshot: { pessoasAvaliadas: pessoasVisiveis.length, janelaDias: 60 },
				output: saida,
				status: 'pendente',
				expiresAt
			})
			.returning();

		await banco.insert(aiInteractionLog).values({
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			kind: 'sinais_atencao',
			permissionUsed: 'ai.use_analytics',
			provider: 'deterministico',
			promptSummary: `Sinais de atenção (${pessoasVisiveis.length} pessoas no escopo)`,
			tokensEstimated: pessoasVisiveis.length * 6
		});

		return json({ ok: true, sugestao, resultado: saida }, { status: 201 });
	}

	// divisao_grupos (RF-10.4 / F4 / RN-09 / RN-27)
	if (!can(actor, 'group.manage')) {
		return json(
			{ erro: 'Apenas líderes com permissão de gestão de grupos podem gerar proposta de divisão.' },
			{ status: 403 }
		);
	}

	const grupos = await banco
		.select({ id: groupTable.id, name: groupTable.name })
		.from(groupTable)
		.where(eq(groupTable.teamId, actor.teamId))
		.orderBy(asc(groupTable.name));

	const saida = sugerirDivisaoGrupos({
		grupos,
		pessoas: pessoasVisiveis.map((p) => ({
			id: p.id,
			nome: p.nome,
			birthDate: p.birthDate,
			frequencia: mapaPresenca.get(p.id) ?? 0,
			grupoAtualId: p.groupId
		}))
	});

	const [sugestao] = await banco
		.insert(aiSuggestion)
		.values({
			teamId: actor.teamId,
			kind: 'divisao_grupos',
			requestedByPersonId: actor.personId,
			inputSnapshot: { totalGrupos: grupos.length, totalPessoas: pessoasVisiveis.length },
			output: saida,
			status: 'pendente',
			expiresAt
		})
		.returning();

	await banco.insert(aiInteractionLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		kind: 'divisao_grupos',
		permissionUsed: 'ai.use_analytics',
		provider: 'deterministico',
		promptSummary: `Proposta de divisão para ${grupos.length} grupos e ${pessoasVisiveis.length} pessoas`,
		tokensEstimated: pessoasVisiveis.length * 10
	});

	return json({ ok: true, sugestao, resultado: saida }, { status: 201 });
};
