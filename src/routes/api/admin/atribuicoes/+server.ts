import { json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	auditLog,
	group as groupTable,
	person as personTable,
	personRole,
	role
} from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { PAPEIS_RESERVADOS, PAPEL_LIDER } from '$server/policy/roles';
import { ehMaster, naoEhMaster } from '$server/lideranca/regras';

const atribuirPapelSchema = z.object({
	personId: z.string().uuid(),
	roleId: z.string().uuid(),
	scopeType: z.enum(['global', 'group', 'self']),
	scopeId: z.string().uuid().optional().nullable()
});

/**
 * Concede um papel com escopo (`global`, `group` ou `self`) a uma pessoa (RF-03.2 / RN-28).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'rbac.manage')) {
		return json({ erro: 'Sem permissão para atribuir papéis.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = atribuirPapelSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = resultado.data;
	if (dados.scopeType === 'group' && !dados.scopeId) {
		return json(
			{ erro: 'Selecione o grupo para atribuição com escopo de grupo.' },
			{ status: 400 }
		);
	}

	const scopeIdFinal = dados.scopeType === 'group' ? dados.scopeId! : null;

	const [pessoaAlvo] = await banco
		.select({ id: personTable.id })
		.from(personTable)
		.where(
			and(
				eq(personTable.id, dados.personId),
				eq(personTable.teamId, actor.teamId),
				// O Master é invisível para a equipe: para ela, ele não existe.
				ehMaster(actor) ? undefined : naoEhMaster(personTable.id)
			)
		)
		.limit(1);
	if (!pessoaAlvo) {
		return json({ erro: 'Pessoa não encontrada.' }, { status: 404 });
	}

	const [papelAlvo] = await banco
		.select({ id: role.id, key: role.key, name: role.name })
		.from(role)
		.where(and(eq(role.id, dados.roleId), eq(role.teamId, actor.teamId)))
		.limit(1);
	if (!papelAlvo) {
		return json({ erro: 'Papel não encontrado.' }, { status: 404 });
	}

	// Líder só entra por mandato (máximo 2, a cada 2 anos); Master só pelo
	// script de primeiro acesso. Por aqui, nenhum dos dois.
	if (PAPEIS_RESERVADOS.includes(papelAlvo.key)) {
		return json(
			{
				erro:
					papelAlvo.key === PAPEL_LIDER
						? 'Líderes são nomeados na tela de Liderança, com mandato.'
						: 'Este papel não pode ser atribuído.',
				codigo: 'papel_reservado'
			},
			{ status: 400 }
		);
	}

	if (scopeIdFinal) {
		const [g] = await banco
			.select({ id: groupTable.id })
			.from(groupTable)
			.where(and(eq(groupTable.id, scopeIdFinal), eq(groupTable.teamId, actor.teamId)))
			.limit(1);
		if (!g) {
			return json({ erro: 'Grupo não encontrado.' }, { status: 404 });
		}
	}

	const [jaExiste] = await banco
		.select({ id: personRole.id })
		.from(personRole)
		.where(
			and(
				eq(personRole.personId, dados.personId),
				eq(personRole.roleId, dados.roleId),
				eq(personRole.scopeType, dados.scopeType),
				scopeIdFinal ? eq(personRole.scopeId, scopeIdFinal) : isNull(personRole.scopeId)
			)
		)
		.limit(1);

	if (jaExiste) {
		return json(
			{ erro: 'Esta pessoa já possui exatamente este papel neste escopo.' },
			{ status: 400 }
		);
	}

	const [criada] = await banco
		.insert(personRole)
		.values({
			personId: dados.personId,
			roleId: dados.roleId,
			scopeType: dados.scopeType,
			scopeId: scopeIdFinal,
			grantedByPersonId: actor.personId
		})
		.returning();

	if (criada) {
		await banco.insert(auditLog).values({
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			action: 'rbac.assignment_granted',
			entity: 'person_role',
			entityId: criada.id,
			after: {
				personId: dados.personId,
				roleKey: papelAlvo.key,
				scopeType: dados.scopeType,
				scopeId: scopeIdFinal
			}
		});
	}

	return json({ ok: true, atribuicao: criada }, { status: 201 });
};
