import { error, redirect } from '@sveltejs/kit';
import { db } from '$server/db';
import { authorizeAnywhere } from '$server/policy/policy';
import { PERMISSIONS } from '$server/policy/permissions';
import { featureFlag } from '$server/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

/**
 * Início — o dashboard.
 *
 * PERMISSÃO: `event.view` no escopo da própria pessoa.
 *
 * No M01 esta tela não mostra evento nenhum, porque eventos são o M05. Ela
 * existe para provar o caminho completo: sessão → política → dado → tela.
 * O estado vazio aqui é o estado verdadeiro, não um placeholder.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.actor) redirect(303, '/entrar');

	// Declaração explícita da permissão desta rota. A ausência desta linha é
	// pega pelo teste `rotas-declaram-permissao`.
	//
	// `authorizeAnywhere`, e não `authorize` com contexto de pessoa: o painel é
	// do próprio usuário e não pertence a grupo nenhum. Com a verificação
	// escopada, quem tem o papel atribuído a um GRUPO — todo conselheiro —
	// recebia acesso negado ao abrir o app, porque uma atribuição de grupo não
	// autoriza sem um `groupId` no contexto. O papel estava certo; a pergunta
	// é que era a errada.
	authorizeAnywhere(locals.actor, 'event.view');

	const banco = db();

	const flags = await banco
		.select({ key: featureFlag.key, enabled: featureFlag.enabled })
		.from(featureFlag)
		.where(eq(featureFlag.teamId, locals.actor.teamId));

	// Quais permissões esta pessoa realmente tem — o menu se monta a partir
	// disto, e não de "se papel === conselheiro".
	const minhasPermissoes = [
		...new Set(locals.actor.assignments.flatMap((a) => [...a.permissions]))
	].sort();

	return {
		nome: locals.displayName ?? 'Eagles',
		papeis: [...new Set(locals.actor.assignments.map((a) => a.roleKey))],
		permissoes: minhasPermissoes,
		catalogoPermissoes: PERMISSIONS as Record<string, string>,
		funcionalidades: Object.fromEntries(flags.map((f) => [f.key, f.enabled]))
	};
};
