/**
 * Schema do Eagles App — Módulo 01 (Fundação).
 *
 * Só entram aqui as tabelas que o M01 usa de fato. Grupos, eventos, presença,
 * responsabilidades e financeiro chegam nos seus próprios módulos: tabela vazia
 * que ninguém usa é dívida, não adiantamento.
 *
 * Convenções (seção 12 da arquitetura):
 *   - snake_case no banco, camelCase no TypeScript
 *   - chaves primárias UUID v7 (ordenáveis, sem revelar volume)
 *   - `teamId` em toda tabela raiz — multi-equipe preparado, sem interface (ADR 0001)
 *   - timestamps sempre com fuso
 *   - exclusão lógica onde há histórico a preservar
 */

import { relations, sql } from 'drizzle-orm';
import {
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { uuidv7 } from '../id';

const pk = () =>
	uuid('id')
		.primaryKey()
		.$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Equipe — raiz multi-equipe. Uma linha ("Eagles"), sem interface. ADR 0001.
// ---------------------------------------------------------------------------

export const team = pgTable('team', {
	id: pk(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

// ---------------------------------------------------------------------------
// Pessoas — existem sem conta de acesso (RN-01)
// ---------------------------------------------------------------------------

export const person = pgTable(
	'person',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id),

		/** Único campo obrigatório em nível de sistema (RN-05). */
		fullName: text('full_name').notNull(),

		/**
		 * Determina o regime de tratamento de dados (ADR 0003).
		 * Opcional no primeiro contato; enquanto vazio, vale o regime restrito.
		 *
		 * NÃO existe coluna `is_minor` armazenada: idade depende da data de hoje,
		 * e o Postgres exige expressão imutável em coluna gerada. A derivação
		 * vive na view `person_view` (ver migração 0000).
		 */
		birthDate: date('birth_date'),

		notes: text('notes'),

		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [index('person_team_idx').on(t.teamId), index('person_name_idx').on(t.teamId, t.fullName)]
);

// ---------------------------------------------------------------------------
// Acesso — conta, sessão e convite (ADR 0004)
// ---------------------------------------------------------------------------

export const userAccount = pgTable(
	'user_account',
	{
		id: pk(),
		/** A conta aponta para a pessoa, nunca o contrário (RN-01). */
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),

		email: text('email'),
		phone: text('phone'),

		/** Argon2id. Nulo enquanto o convite não foi aceito. */
		passwordHash: text('password_hash'),

		totpSecret: text('totp_secret'),
		emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),

		failedAttempts: integer('failed_attempts').notNull().default(0),
		lockedUntil: timestamp('locked_until', { withTimezone: true }),
		lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

		disabledAt: timestamp('disabled_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('user_account_person_idx').on(t.personId),
		uniqueIndex('user_account_email_idx')
			.on(sql`lower(${t.email})`)
			.where(sql`${t.email} is not null`),
		uniqueIndex('user_account_phone_idx')
			.on(t.phone)
			.where(sql`${t.phone} is not null`)
	]
);

export const session = pgTable(
	'session',
	{
		id: pk(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => userAccount.id, { onDelete: 'cascade' }),

		/** SHA-256 do token. O token em claro só existe no cookie do usuário. */
		tokenHash: text('token_hash').notNull().unique(),

		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		/** Marca temporal da última reautenticação, para operações sensíveis. */
		reauthenticatedAt: timestamp('reauthenticated_at', { withTimezone: true }),

		ip: text('ip'),
		userAgent: text('user_agent'),

		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [
		index('session_account_idx').on(t.accountId),
		index('session_expires_idx').on(t.expiresAt)
	]
);

export const invite = pgTable(
	'invite',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id),
		/** O convite sempre aponta para uma pessoa já cadastrada (ADR 0004). */
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),

		tokenHash: text('token_hash').notNull().unique(),

		createdByPersonId: uuid('created_by_person_id').references(() => person.id),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		usedAt: timestamp('used_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [index('invite_person_idx').on(t.personId)]
);

// ---------------------------------------------------------------------------
// RBAC — papéis e permissões são DADOS, não código (RF-03.1)
// ---------------------------------------------------------------------------

export const permission = pgTable('permission', {
	/** A própria string `recurso.acao` é a chave. */
	key: text('key').primaryKey(),
	description: text('description').notNull()
});

export const role = pgTable(
	'role',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id),
		key: text('key').notNull(),
		name: text('name').notNull(),
		description: text('description'),
		/** Protege contra exclusão acidental. NÃO congela as permissões. */
		isSystem: boolean('is_system').notNull().default(false),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('role_team_key_idx').on(t.teamId, t.key)]
);

export const rolePermission = pgTable(
	'role_permission',
	{
		roleId: uuid('role_id')
			.notNull()
			.references(() => role.id, { onDelete: 'cascade' }),
		permissionKey: text('permission_key')
			.notNull()
			.references(() => permission.key, { onDelete: 'cascade' })
	},
	(t) => [uniqueIndex('role_permission_idx').on(t.roleId, t.permissionKey)]
);

export const personRole = pgTable(
	'person_role',
	{
		id: pk(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		roleId: uuid('role_id')
			.notNull()
			.references(() => role.id, { onDelete: 'cascade' }),

		/** 'global' | 'group' | 'self' — o eixo de pertencimento (seção 5.2). */
		scopeType: text('scope_type').notNull(),
		/** Id do grupo quando scopeType = 'group'. Nulo nos demais. */
		scopeId: uuid('scope_id'),

		grantedByPersonId: uuid('granted_by_person_id').references(() => person.id),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [
		index('person_role_person_idx').on(t.personId),
		// Unicidade com NULL não funciona no Postgres, então são dois índices parciais.
		uniqueIndex('person_role_scoped_idx')
			.on(t.personId, t.roleId, t.scopeType, t.scopeId)
			.where(sql`${t.scopeId} is not null`),
		uniqueIndex('person_role_unscoped_idx')
			.on(t.personId, t.roleId, t.scopeType)
			.where(sql`${t.scopeId} is null`)
	]
);

// ---------------------------------------------------------------------------
// Sistema — configurações, chaves de funcionalidade e auditoria
// ---------------------------------------------------------------------------

export const setting = pgTable(
	'setting',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id),
		key: text('key').notNull(),
		value: jsonb('value').notNull(),
		/** 'global' | 'group' | 'person' */
		scopeType: text('scope_type').notNull().default('global'),
		scopeId: uuid('scope_id'),
		updatedByPersonId: uuid('updated_by_person_id').references(() => person.id),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('setting_scoped_idx')
			.on(t.teamId, t.key, t.scopeType, t.scopeId)
			.where(sql`${t.scopeId} is not null`),
		uniqueIndex('setting_unscoped_idx')
			.on(t.teamId, t.key, t.scopeType)
			.where(sql`${t.scopeId} is null`)
	]
);

/**
 * Chaves de funcionalidade. TODAS nascem desligadas (RN-29): o estado padrão
 * de instalação é o sistema menos burocrático possível, e ligar cada controle
 * é uma decisão consciente da liderança.
 */
export const featureFlag = pgTable(
	'feature_flag',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id),
		key: text('key').notNull(),
		enabled: boolean('enabled').notNull().default(false),
		description: text('description'),
		updatedByPersonId: uuid('updated_by_person_id').references(() => person.id),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('feature_flag_team_key_idx').on(t.teamId, t.key)]
);

/**
 * Auditoria append-only (RN-28).
 *
 * A migração 0000 revoga UPDATE e DELETE desta tabela para o usuário da
 * aplicação. Não é convenção de código — é permissão de banco.
 */
export const auditLog = pgTable(
	'audit_log',
	{
		id: pk(),
		teamId: uuid('team_id').references(() => team.id),
		actorPersonId: uuid('actor_person_id').references(() => person.id),
		action: text('action').notNull(),
		entity: text('entity').notNull(),
		entityId: uuid('entity_id'),
		before: jsonb('before'),
		after: jsonb('after'),
		ip: text('ip'),
		userAgent: text('user_agent'),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('audit_log_at_idx').on(t.at),
		index('audit_log_entity_idx').on(t.entity, t.entityId),
		index('audit_log_actor_idx').on(t.actorPersonId)
	]
);

// ---------------------------------------------------------------------------
// Relações
// ---------------------------------------------------------------------------

export const personRelations = relations(person, ({ one, many }) => ({
	team: one(team, { fields: [person.teamId], references: [team.id] }),
	account: one(userAccount, { fields: [person.id], references: [userAccount.personId] }),
	roles: many(personRole)
}));

export const userAccountRelations = relations(userAccount, ({ one, many }) => ({
	person: one(person, { fields: [userAccount.personId], references: [person.id] }),
	sessions: many(session)
}));

export const sessionRelations = relations(session, ({ one }) => ({
	account: one(userAccount, { fields: [session.accountId], references: [userAccount.id] })
}));

export const roleRelations = relations(role, ({ many }) => ({
	permissions: many(rolePermission),
	assignments: many(personRole)
}));

export const rolePermissionRelations = relations(rolePermission, ({ one }) => ({
	role: one(role, { fields: [rolePermission.roleId], references: [role.id] }),
	permission: one(permission, {
		fields: [rolePermission.permissionKey],
		references: [permission.key]
	})
}));

export const personRoleRelations = relations(personRole, ({ one }) => ({
	person: one(person, { fields: [personRole.personId], references: [person.id] }),
	role: one(role, { fields: [personRole.roleId], references: [role.id] })
}));
