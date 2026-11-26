import { json } from '@sveltejs/kit';
import { db } from '$server/db';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { renovarMandato } from '$server/lideranca/mandatos';

/**
 * Renova um mandato por mais 2 anos.
 *
 * PERMISSÃO: `rbac.manage`; além disso, cada líder renova só o próprio
 * mandato (o Master, qualquer um), a partir de 90 dias antes do fim.
 */
export const POST = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });
	if (!can(auth.actor, 'rbac.manage')) {
		return json({ erro: 'Só líderes renovam mandatos.' }, { status: 403 });
	}
	if (!isUuid(params.id)) return json({ erro: 'Identificador inválido.' }, { status: 400 });

	const resultado = await renovarMandato(banco, auth.actor, params.id);
	if (!resultado.ok) {
		return json({ erro: resultado.erro, codigo: resultado.codigo }, { status: resultado.status });
	}
	return json(resultado);
};
