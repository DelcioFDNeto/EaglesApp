-- Regras do Módulo 04 que o Drizzle não expressa.
--
-- Mesma postura das migrações 0001 e 0003: o que precisa ser verdade sempre
-- vira restrição de banco. RN-06 e RN-07 valem mesmo para quem abrir o psql
-- com o usuário da aplicação.

-- ---------------------------------------------------------------------------
-- 1. Domínios do grupo
-- ---------------------------------------------------------------------------

ALTER TABLE "small_group"
	ADD CONSTRAINT "small_group_nome_preenchido"
	CHECK (length(btrim("name")) > 0);
--> statement-breakpoint

ALTER TABLE "small_group"
	ADD CONSTRAINT "small_group_dia_valido"
	CHECK ("meeting_weekday" IS NULL OR "meeting_weekday" BETWEEN 0 AND 6);
--> statement-breakpoint

ALTER TABLE "small_group"
	ADD CONSTRAINT "small_group_cor_valida"
	CHECK ("color" IS NULL OR "color" ~ '^#[0-9a-fA-F]{6}$');
--> statement-breakpoint

-- Saída não antecede a entrada. Igual é permitido: é a transferência
-- registrada no mesmo instante em que o vínculo novo começa.
ALTER TABLE "group_membership"
	ADD CONSTRAINT "group_membership_saida_depois_da_entrada"
	CHECK ("left_at" IS NULL OR "left_at" >= "joined_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Vínculo só se ENCERRA (RN-07)
--
-- A única alteração aceita numa linha de group_membership é encerrar um
-- vínculo aberto: preencher left_at (e, junto, o motivo e quem encerrou),
-- uma vez. Mudar o grupo, a pessoa ou a data de entrada reescreveria a
-- história de quem esteve onde — exatamente o que a regra protege.
--
-- DELETE é recusado pelo mesmo gatilho das tabelas append-only (0003).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "vinculo_de_grupo_so_encerra"() RETURNS trigger AS $$
BEGIN
	IF OLD."left_at" IS NOT NULL THEN
		RAISE EXCEPTION 'Vínculo de grupo já encerrado não se altera (RN-07).'
			USING ERRCODE = 'restrict_violation';
	END IF;

	IF NEW."left_at" IS NULL THEN
		RAISE EXCEPTION 'A única alteração aceita num vínculo de grupo é encerrá-lo (RN-07).'
			USING ERRCODE = 'restrict_violation';
	END IF;

	IF (NEW."id", NEW."group_id", NEW."person_id", NEW."joined_at",
	    NEW."added_by_person_id", NEW."batch_id", NEW."created_at")
	   IS DISTINCT FROM
	   (OLD."id", OLD."group_id", OLD."person_id", OLD."joined_at",
	    OLD."added_by_person_id", OLD."batch_id", OLD."created_at") THEN
		RAISE EXCEPTION 'Encerrar um vínculo não pode alterar grupo, pessoa nem entrada (RN-07).'
			USING ERRCODE = 'restrict_violation';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "group_membership_so_encerra"
	BEFORE UPDATE ON "group_membership"
	FOR EACH ROW EXECUTE FUNCTION "vinculo_de_grupo_so_encerra"();
--> statement-breakpoint

CREATE TRIGGER "group_membership_sem_delete"
	BEFORE DELETE ON "group_membership"
	FOR EACH ROW EXECUTE FUNCTION "recusa_alteracao"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Entrada: grupo ativo, da mesma equipe da pessoa
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "vinculo_de_grupo_valido"() RETURNS trigger AS $$
DECLARE
	equipe_do_grupo uuid;
	grupo_arquivado timestamptz;
	equipe_da_pessoa uuid;
BEGIN
	SELECT "team_id", "archived_at" INTO equipe_do_grupo, grupo_arquivado
		FROM "small_group" WHERE "id" = NEW."group_id";
	SELECT "team_id" INTO equipe_da_pessoa
		FROM "person" WHERE "id" = NEW."person_id";

	IF grupo_arquivado IS NOT NULL AND NEW."left_at" IS NULL THEN
		RAISE EXCEPTION 'Grupo arquivado não recebe pessoas.'
			USING ERRCODE = 'check_violation';
	END IF;

	IF equipe_do_grupo IS DISTINCT FROM equipe_da_pessoa THEN
		RAISE EXCEPTION 'Pessoa e grupo precisam ser da mesma equipe.'
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "group_membership_entrada_valida"
	BEFORE INSERT ON "group_membership"
	FOR EACH ROW EXECUTE FUNCTION "vinculo_de_grupo_valido"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Grupo não se apaga; arquiva-se, e só vazio
--
-- Vazio quer dizer: ninguém com vínculo aberto e nenhum papel com escopo nele.
-- Um conselheiro de grupo arquivado teria autoridade sobre um lugar que não
-- existe mais — e o acesso dele sumiria sem a auditoria de quem o retirou.
-- Cada responsável sai pela tela de acesso, um registro por remoção.
--
-- A equipe do grupo também não muda: mudaria de uma vez o escopo de todos os
-- papéis e vínculos que apontam para ele.
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
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "small_group_so_arquiva_vazio"
	BEFORE UPDATE ON "small_group"
	FOR EACH ROW EXECUTE FUNCTION "grupo_so_arquiva_vazio"();
--> statement-breakpoint

CREATE TRIGGER "small_group_sem_delete"
	BEFORE DELETE ON "small_group"
	FOR EACH ROW EXECUTE FUNCTION "recusa_alteracao"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Papel de grupo não aponta para grupo arquivado
--
-- Atribuir "conselheiro" a um grupo arquivado criaria a autoridade sobre o
-- lugar que o gatilho anterior acabou de esvaziar.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "papel_de_grupo_ativo"() RETURNS trigger AS $$
BEGIN
	IF NEW."scope_id" IS NOT NULL AND EXISTS (
		SELECT 1 FROM "small_group"
		WHERE "id" = NEW."scope_id" AND "archived_at" IS NOT NULL
	) THEN
		RAISE EXCEPTION 'Grupo arquivado não recebe responsáveis.'
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "person_role_grupo_ativo"
	BEFORE INSERT OR UPDATE OF "scope_id" ON "person_role"
	FOR EACH ROW EXECUTE FUNCTION "papel_de_grupo_ativo"();
