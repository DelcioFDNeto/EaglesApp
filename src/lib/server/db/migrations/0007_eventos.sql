CREATE TABLE "event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"series_id" uuid,
	"occurrence_date" date,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"group_id" uuid,
	"owner_person_id" uuid,
	"status" text DEFAULT 'agendado' NOT NULL,
	"cancel_reason" text,
	"is_exception" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"public_code" text NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_audience" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid,
	"series_id" uuid,
	"kind" text NOT NULL,
	"group_id" uuid,
	"person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"group_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"owner_person_id" uuid,
	"weekday" smallint NOT NULL,
	"local_time" time NOT NULL,
	"duration_minutes" integer,
	"interval_weeks" smallint DEFAULT 1 NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"materialized_until" date NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"is_group_meeting" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_type_id_event_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."event_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_series_id_event_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."event_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_group_id_small_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."small_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audience" ADD CONSTRAINT "event_audience_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audience" ADD CONSTRAINT "event_audience_series_id_event_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."event_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audience" ADD CONSTRAINT "event_audience_group_id_small_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."small_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audience" ADD CONSTRAINT "event_audience_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_type_id_event_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."event_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_group_id_small_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."small_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type" ADD CONSTRAINT "event_type_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_public_code_idx" ON "event" USING btree ("public_code");--> statement-breakpoint
CREATE UNIQUE INDEX "event_ocorrencia_unica_idx" ON "event" USING btree ("series_id","occurrence_date") WHERE "event"."series_id" is not null;--> statement-breakpoint
CREATE INDEX "event_team_inicio_idx" ON "event" USING btree ("team_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_grupo_inicio_idx" ON "event" USING btree ("group_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_audience_evento_idx" ON "event_audience" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_audience_serie_idx" ON "event_audience" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "event_audience_grupo_idx" ON "event_audience" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "event_audience_pessoa_idx" ON "event_audience" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "event_series_team_idx" ON "event_series" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "event_series_group_idx" ON "event_series" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_type_team_key_idx" ON "event_type" USING btree ("team_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "event_type_um_encontro_de_grupo_idx" ON "event_type" USING btree ("team_id") WHERE "event_type"."is_group_meeting" and "event_type"."archived_at" is null;