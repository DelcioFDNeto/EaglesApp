import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can } from '$server/policy/policy';
import { atualizarGrupo, verGrupo } from '$server/modules/grupos/grupos';
import { GrupoRecusado, statusDaRecusaDeGrupo } from '$server/modules/grupos/regras';
import { lerDadosDoGrupo } from '$server/modules/grupos/validacao';
import type { FalhaDeFormulario } from '$shared/formulario';
import type { Actions, PageServerLoad } from './$types';

/**
 * Editar o combinado do grupo.
 *
 * PERMISSÃO: `group.manage` NO ESCOPO deste grupo. É o que o conselheiro
 * recebeu na semente do M04: ajustar dia, horário e local do próprio PG
 * (D-M04-3).
 */

const NEGADO = 'Você não pode editar este grupo.';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!can(locals.actor, 'group.manage', { groupId: params.id })) error(403, NEGADO);

	const grupo = await verGrupo(db(), locals.actor, params.id);
	if (!grupo) error(404, 'Grupo não encontrado.');
	if (grupo.arquivadoEm) redirect(303, `/grupos/${params.id}`);

	return {
		grupo: { id: grupo.id, nome: grupo.nome },
		valores: {
			name: grupo.nome,
			color: grupo.cor ?? '',
			description: grupo.descricao ?? '',
			meetingWeekday: grupo.diaDaSemana === null ? '' : String(grupo.diaDaSemana),
			meetingTime: grupo.horario?.slice(0, 5) ?? '',
			location: grupo.local ?? ''
		}
	};
};

export const actions: Actions = {
	default: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'group.manage', { groupId: params.id })) error(403, NEGADO);

		const lido = lerDadosDoGrupo(await request.formData());
		if (!lido.ok) {
			return fail(400, { valores: lido.valores, erros: lido.erros } satisfies FalhaDeFormulario);
		}

		try {
			await atualizarGrupo(db(), locals.actor, params.id, lido.dados, {
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
		} catch (erro) {
			if (erro instanceof GrupoRecusado) {
				return fail(statusDaRecusaDeGrupo(erro.motivo), {
					valores: lido.valores,
					erro: erro.motivo === 'nome_em_uso' ? undefined : erro.message,
					erros: erro.motivo === 'nome_em_uso' ? { name: erro.message } : {}
				} satisfies FalhaDeFormulario);
			}
			throw erro;
		}

		redirect(303, `/grupos/${params.id}?salvo=1`);
	}
};
