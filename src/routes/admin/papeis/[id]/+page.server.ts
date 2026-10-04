import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can } from '$server/policy/policy';
import { hasFreshReauth } from '$server/auth/session';
import { atualizarPapel, excluirPapel, papelSchema, verPapel } from '$server/modules/rbac/papeis';
import { gruposDePermissoes } from '$server/modules/rbac/catalogo';
import { AcessoRecusado, statusDaRecusa } from '$server/modules/rbac/regras';
import type { FalhaDeFormulario } from '$shared/formulario';
import type { Actions, PageServerLoad } from './$types';

/**
 * Um papel: permissões, quem o tem, exclusão.
 *
 * PERMISSÃO: `rbac.manage` global. Alterar exige reautenticação recente.
 */

type Falha = FalhaDeFormulario<{ permissoes: string[] }>;

const NEGADO = 'Você não tem permissão para administrar acessos.';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.actor || !locals.session) redirect(303, '/entrar');
	if (!can(locals.actor, 'rbac.manage')) error(403, NEGADO);

	const papel = await verPapel(db(), locals.actor, params.id);
	if (!papel) error(404, 'Esse papel não existe.');

	return {
		papel: {
			...papel,
			quemTem: papel.quemTem.map((q) => ({ ...q, desde: q.desde.toISOString() }))
		},
		grupos: gruposDePermissoes(locals.actor, new Set(papel.permissoesDoPapel)),
		reautenticado: hasFreshReauth(locals.session),
		criado: url.searchParams.get('criado') === '1'
	};
};

function contexto(locals: App.Locals, request: Request, ip: string) {
	return {
		reautenticadoRecentemente: !!locals.session && hasFreshReauth(locals.session),
		ip,
		userAgent: request.headers.get('user-agent')
	};
}

export const actions: Actions = {
	salvar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor || !locals.session) redirect(303, '/entrar');
		if (!can(locals.actor, 'rbac.manage')) error(403, NEGADO);

		const form = await request.formData();
		const bruto = {
			name: String(form.get('name') ?? ''),
			description: String(form.get('description') ?? ''),
			permissoes: form.getAll('permissoes').map(String)
		};

		const parsed = papelSchema.safeParse(bruto);
		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			const falha: Falha = {
				valores: { name: bruto.name, description: bruto.description },
				permissoes: bruto.permissoes,
				erros: Object.fromEntries(
					Object.entries(campos).map(([campo, mensagens]) => [campo, mensagens?.[0]])
				)
			};
			return fail(400, falha);
		}

		try {
			await atualizarPapel(
				db(),
				locals.actor,
				params.id,
				parsed.data,
				contexto(locals, request, getClientAddress())
			);
		} catch (erro) {
			if (erro instanceof AcessoRecusado) {
				const falha: Falha = {
					erro: erro.message,
					valores: { name: bruto.name, description: bruto.description },
					permissoes: bruto.permissoes
				};
				return fail(statusDaRecusa(erro.motivo), falha);
			}
			throw erro;
		}

		return { salvo: true };
	},

	excluir: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor || !locals.session) redirect(303, '/entrar');
		if (!can(locals.actor, 'rbac.manage')) error(403, NEGADO);

		const form = await request.formData();
		if (form.get('confirmo') !== 'sim') {
			const falha: Falha = { erro: 'Marque a confirmação para excluir o papel.' };
			return fail(400, falha);
		}

		const papel = await verPapel(db(), locals.actor, params.id);
		if (!papel) error(404, 'Esse papel não existe.');

		try {
			await excluirPapel(
				db(),
				locals.actor,
				params.id,
				contexto(locals, request, getClientAddress())
			);
		} catch (erro) {
			if (erro instanceof AcessoRecusado) {
				const falha: Falha = { erro: erro.message };
				return fail(statusDaRecusa(erro.motivo), falha);
			}
			throw erro;
		}

		redirect(303, `/admin/papeis?excluido=${encodeURIComponent(papel.name)}`);
	}
};
