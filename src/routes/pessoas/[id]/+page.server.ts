import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can, canAnywhere } from '$server/policy/policy';
import { verPessoa } from '$server/modules/pessoas/pessoas';
import { linhaDoTempo, listarEstagios, mudarEstagio } from '$server/modules/pessoas/status';
import { vinculosDe } from '$server/modules/pessoas/relacoes';
import { historicoDeConsentimento } from '$server/modules/pessoas/consentimento';
import type { Actions, PageServerLoad } from './$types';

/**
 * Perfil da pessoa.
 *
 * PERMISSÃO: `person.view` em qualquer escopo para o perfil;
 * `person.view_sensitive` para contato; `person.update` com escopo para editar.
 *
 * A tela recebe apenas o que o serviço decidiu entregar. `detalhe.sensiveis`
 * chega nulo para quem não pode ver contato — não é escondido no template.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.actor) redirect(303, '/entrar');

	const banco = db();
	const detalhe = await verPessoa(banco, locals.actor, params.id);

	if (!detalhe) error(404, 'Pessoa não encontrada.');

	const [tempo, vinculos, estagios, consentimentos] = await Promise.all([
		linhaDoTempo(banco, params.id),
		vinculosDe(banco, params.id),
		listarEstagios(banco, locals.actor.teamId),
		canAnywhere(locals.actor, 'person.view_sensitive')
			? historicoDeConsentimento(banco, params.id)
			: Promise.resolve([])
	]);

	return {
		pessoa: detalhe,
		linhaDoTempo: tempo.map((i) => ({
			id: i.id,
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
		podeEditar: can(locals.actor, 'person.update', { personId: params.id }),
		acabouDeCriar: url.searchParams.get('criada') === '1'
	};
};

export const actions: Actions = {
	/** Move a pessoa para outro estágio da jornada (RN-04). */
	mudarEstagio: async ({ request, locals, params, getClientAddress }) => {
		if (!locals.actor) redirect(303, '/entrar');

		// Mudar estágio é editar a pessoa: mesma permissão, mesmo escopo.
		if (!can(locals.actor, 'person.update', { personId: params.id })) {
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
	}
};
