import { fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { canAnywhere } from '$server/policy/policy';
import { criarPessoa, RegimeRestrito } from '$server/modules/pessoas/pessoas';
import { criarPessoaSchema } from '$server/modules/pessoas/validacao';
import {
	mensagemDeDuplicata,
	procurarPossiveisDuplicatas
} from '$server/modules/pessoas/duplicidade';
import { listarEstagios } from '$server/modules/pessoas/status';
import type { FalhaDeFormulario } from '$shared/formulario';
import type { PossivelDuplicata } from '$server/modules/pessoas/duplicidade';
import type { Actions, PageServerLoad } from './$types';

/** Formato único das falhas desta rota — ver `$shared/formulario`. */
type Falha = FalhaDeFormulario<{
	duplicatas: PossivelDuplicata[];
	avisoDeDuplicata: string;
	camposBloqueados: string[];
}>;

/**
 * Cadastro de pessoa.
 *
 * PERMISSÃO: `person.create` em qualquer escopo — quem ainda não existe não
 * pertence a grupo nenhum, então não há escopo de grupo a verificar.
 *
 * O formulário segue RN-05: **só o nome é obrigatório**. Tudo o mais fica atrás
 * de "adicionar mais informações", porque quem cadastra costuma estar em pé, na
 * porta do PG, com o celular numa mão.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.actor) redirect(303, '/entrar');

	if (!canAnywhere(locals.actor, 'person.create')) {
		redirect(303, '/pessoas');
	}

	const estagios = await listarEstagios(db(), locals.actor.teamId);

	return {
		estagios: estagios
			.filter((e) => !e.isTerminal)
			.map((e) => ({ valor: e.id, rotulo: e.name, padrao: e.isDefault }))
	};
};

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'person.create')) {
			const falha: Falha = { erro: 'Você não tem permissão para cadastrar pessoas.' };
			return fail(403, falha);
		}

		const form = await request.formData();
		const bruto = Object.fromEntries(form) as Record<string, string>;

		const parsed = criarPessoaSchema.safeParse(bruto);

		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			const falha: Falha = {
				valores: bruto,
				erros: Object.fromEntries(
					Object.entries(campos).map(([campo, mensagens]) => [campo, mensagens?.[0]])
				)
			};
			return fail(400, falha);
		}

		const banco = db();

		// Duplicidade AVISA, não bloqueia (RF-02.6). Na primeira tentativa o
		// aviso volta para a tela; se a pessoa confirmar, o cadastro segue.
		const confirmouDuplicata = form.get('confirmar_duplicata') === 'sim';

		if (!confirmouDuplicata) {
			const duplicatas = await procurarPossiveisDuplicatas(banco, locals.actor.teamId, parsed.data);
			if (duplicatas.length > 0) {
				const falha: Falha = {
					valores: bruto,
					duplicatas,
					avisoDeDuplicata: mensagemDeDuplicata(duplicatas)
				};
				return fail(409, falha);
			}
		}

		let novaPessoaId: string;

		try {
			novaPessoaId = await criarPessoa(banco, locals.actor, parsed.data, {
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
		} catch (erro) {
			// RN-30 — o serviço recusou guardar contato de quem está em regime
			// restrito. A recusa é explícita para que quem digitou saiba que o
			// dado NÃO foi guardado; descartar em silêncio seria pior.
			if (erro instanceof RegimeRestrito) {
				const falha: Falha = {
					valores: bruto,
					erro: erro.message,
					camposBloqueados: erro.campos
				};
				return fail(422, falha);
			}
			throw erro;
		}

		redirect(303, `/pessoas/${novaPessoaId}?criada=1`);
	}
};
