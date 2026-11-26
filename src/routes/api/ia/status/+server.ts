import { json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '$server/db';
import { aiSuggestion } from '$server/db/schema';
import { autenticarAtor, flagAtiva } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

/**
 * Retorna status da feature flag `ia_assistente`, permissões de IA do usuário (RN-26)
 * e sugestões recentes dentro do seu escopo.
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const basico =
		can(actor, 'ai.use_basic', { personId: actor.personId }) ||
		groupsWhere(actor, 'ai.use_basic').length > 0;
	const analitico =
		can(actor, 'ai.use_analytics') || groupsWhere(actor, 'ai.use_analytics').length > 0;
	const financeiro = can(actor, 'ai.use_finance') && can(actor, 'finance.view_all');

	if (!basico && !analitico && !financeiro) {
		return json({ erro: 'Sem permissão para usar o assistente de IA.' }, { status: 403 });
	}

	const iaAtiva = await flagAtiva(banco, actor.teamId, 'ia_assistente');

	const todas = await banco
		.select()
		.from(aiSuggestion)
		.where(eq(aiSuggestion.teamId, actor.teamId))
		.orderBy(desc(aiSuggestion.createdAt))
		.limit(30);

	// RN-26: filtra sugestões para que ninguém veja sugestão fora do próprio escopo
	const sugestoes = todas.filter((s) => {
		if (s.kind === 'resumo_financeiro') return financeiro;
		if (s.kind === 'divisao_grupos' || s.kind === 'sinais_atencao') return analitico;
		return s.requestedByPersonId === actor.personId || analitico;
	});

	return json({
		iaAtiva,
		permissoesIa: {
			basico,
			analitico,
			financeiro,
			podeAplicarGrupos: can(actor, 'group.assign_member')
		},
		sugestoes
	});
};
