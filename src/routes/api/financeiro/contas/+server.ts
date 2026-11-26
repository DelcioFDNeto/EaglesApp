import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { auditLog, financeAccount } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const criarContaSchema = z.object({
	name: z.string().trim().min(1).max(80),
	kind: z.enum(['caixa', 'pix', 'especie', 'banco']).default('caixa')
});

export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeVer =
		can(actor, 'finance.view_all') ||
		can(actor, 'finance.view_group') ||
		groupsWhere(actor, 'finance.view_group').length > 0;

	if (!podeVer) {
		return json({ erro: 'Sem permissão para ver contas do caixa.' }, { status: 403 });
	}

	const contas = await banco
		.select()
		.from(financeAccount)
		.where(and(eq(financeAccount.teamId, actor.teamId), eq(financeAccount.active, true)))
		.orderBy(asc(financeAccount.name));

	return json({ contas });
};

export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'finance.approve') && !can(actor, 'settings.manage')) {
		return json({ erro: 'Apenas líderes podem cadastrar contas/caixas.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarContaSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [existe] = await banco
		.select({ id: financeAccount.id })
		.from(financeAccount)
		.where(
			and(eq(financeAccount.teamId, actor.teamId), eq(financeAccount.name, resultado.data.name))
		)
		.limit(1);

	if (existe) {
		return json({ erro: 'Já existe uma conta com este nome.' }, { status: 400 });
	}

	const [criada] = await banco
		.insert(financeAccount)
		.values({
			teamId: actor.teamId,
			name: resultado.data.name,
			kind: resultado.data.kind
		})
		.returning();

	if (criada) {
		await banco.insert(auditLog).values({
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			action: 'finance.account_created',
			entity: 'finance_account',
			entityId: criada.id,
			after: { name: criada.name, kind: criada.kind }
		});
	}

	return json({ ok: true, conta: criada }, { status: 201 });
};
