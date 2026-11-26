-- ---------------------------------------------------------------------------
-- Módulo 07 — Responsabilidades e Escalas (RN-16 a RN-19, RF-07.1 a RF-07.6)
-- ---------------------------------------------------------------------------

CREATE TABLE "responsabilidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"intervalo_minimo_dias" integer NOT NULL DEFAULT 14,
	"ativo" boolean NOT NULL DEFAULT true,
	"ordem" integer NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "responsabilidade" ADD CONSTRAINT "responsabilidade_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "responsabilidade_team_idx" ON "responsabilidade" ("team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "responsabilidade_team_nome_idx" ON "responsabilidade" ("team_id", "nome");
--> statement-breakpoint
ALTER TABLE "responsabilidade"
	ADD CONSTRAINT "responsabilidade_intervalo_nao_negativo"
	CHECK ("intervalo_minimo_dias" >= 0);
--> statement-breakpoint
CREATE TABLE "escala" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"responsabilidade_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text NOT NULL DEFAULT 'confirmada',
	"origem" text NOT NULL DEFAULT 'manual',
	"proposta_id" uuid,
	"substituido_por_person_id" uuid,
	"confirmado_por_person_id" uuid,
	"confirmado_em" timestamp with time zone,
	"ordem" integer NOT NULL DEFAULT 0,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escala" ADD CONSTRAINT "escala_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "escala" ADD CONSTRAINT "escala_responsabilidade_id_fk" FOREIGN KEY ("responsabilidade_id") REFERENCES "responsabilidade"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "escala" ADD CONSTRAINT "escala_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "escala" ADD CONSTRAINT "escala_substituido_por_person_id_fk" FOREIGN KEY ("substituido_por_person_id") REFERENCES "person"("id");
--> statement-breakpoint
ALTER TABLE "escala" ADD CONSTRAINT "escala_confirmado_por_person_id_fk" FOREIGN KEY ("confirmado_por_person_id") REFERENCES "person"("id");
--> statement-breakpoint
CREATE INDEX "escala_event_idx" ON "escala" ("event_id");
--> statement-breakpoint
CREATE INDEX "escala_person_idx" ON "escala" ("person_id");
--> statement-breakpoint
CREATE INDEX "escala_proposta_idx" ON "escala" ("proposta_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "escala_event_responsabilidade_person_ativa_idx"
	ON "escala" ("event_id", "responsabilidade_id", "person_id")
	WHERE "status" <> 'trocada';
--> statement-breakpoint
ALTER TABLE "escala"
	ADD CONSTRAINT "escala_status_valido"
	CHECK ("status" IN ('proposta', 'confirmada', 'trocada', 'cumprida'));
--> statement-breakpoint
ALTER TABLE "escala"
	ADD CONSTRAINT "escala_origem_valida"
	CHECK ("origem" IN ('manual', 'gerada'));
--> statement-breakpoint
CREATE TABLE "escala_historico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"escala_id" uuid NOT NULL,
	"acao" text NOT NULL,
	"pessoa_alvo_id" uuid,
	"alterado_por_person_id" uuid,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escala_historico" ADD CONSTRAINT "escala_historico_escala_id_fk" FOREIGN KEY ("escala_id") REFERENCES "escala"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "escala_historico" ADD CONSTRAINT "escala_historico_pessoa_alvo_id_fk" FOREIGN KEY ("pessoa_alvo_id") REFERENCES "person"("id");
--> statement-breakpoint
ALTER TABLE "escala_historico" ADD CONSTRAINT "escala_historico_alterado_por_person_id_fk" FOREIGN KEY ("alterado_por_person_id") REFERENCES "person"("id");
--> statement-breakpoint
CREATE INDEX "escala_historico_escala_idx" ON "escala_historico" ("escala_id");
--> statement-breakpoint
CREATE INDEX "escala_historico_pessoa_alvo_idx" ON "escala_historico" ("pessoa_alvo_id");
--> statement-breakpoint
CREATE INDEX "escala_historico_alterado_por_idx" ON "escala_historico" ("alterado_por_person_id");
