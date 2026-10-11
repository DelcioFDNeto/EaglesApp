import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { canAnywhere, PolicyDenied } from '$server/policy/policy';
import { editarEvento, publicoDoEvento, verEvento } from '$server/modules/eventos/eventos';
import { ocorrenciaSchema, lerPublico } from '$server/modules/eventos/validacao';
import {
	EventoRecusado,
	podeGerenciar,
	statusDaRecusaDeEvento
} from '$server/modules/eventos/regras';
import type { FalhaDeFormulario } from '$shared/formulario';
import { opcoesDoFormulario, valoresDoFormulario } from '../../opcoes.server';
import type { Actions, PageServerLoad } from './$types';

/**
 * Editar um evento — ou UMA data de um encontro semanal, que então se
 * desprende da série (D-M05-4).
 *
 * PERMISSÃO: `event.manage` no grupo do evento (global, se for geral).
 */

type Falha = FalhaDeFormulario<{
	convite: { convite: string; grupos: string[]; pessoas: string[] };
}>;

const NEGADO = 'Você não pode editar este evento.';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!canAnywhere(locals.actor, 'event.manage')) error(403, NEGADO);

	const banco = db();
	const evento = await verEvento(banco, locals.actor, params.id);
	if (!evento) error(404, 'Evento não encontrado.');
	if (!podeGerenciar(locals.actor, evento.grupo?.id ?? null)) error(403, NEGADO);

	const [opcoes, publico] = await Promise.all([
		opcoesDoFormulario(banco, locals.actor),
		publicoDoEvento(banco, params.id)
	]);

	const ehEquipe = publico.some((a) => a.tipo === 'equipe');
	return {
		...opcoes,
		evento: { id: evento.id, titulo: evento.titulo, serieId: evento.serieId },
		valores: {
			titulo: evento.titulo,
			data: evento.data,
			// Só quando difere: o campo é o "termina em outro dia?".
			dataFim: evento.dataFim && evento.dataFim !== evento.data ? evento.dataFim : '',
			horaInicio: evento.hora,
			horaFim: evento.horaFim ?? '',
			local: evento.local ?? '',
			descricao: evento.descricao ?? '',
			responsavelId: evento.responsavel?.id ?? ''
		},
		convite: {
			convite: ehEquipe ? 'equipe' : 'escolhidos',
			grupos: publico.flatMap((a) => (a.tipo === 'grupo' ? [a.groupId] : [])),
			pessoas: publico.flatMap((a) => (a.tipo === 'pessoa' ? [a.personId] : []))
		}
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'event.manage')) error(403, NEGADO);

		const form = await request.formData();
		const { valores, convite } = valoresDoFormulario(form);
		const parsed = ocorrenciaSchema.safeParse(valores);
		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			return fail(400, {
				valores,
				convite,
				erros: Object.fromEntries(Object.entries(campos).map(([c, m]) => [c, m?.[0]]))
			} satisfies Falha);
		}

		try {
			await editarEvento(db(), locals.actor, params.id, parsed.data, lerPublico(form), {
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
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

		redirect(303, `/agenda/${params.id}?salvo=1`);
	}
};
