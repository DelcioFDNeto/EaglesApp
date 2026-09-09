/**
 * Ponto ÚNICO de decisão de autorização do Eagles App.
 *
 * Toda pergunta "esta pessoa pode fazer isto?" passa por aqui — nas rotas, nos
 * serviços e na IA (RN-26). Não existe segunda implementação, porque duas
 * implementações divergem em silêncio e divergência de permissão é vazamento.
 *
 * Princípios (seção 11.4 da arquitetura):
 *   1. Negação por padrão. Na dúvida, `false`.
 *   2. A decisão é do servidor. A interface apenas esconde o que aqui já se nega.
 *   3. Permissão + escopo. Um conselheiro do PG Azul não manda no PG Verde.
 */

import type { Permission, PolicyContext, ScopeType } from './permissions';

/** Uma atribuição de papel a uma pessoa, já resolvida com suas permissões. */
export type RoleAssignment = {
	roleKey: string;
	scopeType: ScopeType;
	/** Grupo do escopo, quando `scopeType === 'group'`. */
	scopeId: string | null;
	permissions: ReadonlySet<Permission>;
};

/** Quem está agindo. Montado uma vez por requisição em `hooks.server.ts`. */
export type Actor = {
	personId: string;
	teamId: string;
	assignments: RoleAssignment[];
};

/**
 * A pessoa tem `permission` no contexto informado?
 *
 * Semântica do escopo:
 *   - `global` — vale em qualquer contexto.
 *   - `group`  — vale apenas quando `ctx.groupId` é exatamente o grupo do escopo.
 *                Sem `groupId` no contexto, uma atribuição de grupo NÃO autoriza:
 *                pedir uma ação sem dizer sobre qual grupo é ambíguo, e ambiguidade
 *                resolve-se negando.
 *   - `self`   — vale apenas quando `ctx.personId` é a própria pessoa.
 */
export function can(actor: Actor | null, permission: Permission, ctx: PolicyContext = {}): boolean {
	if (!actor) return false;

	for (const assignment of actor.assignments) {
		if (!assignment.permissions.has(permission)) continue;

		switch (assignment.scopeType) {
			case 'global':
				return true;

			case 'group':
				if (
					assignment.scopeId !== null &&
					ctx.groupId != null &&
					assignment.scopeId === ctx.groupId
				) {
					return true;
				}
				break;

			case 'self':
				if (ctx.personId != null && ctx.personId === actor.personId) {
					return true;
				}
				break;
		}
	}

	return false;
}

/** Todos os grupos em que a pessoa tem `permission` por escopo de grupo. */
export function groupsWhere(actor: Actor | null, permission: Permission): string[] {
	if (!actor) return [];
	const ids = new Set<string>();
	for (const a of actor.assignments) {
		if (a.scopeType === 'group' && a.scopeId && a.permissions.has(permission)) {
			ids.add(a.scopeId);
		}
	}
	return [...ids];
}

/**
 * A pessoa detém `permission` em ALGUM escopo?
 *
 * Responde "este papel inclui esta permissão", não "pode fazer isto com aquele
 * registro". Serve para recursos que **não pertencem a um grupo** — a lista de
 * pessoas da equipe, o formulário de cadastro de alguém que ainda não tem
 * grupo. Nesses casos exigir `groupId` seria pedir um contexto que não existe,
 * e a política negaria por ambiguidade uma ação legítima.
 *
 * NUNCA use isto no lugar de uma verificação com contexto sobre um registro
 * específico. "Pode editar alguém" e "pode editar ESTA pessoa" são perguntas
 * diferentes, e trocar uma pela outra é exatamente como escopo vaza.
 */
export function canAnywhere(actor: Actor | null, permission: Permission): boolean {
	if (!actor) return false;
	return actor.assignments.some((a) => a.permissions.has(permission));
}

/** Versão imperativa de `canAnywhere`: autoriza ou lança. */
export function authorizeAnywhere(
	actor: Actor | null,
	permission: Permission
): asserts actor is Actor {
	if (!canAnywhere(actor, permission)) {
		throw new PolicyDenied(permission, {});
	}
}

/** A pessoa tem `permission` de forma global (sem depender de grupo)? */
export function canGlobally(actor: Actor | null, permission: Permission): boolean {
	if (!actor) return false;
	return actor.assignments.some((a) => a.scopeType === 'global' && a.permissions.has(permission));
}

/** Erro lançado quando uma verificação obrigatória falha. */
export class PolicyDenied extends Error {
	readonly permission: Permission;
	readonly context: PolicyContext;

	constructor(permission: Permission, context: PolicyContext) {
		super(`Acesso negado: ${permission}`);
		this.name = 'PolicyDenied';
		this.permission = permission;
		this.context = context;
	}
}

/**
 * Versão imperativa: autoriza ou lança.
 * Use nos serviços de domínio, onde continuar sem permissão não é uma opção.
 */
export function authorize(
	actor: Actor | null,
	permission: Permission,
	ctx: PolicyContext = {}
): asserts actor is Actor {
	if (!can(actor, permission, ctx)) {
		throw new PolicyDenied(permission, ctx);
	}
}
