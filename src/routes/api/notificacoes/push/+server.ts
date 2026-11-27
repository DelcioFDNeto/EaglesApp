import { json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$server/db';
import { pushSubscription } from '$server/db/schema';
import { autenticarAtor, flagAtiva } from '$lib/server/auth/middleware';
import { can, groupsWhere, type Actor } from '$server/policy/policy';

const endpointSchema = z
	.string()
	.trim()
	.url()
	.max(2048)
	.refine((u) => u.startsWith('https://'), 'O endpoint Web Push deve usar HTTPS.');

const pushSubscriptionSchema = z.union([
	z.object({
		endpoint: endpointSchema,
		keys: z.object({
			p256dh: z.string().trim().min(10).max(512),
			auth: z.string().trim().min(10).max(512)
		})
	}),
	z.object({
		endpoint: endpointSchema,
		p256dh: z.string().trim().min(10).max(512),
		auth: z.string().trim().min(10).max(512)
	})
]);

const deleteSchema = z
	.object({
		endpoint: endpointSchema.optional()
	})
	.optional();

function podeGerenciarProprioPush(actor: Actor): boolean {
	return (
		can(actor, 'event.view', { personId: actor.personId }) ||
		can(actor, 'person.view', { personId: actor.personId }) ||
		groupsWhere(actor, 'event.view').length > 0 ||
		groupsWhere(actor, 'person.view').length > 0
	);
}

/**
 * Consulta o status de assinaturas Web Push da pessoa autenticada.
 */
export const GET = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!podeGerenciarProprioPush(actor)) {
		return json({ erro: 'Sem permissão para consultar assinaturas push.' }, { status: 403 });
	}

	const [assinaturas, notificacoesAtivasNoSistema] = await Promise.all([
		banco
			.select({
				id: pushSubscription.id,
				endpoint: pushSubscription.endpoint,
				userAgent: pushSubscription.userAgent,
				createdAt: pushSubscription.createdAt,
				updatedAt: pushSubscription.updatedAt
			})
			.from(pushSubscription)
			.where(eq(pushSubscription.personId, actor.personId))
			.orderBy(desc(pushSubscription.updatedAt)),
		flagAtiva(banco, actor.teamId, 'notificacoes_ativas')
	]);

	const vapidPublicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null;

	return json({
		ativo: assinaturas.length > 0,
		totalAssinaturas: assinaturas.length,
		vapidPublicKey,
		notificacoesAtivasNoSistema,
		assinaturas
	});
};

/**
 * Salva ou atualiza uma assinatura Web Push do navegador da pessoa autenticada.
 */
export const POST = async ({ request, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!podeGerenciarProprioPush(actor)) {
		return json({ erro: 'Sem permissão para registrar assinatura push.' }, { status: 403 });
	}

	let corpo: unknown;
	try {
		corpo = await request.json();
	} catch {
		return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
	}

	const parsed = pushSubscriptionSchema.safeParse(corpo);
	if (!parsed.success) {
		return json(
			{ erro: 'Assinatura push inválida.', detalhes: parsed.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}

	const dados = parsed.data;
	const p256dh = 'keys' in dados ? dados.keys.p256dh : dados.p256dh;
	const authKey = 'keys' in dados ? dados.keys.auth : dados.auth;
	const userAgent = request.headers.get('user-agent')?.slice(0, 400) ?? null;
	const agora = new Date();

	const [salva] = await banco
		.insert(pushSubscription)
		.values({
			personId: actor.personId,
			endpoint: dados.endpoint,
			p256dh,
			auth: authKey,
			userAgent,
			updatedAt: agora
		})
		.onConflictDoUpdate({
			target: pushSubscription.endpoint,
			set: {
				personId: actor.personId,
				p256dh,
				auth: authKey,
				userAgent,
				updatedAt: agora
			}
		})
		.returning({
			id: pushSubscription.id,
			endpoint: pushSubscription.endpoint
		});

	if (!salva) {
		return json({ erro: 'Não foi possível salvar a assinatura push.' }, { status: 500 });
	}

	return json(
		{
			ok: true,
			id: salva.id,
			endpoint: salva.endpoint,
			mensagem: 'Alertas neste aparelho ativados.'
		},
		{ status: 201 }
	);
};

/**
 * Remove uma assinatura Web Push específica (`?endpoint=...` ou corpo `{ endpoint }`)
 * ou todas as assinaturas da própria pessoa autenticada.
 */
export const DELETE = async ({ request, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!podeGerenciarProprioPush(actor)) {
		return json({ erro: 'Sem permissão para remover assinatura push.' }, { status: 403 });
	}

	let endpoint = url.searchParams.get('endpoint')?.trim() || undefined;
	if (!endpoint) {
		const texto = await request.text().catch(() => '');
		if (texto.trim().length > 0) {
			try {
				const parsed = deleteSchema.safeParse(JSON.parse(texto));
				if (parsed.success && parsed.data?.endpoint) {
					endpoint = parsed.data.endpoint;
				} else if (!parsed.success) {
					return json({ erro: 'Endpoint inválido.' }, { status: 400 });
				}
			} catch {
				return json({ erro: 'Corpo da requisição inválido.' }, { status: 400 });
			}
		}
	}

	const filtros = [eq(pushSubscription.personId, actor.personId)];
	if (endpoint) {
		filtros.push(eq(pushSubscription.endpoint, endpoint));
	}

	const removidas = await banco
		.delete(pushSubscription)
		.where(and(...filtros))
		.returning({ id: pushSubscription.id });

	return json({
		ok: true,
		removidas: removidas.length,
		mensagem: 'Assinatura de alertas removida.'
	});
};
