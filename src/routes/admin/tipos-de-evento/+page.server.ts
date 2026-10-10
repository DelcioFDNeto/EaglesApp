import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can } from '$server/policy/policy';
import { arquivarTipo, atualizarTipo, criarTipo, listarTipos } from '$server/modules/eventos/tipos';
import { tipoSchema } from '$server/modules/eventos/validacao';
import { EventoRecusado, statusDaRecusaDeEvento } from '$server/modules/eventos/regras';
import type { FalhaDeFormulario } from '$shared/formulario';
import type { Actions, PageServerLoad } from './$types';

/**
 * Tipos de evento (RF-05.1, RN-10).
 *
 * PERMISSÃO: `settings.manage` GLOBAL — é configuração da equipe inteira.
 */

const NEGADO = 'Configurar tipos de evento é tarefa de quem administra o sistema.';

type Falha = FalhaDeFormulario<{ tipoId: string; sucesso: string }>;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!can(locals.actor, 'settings.manage')) error(403, NEGADO);

	return { tipos: await listarTipos(db(), locals.actor.teamId, { incluirArquivados: true }) };
};

function ler(form: FormData) {
	const valores = {
		nome: String(form.get('nome') ?? ''),
		cor: String(form.get('cor') ?? ''),
		ehEncontroDoGrupo: form.get('ehEncontroDoGrupo') === 'sim' ? 'sim' : ''
	};
	return {
		valores,
		parsed: tipoSchema.safeParse({
			...valores,
			ehEncontroDoGrupo: valores.ehEncontroDoGrupo === 'sim'
		})
	};
}

function requisicao(request: Request, ip: string) {
	return { ip, userAgent: request.headers.get('user-agent') };
}

async function executar(tipoId: string, acao: () => Promise<Falha>) {
	try {
		return await acao();
	} catch (erro) {
		if (erro instanceof EventoRecusado) {
			return fail(statusDaRecusaDeEvento(erro.motivo), {
				tipoId,
				erro: erro.message
			} satisfies Falha);
		}
		throw erro;
	}
}

export const actions: Actions = {
	criar: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'settings.manage')) error(403, NEGADO);

		const { valores, parsed } = ler(await request.formData());
		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			return fail(400, {
				tipoId: 'novo',
				valores,
				erros: Object.fromEntries(Object.entries(campos).map(([c, m]) => [c, m?.[0]]))
			} satisfies Falha);
		}
		const actor = locals.actor;
		return executar('novo', async () => {
			await criarTipo(db(), actor, parsed.data, requisicao(request, getClientAddress()));
			return { sucesso: `Tipo "${parsed.data.nome}" criado.` };
		});
	},

	salvar: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'settings.manage')) error(403, NEGADO);

		const form = await request.formData();
		const tipoId = String(form.get('tipoId') ?? '');
		const { valores, parsed } = ler(form);
		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			return fail(400, {
				tipoId,
				valores,
				erros: Object.fromEntries(Object.entries(campos).map(([c, m]) => [c, m?.[0]]))
			} satisfies Falha);
		}
		const actor = locals.actor;
		return executar(tipoId, async () => {
			await atualizarTipo(
				db(),
				actor,
				tipoId,
				parsed.data,
				requisicao(request, getClientAddress())
			);
			return { sucesso: 'Tipo atualizado.' };
		});
	},

	arquivar: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'settings.manage')) error(403, NEGADO);

		const form = await request.formData();
		const tipoId = String(form.get('tipoId') ?? '');
		const arquivar = form.get('arquivar') === 'sim';
		const actor = locals.actor;
		return executar(tipoId, async () => {
			await arquivarTipo(db(), actor, tipoId, arquivar, requisicao(request, getClientAddress()));
			return { sucesso: arquivar ? 'Tipo arquivado.' : 'Tipo reativado.' };
		});
	}
};
