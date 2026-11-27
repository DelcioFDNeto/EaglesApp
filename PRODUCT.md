# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (PWA instalável + empacotamento Android via Capacitor)

## Users

- **Conselheiros (operadores centrais, escopo `global` abaixo dos líderes):** responsáveis pela rotina operacional dos Eagles e dos PGs (reuniões periódicas de mensagem bíblica, comida e confraternização). Acompanham os membros ativos e sinais de afastamento, registram chamada completa e frequência dos PGs, movem pessoas entre `visitante` e `recorrente`, organizam subgrupos e escalas, lançam movimentações simples e compartilham avisos prontos no WhatsApp. O sucesso operacional do produto depende do uso semanal consistente dos conselheiros.
- **Membros Eagles (maior volume, escopo `self` + leitura de subgrupos):** jovens da comunidade acessando pelo celular (1–3×/semana), muitas vezes em salões ou ambientes com sinal móvel fraco. Precisam ver o próximo PG ou evento, confirmar presença (RSVP) em 1 toque, consultar responsabilidades próprias, ver os subgrupos e acompanhar as próprias contribuições financeiras, sem login complicado, formulários longos ou excesso de notificações.
- **Líderes (no máximo 2, mandato de 2 anos, escopo `global`):** acompanham o panorama da comunidade, frequência dos PGs e subgrupos, indicadores de cuidado pastoral, entrada/saída formal de `membro Eagles`, criação/arquivamento de subgrupos, transparência financeira/prestação de contas, chaves de funcionalidade, tipos configuráveis e auditoria.
- **Master (desenvolvedor, invisível à equipe):** acima dos líderes, usado apenas para instalação inicial, nomeação inicial e manutenção técnica/emergências; nunca aparece em listas de pessoas, subgrupos, escalas ou relatórios.
- **Visitantes e Participantes Recorrentes (porta de entrada, com ou sem conta):** primeiro contato rápido (apenas nome obrigatório internamente) sem sensação de fichamento e sem obrigação de instalar o app ou criar conta para participar de um PG.
- **Anti-persona explícita ("o fiscal"):** o produto rejeita por construção qualquer uso de frequência ou check-in para ranquear, cobrar publicamente ou constranger pares — pessoas sempre em ordem alfabética, sem ranking público de presença e sem exposição de faltas entre membros; dados de frequência servem apenas à própria pessoa e a quem tem responsabilidade pastoral autorizada.

## Product Purpose

Plataforma interna usada durante todo o ano pelos Eagles para organizar pessoas (jornada `Visitante` → `Participante recorrente` → `Membro Eagles`), subgrupos, PGs (Pequenos Grupos — reuniões de mensagem bíblica, comida e confraternização) e demais eventos, presença e frequência (RSVP versionado vs. chamada efetiva sobre membros ativos), responsabilidades/escalas, comunicação integrada ao WhatsApp, livro-caixa transparente e apoio assistivo de IA (desligado por padrão).

Existe para substituir controles dispersos (grupos de WhatsApp, cadernos, planilhas soltas e memória individual) por uma fonte única de verdade que preserve a memória organizacional entre gestões, reduza trabalho manual repetitivo e ajude líderes e conselheiros a enxergarem pessoas a tempo — sem substituir a convivência humana nem burocratizar os PGs.

Sucesso significa conselheiros fechando a semana do PG em poucos minutos, membros respondendo RSVP sem cobrança manual, zero sensação de vigilância na comunidade e liderança dedicando menos tempo à logística e mais tempo às pessoas.

## Positioning

- **Ferramenta de apoio à liderança, nunca substituta de decisão humana:** toda automação relevante (divisão de grupos, escalas, alertas de participação) segue obrigatoriamente o fluxo _sugerir → revisar → confirmar → aplicar_, com cálculo determinístico primeiro e explicação auditável; nada é aplicado nem comunicado automaticamente.
- **Convivência nativa com o WhatsApp, sem competir com ele:** a conversa diária permanece no WhatsApp; o app estrutura a informação, gera mensagens formatadas prontas para compartilhamento (`wa.me`) com prévia de link Open Graph, descartando chat interno, mural social ou gamificação.
- **Anti-burocracia por padrão:** todas as funcionalidades de controle (`checkin_qrcode`, `aprovacao_despesas`, `notificacoes_push`, `ia_assistente`, `campos_personalizados`) nascem desligadas (`false`) na instalação, e o app nunca é condição para alguém participar de um encontro.
- **Fronteira clara de escopo:** gere a rotina anual da equipe Eagles; registra a participação dos Eagles em compromissos externos do calendário (como o _Outside_), mas não organiza o _Outside_ nem decide a alocação em outras equipes do contexto maior (_Bears_, _Tigers_, _Sheeps_).

## Operating Context

- Encontros presenciais semanais de PGs e eventos ao longo do ano, frequentemente em salões ou residências com rede móvel instável.
- Comunidade jovem articulada por WhatsApp: convites de primeiro acesso chegam como links únicos pelo WhatsApp (muitos membros entram pelo telefone), assim como avisos de encontros, escalas e prestações de contas.
- Acesso mobile-first como PWA instalável na tela de início em Android e iPhone, com navegação dedicada no celular (barra inferior) e no desktop (menu lateral de 256 px).
- Organização estruturada em três eixos independentes: **estágio na caminhada** (`visitante`, `recorrente`, `membro`), **autoridade** (`Master`, `Líder` com mandato de 2 anos, `Conselheiro` com escopo global na equipe, papéis personalizados) e **pertencimento** (no máximo um subgrupo ativo por pessoa por vez, com histórico imutável de vínculos).

## Capabilities and Constraints

- **Arquitetura em produção (27/11/2026):**
  - Mesmo repositório gera dois alvos em SvelteKit 2 (Svelte 5) + TypeScript estrito: **SPA estático** (`adapter-static`) publicado no Firebase Hosting (`https://eagles-app-pg.web.app`) e **API Node** (`adapter-node`) rodando na VPS Oracle via Easypanel Compose + Caddy (`https://api.164-152-195-199.sslip.io`) + PostgreSQL 16 + backup diário criptografado.
  - **M01–M11 implementados + 4 ciclos do piloto + correção de domínio PG/Subgrupos (migração `0012`):**
    - Ciclo 1 (M05 Eventos e PGs): tipo padrão `PG (Pequeno Grupo)` criado de fábrica, filtro por tipo na agenda, criar/editar/cancelar com motivo preservando respostas e reativar.
    - Ciclo 2 (M02 Pessoas): editar ficha, mover estágios na caminhada com troca automática do papel base e histórico (entrada/saída de `membro` exclusiva de líderes), regras de menores 16–17 anos.
    - Ciclo 3 (M04 Subgrupos): editar subgrupos, arquivar/reativar pelo líder, transferir pessoas individualmente ou em lote com histórico append-only.
    - Ciclo 4 (M06 Presença e Frequência): histórico append-only de RSVP, chamada completa nos PGs (todos os membros ativos dos Eagles + visitantes que responderam) e em encontros de subgrupo, tela `/frequencia` (por tipo de evento da equipe e por subgrupo) e frequência na ficha da pessoa.
    - Expansão de Perfis e Draft (migração `0013`): perfil de atributos em 4 eixos (**Físico**, **Bíblico**, **Mental**, **Coordenação Motora**, escala `0–10`) + dados complementares opcionais não invasivos (altura, peso, lateralidade, camiseta, pontos fortes e observação para provas), visível entre membros Eagles sem expor dados sensíveis, com gráfico radar, comparação lado a lado, motor determinístico de balanceamento de times, ajuste manual, compartilhamento no WhatsApp e histórico de Drafts salvos em `/draft`.
  - **Qualidade validada:** 339 testes automatizados (unidade + integração real em PGlite), verificação de tipos e formatação no CI.
- **Regras invariantes de domínio e engenharia:**
  - Pessoa (`person`) existe sem conta de acesso (`user_account`); apenas `full_name` é obrigatório em nível de sistema.
  - Autenticação por convite de uso único + senha Argon2id (OWASP), JWT conferido contra sessão revogável de 30 dias no banco, rate limit pré-hash e bloqueio progressivo persistido no banco.
  - Tipos de evento, opções de RSVP (com flag "conta como vou"), tipos de responsabilidade, categorias financeiras e papéis/permissões são dados configuráveis no banco.
  - RSVP (versionado em `rsvp_history`) e chamada efetiva (`presence`) são registros separados; ausência de resposta no RSVP jamais conta como falta (RN-15).
  - Negação por padrão no servidor: toda rota declara permissão (garantido por `tests/unit/rotas-declaram-permissao.test.ts`); nenhuma regra de negócio reside em componentes de tela.
  - Cache local em IndexedDB para leitura em rede fraca (limpo automaticamente no logout) e orçamento de JS de entrada < 100 KB comprimido.
  - Coluna `team_id` presente nas tabelas raiz desde o M01 (registro único `"Eagles"`, sem interface multi-equipe).
- **Privacidade e dados de menores (LGPD art. 14 — ADR 0003):**
  - Piso de idade de **16 anos** exigido no servidor (`src/lib/server/pessoas/menores.ts`).
  - Para 16 e 17 anos, o servidor impõe cadastro mínimo (só nome e presença; contato, família, observações e conta de acesso são recusados) até existir a tela de registro de consentimento do responsável.
  - Menores são pseudonimizados automaticamente no motor de IA (`Participante P1…`) e nunca têm contato exposto no WhatsApp.
- **Terminologia confirmada (pt-BR):** _PG (Pequeno Grupo — a reunião/encontro)_, _Subgrupo (divisão interna de pessoas)_, _Conselheiro_, _Líder_, _Membro Eagles_, _Visitante_, _Participante recorrente_, _Escala_, _Frequência_, _Prestação de contas_, _Outside_.
- **Pendências explícitas pós-piloto (não presumir nem inventar):**
  - Validação com dados reais durante o piloto em 1 PG.
  - Domínio próprio definitivo (atualmente `eagles-app-pg.web.app` + `api.164-152-195-199.sslip.io`, ambos em HTTPS válido).
  - Registro de consentimento parental para menores de 16–17 anos (tabela `consent` pronta; fluxo de coleta ainda não construído).
  - Eventos recorrentes (RRULE), chamada com busca em eventos gerais, "Sua frequência" no perfil próprio do membro e anúncios direcionados por papel de acesso.
  - Versão vetorial (SVG) da logo `Eagles.png`.

## Brand Commitments

- **Identificação atual:** _Eagles_ na interface do produto, manifesto PWA (`static/manifest.webmanifest`) e prévia Open Graph; _Eagles App_ na documentação técnica e repositório.
- **Voz e tom (pt-BR):** linguagem humana, clara, acolhedora e direta — nunca jargão técnico, tom policialesco ou mensagens genéricas de sistema. Estados vazios explicam o contexto real e erros orientam sempre o que aconteceu e como resolver.
- **Ativos de marca:** emblema real da águia recortado de `Eagles.png` sobre `#A91825` em `src/lib/ui/Marca.svelte` (`marca-96.png`, `marca-192.png`), ícones PWA `any` e `maskable` (`static/icone-*.png`), `apple-touch-icon.png`, `favicon.png` e imagem Open Graph `static/og-eagles.jpg` (1200×630).

## Evidence on Hand

- **Documentação arquitetural, operacional e de ciclos:** `README.md`, `DEPLOY.md`, `DESIGN.md`, `docs/00-descoberta-e-arquitetura.md`, `docs/01-modulo-01-fundacao.md`, `docs/05-modulo-05-eventos-ciclo-1.md`, `docs/02-modulo-02-pessoas-ciclo-2.md`, `docs/04-modulo-04-grupos-ciclo-3.md`, `docs/06-modulo-06-presenca-ciclo-4.md` e `docs/adr/0001-stack.md` a `0004-autenticacao.md`.
- **Código e testes verificados:** 65 rotas da API, 26 telas SPA, 12 migrações (`0000`–`0011`), 39 tabelas e 339 testes automatizados passando (`src/`, `tests/`).
- **Ausências explícitas (não fabricar em telas ou textos):** `seed/seed.ts` contém dados fictícios apenas para desenvolvimento. Métricas reais de adoção do PG piloto só existirão após o uso em produção; versão vetorial SVG da logo segue pendente.

## Product Principles

1. **Cuidado com pessoas acima de controle:** toda funcionalidade deve devolver tempo à liderança e ajudar a perceber quem precisa de atenção, nunca vigiar, ranquear ou burocratizar a vida dos PGs; controles nascem desligados e ninguém depende do app para participar.
2. **Automação propõe, liderança decide:** algoritmos determinísticos e IA preparam sugestões auditáveis, mas escalas, reorganizações de grupos e ações sensíveis exigem sempre revisão e confirmação humana explícita.
3. **Utilidade imediata no celular e simbiose com o WhatsApp:** cada tela precisa justificar sua abertura em uma frase mesmo em rede fraca, entregando ações de poucos toques e mensagens prontas para circular no WhatsApp.
4. **Confiança e privacidade por construção:** autorização negada por padrão no servidor, sessões revogáveis, regime restrito na dúvida sobre idade/consentimento e trilha imutável de auditoria para permissões, históricos e finanças.
5. **Comunidade configurável sem depender de código:** tipos, opções de resposta, papéis, permissões e chaves de funcionalidade são dados persistidos para acompanhar a evolução dos ritos da organização sem novos deploys.

## Accessibility & Inclusion

- **Padrão obrigatório (RNF-12, RNF-01):** conformidade **WCAG 2.1 AA** nas telas do produto — contraste mínimo de 4,5:1 em texto e 3:1 em bordas/controles (WCAG 1.4.11) em tema claro e escuro, navegação integral por teclado, foco visível e rótulos explícitos em formulários.
- **Sem dependência exclusiva de cor:** nenhum estado, aviso, erro de validação ou ação destrutiva é transmitido apenas por cor; texto claro e/ou ícone acompanham sempre o sinal visual; gráficos mensais trazem alternativa em tabela.
- **Acesso móvel, baixa conectividade e inclusão sem app:** telas verificadas em **360 px**, **390 px** e **1440 px** (claro e escuro), alvos de toque mínimos de **44 × 44 px**, cache local para leitura em rede fraca e chamada completa que permite registrar presença de quem não tem conta nem celular no encontro.
