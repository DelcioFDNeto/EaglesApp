import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can, PolicyDenied } from '$server/policy/policy';
import { gruposAtivos } from '$server/modules/grupos/grupos';
import {
	aplicar,
	codificarMovimento,
	lerMovimentos,
	lerPlano,
	planejar,
	situacaoAtual
} from '$server/modules/grupos/reorganizacao';
import { GrupoRecusado, statusDaRecusaDeGrupo } from '$server/modules/grupos/regras';
import type { PageServerLoad, Actions } from './$types';

/**
 * Reorganização em lote (RF-04.4, RN-09, D-M04-5).
 *
 * PERMISSÃO: `group.assign_member` GLOBAL. Reorganizar é mover gente entre
 * grupos, e só quem pode tirar e colocar em qualquer grupo enxerga a equipe
 * inteira de uma vez. Cada movimento é verificado de novo no serviço.
 *
 * Três passos, nenhum deles com JavaScript obrigatório:
 *   1. planejar — escolher o destino de cada pessoa (nada é gravado);
 *   2. conferir — ver o antes e depois de cada grupo e desmarcar o que não quer;
 *   3. aplicar — tudo numa transação; se o estado mudou, nada é aplicado.
 */

const NEGADO = 'Reorganizar os grupos é tarefa da liderança geral.';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!can(locals.actor, 'group.assign_member')) error(403, NEGADO);

	const banco = db();
	const [pessoas, grupos] = await Promise.all([
		situacaoAtual(banco, locals.actor),
		gruposAtivos(banco, locals.actor.teamId)
	]);

	return {
		pessoas,
		grupos: grupos.map((g) => ({ valor: g.id, rotulo: g.nome, cor: g.cor }))
	};
};

export const actions: Actions = {
	planejar: async ({ locals, request }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'group.assign_member')) error(403, NEGADO);

		const form = await request.formData();
		const pedidos = lerPlano(form);
		// O que a pessoa escolheu volta para a tela: conferir não pode custar
		// o trabalho de refazer as escolhas.
		const escolhas = Object.fromEntries(pedidos.map((p) => [p.personId, p.para ?? '']));

		try {
			const previa = await planejar(db(), locals.actor, pedidos);
			return {
				escolhas,
				previa: {
					...previa,
					movimentos: previa.movimentos.map((m) => ({ ...m, codigo: codificarMovimento(m) }))
				}
			};
		} catch (erro) {
			if (erro instanceof GrupoRecusado) {
				return fail(statusDaRecusaDeGrupo(erro.motivo), { escolhas, erro: erro.message });
			}
			throw erro;
		}
	},

	aplicar: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'group.assign_member')) error(403, NEGADO);

		const confirmados = lerMovimentos((await request.formData()).getAll('mov'));
		if (confirmados.length === 0) {
			return fail(400, { erro: 'Nenhuma mudança marcada. Nada foi aplicado.' });
		}

		try {
			const { movimentos } = await aplicar(db(), locals.actor, confirmados, {
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
			return {
				aplicado: movimentos.length
			};
		} catch (erro) {
			if (erro instanceof GrupoRecusado) {
				return fail(statusDaRecusaDeGrupo(erro.motivo), { erro: erro.message });
			}
			if (erro instanceof PolicyDenied) {
				return fail(403, { erro: 'Uma das mudanças envolve um grupo em que você não pode mexer.' });
			}
			throw erro;
		}
	}
};
