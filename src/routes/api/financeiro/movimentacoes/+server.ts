import { json } from '@sveltejs/kit';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	auditLog,
	contributionRule,
	event as eventTable,
	financeAccount,
	financeCategory,
	financeTransaction,
	group as groupTable,
	person as personTable,
	personRole as personRoleTable,
	role as roleTable
} from '$server/db/schema';
import { autenticarAtor, flagAtiva, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { calcularResumoFinanceiro, formatarCentavos } from '$server/financeiro/calculos';

const criarMovimentacaoSchema = z.object({
	kind: z.enum(['entrada', 'saida']),
	categoryId: z.string().uuid(),
	accountId: z.string().uuid().optional().nullable(),
	amountCents: z.number().int().positive('O valor deve ser maior que zero.'),
	occurredAt: z.string().datetime().optional(),
	paymentMethod: z.enum(['pix', 'especie', 'cartao', 'transferencia', 'outro']).default('pix'),
	description: z.string().trim().min(1).max(400),
	personId: z.string().uuid().optional().nullable(),
	eventId: z.string().uuid().optional().nullable(),
	groupId: z.string().uuid().optional().nullable(),
	receiptUrl: z
		.union([z.string().trim().url(), z.literal('')])
		.optional()
		.nullable()
});

/**
 * Lista movimentações financeiras e calcula o painel Arrecadado → Despesas → Saldo (RF-08.4 / RF-08.5).
 * Aplica rigorosamente a visibilidade por nível (RN-24):
 *   - Líder (`finance.view_all`): tudo
 *   - Conselheiro (`finance.view_group`): grupos autorizados + próprias contribuições
 *   - Membro (`finance.view_own`): apenas próprias contribuições
 *   - Visitante: 403 (zero acesso financeiro)
 */
export const GET = async ({ request, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeVerTudo = can(actor, 'finance.view_all');
	const gruposVisiveis = groupsWhere(actor, 'finance.view_group');
	const podeVerGrupoGlobal = can(actor, 'finance.view_group');
	const podeVerProprio = can(actor, 'finance.view_own', { personId: actor.personId });

	if (!podeVerTudo && !podeVerGrupoGlobal && gruposVisiveis.length === 0 && !podeVerProprio) {
		return json({ erro: 'Sem permissão para acessar dados financeiros.' }, { status: 403 });
	}

	const escopoVisibilidade = podeVerTudo
		? 'all'
		: podeVerGrupoGlobal || gruposVisiveis.length > 0
			? 'group'
			: 'own';

	const filtros = [eq(financeTransaction.teamId, actor.teamId)];

	const de = url.searchParams.get('de');
	const ate = url.searchParams.get('ate');
	const categoriaId = url.searchParams.get('categoriaId');
	const eventoId = url.searchParams.get('eventoId');
	const grupoId = url.searchParams.get('grupoId');
	const tipo = url.searchParams.get('tipo');

	if (de && !Number.isNaN(Date.parse(de))) {
		filtros.push(gte(financeTransaction.occurredAt, new Date(de)));
	}
	if (ate && !Number.isNaN(Date.parse(ate))) {
		filtros.push(lte(financeTransaction.occurredAt, new Date(ate)));
	}
	if (categoriaId && isUuid(categoriaId)) {
		filtros.push(eq(financeTransaction.categoryId, categoriaId));
	}
	if (eventoId && isUuid(eventoId)) {
		filtros.push(eq(financeTransaction.eventId, eventoId));
	}
	if (grupoId && isUuid(grupoId)) {
		filtros.push(eq(financeTransaction.groupId, grupoId));
	}
	if (tipo === 'entrada' || tipo === 'saida') {
		filtros.push(eq(financeTransaction.kind, tipo));
	}

	const linhas = await banco
		.select({
			id: financeTransaction.id,
			kind: financeTransaction.kind,
			amountCents: financeTransaction.amountCents,
			occurredAt: financeTransaction.occurredAt,
			paymentMethod: financeTransaction.paymentMethod,
			description: financeTransaction.description,
			status: financeTransaction.status,
			receiptUrl: financeTransaction.receiptUrl,
			reversesTransactionId: financeTransaction.reversesTransactionId,
			rejectionReason: financeTransaction.rejectionReason,
			categoryId: financeTransaction.categoryId,
			categoryName: financeCategory.name,
			accountId: financeTransaction.accountId,
			accountName: financeAccount.name,
			responsiblePersonId: financeTransaction.responsiblePersonId,
			responsibleName: personTable.fullName,
			personId: financeTransaction.personId,
			eventId: financeTransaction.eventId,
			eventTitle: eventTable.title,
			groupId: financeTransaction.groupId,
			groupName: groupTable.name,
			createdAt: financeTransaction.createdAt
		})
		.from(financeTransaction)
		.innerJoin(financeCategory, eq(financeCategory.id, financeTransaction.categoryId))
		.innerJoin(personTable, eq(personTable.id, financeTransaction.responsiblePersonId))
		.leftJoin(financeAccount, eq(financeAccount.id, financeTransaction.accountId))
		.leftJoin(eventTable, eq(eventTable.id, financeTransaction.eventId))
		.leftJoin(groupTable, eq(groupTable.id, financeTransaction.groupId))
		.where(and(...filtros))
		.orderBy(desc(financeTransaction.occurredAt), desc(financeTransaction.createdAt))
		.limit(200);

	// Filtra pelo escopo RN-24
	const visiveis = linhas.filter((m) => {
		if (podeVerTudo || podeVerGrupoGlobal) return true;
		if (gruposVisiveis.length > 0) {
			return (
				(m.groupId !== null && gruposVisiveis.includes(m.groupId)) || m.personId === actor.personId
			);
		}
		// Apenas `finance.view_own`
		return m.personId === actor.personId;
	});

	const estornadasSet = new Set(
		visiveis.map((m) => m.reversesTransactionId).filter((id): id is string => Boolean(id))
	);

	// Carrega nomes dos contribuintes quando houver
	const contribIds = [
		...new Set(visiveis.map((m) => m.personId).filter((id): id is string => Boolean(id)))
	];
	const nomesContrib = new Map<string, string>();
	if (contribIds.length > 0) {
		const pessoas = await banco
			.select({ id: personTable.id, nome: personTable.fullName })
			.from(personTable)
			.where(inArray(personTable.id, contribIds));
		for (const p of pessoas) nomesContrib.set(p.id, p.nome);
	}

	const resumo = calcularResumoFinanceiro(visiveis);
	const aprovacaoDespesasAtiva = await flagAtiva(banco, actor.teamId, 'aprovacao_despesas');

	return json({
		escopoVisibilidade,
		permissoesFinanceiro: {
			podeLancar: can(actor, 'finance.create') || groupsWhere(actor, 'finance.create').length > 0,
			podeAprovar: can(actor, 'finance.approve'),
			podeEstornar: can(actor, 'finance.reverse'),
			podeGerenciarCategorias: can(actor, 'finance.approve') || can(actor, 'settings.manage'),
			aprovacaoDespesasAtiva
		},
		resumo,
		movimentacoes: visiveis.map((m) => ({
			...m,
			contributorName: m.personId ? (nomesContrib.get(m.personId) ?? null) : null,
			jaEstornada: estornadasSet.has(m.id)
		}))
	});
};

/**
 * Lança uma movimentação financeira (RN-20, RN-22, RN-23, RN-25, RN-28).
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

	const resultado = criarMovimentacaoSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = resultado.data;

	if (!can(actor, 'finance.create', { groupId: dados.groupId ?? null })) {
		return json(
			{ erro: 'Você não tem permissão para lançar movimentações neste escopo.' },
			{ status: 403 }
		);
	}

	const [categoria] = await banco
		.select()
		.from(financeCategory)
		.where(
			and(
				eq(financeCategory.id, dados.categoryId),
				eq(financeCategory.teamId, actor.teamId),
				eq(financeCategory.active, true)
			)
		)
		.limit(1);

	if (!categoria) {
		return json({ erro: 'Categoria financeira não encontrada.' }, { status: 404 });
	}

	if (categoria.kind !== dados.kind) {
		return json(
			{ erro: `A categoria "${categoria.name}" é de ${categoria.kind}, não de ${dados.kind}.` },
			{ status: 400 }
		);
	}

	if (dados.groupId) {
		const [g] = await banco
			.select({ id: groupTable.id })
			.from(groupTable)
			.where(and(eq(groupTable.id, dados.groupId), eq(groupTable.teamId, actor.teamId)))
			.limit(1);
		if (!g) return json({ erro: 'Grupo não encontrado.' }, { status: 404 });
	}

	if (dados.eventId) {
		const [e] = await banco
			.select({ id: eventTable.id })
			.from(eventTable)
			.where(and(eq(eventTable.id, dados.eventId), eq(eventTable.teamId, actor.teamId)))
			.limit(1);
		if (!e) return json({ erro: 'Evento não encontrado.' }, { status: 404 });
	}

	if (dados.personId) {
		const [p] = await banco
			.select({ id: personTable.id })
			.from(personTable)
			.where(and(eq(personTable.id, dados.personId), eq(personTable.teamId, actor.teamId)))
			.limit(1);
		if (!p) return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });
	}

	// RN-22: valida valor mínimo de contribuição (doação nunca tem mínimo)
	if (dados.kind === 'entrada' && !categoria.isDonation) {
		const regras = await banco
			.select()
			.from(contributionRule)
			.where(
				and(
					eq(contributionRule.teamId, actor.teamId),
					eq(contributionRule.categoryId, categoria.id),
					eq(contributionRule.active, true)
				)
			);

		if (regras.length > 0) {
			let papeisContribuinte = new Set<string>();
			if (dados.personId) {
				const papeis = await banco
					.select({ key: roleTable.key })
					.from(personRoleTable)
					.innerJoin(roleTable, eq(roleTable.id, personRoleTable.roleId))
					.where(eq(personRoleTable.personId, dados.personId));
				papeisContribuinte = new Set(papeis.map((p) => p.key));
			}

			const regraAplicavel =
				regras.find((r) => r.roleKey !== null && papeisContribuinte.has(r.roleKey)) ??
				regras.find((r) => r.roleKey === null);

			if (regraAplicavel && dados.amountCents < regraAplicavel.minAmountCents) {
				return json(
					{
						erro: `O valor mínimo para "${categoria.name}" é ${formatarCentavos(regraAplicavel.minAmountCents)}.`
					},
					{ status: 400 }
				);
			}
		}
	}

	// RN-23 & RN-29: aprovação de despesas nasce desligada
	const aprovacaoLigada = await flagAtiva(banco, actor.teamId, 'aprovacao_despesas');
	const precisaAprovacao =
		dados.kind === 'saida' &&
		aprovacaoLigada &&
		!can(actor, 'finance.approve', { groupId: dados.groupId ?? null });

	const statusInicial = precisaAprovacao ? 'pendente_aprovacao' : 'confirmada';

	const [criada] = await banco
		.insert(financeTransaction)
		.values({
			teamId: actor.teamId,
			accountId: dados.accountId ?? null,
			categoryId: dados.categoryId,
			kind: dados.kind,
			amountCents: dados.amountCents,
			occurredAt: dados.occurredAt ? new Date(dados.occurredAt) : new Date(),
			paymentMethod: dados.paymentMethod,
			description: dados.description,
			responsiblePersonId: actor.personId,
			personId: dados.personId ?? null,
			eventId: dados.eventId ?? null,
			groupId: dados.groupId ?? null,
			receiptUrl: dados.receiptUrl ? dados.receiptUrl : null,
			status: statusInicial
		})
		.returning();

	if (!criada) {
		return json({ erro: 'Não foi possível registrar a movimentação.' }, { status: 500 });
	}

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'finance.transaction_created',
		entity: 'finance_transaction',
		entityId: criada.id,
		after: {
			kind: criada.kind,
			amountCents: criada.amountCents,
			status: criada.status,
			categoryId: criada.categoryId,
			groupId: criada.groupId,
			eventId: criada.eventId
		}
	});

	return json(
		{
			ok: true,
			movimentacao: criada,
			mensagem:
				statusInicial === 'pendente_aprovacao'
					? 'Despesa registrada e enviada para aprovação.'
					: 'Movimentação registrada no livro-caixa.'
		},
		{ status: 201 }
	);
};
