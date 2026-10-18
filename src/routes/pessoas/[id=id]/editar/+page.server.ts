import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can, PolicyDenied } from '$server/policy/policy';
import {
	atualizarPessoa,
	PessoaNaoEncontrada,
	RegimeRestrito,
	verPessoa
} from '$server/modules/pessoas/pessoas';
import { contextoDaPessoa } from '$server/modules/grupos/contexto';
import { atualizarPessoaSchema } from '$server/modules/pessoas/validacao';
import type { FalhaDeFormulario } from '$shared/formulario';
import type { Actions, PageServerLoad } from './$types';

/** Formato único das falhas desta rota — ver `$shared/formulario`. */
type Falha = FalhaDeFormulario<{ camposBloqueados: string[] }>;

/**
 * Edição de pessoa.
 *
 * PERMISSÃO: `person.update` NO ESCOPO desta pessoa.
 *
 * Diferente da lista, aqui existe um alvo concreto, então a verificação é com
 * contexto: a pessoa e o grupo em que ela está (D-M04-4). O conselheiro edita
 * quem está no próprio PG; quem está sem grupo só é editado por escopo global.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.actor) redirect(303, '/entrar');

	if (!can(locals.actor, 'person.update', await contextoDaPessoa(db(), params.id))) {
		redirect(303, `/pessoas/${params.id}`);
	}

	const detalhe = await verPessoa(db(), locals.actor, params.id);
	if (!detalhe) error(404, 'Pessoa não encontrada.');

	return { pessoa: detalhe };
};

export const actions: Actions = {
	default: async ({ request, locals, params, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');

		if (!can(locals.actor, 'person.update', await contextoDaPessoa(db(), params.id))) {
			const falha: Falha = { erro: 'Você não tem permissão para editar esta pessoa.' };
			return fail(403, falha);
		}

		const form = await request.formData();
		const bruto = Object.fromEntries(form) as Record<string, string>;

		const parsed = atualizarPessoaSchema.safeParse(bruto);

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

		try {
			await atualizarPessoa(db(), locals.actor, params.id, parsed.data, {
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
		} catch (erro) {
			if (erro instanceof RegimeRestrito) {
				const falha: Falha = {
					valores: bruto,
					erro: erro.message,
					camposBloqueados: erro.campos
				};
				return fail(422, falha);
			}
			// Nascimento ou contato enviados por quem não os vê (o formulário
			// nem os mostra): recusa na tela, não página de erro 500.
			if (erro instanceof PolicyDenied) {
				const falha: Falha = {
					valores: bruto,
					erro: 'Você não pode alterar o nascimento nem o contato desta pessoa.'
				};
				return fail(403, falha);
			}
			if (erro instanceof PessoaNaoEncontrada) error(404, erro.message);
			throw erro;
		}

		redirect(303, `/pessoas/${params.id}`);
	}
};
