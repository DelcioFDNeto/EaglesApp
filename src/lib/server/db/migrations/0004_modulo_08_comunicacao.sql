-- ---------------------------------------------------------------------------
-- Módulo 08 — Comunicação (RF-09.1 a RF-09.5, F6, RN-29, RN-33)
-- ---------------------------------------------------------------------------

CREATE TABLE "announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience_scope" text NOT NULL DEFAULT 'all',
	"group_id" uuid,
	"target_status" text,
	"event_id" uuid,
	"status" text NOT NULL DEFAULT 'draft',
	"author_person_id" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "person"("id");
--> statement-breakpoint
CREATE INDEX "announcement_team_idx" ON "announcement" ("team_id");
--> statement-breakpoint
CREATE INDEX "announcement_status_idx" ON "announcement" ("team_id", "status");
--> statement-breakpoint
CREATE INDEX "announcement_group_idx" ON "announcement" ("group_id");
--> statement-breakpoint
ALTER TABLE "announcement"
	ADD CONSTRAINT "announcement_scope_valido"
	CHECK ("audience_scope" IN ('all', 'group', 'status'));
--> statement-breakpoint
ALTER TABLE "announcement"
	ADD CONSTRAINT "announcement_status_valido"
	CHECK ("status" IN ('draft', 'published', 'archived'));
--> statement-breakpoint
CREATE TABLE "message_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL DEFAULT 'aviso',
	"content" text NOT NULL,
	"active" boolean NOT NULL DEFAULT true,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_created_by_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "person"("id");
--> statement-breakpoint
CREATE INDEX "message_template_team_idx" ON "message_template" ("team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "message_template_team_name_idx" ON "message_template" ("team_id", "name");
--> statement-breakpoint
ALTER TABLE "message_template"
	ADD CONSTRAINT "message_template_category_valida"
	CHECK ("category" IN ('evento', 'escala', 'lembrete', 'aviso'));
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"announcements_enabled" boolean NOT NULL DEFAULT true,
	"event_reminders_enabled" boolean NOT NULL DEFAULT true,
	"rsvp_reminders_enabled" boolean NOT NULL DEFAULT true,
	"responsibility_reminders_enabled" boolean NOT NULL DEFAULT true,
	"quiet_start_hour" integer NOT NULL DEFAULT 22,
	"quiet_end_hour" integer NOT NULL DEFAULT 7,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_person_idx" ON "notification_preference" ("person_id");
--> statement-breakpoint
ALTER TABLE "notification_preference"
	ADD CONSTRAINT "notification_preference_horas_validas"
	CHECK ("quiet_start_hour" BETWEEN 0 AND 23 AND "quiet_end_hour" BETWEEN 0 AND 23);
