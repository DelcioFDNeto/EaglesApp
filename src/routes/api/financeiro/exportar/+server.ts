import { json } from '@sveltejs/kit';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '$server/db';
import {
	event as eventTable,
	financeCategory,
	financeTransaction,
	group as groupTable,
	person as personTable
} from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import { gerarCsvPrestacaoDeContas } from '$server/financeiro/calculos';

const SOMENTE_DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDataInicio(valor: string | null): Date | null {
	if (!valor) return null;
	const alvo = SOMENTE_DATA_RE.test(valor) ? `${valor}T00:00:00.000Z` : valor;
	const ts = Date.parse(alvo);
	return Number.isNaN(ts) ? null : new Date(ts);
}

function parseDataFim(valor: string | null): Date | null {
	if (!valor) return null;
	const alvo = SOMENTE_DATA_RE.test(valor) ? `${valor}T23:59:59.999Z` : valor;
	const ts = Date.parse(alvo);
	return Number.isNaN(ts) ? null : new Date(ts);
}

/**
 * Exporta prestação de contas em CSV respeitando RN-24 e filtros ativos (RF-08.11 / §14).
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
		return json({ erro: 'Sem permissão para exportar dados financeiros.' }, { status: 403 });
	}

	const filtros = [eq(financeTransaction.teamId, actor.teamId)];
	const dataDe = parseDataInicio(url.searchParams.get('de'));
	const dataAte = parseDataFim(url.searchParams.get('ate'));
	const tipo = url.searchParams.get('tipo');
	const categoriaId = url.searchParams.get('categoriaId');
	const responsavelId = url.searchParams.get('responsavelId');
	const eventoId = url.searchParams.get('eventoId');
	const grupoId = url.searchParams.get('grupoId');

	if (dataDe) {
		filtros.push(gte(financeTransaction.occurredAt, dataDe));
	}
	if (dataAte) {
		filtros.push(lte(financeTransaction.occurredAt, dataAte));
	}
	if (tipo === 'entrada' || tipo === 'saida') {
		filtros.push(eq(financeTransaction.kind, tipo));
	}
	if (categoriaId && isUuid(categoriaId)) {
		filtros.push(eq(financeTransaction.categoryId, categoriaId));
	}
	if (responsavelId && isUuid(responsavelId)) {
		filtros.push(eq(financeTransaction.responsiblePersonId, responsavelId));
	}
	if (eventoId && isUuid(eventoId)) {
		filtros.push(eq(financeTransaction.eventId, eventoId));
	}
	if (grupoId && isUuid(grupoId)) {
		filtros.push(eq(financeTransaction.groupId, grupoId));
	}

	const linhas = await banco
		.select({
			occurredAt: financeTransaction.occurredAt,
			kind: financeTransaction.kind,
			categoryName: financeCategory.name,
			description: financeTransaction.description,
			paymentMethod: financeTransaction.paymentMethod,
			amountCents: financeTransaction.amountCents,
			status: financeTransaction.status,
			responsibleName: personTable.fullName,
			groupId: financeTransaction.groupId,
			groupName: groupTable.name,
			eventTitle: eventTable.title,
			personId: financeTransaction.personId,
			reversesTransactionId: financeTransaction.reversesTransactionId
		})
		.from(financeTransaction)
		.innerJoin(financeCategory, eq(financeCategory.id, financeTransaction.categoryId))
		.innerJoin(personTable, eq(personTable.id, financeTransaction.responsiblePersonId))
		.leftJoin(groupTable, eq(groupTable.id, financeTransaction.groupId))
		.leftJoin(eventTable, eq(eventTable.id, financeTransaction.eventId))
		.where(and(...filtros))
		.orderBy(desc(financeTransaction.occurredAt), desc(financeTransaction.createdAt));

	const visiveis = linhas.filter((m) => {
		if (podeVerTudo || podeVerGrupoGlobal) return true;
		if (gruposVisiveis.length > 0) {
			return (
				(m.groupId !== null && gruposVisiveis.includes(m.groupId)) || m.personId === actor.personId
			);
		}
		return m.personId === actor.personId;
	});

	const csv = gerarCsvPrestacaoDeContas(
		visiveis.map((m) => ({
			data: new Date(m.occurredAt).toLocaleDateString('pt-BR'),
			tipo: m.kind,
			categoria: m.categoryName,
			descricao: m.description,
			metodo: m.paymentMethod,
			valorCents: m.amountCents,
			status: m.status,
			responsavel: m.responsibleName,
			grupo: m.groupName,
			evento: m.eventTitle,
			estornoDe: m.reversesTransactionId
		}))
	);

	return new Response(csv, {
		status: 200,
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': 'attachment; filename="prestacao-de-contas-eagles.csv"'
		}
	});
};
