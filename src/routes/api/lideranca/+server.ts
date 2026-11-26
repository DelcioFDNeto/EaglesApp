import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$server/db';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { nomearLider, verLideranca } from '$server/lideranca/mandatos';

/**
 * Liderança: os 2 líderes e seus mandatos de 2 anos.
 *
 * PERMISSÃO: `rbac.manage` (só líderes e Master têm). As regras finas — quem
 * renova, quem encerra, limite de 2 — ficam em `$server/lideranca/mandatos`.
 *
 * GET  — mandatos abertos, vagas, histórico e o que quem pergunta pode fazer.
 * POST — nomeia um líder para uma vaga aberta.
 */

export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });
	if (!can(auth.actor, 'rbac.manage')) {
		return json({ erro: 'Só líderes acessam a liderança.' }, { status: 403 });
	}

	return json(await verLideranca(banco, auth.actor));
};

const nomearSchema = z.object({
	personId: z.string().uuid('Escolha a pessoa.'),
	/** AAAA-MM-DD. Sem ela, o mandato começa hoje. Limites em `periodoDoMandato`. */
	inicio: z.string().optional().nullable()
});

export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) return json({ erro: 'Não autenticado' }, { status: 401 });
	if (!can(auth.actor, 'rbac.manage')) {
		return json({ erro: 'Só líderes nomeiam líderes.' }, { status: 403 });
	}

	const parsed = nomearSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
	}

	const resultado = await nomearLider(banco, auth.actor, parsed.data.personId, {
		inicio: parsed.data.inicio
	});
	if (!resultado.ok) {
		return json({ erro: resultado.erro, codigo: resultado.codigo }, { status: resultado.status });
	}
	return json(resultado, { status: 201 });
};
