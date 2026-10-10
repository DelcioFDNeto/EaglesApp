import { error, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { canAnywhere, canGlobally, groupsWhere } from '$server/policy/policy';
import { listarGrupos } from '$server/modules/grupos/grupos';
import { listarTipos } from '$server/modules/eventos/tipos';
import { fusoDaEquipe } from '$server/modules/eventos/eventos';
import { relatorio } from '$server/modules/presenca/frequencia';
import { JANELA_DE_FREQUENCIA_SEMANAS } from '$server/modules/presenca/calculo';
import { diasEntre, ehData, hojeNoFuso, instanteLocal, somarDias } from '$shared/fuso';
import type { PageServerLoad } from './$types';

/**
 * Relatório de frequência (RF-06.3, D-M06-7, D-M06-8).
 *
 * PERMISSÃO: `attendance.report` em algum escopo para chegar aqui. O escopo
 * de verdade é do serviço: sem grupo, só quem tem a permissão global (a
 * liderança); o conselheiro escolhe entre os grupos dele — e começa no
 * primeiro, em vez de receber uma recusa.
 *
 * Filtros por GET: o endereço é o relatório, e funciona sem JavaScript.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!canAnywhere(locals.actor, 'attendance.report')) {
		error(403, 'O relatório de frequência é para quem cuida de um grupo.');
	}

	const banco = db();
	const actor = locals.actor;
	const [fuso, grupos, tipos] = await Promise.all([
		fusoDaEquipe(banco, actor.teamId),
		listarGrupos(banco, actor),
		listarTipos(banco, actor.teamId)
	]);

	const todos = canGlobally(actor, 'attendance.report');
	const meus = new Set(groupsWhere(actor, 'attendance.report'));
	const gruposDoEscopo = grupos.filter((g) => todos || meus.has(g.id));

	// --- Filtros, com padrão sensato para cada um ---------------------------
	const hoje = hojeNoFuso(fuso);
	const p = url.searchParams;
	let ate = ehData(p.get('ate') ?? '') ? p.get('ate')! : hoje;
	let de = ehData(p.get('de') ?? '')
		? p.get('de')!
		: somarDias(ate, -JANELA_DE_FREQUENCIA_SEMANAS * 7 + 1);
	if (de > ate) [de, ate] = [ate, de];
	// Um ano no máximo: o cálculo é em memória (ver `frequencia.ts`).
	if (diasEntre(de, ate) > 366) de = somarDias(ate, -366);

	const pedido = p.get('grupo') ?? '';
	const grupoId = gruposDoEscopo.some((g) => g.id === pedido)
		? pedido
		: todos
			? null
			: (gruposDoEscopo[0]?.id ?? null);
	if (!todos && !grupoId) {
		error(403, 'Você ainda não cuida de nenhum grupo ativo.');
	}

	const tipoPedido = p.get('tipo') ?? '';
	const tipoId = tipos.some((t) => t.id === tipoPedido) ? tipoPedido : null;

	const dados = await relatorio(banco, actor, {
		de: instanteLocal(de, '00:00', fuso),
		ate: instanteLocal(somarDias(ate, 1), '00:00', fuso),
		grupoId,
		tipoId
	});

	return {
		filtro: { de, ate, grupo: grupoId ?? '', tipo: tipoId ?? '' },
		hoje,
		podeVerTodos: todos,
		grupos: gruposDoEscopo.map((g) => ({ valor: g.id, rotulo: g.nome })),
		tipos: tipos.map((t) => ({ valor: t.id, rotulo: t.nome })),
		...dados
	};
};
