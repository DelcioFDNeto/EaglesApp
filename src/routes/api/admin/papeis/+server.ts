import { json } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import {
	auditLog,
	group as groupTable,
	person as personTable,
	personRole,
	role,
	rolePermission
} from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { isPermission, PERMISSIONS } from '$server/policy/permissions';
import {
	PAPEIS_RESERVADOS,
	PAPEL_MASTER,
	PERMISSAO_RESERVADA_A_LIDERES
} from '$server/policy/roles';
import { ehMaster, naoEhMaster } from '$server/lideranca/regras';

const criarPapelSchema = z.object({
	key: z
		.string()
		.trim()
		.toLowerCase()
		.min(2)
		.max(40)
		.regex(/^[a-z0-9_-]+$/, 'Use apenas letras minúsculas, números, hífen ou sublinhado.'),
	name: z.string().trim().min(2).max(80),
	description: z.string().trim().max(300).optional(),
	permissions: z.array(z.string()).default([])
});

/**
 * Lista papéis, catálogo de permissões e atribuições ativas da equipe (RF-03.3).
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'rbac.manage')) {
		return json({ erro: 'Sem permissão para gerenciar papéis e permissões.' }, { status: 403 });
	}

	// O Master é invisível para a equipe: nem o papel nem quem o tem aparecem.
	const veMaster = ehMaster(actor);

	const papeis = (
		await banco.select().from(role).where(eq(role.teamId, actor.teamId)).orderBy(asc(role.name))
	).filter((r) => veMaster || r.key !== PAPEL_MASTER);

	const permsLinhas = await banco
		.select({
			roleId: rolePermission.roleId,
			permissionKey: rolePermission.permissionKey
		})
		.from(rolePermission)
		.innerJoin(role, eq(role.id, rolePermission.roleId))
		.where(eq(role.teamId, actor.teamId));

	const mapaPerms = new Map<string, string[]>();
	for (const p of permsLinhas) {
		const lista = mapaPerms.get(p.roleId) ?? [];
		lista.push(p.permissionKey);
		mapaPerms.set(p.roleId, lista);
	}

	const atribuicoes = await banco
		.select({
			id: personRole.id,
			personId: personTable.id,
			personName: personTable.fullName,
			roleId: role.id,
			roleKey: role.key,
			roleName: role.name,
			scopeType: personRole.scopeType,
			scopeId: personRole.scopeId,
			groupName: groupTable.name,
			createdAt: personRole.createdAt
		})
		.from(personRole)
		.innerJoin(personTable, eq(personTable.id, personRole.personId))
		.innerJoin(role, eq(role.id, personRole.roleId))
		.leftJoin(groupTable, eq(groupTable.id, personRole.scopeId))
		.where(and(eq(role.teamId, actor.teamId), veMaster ? undefined : naoEhMaster(personTable.id)))
		.orderBy(asc(personTable.fullName), asc(role.name));

	return json({
		catalogoPermissoes: Object.entries(PERMISSIONS).map(([key, descricao]) => ({
			key,
			descricao
		})),
		papeis: papeis.map((r) => ({
			id: r.id,
			key: r.key,
			name: r.name,
			description: r.description,
			isSystem: r.isSystem,
			// Líder e Master não são atribuídos nem editados pela gestão comum.
			reservado: PAPEIS_RESERVADOS.includes(r.key),
			permissions: (mapaPerms.get(r.id) ?? []).sort()
		})),
		atribuicoes
	});
};

/**
 * Cria um papel personalizado (RF-03.4 / RN-28).
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'rbac.manage')) {
		return json({ erro: 'Sem permissão para criar papéis.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = criarPapelSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = resultado.data;
	const invalidas = dados.permissions.filter((p) => !isPermission(p));
	if (invalidas.length > 0) {
		return json({ erro: `Permissões inválidas: ${invalidas.join(', ')}` }, { status: 400 });
	}

	if (dados.permissions.includes(PERMISSAO_RESERVADA_A_LIDERES)) {
		return json(
			{
				erro: 'Gerenciar papéis e permissões é exclusivo dos líderes.',
				codigo: 'permissao_reservada'
			},
			{ status: 400 }
		);
	}

	if (PAPEIS_RESERVADOS.includes(dados.key)) {
		return json({ erro: 'Já existe um papel com esta chave.' }, { status: 400 });
	}

	const [existe] = await banco
		.select({ id: role.id })
		.from(role)
		.where(and(eq(role.teamId, actor.teamId), eq(role.key, dados.key)))
		.limit(1);

	if (existe) {
		return json({ erro: 'Já existe um papel com esta chave.' }, { status: 400 });
	}

	const [criado] = await banco
		.insert(role)
		.values({
			teamId: actor.teamId,
			key: dados.key,
			name: dados.name,
			description: dados.description || null,
			isSystem: false
		})
		.returning();

	if (!criado) {
		return json({ erro: 'Não foi possível criar o papel.' }, { status: 500 });
	}

	const unicas = [...new Set(dados.permissions)];
	if (unicas.length > 0) {
		await banco
			.insert(rolePermission)
			.values(unicas.map((permissionKey) => ({ roleId: criado.id, permissionKey })));
	}

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'rbac.role_created',
		entity: 'role',
		entityId: criado.id,
		after: { key: criado.key, name: criado.name, permissions: unicas }
	});

	return json(
		{
			ok: true,
			papel: { ...criado, permissions: unicas }
		},
		{ status: 201 }
	);
};
