ALTER TABLE "role" ADD COLUMN "default_scope" text DEFAULT 'self' NOT NULL;--> statement-breakpoint

-- O escopo de atribuição só aceita os três valores do modelo (seção 11.2),
-- mesma regra que já vale para person_role.scope_type desde a migração 0001.
ALTER TABLE "role"
	ADD CONSTRAINT "role_default_scope_valido"
	CHECK ("default_scope" IN ('global', 'group', 'self'));
--> statement-breakpoint

-- Preenche o escopo dos papéis de sistema já semeados numa instalação
-- existente. Numa instalação nova a tabela está vazia neste ponto e o UPDATE
-- não faz nada — a semeadura grava o escopo certo ao criar os papéis.
UPDATE "role" SET "default_scope" = 'global' WHERE "is_system" AND "key" = 'lider';
--> statement-breakpoint
UPDATE "role" SET "default_scope" = 'group' WHERE "is_system" AND "key" = 'conselheiro';
