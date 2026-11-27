# ADR 0004 — Acesso por convite via WhatsApp + senha, com sessão em banco

- **Status:** aceita
- **Data:** 2026-08-18
- **Decisor:** usuário (D-04) para a forma de entrada; técnica (A-02) para o mecanismo de sessão

## Contexto

Comunidade jovem que se organiza por WhatsApp. Muitos membros não checam e-mail. O sistema guarda dados pessoais, dados de menores e, futuramente, movimentações financeiras.

Três caminhos de entrada foram considerados: convite por link do WhatsApp, telefone + código SMS, e e-mail + senha com autocadastro aberto.

## Decisão

### Entrada no sistema

**Convite emitido por líder ou conselheiro**, entregue como link pelo WhatsApp. A pessoa abre o link, confirma o nome e define a própria senha.

- O convite carrega um token de uso único, com validade (sugestão: 7 dias) e vinculado a uma `person` que já existe no cadastro.
- Não existe autocadastro aberto para conta de acesso. O autocadastro público existe apenas para **visitante em evento**, e cria uma `person` sem conta.
- Recuperação de acesso: novo link de convite emitido por líder ou conselheiro. Se a pessoa tiver e-mail verificado, também por e-mail.

### Sessão

**Sessão server-side em tabela**, com cookie `httpOnly`, `Secure`, `SameSite=Lax`. Token rotacionado no login. Duração de 30 dias, com **reautenticação obrigatória** para operações sensíveis (financeiro, RBAC, exclusões).

Senha com **Argon2id** (`m=19456, t=2, p=1`, parâmetros OWASP). TOTP opcional, recomendado para quem tem `finance.*` ou `rbac.manage`. Bloqueio progressivo por tentativas, com limite por IP e por conta.

## Razões

**Sobre a entrada:** o convite casa com o canal que a comunidade já usa, tem custo zero (ao contrário do SMS), evita que estranhos criem contas, e mantém o cadastro sob controle da liderança — que é quem sabe quem realmente pertence ao grupo. Também resolve a vinculação: a conta nasce ligada a uma pessoa que já tem histórico, em vez de criar um registro duplicado.

**Sobre a sessão:** rejeitei JWT stateless. Sem revogação real, um token vazado vale até expirar. Num sistema com dados de menores e movimentação financeira, precisar esperar a expiração de um token comprometido é inaceitável. A tabela de sessões permite encerrar o acesso de alguém imediatamente — inclusive de todos os dispositivos.

## Consequências

- **Positiva:** ninguém entra sem ter sido cadastrado por um responsável; a lista de usuários é sempre um espelho da comunidade real.
- **Positiva:** revogação imediata de acesso, listagem de sessões ativas por usuário.
- **Negativa:** uma consulta ao banco por requisição autenticada. Irrelevante nesta escala e mitigável com cache curto em memória se necessário.
- **Operacional:** a liderança precisa emitir convites. Para o lote inicial, o M02 terá emissão em massa a partir da importação de planilha.
- **Menores:** conta de acesso para menor de idade só é emitida com o consentimento previsto no [ADR 0003](0003-dados-de-menores.md).

---

## Atualização de implementação (27/11/2026)

Com a separação entre SPA estático (Firebase Hosting / Capacitor) e API Node na VPS, o mecanismo de transporte da sessão foi adaptado sem abrir mão da **revogação imediata no banco** (revisão `b9ee85d`):

- **Transporte e revogação:** o login retorna um JWT assinado com `JWT_SECRET` enviado em `Authorization: Bearer <token>`, mas **toda requisição autenticada valida o `sid` contra a tabela `session` no PostgreSQL** (`src/lib/server/auth/middleware.ts` e `src/lib/server/auth/session.ts`). Isso mantém a revogação imediata no logout e em "desconectar outros aparelhos", evitando o problema de JWT stateless rejeitado neste ADR.
- **Duração e proteção de senha:** sessão de 30 dias, hash Argon2id com parâmetros OWASP, rate limit pré-hash por IP (`X-Forwarded-For`, `XFF_DEPTH=1`) e bloqueio progressivo por conta persistido no banco (5 tentativas → 15 min, dobrando até 24 h).
- **Convites e recuperação:** convites de uso único (7 dias) via WhatsApp funcionam em `/pessoas` e `/convite`; "Esqueci minha senha" via SMTP (token de 15 minutos, apenas hash no banco) funciona em `/esqueci-senha` e `/resetar-senha`.
- **Lacunas mantidas abertas:** TOTP (2FA), reautenticação obrigatória para ações sensíveis (financeiro/RBAC/exclusões) e emissão em massa de convites via importação de planilha ainda não foram implementados.
