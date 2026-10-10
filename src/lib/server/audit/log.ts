import type { Database } from '../db';
import { auditLog } from '../db/schema';

/**
 * Registro de auditoria (RN-28).
 *
 * Append-only garantido pelo BANCO: a migração 0001 instala gatilhos que
 * recusam UPDATE e DELETE nesta tabela. Aqui só se insere.
 *
 * O que NÃO entra: senha, hash, token, e-mail e telefone de menor. O log
 * responde "quem mudou o quê e quando", não guarda o conteúdo sensível.
 */

export type AuditAction =
	// Acesso
	| 'auth.login'
	| 'auth.login_falhou'
	| 'auth.logout'
	| 'auth.conta_bloqueada'
	| 'auth.senha_definida'
	| 'auth.senha_alterada'
	| 'auth.sessoes_revogadas'
	| 'auth.acesso_recuperado'
	| 'auth.reautenticado'
	| 'auth.reautenticacao_falhou'
	// Convite
	| 'invite.emitido'
	| 'invite.aceito'
	| 'invite.revogado'
	// Pessoas
	| 'person.criada'
	| 'person.atualizada'
	| 'person.removida'
	| 'person.status_alterado'
	| 'person.vinculo_criado'
	| 'person.vinculo_removido'
	| 'person.autocadastro'
	// Consentimento (ADR 0003)
	| 'consent.concedido'
	| 'consent.revogado'
	// Grupos (M04) — `membro_*` são sobre o VÍNCULO; os demais, sobre o grupo.
	| 'group.criado'
	| 'group.editado'
	| 'group.arquivado'
	| 'group.reativado'
	| 'group.membro_adicionado'
	| 'group.membro_retirado'
	| 'group.membro_transferido'
	| 'group.reorganizado'
	// Eventos (M05)
	| 'event.criado'
	| 'event.editado'
	| 'event.publicado'
	| 'event.cancelado'
	| 'event.reativado'
	| 'event.serie_criada'
	| 'event.serie_editada'
	| 'event.serie_publicada'
	| 'event.serie_encerrada'
	| 'event.tipo_criado'
	| 'event.tipo_editado'
	| 'event.tipo_arquivado'
	| 'event.tipo_reativado'
	// RBAC — `papel_atribuido`/`papel_removido` são sobre a PESSOA; os demais,
	// sobre o papel em si.
	| 'rbac.papel_atribuido'
	| 'rbac.papel_removido'
	| 'rbac.permissoes_alteradas'
	| 'rbac.papel_criado'
	| 'rbac.papel_editado'
	| 'rbac.papel_excluido'
	// Sistema
	| 'settings.alterada'
	| 'feature_flag.alterada';

export type AuditEntry = {
	teamId?: string | null;
	actorPersonId?: string | null;
	action: AuditAction;
	entity: string;
	entityId?: string | null;
	before?: unknown;
	after?: unknown;
	ip?: string | null;
	userAgent?: string | null;
};

/** Campos que nunca podem ir para a auditoria, em qualquer nível do objeto. */
const CAMPOS_PROIBIDOS = new Set([
	'password',
	'senha',
	'passwordHash',
	'password_hash',
	'token',
	'tokenHash',
	'token_hash',
	'totpSecret',
	'totp_secret',
	'secret'
]);

/** Substitui valores sensíveis por um marcador, recursivamente. */
export function redact(value: unknown, depth = 0): unknown {
	if (depth > 6 || value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

	const saida: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		saida[k] = CAMPOS_PROIBIDOS.has(k) ? '[removido]' : redact(v, depth + 1);
	}
	return saida;
}

/**
 * Grava uma entrada de auditoria.
 *
 * Nunca lança: falhar ao auditar não pode derrubar a operação que o usuário
 * pediu. Mas o erro vai para o log da aplicação, alto e visível — auditoria
 * silenciosamente quebrada é pior que auditoria ausente.
 */
export async function audit(db: Database, entry: AuditEntry): Promise<void> {
	try {
		await db.insert(auditLog).values({
			teamId: entry.teamId ?? null,
			actorPersonId: entry.actorPersonId ?? null,
			action: entry.action,
			entity: entry.entity,
			entityId: entry.entityId ?? null,
			before: entry.before === undefined ? null : redact(entry.before),
			after: entry.after === undefined ? null : redact(entry.after),
			ip: entry.ip ?? null,
			userAgent: entry.userAgent?.slice(0, 500) ?? null
		});
	} catch (erro) {
		console.error('[AUDITORIA FALHOU]', entry.action, entry.entity, erro);
	}
}
