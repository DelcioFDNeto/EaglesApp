import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can } from '$server/policy/policy';
import { hasFreshReauth } from '$server/auth/session';
import { criarPapel, novoPapelSchema } from '$server/modules/rbac/papeis';
import { gruposDePermissoes } from '$server/modules/rbac/catalogo';
import { AcessoRecusado, statusDaRecusa } from '$server/modules/rbac/regras';
import type { FalhaDeFormulario } from '$shared/formulario';
import type { Actions, PageServerLoad } from './$types';

/**
 * Papel personalizado (RF-03.4).
 *
 * PERMISSÃO: `rbac.manage` global + reautenticação recente.
 */

type Falha = FalhaDeFormulario<{ permissoes: string[]; defaultScope: string }>;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.actor || !locals.session) redirect(303, '/entrar');
	if (!can(locals.actor, 'rbac.manage'))
		error(403, 'Você não tem permissão para administrar acessos.');

	return {
		grupos: gruposDePermissoes(locals.actor, new Set()),
		reautenticado: hasFreshReauth(locals.session)
	};
};

export const actions: Actions = {
	default: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor || !locals.session) redirect(303, '/entrar');
		if (!can(locals.actor, 'rbac.manage'))
			error(403, 'Você não tem permissão para administrar acessos.');

		const form = await request.formData();
		const bruto = {
			name: String(form.get('name') ?? ''),
			description: String(form.get('description') ?? ''),
			defaultScope: String(form.get('defaultScope') ?? ''),
			permissoes: form.getAll('permissoes').map(String)
		};

		const parsed = novoPapelSchema.safeParse(bruto);
		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			const falha: Falha = {
				valores: { name: bruto.name, description: bruto.description },
				defaultScope: bruto.defaultScope,
				permissoes: bruto.permissoes,
				erros: Object.fromEntries(
					Object.entries(campos).map(([campo, mensagens]) => [campo, mensagens?.[0]])
				)
			};
			return fail(400, falha);
		}

		let id: string;
		try {
			id = await criarPapel(db(), locals.actor, parsed.data, {
				reautenticadoRecentemente: hasFreshReauth(locals.session),
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
		} catch (erro) {
			if (erro instanceof AcessoRecusado) {
				const falha: Falha = {
					erro: erro.message,
					valores: { name: bruto.name, description: bruto.description },
					defaultScope: bruto.defaultScope,
					permissoes: bruto.permissoes
				};
				return fail(statusDaRecusa(erro.motivo), falha);
			}
			throw erro;
		}

		redirect(303, `/admin/papeis/${id}?criado=1`);
	}
};
