-- ---------------------------------------------------------------------------
-- Complemento M01-B (redefinição de senha e solicitação de cadastro)
-- ---------------------------------------------------------------------------

CREATE TABLE "senha_reset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"token" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "senha_reset" ADD CONSTRAINT "senha_reset_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "senha_reset_person_idx" ON "senha_reset" ("person_id");
--> statement-breakpoint
CREATE TABLE "cadastro_pendente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"telefone" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cadastro_pendente_email_idx" ON "cadastro_pendente" ("email");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Módulo 02 — Pessoas: perfil estendido e histórico de status
-- ---------------------------------------------------------------------------

CREATE TABLE "person_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"phone" text,
	"whatsapp" text,
	"email" text,
	"birth_date" date,
	"photo_url" text,
	"relationship_status" text,
	"siblings" text,
	"family_ties" text,
	"group_id" uuid,
	"role_key" text,
	"status" text NOT NULL DEFAULT 'visitante',
	"joined_at" timestamp with time zone,
	"frequency" integer NOT NULL DEFAULT 0,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_profile" ADD CONSTRAINT "person_profile_person_id_unique" UNIQUE ("person_id");
--> statement-breakpoint
ALTER TABLE "person_profile" ADD CONSTRAINT "person_profile_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "person_profile_person_idx" ON "person_profile" ("person_id");
--> statement-breakpoint
CREATE INDEX "person_profile_status_idx" ON "person_profile" ("status");
--> statement-breakpoint
CREATE INDEX "person_profile_group_idx" ON "person_profile" ("group_id");
--> statement-breakpoint
CREATE TABLE "person_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"changed_by_person_id" uuid,
	"event_id" uuid,
	"group_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_status_history" ADD CONSTRAINT "person_status_history_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "person_status_history" ADD CONSTRAINT "person_status_history_changed_by_person_id_fk" FOREIGN KEY ("changed_by_person_id") REFERENCES "person"("id");
--> statement-breakpoint
CREATE INDEX "person_status_history_person_idx" ON "person_status_history" ("person_id");
--> statement-breakpoint
CREATE INDEX "person_status_history_occurred_idx" ON "person_status_history" ("occurred_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Módulo 04 — Grupos/PGs
-- ---------------------------------------------------------------------------

CREATE TABLE "group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "group_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "group_created_by_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "person"("id");
--> statement-breakpoint
CREATE INDEX "group_team_idx" ON "group" ("team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "group_team_slug_idx" ON "group" ("team_id", "slug");
--> statement-breakpoint
CREATE TABLE "group_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role_key" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_person_id_unique" UNIQUE ("person_id");
--> statement-breakpoint
CREATE INDEX "group_member_group_idx" ON "group_member" ("group_id");
--> statement-breakpoint
CREATE INDEX "group_member_person_idx" ON "group_member" ("person_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Módulo 05 — Eventos
-- ---------------------------------------------------------------------------

CREATE TABLE "event_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#A91825',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_type" ADD CONSTRAINT "event_type_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "event_type_team_idx" ON "event_type" ("team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "event_type_team_slug_idx" ON "event_type" ("team_id", "slug");
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"location" text,
	"responsible_person_id" uuid,
	"group_id" uuid,
	"status" text NOT NULL DEFAULT 'scheduled',
	"rsvp_enabled" boolean NOT NULL DEFAULT true,
	"rsvp_options" jsonb NOT NULL DEFAULT '[
		{"key": "confirmado", "label": "Confirmado"},
		{"key": "talvez", "label": "Talvez"},
		{"key": "nao_vou", "label": "Não vou"},
		{"key": "atrasado", "label": "Chegarei atrasado"},
		{"key": "convidado", "label": "Vou levar convidado"}
	]',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "event_type"("id");
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_responsible_person_id_fk" FOREIGN KEY ("responsible_person_id") REFERENCES "person"("id");
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "group"("id");
--> statement-breakpoint
CREATE INDEX "event_team_idx" ON "event" ("team_id");
--> statement-breakpoint
CREATE INDEX "event_event_type_idx" ON "event" ("event_type_id");
--> statement-breakpoint
CREATE INDEX "event_starts_at_idx" ON "event" ("starts_at");
--> statement-breakpoint
CREATE INDEX "event_group_idx" ON "event" ("group_id");
--> statement-breakpoint
-- FKs cruzadas criadas após "group" e "event" existirem
ALTER TABLE "person_status_history" ADD CONSTRAINT "person_status_history_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "event"("id");
--> statement-breakpoint
ALTER TABLE "person_status_history" ADD CONSTRAINT "person_status_history_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "group"("id");
--> statement-breakpoint
CREATE TABLE "event_registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"option" text NOT NULL,
	"guests" integer NOT NULL DEFAULT 0,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_person_event_unique" UNIQUE ("person_id", "event_id");
--> statement-breakpoint
CREATE INDEX "event_registration_event_idx" ON "event_registration" ("event_id");
--> statement-breakpoint
CREATE INDEX "event_registration_person_idx" ON "event_registration" ("person_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Módulo 06 — Presença e Check-in
-- ---------------------------------------------------------------------------

CREATE TABLE "presence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text NOT NULL DEFAULT 'present',
	"registration_method" text NOT NULL DEFAULT 'manual',
	"registered_by_person_id" uuid,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_registered_by_person_id_fk" FOREIGN KEY ("registered_by_person_id") REFERENCES "person"("id");
--> statement-breakpoint
ALTER TABLE "presence" ADD CONSTRAINT "presence_person_event_unique" UNIQUE ("person_id", "event_id");
--> statement-breakpoint
CREATE INDEX "presence_event_idx" ON "presence" ("event_id");
--> statement-breakpoint
CREATE INDEX "presence_person_idx" ON "presence" ("person_id");
--> statement-breakpoint
CREATE TABLE "event_checkin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"qr_code" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"is_active" boolean NOT NULL DEFAULT true,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_checkin" ADD CONSTRAINT "event_checkin_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "event_checkin" ADD CONSTRAINT "event_checkin_created_by_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "person"("id");
--> statement-breakpoint
CREATE INDEX "event_checkin_event_idx" ON "event_checkin" ("event_id");
--> statement-breakpoint
CREATE INDEX "event_checkin_qr_idx" ON "event_checkin" ("qr_code");
--> statement-breakpoint
CREATE TABLE "checkin_scan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkin_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "checkin_scan" ADD CONSTRAINT "checkin_scan_checkin_id_fk" FOREIGN KEY ("checkin_id") REFERENCES "event_checkin"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "checkin_scan" ADD CONSTRAINT "checkin_scan_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "checkin_scan_checkin_idx" ON "checkin_scan" ("checkin_id");
--> statement-breakpoint
CREATE INDEX "checkin_scan_person_idx" ON "checkin_scan" ("person_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Regras de domínio (segurança de banco)
-- ---------------------------------------------------------------------------

ALTER TABLE "presence"
	ADD CONSTRAINT "presence_status_valido"
	CHECK ("status" IN ('present', 'absent', 'late'));
--> statement-breakpoint
ALTER TABLE "event_checkin"
	ADD CONSTRAINT "event_checkin_expiracao_futura"
	CHECK ("expires_at" > "created_at");
--> statement-breakpoint
ALTER TABLE "event"
	ADD CONSTRAINT "event_horario_valido"
	CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "event_registration"
	ADD CONSTRAINT "event_registration_guests_nao_negativo"
	CHECK ("guests" >= 0);
--> statement-breakpoint
ALTER TABLE "person_profile"
	ADD CONSTRAINT "person_profile_status_valido"
	CHECK ("status" IN ('visitante', 'recorrente', 'membro', 'conselheiro', 'lider'));
