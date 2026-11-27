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
// Redefinição de senha e solicitação de cadastro (Opção B: API separada)
// ---------------------------------------------------------------------------

/**
 * Tokens de redefinição de senha ("esqueci minha senha").
 * Expiram em 15 minutos e são de uso único.
 */
export const senhaReset = pgTable(
	'senha_reset',
	{
		id: pk(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		token: text('token').notNull().unique(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		usedAt: timestamp('used_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [index('senha_reset_person_idx').on(t.personId)]
);

/**
 * Solicitações de cadastro pendentes de convite do conselheiro.
 * O produto Eagles não permite cadastro livre: o conselheiro gera o convite.
 */
export const cadastroPendente = pgTable(
	'cadastro_pendente',
	{
		id: pk(),
		nome: text('nome').notNull(),
		email: text('email').notNull(),
		telefone: text('telefone'),
		criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('cadastro_pendente_email_idx').on(t.email)]
);

// ---------------------------------------------------------------------------
// Módulo 02 — Pessoas: perfil estendido e histórico de evolução de status
// ---------------------------------------------------------------------------

/**
 * Perfil estendido da pessoa. Campos opcionais do cadastro progressivo.
 * A pessoa existe sem perfil completo (RN-01); preenchimento é progressivo.
 */
export const personProfile = pgTable(
	'person_profile',
	{
		id: pk(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),

		// Contato
		phone: text('phone'),
		whatsapp: text('whatsapp'),
		email: text('email'),

		// Identidade
		birthDate: date('birth_date'),
		photoUrl: text('photo_url'),

		// Relacionamento e família
		relationshipStatus: text('relationship_status'), // solteiro, namorado, casado, etc.
		siblings: text('siblings'), // nomes dos irmãos
		familyTies: text('family_ties'), // vínculos familiares na comunidade

		// Pertencimento
		groupId: uuid('group_id'), // grupo/PG atual (opcional até ser atribuído)
		roleKey: text('role_key'), // função dentro do grupo (opcional)
		status: text('status').notNull().default('visitante'), // visitante, recorrente, membro, conselheiro, lider
		joinedAt: timestamp('joined_at', { withTimezone: true }), // data de entrada como membro

		// Participação
		frequency: integer('frequency').notNull().default(0),
		notes: text('notes'),

		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('person_profile_person_idx').on(t.personId),
		index('person_profile_status_idx').on(t.status),
		index('person_profile_group_idx').on(t.groupId)
	]
);

/**
 * Histórico de evolução de status da pessoa.
 * Registra cada transição: primeiro contato, participação em PGs, evento,
 * mudança de status, entrada nos Eagles, mudança de equipe, etc.
 */
export const personStatusHistory = pgTable(
	'person_status_history',
	{
		id: pk(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		fromStatus: text('from_status'),
		toStatus: text('to_status').notNull(),
		reason: text('reason'), // motivação da mudança
		changedByPersonId: uuid('changed_by_person_id').references(() => person.id),
		eventId: uuid('event_id'), // evento relacionado (quando aplicável)
		groupId: uuid('group_id'), // grupo relacionado (quando aplicável)
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: createdAt()
	},
	(t) => [
		index('person_status_history_person_idx').on(t.personId),
		index('person_status_history_occurred_idx').on(t.occurredAt)
	]
);

// ---------------------------------------------------------------------------
// Módulo 04 — Grupos/PGs
// ---------------------------------------------------------------------------

/**
 * Grupos/PGs — divisões organizacionais dos membros.
 * Não representam níveis hierárquicos; todos os membros de um grupo possuem
 * essencialmente o mesmo nível de permissão.
 */
export const group = pgTable(
	'group',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		description: text('description'),
		createdByPersonId: uuid('created_by_person_id').references(() => person.id),
		/**
		 * "Excluir" um PG é arquivá-lo: some das listas e não recebe ninguém,
		 * mas eventos, escalas e o histórico de quem passou por ele continuam
		 * apontando para um grupo que existe. Só arquiva PG vazio.
		 */
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		archivedByPersonId: uuid('archived_by_person_id').references(() => person.id),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('group_team_idx').on(t.teamId),
		uniqueIndex('group_team_slug_idx').on(t.teamId, t.slug)
	]
);

/**
 * Vínculo pessoa ↔ grupo. Uma pessoa pertence a apenas um grupo por vez.
 */
export const groupMember = pgTable(
	'group_member',
	{
		id: pk(),
		groupId: uuid('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		roleKey: text('role_key'), // função dentro do grupo (opcional)
		joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('group_member_group_idx').on(t.groupId),
		index('group_member_person_idx').on(t.personId),
		uniqueIndex('group_member_person_unique_idx').on(t.personId) // uma pessoa, um grupo por vez
	]
);

/**
 * Histórico de PG: cada entrada, saída e transferência (seção 5: os grupos
 * são reorganizados ao longo do ano, e isso precisa ficar contado).
 *
 * `group_member` guarda só o PG ATUAL; aqui fica o caminho. Append-only,
 * garantido por gatilho no banco, como a auditoria.
 *
 * `fromGroupId` nulo = entrou sem vir de PG nenhum; `toGroupId` nulo = saiu
 * de todos os PGs.
 */
export const groupMemberHistory = pgTable(
	'group_member_history',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		fromGroupId: uuid('from_group_id').references(() => group.id),
		toGroupId: uuid('to_group_id').references(() => group.id),
		reason: text('reason'),
		/** 'cadastro' | 'manual' | 'ia' (sugestão da IA aceita por alguém). */
		origin: text('origin').notNull().default('manual'),
		changedByPersonId: uuid('changed_by_person_id').references(() => person.id),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('group_member_history_person_idx').on(t.personId, t.occurredAt),
		index('group_member_history_to_idx').on(t.toGroupId, t.occurredAt),
		index('group_member_history_from_idx').on(t.fromGroupId, t.occurredAt)
	]
);

// ---------------------------------------------------------------------------
// Módulo 05 — Eventos
// ---------------------------------------------------------------------------

/**
 * Tipos de evento configuráveis (reunião, encontro, PG, Outside, viagem,
 * acampamento, treinamento, ação social, etc.).
 */
export const eventType = pgTable(
	'event_type',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		description: text('description'),
		color: text('color').default('#A91825'),
		/**
		 * Tipo desativado não aparece para novos eventos, mas continua valendo
		 * para os que já o usam. Não existe exclusão: apagar um tipo apagaria
		 * (ou órfanaria) o histórico de eventos dele.
		 */
		active: boolean('active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('event_type_team_idx').on(t.teamId),
		uniqueIndex('event_type_team_slug_idx').on(t.teamId, t.slug)
	]
);

/**
 * Eventos e compromissos dos Eagles.
 */
export const event = pgTable(
	'event',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		eventTypeId: uuid('event_type_id')
			.notNull()
			.references(() => eventType.id),
		title: text('title').notNull(),
		description: text('description'),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		location: text('location'),
		responsiblePersonId: uuid('responsible_person_id').references(() => person.id),
		groupId: uuid('group_id').references(() => group.id),
		status: text('status').notNull().default('scheduled'), // scheduled, ongoing, completed, cancelled
		/**
		 * Cancelar não apaga nada: as confirmações de presença ficam no
		 * histórico (decisão do usuário, ciclo 1 do M05). Estes campos dizem
		 * quem cancelou, quando e por quê; são limpos se o evento for reativado.
		 */
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		cancelledByPersonId: uuid('cancelled_by_person_id').references(() => person.id),
		cancelReason: text('cancel_reason'),
		rsvpEnabled: boolean('rsvp_enabled').notNull().default(true),
		rsvpOptions: jsonb('rsvp_options')
			.notNull()
			.default([
				{ key: 'confirmado', label: 'Confirmado' },
				{ key: 'talvez', label: 'Talvez' },
				{ key: 'nao_vou', label: 'Não vou' },
				{ key: 'atrasado', label: 'Chegarei atrasado' },
				{ key: 'convidado', label: 'Vou levar convidado' }
			]),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('event_team_idx').on(t.teamId),
		index('event_type_idx').on(t.eventTypeId),
		index('event_starts_at_idx').on(t.startsAt),
		index('event_group_idx').on(t.groupId)
	]
);

/**
 * RSVP / inscrições em eventos.
 * Cada pessoa pode ter apenas uma resposta por evento.
 */
export const eventRegistration = pgTable(
	'event_registration',
	{
		id: pk(),
		eventId: uuid('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		option: text('option').notNull(), // chave do rsvpOptions
		guests: integer('guests').notNull().default(0), // número de convidados (para 'vou levar convidado')
		notes: text('notes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('event_registration_event_idx').on(t.eventId),
		index('event_registration_person_idx').on(t.personId),
		uniqueIndex('event_registration_person_event_unique_idx').on(t.personId, t.eventId)
	]
);

/**
 * Histórico de respostas de presença (RN-12): cada resposta dada, inclusive as
 * que foram trocadas depois. `event_registration` guarda só a resposta ATUAL;
 * aqui fica o caminho ("confirmou na segunda, desmarcou na quinta").
 *
 * Append-only, garantido por gatilho no banco. Observações não são copiadas:
 * o histórico responde "o que respondeu e quando", não guarda texto livre.
 */
export const rsvpHistory = pgTable(
	'rsvp_history',
	{
		id: pk(),
		eventId: uuid('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		option: text('option').notNull(),
		guests: integer('guests').notNull().default(0),
		/** Quem registrou a resposta (hoje, sempre a própria pessoa). */
		answeredByPersonId: uuid('answered_by_person_id').references(() => person.id),
		answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('rsvp_history_event_person_idx').on(t.eventId, t.personId, t.answeredAt)]
);

// ---------------------------------------------------------------------------
// Módulo 06 — Presença e Check-in
// ---------------------------------------------------------------------------

/**
 * Presença efetiva em eventos.
 * Separada do RSVP: uma pessoa pode confirmar presença no RSVP mas não comparecer,
 * ou comparecer sem ter confirmado.
 */
export const presence = pgTable(
	'presence',
	{
		id: pk(),
		eventId: uuid('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		/**
		 * 'present' - compareceu
		 * 'absent' - não compareceu (marcado pelo conselheiro)
		 * 'late' - chegou atrasado
		 */
		status: text('status').notNull().default('present'),
		/**
		 * Como a presença foi registrada:
		 * 'manual' - conselheiro marcou
		 * 'qr_code' - check-in via QR Code
		 * 'self' - própria pessoa confirmou no app
		 */
		registrationMethod: text('registration_method').notNull().default('manual'),
		registeredByPersonId: uuid('registered_by_person_id').references(() => person.id),
		registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('presence_event_idx').on(t.eventId),
		index('presence_person_idx').on(t.personId),
		uniqueIndex('presence_person_event_unique_idx').on(t.personId, t.eventId)
	]
);

/**
 * Check-in por QR Code (funcionalidade opcional).
 * Gera um código único por evento que expira após um tempo.
 * Apenas pessoas presentes no local podem escanear.
 */
export const eventCheckin = pgTable(
	'event_checkin',
	{
		id: pk(),
		eventId: uuid('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		/**
		 * Código QR gerado para este evento.
		 * Expira após checkinExpiresAt.
		 */
		qrCode: text('qr_code').notNull().unique(),
		/**
		 * Quando o QR Code expira. Após isso, não pode mais ser usado.
		 */
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		/**
		 * Se o QR Code está ativo (pode ser desativado antecipadamente).
		 */
		isActive: boolean('is_active').notNull().default(true),
		createdByPersonId: uuid('created_by_person_id').references(() => person.id),
		createdAt: createdAt()
	},
	(t) => [
		index('event_checkin_event_idx').on(t.eventId),
		index('event_checkin_qr_idx').on(t.qrCode)
	]
);

/**
 * Registro de uso de QR Code (quem escaneou, quando e de onde).
 */
export const checkinScan = pgTable(
	'checkin_scan',
	{
		id: pk(),
		checkinId: uuid('checkin_id')
			.notNull()
			.references(() => eventCheckin.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent')
	},
	(t) => [
		index('checkin_scan_checkin_idx').on(t.checkinId),
		index('checkin_scan_person_idx').on(t.personId)
	]
);

// ---------------------------------------------------------------------------
// Relações
// ---------------------------------------------------------------------------

export const personRelations = relations(person, ({ one, many }) => ({
	team: one(team, { fields: [person.teamId], references: [team.id] }),
	account: one(userAccount, { fields: [person.id], references: [userAccount.personId] }),
	roles: many(personRole),
	senhaResets: many(senhaReset),
	profile: one(personProfile, { fields: [person.id], references: [personProfile.personId] }),
	statusHistory: many(personStatusHistory),
	groupMemberships: many(groupMember),
	eventRegistrations: many(eventRegistration),
	presences: many(presence),
	checkinScans: many(checkinScan)
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

export const senhaResetRelations = relations(senhaReset, ({ one }) => ({
	person: one(person, { fields: [senhaReset.personId], references: [person.id] })
}));

export const groupRelations = relations(group, ({ one, many }) => ({
	team: one(team, { fields: [group.teamId], references: [team.id] }),
	createdBy: one(person, { fields: [group.createdByPersonId], references: [person.id] }),
	members: many(groupMember)
}));

export const groupMemberRelations = relations(groupMember, ({ one }) => ({
	group: one(group, { fields: [groupMember.groupId], references: [group.id] }),
	person: one(person, { fields: [groupMember.personId], references: [person.id] })
}));

export const eventTypeRelations = relations(eventType, ({ one, many }) => ({
	team: one(team, { fields: [eventType.teamId], references: [team.id] }),
	events: many(event)
}));

export const eventRelations = relations(event, ({ one, many }) => ({
	team: one(team, { fields: [event.teamId], references: [team.id] }),
	type: one(eventType, { fields: [event.eventTypeId], references: [eventType.id] }),
	responsible: one(person, { fields: [event.responsiblePersonId], references: [person.id] }),
	group: one(group, { fields: [event.groupId], references: [group.id] }),
	registrations: many(eventRegistration),
	presences: many(presence),
	checkins: many(eventCheckin)
}));

export const eventRegistrationRelations = relations(eventRegistration, ({ one }) => ({
	event: one(event, { fields: [eventRegistration.eventId], references: [event.id] }),
	person: one(person, { fields: [eventRegistration.personId], references: [person.id] })
}));

export const presenceRelations = relations(presence, ({ one }) => ({
	event: one(event, { fields: [presence.eventId], references: [event.id] }),
	person: one(person, { fields: [presence.personId], references: [person.id] }),
	registeredBy: one(person, { fields: [presence.registeredByPersonId], references: [person.id] })
}));

export const eventCheckinRelations = relations(eventCheckin, ({ one, many }) => ({
	event: one(event, { fields: [eventCheckin.eventId], references: [event.id] }),
	createdBy: one(person, { fields: [eventCheckin.createdByPersonId], references: [person.id] }),
	scans: many(checkinScan)
}));

export const checkinScanRelations = relations(checkinScan, ({ one }) => ({
	checkin: one(eventCheckin, { fields: [checkinScan.checkinId], references: [eventCheckin.id] }),
	person: one(person, { fields: [checkinScan.personId], references: [person.id] })
}));

// ---------------------------------------------------------------------------
// Módulo 07 - Responsabilidades e Escalas
// ---------------------------------------------------------------------------

/**
 * Tipos de responsabilidade configuráveis (palestra, música, alimentação,
 * organização, recepção, etc.). Configuráveis por líderes e conselheiros.
 */
export const responsabilidade = pgTable(
	'responsabilidade',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		nome: text('nome').notNull(),
		descricao: text('descricao'),
		/** Intervalo mínimo em dias entre repetições da mesma pessoa (RF-07.6 / RN-19). */
		intervaloMinimoDias: integer('intervalo_minimo_dias').notNull().default(14),
		ativo: boolean('ativo').notNull().default(true),
		ordem: integer('ordem').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('responsabilidade_team_idx').on(t.teamId),
		uniqueIndex('responsabilidade_team_nome_idx').on(t.teamId, t.nome)
	]
);

/**
 * Escala de responsabilidades para um evento específico.
 * Define quem é responsável por quê em cada evento.
 */
export const escala = pgTable(
	'escala',
	{
		id: pk(),
		eventId: uuid('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		responsabilidadeId: uuid('responsabilidade_id')
			.notNull()
			.references(() => responsabilidade.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		/** 'proposta' | 'confirmada' | 'trocada' | 'cumprida' */
		status: text('status').notNull().default('confirmada'),
		/** 'manual' | 'gerada' */
		origem: text('origem').notNull().default('manual'),
		/** Agrupa itens gerados juntos para revisão e confirmação humana (RN-18). */
		propostaId: uuid('proposta_id'),
		/** Pessoa que assumiu em caso de troca (RF-07.5). */
		substituidoPorPersonId: uuid('substituido_por_person_id').references(() => person.id),
		confirmadoPorPersonId: uuid('confirmado_por_person_id').references(() => person.id),
		confirmadoEm: timestamp('confirmado_em', { withTimezone: true }),
		ordem: integer('ordem').notNull().default(0),
		observacoes: text('observacoes'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('escala_event_idx').on(t.eventId),
		index('escala_person_idx').on(t.personId),
		index('escala_proposta_idx').on(t.propostaId),
		uniqueIndex('escala_event_responsabilidade_person_ativa_idx')
			.on(t.eventId, t.responsabilidadeId, t.personId)
			.where(sql`${t.status} <> 'trocada'`)
	]
);

/**
 * Histórico de alterações de escala (quem escalou quem, quando e por que).
 */
export const escalaHistorico = pgTable(
	'escala_historico',
	{
		id: pk(),
		escalaId: uuid('escala_id')
			.notNull()
			.references(() => escala.id, { onDelete: 'cascade' }),
		acao: text('acao').notNull(), // 'adicionada', 'removida', 'alterada'
		pessoaAlvoId: uuid('pessoa_alvo_id').references(() => person.id),
		alteradoPorPersonId: uuid('alterado_por_person_id').references(() => person.id),
		observacoes: text('observacoes'),
		createdAt: createdAt()
	},
	(t) => [
		index('escala_historico_escala_idx').on(t.escalaId),
		index('escala_historico_pessoa_alvo_idx').on(t.pessoaAlvoId),
		index('escala_historico_alterado_por_idx').on(t.alteradoPorPersonId)
	]
);

export const responsabilidadeRelations = relations(responsabilidade, ({ one, many }) => ({
	team: one(team, { fields: [responsabilidade.teamId], references: [team.id] }),
	escalas: many(escala)
}));

export const escalaRelations = relations(escala, ({ one, many }) => ({
	evento: one(event, { fields: [escala.eventId], references: [event.id] }),
	responsabilidade: one(responsabilidade, {
		fields: [escala.responsabilidadeId],
		references: [responsabilidade.id]
	}),
	pessoa: one(person, { fields: [escala.personId], references: [person.id] }),
	historico: many(escalaHistorico)
}));

// ---------------------------------------------------------------------------
// Módulo 08 — Comunicação (RF-09.1 a RF-09.5, F6, RN-29, RN-33)
// ---------------------------------------------------------------------------

/**
 * Anúncios internos com público-alvo (todos, grupo específico ou status).
 */
export const announcement = pgTable(
	'announcement',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		body: text('body').notNull(),
		/** 'all' | 'group' | 'status' */
		audienceScope: text('audience_scope').notNull().default('all'),
		/** Grupo alvo quando audienceScope = 'group'. */
		groupId: uuid('group_id').references(() => group.id, { onDelete: 'set null' }),
		/** Status alvo quando audienceScope = 'status' (ex.: 'membro', 'conselheiro'). */
		targetStatus: text('target_status'),
		/** Evento opcional vinculado ao aviso. */
		eventId: uuid('event_id').references(() => event.id, { onDelete: 'set null' }),
		/** 'draft' | 'published' | 'archived' */
		status: text('status').notNull().default('draft'),
		authorPersonId: uuid('author_person_id')
			.notNull()
			.references(() => person.id),
		publishedAt: timestamp('published_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('announcement_team_idx').on(t.teamId),
		index('announcement_status_idx').on(t.teamId, t.status),
		index('announcement_group_idx').on(t.groupId)
	]
);

/**
 * Modelos de mensagem reutilizáveis com variáveis ({{evento}}, {{data}}, {{local}}, {{escala}}, {{grupo}}).
 */
export const messageTemplate = pgTable(
	'message_template',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** 'evento' | 'escala' | 'lembrete' | 'aviso' */
		category: text('category').notNull().default('aviso'),
		content: text('content').notNull(),
		active: boolean('active').notNull().default(true),
		createdByPersonId: uuid('created_by_person_id').references(() => person.id),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('message_template_team_idx').on(t.teamId),
		uniqueIndex('message_template_team_name_idx').on(t.teamId, t.name)
	]
);

/**
 * Preferências de notificação por pessoa (RF-09.4 / Fluxo F6).
 * Respeita janela de silêncio (padrão 22h–7h) e limite diário anti-excesso.
 */
export const notificationPreference = pgTable(
	'notification_preference',
	{
		id: pk(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		announcementsEnabled: boolean('announcements_enabled').notNull().default(true),
		eventRemindersEnabled: boolean('event_reminders_enabled').notNull().default(true),
		rsvpRemindersEnabled: boolean('rsvp_reminders_enabled').notNull().default(true),
		responsibilityRemindersEnabled: boolean('responsibility_reminders_enabled')
			.notNull()
			.default(true),
		/** Hora de início da janela de silêncio (0-23, padrão 22h — F6). */
		quietStartHour: integer('quiet_start_hour').notNull().default(22),
		/** Hora de fim da janela de silêncio (0-23, padrão 7h — F6). */
		quietEndHour: integer('quiet_end_hour').notNull().default(7),
		updatedAt: updatedAt()
	},
	(t) => [uniqueIndex('notification_preference_person_idx').on(t.personId)]
);

export const announcementRelations = relations(announcement, ({ one }) => ({
	team: one(team, { fields: [announcement.teamId], references: [team.id] }),
	group: one(group, { fields: [announcement.groupId], references: [group.id] }),
	event: one(event, { fields: [announcement.eventId], references: [event.id] }),
	author: one(person, { fields: [announcement.authorPersonId], references: [person.id] })
}));

export const messageTemplateRelations = relations(messageTemplate, ({ one }) => ({
	team: one(team, { fields: [messageTemplate.teamId], references: [team.id] }),
	createdBy: one(person, { fields: [messageTemplate.createdByPersonId], references: [person.id] })
}));

export const notificationPreferenceRelations = relations(notificationPreference, ({ one }) => ({
	person: one(person, { fields: [notificationPreference.personId], references: [person.id] })
}));

// ---------------------------------------------------------------------------
// Módulo 09 — Financeiro (RN-20 a RN-25, RF-08.1 a RF-08.11)
// Regras rígidas: valores SEMPRE em centavos inteiros; movimentação confirmada
// é imutável (correção = estorno + novo lançamento); toda operação gera audit_log.
// ---------------------------------------------------------------------------

/**
 * Contas / caixas (ex.: Caixa Geral, PIX, Espécie) para conciliação simples.
 */
export const financeAccount = pgTable(
	'finance_account',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** 'caixa' | 'pix' | 'especie' | 'banco' */
		kind: text('kind').notNull().default('caixa'),
		active: boolean('active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('finance_account_team_idx').on(t.teamId),
		uniqueIndex('finance_account_team_name_idx').on(t.teamId, t.name)
	]
);

/**
 * Categorias configuráveis de entrada e saída (RF-08.1).
 * `isDonation = true` impede qualquer regra de valor mínimo (RN-22).
 */
export const financeCategory = pgTable(
	'finance_category',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		/** 'entrada' | 'saida' */
		kind: text('kind').notNull(),
		isDonation: boolean('is_donation').notNull().default(false),
		active: boolean('active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('finance_category_team_idx').on(t.teamId),
		uniqueIndex('finance_category_team_slug_idx').on(t.teamId, t.slug)
	]
);

/**
 * Regra de valor mínimo de contribuição por papel (RN-22 / RF-08.6 / RF-08.7).
 * Doação nunca tem valor mínimo.
 */
export const contributionRule = pgTable(
	'contribution_rule',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => financeCategory.id, { onDelete: 'cascade' }),
		/** Chave do papel (ex.: 'membro', 'conselheiro') ou null para todos. */
		roleKey: text('role_key'),
		/** Valor mínimo em centavos inteiros (> 0). */
		minAmountCents: integer('min_amount_cents').notNull(),
		/** 'mensal' | 'avulso' */
		period: text('period').notNull().default('mensal'),
		active: boolean('active').notNull().default(true),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('contribution_rule_team_idx').on(t.teamId),
		index('contribution_rule_category_idx').on(t.categoryId)
	]
);

/**
 * Livro-caixa: movimentações financeiras imutáveis (RN-20, RN-21, RN-23, RN-25).
 * Valores SEMPRE em centavos inteiros positivos (`amount_cents > 0`).
 * Correções geram estorno (`reverses_transaction_id`), nunca edição ou exclusão física.
 */
export const financeTransaction = pgTable(
	'finance_transaction',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		accountId: uuid('account_id').references(() => financeAccount.id, { onDelete: 'set null' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => financeCategory.id),
		/** 'entrada' | 'saida' */
		kind: text('kind').notNull(),
		/** Valor em centavos inteiros (> 0). Nunca float. */
		amountCents: integer('amount_cents').notNull(),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
		/** 'pix' | 'especie' | 'cartao' | 'transferencia' | 'outro' */
		paymentMethod: text('payment_method').notNull().default('pix'),
		description: text('description').notNull(),
		/** Quem lançou/é responsável pela movimentação (RN-20). */
		responsiblePersonId: uuid('responsible_person_id')
			.notNull()
			.references(() => person.id),
		/** Pessoa contribuinte/doadora (opcional; usado para `finance.view_own` RN-24). */
		personId: uuid('person_id').references(() => person.id, { onDelete: 'set null' }),
		/** Evento vinculado (opcional — RF-08.5 / F5). */
		eventId: uuid('event_id').references(() => event.id, { onDelete: 'set null' }),
		/** Grupo/PG vinculado (opcional — despesa simples de PG RN-25). */
		groupId: uuid('group_id').references(() => group.id, { onDelete: 'set null' }),
		/** Comprovante opcional (nunca obrigatório — RN-20). */
		receiptUrl: text('receipt_url'),
		/** 'confirmada' | 'pendente_aprovacao' | 'rejeitada' */
		status: text('status').notNull().default('confirmada'),
		/** Preenchido quando esta movimentação é o estorno de outra (RN-21). */
		reversesTransactionId: uuid('reverses_transaction_id'),
		approvedByPersonId: uuid('approved_by_person_id').references(() => person.id),
		approvedAt: timestamp('approved_at', { withTimezone: true }),
		rejectionReason: text('rejection_reason'),
		createdAt: createdAt()
	},
	(t) => [
		index('finance_tx_team_idx').on(t.teamId),
		index('finance_tx_occurred_idx').on(t.teamId, t.occurredAt),
		index('finance_tx_group_idx').on(t.groupId),
		index('finance_tx_event_idx').on(t.eventId),
		index('finance_tx_person_idx').on(t.personId),
		uniqueIndex('finance_tx_reverses_unique_idx')
			.on(t.reversesTransactionId)
			.where(sql`${t.reversesTransactionId} is not null`)
	]
);

export const financeAccountRelations = relations(financeAccount, ({ one, many }) => ({
	team: one(team, { fields: [financeAccount.teamId], references: [team.id] }),
	transactions: many(financeTransaction)
}));

export const financeCategoryRelations = relations(financeCategory, ({ one, many }) => ({
	team: one(team, { fields: [financeCategory.teamId], references: [team.id] }),
	transactions: many(financeTransaction),
	rules: many(contributionRule)
}));

export const contributionRuleRelations = relations(contributionRule, ({ one }) => ({
	team: one(team, { fields: [contributionRule.teamId], references: [team.id] }),
	category: one(financeCategory, {
		fields: [contributionRule.categoryId],
		references: [financeCategory.id]
	})
}));

export const financeTransactionRelations = relations(financeTransaction, ({ one }) => ({
	team: one(team, { fields: [financeTransaction.teamId], references: [team.id] }),
	account: one(financeAccount, {
		fields: [financeTransaction.accountId],
		references: [financeAccount.id]
	}),
	category: one(financeCategory, {
		fields: [financeTransaction.categoryId],
		references: [financeCategory.id]
	}),
	responsible: one(person, {
		fields: [financeTransaction.responsiblePersonId],
		references: [person.id]
	}),
	contributor: one(person, { fields: [financeTransaction.personId], references: [person.id] }),
	event: one(event, { fields: [financeTransaction.eventId], references: [event.id] }),
	group: one(group, { fields: [financeTransaction.groupId], references: [group.id] })
}));

// ---------------------------------------------------------------------------
// Módulo 10 — IA Assistiva (RN-26, RN-27, RN-29, RF-10.1 a RF-10.7)
// Padrão obrigatório: sugerir → revisar → confirmar → aplicar.
// ---------------------------------------------------------------------------

/**
 * Sugestões produzidas pela IA/motor determinístico que exigem revisão humana (RN-27).
 */
export const aiSuggestion = pgTable(
	'ai_suggestion',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		/** 'redacao_aviso' | 'resumo_ata' | 'divisao_grupos' | 'sinais_atencao' | 'resumo_financeiro' */
		kind: text('kind').notNull(),
		requestedByPersonId: uuid('requested_by_person_id')
			.notNull()
			.references(() => person.id),
		inputSnapshot: jsonb('input_snapshot').notNull(),
		output: jsonb('output').notNull(),
		/** 'pendente' | 'aceita' | 'rejeitada' | 'expirada' */
		status: text('status').notNull().default('pendente'),
		decidedByPersonId: uuid('decided_by_person_id').references(() => person.id),
		decidedAt: timestamp('decided_at', { withTimezone: true }),
		appliedChanges: jsonb('applied_changes'),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [
		index('ai_suggestion_team_idx').on(t.teamId),
		index('ai_suggestion_status_idx').on(t.teamId, t.status),
		index('ai_suggestion_requester_idx').on(t.requestedByPersonId)
	]
);

/**
 * Auditoria de interações com a IA (seção 12.4): quem perguntou, com qual
 * permissão, que escopo entrou e qual motor respondeu.
 */
export const aiInteractionLog = pgTable(
	'ai_interaction_log',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		actorPersonId: uuid('actor_person_id')
			.notNull()
			.references(() => person.id),
		kind: text('kind').notNull(),
		permissionUsed: text('permission_used').notNull(),
		provider: text('provider').notNull().default('deterministico'),
		promptSummary: text('prompt_summary').notNull(),
		tokensEstimated: integer('tokens_estimated').notNull().default(0),
		createdAt: createdAt()
	},
	(t) => [
		index('ai_interaction_log_team_idx').on(t.teamId),
		index('ai_interaction_log_actor_idx').on(t.actorPersonId)
	]
);

export const aiSuggestionRelations = relations(aiSuggestion, ({ one }) => ({
	team: one(team, { fields: [aiSuggestion.teamId], references: [team.id] }),
	requestedBy: one(person, {
		fields: [aiSuggestion.requestedByPersonId],
		references: [person.id]
	}),
	decidedBy: one(person, { fields: [aiSuggestion.decidedByPersonId], references: [person.id] })
}));

export const aiInteractionLogRelations = relations(aiInteractionLog, ({ one }) => ({
	team: one(team, { fields: [aiInteractionLog.teamId], references: [team.id] }),
	actor: one(person, { fields: [aiInteractionLog.actorPersonId], references: [person.id] })
}));

// ---------------------------------------------------------------------------
// Liderança — os 2 líderes e seus mandatos de 2 anos
// ---------------------------------------------------------------------------

/**
 * Mandato de líder. A equipe tem no máximo 2 mandatos ABERTOS (sem
 * `encerrado_em`) — garantido por gatilho no banco (migração 0007), não só na
 * aplicação. O acesso em si continua sendo o papel `lider` global em
 * `person_role`; esta tabela é o registro do mandato e o histórico de quem
 * liderou e quando.
 *
 * Mandato vencido (`fim` no passado) e não encerrado CONTINUA dando acesso:
 * decisão da liderança — a equipe não fica sem líder por esquecimento. A
 * tela avisa até alguém renovar ou substituir.
 */
export const mandatoLider = pgTable(
	'mandato_lider',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id, { onDelete: 'cascade' }),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		inicio: date('inicio').notNull(),
		fim: date('fim').notNull(),
		nomeadoPorPersonId: uuid('nomeado_por_person_id').references(() => person.id),
		encerradoEm: timestamp('encerrado_em', { withTimezone: true }),
		encerradoPorPersonId: uuid('encerrado_por_person_id').references(() => person.id),
		/** renovado | substituido | renuncia | encerrado */
		motivoEncerramento: text('motivo_encerramento'),
		createdAt: createdAt()
	},
	(t) => [
		index('mandato_lider_team_idx').on(t.teamId),
		// Uma pessoa não tem dois mandatos abertos ao mesmo tempo.
		uniqueIndex('mandato_lider_aberto_pessoa_idx')
			.on(t.teamId, t.personId)
			.where(sql`${t.encerradoEm} is null`)
	]
);
