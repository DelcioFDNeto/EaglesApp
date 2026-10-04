import { redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { can, canAnywhere } from '$server/policy/policy';
import { listarGrupos, meusGrupos } from '$server/modules/grupos/grupos';
import type { PageServerLoad } from './$types';

/**
 * Lista de grupos.
 *
 * PERMISSÃO: `group.view` em qualquer escopo. Quais PGs existem e quantas
 * pessoas têm é informação da equipe, como a lista de pessoas (D-M04-3).
 *
 * Os grupos de quem está olhando — como membro ou responsável — vêm primeiro:
 * o conselheiro abre a lista e o PG dele está no topo.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.actor) redirect(303, '/entrar');
	if (!canAnywhere(locals.actor, 'group.view')) redirect(303, '/inicio');

	const banco = db();
	const verArquivados = url.searchParams.get('arquivados') === '1';

	const [grupos, meus] = await Promise.all([
		listarGrupos(banco, locals.actor, { arquivados: verArquivados }),
		meusGrupos(banco, locals.actor)
	]);

	const meusIds = new Set(meus);
	const serializar = (g: (typeof grupos)[number]) => ({
		...g,
		arquivadoEm: g.arquivadoEm?.toISOString() ?? null,
		meu: meusIds.has(g.id)
	});

	return {
		grupos: [
			...grupos.filter((g) => meusIds.has(g.id)),
			...grupos.filter((g) => !meusIds.has(g.id))
		].map(serializar),
		verArquivados,
		// Sem contexto: criar grupo e reorganizar são tarefas da equipe inteira.
		podeCriar: can(locals.actor, 'group.manage'),
		podeReorganizar: can(locals.actor, 'group.assign_member')
	};
};
