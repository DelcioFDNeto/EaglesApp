import { redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can, canAnywhere, groupsWhere } from '$server/policy/policy';
import { agendaDoMes, fusoDaEquipe, type EscopoDaAgenda } from '$server/modules/eventos/eventos';
import { gruposAtivos } from '$server/modules/grupos/grupos';
import { ehMes, hojeNoFuso, somarMeses } from '$shared/fuso';
import type { PageServerLoad } from './$types';

/**
 * Agenda (RF-05.4) — uma lista por dia, navegável por mês: o formato que cabe
 * num celular.
 *
 * PERMISSÃO: `event.view` em qualquer escopo. O que cada um vê é a regra de
 * D-M05-7, aplicada pelo serviço. Os filtros oferecidos aqui são só os que
 * fazem sentido para quem olha — o serviço recusaria o resto de qualquer jeito.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!canAnywhere(locals.actor, 'event.view')) redirect(303, '/inicio');

	const banco = db();
	const actor = locals.actor;
	const fuso = await fusoDaEquipe(banco, actor.teamId);
	const hoje = hojeNoFuso(fuso);
	const mesAtual = hoje.slice(0, 7);

	const pedido = url.searchParams.get('mes') ?? '';
	const mes = ehMes(pedido) ? pedido : mesAtual;

	// Filtros: "minha agenda" para todos; "tudo" para quem vê a equipe
	// inteira; cada grupo que a pessoa acompanha.
	const vejoTudo = can(actor, 'event.view');
	const grupos = vejoTudo
		? await gruposAtivos(banco, actor.teamId)
		: (await gruposAtivos(banco, actor.teamId)).filter((g) =>
				groupsWhere(actor, 'event.view').includes(g.id)
			);

	const opcoes = [
		{ valor: 'minha', rotulo: 'Minha agenda' },
		...(vejoTudo ? [{ valor: 'tudo', rotulo: 'Toda a equipe' }] : []),
		...grupos.map((g) => ({ valor: g.id, rotulo: g.nome }))
	];

	const ver = url.searchParams.get('ver') ?? 'minha';
	const escolhida = opcoes.find((o) => o.valor === ver)?.valor ?? 'minha';
	const escopo: EscopoDaAgenda =
		escolhida === 'minha'
			? { tipo: 'minha' }
			: escolhida === 'tudo'
				? { tipo: 'tudo' }
				: { tipo: 'grupo', groupId: escolhida };

	const dias = await agendaDoMes(banco, actor, mes, escopo);

	return {
		mes,
		anterior: somarMeses(mes, -1),
		seguinte: somarMeses(mes, 1),
		ehMesAtual: mes === mesAtual,
		hoje,
		ver: escolhida,
		opcoes,
		dias: dias.map((d) => ({
			data: d.data,
			eventos: d.eventos.map((e) => ({
				...e,
				inicio: e.inicio.toISOString(),
				fim: e.fim?.toISOString() ?? null
			}))
		})),
		podeCriar: canAnywhere(actor, 'event.manage')
	};
};
