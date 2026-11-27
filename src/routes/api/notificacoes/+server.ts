import { json } from '@sveltejs/kit';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { notification } from '$server/db/schema';
import { autenticarAtor, flagAtiva } from '$lib/server/auth/middleware';
import { can, groupsWhere, type Actor } from '$server/policy/policy';

const marcarLidasSchema = z.union([
	z.object({ todas: z.literal(true) }),
	z.object({ id: z.string().uuid() }),
	z.object({ ids: z.array(z.string().uuid()).min(1).max(100) })
]);

function podeAcessarProprias(actor: Actor): boolean {
	return (
		can(actor, 'event.view', { personId: actor.personId }) ||
		can(actor, 'person.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'event.view').length > 0 ||
		groupsWhere(actor, 'person.view').length > 0
	);
}

/**
 * Lista as notificações in-app da própria pessoa autenticada e retorna contagem de não lidas (§19).
 */
export const GET = async ({ request, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!podeAcessarProprias(actor)) {
		return json({ erro: 'Sem permissão para consultar notificações.' }, { status: 403 });
	}

	const apenasNaoLidas =
		url.searchParams.get('apenasNaoLidas') === '1' ||
		url.searchParams.get('apenasNaoLidas') === 'true';
	const limiteRaw = Number.parseInt(url.searchParams.get('limite') ?? '50', 10);
	const limite = Number.isFinite(limiteRaw) ? Math.min(Math.max(limiteRaw, 1), 100) : 50;

	const filtros = [
		eq(notification.teamId, actor.teamId),
		eq(notification.personId, actor.personId)
	];
	if (apenasNaoLidas) {
		filtros.push(isNull(notification.readAt));
	}

	const [itens, [contagem], notificacoesAtivasNoSistema] = await Promise.all([
		banco
			.select({
				id: notification.id,
				kind: notification.kind,
				title: notification.title,
				body: notification.body,
				href: notification.href,
				readAt: notification.readAt,
				createdAt: notification.createdAt
			})
			.from(notification)
			.where(and(...filtros))
			.orderBy(desc(notification.createdAt))
			.limit(limite),
		banco
			.select({ total: sql<number>`count(*)::int` })
			.from(notification)
			.where(
				and(
					eq(notification.teamId, actor.teamId),
					eq(notification.personId, actor.personId),
					isNull(notification.readAt)
				)
			),
		flagAtiva(banco, actor.teamId, 'notificacoes_ativas')
	]);

	const podeGerarLembretes =
		can(actor, 'announcement.send') ||
		can(actor, 'event.manage') ||
		groupsWhere(actor, 'announcement.send').length > 0 ||
		groupsWhere(actor, 'event.manage').length > 0;

	return json({
		notificacoesAtivasNoSistema,
		podeGerarLembretes,
		naoLidas: contagem?.total ?? 0,
		notificacoes: itens
	});
};

/**
 * Marca uma, várias ou todas as notificações da própria pessoa como lidas.
 */
export const PATCH = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!podeAcessarProprias(actor)) {
		return json({ erro: 'Sem permissão para atualizar notificações.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const parsed = marcarLidasSchema.safeParse(corpo);
	if (!parsed.success) {
		return json({ erro: 'Informe id, ids ou { todas: true }.' }, { status: 400 });
	}

	const dados = parsed.data;
	const agora = new Date();
	const filtros = [
		eq(notification.teamId, actor.teamId),
		eq(notification.personId, actor.personId),
		isNull(notification.readAt)
	];

	if ('id' in dados) {
		filtros.push(eq(notification.id, dados.id));
	} else if ('ids' in dados) {
		filtros.push(inArray(notification.id, dados.ids));
	}

	const atualizadas = await banco
		.update(notification)
		.set({ readAt: agora })
		.where(and(...filtros))
		.returning({ id: notification.id });

	const [contagem] = await banco
		.select({ total: sql<number>`count(*)::int` })
		.from(notification)
		.where(
			and(
				eq(notification.teamId, actor.teamId),
				eq(notification.personId, actor.personId),
				isNull(notification.readAt)
			)
		);

	return json({
		ok: true,
		marcadas: atualizadas.length,
		naoLidas: contagem?.total ?? 0
	});
};
