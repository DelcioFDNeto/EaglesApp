-- ---------------------------------------------------------------------------
-- Módulo 09 — Financeiro (RN-20 a RN-25, RF-08.1 a RF-08.11)
-- Centavos inteiros; livro-caixa imutável (correção = estorno + novo lançamento).
-- ---------------------------------------------------------------------------

CREATE TABLE "finance_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL DEFAULT 'caixa',
	"active" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_account" ADD CONSTRAINT "finance_account_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "finance_account_team_idx" ON "finance_account" ("team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_account_team_name_idx" ON "finance_account" ("team_id", "name");
--> statement-breakpoint
ALTER TABLE "finance_account"
	ADD CONSTRAINT "finance_account_kind_valido"
	CHECK ("kind" IN ('caixa', 'pix', 'especie', 'banco'));
--> statement-breakpoint
CREATE TABLE "finance_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"is_donation" boolean NOT NULL DEFAULT false,
	"active" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_category" ADD CONSTRAINT "finance_category_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "finance_category_team_idx" ON "finance_category" ("team_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_category_team_slug_idx" ON "finance_category" ("team_id", "slug");
--> statement-breakpoint
ALTER TABLE "finance_category"
	ADD CONSTRAINT "finance_category_kind_valido"
	CHECK ("kind" IN ('entrada', 'saida'));
--> statement-breakpoint
CREATE TABLE "contribution_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"role_key" text,
	"min_amount_cents" integer NOT NULL,
	"period" text NOT NULL DEFAULT 'mensal',
	"active" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contribution_rule" ADD CONSTRAINT "contribution_rule_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "contribution_rule" ADD CONSTRAINT "contribution_rule_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "finance_category"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "contribution_rule_team_idx" ON "contribution_rule" ("team_id");
--> statement-breakpoint
CREATE INDEX "contribution_rule_category_idx" ON "contribution_rule" ("category_id");
--> statement-breakpoint
ALTER TABLE "contribution_rule"
	ADD CONSTRAINT "contribution_rule_min_positivo"
	CHECK ("min_amount_cents" > 0);
--> statement-breakpoint
ALTER TABLE "contribution_rule"
	ADD CONSTRAINT "contribution_rule_period_valido"
	CHECK ("period" IN ('mensal', 'avulso'));
--> statement-breakpoint
CREATE TABLE "finance_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"account_id" uuid,
	"category_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payment_method" text NOT NULL DEFAULT 'pix',
	"description" text NOT NULL,
	"responsible_person_id" uuid NOT NULL,
	"person_id" uuid,
	"event_id" uuid,
	"group_id" uuid,
	"receipt_url" text,
	"status" text NOT NULL DEFAULT 'confirmada',
	"reverses_transaction_id" uuid,
	"approved_by_person_id" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_tx_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_tx_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "finance_account"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_tx_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "finance_category"("id");
--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_tx_responsible_person_id_fk" FOREIGN KEY ("responsible_person_id") REFERENCES "person"("id");
--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_tx_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_tx_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_tx_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "group"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_tx_approved_by_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "person"("id");
--> statement-breakpoint
ALTER TABLE "finance_transaction" ADD CONSTRAINT "finance_tx_reverses_fk" FOREIGN KEY ("reverses_transaction_id") REFERENCES "finance_transaction"("id");
--> statement-breakpoint
CREATE INDEX "finance_tx_team_idx" ON "finance_transaction" ("team_id");
--> statement-breakpoint
CREATE INDEX "finance_tx_occurred_idx" ON "finance_transaction" ("team_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "finance_tx_group_idx" ON "finance_transaction" ("group_id");
--> statement-breakpoint
CREATE INDEX "finance_tx_event_idx" ON "finance_transaction" ("event_id");
--> statement-breakpoint
CREATE INDEX "finance_tx_person_idx" ON "finance_transaction" ("person_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_tx_reverses_unique_idx"
	ON "finance_transaction" ("reverses_transaction_id")
	WHERE "reverses_transaction_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "finance_transaction"
	ADD CONSTRAINT "finance_tx_kind_valido"
	CHECK ("kind" IN ('entrada', 'saida'));
--> statement-breakpoint
ALTER TABLE "finance_transaction"
	ADD CONSTRAINT "finance_tx_amount_positivo"
	CHECK ("amount_cents" > 0);
--> statement-breakpoint
ALTER TABLE "finance_transaction"
	ADD CONSTRAINT "finance_tx_payment_method_valido"
	CHECK ("payment_method" IN ('pix', 'especie', 'cartao', 'transferencia', 'outro'));
--> statement-breakpoint
ALTER TABLE "finance_transaction"
	ADD CONSTRAINT "finance_tx_status_valido"
	CHECK ("status" IN ('confirmada', 'pendente_aprovacao', 'rejeitada'));
--> statement-breakpoint

-- RN-21: Movimentação lançada NÃO é excluída fisicamente nem editada após confirmada.
CREATE OR REPLACE FUNCTION impedir_mutacao_financeiro()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Movimentações financeiras não podem ser excluídas fisicamente (RN-21). Faça um estorno.';
	END IF;

	IF TG_OP = 'UPDATE' THEN
		-- Permite transição de aprovação (pendente_aprovacao -> confirmada | rejeitada) sem alterar valores
		IF OLD.status = 'pendente_aprovacao'
			AND NEW.status IN ('confirmada', 'rejeitada')
			AND NEW.amount_cents = OLD.amount_cents
			AND NEW.kind = OLD.kind
			AND NEW.category_id = OLD.category_id
			AND NEW.occurred_at = OLD.occurred_at
			AND NEW.description = OLD.description
			AND NEW.reverses_transaction_id IS NOT DISTINCT FROM OLD.reverses_transaction_id
		THEN
			RETURN NEW;
		END IF;

		RAISE EXCEPTION 'Movimentação financeira confirmada é imutável (RN-21). Para corrigir, faça um estorno e lance novamente.';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_transaction_imutavel
	BEFORE UPDATE OR DELETE ON "finance_transaction"
	FOR EACH ROW
	EXECUTE FUNCTION impedir_mutacao_financeiro();
