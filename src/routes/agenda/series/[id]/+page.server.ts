import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { canAnywhere, PolicyDenied } from '$server/policy/policy';
import {
	editarSerie,
	encerrarSerie,
	fusoDaEquipe,
	publicarSerie,
	verSerie
} from '$server/modules/eventos/eventos';
import { lerPublico, serieSchema } from '$server/modules/eventos/validacao';
import {
	EventoRecusado,
	podePublicar,
	statusDaRecusaDeEvento
} from '$server/modules/eventos/regras';
import { ehData, hojeNoFuso } from '$shared/fuso';
import type { FalhaDeFormulario } from '$shared/formulario';
import { opcoesDoFormulario, valoresDoFormulario } from '../../opcoes.server';
import type { Actions, PageServerLoad } from './$types';

/**
 * Encontro semanal (D-M05-4).
 *
 * PERMISSÃO: `event.manage` no grupo da série (global, se for geral). Editar
 * aqui alcança as datas futuras que não foram ajustadas à parte; mudar o dia
 * da semana é encerrar esta série e criar outra.
 */

type Falha = FalhaDeFormulario<{
	convite: { convite: string; grupos: string[]; pessoas: string[] };
	sucesso: string;
}>;

const NEGADO = 'Você não pode gerenciar este encontro semanal.';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!canAnywhere(locals.actor, 'event.manage')) error(403, NEGADO);

	const banco = db();
	let serie;
	try {
		serie = await verSerie(banco, locals.actor, params.id);
	} catch (erro) {
		if (erro instanceof PolicyDenied) error(403, NEGADO);
		throw erro;
	}
	if (!serie) error(404, 'Encontro semanal não encontrado.');

	const [opcoes, fuso] = await Promise.all([
		opcoesDoFormulario(banco, locals.actor),
		fusoDaEquipe(banco, locals.actor.teamId)
	]);
	const ehEquipe = serie.publico.some((a) => a.tipo === 'equipe');

	return {
		...opcoes,
		serie: {
			...serie,
			proximas: serie.proximas.map((e) => ({
				...e,
				inicio: e.inicio.toISOString(),
				fim: e.fim?.toISOString() ?? null
			}))
		},
		valores: {
			titulo: serie.titulo,
			horaInicio: serie.hora,
			horaFim: serie.horaFim ?? '',
			local: serie.local ?? '',
			descricao: serie.descricao ?? '',
			responsavelId: serie.responsavelId ?? ''
		},
		convite: {
			convite: ehEquipe ? 'equipe' : 'escolhidos',
			grupos: serie.publico.flatMap((a) => (a.tipo === 'grupo' ? [a.groupId] : [])),
			pessoas: serie.publico.flatMap((a) => (a.tipo === 'pessoa' ? [a.personId] : []))
		},
		hoje: hojeNoFuso(fuso),
		podePublicar: podePublicar(locals.actor, serie.grupo?.id ?? null),
		criada: url.searchParams.get('criada') === '1'
	};
};

function requisicao(request: Request, ip: string) {
	return { ip, userAgent: request.headers.get('user-agent') };
}

export const actions: Actions = {
	salvar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'event.manage')) error(403, NEGADO);

		const form = await request.formData();
		const { valores, convite } = valoresDoFormulario(form);
		const parsed = serieSchema.safeParse(valores);
		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			return fail(400, {
				valores,
				convite,
				erros: Object.fromEntries(Object.entries(campos).map(([c, m]) => [c, m?.[0]]))
			} satisfies Falha);
		}

		try {
			const alcancadas = await editarSerie(
				db(),
				locals.actor,
				params.id,
				parsed.data,
				lerPublico(form),
				requisicao(request, getClientAddress())
			);
			return {
				sucesso:
					alcancadas === 1
						? 'Salvo. 1 data futura foi atualizada.'
						: `Salvo. ${alcancadas} datas futuras foram atualizadas.`
			} satisfies Falha;
		} catch (erro) {
			if (erro instanceof EventoRecusado) {
				const noConvite = erro.motivo === 'publico_fora_do_escopo' || erro.motivo === 'sem_publico';
				return fail(statusDaRecusaDeEvento(erro.motivo), {
					valores,
					convite,
					...(noConvite ? { erros: { convite: erro.message } } : { erro: erro.message })
				} satisfies Falha);
			}
			if (erro instanceof PolicyDenied) error(403, NEGADO);
			throw erro;
		}
	},

	publicar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'event.publish')) error(403, NEGADO);
		try {
			await publicarSerie(db(), locals.actor, params.id, requisicao(request, getClientAddress()));
		} catch (erro) {
			if (erro instanceof PolicyDenied) {
				return fail(403, { erro: 'Você não pode publicar este encontro.' } satisfies Falha);
			}
			throw erro;
		}
		return {
			sucesso: 'Publicado. As próximas datas já aparecem para quem foi convidado.'
		} satisfies Falha;
	},

	encerrar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'event.manage')) error(403, NEGADO);

		const aPartirDe = String((await request.formData()).get('aPartirDe') ?? '');
		if (!ehData(aPartirDe)) {
			return fail(400, { erros: { aPartirDe: 'Escolha a data.' } } satisfies Falha);
		}

		try {
			const removidas = await encerrarSerie(
				db(),
				locals.actor,
				params.id,
				aPartirDe,
				requisicao(request, getClientAddress())
			);
			return {
				sucesso:
					removidas === 1
						? 'Encerrado. 1 data futura saiu da agenda.'
						: `Encerrado. ${removidas} datas futuras saíram da agenda.`
			} satisfies Falha;
		} catch (erro) {
			if (erro instanceof EventoRecusado) {
				return fail(statusDaRecusaDeEvento(erro.motivo), {
					erros: { aPartirDe: erro.message }
				} satisfies Falha);
			}
			if (erro instanceof PolicyDenied) error(403, NEGADO);
			throw erro;
		}
	}
};
