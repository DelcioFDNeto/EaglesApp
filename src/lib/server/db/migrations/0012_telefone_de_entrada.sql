-- Revisão de 17/10/2026: o telefone de ENTRADA (user_account.phone) tem uma
-- forma só — dígitos, com DDD, sem o 55 do país —, e é exatamente assim que o
-- login o procura (`telefoneNacional`, em auth/conta.ts). Um número gravado de
-- outro jeito é uma conta que ninguém encontra; a varredura de 11/10/2026
-- tinha remendado isso com uma busca dupla ("com e sem 55"), ambígua quando as
-- duas formas existiam para contas diferentes. A busca dupla saiu; esta regra
-- garante que ela não faz falta.
--
-- Primeiro, a forma antiga (com o 55) vira a nova, quando não colide com
-- outra conta. Depois, a regra. NOT VALID: vale para toda escrita nova sem
-- reprovar a migração por uma linha antiga que não pôde ser convertida.

UPDATE "user_account" AS u
SET "phone" = substr(u."phone", 3)
WHERE u."phone" ~ '^55[1-9][1-9](9[0-9]{8}|[2-5][0-9]{7})$'
	AND NOT EXISTS (
		SELECT 1 FROM "user_account" o WHERE o."phone" = substr(u."phone", 3)
	);
--> statement-breakpoint
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_phone_nacional"
	CHECK ("phone" IS NULL OR "phone" ~ '^[1-9][1-9](9[0-9]{8}|[2-5][0-9]{7})$') NOT VALID;
