import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can, canAnywhere, PolicyDenied } from '$server/policy/policy';
import { hasFreshReauth } from '$server/auth/session';
import { arquivarGrupo, reativarGrupo, verGrupo } from '$server/modules/grupos/grupos';
import { candidatosParaGrupo, mudarDeGrupo } from '$server/modules/grupos/composicao';
import { GrupoRecusado, statusDaRecusaDeGrupo } from '$server/modules/grupos/regras';
import { atribuirPapel, removerAtribuicao } from '$server/modules/rbac/atribuicoes';
import { listarPapeis } from '$server/modules/rbac/papeis';
import { pessoasParaEscolha } from '$server/modules/pessoas/pessoas';
import { AcessoRecusado, statusDaRecusa } from '$server/modules/rbac/regras';
import type { Actions, PageServerLoad } from './$types';

/**
 * Visão do grupo (RF-04.3) — a tela do conselheiro.
 *
 * PERMISSÃO: `group.view` em qualquer escopo para ver o grupo e quem está
 * nele. O resto é decidido por operação (D-M04-3):
 *   - contato e pendências de cada pessoa: `person.view_sensitive` no grupo
 *     (decidido pelo serviço, linha a linha);
 *   - colocar alguém: `group.assign_member` no grupo — e na origem da pessoa;
 *   - editar o combinado: `group.manage` no grupo;
 *   - arquivar e reativar: `group.manage` global;
 *   - responsáveis: `rbac.manage` global + reautenticação (travas do M03).
 */

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.actor || !locals.session) redirect(303, '/entrar');
	if (!canAnywhere(locals.actor, 'group.view')) redirect(303, '/inicio');

	const banco = db();
	const actor = locals.actor;
	const grupo = await verGrupo(banco, actor, params.id);
	if (!grupo) error(404, 'Grupo não encontrado.');

	const ativo = grupo.arquivadoEm === null;
	const podeColocar = ativo && can(actor, 'group.assign_member', { groupId: grupo.id });
	const podeGerirResponsaveis = ativo && can(actor, 'rbac.manage');

	const [candidatos, papeis, pessoasDaEquipe] = await Promise.all([
		podeColocar ? candidatosParaGrupo(banco, actor, grupo.id) : Promise.resolve([]),
		podeGerirResponsaveis ? listarPapeis(banco, actor) : Promise.resolve([]),
		podeGerirResponsaveis ? pessoasParaEscolha(banco, actor) : Promise.resolve([])
	]);

	// Só papéis de escopo de grupo: os demais valem para a equipe inteira e
	// são atribuídos pela tela da pessoa (D-M03-1).
	const papeisDeGrupo = papeis.filter((p) => p.defaultScope === 'group');

	return {
		grupo: {
			...grupo,
			arquivadoEm: grupo.arquivadoEm?.toISOString() ?? null,
			pessoas: grupo.pessoas.map((p) => ({ ...p, desde: p.desde.toISOString() })),
			sairamRecentemente: grupo.sairamRecentemente.map((s) => ({
				...s,
				saiuEm: s.saiuEm.toISOString()
			}))
		},
		candidatos: candidatos.map((c) => ({
			valor: c.personId,
			rotulo: c.grupoAtual ? `${c.nome} (hoje em ${c.grupoAtual})` : c.nome
		})),
		papeisDeGrupo: papeisDeGrupo.map((p) => ({ valor: p.id, rotulo: p.name })),
		pessoasDaEquipe: pessoasDaEquipe.map((p) => ({ valor: p.id, rotulo: p.nome })),
		podeEditar: ativo && can(actor, 'group.manage', { groupId: grupo.id }),
		podeArquivar: can(actor, 'group.manage'),
		podeColocar,
		podeCadastrar: podeColocar && can(actor, 'person.create', { groupId: grupo.id }),
		podeGerirResponsaveis,
		reautenticado: hasFreshReauth(locals.session),
		euId: actor.personId,
		criado: url.searchParams.get('criado') === '1',
		salvo: url.searchParams.get('salvo') === '1'
	};
};

type Resultado = { erro?: string; sucesso?: string };

/** Traduz as recusas conhecidas em mensagem na tela; o resto sobe. */
async function executar(acao: () => Promise<Resultado>) {
	try {
		return await acao();
	} catch (erro) {
		if (erro instanceof GrupoRecusado) {
			return fail(statusDaRecusaDeGrupo(erro.motivo), { erro: erro.message } satisfies Resultado);
		}
		if (erro instanceof AcessoRecusado) {
			return fail(statusDaRecusa(erro.motivo), { erro: erro.message } satisfies Resultado);
		}
		if (erro instanceof PolicyDenied) {
			return fail(403, {
				erro: 'Você não tem permissão para fazer isso neste grupo.'
			} satisfies Resultado);
		}
		throw erro;
	}
}

function requisicao(request: Request, ip: string) {
	return { ip, userAgent: request.headers.get('user-agent') };
}

export const actions: Actions = {
	/** Coloca uma pessoa no grupo — vinda de nenhum grupo ou de outro. */
	colocar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'group.assign_member', { groupId: params.id })) {
			return fail(403, { erro: 'Você não pode colocar pessoas neste grupo.' } satisfies Resultado);
		}

		const personId = String((await request.formData()).get('personId') ?? '');
		if (!personId) return fail(400, { erro: 'Escolha a pessoa.' } satisfies Resultado);

		const actor = locals.actor;
		return executar(async () => {
			const m = await mudarDeGrupo(
				db(),
				actor,
				{ personId, paraGrupoId: params.id },
				requisicao(request, getClientAddress())
			);
			return {
				sucesso: m.de
					? `${m.nome} veio de ${m.de.nome} para este grupo.`
					: `${m.nome} agora faz parte do grupo.`
			};
		});
	},

	atribuirResponsavel: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor || !locals.session) redirect(303, '/entrar');
		if (!can(locals.actor, 'rbac.manage')) {
			return fail(403, {
				erro: 'Só quem administra acessos define responsáveis.'
			} satisfies Resultado);
		}

		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');
		const roleId = String(form.get('roleId') ?? '');
		if (!personId || !roleId) {
			return fail(400, { erro: 'Escolha a pessoa e o papel.' } satisfies Resultado);
		}

		const actor = locals.actor;
		const sessao = locals.session;
		return executar(async () => {
			await atribuirPapel(
				db(),
				actor,
				{ personId, roleId, grupoId: params.id },
				{
					reautenticadoRecentemente: hasFreshReauth(sessao),
					...requisicao(request, getClientAddress())
				}
			);
			return { sucesso: 'Responsável definido. Vale a partir da próxima tela da pessoa.' };
		});
	},

	removerResponsavel: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor || !locals.session) redirect(303, '/entrar');
		if (!can(locals.actor, 'rbac.manage')) {
			return fail(403, {
				erro: 'Só quem administra acessos define responsáveis.'
			} satisfies Resultado);
		}

		const atribuicaoId = String((await request.formData()).get('atribuicaoId') ?? '');
		const actor = locals.actor;
		const sessao = locals.session;
		return executar(async () => {
			await removerAtribuicao(db(), actor, atribuicaoId, {
				reautenticadoRecentemente: hasFreshReauth(sessao),
				...requisicao(request, getClientAddress())
			});
			return { sucesso: 'Responsável retirado. Já vale no próximo clique da pessoa.' };
		});
	},

	arquivar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'group.manage')) {
			return fail(403, {
				erro: 'Arquivar grupos é tarefa da liderança geral.'
			} satisfies Resultado);
		}

		const actor = locals.actor;
		return executar(async () => {
			await arquivarGrupo(db(), actor, params.id, requisicao(request, getClientAddress()));
			return { sucesso: 'Grupo arquivado. A história de quem passou por ele continua guardada.' };
		});
	},

	reativar: async ({ locals, params, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'group.manage')) {
			return fail(403, {
				erro: 'Reativar grupos é tarefa da liderança geral.'
			} satisfies Resultado);
		}

		const actor = locals.actor;
		return executar(async () => {
			await reativarGrupo(db(), actor, params.id, requisicao(request, getClientAddress()));
			return { sucesso: 'Grupo reativado.' };
		});
	}
};
