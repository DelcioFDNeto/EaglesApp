import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { responsabilidade } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can, groupsWhere } from '$server/policy/policy';

const criarResponsabilidadeSchema = z.object({
	nome: z.string().trim().min(1).max(100),
	descricao: z.string().trim().max(500).optional(),
	intervaloMinimoDias: z.number().int().min(0).max(365).default(14),
	ordem: z.number().int().min(0).max(1000).default(0)
});

/**
 * Lista os tipos de responsabilidade configurados para a equipe (RN-16 / RF-07.1).
 */
export const GET = async ({ request, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeVer =
		can(actor, 'responsibility.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'responsibility.view').length > 0;

	if (!podeVer) {
		return json({ erro: 'Sem permissão para ver responsabilidades.' }, { status: 403 });
	}

	const incluirInativas = url.searchParams.get('todas') === '1';
	const filtros = [eq(responsabilidade.teamId, actor.teamId)];
	if (!incluirInativas) {
		filtros.push(eq(responsabilidade.ativo, true));
	}

	const responsabilidades = await banco
		.select()
		.from(responsabilidade)
		.where(and(...filtros))
		.orderBy(asc(responsabilidade.ordem), asc(responsabilidade.nome));

	const podeGerenciar =
		can(actor, 'responsibility.manage') || groupsWhere(actor, 'responsibility.manage').length > 0;

	return json({
		podeGerenciar,
		responsabilidades
	});
};

/**
 * Cria um novo tipo de responsabilidade configurável (RN-16 / RF-07.1).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	const podeGerenciar =
		can(actor, 'responsibility.manage') || groupsWhere(actor, 'responsibility.manage').length > 0;

	if (!podeGerenciar) {
		return json(
			{ erro: 'Apenas líderes e conselheiros podem criar responsabilidades.' },
			{ status: 403 }
		);
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarResponsabilidadeSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [existe] = await banco
		.select({ id: responsabilidade.id })
		.from(responsabilidade)
		.where(
			and(eq(responsabilidade.teamId, actor.teamId), eq(responsabilidade.nome, resultado.data.nome))
		)
		.limit(1);

	if (existe) {
		return json(
			{ erro: 'Já existe uma responsabilidade com este nome na equipe.' },
			{ status: 400 }
		);
	}

	const [criada] = await banco
		.insert(responsabilidade)
		.values({
			teamId: actor.teamId,
			nome: resultado.data.nome,
			descricao: resultado.data.descricao || null,
			intervaloMinimoDias: resultado.data.intervaloMinimoDias,
			ordem: resultado.data.ordem
		})
		.returning();

	if (!criada) {
		return json({ erro: 'Não foi possível criar a responsabilidade.' }, { status: 500 });
	}

	return json(
		{
			ok: true,
			responsabilidade: {
				id: criada.id,
				nome: criada.nome,
				descricao: criada.descricao,
				intervaloMinimoDias: criada.intervaloMinimoDias,
				ordem: criada.ordem,
				ativo: criada.ativo,
				criadaEm: criada.createdAt
			}
		},
		{ status: 201 }
	);
};
