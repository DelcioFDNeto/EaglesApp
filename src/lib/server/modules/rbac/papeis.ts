import { and, asc, count, countDistinct, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '$server/db';
import { person, personRole, role, rolePermission } from '$server/db/schema';
import { audit } from '$server/audit/log';
import { authorize, type Actor } from '$server/policy/policy';
import { isPermission, type Permission, type ScopeType } from '$server/policy/permissions';
import { exigirAdministradorRestante, travarAdministracao } from './administradores';
import {
	AcessoRecusado,
	chaveDoNome,
	exigirReautenticacao,
	exigirSemEscalada,
	type ContextoSensivel
} from './regras';

/**
 * Papéis: o conjunto nomeado de permissões que se atribui a alguém.
 *
 * Toda operação aqui exige `rbac.manage` em escopo GLOBAL — `authorize` sem
 * contexto só deixa passar atribuição global. Administrar acesso não é tarefa
 * de um grupo.
 */

export type PapelResumo = {
	id: string;
	key: string;
	name: string;
	description: string | null;
	isSystem: boolean;
	defaultScope: ScopeType;
	pessoas: number;
	permissoes: number;
};

/** Atribuição ainda em vigor: sem validade, ou validade no futuro. */
const vigente = () => or(isNull(personRole.expiresAt), gt(personRole.expiresAt, new Date()));

export async function listarPapeis(db: Database, actor: Actor): Promise<PapelResumo[]> {
	authorize(actor, 'rbac.manage');

	const [papeis, pessoas, permissoes] = await Promise.all([
		db.select().from(role).where(eq(role.teamId, actor.teamId)),
		db
			.select({ roleId: personRole.roleId, total: countDistinct(personRole.personId) })
			.from(personRole)
			.innerJoin(person, eq(person.id, personRole.personId))
			.where(and(isNull(person.deletedAt), vigente()))
			.groupBy(personRole.roleId),
		db
			.select({ roleId: rolePermission.roleId, total: count() })
			.from(rolePermission)
			.groupBy(rolePermission.roleId)
	]);

	const porPapel = (linhas: { roleId: string; total: number }[]) =>
		new Map(linhas.map((l) => [l.roleId, Number(l.total)]));
	const nPessoas = porPapel(pessoas);
	const nPermissoes = porPapel(permissoes);

	return papeis
		.map((p) => ({
			id: p.id,
			key: p.key,
			name: p.name,
			description: p.description,
			isSystem: p.isSystem,
			defaultScope: p.defaultScope as ScopeType,
			pessoas: nPessoas.get(p.id) ?? 0,
			permissoes: nPermissoes.get(p.id) ?? 0
		}))
		.sort(
			// Sistema primeiro; dentro de cada bloco, quem tem mais poder em cima.
			// Dá Líder → Conselheiro → Membro → Visitante sem comparar chave.
			(a, b) =>
				Number(b.isSystem) - Number(a.isSystem) ||
				b.permissoes - a.permissoes ||
				a.name.localeCompare(b.name, 'pt-BR')
		);
}

export type PapelDetalhe = PapelResumo & {
	permissoesDoPapel: Permission[];
	quemTem: {
		atribuicaoId: string;
		personId: string;
		fullName: string;
		scopeType: ScopeType;
		desde: Date;
	}[];
};

export async function verPapel(
	db: Database,
	actor: Actor,
	roleId: string
): Promise<PapelDetalhe | null> {
	authorize(actor, 'rbac.manage');

	const [papel] = await db
		.select()
		.from(role)
		.where(and(eq(role.id, roleId), eq(role.teamId, actor.teamId)))
		.limit(1);
	if (!papel) return null;

	const [perms, quem] = await Promise.all([
		db
			.select({ key: rolePermission.permissionKey })
			.from(rolePermission)
			.where(eq(rolePermission.roleId, roleId)),
		db
			.select({
				atribuicaoId: personRole.id,
				personId: person.id,
				fullName: person.fullName,
				scopeType: personRole.scopeType,
				desde: personRole.createdAt
			})
			.from(personRole)
			.innerJoin(person, eq(person.id, personRole.personId))
			.where(and(eq(personRole.roleId, roleId), isNull(person.deletedAt), vigente()))
			.orderBy(asc(person.fullNameNormalized))
	]);

	const permissoesDoPapel = perms.map((p) => p.key).filter(isPermission);

	return {
		id: papel.id,
		key: papel.key,
		name: papel.name,
		description: papel.description,
		isSystem: papel.isSystem,
		defaultScope: papel.defaultScope as ScopeType,
		pessoas: new Set(quem.map((q) => q.personId)).size,
		permissoes: permissoesDoPapel.length,
		permissoesDoPapel,
		quemTem: quem.map((q) => ({ ...q, scopeType: q.scopeType as ScopeType }))
	};
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export const papelSchema = z.object({
	name: z
		.string()
		.trim()
		.min(2, 'Dê um nome ao papel.')
		.max(60, 'O nome pode ter no máximo 60 caracteres.'),
	description: z
		.string()
		.trim()
		.max(200, 'A descrição pode ter no máximo 200 caracteres.')
		.transform((v) => (v === '' ? null : v))
		.nullable()
		.optional(),
	permissoes: z
		.array(z.string())
		.transform((lista) => [...new Set(lista)])
		.refine((lista) => lista.every(isPermission), 'Há uma permissão que não existe no catálogo.')
		.transform((lista) => lista as Permission[])
});

export const novoPapelSchema = papelSchema.extend({
	// Escopo de grupo só existe quando houver grupo para apontar (M04).
	defaultScope: z.enum(['global', 'self'], {
		errorMap: () => ({ message: 'Escolha o alcance do papel.' })
	})
});

async function exigirNomeLivre(db: Database, teamId: string, nome: string, exceto?: string) {
	const [mesmoNome] = await db
		.select({ id: role.id })
		.from(role)
		.where(
			and(
				eq(role.teamId, teamId),
				sql`lower(${role.name}) = lower(${nome})`,
				exceto ? ne(role.id, exceto) : undefined
			)
		)
		.limit(1);
	if (mesmoNome) {
		throw new AcessoRecusado('nome_em_uso', 'Já existe um papel com esse nome.');
	}
}

/** Papel personalizado (RF-03.4). */
export async function criarPapel(
	db: Database,
	actor: Actor,
	dados: z.infer<typeof novoPapelSchema>,
	contexto: ContextoSensivel
): Promise<string> {
	authorize(actor, 'rbac.manage');
	exigirReautenticacao(contexto.reautenticadoRecentemente);
	exigirSemEscalada(actor, dados.permissoes);
	await exigirNomeLivre(db, actor.teamId, dados.name);

	// Chave única dentro da equipe: `apoio`, `apoio_2`, `apoio_3`…
	const base = chaveDoNome(dados.name);
	const existentes = new Set(
		(
			await db
				.select({ key: role.key })
				.from(role)
				.where(and(eq(role.teamId, actor.teamId), sql`${role.key} like ${base + '%'}`))
		).map((r) => r.key)
	);
	let key = base;
	for (let n = 2; existentes.has(key); n++) key = `${base}_${n}`;

	const id = await db.transaction(async (tx) => {
		const [novo] = await tx
			.insert(role)
			.values({
				teamId: actor.teamId,
				key,
				name: dados.name,
				description: dados.description ?? null,
				isSystem: false,
				defaultScope: dados.defaultScope
			})
			.returning({ id: role.id });
		if (!novo) throw new Error('não foi possível criar o papel');

		if (dados.permissoes.length > 0) {
			await tx
				.insert(rolePermission)
				.values(dados.permissoes.map((p) => ({ roleId: novo.id, permissionKey: p })));
		}
		return novo.id;
	});

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'rbac.papel_criado',
		entity: 'role',
		entityId: id,
		after: {
			key,
			name: dados.name,
			defaultScope: dados.defaultScope,
			permissoes: [...dados.permissoes].sort()
		},
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});

	return id;
}

/**
 * Edita nome, descrição e permissões de um papel.
 *
 * Papéis de sistema também: a seção 11.3 os protege de EXCLUSÃO, não de
 * ajuste. A liderança pode decidir, por exemplo, que conselheiro não lança
 * despesa.
 *
 * Duas travas se aplicam às permissões:
 *   - só se ACRESCENTA o que o ator tem (retirar é sempre permitido)
 *   - retirar `rbac.manage` não pode deixar a equipe sem administrador
 */
export async function atualizarPapel(
	db: Database,
	actor: Actor,
	roleId: string,
	dados: z.infer<typeof papelSchema>,
	contexto: ContextoSensivel
): Promise<void> {
	authorize(actor, 'rbac.manage');
	exigirReautenticacao(contexto.reautenticadoRecentemente);

	const [antes] = await db
		.select()
		.from(role)
		.where(and(eq(role.id, roleId), eq(role.teamId, actor.teamId)))
		.limit(1);
	if (!antes) throw new AcessoRecusado('nao_encontrado', 'Esse papel não existe.');

	await exigirNomeLivre(db, actor.teamId, dados.name, roleId);

	const atuais = new Set(
		(
			await db
				.select({ key: rolePermission.permissionKey })
				.from(rolePermission)
				.where(eq(rolePermission.roleId, roleId))
		)
			.map((p) => p.key)
			.filter(isPermission)
	);
	const novas = new Set(dados.permissoes);

	const acrescentadas = [...novas].filter((p) => !atuais.has(p)).sort();
	const retiradas = [...atuais].filter((p) => !novas.has(p)).sort();

	// Só o que se ACRESCENTA passa pela trava de escalada: retirar uma
	// permissão que o ator não tem é reduzir poder, nunca ganhá-lo.
	exigirSemEscalada(actor, acrescentadas);

	const mudouTexto =
		antes.name !== dados.name || (antes.description ?? null) !== (dados.description ?? null);

	if (!mudouTexto && acrescentadas.length === 0 && retiradas.length === 0) return;

	await db.transaction(async (tx) => {
		await travarAdministracao(tx as unknown as Database, actor.teamId);
		if (mudouTexto) {
			await tx
				.update(role)
				.set({ name: dados.name, description: dados.description ?? null, updatedAt: new Date() })
				.where(eq(role.id, roleId));
		}
		if (retiradas.length > 0) {
			await tx
				.delete(rolePermission)
				.where(
					and(
						eq(rolePermission.roleId, roleId),
						or(...retiradas.map((p) => eq(rolePermission.permissionKey, p)))
					)
				);
		}
		if (acrescentadas.length > 0) {
			await tx
				.insert(rolePermission)
				.values(acrescentadas.map((p) => ({ roleId, permissionKey: p })));
		}
		// Sobre o estado RESULTANTE, antes do commit.
		await exigirAdministradorRestante(tx as unknown as Database, actor.teamId);
	});

	if (mudouTexto) {
		await audit(db, {
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			action: 'rbac.papel_editado',
			entity: 'role',
			entityId: roleId,
			before: { name: antes.name, description: antes.description },
			after: { name: dados.name, description: dados.description ?? null },
			ip: contexto.ip,
			userAgent: contexto.userAgent
		});
	}

	if (acrescentadas.length > 0 || retiradas.length > 0) {
		await audit(db, {
			teamId: actor.teamId,
			actorPersonId: actor.personId,
			action: 'rbac.permissoes_alteradas',
			entity: 'role',
			entityId: roleId,
			before: { permissoes: [...atuais].sort() },
			after: { permissoes: [...novas].sort(), acrescentadas, retiradas },
			ip: contexto.ip,
			userAgent: contexto.userAgent
		});
	}
}

/**
 * Exclui um papel personalizado VAZIO (D-M03-4).
 *
 * Papel de sistema nunca. Papel com gente, só depois de cada pessoa perder o
 * papel — uma por uma, cada remoção na auditoria. A cascata do banco faria o
 * mesmo em lote, sem deixar rastro de quem perdeu o quê.
 */
export async function excluirPapel(
	db: Database,
	actor: Actor,
	roleId: string,
	contexto: ContextoSensivel
): Promise<void> {
	authorize(actor, 'rbac.manage');
	exigirReautenticacao(contexto.reautenticadoRecentemente);

	const [papel] = await db
		.select()
		.from(role)
		.where(and(eq(role.id, roleId), eq(role.teamId, actor.teamId)))
		.limit(1);
	if (!papel) throw new AcessoRecusado('nao_encontrado', 'Esse papel não existe.');

	if (papel.isSystem) {
		throw new AcessoRecusado(
			'papel_de_sistema',
			'Os quatro papéis básicos não podem ser excluídos. Você pode ajustar as permissões deles.'
		);
	}

	const [ocupado] = await db
		.select({ total: count() })
		.from(personRole)
		.where(eq(personRole.roleId, roleId));
	if (Number(ocupado?.total ?? 0) > 0) {
		throw new AcessoRecusado(
			'papel_com_pessoas',
			'Ainda há pessoas com este papel. Retire o papel de cada uma antes de excluí-lo.'
		);
	}

	const permissoes = (
		await db
			.select({ key: rolePermission.permissionKey })
			.from(rolePermission)
			.where(eq(rolePermission.roleId, roleId))
	).map((p) => p.key);

	await db.delete(role).where(eq(role.id, roleId));

	await audit(db, {
		teamId: actor.teamId,
		actorPersonId: actor.personId,
		action: 'rbac.papel_excluido',
		entity: 'role',
		entityId: roleId,
		before: { key: papel.key, name: papel.name, permissoes: permissoes.sort() },
		ip: contexto.ip,
		userAgent: contexto.userAgent
	});
}
