-- Jornada da pessoa: visitante → recorrente → membro Eagles (ciclo 2 do M02).
--
-- Decisão do usuário (26/11/2026): o acesso de membro acompanha o estágio
-- "membro". Visitante e recorrente têm acesso de visitante. A partir desta
-- versão, mudar o estágio troca o papel base (self) entre `visitante` e `membro`.
--
-- Antes disso, todo perfil nascia com status 'visitante', inclusive o de quem
-- foi cadastrado com acesso de membro. Sem alinhar os dados, a primeira mudança
-- de estágio feita por um conselheiro rebaixaria o acesso de um membro real.

-- 1. Toda pessoa passa a ter perfil (o estágio mora nele).
INSERT INTO "person_profile" ("person_id")
SELECT p."id" FROM "person" p
WHERE NOT EXISTS (SELECT 1 FROM "person_profile" pp WHERE pp."person_id" = p."id");
--> statement-breakpoint

-- 2. Quem já tem acesso de membro (ou acima) está no estágio membro.
UPDATE "person_profile" pp SET "status" = 'membro', "updated_at" = now()
WHERE pp."status" = 'visitante'
	AND EXISTS (
		SELECT 1 FROM "person_role" pr JOIN "role" r ON r."id" = pr."role_id"
		WHERE pr."person_id" = pp."person_id" AND r."key" IN ('membro', 'conselheiro', 'lider', 'master')
	);
--> statement-breakpoint

-- 3. A data de nascimento que vale é a de `person` (ADR 0003: é ela que define
--    o regime de menor). O perfil chegou a guardar uma cópia; traz para cá o
--    que só existia lá.
UPDATE "person" p SET "birth_date" = pp."birth_date"
FROM "person_profile" pp
WHERE pp."person_id" = p."id" AND p."birth_date" IS NULL AND pp."birth_date" IS NOT NULL;
