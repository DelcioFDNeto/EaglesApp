import { redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { canAnywhere } from '$server/policy/policy';
import { listarPessoas } from '$server/modules/pessoas/pessoas';
import { listarEstagios } from '$server/modules/pessoas/status';
import { gruposAtivos } from '$server/modules/grupos/grupos';
import { SEM_GRUPO } from '$shared/grupo';
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
	const grupoId = url.searchParams.get('grupo') ?? '';

	const banco = db();

	const [pessoas, estagios, grupos] = await Promise.all([
		listarPessoas(banco, locals.actor, {
			busca,
			statusId: statusId || null,
			grupoId: grupoId || null
		}),
		listarEstagios(banco, locals.actor.teamId),
		gruposAtivos(banco, locals.actor.teamId)
	]);

	return {
		pessoas,
		estagios: estagios.map((e) => ({ valor: e.id, rotulo: e.name })),
		grupos: [
			...grupos.map((g) => ({ valor: g.id, rotulo: g.nome })),
			{ valor: SEM_GRUPO, rotulo: 'Sem grupo' }
		],
		busca,
		statusId,
		grupoId,
		podeCadastrar: canAnywhere(locals.actor, 'person.create')
	};
};
