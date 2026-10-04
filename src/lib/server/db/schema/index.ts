/**
 * Schema do Eagles App — Módulos 01 (Fundação), 02 (Pessoas), 03 (RBAC) e
 * 04 (Grupos).
 *
 * Só entram aqui as tabelas que os módulos entregues usam de fato. Grupos,
 * eventos, presença, responsabilidades e financeiro chegam nos seus próprios
 * módulos: tabela vazia que ninguém usa é dívida, não adiantamento.
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
	pgView,
	smallint,
	text,
	time,
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
		 * Nome sem acento e em minúsculas, para busca. Coluna GERADA: derivar no
		 * banco garante que nunca fique dessincronizada do nome.
		 *
		 * `lower()` e `translate()` são imutáveis, então aqui a coluna gerada
		 * funciona — diferente de `is_minor`, que depende da data de hoje e por
		 * isso vive numa view (ADR 0003).
		 *
		 * Evita depender da extensão `unaccent`, que exigiria privilégio de
		 * superusuário na VPS e não existe no PGlite dos testes.
		 */
		fullNameNormalized: text('full_name_normalized').generatedAlwaysAs(
			sql`translate(lower("full_name"),
				'áàâãäéèêëíìîïóòôõöúùûüçñ',
				'aaaaaeeeeiiiiooooouuuucn')`
		),

		/**
		 * Contato. Todos opcionais — o cadastro é progressivo, e exigir telefone
		 * de quem apareceu uma vez no PG é o tipo de atrito que o briefing pede
		 * para evitar.
		 *
		 * Para menor de idade sem consentimento, estes campos ficam vazios por
		 * imposição do serviço, não por escolha de quem cadastra (RN-30).
		 */
		phone: text('phone'),
		whatsapp: text('whatsapp'),
		email: text('email'),

		/** 'solteiro' | 'namorando' | 'noivo' | 'casado' — validado na aplicação. */
		relationshipStatus: text('relationship_status'),

		/** Quando passou a fazer parte. Não é a data do cadastro. */
		joinedAt: date('joined_at'),

		/** Estágio atual da jornada. Nulo só entre o INSERT e o primeiro status. */
		currentStatusId: uuid('current_status_id').references(() => membershipStatus.id),

		/**
		 * Como a pessoa chegou ao sistema: 'cadastro' (alguém digitou),
		 * 'autocadastro' (ela mesma preencheu) ou 'importacao' (planilha, M02b).
		 * Serve para a liderança saber o quanto confiar no que está preenchido.
		 */
		source: text('source').notNull().default('cadastro'),

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
	(t) => [
		index('person_team_idx').on(t.teamId),
		index('person_name_idx').on(t.teamId, t.fullName),
		index('person_status_idx').on(t.currentStatusId)
	]
);

/**
 * View com idade e menoridade DERIVADAS (ADR 0003, migração 0003).
 *
 * `.existing()` declara que a view é criada pela migração, não pelo Drizzle —
 * o Drizzle só precisa saber o formato para poder consultá-la com tipos.
 *
 * Existe declarada aqui por um motivo concreto: a versão anterior consultava a
 * view com `db.execute()` e SQL cru, e o formato do retorno DIVERGE entre os
 * drivers — o PGlite dos testes devolve `{ rows }`, o postgres.js da produção
 * devolve o array direto. O teste de integração passava e a aplicação quebrava
 * com 500. Pelo construtor de consultas, os dois se comportam igual.
 *
 * `isMinor` é NULL quando a data de nascimento é desconhecida. Quem consome
 * trata NULL como "aplique o regime restrito", nunca como "é maior".
 */
export const personView = pgView('person_view', {
	id: uuid('id').notNull(),
	ageYears: integer('age_years'),
	isMinor: boolean('is_minor')
}).existing();

// ---------------------------------------------------------------------------
// Jornada — estágios configuráveis, não enum de código (RN-02)
// ---------------------------------------------------------------------------

/**
 * Os estágios pelos quais uma pessoa passa: visitante → participante
 * recorrente → membro. A semeadura cria esses três; a liderança pode criar
 * outros sem que ninguém toque no código.
 *
 * Nenhuma regra do sistema compara `key` com um literal. Onde o comportamento
 * depende do estágio, ele lê uma PROPRIEDADE da linha — é o que permite um
 * estágio novo funcionar sem deploy.
 */
export const membershipStatus = pgTable(
	'membership_status',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id),

		key: text('key').notNull(),
		name: text('name').notNull(),
		description: text('description'),

		/** Ordem na jornada. Usada para exibir, nunca para inferir promoção. */
		position: integer('position').notNull().default(0),

		/** Cor da etiqueta na interface. */
		color: text('color'),

		/** Estágio final (ex.: "saiu"). Não aparece como destino sugerido. */
		isTerminal: boolean('is_terminal').notNull().default(false),

		/** Estágio de quem acabou de chegar. Exatamente um por equipe. */
		isDefault: boolean('is_default').notNull().default(false),

		/**
		 * Papel concedido ao entrar neste estágio. Nulo = nenhum.
		 * A concessão é sempre explícita e auditada — nunca silenciosa.
		 */
		grantsRoleId: uuid('grants_role_id').references(() => role.id),

		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('membership_status_team_key_idx').on(t.teamId, t.key),
		index('membership_status_position_idx').on(t.teamId, t.position)
	]
);

/**
 * Histórico de mudança de status (RN-04).
 *
 * Append-only garantido por gatilho no banco, como a auditoria: é a linha do
 * tempo da pessoa nos Eagles, e reescrever passado apaga exatamente a
 * informação que dá sentido ao acompanhamento.
 */
export const personStatusHistory = pgTable(
	'person_status_history',
	{
		id: pk(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),

		/** Nulo na primeira atribuição — não havia estágio anterior. */
		fromStatusId: uuid('from_status_id').references(() => membershipStatus.id),
		toStatusId: uuid('to_status_id')
			.notNull()
			.references(() => membershipStatus.id),

		changedByPersonId: uuid('changed_by_person_id').references(() => person.id),
		reason: text('reason'),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('person_status_history_person_idx').on(t.personId, t.occurredAt)]
);

// ---------------------------------------------------------------------------
// Vínculos entre pessoas
// ---------------------------------------------------------------------------

/**
 * Irmão, cônjuge, namorado e responsável legal.
 *
 * Os três primeiros são simétricos e guardam UMA linha, com `person_a` sempre
 * menor que `person_b` (CHECK na migração 0002). Duas linhas para o mesmo fato
 * divergem em silêncio quando alguém apaga só uma.
 *
 * `responsavel_legal` é dirigido: `person_a` é o responsável, `person_b` é o
 * menor. Só esse tipo escapa da ordenação canônica.
 */
export const personRelation = pgTable(
	'person_relation',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id),

		personA: uuid('person_a')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		personB: uuid('person_b')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),

		/** 'irmao' | 'conjuge' | 'namorado' | 'responsavel_legal' */
		relationType: text('relation_type').notNull(),

		createdByPersonId: uuid('created_by_person_id').references(() => person.id),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('person_relation_par_idx').on(t.personA, t.personB, t.relationType),
		index('person_relation_a_idx').on(t.personA),
		index('person_relation_b_idx').on(t.personB)
	]
);

// ---------------------------------------------------------------------------
// Consentimento (ADR 0003) — log de eventos, append-only
// ---------------------------------------------------------------------------

/**
 * Uma linha por EVENTO de consentimento, não por consentimento.
 *
 * Conceder grava uma linha com `granted = true`; revogar grava outra com
 * `false`. O estado atual é a linha mais recente de cada (pessoa, tipo). Nada
 * é atualizado nem apagado — o banco recusa, por gatilho.
 *
 * É a leitura fiel do que o ADR 0003 determina ("revogar cria linha nova; nada
 * é apagado do histórico"). Uma coluna `revoked_at` atualizável diria o
 * contrário do que a tabela promete.
 */
export const consent = pgTable(
	'consent',
	{
		id: pk(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),

		/** 'dados_cadastrais' | 'foto' | 'compartilhamento_externo' | 'uso_ia' */
		kind: text('kind').notNull(),

		/** true = concedido, false = revogado. */
		granted: boolean('granted').notNull(),

		/** Quem consentiu: o responsável legal, quando a pessoa é menor. */
		grantedByPersonId: uuid('granted_by_person_id').references(() => person.id),

		/** Quem registrou no sistema — normalmente o conselheiro. */
		recordedByPersonId: uuid('recorded_by_person_id').references(() => person.id),

		/** Como foi coletado: "termo em papel assinado, foto no arquivo X". */
		evidence: text('evidence'),

		at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('consent_person_kind_idx').on(t.personId, t.kind, t.at)]
);

// ---------------------------------------------------------------------------
// Grupos / PGs (M04)
// ---------------------------------------------------------------------------

/**
 * O PG. Chama-se `small_group` porque `group` é palavra reservada do SQL e
 * exigiria aspas em toda consulta escrita à mão.
 *
 * Não existe coluna de conselheiro (D-M04-1): quem cuida do grupo é quem tem
 * um papel de escopo `group` apontando para ele em `person_role`. Uma coluna
 * a mais seria uma segunda resposta para a mesma pergunta.
 *
 * Grupo não se apaga: arquiva-se, e só vazio (gatilho na migração 0006).
 * Presença e histórico de quem esteve nele continuam apontando para a linha.
 */
export const smallGroup = pgTable(
	'small_group',
	{
		id: pk(),
		teamId: uuid('team_id')
			.notNull()
			.references(() => team.id),

		name: text('name').notNull(),
		/** Cor da etiqueta na interface, em hexadecimal (#RRGGBB). */
		color: text('color'),
		description: text('description'),

		/**
		 * O combinado do grupo: dia da semana (0 = domingo … 6 = sábado), horário
		 * e local. É o ponto de partida do evento recorrente do M05, não uma
		 * segunda fonte para ele.
		 */
		meetingWeekday: smallint('meeting_weekday'),
		meetingTime: time('meeting_time'),
		location: text('location'),

		archivedAt: timestamp('archived_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('small_group_team_idx').on(t.teamId),
		// Dois "PG Azul" ativos seriam ambíguos em toda tela que lista grupos.
		// Arquivado não conta: o nome volta a ficar livre.
		uniqueIndex('small_group_nome_ativo_idx')
			.on(t.teamId, sql`lower(${t.name})`)
			.where(sql`${t.archivedAt} is null`)
	]
);

/**
 * Vínculo TEMPORAL de uma pessoa com um grupo (RN-06, RN-07).
 *
 * Uma linha por passagem pelo grupo. Transferir é encerrar a linha aberta e
 * abrir outra, no mesmo instante e na mesma transação — nada é sobrescrito,
 * e o gatilho da migração 0006 recusa qualquer alteração que não seja
 * encerrar um vínculo aberto.
 *
 * "No máximo um grupo por vez" é o índice único parcial abaixo: garantia do
 * banco, não da aplicação.
 */
export const groupMembership = pgTable(
	'group_membership',
	{
		id: pk(),
		groupId: uuid('group_id')
			.notNull()
			.references(() => smallGroup.id),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),

		joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
		/** Nulo enquanto a pessoa está no grupo. */
		leftAt: timestamp('left_at', { withTimezone: true }),
		leftReason: text('left_reason'),

		addedByPersonId: uuid('added_by_person_id').references(() => person.id),
		endedByPersonId: uuid('ended_by_person_id').references(() => person.id),

		/** Reorganização em lote que criou ou encerrou este vínculo (D-M04-5). */
		batchId: uuid('batch_id'),

		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('group_membership_um_grupo_ativo_idx')
			.on(t.personId)
			.where(sql`${t.leftAt} is null`),
		index('group_membership_grupo_idx').on(t.groupId, t.leftAt),
		index('group_membership_pessoa_idx').on(t.personId, t.joinedAt)
	]
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

		/**
		 * Escopo com que este papel é atribuído: 'global' | 'group' | 'self'.
		 *
		 * Quem atribui escolhe o PAPEL, não o escopo (D-M03-1). Deixar o escopo
		 * livre na tela convidaria o erro silencioso de dar "Conselheiro" com
		 * escopo global — um superconselheiro que ninguém pretendeu criar.
		 */
		defaultScope: text('default_scope').notNull().default('self'),
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
		/**
		 * Id do grupo quando scopeType = 'group'. Nulo nos demais.
		 *
		 * Chave estrangeira desde o M04: antes, "conselheiro do PG Azul" podia
		 * apontar para um grupo que não existia em tabela nenhuma.
		 */
		scopeId: uuid('scope_id').references(() => smallGroup.id),

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

export const membershipStatusRelations = relations(membershipStatus, ({ many }) => ({
	pessoas: many(person),
	historico: many(personStatusHistory)
}));

export const personStatusHistoryRelations = relations(personStatusHistory, ({ one }) => ({
	pessoa: one(person, {
		fields: [personStatusHistory.personId],
		references: [person.id]
	}),
	de: one(membershipStatus, {
		fields: [personStatusHistory.fromStatusId],
		references: [membershipStatus.id],
		relationName: 'statusAnterior'
	}),
	para: one(membershipStatus, {
		fields: [personStatusHistory.toStatusId],
		references: [membershipStatus.id],
		relationName: 'statusNovo'
	})
}));

export const consentRelations = relations(consent, ({ one }) => ({
	pessoa: one(person, {
		fields: [consent.personId],
		references: [person.id]
	})
}));

export const personRelations = relations(person, ({ one, many }) => ({
	team: one(team, { fields: [person.teamId], references: [team.id] }),
	account: one(userAccount, { fields: [person.id], references: [userAccount.personId] }),
	roles: many(personRole),
	status: one(membershipStatus, {
		fields: [person.currentStatusId],
		references: [membershipStatus.id]
	}),
	historicoDeStatus: many(personStatusHistory),
	consentimentos: many(consent),
	vinculosDeGrupo: many(groupMembership)
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
	role: one(role, { fields: [personRole.roleId], references: [role.id] }),
	grupo: one(smallGroup, { fields: [personRole.scopeId], references: [smallGroup.id] })
}));

export const smallGroupRelations = relations(smallGroup, ({ many }) => ({
	vinculos: many(groupMembership),
	responsaveis: many(personRole)
}));

export const groupMembershipRelations = relations(groupMembership, ({ one }) => ({
	grupo: one(smallGroup, { fields: [groupMembership.groupId], references: [smallGroup.id] }),
	pessoa: one(person, { fields: [groupMembership.personId], references: [person.id] })
}));
