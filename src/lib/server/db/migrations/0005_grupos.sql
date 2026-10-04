CREATE TABLE "group_membership" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"left_reason" text,
	"added_by_person_id" uuid,
	"ended_by_person_id" uuid,
	"batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "small_group" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text,
	"meeting_weekday" smallint,
	"meeting_time" time,
	"location" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_group_id_small_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."small_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_added_by_person_id_person_id_fk" FOREIGN KEY ("added_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership" ADD CONSTRAINT "group_membership_ended_by_person_id_person_id_fk" FOREIGN KEY ("ended_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "small_group" ADD CONSTRAINT "small_group_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_membership_um_grupo_ativo_idx" ON "group_membership" USING btree ("person_id") WHERE "group_membership"."left_at" is null;--> statement-breakpoint
CREATE INDEX "group_membership_grupo_idx" ON "group_membership" USING btree ("group_id","left_at");--> statement-breakpoint
CREATE INDEX "group_membership_pessoa_idx" ON "group_membership" USING btree ("person_id","joined_at");--> statement-breakpoint
CREATE INDEX "small_group_team_idx" ON "small_group" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "small_group_nome_ativo_idx" ON "small_group" USING btree ("team_id",lower("name")) WHERE "small_group"."archived_at" is null;--> statement-breakpoint
-- Antes da chave estrangeira em person_role.scope_id: até o M04, "conselheiro
-- do grupo X" apontava para um id que não existia em tabela nenhuma. Numa
-- instalação que já tenha essas atribuições, a chave estrangeira falharia.
--
-- Em vez de apagar acessos em silêncio, cada id órfão vira um grupo "a
-- nomear", que a liderança renomeia ou arquiva pela tela. Numa instalação nova
-- não há atribuição nenhuma neste ponto, e o INSERT não faz nada.
INSERT INTO "small_group" ("id", "team_id", "name")
SELECT DISTINCT ON (pr."scope_id")
	pr."scope_id",
	p."team_id",
	'Grupo a nomear (' || pr."scope_id"::text || ')'
FROM "person_role" pr
JOIN "person" p ON p."id" = pr."person_id"
WHERE pr."scope_id" IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM "small_group" g WHERE g."id" = pr."scope_id")
ORDER BY pr."scope_id";--> statement-breakpoint
ALTER TABLE "person_role" ADD CONSTRAINT "person_role_scope_id_small_group_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."small_group"("id") ON DELETE no action ON UPDATE no action;
