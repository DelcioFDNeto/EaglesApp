-- ---------------------------------------------------------------------------
-- Módulo 10 — IA Assistiva (RN-26, RN-27, RN-29, RF-10.1 a RF-10.7)
-- ---------------------------------------------------------------------------

CREATE TABLE "ai_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"requested_by_person_id" uuid NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"status" text NOT NULL DEFAULT 'pendente',
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"applied_changes" jsonb,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_requester_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "person"("id");
--> statement-breakpoint
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_decided_by_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "person"("id");
--> statement-breakpoint
CREATE INDEX "ai_suggestion_team_idx" ON "ai_suggestion" ("team_id");
--> statement-breakpoint
CREATE INDEX "ai_suggestion_status_idx" ON "ai_suggestion" ("team_id", "status");
--> statement-breakpoint
CREATE INDEX "ai_suggestion_requester_idx" ON "ai_suggestion" ("requested_by_person_id");
--> statement-breakpoint
ALTER TABLE "ai_suggestion"
	ADD CONSTRAINT "ai_suggestion_kind_valido"
	CHECK ("kind" IN ('redacao_aviso', 'resumo_ata', 'divisao_grupos', 'sinais_atencao', 'resumo_financeiro'));
--> statement-breakpoint
ALTER TABLE "ai_suggestion"
	ADD CONSTRAINT "ai_suggestion_status_valido"
	CHECK ("status" IN ('pendente', 'aceita', 'rejeitada', 'expirada'));
--> statement-breakpoint
CREATE TABLE "ai_interaction_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"permission_used" text NOT NULL,
	"provider" text NOT NULL DEFAULT 'deterministico',
	"prompt_summary" text NOT NULL,
	"tokens_estimated" integer NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_interaction_log" ADD CONSTRAINT "ai_interaction_log_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "ai_interaction_log" ADD CONSTRAINT "ai_interaction_log_actor_fk" FOREIGN KEY ("actor_person_id") REFERENCES "person"("id");
--> statement-breakpoint
CREATE INDEX "ai_interaction_log_team_idx" ON "ai_interaction_log" ("team_id");
--> statement-breakpoint
CREATE INDEX "ai_interaction_log_actor_idx" ON "ai_interaction_log" ("actor_person_id");
