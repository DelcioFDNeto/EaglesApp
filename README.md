# Eagles App

Plataforma de gestão interna dos Eagles: pessoas, grupos (PGs), encontros,
responsabilidades, participação e recursos financeiros — o ano inteiro.

> **Estado:** MVP completo — módulos 01 a 06 implementados: fundação, pessoas,
> papéis e acessos, grupos, eventos e presença. A implantação na VPS é a
> próxima etapa (depende do domínio e das specs da máquina).

**Stack:** SvelteKit 2 (Svelte 5) · TypeScript · PostgreSQL 16 · Drizzle · PWA

---

## Comece por aqui

| Documento                                                                      | Para quê                                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| [`docs/00-descoberta-e-arquitetura.md`](docs/00-descoberta-e-arquitetura.md)   | Requisitos, regras de negócio, modelo de dados, RBAC, riscos, roadmap |
| [`docs/01-modulo-01-fundacao.md`](docs/01-modulo-01-fundacao.md)               | O que o M01 entrega e seus critérios de aceitação                     |
| `docs/02-…` a [`docs/06-modulo-06-presenca.md`](docs/06-modulo-06-presenca.md) | Um documento por módulo: decisões, o que foi construído e a evidência |
| [`docs/varredura-2026-10-11.md`](docs/varredura-2026-10-11.md)                 | A revisão de todos os módulos e da infra antes do deploy              |
| [`docs/hospedagem-de-baixo-custo.md`](docs/hospedagem-de-baixo-custo.md)       | Onde e por quanto rodar — inclusive de graça                          |
| [`infra/README.md`](infra/README.md)                                           | Subir em produção, backup e restauração                               |
| [`docs/adr/`](docs/adr/)                                                       | Por que cada decisão importante foi tomada                            |

Leia os ADRs antes de mudar algo estrutural. Em oito meses ninguém lembra por
que o Redis foi descartado ou por que a sessão não é JWT.

---

## Rodar localmente

Requisitos: **Node 22+** e **Docker** (só para o banco).

```bash
npm install
cp .env.example .env        # ajuste DATABASE_URL se precisar

docker compose -f infra/docker-compose.yml up -d postgres

npm run db:migrate          # aplica as migrações
npm run db:seed             # popula com dados realistas
npm run dev                 # http://localhost:5173
```

Contas criadas pela semeadura (senha `eagles-desenvolvimento`):

| Conta                 | Papel                   |
| --------------------- | ----------------------- |
| `ana@eagles.local`    | Líder — acesso global   |
| `pedro@eagles.local`  | Conselheiro do PG Azul  |
| `marina@eagles.local` | Conselheira do PG Verde |
| `joao@eagles.local`   | Membro do PG Azul       |

A semeadura também cria a **agenda**: o encontro semanal do PG Azul (quinta, 20h)
e do PG Verde (terça, 19h30), um encontro geral, uma reunião de liderança e um
rascunho — datas relativas ao dia em que roda.

E seis semanas de **lista de presença** dos dois PGs, para a frequência ter o
que mostrar: Rafael vinha e parou ("não vem há 3 encontros"), Isabela é
visitante e já veio três vezes, e o João já respondeu "vou" ao próximo PG Azul.

A semeadura também imprime um **link de convite** para testar o fluxo real de
entrada, que é como toda pessoa vai receber acesso (ADR 0004).

### Sem Docker?

Os testes rodam mesmo assim. Eles usam **PGlite** — o próprio PostgreSQL
compilado para WebAssembly, em memória. Mesmas migrações, mesmos gatilhos,
mesmas constraints, sem serviço nenhum na máquina:

```bash
npm test
```

Para levantar a aplicação, aí sim é preciso um Postgres acessível.

---

## Comandos

| Comando               | O que faz                             |
| --------------------- | ------------------------------------- |
| `npm run dev`         | Servidor de desenvolvimento           |
| `npm test`            | Testes de unidade e integração        |
| `npm run check`       | Verificação de tipos (`svelte-check`) |
| `npm run format`      | Formata o código                      |
| `npm run build`       | Build de produção                     |
| `npm run db:generate` | Gera migração a partir do schema      |
| `npm run db:migrate`  | Aplica migrações pendentes            |
| `npm run db:seed`     | Semeia o ambiente de desenvolvimento  |

---

## Organização

```
src/
├── lib/
│   ├── server/          código que NUNCA vai para o navegador
│   │   ├── db/          schema, migrações, conexão
│   │   ├── auth/        senha, sessão, convite, rate limit
│   │   ├── policy/      autorização — o ponto único de decisão
│   │   ├── audit/       registro imutável
│   │   └── env.ts       variáveis validadas na subida
│   ├── ui/              design system
│   ├── styles/          tokens da marca, tema claro e escuro
│   └── shared/          o que servidor e navegador compartilham
├── routes/              páginas e form actions
└── hooks.server.ts      sessão, política e cabeçalhos de segurança
docs/                    arquitetura e ADRs
infra/                   Docker, Caddy, backup
tests/                   unidade, integração e ponta a ponta
```

O SvelteKit **impede** que `lib/server` seja importado por código de cliente.
Se um import quebrar o build por causa disso, a proteção funcionou.

---

## Regras que este projeto leva a sério

**Negação por padrão.** Toda rota de servidor declara sua permissão. Uma rota
sem `authorize()` nem `can()` **falha no teste** — veja
[`tests/unit/rotas-declaram-permissao.test.ts`](tests/unit/rotas-declaram-permissao.test.ts).
Tornar uma rota pública exige entrar numa lista, com o motivo, e isso aparece
no diff para alguém revisar.

**Autorização é do servidor.** A interface apenas esconde o que o servidor já
proíbe. Existe **um** ponto de decisão: `src/lib/server/policy/policy.ts`.

**Permissão tem escopo.** Um conselheiro do PG Azul não manda no PG Verde.
Pedir uma ação sem dizer sobre qual grupo é ambíguo, e ambiguidade resolve-se
negando.

**Auditoria é append-only.** Gatilhos no banco recusam `UPDATE` e `DELETE` em
`audit_log` — não é convenção de código, é garantia de banco.

**Funcionalidades de controle nascem desligadas.** Check-in, aprovação de
despesas, notificações: todas `false` na instalação. Ligar cada uma é decisão
consciente da liderança, não padrão do sistema.

**Rate limit antes do hash.** O Argon2id custa ~610 ms de CPU. O limite roda
antes, sempre — senão o login vira alavanca de consumo de servidor.

---

## Deploy

```bash
# na VPS, uma vez
cp .env.example .env    # defina DOMINIO, POSTGRES_PASSWORD, ACME_EMAIL, B2_BUCKET
docker compose -f infra/docker-compose.yml up -d
```

O Caddy obtém e renova o certificado TLS sozinho — mas o **domínio precisa
apontar para o IP da VPS antes de subir**, senão o desafio ACME falha em laço.

O `.github/workflows/ci.yml` roda lint, tipos, testes e build a cada push, e
falha se o JS de entrada passar de 100 KB comprimido.

### Backup

`infra/backup.sh` roda diariamente às 3h, verifica a integridade do dump e
envia cópia externa. **Configure `B2_BUCKET`** — backup que mora só na máquina
que pode morrer não é backup. Teste a restauração uma vez por mês; backup nunca
testado deve ser considerado inexistente.

---

## Pendências conhecidas

- Domínio ainda não definido (`D-06`) — bloqueia HTTPS, PWA instalável e push
- Specs da VPS não confirmados (`D-07.2`) — bloqueiam o provisionamento
- Logo em versão vetorial/transparente — hoje `Marca.svelte` usa um desenho
  simplificado; a arte original tem fundo sólido
- Testes ponta a ponta (Playwright) ainda não escritos
