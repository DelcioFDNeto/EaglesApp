import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can } from '$server/policy/policy';
import { criarGrupo } from '$server/modules/grupos/grupos';
import { GrupoRecusado, statusDaRecusaDeGrupo } from '$server/modules/grupos/regras';
import { lerDadosDoGrupo } from '$server/modules/grupos/validacao';
import type { FalhaDeFormulario } from '$shared/formulario';
import type { Actions, PageServerLoad } from './$types';

/**
 * Novo grupo.
 *
 * PERMISSÃO: `group.manage` GLOBAL. Grupo novo ainda não é escopo de ninguém,
 * então o escopo de grupo não teria sobre o que valer (D-M04-3).
 */

const NEGADO = 'Criar grupos é tarefa da liderança geral.';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!can(locals.actor, 'group.manage')) error(403, NEGADO);
	return {};
};

export const actions: Actions = {
	default: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'group.manage')) error(403, NEGADO);

		const lido = lerDadosDoGrupo(await request.formData());
		if (!lido.ok) {
			return fail(400, { valores: lido.valores, erros: lido.erros } satisfies FalhaDeFormulario);
		}

		let id: string;
		try {
			id = await criarGrupo(db(), locals.actor, lido.dados, {
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
		} catch (erro) {
			if (erro instanceof GrupoRecusado) {
				return fail(statusDaRecusaDeGrupo(erro.motivo), {
					valores: lido.valores,
					erros: { name: erro.message }
				} satisfies FalhaDeFormulario);
			}
			throw erro;
		}

		redirect(303, `/grupos/${id}?criado=1`);
	}
};
