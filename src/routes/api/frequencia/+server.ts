import { json } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '$server/db';
import { group } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';
import {
	carregarDados,
	eventosDaEquipe,
	frequenciaDoPg,
	indexar,
	lerPeriodo
} from '$server/presenca/frequencia';

/**
 * Relatório de frequência (RF-06.3, RF-06.4).
 *
 *   ?grupo=<id>  — um PG: resumo, confirmação × presença, evolução por mês e
 *                  as pessoas do PG (em ordem alfabética, nunca ranking).
 *   sem grupo    — visão da equipe (só `attendance.report` global): um resumo
 *                  por PG, sem nomes, e os eventos da equipe toda por tipo.
 *   ?de=&ate=    — período (AAAA-MM-DD). Padrão: últimos 90 dias.
 *
 * Exige `attendance.report`: global, ou no PG pedido (conselheiro). Quem não
 * cuida do PG não vê a frequência de ninguém dele (persona "o fiscal").
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

	// PGs que a pessoa pode escolher no filtro.
	const grupos = await banco
		.select({ id: group.id, nome: group.name })
		.from(group)
		.where(
			and(
				eq(group.teamId, actor.teamId),
				isNull(group.archivedAt),
				global ? undefined : inArray(group.id, doEscopo)
			)
		)
		.orderBy(asc(group.name));

	let grupoId = url?.searchParams.get('grupo') ?? null;
	// Conselheiro de um PG só: é esse o relatório dele.
	if (!grupoId && !global && grupos.length === 1) grupoId = grupos[0]!.id;

	const dados = await carregarDados(banco, actor.teamId, periodo);
	const indice = indexar(dados);
	const base = { periodo, grupos, podeVerEquipe: global };

	if (grupoId) {
		if (!isUuid(grupoId)) return json({ erro: 'PG inválido.' }, { status: 400 });
		const [g] = await banco
			.select({ id: group.id, nome: group.name })
			.from(group)
			.where(and(eq(group.id, grupoId), eq(group.teamId, actor.teamId)))
			.limit(1);
		if (!g) return json({ erro: 'PG não encontrado.' }, { status: 404 });
		if (!can(actor, 'attendance.report', { groupId: g.id })) {
			return json({ erro: 'Sem permissão para ver a frequência deste PG.' }, { status: 403 });
		}
		return json({ ...base, escopo: 'pg', grupo: g, ...frequenciaDoPg(g.id, dados, indice) });
	}

	if (!global) {
		return json({ erro: 'Escolha o PG.', ...base }, { status: 400 });
	}

	return json({
		...base,
		escopo: 'equipe',
		// Resumo por PG, sem a lista de pessoas: a visão geral não expõe ninguém.
		porPg: grupos.map((g) => {
			const { pessoas, ...resumo } = frequenciaDoPg(g.id, dados, indice);
			return { grupo: g, pessoasAcompanhadas: pessoas.length, ...resumo };
		}),
		eventosDaEquipe: eventosDaEquipe(dados, indice)
	});
};
