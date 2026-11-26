# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Conselheiros (operadores centrais, escopo `group`):** responsáveis semanais por um ou mais PGs (rotinas de 10–20 min; meta de fechar a semana do PG em menos de 3 min). Acompanham os participantes e sinais de afastamento, registram presença efetiva, organizam responsabilidades/escalas, lançam despesas simples do grupo e compartilham avisos prontos no WhatsApp. O sucesso operacional do produto depende do uso semanal consistente dos conselheiros.
- **Membros Eagles (maior volume, escopo `self` + leitura do próprio grupo):** jovens da comunidade acessando pelo celular (1–3×/semana), muitas vezes em salões ou ambientes com sinal móvel fraco. Precisam ver o próximo encontro, confirmar presença (RSVP) em 1 toque, consultar responsabilidades próprias, ver seu PG e acompanhar as próprias contribuições financeiras, sem login complicado, formulários longos ou excesso de notificações.
- **Líderes e Administradores (1–5 pessoas, escopo `global`):** acompanham o panorama da comunidade, saúde dos grupos, indicadores de cuidado pastoral, propostas de reorganização periódica de PGs, transparência financeira/prestação de contas, chaves de funcionalidade, tipos configuráveis e auditoria.
- **Visitantes e Participantes Recorrentes (porta de entrada, com ou sem conta):** primeiro contato rápido (~15 s, apenas nome obrigatório internamente ou formulário público enxuto condicionado à idade) sem sensação de fichamento e sem obrigação de instalar o app ou criar conta para participar.
- **Anti-persona explícita ("o fiscal"):** o produto rejeita por construção qualquer uso de frequência ou check-in para ranquear, cobrar publicamente ou constranger pares — sem ranking público de presença e sem exposição de faltas entre membros; dados de frequência servem apenas a quem tem responsabilidade pastoral autorizada.

## Product Purpose

Plataforma interna usada durante todo o ano pelos Eagles para organizar pessoas (jornada Visitante → Participante recorrente → Membro), grupos (PGs), encontros recorrentes e eventos, presença (RSVP vs. presença efetiva), responsabilidades/escalas e, nas fases seguintes, comunicação e livro-caixa transparente.

Existe para substituir controles dispersos (grupos de WhatsApp, cadernos, planilhas soltas e memória individual) por uma fonte única de verdade que preserve a memória organizacional entre gestões, reduza trabalho manual repetitivo e ajude líderes e conselheiros a enxergarem pessoas a tempo — sem substituir a convivência humana nem burocratizar os PGs.

Sucesso significa conselheiros fechando a semana do PG em poucos minutos, membros respondendo RSVP sem cobrança manual, zero sensação de vigilância na comunidade e liderança dedicando menos tempo à logística e mais tempo às pessoas.

## Positioning

- **Ferramenta de apoio à liderança, nunca substituta de decisão humana:** toda automação relevante (divisão de grupos, escalas, alertas de participação) segue obrigatoriamente o fluxo _sugerir → revisar → confirmar → aplicar_, com cálculo determinístico primeiro e explicação auditável; nada é aplicado nem comunicado automaticamente.
- **Convivência nativa com o WhatsApp, sem competir com ele:** a conversa diária permanece no WhatsApp; o app estrutura a informação e gera mensagens formatadas prontas para compartilhamento (`wa.me` / Web Share) com links diretos, descartando chat interno, mural social ou gamificação.
- **Anti-burocracia por padrão:** todas as funcionalidades de controle (`checkin_qrcode`, `aprovacao_despesas`, `notificacoes_push`, `ia_assistente`, `campos_personalizados`) nascem desligadas (`false`) na instalação, e o app nunca é condição para alguém participar de um encontro.
- **Fronteira clara de escopo:** gere a rotina anual da equipe Eagles; registra a participação dos Eagles em compromissos externos do calendário (como o _Outside_), mas não organiza o _Outside_ nem decide a alocação em outras equipes do contexto maior (_Bears_, _Tigers_, _Sheeps_).

## Operating Context

- Encontros presenciais semanais de PGs e eventos ao longo do ano, frequentemente em salões ou residências com rede móvel instável.
- Comunidade jovem articulada por WhatsApp: convites de primeiro acesso chegam como links únicos pelo WhatsApp (muitos membros não usam e-mail no dia a dia), assim como avisos de encontros, escalas e prestações de contas.
- Acesso mobile-first como PWA instalável na tela de início em Android e iPhone (no iOS 16.4+, a instalação na tela de início via Safari é requisito para Web Push, tratada com orientação dedicada).
- Organização estruturada em dois eixos independentes: **autoridade** (Líder, Conselheiro, Membro, Visitante) e **pertencimento** (no máximo um PG ativo por pessoa por vez, com reorganizações ao longo do ano preservando o histórico de vínculos).

## Capabilities and Constraints

- **Arquitetura e ciclo de entregas aprovados (ADR 0001, ADR 0002):**
  - Monólito modular em SvelteKit 2 (Svelte 5) + TypeScript estrito + PostgreSQL 16 + Drizzle ORM, previsto para rodar em VPS via Docker Compose + Caddy.
  - **M01 (Fundação) implementado:** migrações iniciais, acesso por convite de uso único + senha Argon2id com rate limit pré-hash, sessões server-side revogáveis de 30 dias (sem JWT), ponto único de autorização (`src/lib/server/policy/policy.ts`), `audit_log` append-only garantido por gatilho no banco, chaves de funcionalidade desligadas por padrão, PWA e rotas iniciais (`/entrar`, `/convite/[token]`, `/inicio`, `/conta/sessoes`, `/sair`).
  - **Escopo do MVP (~10 semanas, lançamento piloto em 1 PG por 3 semanas):** M01 Fundação, M02 Pessoas, M03 RBAC completo, M04 Grupos/PGs, M05 Eventos (recorrência RRULE com materialização parcial) e M06 Presença + botão de compartilhamento no WhatsApp.
  - **Roadmap pós-MVP:** V1.1 (M07 Responsabilidades + M08 Comunicação + redação assistida de mensagens), V1.2 (M09 Financeiro como livro-caixa em centavos inteiros, imutável via estorno), V2.0 (M10 IA completa sobre histórico acumulado, com pseudonimização server-side antes de qualquer envio externo).
- **Regras invariantes de domínio e engenharia:**
  - Pessoa (`person`) existe sem conta de acesso (`user_account`); apenas `full_name` é obrigatório em nível de sistema.
  - Tipos de evento, opções de RSVP, tipos de responsabilidade, estágios da jornada, categorias financeiras e papéis/permissões são dados configuráveis no banco, não constantes fixas em código.
  - RSVP (versionado) e presença efetiva são registros separados; ausência de resposta no RSVP jamais conta como falta.
  - Negação por padrão no servidor: toda rota declara permissão (garantido por teste automatizado em `tests/unit/rotas-declaram-permissao.test.ts`); nenhuma regra de negócio reside em componentes de tela.
  - Progressive enhancement real (form actions operam sem JavaScript), JS de entrada < 100 KB comprimido, leitura offline em cache e escrita offline limitada à fila futura de RSVP/presença (finanças e permissões nunca operam offline).
  - Uploads futuros exigem validação de magic bytes, reprocessamento no servidor com remoção de EXIF/GPS e armazenamento fora do diretório público.
  - Coluna `team_id` presente nas tabelas raiz desde o M01 (registro único `"Eagles"`, sem interface multi-equipe).
- **Privacidade e dados de menores (LGPD art. 14 — ADR 0003):**
  - Não há menores nos Eagles hoje; o piso de idade daqui em diante é **16 anos** (sem regime de criança < 12).
  - `is_minor` é calculado em view (`person_view`) a partir de `birth_date`, tratando `NULL` sob regime restrito; estrutura de `consent` append-only pronta e inativa enquanto não houver menor cadastrado; fotos exigem consentimento explícito em qualquer idade; compartilhamentos no WhatsApp nunca incluem contato ou foto de menor.
- **Terminologia confirmada (pt-BR):** _PG_, _Conselheiro_, _Líder_, _Membro_, _Visitante_, _Participante recorrente_, _Escala_, _Prestação de contas_, _Outside_.
- **Decisões em aberto (não presumir nem inventar):**
  - `D-06`: domínio definitivo de produção (bloqueia HTTPS público, instalação PWA em produção e Web Push).
  - `D-07.1`: quantidade real atual de membros/visitantes e de PGs ativos (o teto arquitetural considera até 500 pessoas e 20 PGs como hipótese de escala, mas os números reais atuais seguem abertos).
  - `D-07.2`: especificações confirmadas da VPS de produção (vCPU, RAM, disco e sistema operacional).
  - `D-07.3` / `D-07.4`: definição nominal de quem administra o sistema no dia a dia e periodicidade exata de reorganização dos PGs.
  - `D-07.5`: consolidação final do nome oficial entre `"Eagles"` (usado no manifesto PWA e cabeçalho) e `"Eagles App"` (usado na documentação e repositório).
  - `D-05`: escolha final do modelo padrão de LLM e teto mensal antes da entrada dos recursos de IA (V1.1/V2.0).

## Brand Commitments

- **Identificação atual:** _Eagles_ na interface do produto e no manifesto PWA (`static/manifest.webmanifest`); _Eagles App_ na documentação técnica e repositório (`D-07.5` permanece em aberto).
- **Voz e tom (pt-BR):** linguagem humana, clara, acolhedora e direta — nunca jargão técnico, tom policialesco ou mensagens genéricas de sistema. Estados vazios explicam o contexto real e erros orientam sempre o que aconteceu e como resolver.
- **Ativos de marca:** emblema oficial da águia em `Eagles.png` / `docs/brand/Eagles.png` e ícones de aplicativo em `static/` (`icone-192.png`, `icone-512.png`, `apple-touch-icon.png`, `favicon.png`), acompanhados da silhueta vetorial simplificada em `src/lib/ui/Marca.svelte` enquanto a arte vetorial/transparente oficial permanece pendente.

## Evidence on Hand

- **Documentação arquitetural e ADRs:** `docs/00-descoberta-e-arquitetura.md`, `docs/01-modulo-01-fundacao.md` e `docs/adr/0001-stack.md` a `docs/adr/0004-autenticacao.md`.
- **Base implementada (M01):** autenticação por convite, sessões, política RBAC, auditoria, tokens/componentes base e suíte de testes unitários/integração (`src/`, `tests/`).
- **Ausências explícitas (não fabricar em telas ou textos):** `seed/seed.ts` contém apenas 10 pessoas fictícias e 2 PGs de exemplo para desenvolvimento. Não há dados reais de membros, histórico real de presença, movimentações financeiras reais, métricas de adoção medidas, depoimentos nem versão vetorial/transparente da logo `Eagles.png`.

## Product Principles

1. **Cuidado com pessoas acima de controle:** toda funcionalidade deve devolver tempo à liderança e ajudar a perceber quem precisa de atenção, nunca vigiar, ranquear ou burocratizar a vida dos PGs; controles nascem desligados e ninguém depende do app para participar.
2. **Automação propõe, liderança decide:** algoritmos determinísticos e IA futura preparam sugestões auditáveis, mas escalas, reorganizações de grupos e ações sensíveis exigem sempre revisão e confirmação humana explícita.
3. **Utilidade imediata no celular e simbiose com o WhatsApp:** cada tela precisa justificar sua abertura em uma frase mesmo em rede fraca, entregando ações de poucos toques e mensagens prontas para circular no WhatsApp.
4. **Confiança e privacidade por construção:** autorização negada por padrão no servidor, sessões revogáveis, regime restrito na dúvida sobre idade/consentimento e trilha imutável de auditoria para permissões e finanças.
5. **Comunidade configurável sem depender de código:** tipos, estágios, papéis, permissões e chaves de funcionalidade são dados persistidos para acompanhar a evolução dos ritos da organização sem novos deploys.

## Accessibility & Inclusion

- **Padrão obrigatório (RNF-12, RNF-01):** conformidade **WCAG 2.1 AA** nas telas do produto — contraste mínimo de 4,5:1 em tema claro e escuro, navegação integral por teclado, foco visível e rótulos explícitos em formulários.
- **Sem dependência exclusiva de cor:** nenhum estado, aviso, erro de validação ou ação destrutiva é transmitido apenas por cor; texto claro e/ou ícone acompanham sempre o sinal visual.
- **Acesso móvel, baixa conectividade e inclusão sem app:** 100% das telas usáveis em **360 px** de largura, alvos de toque mínimos de **44 × 44 px**, formulários funcionais mesmo sem JavaScript ativo e fluxos que permitem cadastrar e registrar presença de participantes que não têm conta ou celular disponível.
