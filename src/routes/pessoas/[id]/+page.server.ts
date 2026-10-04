import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can, PolicyDenied } from '$server/policy/policy';
import { verPessoa } from '$server/modules/pessoas/pessoas';
import { contextoDaPessoa } from '$server/modules/grupos/contexto';
import { gruposAtivos } from '$server/modules/grupos/grupos';
import { mudarDeGrupo } from '$server/modules/grupos/composicao';
import { GrupoRecusado, statusDaRecusaDeGrupo } from '$server/modules/grupos/regras';
import { motivoSchema } from '$server/modules/grupos/validacao';
import { SEM_GRUPO } from '$shared/grupo';
import { linhaDoTempo, listarEstagios, mudarEstagio } from '$server/modules/pessoas/status';
import { vinculosDe } from '$server/modules/pessoas/relacoes';
import { historicoDeConsentimento } from '$server/modules/pessoas/consentimento';
import { atribuicoesDe } from '$server/modules/rbac/atribuicoes';
import type { Actions, PageServerLoad } from './$types';

/**
 * Perfil da pessoa.
 *
 * PERMISSÃO: `person.view` em qualquer escopo para o perfil;
 * `person.view_sensitive` para contato e vínculos; `person.update` para
 * editar; `group.assign_member` para mudar de grupo. Todas as três últimas
 * NO GRUPO DA PESSOA (D-M04-4).
 *
 * A tela recebe apenas o que o serviço decidiu entregar. `detalhe.sensiveis`
 * chega nulo para quem não pode ver contato — não é escondido no template.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.actor) redirect(303, '/entrar');

	const banco = db();
	const detalhe = await verPessoa(banco, locals.actor, params.id);

	if (!detalhe) error(404, 'Pessoa não encontrada.');

	const actor = locals.actor;
	const ctx = await contextoDaPessoa(banco, params.id);

	// O serviço já decidiu: `sensiveis` só chega para quem pode vê-los no grupo
	// da pessoa. Vínculos e consentimentos seguem a mesma decisão — o catálogo
	// lista vínculos entre os dados sensíveis, e o M02 os mostrava a qualquer
	// um com `person.view` (lacuna G5 do M04).
	const veSensiveis = detalhe.sensiveis !== null;

	const [tempo, vinculos, estagios, consentimentos, atribuicoes, grupos] = await Promise.all([
		linhaDoTempo(banco, params.id),
		veSensiveis ? vinculosDe(banco, params.id) : Promise.resolve([]),
		listarEstagios(banco, actor.teamId),
		veSensiveis ? historicoDeConsentimento(banco, params.id) : Promise.resolve([]),
		atribuicoesDe(banco, params.id),
		gruposAtivos(banco, actor.teamId)
	]);

	// Mudar de grupo exige a permissão nas duas pontas (D-M04-3): a tela só
	// oferece os destinos que o servidor aceitaria.
	const podeTirarDaOrigem =
		ctx.groupId === null || can(actor, 'group.assign_member', { groupId: ctx.groupId });
	const destinos = podeTirarDaOrigem
		? grupos
				.filter((g) => g.id !== ctx.groupId)
				.filter((g) => can(actor, 'group.assign_member', { groupId: g.id }))
				.map((g) => ({ valor: g.id, rotulo: g.nome }))
		: [];
	if (podeTirarDaOrigem && ctx.groupId) {
		destinos.push({ valor: SEM_GRUPO, rotulo: 'Sem grupo — retirar do grupo atual' });
	}

	return {
		pessoa: detalhe,
		linhaDoTempo: tempo.map((i) => ({
			id: i.id,
			tipo: i.tipo,
			quando: i.occurredAt.toISOString(),
			de: i.de,
			para: i.para,
			motivo: i.motivo
		})),
		vinculos,
		estagios: estagios.map((e) => ({ valor: e.id, rotulo: e.name })),
		consentimentos: consentimentos.map((c) => ({
			id: c.id,
			kind: c.kind,
			granted: c.granted,
			at: c.at.toISOString()
		})),
		grupo: detalhe.grupo ? { ...detalhe.grupo, desde: detalhe.grupo.desde.toISOString() } : null,
		destinosDeGrupo: destinos,
		podeEditar: can(actor, 'person.update', ctx),
		// Quem tem qual papel não é dado sensível: na comunidade todo mundo sabe
		// quem é da liderança. Só os NOMES dos papéis — escopo e histórico ficam
		// na tela de acesso, para quem administra.
		papeis: [...new Set(atribuicoes.map((a) => a.papel))],
		podeGerenciarAcesso: can(actor, 'rbac.manage') || can(actor, 'person.invite', ctx),
		acabouDeCriar: url.searchParams.get('criada') === '1'
	};
};

export const actions: Actions = {
	/** Move a pessoa para outro estágio da jornada (RN-04). */
	mudarEstagio: async ({ request, locals, params, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');

		// Mudar estágio é editar a pessoa: mesma permissão, mesmo escopo.
		if (!can(locals.actor, 'person.update', await contextoDaPessoa(db(), params.id))) {
			return fail(403, { erro: 'Você não tem permissão para mudar o estágio desta pessoa.' });
		}

		const form = await request.formData();
		const paraEstagioId = String(form.get('estagioId') ?? '');
		const motivo = String(form.get('motivo') ?? '');

		if (!paraEstagioId) {
			return fail(400, { erro: 'Escolha o estágio de destino.' });
		}

		await mudarEstagio(db(), {
			personId: params.id,
			paraEstagioId,
			porPersonId: locals.actor.personId,
			motivo,
			teamId: locals.actor.teamId,
			ip: getClientAddress(),
			userAgent: request.headers.get('user-agent')
		});

		return { sucesso: 'Estágio atualizado.' };
	},

	/** Coloca, transfere ou retira a pessoa do grupo (RF-04.2). */
	mudarGrupo: async ({ request, locals, params, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');

		// Declaração da rota; a verificação de verdade — origem E destino — é
		// do serviço, que conhece o grupo atual dentro da transação.
		const ctx = await contextoDaPessoa(db(), params.id);
		if (ctx.groupId && !can(locals.actor, 'group.assign_member', { groupId: ctx.groupId })) {
			return fail(403, { erro: 'Você não pode tirar esta pessoa do grupo em que ela está.' });
		}

		const form = await request.formData();
		const escolha = String(form.get('grupoId') ?? '');
		if (!escolha) return fail(400, { erro: 'Escolha o grupo de destino.' });

		try {
			const m = await mudarDeGrupo(
				db(),
				locals.actor,
				{
					personId: params.id,
					paraGrupoId: escolha === SEM_GRUPO ? null : escolha,
					motivo: motivoSchema.parse(form.get('motivoGrupo'))
				},
				{ ip: getClientAddress(), userAgent: request.headers.get('user-agent') }
			);
			return {
				sucesso: m.para
					? m.de
						? `Mudança registrada: ${m.de.nome} → ${m.para.nome}.`
						: `Agora faz parte de ${m.para.nome}.`
					: `Saiu de ${m.de?.nome ?? 'seu grupo'}.`
			};
		} catch (erro) {
			if (erro instanceof GrupoRecusado) {
				return fail(statusDaRecusaDeGrupo(erro.motivo), { erro: erro.message });
			}
			if (erro instanceof PolicyDenied) {
				return fail(403, { erro: 'Você não pode colocar pessoas nesse grupo.' });
			}
			throw erro;
		}
	}
};
