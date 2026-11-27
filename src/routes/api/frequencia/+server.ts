import { json } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$server/db';
import { eventType, group } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import {
	carregarDados,
	eventosDaEquipe,
	frequenciaDaEquipe,
	frequenciaDoSubgrupo,
	indexar,
	lerPeriodo
} from '$server/presenca/frequencia';

/**
 * Relatório de frequência (RF-06.3, RF-06.4).
 *
 *   sem grupo      — visão da equipe (líderes e conselheiros com `attendance.report`
 *                    global): frequência dos PGs (ou do `?tipo=` escolhido) calculada
 *                    sobre os membros ativos dos Eagles em ordem alfabética (nunca
 *                    ranking), mais resumo dos outros eventos da equipe e por subgrupo.
 *   ?tipo=<id>     — filtra os eventos da equipe por tipo (`todos` = todos os tipos).
 *                    Sem `?tipo=`, o padrão é o tipo `pg` (PG — Pequeno Grupo).
 *   ?grupo=<id>    — encontros vinculados a um subgrupo específico: resumo,
 *                    confirmação × presença, evolução por mês e integrantes.
 *   ?de=&ate=      — período (AAAA-MM-DD). Padrão: últimos 90 dias.
 *
 * Exige `attendance.report` (global, ou no subgrupo pedido). Membros comuns
 * recebem 403 (persona negativa "o fiscal").
 */
export const GET = async ({ request, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });
	const { actor } = auth;

	const global = can(actor, 'attendance.report');
	const doEscopo = groupsWhere(actor, 'attendance.report');
	if (!global && doEscopo.length === 0) {
		return json({ erro: 'Sem permissão para ver relatórios de frequência.' }, { status: 403 });
	}

	const periodo = lerPeriodo(url);
	if (!periodo) {
		return json({ erro: 'Período inválido (máximo de 2 anos).' }, { status: 400 });
	}

	const [grupos, tiposRaw] = await Promise.all([
		banco
			.select({ id: group.id, nome: group.name })
			.from(group)
			.where(
				and(
					eq(group.teamId, actor.teamId),
					isNull(group.archivedAt),
					global ? undefined : inArray(group.id, doEscopo)
				)
			)
			.orderBy(asc(group.name)),
		banco
			.select({ id: eventType.id, nome: eventType.name, slug: eventType.slug })
			.from(eventType)
			.where(eq(eventType.teamId, actor.teamId))
			.orderBy(asc(eventType.name))
	]);

	// Tipo "PG (Pequeno Grupo)" vem sempre primeiro no filtro.
	const tipos = [...tiposRaw].sort((a, b) =>
		a.slug === 'pg' ? -1 : b.slug === 'pg' ? 1 : a.nome.localeCompare(b.nome, 'pt-BR')
	);

	let grupoId = url?.searchParams.get('grupo') ?? null;
	// Papel restrito a um único subgrupo: mostra direto o relatório dele.
	if (!grupoId && !global && grupos.length === 1) grupoId = grupos[0]!.id;

	const dados = await carregarDados(banco, actor.teamId, periodo);
	const indice = indexar(dados);
	const base = { periodo, grupos, tipos, podeVerEquipe: global };

	if (grupoId) {
		if (!isUuid(grupoId)) return json({ erro: 'Subgrupo inválido.' }, { status: 400 });
		const [g] = await banco
			.select({ id: group.id, nome: group.name })
			.from(group)
			.where(and(eq(group.id, grupoId), eq(group.teamId, actor.teamId)))
			.limit(1);
		if (!g) return json({ erro: 'Subgrupo não encontrado.' }, { status: 404 });
		if (!can(actor, 'attendance.report', { groupId: g.id })) {
			return json({ erro: 'Sem permissão para ver a frequência deste subgrupo.' }, { status: 403 });
		}
		return json({
			...base,
			escopo: 'subgrupo',
			grupo: g,
			...frequenciaDoSubgrupo(g.id, dados, indice)
		});
	}

	if (!global) {
		return json({ erro: 'Escolha o subgrupo.', ...base }, { status: 400 });
	}

	const tipoParam = url?.searchParams.get('tipo');
	let tipoSelecionado: { id: string; nome: string; slug: string } | null = null;
	if (tipoParam === 'todos') {
		tipoSelecionado = null;
	} else if (tipoParam) {
		if (!isUuid(tipoParam)) return json({ erro: 'Tipo de evento inválido.' }, { status: 400 });
		const encontrado = tipos.find((t) => t.id === tipoParam);
		if (!encontrado) return json({ erro: 'Tipo de evento não encontrado.' }, { status: 404 });
		tipoSelecionado = encontrado;
	} else {
		tipoSelecionado = tipos.find((t) => t.slug === 'pg') ?? null;
	}

	const resumoEquipe = frequenciaDaEquipe(
		dados,
		indice,
		tipoSelecionado ? { tipoId: tipoSelecionado.id } : {}
	);

	return json({
		...base,
		escopo: 'equipe',
		tipoSelecionado,
		...resumoEquipe,
		// Resumo por subgrupo (sem nomes individuais), quando houver encontros vinculados a subgrupos.
		porSubgrupo: grupos.map((g) => {
			const { pessoas, ...resumo } = frequenciaDoSubgrupo(g.id, dados, indice);
			return { grupo: g, pessoasAcompanhadas: pessoas.length, ...resumo };
		}),
		eventosDaEquipe: eventosDaEquipe(dados, indice, tipoSelecionado?.id ?? null)
	});
};
