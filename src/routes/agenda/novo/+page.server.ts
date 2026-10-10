import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can, canAnywhere, PolicyDenied } from '$server/policy/policy';
import { criarEvento, fusoDaEquipe } from '$server/modules/eventos/eventos';
import { listarGrupos } from '$server/modules/grupos/grupos';
import { tipoDoEncontroDoGrupo } from '$server/modules/eventos/tipos';
import { eventoSchema, lerPublico } from '$server/modules/eventos/validacao';
import {
	EventoRecusado,
	publicoPadrao,
	statusDaRecusaDeEvento
} from '$server/modules/eventos/regras';
import { diaDaSemana, hojeNoFuso, somarDias } from '$shared/fuso';
import type { FalhaDeFormulario } from '$shared/formulario';
import { opcoesDoFormulario, valoresDoFormulario } from '../opcoes.server';
import type { Actions, PageServerLoad } from './$types';

/**
 * Novo evento — avulso ou semanal (RF-05.2, RF-05.3).
 *
 * PERMISSÃO: `event.manage` em algum escopo para abrir; no grupo escolhido —
 * ou global, para evento geral — para gravar. Publicar no mesmo passo exige
 * `event.publish` ali (D-M05-6).
 *
 * `?grupo=<id>&semanal=1` é o atalho da tela do grupo: o formulário já chega
 * com o combinado do PG (dia, horário, local) que o M04 guarda.
 */

type Falha = FalhaDeFormulario<{
	convite: { convite: string; grupos: string[]; pessoas: string[] };
}>;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!canAnywhere(locals.actor, 'event.manage')) {
		error(403, 'Você não tem permissão para criar eventos.');
	}

	const banco = db();
	const actor = locals.actor;
	const [opcoes, fuso] = await Promise.all([
		opcoesDoFormulario(banco, actor),
		fusoDaEquipe(banco, actor.teamId)
	]);
	const hoje = hojeNoFuso(fuso);

	const valores: Record<string, string> = {
		recorrencia: 'unica',
		intervaloSemanas: '1',
		data: hoje,
		horaInicio: '20:00'
	};

	// Atalho do grupo: o encontro semanal nasce do combinado do PG.
	const grupoPedido = url.searchParams.get('grupo');
	if (grupoPedido && opcoes.grupos.some((g) => g.valor === grupoPedido)) {
		const grupo = (await listarGrupos(banco, actor)).find((g) => g.id === grupoPedido);
		const tipo = await tipoDoEncontroDoGrupo(banco, actor.teamId);
		if (grupo) {
			valores.grupoId = grupo.id;
			valores.titulo = grupo.nome;
			if (tipo) valores.tipoId = tipo.id;
			if (grupo.local) valores.local = grupo.local;
			if (grupo.horario) valores.horaInicio = grupo.horario.slice(0, 5);
			if (grupo.diaDaSemana !== null) {
				let d = hoje;
				while (diaDaSemana(d) !== grupo.diaDaSemana) d = somarDias(d, 1);
				valores.data = d;
			}
			if (url.searchParams.get('semanal') === '1') valores.recorrencia = 'semanal';
		}
	}

	// Conselheiro de um grupo só: o grupo já vem escolhido.
	if (!valores.grupoId && !opcoes.podeCriarEventoGeral && opcoes.grupos.length === 1) {
		valores.grupoId = opcoes.grupos[0]!.valor;
	}

	return {
		...opcoes,
		valores,
		hoje,
		podePublicar: canAnywhere(actor, 'event.publish')
	};
};

export const actions: Actions = {
	default: async ({ locals, request, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');
		if (!canAnywhere(locals.actor, 'event.manage')) {
			error(403, 'Você não tem permissão para criar eventos.');
		}

		const form = await request.formData();
		const { valores, convite } = valoresDoFormulario(form);

		const parsed = eventoSchema.safeParse({
			...valores,
			publicar: form.get('publicar') === 'sim'
		});
		if (!parsed.success) {
			const campos = parsed.error.flatten().fieldErrors;
			return fail(400, {
				valores,
				convite,
				erros: Object.fromEntries(Object.entries(campos).map(([c, m]) => [c, m?.[0]]))
			} satisfies Falha);
		}

		const dados = parsed.data;
		const publico =
			convite.convite === 'equipe' || convite.convite === 'escolhidos'
				? lerPublico(form)
				: publicoPadrao(dados.grupoId);

		// Sem permissão para o grupo escolhido: diz isso no campo, em vez de
		// uma página de erro que joga fora o formulário.
		if (!can(locals.actor, 'event.manage', { groupId: dados.grupoId })) {
			return fail(403, {
				valores,
				convite,
				erros: {
					grupoId: dados.grupoId
						? 'Você não pode criar eventos para esse grupo.'
						: 'Evento geral é tarefa da liderança. Escolha o seu grupo.'
				}
			} satisfies Falha);
		}

		let criado: { tipo: 'evento' | 'serie'; id: string };
		try {
			criado = await criarEvento(db(), locals.actor, dados, publico, {
				ip: getClientAddress(),
				userAgent: request.headers.get('user-agent')
			});
		} catch (erro) {
			if (erro instanceof EventoRecusado) {
				const noConvite = erro.motivo === 'publico_fora_do_escopo' || erro.motivo === 'sem_publico';
				return fail(statusDaRecusaDeEvento(erro.motivo), {
					valores,
					convite,
					...(noConvite ? { erros: { convite: erro.message } } : { erro: erro.message })
				} satisfies Falha);
			}
			if (erro instanceof PolicyDenied) {
				return fail(403, {
					valores,
					convite,
					erro: 'Você não tem permissão para publicar eventos desse grupo. Desmarque "Publicar agora".'
				} satisfies Falha);
			}
			throw erro;
		}

		redirect(
			303,
			criado.tipo === 'serie'
				? `/agenda/series/${criado.id}?criada=1`
				: `/agenda/${criado.id}?criado=1`
		);
	}
};
