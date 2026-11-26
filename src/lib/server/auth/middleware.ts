import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '$server/db';
import { featureFlag, session, userAccount } from '$server/db/schema';
import { loadActor } from '$server/policy/actor';
import type { Actor } from '$server/policy/policy';
import { validarToken, type JwtPayload } from '$lib/server/auth/jwt';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(valor: string | undefined | null): valor is string {
	return typeof valor === 'string' && UUID_RE.test(valor);
}

/**
 * Middleware de autenticação para rotas protegidas da API.
 *
 * Espera o header Authorization: Bearer <token>.
 * Retorna o payload decodificado ou lança erro se inválido/ausente.
 */
export function autenticar(request: Request): JwtPayload {
	const auth = request.headers.get('authorization');

	if (!auth?.startsWith('Bearer ')) {
		throw new Error('Não autenticado');
	}

	const token = auth.slice(7).trim();
	return validarToken(token);
}

/**
 * Resolve o Actor completo (com papéis, escopos e permissões do banco) a partir
 * do JWT no header Authorization ou de um Actor já carregado via cookie em locals.
 */
export async function autenticarAtor(
	request: Request,
	banco: Database,
	localsActor?: Actor | null
): Promise<{ actor: Actor; payload: JwtPayload } | null> {
	if (localsActor) {
		return {
			actor: localsActor,
			payload: { personId: localsActor.personId }
		};
	}

	let payload: JwtPayload;
	try {
		payload = autenticar(request);
	} catch {
		return null;
	}

	if (!isUuid(payload.personId) || !isUuid(payload.sessionId)) {
		return null;
	}

	// A assinatura prova que o token foi emitido por nós; só a linha da sessão
	// prova que ele ainda vale. Sem esta consulta, "sair" e "desconectar outros
	// aparelhos" não teriam efeito até o JWT expirar.
	const [viva] = await banco
		.select({ id: session.id })
		.from(session)
		.innerJoin(userAccount, eq(session.accountId, userAccount.id))
		.where(
			and(
				eq(session.id, payload.sessionId),
				eq(userAccount.personId, payload.personId),
				isNull(session.revokedAt),
				gt(session.expiresAt, new Date()),
				isNull(userAccount.disabledAt)
			)
		)
		.limit(1);

	if (!viva) return null;

	const actor = await loadActor(banco, payload.personId);
	if (!actor) return null;

	return { actor, payload };
}

/**
 * Verifica se uma feature flag está explicitamente ligada para a equipe (RN-29).
 * Ausência de linha = desligada por padrão.
 */
export async function flagAtiva(banco: Database, teamId: string, key: string): Promise<boolean> {
	const [flag] = await banco
		.select({ enabled: featureFlag.enabled })
		.from(featureFlag)
		.where(and(eq(featureFlag.teamId, teamId), eq(featureFlag.key, key)))
		.limit(1);

	return flag?.enabled === true;
}
