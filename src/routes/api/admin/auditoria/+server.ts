import { json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$server/db';
import { auditLog, person as personTable } from '$server/db/schema';
import { autenticarAtor, isUuid } from '$lib/server/auth/middleware';
import { can } from '$server/policy/policy';

/**
 * Consulta a trilha de auditoria imutável (append-only — RF-11.2 / RN-28).
 */
export const GET = async ({ request, url, locals }) => {
	const banco = db();
	const auth = await autenticarAtor(request, banco, locals?.actor);
	if (!auth) {
		return json({ erro: 'Não autenticado' }, { status: 401 });
	}

	const { actor } = auth;
	if (!can(actor, 'audit.view')) {
		return json({ erro: 'Sem permissão para consultar a auditoria.' }, { status: 403 });
	}

	const entidade = url.searchParams.get('entidade');
	const acao = url.searchParams.get('acao');
	const atorId = url.searchParams.get('atorId');
	const limiteRaw = Number.parseInt(url.searchParams.get('limite') ?? '50', 10);
	const limite = Number.isFinite(limiteRaw) ? Math.min(200, Math.max(1, limiteRaw)) : 50;

	const filtros = [eq(auditLog.teamId, actor.teamId)];
	if (entidade) filtros.push(eq(auditLog.entity, entidade));
	if (acao) filtros.push(eq(auditLog.action, acao));
	if (atorId && isUuid(atorId)) filtros.push(eq(auditLog.actorPersonId, atorId));

	const registros = await banco
		.select({
			id: auditLog.id,
			action: auditLog.action,
			entity: auditLog.entity,
			entityId: auditLog.entityId,
			before: auditLog.before,
			after: auditLog.after,
			at: auditLog.at,
			actorPersonId: auditLog.actorPersonId,
			actorName: personTable.fullName
		})
		.from(auditLog)
		.leftJoin(personTable, eq(personTable.id, auditLog.actorPersonId))
		.where(and(...filtros))
		.orderBy(desc(auditLog.at))
		.limit(limite);

	return json({ registros });
};
