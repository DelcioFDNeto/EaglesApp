# Módulo 04 — Grupos/PGs

- **Status:** **implementado** e verificado em 04/10/2026
- **Ciclo:** MVP, semanas 5–6
- **Depende de:** M02 (pessoas), M03 (papéis com escopo) — estáveis
- **Bloqueia:** M05 (o PG semanal é um evento recorrente **do grupo**) e M06 (presença por grupo)
- **Deploy:** por decisão da liderança (04/10/2026), a implantação na VPS é a **última etapa** do roteiro. Os módulos seguem sendo entregues e verificados localmente e no CI.

---

## 1. Objetivo

Dar ao escopo de grupo algo para apontar. Até o M03, "conselheiro do PG Azul" era uma linha em `person_role` com um id que não existia em tabela nenhuma — e, na prática, o conselheiro não editava, não convidava e não acompanhava ninguém.

O entregável do roteiro (seção 19.1) é **"PGs criados, membros distribuídos, transferência com histórico, visão do conselheiro"**.

---

## 2. O que a leitura do código revelou antes de começar

| #   | Lacuna                                                                                                                                                                                                 | Origem | Gravidade |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------- |
| G1  | **O conselheiro vê o contato de todo mundo.** O M02 decidiu contato com `canAnywhere(person.view_sensitive)`, porque não havia grupo para restringir. Com grupos, isso vira vazamento entre PGs        | M02    | **alta**  |
| G2  | Verificações sobre uma pessoa passam só `{ personId }`. Sem o grupo no contexto, a atribuição de escopo de grupo nunca autoriza — o conselheiro não edita nem convida ninguém, nem do próprio PG       | M02    | alta      |
| G3  | `person_role.scope_id` não tem chave estrangeira: aceita o id de um grupo que não existe. A semente grava dois desses                                                                                  | M01    | média     |
| G4  | RN-08 fala em `group.manage` para alterar composição, mas o catálogo separa `group.manage` ("criar, editar e remover") de `group.assign_member` ("transferir membros"). Documento e código discordavam | doc    | baixa     |

G1 e G2 são a mesma falha vista de dois lados: **a pessoa não tinha contexto de grupo**. Uma só correção — `contextoDaPessoa` — fecha as duas.

Mais duas da mesma família apareceram **durante** a implementação, quando o escopo de grupo passou a valer de verdade:

| #   | Lacuna                                                                                                                                                                                                                                     | Origem | Gravidade |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------- |
| G5  | O perfil mostrava os **vínculos** (irmão, cônjuge, responsável legal) a qualquer um com `person.view` — o catálogo lista vínculos entre os dados sensíveis                                                                                 | M02    | média     |
| G6  | **Remover vínculo** conferia a permissão sobre a pessoa informada, mas apagava o vínculo pelo id — sem conferir se ele era daquela pessoa. Com uma pessoa do próprio grupo como pretexto, apagava-se o vínculo entre duas pessoas de outro | M02    | **alta**  |

Nenhuma das duas era explorável antes do M04, porque só o escopo global autorizava alguma coisa. Viraram portas no instante em que o escopo de grupo passou a funcionar — e por isso entram neste módulo, não num próximo.

---

## 3. Decisões deste módulo

### D-M04-1 — Uma verdade só para "quem cuida do grupo"

`[DEC]` A seção 12.2 previa `group.advisor_person_id`. Não entra: o conselheiro de um grupo **já é** uma atribuição `conselheiro` com escopo naquele grupo. Guardar também uma coluna criaria duas respostas para "quem cuida do PG Azul?", e elas divergiriam no primeiro descuido.

A tela do grupo lista como **responsáveis** as atribuições de papel de escopo `group` que apontam para ele, e é dali que se atribuem — com as quatro travas e a reautenticação do M03.

A tabela chama-se `small_group`: `group` é palavra reservada do SQL e exigiria aspas em toda consulta escrita à mão.

### D-M04-2 — Pertencimento é temporal e o banco garante

`[REQ]` RN-06 e RN-07, como restrição de banco:

| Regra                                         | Mecanismo                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| No máximo um grupo ativo por pessoa (RN-06)   | Índice único parcial em `group_membership (person_id) WHERE left_at IS NULL`                      |
| Nada é sobrescrito (RN-07)                    | Gatilho: a única alteração aceita é **encerrar** um vínculo aberto, uma vez. `DELETE` é recusado  |
| Saída não antecede a entrada                  | `CHECK (left_at >= joined_at)`                                                                    |
| Ninguém entra em grupo arquivado              | Gatilho na inserção                                                                               |
| Pessoa e grupo da mesma equipe                | Gatilho na inserção                                                                               |
| Grupo só se arquiva vazio                     | Gatilho em `small_group`: recusa arquivar com vínculo aberto                                      |
| `person_role.scope_id` aponta para grupo real | Chave estrangeira — depois de criar, para ids órfãos de instalações existentes, grupos "a nomear" |

Transferir é encerrar e abrir **no mesmo instante e na mesma transação**: a linha do tempo nunca mostra a pessoa em dois grupos nem em nenhum.

### D-M04-3 — Permissão por operação

`[DEC]` Corrige G4 — o catálogo é a referência, e RN-08 passa a citar `group.assign_member`.

| Operação                             | Permissão                      | Escopo exigido                                              |
| ------------------------------------ | ------------------------------ | ----------------------------------------------------------- |
| Ver grupos e quem está neles         | `group.view`                   | qualquer — como a lista da equipe (D-M02)                   |
| Criar grupo                          | `group.manage`                 | **global** — grupo novo ainda não é escopo de ninguém       |
| Editar nome, dia, horário, local     | `group.manage`                 | do grupo                                                    |
| Arquivar / reativar                  | `group.manage`                 | **global**, e só grupo vazio                                |
| Colocar no grupo quem está sem grupo | `group.assign_member`          | do grupo de destino                                         |
| Retirar do grupo                     | `group.assign_member`          | do grupo de origem                                          |
| Transferir                           | `group.assign_member`          | **origem e destino**                                        |
| Atribuir ou retirar responsável      | `rbac.manage` + reautenticação | global (travas do M03)                                      |
| Reorganizar em lote                  | `group.assign_member`          | global para abrir a tela; cada movimento verificado de novo |

Transferir exige as duas pontas: um conselheiro não empurra ninguém para o grupo de outro. Arquivar exige global porque esvaziar um grupo é mover gente para **outros** grupos, o que o escopo de um grupo só já não permitiria.

O papel de conselheiro ganha `group.manage` na semente: com escopo do grupo, isso significa **editar o combinado do próprio PG** — dia, horário, local — e nada além.

O que está escrito na seção 5.3 ("líderes e conselheiros criam, editam, excluem grupos") continua possível sem código: basta um papel personalizado de escopo global com `group.manage`. É configuração da liderança, não decisão do sistema.

### D-M04-4 — O grupo é o contexto da pessoa

`[DEC]` Toda verificação **sobre uma pessoa** passa a levar `{ personId, groupId }`, onde `groupId` é o grupo atual dela. Corrige G1 e G2 de uma vez:

- contato, observações e vínculos: `person.view_sensitive` no grupo da pessoa — o conselheiro vê os do próprio PG, e não os do PG vizinho;
- editar, mudar estágio, convidar: `person.update` / `person.invite` no grupo da pessoa;
- **pessoa sem grupo** só é alcançada por quem tem a permissão em escopo global.

Consequência no cadastro: quem não tem `person.create` global **escolhe um dos próprios grupos** ao cadastrar. Sem isso, o conselheiro criaria alguém que ele mesmo deixaria de enxergar no instante seguinte.

A lista da equipe continua visível a quem tem `person.view` em qualquer escopo, mas o telefone é decidido **linha a linha**.

### D-M04-5 — Reorganização em lote: planejar, conferir, aplicar

`[REQ]` RN-09 e o fluxo F4, sem a IA (que é V2.0): a liderança monta a distribuição numa tela, vê o **antes e depois de cada grupo**, desmarca o que não quer e só então aplica.

- A proposta **não é gravada**: viaja no formulário, com o grupo de origem que cada pessoa tinha quando foi planejada.
- Ao aplicar, tudo acontece numa transação, e **cada movimento confere a origem de novo**. Se alguém mudou de grupo entre o planejamento e a aplicação, nada é aplicado e a tela diz quem mudou. É o "a proposta expira" do F4, decidido pelo estado e não pelo relógio.
- Aceite parcial é desmarcar linhas antes de aplicar.
- Cada movimento gera seu próprio registro de auditoria, ligado a um identificador do lote.

É também a ferramenta da **primeira distribuição**: no dia em que o app entra no ar, a comunidade inteira precisa ser colocada nos PGs, e fazer isso perfil por perfil não seria realista.

### D-M04-6 — Visão do conselheiro: o que já existe

`[DEC]` RF-04.3 pede "pessoas, frequência, pendências". Frequência depende de presença registrada — chega com o **M06**, e a tela já reserva o lugar. Neste módulo, a visão do grupo mostra:

- quem está no grupo, com estágio, desde quando e o contato (quando permitido);
- **pendências que já se podem calcular**: cadastro em regime restrito (idade desconhecida ou menor sem responsável), pessoa sem acesso ao app;
- quem são os responsáveis e o combinado do grupo (dia, horário, local).

### Fora deste módulo

- Sugestão automática de divisão (RF-04.5, `Could`) — V2.0, com histórico de presença.
- Data de entrada retroativa ("está no PG Azul desde 2023") — `[FUT]`; hoje o vínculo começa quando é registrado.
- Despesas do grupo (RF-08.8) — V1.2.
- Evento recorrente do PG — M05, que usará dia, horário e local do grupo como ponto de partida.

---

## 4. O que será construído

### 4.1 Banco

| Tabela             | Colunas                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `small_group`      | `team_id`, `name`, `color`, `description`, `meeting_weekday` (0–6), `meeting_time`, `location`, `archived_at`, carimbos de tempo |
| `group_membership` | `group_id`, `person_id`, `joined_at`, `left_at`, `left_reason`, `added_by_person_id`, `ended_by_person_id`, `batch_id`           |

Mais: nome único entre grupos ativos da equipe (sem diferenciar maiúsculas), chave estrangeira em `person_role.scope_id` e os gatilhos de D-M04-2.

### 4.2 Telas

| Rota                  | Permissão                       | O que faz                                                           |
| --------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `/grupos`             | `group.view` em qualquer escopo | Grupos ativos, quantas pessoas, responsáveis; "meus grupos" no topo |
| `/grupos/novo`        | `group.manage` global           | Novo grupo                                                          |
| `/grupos/[id]`        | `group.view` em qualquer escopo | Visão do grupo (D-M04-6), colocar pessoa, responsáveis, arquivar    |
| `/grupos/[id]/editar` | `group.manage` no grupo         | Nome, cor, dia, horário, local, descrição                           |
| `/grupos/reorganizar` | `group.assign_member` global    | Planejar → conferir → aplicar (D-M04-5)                             |

E, nas telas existentes: grupo no perfil da pessoa, com **mudar de grupo**; escolha de grupo no cadastro; entradas e saídas de grupo na **linha do tempo**; item **Grupos** na barra inferior.

---

## 5. Regras de negócio aplicáveis

| ID    | Regra                                          | Como é garantida                                                    |
| ----- | ---------------------------------------------- | ------------------------------------------------------------------- |
| RN-06 | Um grupo por vez                               | Índice único parcial — teste tenta burlar pelo banco, sem serviço   |
| RN-07 | Transferência encerra e cria; nada sobrescrito | Gatilho de encerramento único; teste tenta reescrever o passado     |
| RN-08 | Composição só com permissão no grupo           | `group.assign_member` na origem e no destino, verificado no serviço |
| RN-09 | Reorganização nunca altera sem confirmação     | Planejar não grava nada; aplicar exige a confirmação explícita      |
| RN-28 | Composição é auditada                          | Um registro por movimento, com o lote                               |
| RN-32 | Contato só para quem tem `view_sensitive`      | Agora com o escopo do grupo da pessoa                               |

---

## 6. Riscos

| Risco                                                                       | Mitigação                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Escopo vazando entre grupos                                                 | Testes com dois conselheiros, um de cada PG, conferindo contato, edição e convite cruzados        |
| Conselheiro "puxa" para o próprio grupo alguém sem grupo para ver o contato | É permitido — é como o visitante chega ao PG (F1) — e fica auditado e na linha do tempo da pessoa |
| Reorganização aplicada sobre um estado que mudou                            | Cada movimento confere a origem planejada; qualquer divergência aborta o lote inteiro             |
| Migração quebrar instalação existente com `scope_id` órfão                  | Grupos "a nomear" criados antes da chave estrangeira; teste de migração com órfão                 |
| Dia e horário do grupo divergirem do evento recorrente do M05               | Registrado: no M05, o grupo é o ponto de partida do evento, não uma segunda fonte                 |

---

## 7. Critérios de aceitação

Verificado em **04/10/2026**: `npm test` → **274 testes** (44 novos em `grupos.test.ts`) · `npm run test:e2e` → **63 testes** em dois projetos de navegador · `npm run check` → **0 erros** · `npm run build` → sucesso.

### ✅ Entregável do roteiro (seção 19.1)

| Critério                        | Evidência                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **PGs criados**                 | Tela `/grupos/novo`; semente com PG Azul e PG Verde; `grupos.spec.ts` cria, coloca, devolve e arquiva              |
| **Membros distribuídos**        | Reorganização em lote — com JavaScript (`grupos.spec.ts`) e **sem** (`sem-javascript.spec.ts`)                     |
| **Transferência com histórico** | Saída e entrada no mesmo instante, conferidas no banco; a linha do tempo mostra **um** fato ("PG Azul → PG Verde") |
| **Visão do conselheiro**        | `/grupos/[id]` com estágio, contato, desde quando e pendências; "Seu grupo" no início                              |

### ✅ Garantias de banco (D-M04-2), testadas com SQL direto, sem o serviço

| Critério                                                | Evidência                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| RN-06: segundo vínculo aberto recusado                  | Índice único parcial                                                        |
| RN-07: trocar grupo, reabrir, reescrever motivo, apagar | Gatilho `vinculo_de_grupo_so_encerra` + `recusa_alteracao`                  |
| Grupo não se apaga; só se arquiva vazio                 | Gatilhos em `small_group`                                                   |
| Grupo arquivado não recebe pessoas nem responsáveis     | Gatilhos de inserção em `group_membership` e `person_role`                  |
| `person_role.scope_id` aponta para grupo real           | Chave estrangeira                                                           |
| Instalação anterior ao M04 não perde acesso             | Teste aplica 0000–0004, cria conselheiro com escopo órfão, aplica 0005–0006 |

### ✅ Escopo (D-M04-3, D-M04-4), com dois conselheiros, um de cada PG

| Critério                                                                               | Evidência                                                               |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Conselheiro vê contato, edita e convida no próprio PG — e mais ninguém                 | `grupos.test.ts` (serviço) e `grupos.spec.ts` (tela, lista e perfil)    |
| Pessoa sem grupo só é alcançada por escopo global                                      | `grupos.test.ts`                                                        |
| Transferência exige permissão nas duas pontas, e a recusa não muda nada                | `grupos.test.ts`                                                        |
| Cadastro do conselheiro nasce no grupo dele; grupo arquivado desfaz o cadastro inteiro | `grupos.test.ts`, `grupos.spec.ts`                                      |
| G1 e G6 pegos pelos testes                                                             | Mutação: reverter cada correção faz o teste correspondente falhar       |
| Matriz de permissões                                                                   | Snapshot atualizado: `group.manage` do conselheiro passa a "✓ no grupo" |

### ✅ Reorganização (D-M04-5)

| Critério                                              | Evidência                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| Pré-visualização não grava                            | Contagem de vínculos antes e depois de planejar                    |
| Aceite parcial                                        | Desmarcar na conferência; só o marcado é aplicado, com `batch_id`  |
| Mudança concorrente aborta o lote e diz quem mudou    | `PlanoDesatualizado` lista a pessoa; o movimento válido é desfeito |
| Sem JavaScript, os seletores já vêm com o grupo atual | `sem-javascript.spec.ts` confere que só UMA mudança aparece        |

### O que mudou em relação ao plano

- **"Saíram nos últimos 90 dias"** na visão do grupo — não estava no plano; apareceu ao usar a tela. Quem saiu duas vezes aparece uma, pela saída mais recente.
- **`FalhaDeFormulario`** tinha um padrão de tipo que recusava qualquer formulário sem campos extras; corrigido no tipo compartilhado.

### Pendente

- Frequência na visão do grupo — chega com o M06; a tela diz isso em vez de mostrar coluna vazia.
- Data de entrada retroativa no grupo (`[FUT]`).
