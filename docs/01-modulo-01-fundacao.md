# Módulo 01 — Fundação

- **Status:** **implementado** no commit `a6a077b` (18/08/2026), mesclado em `main`. Verificação local refeita em 23/08/2026 — ver seção 8
- **Pendente:** a infraestrutura de execução (2.7) está escrita, mas não aplicada — bloqueada por D-06 e D-07.2
- **Ciclo:** MVP, semanas 1–2
- **Depende de:** nada (é a base)
- **Bloqueia:** todos os outros módulos

---

## 1. Objetivo

Entregar o **esqueleto executável** do Eagles App: um projeto que sobe, autentica uma pessoa, instala como PWA no celular, aplica a identidade visual dos Eagles e faz deploy automatizado na VPS.

Ao final do M01, ninguém consegue cadastrar uma pessoa nem criar um evento — mas existe uma aplicação real, publicada, em que o próximo módulo é construído em cima de fundação sólida.

**O que este módulo não é:** não é "configuração de projeto". É a decisão de como autenticação, autorização, migração de banco, camadas e deploy vão funcionar para sempre. Errar aqui custa caro em todos os módulos seguintes.

---

## 2. O que será construído

### 2.1 Infraestrutura de código

- Repositório com SvelteKit 2 (Svelte 5) + TypeScript em modo estrito
- Camadas definidas e fronteiras aplicadas por lint (rota → política → serviço → repositório)
- Drizzle configurado, com a primeira migração versionada
- Vitest e Playwright rodando, com um teste real em cada um
- Lint, format e typecheck no pre-commit

### 2.2 Banco de dados

Apenas as tabelas que o M01 usa de fato:

| Tabela                                                 | Para quê                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `team`                                                 | Raiz multi-equipe (ADR: uma linha, "Eagles", sem interface)                                            |
| `person`                                               | Mínimo viável: `full_name`, `birth_date` — a menoridade é derivada na view `person_view`, não é coluna |
| `user_account`                                         | Credenciais, ligadas a `person`                                                                        |
| `session`                                              | Sessão server-side revogável                                                                           |
| `invite`                                               | Token de convite de uso único, com validade                                                            |
| `role`, `permission`, `role_permission`, `person_role` | Estrutura do RBAC criada e semeada — a **verificação** completa vem no M03                             |
| `setting`, `feature_flag`                              | Chaves de funcionalidade, todas desligadas por padrão                                                  |
| `audit_log`                                            | Append-only, já gravando login, logout e mudança de senha                                              |

As demais tabelas do modelo (grupos, eventos, presença, financeiro) **não** entram agora. Criar tabela vazia que ninguém usa é dívida, não adiantamento.

### 2.3 Autenticação (ADR 0004)

- Fluxo de convite: emissão → link → definição de senha → primeiro acesso
- Login, logout, "sair de todos os dispositivos"
- Argon2id, bloqueio progressivo, rate limit por IP e por conta
- Cookie `httpOnly` / `Secure` / `SameSite=Lax`, token rotacionado no login
- Reautenticação para operações sensíveis (a mecânica, ainda sem operações que a usem)

### 2.4 Camada de política

O arquivo `policy.ts` com a assinatura definitiva:

```
can(usuario, 'permissao', { groupId?, personId? }) → boolean
```

Negação por padrão: **rota sem permissão declarada falha no teste**, não abre a porta. As permissões existem e são verificadas; o preenchimento fino de papéis vem no M03.

### 2.5 Design system

Tokens da paleta extraída da logo (`#A91825`, `#741221`, `#580F20`, `#F2ECEC`, `#E4D8D8`, `#AE9195`), tema claro e escuro, e os componentes que todo módulo vai usar:

Botão (primário, secundário, **destrutivo com contorno e ícone, nunca preenchido de vermelho**), campo de texto, seletor, caixa de marcação, cartão, aviso, modal, folha inferior, estado vazio, estado de carregamento, estado de erro, avatar, etiqueta, barra de navegação inferior.

Cada componente entregue com os cinco estados: normal, foco, desabilitado, carregando, erro.

### 2.6 PWA

Manifesto, ícones gerados da logo, service worker com cache stale-while-revalidate para leitura, tela de instalação com instruções **específicas para iPhone** (onde o push depende de instalar na tela de início).

### 2.7 Infraestrutura de execução

`docker-compose` com Caddy (TLS automático), app Node em duas réplicas, PostgreSQL 16 com pg-boss, rotina de backup e Uptime Kuma. Script de provisionamento da VPS versionado. GitHub Actions: lint → typecheck → testes → build → deploy por SSH → verificação de saúde → rollback automático em falha.

---

## 3. Estrutura de diretórios proposta

```
EaglesAPP/
├── docs/
│   ├── 00-descoberta-e-arquitetura.md
│   ├── 01-modulo-01-fundacao.md
│   ├── adr/
│   ├── brand/Eagles.png
│   └── site/
├── src/
│   ├── lib/
│   │   ├── server/
│   │   │   ├── db/            schema/, migrations/, index.ts
│   │   │   ├── auth/          session, password, invite, ratelimit
│   │   │   ├── policy/        policy.ts, permissions.ts, roles.ts
│   │   │   ├── audit/         log.ts
│   │   │   ├── settings/      flags.ts
│   │   │   └── modules/       (um diretório por módulo, a partir do M02)
│   │   ├── ui/                componentes do design system
│   │   ├── styles/            tokens.css, theme.css
│   │   └── shared/            tipos e validadores compartilhados
│   ├── routes/
│   │   ├── (auth)/            entrar, convite, recuperar
│   │   ├── (app)/             área autenticada
│   │   └── (public)/          páginas públicas
│   ├── hooks.server.ts        sessão + política em toda requisição
│   └── service-worker.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── infra/
│   ├── docker-compose.yml
│   ├── Caddyfile
│   ├── provision.sh
│   └── backup.sh
├── .github/workflows/ci.yml
└── seed/                      dados realistas para desenvolvimento
```

---

## 4. Regras de negócio aplicáveis

| ID    | Regra                                           | Como é garantida                                                                                                                                                                                                                                                                                             |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RN-01 | Pessoa existe sem conta de acesso               | `user_account.person_id` é FK opcional na direção certa: a conta aponta para a pessoa, nunca o contrário                                                                                                                                                                                                     |
| RN-28 | Auditoria imutável                              | `audit_log` sem GRANT de UPDATE/DELETE para o usuário da aplicação                                                                                                                                                                                                                                           |
| RN-29 | Funcionalidades opcionais funcionam desligadas  | Toda `feature_flag` nasce `false`; teste verifica que a aplicação sobe e opera com todas desligadas                                                                                                                                                                                                          |
| RN-30 | Menor sem consentimento fica em cadastro mínimo | `is_minor` **derivada na view `person_view`**, nunca armazenada — coluna gerada é impossível no PostgreSQL porque a idade depende da data de hoje (ver [ADR 0003, Revisão](adr/0003-dados-de-menores.md)). `NULL` quando a data de nascimento é desconhecida, e `NULL` significa _aplique o regime restrito_ |
| A-02  | Sessão revogável                                | Tabela `session` com `revoked_at`; sem JWT                                                                                                                                                                                                                                                                   |

---

## 5. Contratos definidos neste módulo

Não são endpoints REST — são **form actions** do SvelteKit, que funcionam com JavaScript desligado.

| Rota               | Ação           | Permissão                | Retorno                                         |
| ------------------ | -------------- | ------------------------ | ----------------------------------------------- |
| `/entrar`          | `default`      | pública, rate-limited    | redireciona ou erro de credencial               |
| `/convite/[token]` | `aceitar`      | token válido e não usado | cria `user_account`, inicia sessão              |
| `/sair`            | `default`      | autenticado              | revoga a sessão atual                           |
| `/conta/sessoes`   | `revogarTodas` | autenticado              | revoga todas as outras sessões                  |
| `/api/health`      | `GET`          | pública                  | estado do app e do banco, para o CI e o monitor |

**Formato de erro padronizado** para toda a aplicação: `{ campo, codigo, mensagem }` — mensagem em português, dizendo o que aconteceu e como resolver, nunca só "erro".

---

## 6. Fluxos de UX deste módulo

**Convite → primeiro acesso**

```
Conselheiro toca "Convidar" no perfil de alguém
   → sistema gera link e abre o WhatsApp com a mensagem pronta
   → pessoa toca no link, vê o próprio nome e a logo dos Eagles
   → define a senha (uma vez só, com indicador de força)
   → entra direto, já autenticada
   → banner: "Instale o Eagles na sua tela de início" (com passos para iPhone)
```

**Estados que precisam existir desde já:** convite expirado, convite já usado, senha fraca, conta bloqueada por tentativas, sem conexão.

---

## 7. Riscos deste módulo

| Risco                                                       | Mitigação                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Camada de política mal desenhada trava os módulos seguintes | Escrever os testes da política **antes** da implementação, cobrindo a matriz papel × permissão × escopo |
| Design system genérico demais e refeito depois              | Construir componentes a partir das telas reais do M02, não em abstrato                                  |
| Deploy adiado "para quando houver o que publicar"           | Deploy funcionando na semana 1, mesmo com uma página quase vazia                                        |
| Migração de banco sem caminho de volta                      | Toda migração com script de reversão testado                                                            |
| Service worker servindo versão velha após deploy            | Estratégia de versionamento e ativação imediata, testada em navegador real                              |

---

## 8. Critérios de aceitação

Estado verificado em **23/08/2026**:
`npm test` → **87 testes** · `npm run test:e2e` → **16 testes, 2 navegadores** · `npm run check` → **0 erros em 650 arquivos** · `npm run build` → sucesso.

### ✅ Atendidos e verificados

| Critério                                                                 | Evidência                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Login funciona com JavaScript desabilitado**                           | `tests/e2e/sem-javascript.spec.ts` — projeto `sem-javascript` com `javaScriptEnabled: false`. Cobre entrada, erro de senha e saída. O primeiro teste do arquivo é uma **guarda de integridade**: se o projeto voltar a rodar com JavaScript, ele falha, em vez de o arquivo ficar verde sem provar nada |
| Rota sem permissão declarada **falha no teste**                          | `tests/unit/rotas-declaram-permissao.test.ts`                                                                                                                                                                                                                                                           |
| `audit_log` recusa UPDATE e DELETE mesmo com o usuário da aplicação      | `tests/integration/banco.test.ts` — "RECUSA update — mesmo vindo do dono da tabela"                                                                                                                                                                                                                     |
| Sessão revogável; "sair de todos os dispositivos" invalida imediatamente | `tests/integration/autenticacao.test.ts`, e a saída também é exercida no navegador                                                                                                                                                                                                                      |
| **Senha errada 5 vezes bloqueia progressivamente**                       | `tests/e2e/entrar.spec.ts` — percorre as cinco tentativas e confirma que a senha certa deixa de entrar                                                                                                                                                                                                  |
| Mensagem de erro não revela se a conta existe                            | `entrar.spec.ts` compara o texto para conta inexistente e para senha errada                                                                                                                                                                                                                             |
| Convite de uso único, resistente a clique duplo                          | `autenticacao.test.ts`                                                                                                                                                                                                                                                                                  |
| Migrações aplicam do zero                                                | `banco.test.ts`, e a suíte de e2e recria o banco a cada execução                                                                                                                                                                                                                                        |
| **Backup é cifrado e sai da VPS**                                        | `infra/backup.sh` cifra com age (chave pública) antes de qualquer cópia externa, e apaga o texto em claro. Sem a chave, **não roda**                                                                                                                                                                    |
| **Uma restauração foi testada com sucesso**                              | `infra/restore.sh --ensaio`, exercitado contra PostgreSQL 16 real: 12 tabelas, 10 pessoas, 32 permissões e a view `person_view` de volta                                                                                                                                                                |
| App instalável: manifesto e ícones válidos                               | `tests/e2e/pwa.spec.ts`                                                                                                                                                                                                                                                                                 |
| JS inicial abaixo de 100 KB comprimido (RNF-03)                          | **53,6 KB** gzip; o CI falha acima de 100 KB                                                                                                                                                                                                                                                            |
| CI bloqueia merge com teste falhando                                     | `.github/workflows/ci.yml`, com um segundo job de ponta a ponta sobre PostgreSQL real                                                                                                                                                                                                                   |

### ⬜ Não atendidos — bloqueados por decisão pendente

Dependem de **D-06** (domínio) e **D-07.2** (specs da VPS). O código existe; a aplicação nunca rodou numa máquina real.

- `docker compose up` numa VPS de verdade
- Convite real no WhatsApp, num iPhone e num Android físicos
- Instalação do PWA na tela de início, em modo autônomo
- Deploy automatizado com rollback — o CI ainda não tem job de deploy, e `infra/provision.sh` não existe
- Cópia externa do backup de fato enviada: o `rclone` para o Backblaze está no script e no contêiner, mas nunca transferiu um arquivo

### ⬜ Dívida reconhecida, sem bloqueio externo

- **Contraste WCAG AA** e **telas a 360 px** conferidos a olho, não por ferramenta
- `README.md` nunca foi validado por outra pessoa subindo o projeto do zero

### Decisão de escopo registrada

A seção 2.5 previa ~14 componentes. Foram construídos **5** (`Botao`, `Campo`, `Aviso`, `Marca`, `InstalarPwa`) — os que as telas do M01 usam.

É a mitigação de risco da seção 7 aplicada ("construir a partir das telas reais, não em abstrato"), não um item esquecido. Os demais nascem no M02, junto das telas que os pedirem.

---

## 9. Resultado esperado

Uma URL que abre no celular, mostra a marca dos Eagles, aceita um convite, autentica, instala como app e tem deploy automatizado com backup testado. **Zero funcionalidade de negócio** — e essa é exatamente a intenção.

---

## 10. Pendências que bloqueiam parte deste módulo

| Pendência                        | Bloqueia                           | Não bloqueia                 |
| -------------------------------- | ---------------------------------- | ---------------------------- |
| **D-06** — domínio               | HTTPS real, PWA instalável, deploy | todo o desenvolvimento local |
| **D-07.2** — specs da VPS        | provisionamento e deploy           | todo o desenvolvimento local |
| **D-07.1** — nº de pessoas e PGs | semeadura realista do banco        | estrutura e componentes      |
| **D-07.5** — nome definitivo     | domínio, manifesto do PWA, textos  | o resto                      |

**Consequência prática:** posso construir e testar as seções 2.1 a 2.6 (todo o desenvolvimento local) imediatamente. A seção 2.7 (infraestrutura de execução) fica pronta em código, mas só é aplicada de fato quando o domínio e os specs da VPS chegarem.
