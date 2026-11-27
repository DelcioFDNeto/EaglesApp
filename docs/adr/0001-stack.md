# ADR 0001 — Stack: SvelteKit + TypeScript + PostgreSQL

- **Status:** aceita
- **Data:** 2026-08-18
- **Decisor:** usuário (D-01)

## Contexto

Aplicação de gestão de comunidade, mobile-first, hospedada numa VPS já existente, mantida por uma equipe muito pequena. Restrição explícita do briefing: evitar React e frameworks escolhidos por popularidade quando houver alternativa madura.

Quatro alternativas foram avaliadas em 12 critérios (seção 14 do documento de arquitetura): SvelteKit (4,6), Laravel + Livewire (4,3), Phoenix LiveView (3,9), Flutter + API (3,8).

## Decisão

**SvelteKit 2 (Svelte 5) + TypeScript + PostgreSQL 16 + Drizzle ORM**, entregue como PWA instalável.

Bibliotecas: Zod (validação), Argon2id (senha), pg-boss (fila no próprio Postgres), Vitest + Playwright (testes), Tailwind com os tokens da marca.

## Razões

1. **Rede ruim é o cenário real** — PG em salão com sinal fraco. Svelte processa a interação no dispositivo e sincroniza depois; Livewire e LiveView vão ao servidor a cada clique, e LiveView com WebSocket caído deixa a tela inerte.
2. **Progressive enhancement de verdade** — as form actions funcionam como formulário HTML puro se o JavaScript falhar.
3. **Uma linguagem só** — TypeScript da validação de formulário até a consulta ao banco, com tipos compartilhados. Reduz o custo de manutenção de uma equipe pequena.
4. **Peso** — Svelte compila em vez de embarcar runtime; o alvo de < 100 KB de JS (RNF-03) é confortável.

## Consequências

- **Positivas:** um repositório, um deploy, um conjunto de tipos; PWA sem custo de loja; consumo de RAM baixo na VPS.
- **Negativas:** ecossistema menor que o do Laravel — não há equivalente pronto ao Filament, então as telas administrativas serão construídas à mão. Aceito, porque o RBAC com escopo deste projeto não caberia bem num admin genérico de qualquer forma.
- **Risco assumido:** se a manutenção futura passar para alguém que só domina PHP, a migração é cara. Mitigação: código simples, sem metaprogramação, documentado por ADRs.

## Alternativas rejeitadas

- **Laravel + Livewire** — segunda colocada, e seria a escolha certa se a manutenção fosse feita por alguém mais forte em PHP. Perde no critério de rede instável.
- **Phoenix LiveView** — melhor performance bruta, mas poucos desenvolvedores Elixir disponíveis e o mesmo problema de dependência de socket.
- **Flutter + API** — melhor UX nativa, mas duas bases de código, US$ 124/ano de lojas e revisão de 1–7 dias por correção.
- **Next.js / React** — excluído pela preferência explícita do briefing.

---

## Atualização de implementação (27/11/2026)

A decisão central (**SvelteKit 2 + Svelte 5 + TypeScript + PostgreSQL 16 + Drizzle ORM + Zod + Argon2id**) foi mantida, com quatro ajustes concretos registrados no código (revisão `b9ee85d`):

1. **Estilização sem Tailwind:** os tokens de design e estilos base vivem em CSS nativo (`src/lib/styles/tokens.css` e `src/lib/styles/app.css`) com variáveis semânticas, em vez de Tailwind.
2. **Dois alvos de build a partir do mesmo repositório:** `@sveltejs/adapter-static` gera o SPA/PWA (`build/`, publicado no Firebase Hosting e empacotável via Capacitor 6 para Android), enquanto `@sveltejs/adapter-node` gera o servidor da API (`build-api/`, rodando na VPS via `docker-compose.yml`). Por ser SPA separado da API, as telas falam com `/api/*` via cliente tipado (`src/lib/api.ts`) em vez de SvelteKit form actions SSR.
3. **Sem `pg-boss`:** tarefas periódicas de manutenção (limpeza de sessões e tokens expirados, rotação de memória do rate limit) rodam em processo no servidor da API (`src/lib/server/manutencao.ts`), e os backups diários criptografados rodam em um serviço Docker dedicado (`deploy/backup/`).
4. **Testes com PGlite:** os testes de integração usam Vitest + `@electric-sql/pglite` em memória rodando as migrações reais do Drizzle (`tests/integration/`), dispensando Postgres externo no CI; testes E2E com Playwright ainda não estão configurados no repositório.
