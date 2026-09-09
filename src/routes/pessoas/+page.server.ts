import { redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { canAnywhere } from '$server/policy/policy';
import { listarPessoas } from '$server/modules/pessoas/pessoas';
import { listarEstagios } from '$server/modules/pessoas/status';
import type { PageServerLoad } from './$types';

/**
 * Lista de pessoas.
 *
 * PERMISSÃO: `person.view` em qualquer escopo.
 *
 * O serviço é quem autoriza e quem decide o que cada um enxerga — esta rota só
 * repassa. O filtro de campos sensíveis acontece ANTES de o dado sair do
 * servidor: esconder na tela deixaria o telefone no HTML, a um "ver código-
 * fonte" de distância de quem não pode vê-lo.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.actor) redirect(303, '/entrar');

	const busca = url.searchParams.get('busca')?.trim() ?? '';
	const statusId = url.searchParams.get('status') ?? '';

	const banco = db();

	const [pessoas, estagios] = await Promise.all([
		listarPessoas(banco, locals.actor, { busca, statusId: statusId || null }),
		listarEstagios(banco, locals.actor.teamId)
	]);

	return {
		pessoas,
		estagios: estagios.map((e) => ({ valor: e.id, rotulo: e.name })),
		busca,
		statusId,
		podeCadastrar: canAnywhere(locals.actor, 'person.create'),
		podeVerContato: canAnywhere(locals.actor, 'person.view_sensitive')
	};
};
