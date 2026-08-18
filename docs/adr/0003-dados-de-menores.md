# ADR 0003 — Tratamento de dados de menores de idade

- **Status:** aceita
- **Data:** 2026-08-18
- **Decisor:** usuário (D-03)
- **Revisada em:** 2026-08-18 — ver "Revisão" ao final
- **Criticidade:** alta — obrigação legal, não preferência de produto

## Contexto

Os Eagles têm membros e visitantes menores de 18 anos. A LGPD (Lei 13.709/2018), art. 14, determina que o tratamento de dados pessoais de crianças e adolescentes deve ser feito no melhor interesse do titular e **exige consentimento específico e em destaque de pelo menos um dos pais ou responsável legal**.

O desenho original do sistema tratava data de nascimento como um campo opcional qualquer e permitia foto, telefone e observações para qualquer pessoa cadastrada. Isso não é adequado.

## Decisão

O sistema passa a ter **dois regimes de tratamento de dados pessoais**, determinados pela idade, e o regime restrito é o padrão quando a idade é desconhecida.

### Estrutura

- `person.birth_date` — continua opcional no primeiro contato, mas é o campo que **determina o regime jurídico** do registro.
- `is_minor` — **derivado numa view**, nunca armazenado (ver Revisão).
- `person_relation` — ganha o tipo `responsavel_legal`.
- **`consent`** — tabela nova, append-only: `person_id`, `kind` (`dados_cadastrais` · `foto` · `compartilhamento_externo` · `uso_ia`), `granted_by_person_id`, `granted_at`, `revoked_at`, `evidence`, `collected_by`. Revogar cria linha nova; nada é apagado do histórico de consentimento.

### Regras

| ID    | Regra                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RN-30 | Menor sem responsável vinculado e sem consentimento de `dados_cadastrais` fica em **cadastro mínimo**: só nome e presença. Nenhum contato, foto ou observação |
| RN-31 | Foto de menor exige consentimento do tipo `foto` do responsável. Sem isso o campo de upload **não aparece** — ausência da funcionalidade, não um aviso        |
| RN-32 | Contato de menor é visível apenas para `person.view_sensitive`; nunca para outros membros, mesmo do mesmo grupo                                               |
| RN-33 | Compartilhamento no WhatsApp **nunca** inclui foto, telefone ou e-mail de menor, mesmo com consentimento — o destino é um grupo cujo conteúdo não controlamos |
| RN-34 | Consentimento é revogável a qualquer momento pelo responsável, e a revogação **remove o dado**, não apenas oculta                                             |
| RN-35 | Ao completar 18 anos, o sistema sinaliza para recoletar consentimento **com o próprio titular** — o consentimento parental não migra automaticamente          |

### Autocadastro público

O formulário de visitante pergunta a data de nascimento **antes** de qualquer campo opcional. Se for menor, reduz-se a nome + nome do responsável + contato do responsável, e sinaliza ao conselheiro que falta coletar o consentimento presencialmente. **Um menor não preenche o próprio contato num formulário público.**

### IA

Dados de menores entram no pipeline de IA sempre pseudonimizados, sem nenhum campo de contato, e apenas com consentimento de `uso_ia`. A IA vê "P7, 16 anos, frequência 80%" — nunca nome, nunca telefone.

## Razões

O consentimento parental não é um checkbox: é uma obrigação legal cujo descumprimento expõe a organização. Mais importante que o risco jurídico — o app vai guardar fotos e telefones de adolescentes de uma comunidade. O regime restrito por padrão é a única postura defensável.

Derivar `is_minor` em vez de armazená-lo elimina toda uma classe de bug: um registro marcado "não é menor" que envelheceu ao contrário, ou um adolescente que fez 18 anos e continuou sob regime restrito para sempre.

## Consequências

- **Custo:** +3 a 4 dias dentro do M02 (Pessoas). Não altera o prazo do MVP.
- **Positiva:** a mesma tabela `consent` resolve o consentimento de foto de adultos (RNF-09), que já era requisito.
- **Negativa:** o cadastro de menor tem mais etapas e depende de uma conversa presencial com o responsável. Isso é atrito **intencional** e correto.
- **Operacional:** a liderança precisa definir como coleta e arquiva o consentimento presencial. Recomendo termo em papel assinado, fotografado e anexado em `consent.evidence`.

---

## Revisão de 18/08/2026

Duas correções, ambas materiais.

### 1. Não há menores hoje; o piso de idade é 16

A liderança confirmou: **todos os Eagles são maiores de idade atualmente**, e a
idade mínima daqui para a frente será **16 anos**.

Isso NÃO cancela este ADR. Pessoas de 16 e 17 anos continuam sendo menores
perante a LGPD — o piso de 16 garante que menores são possíveis no futuro,
apenas não existem hoje. O que muda:

| Item | Situação |
|---|---|
| Tabela `consent` e derivação de `is_minor` | **Mantidas.** Custam pouco agora e evitam migração de risco com dados em produção |
| Regime de criança (menores de 12) | **Removido.** O piso de 16 o torna impossível |
| Fluxo de consentimento parental (RN-30 a RN-35) | **Implementado, porém inativo.** Nenhuma tela de consentimento aparece enquanto não houver menor cadastrado |
| Custo no M02 | Cai de +3–4 dias para **+1–2 dias** |

O consentimento de **foto**, esse continua valendo para todos — é requisito de
privacidade independente de idade (RNF-09).

### 2. Erro corrigido: `is_minor` não pode ser coluna gerada

A versão original deste ADR especificava `person.is_minor` como coluna
`GENERATED ALWAYS AS ... STORED`. **Isso não funciona no PostgreSQL:** coluna
gerada exige expressão imutável, e idade depende da data de hoje. O banco
recusaria a migração.

A implementação usa uma **view**, que aceita expressão não-imutável:

```sql
CREATE VIEW person_view AS
SELECT p.*,
  CASE WHEN p.birth_date IS NULL THEN NULL
       ELSE EXTRACT(YEAR FROM AGE(CURRENT_DATE, p.birth_date))::int END AS age_years,
  CASE WHEN p.birth_date IS NULL THEN NULL
       ELSE AGE(CURRENT_DATE, p.birth_date) < INTERVAL '18 years' END AS is_minor
FROM person p;
```

`is_minor` é **NULL** quando a data de nascimento é desconhecida. Quem consome
deve tratar NULL como *"aplique o regime restrito"*, nunca como *"é maior"* —
há teste cobrindo os três casos em
[`tests/integration/banco.test.ts`](../../tests/integration/banco.test.ts).
