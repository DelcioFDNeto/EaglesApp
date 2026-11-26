CREATE TABLE "mandato_lider" (
	"id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"nomeado_por_person_id" uuid,
	"encerrado_em" timestamp with time zone,
	"encerrado_por_person_id" uuid,
	"motivo_encerramento" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mandato_lider" ADD CONSTRAINT "mandato_lider_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandato_lider" ADD CONSTRAINT "mandato_lider_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandato_lider" ADD CONSTRAINT "mandato_lider_nomeado_por_person_id_person_id_fk" FOREIGN KEY ("nomeado_por_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandato_lider" ADD CONSTRAINT "mandato_lider_encerrado_por_person_id_person_id_fk" FOREIGN KEY ("encerrado_por_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mandato_lider_team_idx" ON "mandato_lider" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mandato_lider_aberto_pessoa_idx" ON "mandato_lider" USING btree ("team_id","person_id") WHERE "mandato_lider"."encerrado_em" is null;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Regras do mandato que só o banco garante de verdade
-- ---------------------------------------------------------------------------

ALTER TABLE "mandato_lider"
	ADD CONSTRAINT "mandato_lider_periodo_valido" CHECK ("fim" > "inicio");
--> statement-breakpoint
ALTER TABLE "mandato_lider"
	ADD CONSTRAINT "mandato_lider_motivo_valido" CHECK (
		"motivo_encerramento" IS NULL
		OR "motivo_encerramento" IN ('renovado', 'substituido', 'renuncia', 'encerrado')
	);
--> statement-breakpoint
ALTER TABLE "mandato_lider"
	ADD CONSTRAINT "mandato_lider_encerramento_coerente" CHECK (
		("encerrado_em" IS NULL AND "motivo_encerramento" IS NULL)
		OR ("encerrado_em" IS NOT NULL AND "motivo_encerramento" IS NOT NULL)
	);
--> statement-breakpoint

-- No máximo 2 líderes com mandato aberto por equipe. O lock por equipe
-- serializa nomeações simultâneas: sem ele, duas transações contariam 1
-- mandato aberto cada uma e as duas passariam, deixando 3 líderes.
CREATE OR REPLACE FUNCTION "mandato_lider_no_maximo_dois"() RETURNS trigger AS $$
DECLARE
	abertos integer;
BEGIN
	IF NEW."encerrado_em" IS NOT NULL THEN
		RETURN NEW;
	END IF;

	PERFORM pg_advisory_xact_lock(hashtext('mandato_lider:' || NEW."team_id"::text));

	SELECT count(*) INTO abertos
	FROM "mandato_lider"
	WHERE "team_id" = NEW."team_id"
		AND "encerrado_em" IS NULL
		AND "id" <> NEW."id";

	IF abertos >= 2 THEN
		RAISE EXCEPTION 'A equipe já tem 2 líderes com mandato aberto.'
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "mandato_lider_no_maximo_dois"
	BEFORE INSERT OR UPDATE OF "encerrado_em", "team_id" ON "mandato_lider"
	FOR EACH ROW EXECUTE FUNCTION "mandato_lider_no_maximo_dois"();
--> statement-breakpoint

-- Líderes que já existem viram mandatos (até 2 por equipe, os mais antigos),
-- começando na data em que receberam o papel.
INSERT INTO "mandato_lider" ("id", "team_id", "person_id", "inicio", "fim", "nomeado_por_person_id")
SELECT gen_random_uuid(), x."team_id", x."person_id", x."inicio", (x."inicio" + interval '2 years')::date, x."granted_by"
FROM (
	SELECT
		r."team_id",
		pr."person_id",
		pr."created_at"::date AS "inicio",
		pr."granted_by_person_id" AS "granted_by",
		row_number() OVER (PARTITION BY r."team_id" ORDER BY pr."created_at") AS "ordem"
	FROM "person_role" pr
	JOIN "role" r ON r."id" = pr."role_id"
	WHERE r."key" = 'lider' AND pr."scope_type" = 'global'
		AND (pr."expires_at" IS NULL OR pr."expires_at" > now())
) x
WHERE x."ordem" <= 2;
