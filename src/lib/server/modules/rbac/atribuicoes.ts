import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { ehId } from '$shared/formulario';
import { atribuicaoVigente } from '$server/policy/vigencia';
import type { Database } from '$server/db';
import { person, personRole, role, rolePermission, smallGroup } from '$server/db/schema';
import { audit } from '$server/audit/log';
import { authorize, type Actor } from '$server/policy/policy';
import { isPermission, type ScopeType } from '$server/policy/permissions';
import { exigirAdministradorRestante, travarAdministracao } from './administradores';
import {
	AcessoRecusado,
	exigirOutraPessoa,
	exigirReautenticacao,
	exigirSemEscalada,
	type ContextoSensivel
} from './regras';

/**
 * Quem tem qual papel, e com que escopo (RF-03.2).
 *
 * O efeito de toda alteração aqui é IMEDIATO: o ator é recarregado do banco a
 * cada requisição (`hooks.server.ts`), sem cache. Retirar um papel vale já no
 * próximo clique de quem o perdeu — não no próximo login.
 */

export type Atribuicao = {
	id: string;
	roleId: string;
	papel: string;
	scopeType: ScopeType;
	scopeId: string | null;
	concedidoPor: string | null;
	desde: Date;
	expiraEm: Date | null;
};

const vigente = atribuicaoVigente;

/** Papéis em vigor de uma pessoa. Leitura aberta a quem já pode ver a pessoa. */
export async function atribuicoesDe(db: Database, personId: string): Promise<Atribuicao[]> {
	const linhas = await db
		.select({
			id: personRole.id,
			roleId: role.id,
			papel: role.name,
			scopeType: personRole.scopeType,
			scopeId: personRole.scopeId,
			concedidoPorId: personRole.grantedByPersonId,
			desde: personRole.createdAt,
			expiraEm: personRole.expiresAt
		})
		.from(personRole)
		.innerJoin(role, eq(role.id, personRole.roleId))
		.where(and(eq(personRole.personId, personId), vigente()))
		.orderBy(asc(role.name));

	const idsDeQuemConcedeu = [
		...new Set(linhas.map((l) => l.concedidoPorId).filter((x): x is string => !!x))
	];
	const nomes = new Map(
		idsDeQuemConcedeu.length === 0
			? []
			: (
					await db
						.select({ id: person.id, nome: person.fullName })
						.from(person)
						.where(inArray(person.id, idsDeQuemConcedeu))
				).map((p) => [p.id, p.nome] as const)
	);

	return linhas.map((l) => ({
		id: l.id,
		roleId: l.roleId,
		papel: l.papel,
		scopeType: l.scopeType as ScopeType,
		scopeId: l.scopeId,
		concedidoPor: l.concedidoPorId ? (nomes.get(l.concedidoPorId) ?? null) : null,
		desde: l.desde,
		expiraEm: l.expiraEm
	}));
}

/**
 * Atribui um papel a alguém, com o escopo DO PAPEL (D-M03-1).
 *
 * As quatro travas se aplicam: rbac.manage global, reautenticação, ninguém
 * mexe no próprio acesso, e ninguém concede o que não tem — o papel inteiro
 * precisa caber nas permissões de quem atribui.
 *
 * Papel de escopo `group` exige `grupoId` — é o que a tela do grupo manda
 * (M04). Papel global ou próprio recusa `grupoId`: aceitar e ignorar faria
 * quem atribuiu achar que deu um acesso restrito a um grupo, quando deu um
 * acesso à equipe inteira.
 */
export async function atribuirPapel(
	db: Database,
	actor: Actor,
	entrada: { personId: string; roleId: string; grupoId?: string | null },
	contexto: ContextoSensivel
): Promise<void> {
	authorize(actor, 'rbac.manage');
	exigirReautenticacao(contexto.reautenticadoRecentemente);
	exigirOutraPessoa(actor, entrada.personId);
	if (!ehId(entrada.personId) || !ehId(entrada.roleId)) {
		throw new AcessoRecusado('nao_encontrado', 'Escolha a pessoa e o papel da lista.');
	}
	if (entrada.grupoId && !ehId(entrada.grupoId)) {
		throw new AcessoRecusado('nao_encontrado', 'Esse grupo não existe.');
	}

	const [alvo] = await db
		.select({ id: person.id })
		.from(person)
		.where(
			and(
				eq(person.id, entrada.personId),
				eq(person.teamId, actor.teamId),
				isNull(person.deletedAt)
			)
		)
		.limit(1);
	if (!alvo) throw new AcessoRecusado('nao_encontrado', 'Essa pessoa não existe.');

	const [papel] = await db
		.select()
		.from(role)
		.where(and(eq(role.id, entrada.roleId), eq(role.teamId, actor.teamId)))
		.limit(1);
	if (!papel) throw new AcessoRecusado('nao_encontrado', 'Esse papel não existe.');

	const grupoId = entrada.grupoId ?? null;

	if (papel.defaultScope === 'group' && !grupoId) {
		throw new AcessoRecusado(
			'escopo_de_grupo',
			`"${papel.name}" vale para um grupo específico e é atribuído pela tela do grupo.`
		);
	}

	if (papel.defaultScope !== 'group' && grupoId) {
		throw new AcessoRecusado(
			'escopo_de_grupo',
			`"${papel.name}" vale para a equipe inteira e é atribuído pela tela da pessoa.`
		);
	}

	if (grupoId) {
		const [grupo] = await db
			.select({ id: smallGroup.id, arquivadoEm: smallGroup.archivedAt })
			.from(smallGroup)
			.where(and(eq(smallGroup.id, grupoId), eq(smallGroup.teamId, actor.teamId)))
			.limit(1);
		if (!grupo) throw new AcessoRecusado('nao_encontrado', 'Esse grupo não existe.');
		if (grupo.arquivadoEm) {
			throw new AcessoRecusado('escopo_de_grupo', 'Grupo arquivado não recebe responsáveis.');
		}
	}

	const permissoesDoPapel = (
		await db
			.select({ key: rolePermission.permissionKey })
			.from(rolePermission)
			.where(eq(rolePermission.roleId, papel.id))
	)
		.map((p) => p.key)
		.filter(isPermission);
	exigirSemEscalada(actor, permissoesDoPapel);

	const [criada] = await db
		.insert(personRole)
		.values({
			personId: entrada.personId,
			roleId: papel.id,
			scopeType: papel.defaultScope,
			scopeId: grupoId,
			grantedByPersonId: actor.personId
		})
		// Já tem o papel: o pedido está satisfeito. Repetir não é erro.
		.onConflictDoNothing()
		.returning({ id: personRole.id });

	if (!criada) return;

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'rbac.papel_atribuido',
		entity: 'person_role',
		entityId: criada.id,
		after: {
			personId: entrada.personId,
			roleId: papel.id,
			papel: papel.name,
			scopeType: papel.defaultScope,
			scopeId: grupoId
		},
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});
}

/**
 * Retira um papel de alguém.
 *
 * A trava do último administrador é conferida sobre o estado resultante,
 * dentro da transação: se a remoção deixar a equipe sem quem administre
 * acessos, nada acontece.
 */
export async function removerAtribuicao(
	db: Database,
	actor: Actor,
	atribuicaoId: string,
	contexto: ContextoSensivel
): Promise<void> {
	authorize(actor, 'rbac.manage');
	exigirReautenticacao(contexto.reautenticadoRecentemente);
	if (!ehId(atribuicaoId))
		throw new AcessoRecusado('nao_encontrado', 'Essa atribuição não existe.');

	const [atual] = await db
		.select({
			id: personRole.id,
			personId: personRole.personId,
			roleId: personRole.roleId,
			papel: role.name,
			scopeType: personRole.scopeType,
			scopeId: personRole.scopeId
		})
		.from(personRole)
		.innerJoin(role, eq(role.id, personRole.roleId))
		.where(and(eq(personRole.id, atribuicaoId), eq(role.teamId, actor.teamId)))
		.limit(1);
	if (!atual) throw new AcessoRecusado('nao_encontrado', 'Essa atribuição não existe mais.');

	exigirOutraPessoa(actor, atual.personId);

	await db.transaction(async (tx) => {
		await travarAdministracao(tx as unknown as Database, actor.teamId);
		await tx.delete(personRole).where(eq(personRole.id, atribuicaoId));
		await exigirAdministradorRestante(tx as unknown as Database, actor.teamId);
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'rbac.papel_removido',
		entity: 'person_role',
		entityId: atribuicaoId,
		before: {
			personId: atual.personId,
			roleId: atual.roleId,
			papel: atual.papel,
			scopeType: atual.scopeType,
			scopeId: atual.scopeId
		},
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});
}
