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

## Revisão de 04/10/2026 — o que a implementação do M01 não cumpria

Duas partes desta decisão estavam escritas e não implementadas. Corrigidas no M03.

### 1. O convite precisa definir COMO a pessoa entra

O aceite do convite criava a conta só com a senha — sem e-mail e sem telefone. Como o login procura a conta por um dos dois, quem entrava por convite ficava trancado para fora assim que a primeira sessão terminava.

**Complemento a esta decisão:** o aceite pede, além da senha, o **e-mail ou telefone de entrada**, obrigatório. Telefone é guardado só com os dígitos, e o login normaliza do mesmo jeito. O campo não vem preenchido com o cadastro: o link pode ser encaminhado, e a página não deve entregar o contato de ninguém a quem o abrir.

### 2. Recuperação de acesso por novo convite — agora de verdade

A seção "Entrada no sistema" diz: _"Recuperação de acesso: novo link de convite emitido por líder ou conselheiro."_ O código recusava convite para quem já tinha senha, com a mensagem "você já tem acesso, entre com a sua senha" — deixando sem saída justamente quem esqueceu a senha.

**Comportamento correto, agora implementado:** convite para quem já tem conta é **recuperação**. Ao aceitá-lo, a pessoa define uma senha nova, a antiga deixa de valer e **todas as sessões abertas são encerradas** — um aparelho perdido ou uma sessão roubada morre junto com a senha velha. Emitir um convite de recuperação exige reautenticação de quem emite, porque é redefinir a credencial de outra pessoa.

### Por que nenhum teste pegou

O teste de integração do fluxo de convite reimplementava a rota à mão e, no passo "a senha funciona no login seguinte", conferia o hash — nunca procurava a conta do jeito que o login procura. Aceite e busca de conta passaram a viver num serviço (`$server/auth/conta`), usado pela rota e pelo teste; e o teste de ponta a ponta agora faz a pessoa **sair e entrar de novo**.
