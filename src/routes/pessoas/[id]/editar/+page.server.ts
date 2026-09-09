import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can } from '$server/policy/policy';
import { atualizarPessoa, RegimeRestrito, verPessoa } from '$server/modules/pessoas/pessoas';
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
 * Diferente da lista e do cadastro, aqui existe um alvo concreto, então a
 * verificação é com contexto. Enquanto os grupos não existirem (M04), o
 * contexto de grupo é sempre nulo e só quem tem escopo global passa — é o lado
 * seguro do erro: escrita é onde o estrago é irreversível.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.actor) redirect(303, '/entrar');

	if (!can(locals.actor, 'person.update', { personId: params.id })) {
		redirect(303, `/pessoas/${params.id}`);
	}

	const detalhe = await verPessoa(db(), locals.actor, params.id);
	if (!detalhe) error(404, 'Pessoa não encontrada.');

	return { pessoa: detalhe };
};

export const actions: Actions = {
	default: async ({ request, locals, params, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');

		if (!can(locals.actor, 'person.update', { personId: params.id })) {
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
			throw erro;
		}

		redirect(303, `/pessoas/${params.id}`);
	}
};
