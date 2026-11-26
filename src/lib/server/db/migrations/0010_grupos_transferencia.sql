CREATE TABLE "group_member_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"from_group_id" uuid,
	"to_group_id" uuid,
	"reason" text,
	"origin" text DEFAULT 'manual' NOT NULL,
	"changed_by_person_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group" ADD COLUMN "archived_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "group_member_history" ADD CONSTRAINT "group_member_history_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member_history" ADD CONSTRAINT "group_member_history_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member_history" ADD CONSTRAINT "group_member_history_from_group_id_group_id_fk" FOREIGN KEY ("from_group_id") REFERENCES "public"."group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member_history" ADD CONSTRAINT "group_member_history_to_group_id_group_id_fk" FOREIGN KEY ("to_group_id") REFERENCES "public"."group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member_history" ADD CONSTRAINT "group_member_history_changed_by_person_id_person_id_fk" FOREIGN KEY ("changed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_member_history_person_idx" ON "group_member_history" USING btree ("person_id","occurred_at");--> statement-breakpoint
CREATE INDEX "group_member_history_to_idx" ON "group_member_history" USING btree ("to_group_id","occurred_at");--> statement-breakpoint
CREATE INDEX "group_member_history_from_idx" ON "group_member_history" USING btree ("from_group_id","occurred_at");--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "group_archived_by_person_id_person_id_fk" FOREIGN KEY ("archived_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Histórico de PG é append-only, como a auditoria (RN-28)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "group_member_history_somente_insercao"()
RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'group_member_history e append-only: % nao e permitido', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "group_member_history_sem_update"
	BEFORE UPDATE ON "group_member_history"
	FOR EACH ROW EXECUTE FUNCTION "group_member_history_somente_insercao"();
--> statement-breakpoint
CREATE TRIGGER "group_member_history_sem_delete"
	BEFORE DELETE ON "group_member_history"
	FOR EACH ROW EXECUTE FUNCTION "group_member_history_somente_insercao"();
--> statement-breakpoint
-- Uma linha diz que algo mudou: sair e entrar no mesmo PG não é mudança.
ALTER TABLE "group_member_history"
	ADD CONSTRAINT "group_member_history_muda_algo" CHECK (
		"from_group_id" IS DISTINCT FROM "to_group_id"
	);
--> statement-breakpoint
ALTER TABLE "group_member_history"
	ADD CONSTRAINT "group_member_history_origem_valida" CHECK (
		"origin" IN ('cadastro', 'manual', 'ia')
	);
--> statement-breakpoint

-- O histórico começa com o retrato de hoje: quem está em cada PG e desde quando.
INSERT INTO "group_member_history"
	("id", "team_id", "person_id", "from_group_id", "to_group_id", "reason", "origin", "occurred_at")
SELECT gen_random_uuid(), g."team_id", gm."person_id", NULL, gm."group_id",
	'Já estava no PG quando o histórico começou', 'cadastro', gm."joined_at"
FROM "group_member" gm
JOIN "group" g ON g."id" = gm."group_id";
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Permissão nova: editar nome e descrição do PG (decisão do usuário,
-- 26/11/2026: o conselheiro edita o próprio PG; criar e arquivar são dos
-- líderes). Entra no catálogo e nos papéis de líder e conselheiro que já
-- existem. Instalações novas recebem pela semente (roles.ts).
-- ---------------------------------------------------------------------------

INSERT INTO "permission" ("key", "description")
VALUES ('group.update', 'Editar nome e descrição do grupo')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permission" ("role_id", "permission_key")
SELECT r."id", 'group.update' FROM "role" r
WHERE r."key" IN ('lider', 'conselheiro')
	AND NOT EXISTS (
		SELECT 1 FROM "role_permission" rp
		WHERE rp."role_id" = r."id" AND rp."permission_key" = 'group.update'
	);
