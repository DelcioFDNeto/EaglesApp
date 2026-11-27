-- ---------------------------------------------------------------------------
-- Correção de domínio (27/11/2026):
--   - PG (Pequeno Grupo) é o nome da reunião de membros e visitantes (evento
--     do tipo 'pg'), não um subgrupo de pessoas.
--   - Subgrupos continuam na tabela "group".
--   - Conselheiros atuam com escopo global na equipe dos Eagles (abaixo dos 2
--     líderes), não restritos a um subgrupo específico.
-- ---------------------------------------------------------------------------

-- 1. Garante o tipo de evento padrão "PG (Pequeno Grupo)" em toda equipe existente.
INSERT INTO "event_type" ("id", "team_id", "name", "slug", "description", "color", "active")
SELECT
	gen_random_uuid(),
	t."id",
	'PG (Pequeno Grupo)',
	'pg',
	'Reunião de membros e visitantes para mensagem bíblica, comida e confraternização.',
	'#A91825',
	true
FROM "team" t
WHERE NOT EXISTS (
	SELECT 1
	FROM "event_type" et
	WHERE et."team_id" = t."id" AND et."slug" = 'pg'
);
--> statement-breakpoint

-- 2. Atualiza descrições de permissões e do papel Conselheiro para refletir subgrupos e escopo global.
UPDATE "permission"
SET "description" = CASE "key"
	WHEN 'group.view' THEN 'Ver subgrupos'
	WHEN 'group.manage' THEN 'Criar, editar e arquivar subgrupos'
	WHEN 'group.update' THEN 'Editar nome e descrição do subgrupo'
	WHEN 'group.assign_member' THEN 'Transferir membros entre subgrupos'
	WHEN 'finance.view_group' THEN 'Ver o financeiro por subgrupo'
	ELSE "description"
END
WHERE "key" IN (
	'group.view',
	'group.manage',
	'group.update',
	'group.assign_member',
	'finance.view_group'
);
--> statement-breakpoint

UPDATE "role"
SET "description" = 'Cuida da equipe dos Eagles, dos PGs, escalas e pessoas.'
WHERE "key" = 'conselheiro';
--> statement-breakpoint

-- 3. Migra atribuições existentes de Conselheiro de escopo 'group' para 'global' (sem duplicar).
INSERT INTO "person_role" (
	"id",
	"person_id",
	"role_id",
	"scope_type",
	"scope_id",
	"granted_by_person_id",
	"expires_at",
	"created_at"
)
SELECT DISTINCT ON (pr."person_id", pr."role_id")
	gen_random_uuid(),
	pr."person_id",
	pr."role_id",
	'global',
	NULL,
	pr."granted_by_person_id",
	pr."expires_at",
	pr."created_at"
FROM "person_role" pr
JOIN "role" r ON r."id" = pr."role_id"
WHERE r."key" = 'conselheiro'
	AND pr."scope_type" = 'group'
	AND NOT EXISTS (
		SELECT 1
		FROM "person_role" pr2
		WHERE pr2."person_id" = pr."person_id"
			AND pr2."role_id" = pr."role_id"
			AND pr2."scope_type" = 'global'
			AND pr2."scope_id" IS NULL
	)
ORDER BY pr."person_id", pr."role_id", pr."created_at" ASC;
--> statement-breakpoint

DELETE FROM "person_role" pr
USING "role" r
WHERE r."id" = pr."role_id"
	AND r."key" = 'conselheiro'
	AND pr."scope_type" = 'group';
