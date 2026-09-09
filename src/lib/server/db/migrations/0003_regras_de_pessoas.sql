-- Regras do Módulo 02 que o Drizzle não expressa.
--
-- Mesma postura da migração 0001: o que precisa ser verdade sempre vira
-- restrição de banco. Convenção de código se esquece; CHECK, não.

-- ---------------------------------------------------------------------------
-- 1. Domínios fechados — colunas de texto que só aceitam certos valores
--
-- São texto, e não ENUM do Postgres, porque acrescentar valor a um ENUM é
-- migração com bloqueio; a um CHECK, não. Mas texto sem restrição aceita
-- qualquer coisa, e a primeira grafia errada só aparece no relatório.
-- ---------------------------------------------------------------------------

ALTER TABLE "person"
	ADD CONSTRAINT "person_relationship_status_valido"
	CHECK ("relationship_status" IS NULL OR "relationship_status" IN
		('solteiro', 'namorando', 'noivo', 'casado'));
--> statement-breakpoint

ALTER TABLE "person"
	ADD CONSTRAINT "person_source_valido"
	CHECK ("source" IN ('cadastro', 'autocadastro', 'importacao'));
--> statement-breakpoint

ALTER TABLE "consent"
	ADD CONSTRAINT "consent_kind_valido"
	CHECK ("kind" IN ('dados_cadastrais', 'foto', 'compartilhamento_externo', 'uso_ia'));
--> statement-breakpoint

ALTER TABLE "person_relation"
	ADD CONSTRAINT "person_relation_tipo_valido"
	CHECK ("relation_type" IN ('irmao', 'conjuge', 'namorado', 'responsavel_legal'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Vínculos: ninguém é irmão de si mesmo, e o par simétrico é canônico
--
-- Irmão, cônjuge e namorado são fatos simétricos: guardar as duas direções
-- convida à divergência — alguém apaga uma linha e o vínculo fica pela metade.
-- Grava-se UMA linha, com person_a < person_b.
--
-- responsavel_legal é dirigido (person_a cuida de person_b), então escapa da
-- ordenação — mas continua proibido apontar para si mesmo.
-- ---------------------------------------------------------------------------

ALTER TABLE "person_relation"
	ADD CONSTRAINT "person_relation_nao_reflexiva"
	CHECK ("person_a" <> "person_b");
--> statement-breakpoint

ALTER TABLE "person_relation"
	ADD CONSTRAINT "person_relation_par_canonico"
	CHECK ("relation_type" = 'responsavel_legal' OR "person_a" < "person_b");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Um único estágio padrão por equipe
--
-- Índice único parcial: garante no banco que exatamente uma linha por equipe
-- pode ser o estágio de quem acabou de chegar. Duas seria ambiguidade
-- silenciosa na hora de cadastrar.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "membership_status_um_padrao_idx"
	ON "membership_status" ("team_id")
	WHERE "is_default";
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Append-only de verdade (RN-04 e ADR 0003)
--
-- person_status_history é a linha do tempo da pessoa nos Eagles, e consent é
-- prova de obrigação legal. Nas duas, reescrever o passado apaga exatamente a
-- informação que dá sentido ao registro.
--
-- Mesma técnica da auditoria na migração 0001: gatilho que recusa, para valer
-- inclusive quando alguém abre o psql com o usuário da aplicação.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "recusa_alteracao"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'A tabela % é append-only: % não é permitido.', TG_TABLE_NAME, TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "person_status_history_sem_update"
	BEFORE UPDATE ON "person_status_history"
	FOR EACH ROW EXECUTE FUNCTION "recusa_alteracao"();
--> statement-breakpoint

CREATE TRIGGER "person_status_history_sem_delete"
	BEFORE DELETE ON "person_status_history"
	FOR EACH ROW EXECUTE FUNCTION "recusa_alteracao"();
--> statement-breakpoint

CREATE TRIGGER "consent_sem_update"
	BEFORE UPDATE ON "consent"
	FOR EACH ROW EXECUTE FUNCTION "recusa_alteracao"();
--> statement-breakpoint

CREATE TRIGGER "consent_sem_delete"
	BEFORE DELETE ON "consent"
	FOR EACH ROW EXECUTE FUNCTION "recusa_alteracao"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. person_view precisa ser RECRIADA
--
-- A view foi criada na 0001 com `SELECT p.*`, e o Postgres expande o asterisco
-- no momento da criação. As colunas que o M02 acrescentou NÃO aparecem
-- sozinhas: sem este passo, a view continuaria devolvendo o formato antigo e
-- toda leitura por ela ignoraria telefone, e-mail e status.
--
-- É a armadilha que o plano do módulo registra como risco. Fica aqui a
-- lembrança para o próximo módulo que alterar `person`.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS "person_view";
--> statement-breakpoint

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
-- 6. Busca por nome sem acento
-- ---------------------------------------------------------------------------

CREATE INDEX "person_nome_normalizado_idx"
	ON "person" ("team_id", "full_name_normalized");
