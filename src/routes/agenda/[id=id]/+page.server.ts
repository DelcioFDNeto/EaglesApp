import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can, canAnywhere, PolicyDenied } from '$server/policy/policy';
import { paineisDeResposta } from '$server/modules/presenca/painel';
import { quemRespondeu, responder } from '$server/modules/presenca/rsvp';
import { confirmacaoXPresenca } from '$server/modules/presenca/frequencia';
import { fusoDaEquipe } from '$server/modules/eventos/eventos';
import { dataNoFuso, hojeNoFuso } from '$shared/fuso';
import {
	cancelarEvento,
	publicarEvento,
	reativarEvento,
	verEvento
} from '$server/modules/eventos/eventos';
import {
	EventoRecusado,
	podeGerenciar,
	podePublicar,
	statusDaRecusaDeEvento
} from '$server/modules/eventos/regras';
import { linkDoWhatsapp, linkPublico, textoDoEvento } from '$server/modules/eventos/compartilhar';
import type { Actions, PageServerLoad } from './$types';

/**
 * Um evento.
 *
 * PERMISSÃO: `event.view` em qualquer escopo para chegar aqui; ver ESTE
 * evento é a regra de D-M05-7, aplicada pelo serviço — evento que a pessoa
 * não pode ver responde 404, como se não existisse, e não 403: um "proibido"
 * confirmaria que há algo ali.
 *
 * Gerenciar (editar, cancelar) é `event.manage` no grupo do evento; publicar,
 * `event.publish` ali.
 *
 * Responder ("você vai?") é de quem vê o evento, por si (D-M06-3). Ver QUEM
 * respondeu e quem esteve é `attendance.view` no grupo do evento (D-M06-8).
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!canAnywhere(locals.actor, 'event.view')) redirect(303, '/inicio');

	const banco = db();
	const actor = locals.actor;
	const evento = await verEvento(banco, actor, params.id);
	if (!evento) error(404, 'Evento não encontrado.');

	const link = linkPublico(evento.codigoPublico);
	const gerencia = podeGerenciar(actor, evento.grupo?.id ?? null);
	const grupoDoEvento = { groupId: evento.grupo?.id ?? null };

	const [paineis, nomes, confirmacao, fuso] = await Promise.all([
		paineisDeResposta(banco, actor, [evento], { comTotais: true }),
		quemRespondeu(banco, actor, evento.id),
		confirmacaoXPresenca(banco, actor, evento.id),
		fusoDaEquipe(banco, actor.teamId)
	]);

	return {
		evento: {
			...evento,
			inicio: evento.inicio.toISOString(),
			fim: evento.fim?.toISOString() ?? null
		},
		// O link público só existe para evento publicado (D-M05-8).
		compartilhar: evento.publicado
			? { link, whatsapp: linkDoWhatsapp(textoDoEvento(evento, link)) }
			: null,
		resposta: paineis.get(evento.id)!,
		quemRespondeu: nomes?.map((n) => ({ ...n, quando: n.quando.toISOString() })) ?? null,
		confirmacao,
		// A lista se faz no dia do encontro ou depois (D-M06-6).
		podeFazerLista:
			can(actor, 'attendance.record', grupoDoEvento) &&
			evento.publicado &&
			!evento.cancelado &&
			dataNoFuso(evento.inicio, fuso) <= hojeNoFuso(fuso),
		podeGerenciar: gerencia,
		podePublicar: podePublicar(actor, evento.grupo?.id ?? null),
		criado: url.searchParams.get('criado') === '1',
		salvo: url.searchParams.get('salvo') === '1'
	};
};

type Resultado = { erro?: string; sucesso?: string };

async function executar(acao: () => Promise<Resultado>) {
	try {
		return await acao();
	} catch (erro) {
		if (erro instanceof EventoRecusado) {
			return fail(statusDaRecusaDeEvento(erro.motivo), { erro: erro.message } satisfies Resultado);
		}
		if (erro instanceof PolicyDenied) {
			return fail(403, {
				erro: 'Você não tem permissão para isso neste evento.'
			} satisfies Resultado);
		}
		throw erro;
	}
}

function requisicao(request: Request, ip: string) {
	return { ip, userAgent: request.headers.get('user-agent') };
}

export const actions: Actions = {
	/** "Você vai?" — em um toque (RF-06.1). */
	responder: async ({ locals, params, request }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'event.view')) error(403, 'Sem permissão para responder.');
		const form = await request.formData();
		const respostaId = String(form.get('respostaId') ?? '');
		const convidados = Number(form.get('convidados') ?? 0) || 0;
		const actor = locals.actor;
		return executar(async () => {
			await responder(db(), actor, params.id, { respostaId, convidados });
			return { sucesso: 'Resposta registrada.' };
		});
	},

	// Cada ação começa por exigir uma permissão de evento em algum escopo — a
	// declaração da rota. A verificação de verdade, com o grupo do evento, é
	// do serviço.
	publicar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'event.publish')) error(403, 'Sem permissão para publicar.');
		const actor = locals.actor;
		return executar(async () => {
			await publicarEvento(db(), actor, params.id, requisicao(request, getClientAddress()));
			return { sucesso: 'Publicado. Quem foi convidado já vê na agenda.' };
		});
	},

	cancelar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'event.manage')) error(403, 'Sem permissão para cancelar.');
		const motivo = String((await request.formData()).get('motivo') ?? '')
			.trim()
			.slice(0, 200);
		const actor = locals.actor;
		return executar(async () => {
			await cancelarEvento(
				db(),
				actor,
				params.id,
				motivo || null,
				requisicao(request, getClientAddress())
			);
			return { sucesso: 'Evento cancelado. Ele continua na agenda, marcado como cancelado.' };
		});
	},

	reativar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'event.manage')) error(403, 'Sem permissão para reativar.');
		const actor = locals.actor;
		return executar(async () => {
			await reativarEvento(db(), actor, params.id, requisicao(request, getClientAddress()));
			return { sucesso: 'Evento reativado.' };
		});
	}
};
