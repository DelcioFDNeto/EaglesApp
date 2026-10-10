import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can } from '$server/policy/policy';
import { arquivarTipo, atualizarTipo, criarTipo, listarTipos } from '$server/modules/eventos/tipos';
import { tipoSchema } from '$server/modules/eventos/validacao';
import { EventoRecusado, statusDaRecusaDeEvento } from '$server/modules/eventos/regras';
import {
	arquivarResposta,
	criarResposta,
	definirRespostasDoTipo,
	escolhasPorTipo,
	listarRespostas,
	type Significado
} from '$server/modules/presenca/respostas';
import type { FalhaDeFormulario } from '$shared/formulario';
import type { Actions, PageServerLoad } from './$types';

/**
 * Tipos de evento (RF-05.1, RN-10) e respostas de presença (RN-11, D-M06-1).
 *
 * PERMISSÃO: `settings.manage` GLOBAL — é configuração da equipe inteira.
 */

const NEGADO = 'Configurar tipos de evento é tarefa de quem administra o sistema.';

type Falha = FalhaDeFormulario<{ tipoId: string; sucesso: string }>;

const SIGNIFICADOS: Significado[] = ['sim', 'talvez', 'nao'];

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!can(locals.actor, 'settings.manage')) error(403, NEGADO);

	const banco = db();
	const teamId = locals.actor.teamId;
	const [tipos, respostas, escolhas] = await Promise.all([
		listarTipos(banco, teamId, { incluirArquivados: true }),
		listarRespostas(banco, teamId, { incluirArquivadas: true }),
		escolhasPorTipo(banco, teamId)
	]);
	const ativas = respostas.filter((r) => !r.arquivada);
	return {
		tipos,
		respostas,
		// Tipo sem escolha oferece todas as ativas: a tela as mostra marcadas.
		escolhas: Object.fromEntries(
			tipos.map((t) => [t.id, escolhas.get(t.id) ?? ativas.map((r) => r.id)])
		)
	};
};

function ler(form: FormData) {
	const valores = {
		nome: String(form.get('nome') ?? ''),
		cor: String(form.get('cor') ?? ''),
		ehEncontroDoGrupo: form.get('ehEncontroDoGrupo') === 'sim' ? 'sim' : '',
		contaParaFrequencia: form.get('contaParaFrequencia') === 'sim' ? 'sim' : ''
	};
	return {
		valores,
		parsed: tipoSchema.safeParse({
			...valores,
			ehEncontroDoGrupo: valores.ehEncontroDoGrupo === 'sim',
			contaParaFrequencia: valores.contaParaFrequencia === 'sim'
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
		// Respostas oferecidas (RN-11). Todas as ativas marcadas = o padrão,
		// gravado vazio: assim uma resposta criada depois também vale para o tipo.
		const marcadas = form.getAll('respostas').map(String);
		if (marcadas.length === 0) {
			return fail(400, {
				tipoId,
				valores,
				erros: { respostas: 'Marque ao menos uma resposta.' }
			} satisfies Falha);
		}

		const actor = locals.actor;
		return executar(tipoId, async () => {
			const banco = db();
			const contexto = requisicao(request, getClientAddress());
			await atualizarTipo(banco, actor, tipoId, parsed.data, contexto);

			const ativas = (await listarRespostas(banco, actor.teamId)).map((r) => r.id);
			const escolha = ativas.every((id) => marcadas.includes(id))
				? []
				: ativas.filter((id) => marcadas.includes(id));
			const atual = (await escolhasPorTipo(banco, actor.teamId)).get(tipoId) ?? [];
			if (escolha.length !== atual.length || escolha.some((id) => !atual.includes(id))) {
				await definirRespostasDoTipo(banco, actor, tipoId, escolha, contexto);
			}
			return { sucesso: 'Tipo atualizado.' };
		});
	},

	criarResposta: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'settings.manage')) error(403, NEGADO);

		const form = await request.formData();
		const valores = {
			texto: String(form.get('texto') ?? '').trim(),
			significado: String(form.get('significado') ?? ''),
			aceitaConvidados: form.get('aceitaConvidados') === 'sim' ? 'sim' : ''
		};
		const erros: Record<string, string | undefined> = {};
		if (valores.texto.length < 2 || valores.texto.length > 40) {
			erros.texto = 'Escreva a resposta com 2 a 40 caracteres.';
		}
		if (!SIGNIFICADOS.includes(valores.significado as Significado)) {
			erros.significado = 'Diga o que a resposta significa.';
		}
		if (erros.texto || erros.significado) {
			return fail(400, { tipoId: 'resposta', valores, erros } satisfies Falha);
		}

		const actor = locals.actor;
		return executar('resposta', async () => {
			await criarResposta(
				db(),
				actor,
				{
					texto: valores.texto,
					significado: valores.significado as Significado,
					aceitaConvidados: valores.aceitaConvidados === 'sim'
				},
				requisicao(request, getClientAddress())
			);
			return { sucesso: `Resposta "${valores.texto}" criada.` };
		});
	},

	arquivarResposta: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!can(locals.actor, 'settings.manage')) error(403, NEGADO);

		const form = await request.formData();
		const respostaId = String(form.get('respostaId') ?? '');
		const arquivar = form.get('arquivar') === 'sim';
		const actor = locals.actor;
		return executar('resposta', async () => {
			await arquivarResposta(
				db(),
				actor,
				respostaId,
				arquivar,
				requisicao(request, getClientAddress())
			);
			return {
				sucesso: arquivar
					? 'Resposta arquivada. Quem já respondeu com ela continua contado.'
					: 'Resposta reativada.'
			};
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
