-- Regras do Módulo 06 que o Drizzle não expressa.

-- ---------------------------------------------------------------------------
-- 1. Domínios
-- ---------------------------------------------------------------------------

ALTER TABLE "rsvp_option"
	ADD CONSTRAINT "rsvp_option_texto_preenchido" CHECK (length(btrim("label")) > 0);
--> statement-breakpoint

-- Os indicadores leem o significado, nunca o texto (D-M06-1).
ALTER TABLE "rsvp_option"
	ADD CONSTRAINT "rsvp_option_significado_valido" CHECK ("semantic" IN ('sim', 'talvez', 'nao'));
--> statement-breakpoint

-- "Não vou, mas levo dois amigos" não existe.
ALTER TABLE "rsvp_option"
	ADD CONSTRAINT "rsvp_option_convidados_so_no_sim"
	CHECK (NOT "allows_guests" OR "semantic" = 'sim');
--> statement-breakpoint

ALTER TABLE "rsvp"
	ADD CONSTRAINT "rsvp_convidados_plausiveis" CHECK ("guests" BETWEEN 0 AND 20);
--> statement-breakpoint

ALTER TABLE "attendance"
	ADD CONSTRAINT "attendance_origem_valida" CHECK ("source" IN ('manual', 'checkin'));
--> statement-breakpoint

ALTER TABLE "event"
	ADD CONSTRAINT "event_lista_coerente"
	CHECK ("attendance_taken_by_person_id" IS NULL OR "attendance_taken_at" IS NOT NULL);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Resposta válida
--
-- Da mesma equipe do evento; uma das respostas que o tipo do evento oferece
-- (quando o tipo escolheu alguma); convidados só onde a resposta aceita; e
-- nunca para evento cancelado ou rascunho. Quem responde é a mesma pessoa e
-- o mesmo evento para sempre: mudar isso seria outra resposta.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "rsvp_valido"() RETURNS trigger AS $$
DECLARE
	ev RECORD;
	op RECORD;
BEGIN
	IF TG_OP = 'UPDATE' AND (NEW."event_id", NEW."person_id") IS DISTINCT FROM (OLD."event_id", OLD."person_id") THEN
		RAISE EXCEPTION 'Uma resposta não muda de evento nem de pessoa.'
			USING ERRCODE = 'restrict_violation';
	END IF;

	SELECT "team_id", "type_id", "status", "published_at" INTO ev
		FROM "event" WHERE "id" = NEW."event_id";
	SELECT "team_id", "allows_guests", "archived_at" INTO op
		FROM "rsvp_option" WHERE "id" = NEW."option_id";

	IF ev."status" = 'cancelado' OR ev."published_at" IS NULL THEN
		RAISE EXCEPTION 'Evento cancelado ou rascunho não recebe resposta.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF op."team_id" IS DISTINCT FROM ev."team_id" OR NOT EXISTS (
		SELECT 1 FROM "person" WHERE "id" = NEW."person_id" AND "team_id" = ev."team_id"
	) THEN
		RAISE EXCEPTION 'Resposta, pessoa e evento precisam ser da mesma equipe.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF op."archived_at" IS NOT NULL THEN
		RAISE EXCEPTION 'Essa resposta foi arquivada.' USING ERRCODE = 'check_violation';
	END IF;

	IF EXISTS (SELECT 1 FROM "event_type_rsvp_option" WHERE "type_id" = ev."type_id")
		AND NOT EXISTS (
			SELECT 1 FROM "event_type_rsvp_option"
			WHERE "type_id" = ev."type_id" AND "option_id" = NEW."option_id"
		) THEN
		RAISE EXCEPTION 'Esse tipo de evento não oferece essa resposta.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF NEW."guests" > 0 AND NOT op."allows_guests" THEN
		RAISE EXCEPTION 'Essa resposta não aceita convidados.' USING ERRCODE = 'check_violation';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "rsvp_valido"
	BEFORE INSERT OR UPDATE ON "rsvp"
	FOR EACH ROW EXECUTE FUNCTION "rsvp_valido"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Toda resposta é versionada — pelo banco (RN-12, D-M06-2)
--
-- Cada inserção ou mudança em `rsvp` grava uma linha em `rsvp_history`. Um
-- caminho novo que esqueça de registrar o histórico não consegue esquecer.
--
-- O id do histórico é v4 (`gen_random_uuid`), não v7 como o resto: o
-- Postgres só gera v7 a partir da versão 18 (ver db/id.ts). A ordem do
-- histórico vem de `responded_at`, não do id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "rsvp_versiona"() RETURNS trigger AS $$
BEGIN
	INSERT INTO "rsvp_history"
		("id", "event_id", "person_id", "option_id", "guests", "responded_by_person_id", "responded_at")
	VALUES
		(gen_random_uuid(), NEW."event_id", NEW."person_id", NEW."option_id", NEW."guests",
		 NEW."responded_by_person_id", NEW."responded_at");
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "rsvp_versiona"
	AFTER INSERT OR UPDATE ON "rsvp"
	FOR EACH ROW EXECUTE FUNCTION "rsvp_versiona"();
--> statement-breakpoint

CREATE TRIGGER "rsvp_history_sem_update"
	BEFORE UPDATE ON "rsvp_history"
	FOR EACH ROW EXECUTE FUNCTION "recusa_alteracao"();
--> statement-breakpoint

CREATE TRIGGER "rsvp_history_sem_delete"
	BEFORE DELETE ON "rsvp_history"
	FOR EACH ROW EXECUTE FUNCTION "recusa_alteracao"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Presença: evento de verdade, da mesma equipe, e não se reescreve
--
-- Corrigir uma marcação é apagar a linha (com auditoria no serviço); mudar o
-- evento ou a pessoa de uma presença seria inventar outra.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "presenca_valida"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'Presença não se altera: desmarque e marque de novo.'
			USING ERRCODE = 'restrict_violation';
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM "event" e JOIN "person" p ON p."team_id" = e."team_id"
		WHERE e."id" = NEW."event_id" AND p."id" = NEW."person_id"
	) THEN
		RAISE EXCEPTION 'Pessoa e evento precisam ser da mesma equipe.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF EXISTS (SELECT 1 FROM "event" WHERE "id" = NEW."event_id" AND "status" = 'cancelado') THEN
		RAISE EXCEPTION 'Evento cancelado não tem presença.' USING ERRCODE = 'check_violation';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "attendance_valida"
	BEFORE INSERT OR UPDATE ON "attendance"
	FOR EACH ROW EXECUTE FUNCTION "presenca_valida"();
