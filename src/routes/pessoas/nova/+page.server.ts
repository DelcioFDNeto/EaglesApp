import { fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can, canAnywhere, type Actor } from '$server/policy/policy';
import { gruposAtivos } from '$server/modules/grupos/grupos';
import { GrupoRecusado, statusDaRecusaDeGrupo } from '$server/modules/grupos/regras';
import { criarPessoa, RegimeRestrito } from '$server/modules/pessoas/pessoas';
import { criarPessoaSchema } from '$server/modules/pessoas/validacao';
import {
	duplicatasVisiveis,
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
 * PERMISSÃO: `person.create` em qualquer escopo para abrir a tela. Para
 * gravar, no escopo do grupo escolhido — ou global, para cadastrar sem grupo
 * (D-M04-4). O conselheiro só vê, na lista de grupos, aqueles em que pode
 * cadastrar; e precisa escolher um, senão criaria alguém que ele mesmo
 * deixaria de enxergar no instante seguinte.
 *
 * O formulário segue RN-05: **só o nome é obrigatório**. Tudo o mais fica atrás
 * de "adicionar mais informações", porque quem cadastra costuma estar em pé, na
 * porta do PG, com o celular numa mão.
 */
/** Grupos em que o ator pode cadastrar alguém — e colocá-lo ali. */
async function gruposParaCadastro(actor: Actor) {
	const grupos = await gruposAtivos(db(), actor.teamId);
	return grupos.filter(
		(g) =>
			can(actor, 'person.create', { groupId: g.id }) &&
			can(actor, 'group.assign_member', { groupId: g.id })
	);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.actor) redirect(303, '/entrar');

	if (!canAnywhere(locals.actor, 'person.create')) {
		redirect(303, '/pessoas');
	}

	const [estagios, grupos] = await Promise.all([
		listarEstagios(db(), locals.actor.teamId),
		gruposParaCadastro(locals.actor)
	]);

	const exigeGrupo = !can(locals.actor, 'person.create');
	const sugerido = url.searchParams.get('grupo') ?? '';

	return {
		estagios: estagios
			.filter((e) => !e.isTerminal)
			.map((e) => ({ valor: e.id, rotulo: e.name, padrao: e.isDefault })),
		grupos: grupos.map((g) => ({ valor: g.id, rotulo: g.nome })),
		exigeGrupo,
		// Vindo da tela do grupo, ou quando só existe uma escolha possível.
		grupoSugerido: grupos.some((g) => g.id === sugerido)
			? sugerido
			: exigeGrupo && grupos.length === 1
				? grupos[0]!.id
				: ''
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

		const grupoId = String(form.get('grupoId') ?? '') || null;
		if (!grupoId && !can(locals.actor, 'person.create')) {
			const falha: Falha = {
				valores: bruto,
				erros: { grupoId: 'Escolha o grupo em que a pessoa vai entrar.' }
			};
			return fail(400, falha);
		}
		if (grupoId && !(await gruposParaCadastro(locals.actor)).some((g) => g.id === grupoId)) {
			const falha: Falha = {
				valores: bruto,
				erros: { grupoId: 'Você não pode cadastrar pessoas nesse grupo.' }
			};
			return fail(403, falha);
		}

		// Duplicidade AVISA, não bloqueia (RF-02.6). Na primeira tentativa o
		// aviso volta para a tela; se a pessoa confirmar, o cadastro segue.
		const confirmouDuplicata = form.get('confirmar_duplicata') === 'sim';

		if (!confirmouDuplicata) {
			const achadas = await procurarPossiveisDuplicatas(banco, locals.actor.teamId, parsed.data);
			if (achadas.length > 0) {
				const { visiveis, ocultas } = await duplicatasVisiveis(banco, locals.actor, achadas);
				const falha: Falha = {
					valores: bruto,
					duplicatas: visiveis,
					avisoDeDuplicata: mensagemDeDuplicata(visiveis, ocultas)
				};
				return fail(409, falha);
			}
		}

		let novaPessoaId: string;

		try {
			novaPessoaId = await criarPessoa(banco, locals.actor, parsed.data, {
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent'),
				grupoId
			});
		} catch (erro) {
			if (erro instanceof GrupoRecusado) {
				const falha: Falha = { valores: bruto, erros: { grupoId: erro.message } };
				return fail(statusDaRecusaDeGrupo(erro.motivo), falha);
			}
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
