-- Regras do Módulo 05 que o Drizzle não expressa.
--
-- Mesma postura das migrações de regras anteriores: o que precisa ser verdade
-- sempre vira restrição de banco.

-- ---------------------------------------------------------------------------
-- 1. Domínios
-- ---------------------------------------------------------------------------

ALTER TABLE "event_type"
	ADD CONSTRAINT "event_type_nome_preenchido" CHECK (length(btrim("name")) > 0);
--> statement-breakpoint

ALTER TABLE "event_type"
	ADD CONSTRAINT "event_type_cor_valida"
	CHECK ("color" IS NULL OR "color" ~ '^#[0-9a-fA-F]{6}$');
--> statement-breakpoint

ALTER TABLE "event_series"
	ADD CONSTRAINT "event_series_titulo_preenchido" CHECK (length(btrim("title")) > 0);
--> statement-breakpoint

ALTER TABLE "event_series"
	ADD CONSTRAINT "event_series_dia_valido" CHECK ("weekday" BETWEEN 0 AND 6);
--> statement-breakpoint

-- Toda semana até uma vez por mês: o que existe hoje (D-M05-1).
ALTER TABLE "event_series"
	ADD CONSTRAINT "event_series_intervalo_valido" CHECK ("interval_weeks" BETWEEN 1 AND 4);
--> statement-breakpoint

ALTER TABLE "event_series"
	ADD CONSTRAINT "event_series_duracao_valida"
	CHECK ("duration_minutes" IS NULL OR "duration_minutes" BETWEEN 1 AND 1440);
--> statement-breakpoint

-- Pode terminar na VÉSPERA do início: é a série encerrada antes de acontecer
-- a primeira vez. Antes disso, não há o que representar.
ALTER TABLE "event_series"
	ADD CONSTRAINT "event_series_fim_depois_do_inicio"
	CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on" - 1);
--> statement-breakpoint

ALTER TABLE "event"
	ADD CONSTRAINT "event_titulo_preenchido" CHECK (length(btrim("title")) > 0);
--> statement-breakpoint

ALTER TABLE "event"
	ADD CONSTRAINT "event_status_valido" CHECK ("status" IN ('agendado', 'cancelado'));
--> statement-breakpoint

ALTER TABLE "event"
	ADD CONSTRAINT "event_fim_depois_do_inicio"
	CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at");
--> statement-breakpoint

-- Ocorrência de série tem data na série; evento avulso não tem.
ALTER TABLE "event"
	ADD CONSTRAINT "event_ocorrencia_coerente"
	CHECK (("series_id" IS NULL) = ("occurrence_date" IS NULL));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Público-alvo: exatamente um dono e exatamente um alvo
-- ---------------------------------------------------------------------------

ALTER TABLE "event_audience"
	ADD CONSTRAINT "event_audience_um_dono"
	CHECK (("event_id" IS NULL) <> ("series_id" IS NULL));
--> statement-breakpoint

ALTER TABLE "event_audience"
	ADD CONSTRAINT "event_audience_alvo_coerente"
	CHECK (
		("kind" = 'equipe' AND "group_id" IS NULL AND "person_id" IS NULL)
		OR ("kind" = 'grupo' AND "group_id" IS NOT NULL AND "person_id" IS NULL)
		OR ("kind" = 'pessoa' AND "person_id" IS NOT NULL AND "group_id" IS NULL)
	);
--> statement-breakpoint

-- O mesmo convite duas vezes é ambiguidade, não ênfase. NULLS NOT DISTINCT
-- (Postgres 15+) faz "equipe" — dois nulos — contar como repetição.
CREATE UNIQUE INDEX "event_audience_evento_unico_idx"
	ON "event_audience" ("event_id", "kind", "group_id", "person_id") NULLS NOT DISTINCT
	WHERE "event_id" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX "event_audience_serie_unico_idx"
	ON "event_audience" ("series_id", "kind", "group_id", "person_id") NULLS NOT DISTINCT
	WHERE "series_id" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. O que não muda depois de criado
--
-- O código público já pode estar circulando no WhatsApp; a ocorrência de uma
-- série é identificada pela data; e o dia e o intervalo de uma série SÃO a
-- série — mudar isso é criar outra (D-M05-4).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "evento_imutavel"() RETURNS trigger AS $$
BEGIN
	IF (NEW."team_id", NEW."public_code", NEW."series_id", NEW."occurrence_date")
	   IS DISTINCT FROM
	   (OLD."team_id", OLD."public_code", OLD."series_id", OLD."occurrence_date") THEN
		RAISE EXCEPTION 'Equipe, código público e lugar na série de um evento não mudam.'
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "event_imutavel"
	BEFORE UPDATE ON "event"
	FOR EACH ROW EXECUTE FUNCTION "evento_imutavel"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "serie_imutavel"() RETURNS trigger AS $$
BEGIN
	IF (NEW."team_id", NEW."weekday", NEW."interval_weeks", NEW."starts_on")
	   IS DISTINCT FROM
	   (OLD."team_id", OLD."weekday", OLD."interval_weeks", OLD."starts_on") THEN
		RAISE EXCEPTION 'Dia, intervalo e início de uma série não mudam: encerre-a e crie outra.'
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "event_series_imutavel"
	BEFORE UPDATE ON "event_series"
	FOR EACH ROW EXECUTE FUNCTION "serie_imutavel"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Evento que aconteceu não se apaga
--
-- A única linha de `event` que pode sair do banco é uma ocorrência FUTURA de
-- série — a que deixa de existir quando a série é encerrada. Evento avulso e
-- evento passado se cancelam; no M06 eles terão presença presa a eles.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "evento_so_apaga_ocorrencia_futura"() RETURNS trigger AS $$
BEGIN
	IF OLD."series_id" IS NULL OR OLD."starts_at" <= now() THEN
		RAISE EXCEPTION 'Evento avulso ou que já aconteceu não se apaga: cancele-o.'
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "event_so_apaga_ocorrencia_futura"
	BEFORE DELETE ON "event"
	FOR EACH ROW EXECUTE FUNCTION "evento_so_apaga_ocorrencia_futura"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Tudo da mesma equipe
--
-- Tipo, grupo e público de um evento pertencem à equipe dele. Há uma equipe
-- só hoje (ADR 0001), e é exatamente por isso que a regra entra agora: no dia
-- em que houver duas, ninguém vai lembrar de conferir.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "evento_da_mesma_equipe"() RETURNS trigger AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "event_type" WHERE "id" = NEW."type_id" AND "team_id" = NEW."team_id"
	) THEN
		RAISE EXCEPTION 'Tipo de evento de outra equipe.' USING ERRCODE = 'check_violation';
	END IF;

	IF NEW."group_id" IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "small_group" WHERE "id" = NEW."group_id" AND "team_id" = NEW."team_id"
	) THEN
		RAISE EXCEPTION 'Grupo de outra equipe.' USING ERRCODE = 'check_violation';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "event_da_mesma_equipe"
	BEFORE INSERT OR UPDATE OF "type_id", "group_id" ON "event"
	FOR EACH ROW EXECUTE FUNCTION "evento_da_mesma_equipe"();
--> statement-breakpoint

CREATE TRIGGER "event_series_da_mesma_equipe"
	BEFORE INSERT OR UPDATE OF "type_id", "group_id" ON "event_series"
	FOR EACH ROW EXECUTE FUNCTION "evento_da_mesma_equipe"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "publico_da_mesma_equipe"() RETURNS trigger AS $$
DECLARE
	equipe uuid;
BEGIN
	IF NEW."event_id" IS NOT NULL THEN
		SELECT "team_id" INTO equipe FROM "event" WHERE "id" = NEW."event_id";
	ELSE
		SELECT "team_id" INTO equipe FROM "event_series" WHERE "id" = NEW."series_id";
	END IF;

	IF NEW."group_id" IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "small_group" WHERE "id" = NEW."group_id" AND "team_id" = equipe
	) THEN
		RAISE EXCEPTION 'Grupo convidado é de outra equipe.' USING ERRCODE = 'check_violation';
	END IF;

	IF NEW."person_id" IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "person" WHERE "id" = NEW."person_id" AND "team_id" = equipe
	) THEN
		RAISE EXCEPTION 'Pessoa convidada é de outra equipe.' USING ERRCODE = 'check_violation';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "event_audience_da_mesma_equipe"
	BEFORE INSERT OR UPDATE ON "event_audience"
	FOR EACH ROW EXECUTE FUNCTION "publico_da_mesma_equipe"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Grupo com encontros marcados não se arquiva
--
-- Revisa a regra da migração 0006: além de pessoas e responsáveis, um grupo
-- com evento futuro agendado ou série em andamento ainda está vivo. Arquivá-lo
-- deixaria na agenda de todo mundo o encontro de um grupo que não existe.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "grupo_so_arquiva_vazio"() RETURNS trigger AS $$
BEGIN
	IF NEW."team_id" IS DISTINCT FROM OLD."team_id" THEN
		RAISE EXCEPTION 'A equipe de um grupo não muda.'
			USING ERRCODE = 'restrict_violation';
	END IF;

	IF NEW."archived_at" IS NOT NULL AND OLD."archived_at" IS NULL THEN
		IF EXISTS (
			SELECT 1 FROM "group_membership"
			WHERE "group_id" = NEW."id" AND "left_at" IS NULL
		) THEN
			RAISE EXCEPTION 'Grupo com pessoas não pode ser arquivado.'
				USING ERRCODE = 'restrict_violation';
		END IF;

		IF EXISTS (SELECT 1 FROM "person_role" WHERE "scope_id" = NEW."id") THEN
			RAISE EXCEPTION 'Grupo com responsáveis não pode ser arquivado.'
				USING ERRCODE = 'restrict_violation';
		END IF;

		-- Série em andamento: ainda tem alguma data de hoje em diante.
		IF EXISTS (
			SELECT 1 FROM "event_series"
			WHERE "group_id" = NEW."id"
				AND ("ends_on" IS NULL OR ("ends_on" >= CURRENT_DATE AND "ends_on" >= "starts_on"))
		) OR EXISTS (
			SELECT 1 FROM "event"
			WHERE "group_id" = NEW."id" AND "status" = 'agendado' AND "starts_at" > now()
		) THEN
			RAISE EXCEPTION 'Grupo com encontros marcados não pode ser arquivado.'
				USING ERRCODE = 'restrict_violation';
		END IF;
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
