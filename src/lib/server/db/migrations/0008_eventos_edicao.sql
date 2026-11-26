ALTER TABLE "event" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "cancelled_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "event_type" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_cancelled_by_person_id_person_id_fk" FOREIGN KEY ("cancelled_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Regras de status do evento que só o banco garante de verdade
-- ---------------------------------------------------------------------------

-- Nenhum caminho de código anterior a esta migração cancelava eventos, então
-- não há linha 'cancelled' sem data. Por segurança, completa as que houver.
UPDATE "event" SET "cancelled_at" = "updated_at" WHERE "status" = 'cancelled' AND "cancelled_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "event"
	ADD CONSTRAINT "event_status_valido" CHECK (
		"status" IN ('scheduled', 'ongoing', 'completed', 'cancelled')
	);
--> statement-breakpoint
-- Cancelado se e somente se há data de cancelamento: reativar sem limpar, ou
-- cancelar sem registrar quando, deixaria o histórico mentindo.
ALTER TABLE "event"
	ADD CONSTRAINT "event_cancelamento_coerente" CHECK (
		("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)
	);
