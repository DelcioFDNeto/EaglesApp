# Roadmap das Próximas Ondas (Pós-Onda 2)

> **Baseline atual:** fechamento na **Onda 2** (`commit 1906502`, 27/11/2026) — **78** arquivos de rota da API (`src/routes/api/**/+server.ts`), **28** telas SPA (`src/routes/**/+page.svelte`), **16** migrações SQL (`0000`–`0015`), **45** tabelas no schema e **41** suítes de testes automatizados (**27** de integração com PGlite + **14** de unidade).

Este documento consolida o que já foi entregue e validado até a **Onda 2** e organiza o que resta para as próximas ondas de implementação, além dos itens externos de infraestrutura, design e verificação em campo.

---

## 1. O que já está entregue e fechado até a Onda 2

### Base (M01–M11 · Ciclos 1–4) + Módulo de Perfis e Draft (`b0c4402`)

- **M01 — Fundação:** autenticação por convite + Argon2id, sessão revogável em banco com JWT, bloqueio progressivo, rate limit pré-hash, PWA, cache offline IndexedDB (limpo no logout) e prévia OG para WhatsApp.
- **M02 — Pessoas e Draft:** cadastro progressivo, `/perfil`, ficha `/pessoas/[id]`, caminhada (`visitante` → `recorrente` → `membro`), proteção mínima de 16 anos + cadastro restrito para menores de 16–17 anos (ADR 0003), perfil de atributos em 4 eixos (**Físico**, **Bíblico**, **Mental**, **Coordenação Motora** de 0–10 + medidas opcionais) e `/draft` com radar comparativo e balanceamento de times.
- **M03 — RBAC:** ponto único em `src/lib/server/policy/policy.ts`, papéis com escopo `global` / `group` / `self`, Master invisível e até 2 líderes com mandato de 2 anos (`/lideranca`).
- **M04 — Subgrupos:** criação, edição, arquivamento/reativação, transferência individual e em lote com histórico imutável (`group_member_history`).
- **M05 — Eventos e PGs:** tipo padrão **PG (Pequeno Grupo)**, tipos configuráveis, criação/edição/cancelamento preservando respostas, opções de RSVP configuráveis e compartilhamento.
- **M06 — Presença e Frequência:** histórico append-only de RSVP (`rsvp_history`), chamada completa em PGs e encontros de subgrupo, `/frequencia` e resumo na ficha da pessoa.
- **M07–M11:** responsabilidades e escalas, comunicação com modelos WhatsApp e janela de silêncio (`22h–7h`), livro-caixa financeiro imutável em centavos com estorno único, assistente de IA determinístico sob feature flag e auditoria imutável (`audit_log`).

### Onda 1 (`4fa0cbf`)

- **Dashboards específicos por papel (`/inicio` / `GET /api/inicio`):** visão adaptada para Líder, Conselheiro, Membro e Visitante/Recorrente.
- **Motor de notificações (`0014_notificacoes.sql`):** scheduler horário para lembretes de eventos próximos e escalas pendentes, suporte a inscrições Web Push, sino com contador na moldura, `/notificacoes` e preferências do usuário.
- **UI de check-in por QR Code (`/eventos/[id]`):** gerador QR ISO/IEC 18004 sem dependências externas (`src/lib/eventos/qrcode.ts`) e interface completa para uso quando habilitado pela feature flag.

### Onda 2 (`1906502`)

- **Uploads seguros e anexos (`0015_arquivos_anexos.sql`):** tabelas `file_asset` e `event_attachment` com validação por magic bytes e limite de 3 MB; foto de perfil em `/perfil`, anexos em `/eventos/[id]` e comprovantes reais em `/financeiro`.
- **Filtros completos e exportação no financeiro (`/financeiro`):** filtros combináveis (`de`, `ate` inclusivo, `tipo`, `categoriaId`, `responsavelId`, `eventoId`, `grupoId`) em `/api/financeiro/movimentacoes` e exportação CSV respeitando os filtros em `/api/financeiro/exportar`.
- **Algoritmos avançados de subgrupos e escalas (`/assistente` e `/responsabilidades`):** divisão de subgrupos considerando agrupamento de família/casal, equilíbrio por faixa etária e frequência (com pseudonimização de menores); geração de escalas ponderando RSVP e histórico de presença de 90 dias, além de sugestão dos top 3 substitutos em `/api/escalas/[id]/substitutos`.

---

## 2. Onda 3 — Cadastro Configurável, Consentimento LGPD e Fluxos de Comunidade

| Item                                        | Origem (`ESCOPO.md` / ADRs) | O que precisa ser construído                                                                                                                                                                                                          | Dependências e notas técnicas                                                                                                                   |
| ------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Campos personalizados e obrigatoriedade** | §11, §21                    | Schema (`custom_field_def` e `custom_field_value`), configuração de obrigatoriedade dos campos padrão pela liderança, criação de campos personalizados (texto, número, seleção, booleano, data) e preenchimento em `/perfil` e ficha. | Ativar via flag `campos_personalizados` (já existe no catálogo de `src/lib/server/bootstrap/catalogo.ts` como `false`).                         |
| **Consentimento parental LGPD completo**    | §11, ADR 0003 (RN-30–RN-35) | Tabela `consent`, registro por categoria (`dados_cadastrais`, `foto`, `compartilhamento_externo`, `uso_ia`), UI na ficha `/pessoas/[id]` e rotina transacional de exclusão/anonimização ao revogar consentimento.                     | Cuidar das cascatas permitidas pelos gatilhos de históricos append-only e limpeza de `file_asset` vinculados a foto quando revogado.            |
| **Estágios de caminhada configuráveis**     | §10                         | Substituir a `CHECK` constraint rígida (`visitante`, `recorrente`, `membro`) em `person_profile` (`0002_modulos_02_06.sql`) por tabela configurável de estágios (ordem, cor, promoção e papel padrão) editável em `/admin`.           | Migração SQL deve preservar os 3 estágios atuais sem quebrar histórico nem rotas existentes.                                                    |
| **Anúncios direcionados por papel RBAC**    | §15                         | Expandir `audience_scope` em `announcement` (`0004_modulo_08_comunicacao.sql`, hoje `'all' \| 'group' \| 'status'`) para incluir `'role'`, permitindo publicar avisos apenas para determinados papéis (ex.: Conselheiros, Líderes).   | Validar no servidor quem pertence ao papel alvo para não vazar anúncios restritos no feed nem nas notificações.                                 |
| **Seção "Minha frequência" em `/perfil`**   | §9, `README.md`             | Exibir no próprio perfil do membro/usuário seu resumo e histórico recente de presença em PGs e encontros.                                                                                                                             | A API (`GET /api/frequencia/pessoa/[id]`) já existe; requer apenas integração na tela `src/routes/perfil/+page.svelte` respeitando RBAC `self`. |

### Critérios de aceite sugeridos para fechar a Onda 3

- `custom_field_*` bloqueado quando `campos_personalizados = false` e auditado em `audit_log` quando alterado.
- Revogação de consentimento LGPD remove imediatamente dados/mídias cobertos nos testes PGlite sem violar integridade referencial.
- Migração de estágios mantém compatibilidade com `visitante` / `recorrente` / `membro` existentes.
- Testes automatizados cobrindo permissões (`rotas-declaram-permissao.test.ts`), schema vs. migrações (`migracoes-batem-com-schema.test.ts`), `svelte-check` e builds SPA/API.

---

## 3. Onda 4 — Recorrência de Agenda, Ações de Ata, Aprovação Financeira e IA Conversacional

| Item                                             | Origem (`ESCOPO.md`) | O que precisa ser construído                                                                                                                                                                   | Dependências e notas técnicas                                                                                                |
| ------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Eventos e PGs recorrentes (RRULE)**            | §8                   | Suporte a séries (`semanal`, `quinzenal`, `mensal`) na criação de eventos/PGs, edição ou cancelamento de uma ocorrência vs. série futura, sem perder histórico de RSVP de datas passadas.      | Recomenda-se materializar ocorrências futuras em janela controlada ou vincular por `series_id` para manter chamadas simples. |
| **Tarefas / ações extraídas de atas**            | §20 (Reuniões)       | Evoluir o resumo de atas do assistente para criar e acompanhar itens de ação (responsável, prazo, status aberto/concluído e vínculo com evento ou subgrupo).                                   | Depende apenas de nova tabela simples de tarefas e endpoints protegidos por `authorize()`.                                   |
| **IA com perguntas abertas sob RBAC estrito**    | §20 (Administração)  | Consulta em linguagem natural no `/assistente` restrita estritamente ao escopo do usuário (`policy.ts`), com provedor LLM externo opcional por variável de ambiente e fallback determinístico. | Garantir pseudonimização antes de qualquer envio externo (quando configurado) e nunca expor dados fora do escopo RBAC.       |
| **Aprovação configurável de despesas em etapas** | §16                  | Fluxo opcional e configurável em múltiplos níveis (`Membro → Conselheiro → Líder`) antes da efetivação/aprovação da despesa no livro-caixa.                                                    | Respeitar os gatilhos de imutabilidade de `finance_transaction` (centavos inteiros e estorno único).                         |
| **Chamada rápida com busca na equipe toda**      | §9, `README.md`      | Campo de busca instantânea e filtro por subgrupo na tela de chamada de eventos grandes (retiros, cultos ou PGs com muitos visitantes).                                                         | Melhoria focada em frontend (`/frequencia` e `/eventos/[id]`) sem mudança estrutural obrigatória de banco.                   |

---

## 4. Infraestrutura, Operação, Design e Qualidade Contínua (Externos / Pós-Onda)

Estes itens dependem de serviços externos, decisões operacionais ou validação presencial em piloto — podem ser executados independentemente da Onda 3 ou Onda 4:

1. **Destino externo de backup na VPS (`DEPLOY.md` §7.1 / `deploy/backup/backup.sh`):**
   - Atualmente o backup diário já executa `pg_dump`, valida restaurando em `eagles_verificacao_backup` e criptografa em GPG AES-256, mas falha intencionalmente ao final por ausência de destino externo.
   - Falta cadastrar na VPS (Easypanel) as variáveis de **Backblaze B2** (`BACKUP_B2_*`) **ou** `BACKUP_RCLONE_CONF` + `BACKUP_DESTINO`.
2. **Domínio próprio substituindo `sslip.io` (`DEPLOY.md` §6):**
   - Opcional; atualizar DNS, `PUBLIC_API_URL`, `ORIGIN` e configuração do proxy quando houver domínio definitivo.
3. **Marca e ícones vetoriais (SVG) (`DESIGN.md` / `README.md`):**
   - Substituir as exportações derivadas do JPEG `Eagles.png` (640 px) por versão vetorial SVG nítida em cabeçalho, favicon e ícones PWA.
4. **Suíte E2E (Playwright), auditoria WCAG e piloto real (`README.md` / `docs/adr/0002-escopo-mvp.md`):**
   - Automatizar fluxos críticos ponta a ponta (`npm run test:e2e`) e auditoria automática de contraste WCAG AA.
   - Validar calibração de regras e usabilidade com dados reais durante o piloto de 3 semanas em um PG.

---

## 5. Lembrete operacional dos commits locais atuais

Ao encerrar na **Onda 2**, o branch `main` possui **3 commits locais** à frente de `origin/main` (`b0c4402` Draft, `4fa0cbf` Onda 1 e `1906502` Onda 2, além do commit de documentação). Como existem novas migrações SQL (`0013`, `0014` e `0015`), ao publicar em produção siga a ordem do [`DEPLOY.md`](../DEPLOY.md):

1. Subir primeiro a **API na VPS (Easypanel)** para aplicar as migrações no boot;
2. Subir em seguida o **SPA estático no Firebase Hosting** (`npm run deploy:firebase`).
