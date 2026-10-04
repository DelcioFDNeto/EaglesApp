import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can } from '$server/policy/policy';
import { hasFreshReauth } from '$server/auth/session';
import { situacaoDaConta } from '$server/auth/conta';
import { verPessoa } from '$server/modules/pessoas/pessoas';
import { listarPapeis } from '$server/modules/rbac/papeis';
import { atribuicoesDe, atribuirPapel, removerAtribuicao } from '$server/modules/rbac/atribuicoes';
import { emitirConvite, linkDoWhatsapp, textoDoConvite } from '$server/modules/rbac/convites';
import { historicoDeAcesso } from '$server/modules/rbac/historico';
import { AcessoRecusado, statusDaRecusa } from '$server/modules/rbac/regras';
import type { Actions, PageServerLoad } from './$types';

/**
 * Acesso de uma pessoa ao app: papéis, conta e convite.
 *
 * PERMISSÃO: `rbac.manage` global para papéis; `person.invite` SOBRE a pessoa
 * para convidar. Sem nenhuma das duas, 403.
 */

const NEGADO = 'Você não tem permissão para gerenciar o acesso desta pessoa.';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.actor || !locals.session) redirect(303, '/entrar');

	const podeAdministrar = can(locals.actor, 'rbac.manage');
	const podeConvidar = can(locals.actor, 'person.invite', { personId: params.id });
	if (!podeAdministrar && !podeConvidar) error(403, NEGADO);

	const banco = db();
	const pessoa = await verPessoa(banco, locals.actor, params.id);
	if (!pessoa) error(404, 'Pessoa não encontrada.');

	const [atribuicoes, conta, papeis, historico] = await Promise.all([
		atribuicoesDe(banco, params.id),
		situacaoDaConta(banco, params.id),
		podeAdministrar ? listarPapeis(banco, locals.actor) : Promise.resolve([]),
		can(locals.actor, 'audit.view')
			? historicoDeAcesso(banco, locals.actor, params.id)
			: Promise.resolve([])
	]);

	const jaTem = new Set(atribuicoes.map((a) => a.roleId));

	return {
		pessoa: {
			id: pessoa.id,
			fullName: pessoa.fullName,
			restrito: pessoa.regime.restrito,
			motivoRestrito: pessoa.regime.motivo
		},
		atribuicoes: atribuicoes.map((a) => ({ ...a, desde: a.desde.toISOString() })),
		conta: conta
			? {
					temSenha: conta.temSenha,
					temIdentificador: conta.temIdentificador,
					desativada: conta.desativada,
					ultimoAcesso: conta.ultimoAcesso?.toISOString() ?? null
				}
			: null,
		// Escopo de grupo fica de fora: só se atribui pela tela do grupo (M04).
		papeisAtribuiveis: papeis
			.filter((p) => p.defaultScope !== 'group' && !jaTem.has(p.id))
			.map((p) => ({ valor: p.id, rotulo: p.name })),
		papeisDeGrupo: papeis.filter((p) => p.defaultScope === 'group').map((p) => p.name),
		historico: historico.map((h) => ({ ...h, quando: h.quando.toISOString() })),
		podeAdministrar,
		podeConvidar,
		ehVoce: locals.actor.personId === params.id,
		reautenticado: hasFreshReauth(locals.session)
	};
};

function contexto(locals: App.Locals, request: Request, ip: string) {
	return {
		reautenticadoRecentemente: !!locals.session && hasFreshReauth(locals.session),
		ip,
		userAgent: request.headers.get('user-agent')
	};
}

type Resultado = {
	erro?: string;
	sucesso?: string;
	convite?: {
		url: string;
		whatsapp: string;
		texto: string;
		recuperacao: boolean;
		expiraEm: string;
	};
};

async function executar(
	acao: () => Promise<Resultado>
): Promise<Resultado | ReturnType<typeof fail<Resultado>>> {
	try {
		return await acao();
	} catch (erro) {
		if (erro instanceof AcessoRecusado) {
			return fail(statusDaRecusa(erro.motivo), { erro: erro.message } satisfies Resultado);
		}
		throw erro;
	}
}

export const actions: Actions = {
	atribuir: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor || !locals.session) redirect(303, '/entrar');
		if (!can(locals.actor, 'rbac.manage')) error(403, NEGADO);

		const roleId = String((await request.formData()).get('roleId') ?? '');
		if (!roleId) return fail(400, { erro: 'Escolha um papel.' } satisfies Resultado);

		const actor = locals.actor;
		return executar(async () => {
			await atribuirPapel(
				db(),
				actor,
				{ personId: params.id, roleId },
				contexto(locals, request, getClientAddress())
			);
			return { sucesso: 'Papel atribuído. Vale a partir da próxima tela da pessoa.' };
		});
	},

	remover: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor || !locals.session) redirect(303, '/entrar');
		if (!can(locals.actor, 'rbac.manage')) error(403, NEGADO);

		const atribuicaoId = String((await request.formData()).get('atribuicaoId') ?? '');
		const actor = locals.actor;
		return executar(async () => {
			await removerAtribuicao(
				db(),
				actor,
				atribuicaoId,
				contexto(locals, request, getClientAddress())
			);
			return { sucesso: 'Papel retirado. Já vale no próximo clique da pessoa.' };
		});
	},

	convidar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor || !locals.session) redirect(303, '/entrar');
		if (!can(locals.actor, 'person.invite', { personId: params.id })) error(403, NEGADO);

		const actor = locals.actor;
		return executar(async () => {
			const c = await emitirConvite(
				db(),
				actor,
				params.id,
				contexto(locals, request, getClientAddress())
			);
			// O link aparece UMA vez, aqui. O banco guarda só o hash do token.
			return {
				convite: {
					url: c.url,
					whatsapp: linkDoWhatsapp(c),
					texto: textoDoConvite(c),
					recuperacao: c.recuperacao,
					expiraEm: c.expiraEm.toISOString()
				}
			};
		});
	}
};
