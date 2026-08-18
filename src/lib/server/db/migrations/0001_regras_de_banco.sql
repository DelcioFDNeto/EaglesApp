-- Regras que o Drizzle não expressa: restrições de domínio, view derivada
-- e a imutabilidade da auditoria.
--
-- Tudo aqui é garantia de BANCO, não convenção de código. Convenção de código
-- se esquece; restrição de banco, não.

-- ---------------------------------------------------------------------------
-- 1. Escopo só aceita os três valores do modelo (seção 5.2)
-- ---------------------------------------------------------------------------

ALTER TABLE "person_role"
	ADD CONSTRAINT "person_role_scope_type_valido"
	CHECK ("scope_type" IN ('global', 'group', 'self'));
--> statement-breakpoint

-- Coerência entre tipo e id do escopo: 'group' exige um grupo,
-- 'global' e 'self' não podem ter um.
ALTER TABLE "person_role"
	ADD CONSTRAINT "person_role_scope_coerente"
	CHECK (
		("scope_type" = 'group' AND "scope_id" IS NOT NULL)
		OR ("scope_type" IN ('global', 'self') AND "scope_id" IS NULL)
	);
--> statement-breakpoint

ALTER TABLE "setting"
	ADD CONSTRAINT "setting_scope_type_valido"
	CHECK ("scope_type" IN ('global', 'group', 'person'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Data de nascimento não pode estar no futuro nem ser absurda
-- ---------------------------------------------------------------------------

ALTER TABLE "person"
	ADD CONSTRAINT "person_birth_date_plausivel"
	CHECK ("birth_date" IS NULL OR ("birth_date" > DATE '1900-01-01' AND "birth_date" <= CURRENT_DATE));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. person_view — idade e menoridade DERIVADAS (ADR 0003)
--
-- Não existe coluna `is_minor` armazenada, e isso é deliberado: uma coluna
-- gerada precisa de expressão imutável, e idade depende da data de hoje.
-- Um valor gravado envelheceria ao contrário — o registro diria "não é menor"
-- para sempre, ou "é menor" muito depois do aniversário de 18.
--
-- `is_minor` é NULL quando a data de nascimento é desconhecida. Quem consome
-- deve tratar NULL como "trate pelo regime restrito", nunca como "é maior".
-- ---------------------------------------------------------------------------

CREATE VIEW "person_view" AS
SELECT
	p.*,
	CASE
		WHEN p."birth_date" IS NULL THEN NULL
		ELSE EXTRACT(YEAR FROM AGE(CURRENT_DATE, p."birth_date"))::int
	END AS "age_years",
	CASE
		WHEN p."birth_date" IS NULL THEN NULL
		ELSE AGE(CURRENT_DATE, p."birth_date") < INTERVAL '18 years'
	END AS "is_minor"
FROM "person" p;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. audit_log é append-only (RN-28)
--
-- A aplicação recebe INSERT e SELECT. UPDATE e DELETE são bloqueados por
-- gatilho, que funciona mesmo se alguém rodar SQL como dono da tabela —
-- ao contrário de REVOKE, que o dono ignora.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "audit_log_somente_insercao"()
RETURNS TRIGGER AS $$
BEGIN
	RAISE EXCEPTION 'audit_log e append-only: % nao e permitido', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "audit_log_sem_update"
	BEFORE UPDATE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION "audit_log_somente_insercao"();
--> statement-breakpoint

CREATE TRIGGER "audit_log_sem_delete"
	BEFORE DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION "audit_log_somente_insercao"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Convite: a data de expiração precisa ser posterior à criação
-- ---------------------------------------------------------------------------

ALTER TABLE "invite"
	ADD CONSTRAINT "invite_expiracao_futura"
	CHECK ("expires_at" > "created_at");
--> statement-breakpoint

ALTER TABLE "session"
	ADD CONSTRAINT "session_expiracao_futura"
	CHECK ("expires_at" > "created_at");
