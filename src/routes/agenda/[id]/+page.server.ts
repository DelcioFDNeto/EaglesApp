import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { canAnywhere, PolicyDenied } from '$server/policy/policy';
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
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!canAnywhere(locals.actor, 'event.view')) redirect(303, '/inicio');

	const evento = await verEvento(db(), locals.actor, params.id);
	if (!evento) error(404, 'Evento não encontrado.');

	const link = linkPublico(evento.codigoPublico);
	const gerencia = podeGerenciar(locals.actor, evento.grupo?.id ?? null);

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
		podeGerenciar: gerencia,
		podePublicar: podePublicar(locals.actor, evento.grupo?.id ?? null),
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
