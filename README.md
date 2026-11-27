# Eagles App

Plataforma de gestão interna dos Eagles: pessoas, subgrupos, PGs (Pequenos Grupos) e eventos,
responsabilidades, presença e frequência, comunicação, financeiro e apoio de IA — o ano inteiro.

**Stack:** SvelteKit 2 (Svelte 5) · TypeScript · PostgreSQL 16 · Drizzle ORM · PWA · Capacitor (Android)

**Produção no ar:**

- **App (PWA / SPA):** https://eagles-app-pg.web.app (Firebase Hosting)
- **API (HTTPS):** https://api.164-152-195-199.sslip.io (VPS Oracle · Easypanel Compose + Caddy + PostgreSQL 16 + backup diário criptografado)

```
Navegador / PWA / APK ──HTTPS──▶ Firebase Hosting        (SPA estático: npm run build)
        └──────────────HTTPS──▶ Caddy → API Node na VPS  (npm run build:api, via Easypanel)
                                            └──▶ PostgreSQL 16 + backup diário criptografado
```

O mesmo código gera os dois alvos: o SPA chama a API por `fetch` com JWT, e o JWT
é sempre conferido contra a sessão no banco (sair e desconectar aparelhos valem na hora).
Como publicar e operar: [`DEPLOY.md`](DEPLOY.md).

---

## Estado atual do projeto

> Conferido na revisão atual (`27/11/2026` — Onda 2): **78** arquivos de rota da API, **28** telas SPA, **16** migrações SQL (`0000`–`0015`), **45** tabelas no schema e **41** suítes de testes automatizados (**27** integração PGlite + **14** unidade).

| Módulo                          | Situação                           | Entregas principais                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M01 — Fundação**              | Em produção                        | Autenticação por convite + senha Argon2id, JWT conferido em sessão revogável no banco, bloqueio progressivo, rate limit pré-hash, PWA, cache offline IndexedDB (limpo no logout), prévia WhatsApp (OG), dashboard inicial por papel (`/inicio`) e navegação desktop/mobile                                                                                                          |
| **M02 — Pessoas e Draft**       | Em produção (Ciclo 2 + Draft)      | Cadastro progressivo, perfil próprio com foto, ficha `/pessoas/[id]`, caminhada (`visitante` → `recorrente` → `membro`) com troca automática de acesso e histórico, regras de menores 16–17 anos (ADR 0003), perfil de atributos em 4 eixos (Físico, Bíblico, Mental, Coordenação Motora · 0–10 + medidas opcionais) e tela `/draft` com comparativo radar e balanceamento de times |
| **M03 — RBAC**                  | Em produção                        | Ponto único de autorização (`policy.ts`), papéis configuráveis com escopo (`global` / `group` / `self`), Master invisível, até 2 líderes com mandato de 2 anos (`/lideranca`) e conselheiros com atuação global na equipe                                                                                                                                                           |
| **M04 — Subgrupos**             | Em produção (Ciclo 3)              | Criação, edição, arquivamento/reativação pelo líder, transferência individual ou em lote com histórico imutável (`group_member_history`) e chegadas/saídas                                                                                                                                                                                                                          |
| **M05 — Eventos e PGs**         | Em produção (Ciclo 1 + Onda 2)     | Tipo padrão **PG (Pequeno Grupo)** criado de fábrica, filtro por tipo na agenda, tipos configuráveis com cor/desativação, criação/edição/cancelamento preservando respostas, opções de RSVP configuráveis, anexos seguros (magic bytes / 3 MB) e compartilhamento                                                                                                                   |
| **M06 — Presença e Frequência** | Em produção (Ciclo 4 + Onda 1)     | Histórico append-only de RSVP (`rsvp_history`), chamada completa nos PGs (todos os membros ativos + visitantes que responderam) e em encontros de subgrupo, check-in por QR Code opcional com UI completa em `/eventos/[id]`, tela `/frequencia` e ficha da pessoa                                                                                                                  |
| **M07 — Responsabilidades**     | Em produção (Onda 2)               | Tipos configuráveis com intervalo mínimo, escala manual e geração determinística em modo proposta → revisão → confirmação (ponderando RSVP e frequência de 90d), sugestão dos top 3 substitutos e histórico de trocas                                                                                                                                                               |
| **M08 — Comunicação**           | Em produção (Onda 1)               | Anúncios internos por público, modelos reutilizáveis com variáveis prontos para WhatsApp, motor de notificações internas + lembretes agendados (`/notificacoes`), suporte a Web Push e preferências com janela de silêncio (`22h–7h`)                                                                                                                                               |
| **M09 — Financeiro**            | Em produção (Onda 2)               | Livro-caixa imutável em centavos inteiros (estorno único, gatilho no banco), regras de contribuição vs. doação, filtros completos (período, tipo, categoria, responsável, evento e subgrupo), comprovantes reais, aprovação opcional de despesas, visibilidade por escopo e exportação CSV filtrada                                                                                 |
| **M10 — Assistente de IA**      | Em produção (desligado por padrão) | Motor determinístico (custo zero) sob flag `ia_assistente`, redação de avisos, resumo de ata/tarefas, sinais de atenção, divisão de grupos com critérios de família/casal, idade e frequência, confirmação humana obrigatória (RN-27) e pseudonimização de menores                                                                                                                  |
| **M11 — Administração**         | Em produção                        | Chaves de funcionalidade (nascem desligadas), gestão de papéis e atribuições por escopo, trilha de auditoria imutável (`audit_log`)                                                                                                                                                                                                                                                 |

---

## Documentação

| Documento                                                                        | Para quê                                                                                                   |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`DEPLOY.md`](DEPLOY.md)                                                         | Topologia em produção, Firebase Hosting, Easypanel + Caddy, primeiro acesso (Master + 2 líderes) e backups |
| [`PRODUCT.md`](PRODUCT.md)                                                       | Personas, princípios do produto, fronteiras de escopo e acessibilidade                                     |
| [`DESIGN.md`](DESIGN.md)                                                         | Tokens de cor (WCAG AA), tipografia, espaçamento, moldura de navegação e regras visuais                    |
| [`docs/00-descoberta-e-arquitetura.md`](docs/00-descoberta-e-arquitetura.md)     | Requisitos, regras de negócio, modelo de dados, RBAC, riscos e arquitetura base                            |
| [`docs/01-modulo-01-fundacao.md`](docs/01-modulo-01-fundacao.md)                 | Fundação (M01) e critérios de aceitação                                                                    |
| [`docs/05-modulo-05-eventos-ciclo-1.md`](docs/05-modulo-05-eventos-ciclo-1.md)   | Ciclo 1 — Criar, editar, cancelar e reativar eventos e tipos de evento                                     |
| [`docs/02-modulo-02-pessoas-ciclo-2.md`](docs/02-modulo-02-pessoas-ciclo-2.md)   | Ciclo 2 — Editar pessoa, estágios na caminhada, histórico e regra de menores                               |
| [`docs/04-modulo-04-grupos-ciclo-3.md`](docs/04-modulo-04-grupos-ciclo-3.md)     | Ciclo 3 — Editar/arquivar PGs e transferir pessoas com histórico                                           |
| [`docs/06-modulo-06-presenca-ciclo-4.md`](docs/06-modulo-06-presenca-ciclo-4.md) | Ciclo 4 — Histórico de RSVP, chamada completa e relatórios de frequência                                   |
| [`docs/07-roadmap-proximas-ondas.md`](docs/07-roadmap-proximas-ondas.md)         | Fechamento na Onda 2 e roadmap detalhado do que falta nas próximas ondas (Ondas 3, 4 e Infraestrutura)     |
| [`docs/adr/`](docs/adr/)                                                         | ADRs 0001–0004 (stack, escopo MVP, dados de menores, autenticação) com notas de evolução                   |

---

## Rodar localmente

Requisitos: **Node 22+** e **Docker** (só para o banco).

```bash
npm install
cp .env.example .env                                   # já vem pronto para o banco local

docker compose -f deploy/docker-compose.dev.yml up -d  # PostgreSQL 16 em localhost:5432

npm run db:migrate                                     # aplica as migrações (0000–0015)
npm run db:seed                                        # dados de exemplo (pode repetir)
npm run dev                                            # http://localhost:5173
```

Em desenvolvimento a API roda dentro do próprio `npm run dev` (mesma origem),
então não há nada mais para subir.

Contas criadas pela semeadura — senha `eagles-desenvolvimento`:

| Conta                  | Papel                                        |
| ---------------------- | -------------------------------------------- |
| `dev@eagles.local`     | Master (o desenvolvedor; invisível à equipe) |
| `ana@eagles.local`     | Líder, com mandato de 2 anos                 |
| `bruno@eagles.local`   | Líder, com mandato de 2 anos                 |
| `pedro@eagles.local`   | Conselheiro (equipe toda · Subgrupo A)       |
| `marina@eagles.local`  | Conselheira (equipe toda · Subgrupo B)       |
| `joao@eagles.local`    | Membro (Subgrupo A)                          |
| `leticia@eagles.local` | Membro (Subgrupo B)                          |

A semeadura também imprime um **link de convite** (Rafael Monteiro, que entra
pelo telefone) para testar o caminho real de entrada.

### Sem Docker?

Os testes rodam mesmo assim. Eles usam **PGlite** — o próprio PostgreSQL
compilado para WebAssembly, em memória. Mesmas migrações, mesmos gatilhos,
mesmas constraints, sem serviço nenhum na máquina:

```bash
npm test
```

Para abrir a aplicação no navegador, aí sim é preciso um Postgres acessível.

---

## Comandos

| Comando                   | O que faz                                                       |
| ------------------------- | --------------------------------------------------------------- |
| `npm run dev`             | App + API locais em http://localhost:5173                       |
| `npm test`                | Testes de unidade e integração (PGlite, sem Docker)             |
| `npm run check`           | Verificação de tipos (`svelte-check`)                           |
| `npm run format`          | Formata o código (o CI exige `npm run format:check`)            |
| `npm run build`           | SPA estático para o Firebase (exige `.env.production`)          |
| `npm run build:api`       | Servidor Node da API (o que a imagem Docker da VPS roda)        |
| `npm run deploy:firebase` | Build do SPA + publicação no Firebase Hosting (`eagles-app-pg`) |
| `npm run db:generate`     | Gera migração a partir do schema                                |
| `npm run db:migrate`      | Aplica migrações pendentes (lê o `.env`)                        |
| `npm run db:seed`         | Semeia o ambiente de desenvolvimento (lê o `.env`; nunca prod)  |

Antes de enviar mudanças, rode o que o CI roda:
`npm run format:check && npm run check && npm test && npm run build && npm run build:api`.

---

## Organização

```
docker-compose.yml       compose de produção (raiz, para leitura do .env pelo Easypanel)
firebase.json            hosting SPA, cache do Service Worker e cabeçalhos de segurança
.env.production          configuração PÚBLICA do SPA (PUBLIC_API_URL e PUBLIC_SITE_URL)
src/
├── lib/
│   ├── server/          código que NUNCA vai para o navegador
│   │   ├── db/          schema (45 tabelas), migrações (0000–0015), conexão
│   │   ├── auth/        senha, sessão, JWT, convite, bloqueio, rate limit, e-mail
│   │   ├── policy/      autorização — o ponto único de decisão
│   │   ├── lideranca/   Master, os 2 líderes e seus mandatos
│   │   ├── bootstrap/   catálogo (inclui tipo PG), primeiro acesso (Master), semente de dev
│   │   ├── pessoas/     alvo, jornada (estágios), regras de menores, contato
│   │   ├── draft/       atributos de perfil (4 eixos 0–10 + medidas) e balanceador determinístico
│   │   ├── grupos/      transferência de subgrupo com histórico imutável
│   │   ├── eventos/     regras de criação, edição, cancelamento e tipos
│   │   ├── presenca/    cálculo de frequência (PGs da equipe, subgrupos, pessoa e mês)
│   │   ├── responsabilidades/ gerador determinístico de escalas
│   │   ├── comunicacao/ renderização de modelos WhatsApp e janela de silêncio
│   │   ├── financeiro/  cálculos em centavos inteiros
│   │   ├── ia/          motor determinístico com pseudonimização LGPD
│   │   ├── admin/       catálogo de feature flags
│   │   ├── audit/       registro imutável
│   │   ├── manutencao.ts limpeza periódica (sessões, links, rate limit)
│   │   └── env.ts       variáveis validadas na subida
│   ├── cache/           cache offline IndexedDB e sincronização (limpo no logout)
│   ├── eventos/         formulário e validação de eventos
│   ├── pessoas/         visualização e editor do perfil de atributos (Draft)
│   ├── ui/              design system (Moldura, PainelEntrada, GraficoMensal, RadarAtributos, Botao, Campo, Marca…)
│   ├── styles/          tokens WCAG AA, tema claro e escuro, fonte Archivo
│   ├── shared/          utilitários compartilhados (senha, telefone, opções RSVP, atributos/Draft)
│   ├── navegacao.ts     menu lateral desktop e barra inferior mobile por permissão
│   ├── sessao.svelte.ts estado global da sessão no SPA
│   └── api.ts           cliente da API usado pelas telas
├── routes/
│   ├── api/             78 arquivos de rota da API (só no build da API e no dev)
│   └── …                28 telas do SPA
└── hooks.server.ts      CORS, cabeçalhos de segurança, manutenção
deploy/                  Dockerfile da API, backup diário, primeiro-master.ts, compose dev
tests/                   41 arquivos de teste (27 integração PGlite + 14 unidade)
docs/                    arquitetura, ciclos de entrega e ADRs
infra/                   LEGADO (stack do M01 com Caddy) — não usada
```

O SvelteKit **impede** que `lib/server` seja importado por código de cliente.
Se um import quebrar o build por causa disso, a proteção funcionou.

---

## Regras que este projeto leva a sério

**Negação por padrão.** Toda rota de servidor declara sua permissão. Uma rota
sem `authorize()` nem `can()` **falha no teste** — veja
[`tests/unit/rotas-declaram-permissao.test.ts`](tests/unit/rotas-declaram-permissao.test.ts).
Tornar uma rota pública exige entrar numa lista explícita, com o motivo.

**Autorização é do servidor.** A interface apenas esconde o que o servidor já
proíbe. Existe **um** ponto de decisão: `src/lib/server/policy/policy.ts`.

**Permissão tem escopo.** O motor RBAC suporta escopos `global`, `group` (subgrupo) e `self`.
Conselheiros atuam em escopo `global` na equipe (abaixo dos 2 líderes), enquanto papéis
personalizados podem ser restritos a um subgrupo específico. Ambiguidade resolve-se negando.

**Topo do acesso fechado.** Acima de todos, o Master (o desenvolvedor),
invisível para a equipe. Abaixo, no máximo **2 líderes**, com mandato de 2
anos — garantido também por gatilho no banco. Ninguém mais distribui
permissões.

**Históricos e auditoria são append-only.** Gatilhos no banco recusam `UPDATE` e
`DELETE` direto em `audit_log`, `finance_transaction`, `group_member_history` e
`rsvp_history` (permitindo apenas exclusão em cascata nos dois históricos quando
necessário pela LGPD).

**Funcionalidades de controle nascem desligadas.** Check-in por QR Code,
aprovação de despesas, notificações, assistente de IA e campos personalizados:
todas `false` na instalação.

**Rate limit antes do hash, bloqueio no banco.** O Argon2id custa ~610 ms de
CPU, então o limite por IP e por conta roda antes. Senha errada 5 vezes
bloqueia a conta, com tempo que dobra a cada vez — gravado no banco, sobrevive
a reinícios.

**Backup só conta se restaura.** Todo backup diário é restaurado num banco
descartável e conferido antes de ser criptografado e enviado para fora da VPS.

---

## Pendências conhecidas (próximas ondas e pós-piloto)

Veja o detalhamento completo por onda e critérios de aceite em [`docs/07-roadmap-proximas-ondas.md`](docs/07-roadmap-proximas-ondas.md):

- **Onda 3:** campos personalizados (`custom_field_*`), consentimento parental LGPD (`consent`), estágios configuráveis no banco, anúncios direcionados por papel RBAC e seção "Minha frequência" em `/perfil`
- **Onda 4:** eventos recorrentes (RRULE), lista de ações extraídas de atas, perguntas abertas na IA sob RBAC, fluxo configurável de aprovação de despesas e chamada rápida com busca para eventos da equipe toda
- **Operação / Infra:** configurar destino externo do backup diário na VPS (`BACKUP_B2_*` ou `BACKUP_RCLONE_CONF` + `BACKUP_DESTINO`), domínio próprio opcional substituindo `sslip.io`, logo em SVG vetorial, suíte Playwright/WCAG automatizada e conferência no piloto de um PG
