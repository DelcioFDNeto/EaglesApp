-- Varredura de 11/10/2026: o gatilho que impede arquivar grupo com
-- responsáveis contava QUALQUER linha de `person_role` com o escopo do grupo,
-- inclusive atribuições vencidas e de pessoas removidas do cadastro. A tela do
-- grupo não mostra essas atribuições — então o grupo nunca se arquivava, por
-- um motivo que ninguém conseguia ver nem resolver.
--
-- A regra passa a ser a mesma da aplicação (`atribuicaoAtiva`): em vigor, de
-- quem está no cadastro. O resto da função é o da migração 0008, sem mudança.

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

		IF EXISTS (
			SELECT 1 FROM "person_role" pr
			JOIN "person" p ON p."id" = pr."person_id"
			WHERE pr."scope_id" = NEW."id"
				AND (pr."expires_at" IS NULL OR pr."expires_at" > now())
				AND p."deleted_at" IS NULL
		) THEN
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
