import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$server/db';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { encerrarMandato } from '$server/lideranca/mandatos';

/**
 * Encerra um mandato — renúncia, passagem de bastão ou fim de ciclo —,
 * opcionalmente já nomeando o sucessor na mesma operação.
 *
 * PERMISSÃO: `rbac.manage`; além disso, um líder só encerra o mandato do
 * outro depois que ele venceu, e o último líder não sai sem sucessor.
 */
const schema = z.object({
	sucessorId: z.string().uuid().optional().nullable(),
	/** Início do mandato do sucessor (AAAA-MM-DD). Sem ela, hoje. */
	inicio: z.string().optional().nullable()
});

export const POST = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });
	if (!can(auth.actor, 'rbac.manage')) {
		return json({ erro: 'Só líderes encerram mandatos.' }, { status: 403 });
	}
	if (!isUuid(params.id)) return json({ erro: 'Identificador inválido.' }, { status: 400 });

	const parsed = schema.safeParse((await request.json().catch(() => ({}))) ?? {});
	if (!parsed.success) return json({ erro: 'Sucessor inválido.' }, { status: 400 });

	const resultado = await encerrarMandato(banco, auth.actor, params.id, parsed.data);
	if (!resultado.ok) {
		return json({ erro: resultado.erro, codigo: resultado.codigo }, { status: resultado.status });
	}
	return json(resultado);
};
