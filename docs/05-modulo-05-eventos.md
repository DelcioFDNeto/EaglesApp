# Módulo 05 — Eventos

- **Status:** **implementado** e verificado em 10/10/2026
- **Ciclo:** MVP, semanas 7–8
- **Depende de:** M03 (papéis com escopo), M04 (grupos) — estáveis
- **Bloqueia:** M06 (RSVP e presença se prendem a uma ocorrência de evento)
- **Deploy:** continua sendo a última etapa do roteiro (decisão de 04/10/2026)

---

## 1. Objetivo

Pôr a agenda dos Eagles dentro do app: o PG de toda semana, os encontros gerais, os eventos especiais — cada um com quem está convidado. O entregável do roteiro (seção 19.1) é **"PG semanal recorrente, calendário mobile, público-alvo, link público do evento"**.

O teste de corte do MVP continua o mesmo: _sem isso, a liderança consegue usar o app para o PG da próxima quinta-feira?_ Sem eventos, não: não há onde confirmar presença (M06) nem o que compartilhar no WhatsApp.

---

## 2. O que a leitura do código revelou antes de começar

| #   | Lacuna                                                                                                                                                                          | Origem | Gravidade |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------- |
| G1  | **A equipe não tem fuso horário.** "Quinta às 20h" só vira um instante no tempo quando se sabe de onde; hoje o servidor usaria o fuso da máquina — na VPS, quase certamente UTC | M01    | alta      |
| G2  | A barra inferior já tem 5 itens para o líder (o limite do Anexo A.3). A agenda seria o sexto                                                                                    | M03    | média     |
| G3  | O modelo previa `recurrence_rule` em texto RRULE, que o banco não consegue validar e cuja interpretação exigiria uma biblioteca inteira para usar só "toda semana"              | doc    | média     |

Mais três apareceram durante a implementação:

| #   | Lacuna                                                                                                                                                                                                                   | Origem | Gravidade |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------- |
| G4  | **Teste instável no M04.** A linha do tempo confundia um vínculo de grupo consigo mesmo quando entrada e saída caíam no mesmo instante — o relógio do PGlite tem resolução grossa e isso acontecia em 2 de 3 execuções   | M04    | média     |
| G5  | **Formulários rolavam para o lado no celular.** Campos de data e hora têm largura própria grande no Chrome; dois lado a lado estouravam a tela. Só apareceu nos formulários longos do M05, mas o componente era de todos | M01    | média     |
| G6  | Uma série encerrada **antes de começar** ficava com fim igual ao início — e continuava contando como "em andamento", impedindo arquivar o grupo                                                                          | M05    | baixa     |

G4 ganhou ordem explícita para empates; G5, campos que encolhem e um teste que mede a largura de cada tela de eventos; G6, a regra "pode terminar na véspera do início" no banco e uma definição só de "em andamento".

---

## 3. Decisões deste módulo

### D-M05-1 — Recorrência semanal, em colunas, não RRULE em texto

`[DEC]` Corrige G3. A série guarda **dia da semana, horário local, duração, a cada quantas semanas (1 a 4), início e fim opcional** — colunas que o banco valida com `CHECK`. Cobre o PG semanal e o quinzenal, que é o que existe hoje.

RRULE completa (mensal, "toda terceira sexta") fica `[FUT]`: o dia em que for necessária, a série ganha uma coluna nova e as atuais continuam válidas. O contrário — guardar texto livre agora — deixaria o banco aceitar regras que o código não sabe ler.

### D-M05-2 — Materializar 12 semanas, sob demanda

`[DEC]` Mantém A-04 (seção 22): cada ocorrência das próximas **12 semanas** é uma linha real em `event`, porque presença e RSVP (M06) precisam de uma linha para se prender.

O que muda é **quando** se materializa: em vez de um agendador, a agenda completa a janela ao ser lida. A operação é idempotente (índice único em `série + data`) e serializada por série (`FOR UPDATE`), então duas pessoas abrindo a agenda ao mesmo tempo não duplicam nada. Dispensa o pg-boss até o M08, quando ele chega para os lembretes.

### D-M05-3 — Instante no banco, hora local na série

`[DEC]` Corrige G1. A equipe ganha `timezone` (padrão `America/Sao_Paulo`). Cada ocorrência guarda o **instante** (`timestamptz`); a série guarda a **hora local** ("20:00"). A conversão é feita uma vez, ao materializar, com as regras de fuso do sistema — e testada com um fuso que tem horário de verão, porque o Brasil pode voltar a ter.

Toda data exibida é formatada no fuso da equipe, no servidor e no navegador. Sem isso, a mesma tela mostraria horas diferentes antes e depois de hidratar.

### D-M05-4 — Ocorrência editada se desprende da série

`[DEC]` O comportamento de qualquer agenda de celular:

| Ação                                        | Efeito                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Editar ou cancelar **uma** ocorrência       | Só ela muda, e passa a ser **exceção**: alterações futuras da série não a sobrescrevem        |
| Editar a **série** (título, horário, local) | Alcança as ocorrências **futuras que não são exceção**; o passado não muda                    |
| Mudar o **dia** ou o **intervalo**          | Não se edita: encerra-se a série e cria-se outra — "PG Azul passou para terça" é um fato novo |
| **Encerrar** a série numa data              | Ocorrências futuras não desprendidas deixam de existir                                        |

A última linha vale enquanto ocorrência não tem dado próprio. No M06, ocorrência com RSVP ou presença será **cancelada**, nunca apagada — registrado aqui para o M06 não esquecer.

### D-M05-5 — Público-alvo: equipe, grupos, pessoas

`[REQ]` RF-05.5. Um evento convida **a equipe inteira**, **grupos** ou **pessoas** — qualquer combinação dos dois últimos. O padrão segue o evento: evento de grupo convida o grupo; evento geral convida a equipe.

`[DEC]` Quem gerencia eventos só no escopo de um grupo convida **o próprio grupo e pessoas avulsas** — um visitante, um palestrante convidado. "A equipe inteira" e outros grupos exigem escopo global: anunciar para todo mundo é decisão da liderança.

### D-M05-6 — Rascunho e publicação

`[DEC]` O catálogo já separa `event.manage` (criar, editar) de `event.publish` (publicar para o público). Evento nasce **rascunho**, visível só para quem pode gerenciá-lo; quem tem `event.publish` publica — no próprio formulário, com uma caixa marcada por padrão, para não virar um passo a mais no caso comum. Publicar uma série publica as ocorrências futuras e as que ainda vão ser materializadas.

### D-M05-7 — Quem vê o quê

`[DEC]`

| Quem                                   | Vê                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `event.view` global                    | Todos os eventos, inclusive rascunhos de quem pode gerenciar                           |
| `event.view` / `event.manage` de grupo | Os eventos do grupo e os que convidam o grupo                                          |
| Qualquer pessoa com `event.view`       | Os eventos **publicados** para os quais foi convidada: equipe, o grupo dela, ela mesma |

"Minha agenda" é a terceira linha para todo mundo — inclusive para o líder, cuja agenda pessoal não deve vir lotada com o PG de cada grupo.

### D-M05-8 — Link público do evento

`[REQ]` Seção 18: o link curto que circula no WhatsApp é "o que faz o app circular na comunidade". `/e/<código>` abre **sem login** e mostra título, tipo, data, hora, local e grupo do evento — nada sobre quem vai. O RSVP por esse link chega no M06.

`[DEC]` O código tem **10 caracteres aleatórios** (cerca de 59 bits), não 4 como no exemplo da seção 18: o local de um PG costuma ser a casa de alguém, e um código curto se adivinha. A página responde só para evento **publicado**, pede aos buscadores para não indexar, e mostra "cancelado" quando for o caso — quem recebeu o link antigo precisa saber.

### D-M05-9 — Barra inferior: Início, Agenda, Pessoas, Grupos, Mais

`[DEC]` Corrige G2. "Acessos" e "Conta" saem da barra e vão para **Mais**, que reúne o que é de uso eventual: a própria conta, papéis e acessos, tipos de evento. Agenda é uso de toda semana; administração de acesso, não.

### D-M05-10 — Tipos de evento são dados

`[REQ]` RN-10. Semente com quatro tipos — encontro de PG, encontro geral, reunião de liderança, evento especial —, editáveis em tela por quem tem `settings.manage`. Tipo com eventos não se apaga, arquiva-se.

Uma propriedade, não um nome, marca **qual tipo é o do encontro do grupo**: é ela que o botão "criar o encontro semanal" do grupo procura. Mesma regra dos estágios no M02 — nenhum código compara chave com literal.

### Fora deste módulo

- RSVP, presença e o "confirmar em um toque" do link público — **M06**.
- Escala de responsabilidades no evento — M07.
- Lembretes e notificações — M08.
- Anexos (RF-05.6, `Could`) e recorrência mensal — `[FUT]`.
- Visualização em grade mensal: a agenda é uma **lista por dia, navegável por mês** — o formato que cabe num celular.

---

## 4. O que será construído

### 4.1 Banco

| Tabela           | Papel                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `team.timezone`  | Fuso da equipe (G1)                                                                                                    |
| `event_type`     | Tipos configuráveis; `is_group_meeting` marca o do encontro do grupo (um por equipe)                                   |
| `event_series`   | Definição da recorrência semanal e até onde já foi materializada                                                       |
| `event`          | Uma ocorrência ou um evento avulso: instante, local, grupo, responsável, situação, publicação, exceção, código público |
| `event_audience` | Quem é convidado — de um evento ou de uma série: equipe, grupo ou pessoa                                               |

### 4.2 Telas

| Rota                     | Permissão                         | O que faz                                                           |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------- |
| `/agenda`                | `event.view` em qualquer escopo   | Lista por dia, navegável por mês; "minha agenda" e a do grupo       |
| `/agenda/novo`           | `event.manage` em algum escopo    | Evento avulso ou semanal                                            |
| `/agenda/[id]`           | ver o evento (D-M05-7)            | Detalhe, link público, compartilhar no WhatsApp, publicar, cancelar |
| `/agenda/[id]/editar`    | `event.manage` no grupo do evento | Edita a ocorrência (vira exceção)                                   |
| `/agenda/series/[id]`    | `event.manage` no grupo da série  | Edita a série, publica, encerra                                     |
| `/e/[codigo]`            | **pública**                       | Página do evento para quem recebeu o link                           |
| `/admin/tipos-de-evento` | `settings.manage` global          | Tipos de evento                                                     |
| `/mais`                  | própria conta                     | Conta, acessos, tipos de evento, sair                               |

E nas telas existentes: **próximos encontros** no início e na visão do grupo, com o atalho "criar o encontro semanal" a partir do combinado que o M04 já guarda.

---

## 5. Regras de negócio aplicáveis

| ID     | Regra                               | Como é garantida                                                  |
| ------ | ----------------------------------- | ----------------------------------------------------------------- |
| RN-10  | Tipos de evento são dados           | Tabela, semente e tela; nenhum literal de tipo no código          |
| RN-14  | Check-in nunca condiciona a entrada | Nada neste módulo exige check-in; a chave continua desligada      |
| RN-15  | Ausência de RSVP não é falta        | Sem RSVP neste módulo; regra registrada para o M06                |
| RN-28  | Alterações relevantes são auditadas | Criar, editar, publicar, cancelar e encerrar série geram registro |
| RNF-01 | Mobile-first                        | Agenda em lista por dia; formulários em uma coluna                |

---

## 6. Riscos

| Risco                                                       | Mitigação                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Hora errada por fuso (servidor em UTC, navegador no Brasil) | Fuso da equipe explícito em toda conversão e formatação; teste com fuso que tem horário de verão |
| Ocorrências duplicadas por materialização concorrente       | Índice único `série + data` e trava por série; teste com duas materializações simultâneas        |
| Edição da série apagar ajuste feito numa ocorrência         | Exceções nunca são tocadas pela série; teste específico                                          |
| Endereço de casa exposto pelo link público                  | Código de 10 caracteres, só eventos publicados, `noindex`                                        |
| Conselheiro anunciando para a comunidade inteira            | "Equipe inteira" e outros grupos exigem escopo global                                            |

---

## 7. Critérios de aceitação

Verificado em **10/10/2026**: `npm test` → **344 testes** (39 de integração e 23 de unidade novos) · `npm run test:e2e` → **73 testes** em dois projetos de navegador · `npm run check` → **0 erros em 810 arquivos** · `npm run build` → sucesso.

### ✅ Entregável do roteiro (seção 19.1)

| Critério                  | Evidência                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PG semanal recorrente** | Atalho do grupo → série com o combinado do PG → 12 semanas na agenda (`eventos.spec.ts`); materialização idempotente e sem duplicar (`eventos.test.ts`) |
| **Calendário mobile**     | `/agenda` em lista por dia, navegável por mês, com filtros por papel; nenhuma tela de eventos rola para o lado (teste mede a largura)                   |
| **Público-alvo**          | Equipe, grupos e pessoas; seis eventos × cinco papéis conferidos um a um                                                                                |
| **Link público**          | `/e/<código>` abre sem login, com `noindex`, mostra o cancelamento e nada sobre pessoas (`eventos.spec.ts`, `eventos.test.ts`)                          |

### ✅ Fuso e recorrência (D-M05-1, D-M05-3)

| Critério                                         | Evidência                                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| "Quinta às 20h" é 23h UTC em São Paulo           | `fuso-e-recorrencia.test.ts`, e todas as ocorrências materializadas conferidas no fuso |
| Mesma hora local atravessando horário de verão   | Nova York, 5/3 e 12/3/2026: instantes diferentes, 20h nos dois                         |
| Hora que não existe e hora que existe duas vezes | 2h30 de 8/3 vira 3h30; 1h30 de 1/11 fica com a primeira                                |
| "Hoje" é o da equipe                             | Às 2h UTC ainda é ontem em São Paulo                                                   |
| Quinzenal conta a partir da primeira ocorrência  | Pedir a partir do meio da quinzena não muda a paridade                                 |

### ✅ Série (D-M05-2, D-M05-4)

| Critério                                               | Evidência                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Materializar de novo ou concorrentemente não duplica   | Marcador voltado para trás + duas materializações simultâneas: mesmas linhas, mesmo público |
| A janela anda com o tempo                              | Uma semana depois, exatamente uma ocorrência a mais                                         |
| Série antiga não materializa o passado                 | Série com início em 2024 começa em hoje                                                     |
| Exceções sobrevivem à edição da série                  | Data editada e data cancelada intactas; as demais com o horário novo                        |
| Encerrar remove só o futuro não ajustado — e não volta | Materializar 60 dias depois não recria nada                                                 |
| Evento avulso ou passado não se apaga                  | Gatilho do banco, testado com SQL direto                                                    |

### ✅ Quem vê e quem mexe (D-M05-5 a D-M05-7)

| Critério                                                | Evidência                                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Cada papel vê exatamente o que deve                     | Seis eventos (de grupo, geral, rascunho, convite pessoal) × líder, conselheiro, dois membros e visitante |
| A agenda em SQL e a regra pura concordam                | Mesmo teste, ator a ator, evento a evento; mutação no SQL faz o teste falhar                             |
| Conselheiro não convida a equipe nem outro grupo        | `publico_fora_do_escopo` no serviço; a opção nem aparece na tela                                         |
| Quem gerencia sem `event.publish` só cria rascunho      | Papel personalizado de teste: rascunho invisível ao grupo até o conselheiro publicar                     |
| "Minha agenda" do líder não lota com o PG de cada grupo | `proximosEventos` sem filtro não traz o PG Verde                                                         |

### ✅ Também

- Barra inferior com 5 itens para todos os papéis; acessos e conta em **Mais** (`acesso.spec.ts`).
- Tipos de evento: só `settings.manage`; marcar um como encontro do grupo desmarca o anterior; tipo com série em andamento não se arquiva; arquivado não serve a evento novo.
- Grupo com encontro marcado não se arquiva — no serviço (mensagem) e no banco (gatilho revisado).
- Criar e cancelar evento **sem JavaScript** (`sem-javascript.spec.ts`).

### Pendente para o M06

- RSVP e presença presos à ocorrência; o "confirmar em um toque" do link público.
- Encerrar série com ocorrência que já tem RSVP ou presença: **cancelar**, nunca apagar (o gatilho do banco já recusa apagar o que aconteceu).
- `counts_for_attendance` e as opções de RSVP por tipo de evento entram com o uso, não antes.
