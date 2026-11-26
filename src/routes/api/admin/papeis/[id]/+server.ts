import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { auditLog, role, rolePermission } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { isPermission } from '$server/policy/permissions';

const atualizarPapelSchema = z.object({
	name: z.string().trim().min(2).max(80).optional(),
	description: z.string().trim().max(300).nullable().optional(),
	permissions: z.array(z.string()).optional()
});

/**
 * Edita nome/descrição/permissões de um papel (inclusive papéis de sistema — seção 11.3).
 * Impede remover `rbac.manage` do papel global do próprio administrador se ele não tiver outro.
 */
export const PUT = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'rbac.manage')) {
		return json({ erro: 'Sem permissão para editar papéis.' }, { status: 403 });
	}

	const id = params.id;
	if (!isUuid(id)) {
		return json({ erro: 'Identificador inválido.' }, { status: 400 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = atualizarPapelSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const [atual] = await banco
		.select()
		.from(role)
		.where(and(eq(role.id, id), eq(role.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Papel não encontrado.' }, { status: 404 });
	}

	const dados = resultado.data;
	const permsAntes = (
		await banco
			.select({ key: rolePermission.permissionKey })
			.from(rolePermission)
			.where(eq(rolePermission.roleId, id))
	)
		.map((p) => p.key)
		.sort();

	let permsDepois = permsAntes;

	if (dados.permissions !== undefined) {
		const invalidas = dados.permissions.filter((p) => !isPermission(p));
		if (invalidas.length > 0) {
			return json({ erro: `Permissões inválidas: ${invalidas.join(', ')}` }, { status: 400 });
		}

		const unicas = [...new Set(dados.permissions)].sort();

		// Proteção anti-autobloqueio: impede remover rbac.manage do próprio papel global se não houver outro
		const removeRbac = permsAntes.includes('rbac.manage') && !unicas.includes('rbac.manage');
		if (removeRbac) {
			const outroPapelComRbac = actor.assignments.some(
				(a) =>
					a.scopeType === 'global' &&
					a.roleKey !== atual.key &&
					a.permissions.has('rbac.manage')
			);
			const atorUsaEstePapel = actor.assignments.some(
				(a) => a.scopeType === 'global' && a.roleKey === atual.key
			);
			if (atorUsaEstePapel && !outroPapelComRbac) {
				return json(
					{
						erro: 'Você não pode remover "rbac.manage" do único papel global que lhe concede administração.'
					},
					{ status: 400 }
				);
			}
		}

		await banco.delete(rolePermission).where(eq(rolePermission.roleId, id));
		if (unicas.length > 0) {
			await banco
				.insert(rolePermission)
				.values(unicas.map((permissionKey) => ({ roleId: id, permissionKey })));
		}
		permsDepois = unicas;
	}

	const [atualizado] = await banco
		.update(role)
		.set({
			name: dados.name ?? atual.name,
			description: dados.description !== undefined ? dados.description : atual.description,
			updatedAt: new Date()
		})
		.where(eq(role.id, id))
		.returning();

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'rbac.role_updated',
		entity: 'role',
		entityId: id,
		before: { name: atual.name, permissions: permsAntes },
		after: { name: atualizado?.name, permissions: permsDepois }
	});

	return json({
		ok: true,
		papel: { ...atualizado, permissions: permsDepois }
	});
};

/**
 * Remove um papel personalizado. Papéis de sistema (`isSystem = true`) são protegidos.
 */
export const DELETE = async ({ request, params, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'rbac.manage')) {
		return json({ erro: 'Sem permissão para remover papéis.' }, { status: 403 });
	}

	const id = params.id;
	if (!isUuid(id)) {
		return json({ erro: 'Identificador inválido.' }, { status: 400 });
	}

	const [atual] = await banco
		.select()
		.from(role)
		.where(and(eq(role.id, id), eq(role.teamId, actor.teamId)))
		.limit(1);

	if (!atual) {
		return json({ erro: 'Papel não encontrado.' }, { status: 404 });
	}

	if (atual.isSystem) {
		return json(
			{ erro: 'Papéis básicos do sistema não podem ser excluídos — apenas suas permissões podem ser ajustadas.' },
			{ status: 400 }
		);
	}

	await banco.delete(role).where(eq(role.id, id));

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'rbac.role_deleted',
		entity: 'role',
		entityId: id,
		before: { key: atual.key, name: atual.name }
	});

	return json({ ok: true, mensagem: 'Papel personalizado removido.' });
};
