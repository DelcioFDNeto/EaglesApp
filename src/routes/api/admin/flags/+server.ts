import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { auditLog, featureFlag, person as personTable } from '$server/db/schema';
import { autenticarAtor } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';
import { CATALOGO_FEATURE_FLAGS } from '$server/admin/flags';

const atualizarFlagSchema = z.object({
	key: z
		.string()
		.trim()
		.min(2)
		.max(60)
		.regex(/^[a-z0-9_]+$/, 'Use apenas letras minúsculas, números e sublinhado.'),
	enabled: z.boolean(),
	description: z.string().trim().max(300).optional()
});

/**
 * Lista todas as chaves de funcionalidade da equipe (padrão desligado — RN-29).
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'settings.manage')) {
		return json({ erro: 'Apenas administradores podem consultar configurações.' }, { status: 403 });
	}

	const salvas = await banco
		.select({
			key: featureFlag.key,
			enabled: featureFlag.enabled,
			description: featureFlag.description,
			updatedAt: featureFlag.updatedAt,
			updatedByName: personTable.fullName
		})
		.from(featureFlag)
		.leftJoin(personTable, eq(personTable.id, featureFlag.updatedByPersonId))
		.where(eq(featureFlag.teamId, actor.teamId));

	const mapa = new Map(salvas.map((s) => [s.key, s]));
	const chavesCatalogo = new Set(CATALOGO_FEATURE_FLAGS.map((c) => c.key));

	const flags = [
		...CATALOGO_FEATURE_FLAGS.map((def) => {
			const dbRow = mapa.get(def.key);
			return {
				key: def.key,
				nome: def.nome,
				descricao: def.descricao,
				modulo: def.modulo,
				enabled: dbRow?.enabled ?? false,
				updatedAt: dbRow?.updatedAt ?? null,
				updatedByName: dbRow?.updatedByName ?? null
			};
		}),
		...salvas
			.filter((s) => !chavesCatalogo.has(s.key))
			.map((s) => ({
				key: s.key,
				nome: s.key,
				descricao: s.description ?? 'Chave personalizada',
				modulo: 'Personalizada',
				enabled: s.enabled,
				updatedAt: s.updatedAt,
				updatedByName: s.updatedByName ?? null
			}))
	];

	return json({ flags });
};

/**
 * Liga ou desliga uma chave de funcionalidade com registro em auditoria (RN-28 / RN-29).
 */
export const PUT = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'settings.manage')) {
		return json({ erro: 'Apenas administradores podem alterar configurações.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const resultado = atualizarFlagSchema.safeParse(corpo);
	if (!resultado.success) {
		return json(
			{ erro: 'Dados inválidos.', detalhes: resultado.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const { key, enabled, description } = resultado.data;
	const [existente] = await banco
		.select()
		.from(featureFlag)
		.where(and(eq(featureFlag.teamId, actor.teamId), eq(featureFlag.key, key)))
		.limit(1);

	const antes = existente?.enabled ?? false;
	const agora = new Date();
	const def = CATALOGO_FEATURE_FLAGS.find((c) => c.key === key);

	let flagId: string;
	if (existente) {
		await banco
			.update(featureFlag)
			.set({
				enabled,
				description: description ?? existente.description ?? def?.descricao ?? null,
				updatedByPersonId: actor.personId,
				updatedAt: agora
			})
			.where(eq(featureFlag.id, existente.id));
		flagId = existente.id;
	} else {
		const [criada] = await banco
			.insert(featureFlag)
			.values({
				teamId: actor.teamId,
				key,
				enabled,
				description: description ?? def?.descricao ?? null,
				updatedByPersonId: actor.personId,
				updatedAt: agora
			})
			.returning({ id: featureFlag.id });
		flagId = criada!.id;
	}

	await banco.insert(auditLog).values({
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'settings.feature_flag_updated',
		entity: 'feature_flag',
		entityId: flagId,
		before: { key, enabled: antes },
		after: { key, enabled }
	});

	return json({
		ok: true,
		key,
		enabled,
		mensagem: enabled
			? `Funcionalidade "${def?.nome ?? key}" ligada.`
			: `Funcionalidade "${def?.nome ?? key}" desligada.`
	});
};
