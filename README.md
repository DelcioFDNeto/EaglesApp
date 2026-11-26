# Eagles App

Plataforma de gestão interna dos Eagles: pessoas, grupos (PGs), encontros,
responsabilidades, presença, comunicação e recursos financeiros — o ano inteiro.

**Stack:** SvelteKit 2 (Svelte 5) · TypeScript · PostgreSQL 16 · Drizzle · PWA

**Arquitetura em produção:**

```
Navegador / PWA / APK ──HTTPS──▶ Firebase Hosting   (SPA estático: npm run build)
        └──────────────HTTPS──▶ API Node na VPS     (npm run build:api, via Easypanel)
                                    └──▶ PostgreSQL 16 + backup diário criptografado
```

O mesmo código gera os dois: o SPA chama a API por `fetch` com JWT, e o JWT
sempre é conferido contra a sessão no banco (sair e desconectar aparelhos
valem na hora). Como publicar: [`DEPLOY.md`](DEPLOY.md).

---

## Comece por aqui

| Documento                                                                    | Para quê                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`DEPLOY.md`](DEPLOY.md)                                                     | Publicar: Firebase, Easypanel, primeiro acesso, backup                |
| [`docs/00-descoberta-e-arquitetura.md`](docs/00-descoberta-e-arquitetura.md) | Requisitos, regras de negócio, modelo de dados, RBAC, riscos, roadmap |
| [`docs/01-modulo-01-fundacao.md`](docs/01-modulo-01-fundacao.md)             | O que o M01 entrega e seus critérios de aceitação                     |
| [`docs/adr/`](docs/adr/)                                                     | Por que cada decisão importante foi tomada                            |

---

## Rodar localmente

Requisitos: **Node 22+** e **Docker** (só para o banco).

```bash
npm install
cp .env.example .env                                   # já vem pronto para o banco local

docker compose -f deploy/docker-compose.dev.yml up -d  # PostgreSQL 16 em localhost:5432

npm run db:migrate                                     # aplica as migrações
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
| `pedro@eagles.local`   | Conselheiro do PG A                          |
| `marina@eagles.local`  | Conselheira do PG B                          |
| `joao@eagles.local`    | Membro (PG A)                                |
| `leticia@eagles.local` | Membro (PG B)                                |

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

| Comando                   | O que faz                                                      |
| ------------------------- | -------------------------------------------------------------- |
| `npm run dev`             | App + API locais em http://localhost:5173                      |
| `npm test`                | Testes de unidade e integração (PGlite, sem Docker)            |
| `npm run check`           | Verificação de tipos (`svelte-check`)                          |
| `npm run format`          | Formata o código (o CI exige `format:check`)                   |
| `npm run build`           | SPA estático para o Firebase (exige `.env.production`)         |
| `npm run build:api`       | Servidor Node da API (o que a imagem Docker da VPS roda)       |
| `npm run deploy:firebase` | Build do SPA + publicação no Firebase Hosting                  |
| `npm run db:generate`     | Gera migração a partir do schema                               |
| `npm run db:migrate`      | Aplica migrações pendentes (lê o `.env`)                       |
| `npm run db:seed`         | Semeia o ambiente de desenvolvimento (lê o `.env`; nunca prod) |

Antes de enviar mudanças, rode o que o CI roda:
`npm run format:check && npm run check && npm test && npm run build && npm run build:api`.

---

## Organização

```
src/
├── lib/
│   ├── server/          código que NUNCA vai para o navegador
│   │   ├── db/          schema, migrações, conexão
│   │   ├── auth/        senha, sessão, JWT, convite, bloqueio, rate limit
│   │   ├── policy/      autorização — o ponto único de decisão
│   │   ├── lideranca/   Master, os 2 líderes e seus mandatos
│   │   ├── bootstrap/   catálogo, primeiro acesso (Master), semente de dev
│   │   ├── audit/       registro imutável
│   │   ├── manutencao.ts limpeza periódica (sessões, rate limit)
│   │   └── env.ts       variáveis validadas na subida
│   ├── ui/              design system
│   ├── styles/          tokens da marca, tema claro e escuro
│   ├── shared/          o que servidor e navegador compartilham
│   └── api.ts           cliente da API usado pelas telas
├── routes/
│   ├── api/             a API (só existe no build da API e no dev)
│   └── …                as telas do SPA
└── hooks.server.ts      CORS, cabeçalhos de segurança, manutenção
deploy/                  imagem da API, compose do Easypanel, backup, dev
tests/                   unidade e integração
docs/                    arquitetura e ADRs
infra/                   LEGADO (stack do M01 com Caddy) — não usada
```

O SvelteKit **impede** que `lib/server` seja importado por código de cliente.
Se um import quebrar o build por causa disso, a proteção funcionou.

---

## Regras que este projeto leva a sério

**Negação por padrão.** Toda rota de servidor declara sua permissão. Uma rota
sem `authorize()` nem `can()` **falha no teste** — veja
[`tests/unit/rotas-declaram-permissao.test.ts`](tests/unit/rotas-declaram-permissao.test.ts).
Tornar uma rota pública exige entrar numa lista, com o motivo.

**Autorização é do servidor.** A interface apenas esconde o que o servidor já
proíbe. Existe **um** ponto de decisão: `src/lib/server/policy/policy.ts`.

**Permissão tem escopo.** Um conselheiro do PG Azul não manda no PG Verde.
Ambiguidade resolve-se negando.

**Topo do acesso fechado.** Acima de todos, o Master (o desenvolvedor),
invisível para a equipe. Abaixo, no máximo **2 líderes**, com mandato de 2
anos — garantido também por gatilho no banco. Ninguém mais distribui
permissões.

**Auditoria é append-only.** Gatilhos no banco recusam `UPDATE` e `DELETE` em
`audit_log`. Login, logout, falhas, bloqueios e mudanças de acesso ficam lá.

**Funcionalidades de controle nascem desligadas.** Check-in, aprovação de
despesas, notificações: todas `false` na instalação.

**Rate limit antes do hash, bloqueio no banco.** O Argon2id custa ~610 ms de
CPU, então o limite por IP e por conta roda antes. Senha errada 5 vezes
bloqueia a conta, com tempo que dobra a cada vez — gravado no banco, sobrevive
a reinícios.

**Backup só conta se restaura.** Todo backup diário é restaurado num banco
descartável e conferido antes de ser criptografado e enviado para fora da VPS.

---

## Pendências conhecidas

- Testes ponta a ponta (Playwright) ainda não escritos
- Contraste WCAG AA não verificado por ferramenta; telas a 360 px não revisadas
- Consentimento parental para menores (16–17 anos) ainda não implementado
- Logo em versão vetorial/transparente — hoje `Marca.svelte` usa um desenho simplificado
