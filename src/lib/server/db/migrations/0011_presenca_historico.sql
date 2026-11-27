CREATE TABLE "rsvp_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"option" text NOT NULL,
	"guests" integer DEFAULT 0 NOT NULL,
	"answered_by_person_id" uuid,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rsvp_history" ADD CONSTRAINT "rsvp_history_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_history" ADD CONSTRAINT "rsvp_history_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvp_history" ADD CONSTRAINT "rsvp_history_answered_by_person_id_person_id_fk" FOREIGN KEY ("answered_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rsvp_history_event_person_idx" ON "rsvp_history" USING btree ("event_id","person_id","answered_at");--> statement-breakpoint

-- Histórico de respostas é append-only, como a auditoria (RN-12, RN-28).
CREATE OR REPLACE FUNCTION "rsvp_history_somente_insercao"()
RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'rsvp_history e append-only: % nao e permitido', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "rsvp_history_sem_update"
	BEFORE UPDATE ON "rsvp_history"
	FOR EACH ROW EXECUTE FUNCTION "rsvp_history_somente_insercao"();
--> statement-breakpoint
-- DELETE direto é recusado; a exclusão em cascata (de um evento ou de uma
-- pessoa, ex.: pedido de exclusão pela LGPD) continua possível: nela o gatilho
-- roda dentro do gatilho de chave estrangeira (pg_trigger_depth() > 1).
CREATE OR REPLACE FUNCTION "historico_sem_delete_direto"()
RETURNS trigger AS $$
BEGIN
	IF pg_trigger_depth() <= 1 THEN
		RAISE EXCEPTION '% e append-only: DELETE direto nao e permitido', TG_TABLE_NAME
			USING ERRCODE = 'insufficient_privilege';
	END IF;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "rsvp_history_sem_delete"
	BEFORE DELETE ON "rsvp_history"
	FOR EACH ROW EXECUTE FUNCTION "historico_sem_delete_direto"();
--> statement-breakpoint
-- O histórico de PG (0010) bloqueava até a cascata, o que impediria apagar uma
-- pessoa. Passa a seguir a mesma regra.
DROP TRIGGER "group_member_history_sem_delete" ON "group_member_history";
--> statement-breakpoint
CREATE TRIGGER "group_member_history_sem_delete"
	BEFORE DELETE ON "group_member_history"
	FOR EACH ROW EXECUTE FUNCTION "historico_sem_delete_direto"();
--> statement-breakpoint

-- O histórico começa com a resposta atual de cada um (a anterior se perdeu:
-- até aqui, trocar a resposta sobrescrevia).
INSERT INTO "rsvp_history" ("id", "event_id", "person_id", "option", "guests", "answered_by_person_id", "answered_at")
SELECT gen_random_uuid(), er."event_id", er."person_id", er."option", er."guests", er."person_id", er."updated_at"
FROM "event_registration" er;
