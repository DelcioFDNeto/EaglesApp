import { json } from '@sveltejs/kit';
import { db } from '$server/db';
import { autenticarAtor } from '$lib/server/auth/middleware';

/**
 * PERMISSÃO: autenticado. Confere a sessão no banco, então um token de sessão
 * revogada recebe 401 aqui como em qualquer outra rota.
 */
export const GET = async ({ request, locals }) => {
	const auth = await autenticarAtor(request, db(), locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	return json({ ok: true, pessoa: { id: auth.actor.personId, email: auth.payload.email } });
};
