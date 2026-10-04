# Módulo 03 — RBAC e gestão de acesso

- **Status:** **implementado** e verificado em 04/10/2026
- **Ciclo:** MVP, semanas 3–4 (junto do M02, conforme o ADR 0002)
- **Depende de:** M01 (política, sessão, auditoria), M02 (pessoas) — estáveis
- **Bloqueia:** M04 (Grupos), que atribui o papel de conselheiro a partir da tela do grupo

---

## 1. Objetivo

Responder, dentro do app, às duas perguntas que hoje só se respondem mexendo no banco:

1. **Quem pode usar o Eagles App?** — convite, conta e papel.
2. **O que cada um pode fazer?** — papéis, permissões e escopo.

O entregável do roteiro (seção 19.1) é "4 papéis com escopo funcionando; matriz de permissões 100% testada". A camada de política já existe desde o M01; o que falta é **administrá-la sem acesso ao banco** e **provar a matriz inteira**.

---

## 2. O que a leitura do código revelou antes de começar

Seis lacunas, todas de acesso, todas entram neste ciclo — um módulo chamado "gestão de acesso" não pode ser entregue com elas abertas.

| #   | Lacuna                                                                                                                                                                                          | Origem | Gravidade   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------- |
| G1  | **Nenhuma tela emite convite.** RF-01.2 é `Must`; hoje ninguém novo consegue entrar no app                                                                                                      | M01    | alta        |
| G2  | **O aceite do convite cria a conta sem e-mail nem telefone.** O login procura a conta por um dos dois, então quem entra por convite fica trancado para fora assim que a primeira sessão termina | M01    | **crítica** |
| G3  | O login compara o telefone sem normalizar: `11987654321` e `(11) 98765-4321` não casam                                                                                                          | M01    | média       |
| G4  | **Não existe navegação.** As telas do M02 só se alcançam digitando o endereço                                                                                                                   | M02    | alta        |
| G5  | `/conta/sessoes` nega o conselheiro — mesma classe de defeito que o M02 corrigiu no `/inicio`                                                                                                   | M01    | média       |
| G6  | `canAnywhere`, criado no M02, não tem teste unitário próprio                                                                                                                                    | M02    | baixa       |

G2 e G7, juntas, significavam que **ninguém que entrasse por convite tinha caminho de volta**: não conseguia entrar de novo depois de sair, e não podia receber um novo convite para recuperar o acesso.

G2 sobreviveu porque o teste de integração do convite **reimplementava a rota à mão** e, no passo "a senha funciona no login seguinte", conferia o hash — nunca procurava a conta do jeito que o login procura. A correção extrai aceite e login para serviços, e o teste passa a exercitar o código de verdade.

---

## 3. Decisões deste módulo

### D-M03-1 — O escopo vem do papel

`[DEC]` `role` ganha `default_scope` (`global` · `group` · `self`). Quem atribui escolhe **o papel**, não o escopo — evita o erro silencioso de dar "Conselheiro" com escopo global e criar, sem querer, um superconselheiro.

Pela tela da pessoa só se atribuem papéis `global` e `self`. Papéis de escopo `group` — o de conselheiro — são atribuídos **pela tela do grupo**, no M04, onde existe um grupo para apontar.

### D-M03-2 — Quatro travas, verificadas no servidor

`[DEC]` Toda alteração de acesso passa por elas, sem exceção:

| Trava                                   | Por quê                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Só `rbac.manage` **global** administra  | Administrar acesso não é tarefa de um grupo                                                         |
| **Ninguém concede o que não tem**       | Sem ela, quem só tem `rbac.manage` poderia criar um papel com `finance.view_all` e dá-lo a um amigo |
| **Ninguém altera o próprio acesso**     | Princípio dos quatro olhos. Fecha de uma vez a autopromoção e o autotrancamento                     |
| **Sempre resta um administrador ativo** | Remover o último acesso administrativo tranca a comunidade fora do próprio sistema                  |

A última é verificada sobre o **estado resultante, dentro da transação**: aplica-se a mudança, contam-se os administradores ativos, e se sobrar zero tudo é desfeito. Conferir antes, por regra separada, duplicaria a lógica — e as duas versões divergiriam em silêncio.

"Administrador ativo" é quem tem `rbac.manage` em escopo global, numa atribuição não vencida, com pessoa não removida e **conta de acesso ativa**. Um administrador sem conta não destranca nada.

### D-M03-3 — Reautenticação antes do formulário, não depois

`[REQ]` O ADR 0004 exige reautenticação para alterar acesso. A janela é de 15 minutos, e o login já conta como reautenticação.

Ela é pedida **ao abrir** a tela de alteração, não ao enviar: pedir a senha depois de a pessoa marcar vinte permissões jogaria o trabalho fora. O servidor continua recusando o envio sem reautenticação recente — a tela só antecipa a pergunta.

### D-M03-4 — Exclusão de papel

`[REQ]` Papéis de sistema não se excluem, mas **suas permissões se editam** (seção 11.3). Papel personalizado só se exclui **vazio**: quem ainda o tem precisa perder o papel antes, cada remoção auditada individualmente. A alternativa — cascata — removeria acessos em lote sem deixar rastro de quem perdeu o quê.

### D-M03-5 — Convite exige papel

`[DEC]` Só se convida quem já tem papel. Uma conta sem papel entraria num app em que não pode fazer nada. A tela de acesso mostra os dois passos na ordem certa.

O link vai pelo WhatsApp com texto pronto (`wa.me`), como prevê a seção 18 — custo zero, sem API paga.

### D-M03-6 — "Própria conta" é categoria do guarda de arquitetura

`[DEC]` Trocar a senha, ver os próprios dispositivos e confirmar a própria senha não dependem de permissão: dependem de **estar autenticado**. O teste `rotas-declaram-permissao` ganha uma terceira categoria explícita, ao lado de "protegida" e "pública", e verifica que essas rotas recusam quem não tem sessão.

### Fora deste módulo

- Segundo fator TOTP (RF-01.5, `Should`) — recomendado para quem tem `rbac.manage`; fica para a V1.1.
- Papel temporário com data de validade na tela — o banco já suporta `expires_at`.
- Concessão automática de papel ao mudar de estágio (`grants_role_id`).
- Escopo de grupo na interface — M04.

---

## 4. O que será construído

### 4.1 Banco

Migração 0004: `role.default_scope`, com CHECK e preenchimento dos papéis já semeados.

### 4.2 Telas

| Rota                   | Permissão                       | O que faz                                                |
| ---------------------- | ------------------------------- | -------------------------------------------------------- |
| `/admin/papeis`        | `rbac.manage` global            | Papéis, quantas pessoas e quantas permissões cada um tem |
| `/admin/papeis/novo`   | `rbac.manage` global            | Papel personalizado (RF-03.4)                            |
| `/admin/papeis/[id]`   | `rbac.manage` global            | Permissões por recurso, quem tem o papel, exclusão       |
| `/pessoas/[id]/acesso` | `rbac.manage` / `person.invite` | Papéis da pessoa, atribuir, retirar, convidar            |
| `/conta/confirmar`     | própria conta                   | Reautenticação, com retorno seguro à tela de origem      |

E a **barra inferior** (G4), com itens que dependem das permissões de quem está usando.

### 4.3 Matriz de permissões

Teste que cruza **cada papel semeado × cada permissão × cada tipo de contexto** e confere o resultado contra a especificação de escopo. Gera também `tests/unit/__snapshots__/matriz-de-permissoes.md`, uma tabela legível: qualquer mudança na semente aparece no diff como uma linha da tabela, e não como um array perdido num arquivo de código.

---

## 5. Regras de negócio aplicáveis

| ID       | Regra                                 | Como é garantida                                    |
| -------- | ------------------------------------- | --------------------------------------------------- |
| RF-03.1  | Papéis e permissões são dados         | Já no M01; agora editáveis pela tela                |
| RF-03.2  | Atribuição com escopo                 | `default_scope` do papel; grupo no M04              |
| RN-28    | Mudança de acesso é auditada          | Toda alteração grava antes e depois                 |
| ADR 0004 | Reautenticação para operação sensível | Serviço recusa sem reautenticação de até 15 minutos |

---

## 6. Riscos

| Risco                                               | Mitigação                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A comunidade se trancar fora do próprio sistema     | Trava do último administrador, testada pelos três caminhos que podem violá-la        |
| Escalada de privilégio por papel personalizado      | "Ninguém concede o que não tem", testada com um administrador de permissões parciais |
| Mudança de permissão sem efeito até o próximo login | O ator é recarregado a cada requisição; teste confirma efeito imediato               |
| Redirecionamento aberto na volta da reautenticação  | Só caminhos relativos internos; teste com `//`, esquema e barra invertida            |

---

## 7. Critérios de aceitação

Verificado em **04/10/2026**: `npm test` → **225 testes** · `npm run test:e2e` → **53 testes** em dois projetos de navegador · `npm run check` → **0 erros em 733 arquivos** · `npm run build` → sucesso · **4 KB** de JS de entrada comprimido.

### ✅ Entregável do roteiro (seção 19.1)

| Critério                              | Evidência                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Matriz de permissões 100% testada** | `matriz-de-permissoes.test.ts`: cada papel semeado × cada permissão × cinco tipos de contexto, conferido contra uma especificação de escopo escrita à mão — não contra a própria política. Gera `tests/unit/__snapshots__/matriz-de-permissoes.md`, uma tabela legível: mudar a semente aparece no diff como uma linha de tabela |
| **4 papéis com escopo funcionando**   | A mesma matriz, mais `rbac.test.ts` atribuindo e retirando papéis pela tela e pelo serviço                                                                                                                                                                                                                                       |

### ✅ Travas (D-M03-2), cada uma conferida no ESTADO DO BANCO depois da recusa

| Trava                               | Evidência                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Só `rbac.manage` global administra  | Membro e conselheiro recebem `PolicyDenied`; a rota responde 403                                                                                                             |
| Ninguém concede o que não tem       | Administrador parcial ("Secretaria") não cria papel com `finance.view_all`, não dá o papel de Líder, não acrescenta permissão a papel — mas pode retirar                     |
| Ninguém altera o próprio acesso     | Nem para se dar, nem para se tirar um papel; a tela explica em vez de oferecer                                                                                               |
| Sempre resta um administrador ativo | Tirar `rbac.manage` do papel Líder é recusado e **a transação volta inteira**; retirar o último administrador com conta ativa é recusado mesmo por quem administra sem conta |
| Reautenticação recente              | Toda alteração recusada sem senha confirmada; e2e percorre o pedido de senha e a volta para a tela de origem                                                                 |

### ✅ Lacunas fechadas

| Lacuna                                      | Evidência                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 — emitir convite                         | e2e: líder cadastra, dá papel, gera convite com link do WhatsApp                                                                                               |
| **G2 — conta sem identificador**            | e2e: a pessoa aceita o convite, **sai, e entra de novo** com o telefone escrito de outro jeito. Integração: o teste do fluxo agora usa o mesmo serviço da rota |
| G3 — telefone sem normalizar                | Login e aceite usam `interpretarIdentificador`; a chave do limite de tentativas também é normalizada — antes, variar a formatação zerava o limite              |
| G4 — navegação                              | Barra inferior por papel; e2e confere os itens de cada papel                                                                                                   |
| G5 — `/conta/sessoes` barrava o conselheiro | Nova categoria "própria conta" no guarda de arquitetura; e2e com o conselheiro                                                                                 |
| G6 — `canAnywhere` sem teste                | Testes diretos em `policy.test.ts` e na matriz                                                                                                                 |
| **G7 — recuperação impossível**             | Convite para quem já tem conta troca a senha e **encerra todas as sessões**; testado em integração                                                             |

### Encontrado na revisão de segurança, e corrigido

**Corrida na trava do último administrador.** Se os dois únicos administradores retirassem o papel um do outro no mesmo instante, cada transação conferiria a trava enxergando o outro ainda lá — as duas passariam, e a equipe ficaria com zero. As alterações que podem reduzir administradores agora tomam um `pg_advisory_xact_lock` por equipe como primeira instrução, o que as serializa; o lock se libera sozinho no commit ou no rollback.

O guarda de arquitetura passou a varrer também `+layout.server.ts`: layout carrega dado e pode vazá-lo.

### Risco residual, aceito e registrado

Quem pode convidar pode **redefinir a senha de quem já tem conta** — é o que o ADR 0004 determina como recuperação. Mitigações: exige reautenticação; vai para a auditoria; encerra todas as sessões da pessoa, que percebe na hora porque sai da conta em todos os aparelhos. Hoje só o líder convida; quando o conselheiro puder (M04), a regra vale para os grupos dele.

### ⬜ Fora deste módulo

Segundo fator (TOTP), papel temporário pela tela, concessão automática de papel por estágio e atribuição com escopo de grupo — esta última chega no M04, pela tela do grupo.
