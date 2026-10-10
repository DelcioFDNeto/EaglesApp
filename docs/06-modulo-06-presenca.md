# Módulo 06 — Presença

- **Status:** **implementado** e verificado em 10/10/2026 — **fecha o MVP**
- **Ciclo:** MVP, semanas 9–10 — último módulo do MVP
- **Depende de:** M05 (eventos e ocorrências), M04 (grupos), M02 (pessoas e regime de dados)
- **Deploy:** continua sendo a última etapa do roteiro (decisão de 04/10/2026)

---

## 1. Objetivo

Fechar o ciclo da semana do PG: a pessoa **diz que vai** em um toque, o conselheiro **marca quem veio** em menos de três minutos, e a liderança **enxerga quem está se afastando** antes que seja tarde.

O entregável do roteiro (seção 19.1) é **"RSVP em 1 toque, lista de presença, relatório de frequência, botão de WhatsApp"**. O botão de WhatsApp já veio com o M05.

E uma linha que atravessa o módulo inteiro, vinda da seção 4 (a persona negativa "o fiscal") e da recomendação 4 da seção 23: **os indicadores existem para identificar quem precisa de atenção, não para cobrar nem ranquear**.

---

## 2. O que a leitura do código revelou antes de começar

| #   | Lacuna                                                                                                                                                                                  | Origem | Gravidade |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------- |
| G1  | **Encerrar uma série apaga as ocorrências futuras.** Com RSVP preso a elas, isso apagaria respostas — ou, com a chave estrangeira, quebraria com erro. O M05 deixou o aviso; agora vale | M05    | alta      |
| G2  | A visão do grupo (M04) reserva o lugar da frequência e diz "aparece quando a presença começar a ser registrada"                                                                         | M04    | média     |
| G3  | Nenhum tipo de evento diz se **conta para frequência**. Sem isso, uma reunião de liderança entraria na conta do PG de quem foi                                                          | M05    | média     |
| G4  | O link público promete "confirmar presença" e ainda não confirma nada                                                                                                                   | M05    | média     |

---

## 3. Decisões deste módulo

### D-M06-1 — Respostas configuráveis, com significado fixo

`[REQ]` RN-11. As respostas ("Vou", "Vou chegar atrasado", "Talvez", "Não vou") são dados, editáveis, e cada tipo de evento escolhe quais oferece. Uma resposta pode aceitar **convidados** ("levo mais 2").

`[DEC]` Cada resposta tem um **significado** fixo — `sim`, `talvez` ou `nao`. "Vou chegar atrasado" é um `sim` com outro texto. Os indicadores leem o significado, nunca o texto: renomear "Vou" para "Tô dentro" não quebra relatório nenhum.

### D-M06-2 — RSVP versionado pelo banco

`[REQ]` RN-12. `rsvp` guarda a resposta atual (uma por pessoa e evento); `rsvp_history` guarda **todas**, e quem a preenche é um **gatilho do banco** a cada inserção ou mudança — não o código. Um caminho futuro que esqueça de registrar o histórico não consegue esquecer. O histórico é append-only, como a auditoria.

### D-M06-3 — Quem responde

`[DEC]` A pessoa responde **por si**, se pode ver o evento publicado e ele não foi cancelado nem terminou. Não há RSVP anônimo pelo link público: uma resposta sem pessoa não serve para nada, e um formulário aberto convidaria nomes inventados. O link público mostra os botões para quem já entrou; para os outros, "entrar para confirmar".

Isso não contraria "nunca exija o app para participar" (seção 23): confirmar é opcional. Quem não tem o app continua indo ao PG e sendo marcado presente pelo conselheiro.

### D-M06-4 — Presença é a lista feita, não a ausência de RSVP

`[REQ]` RN-13 e RN-15. Presença é registro **separado** do RSVP, feito por quem tem `attendance.record` no grupo do evento.

`[DEC]` O evento ganha **"lista feita em … por …"**. A regra que decide tudo:

- só eventos **com lista feita** entram na frequência;
- numa lista feita, quem era esperado e não está marcado **faltou**;
- evento sem lista não diz nada sobre ninguém — nem a falta de RSVP, nunca.

Assim "ninguém fez a lista" nunca vira "todo mundo faltou".

### D-M06-5 — Quem era esperado

`[DEC]` A frequência compara presenças com **encontros em que a pessoa era esperada**: convidada pela equipe, pelo grupo **em que estava naquele dia**, ou nominalmente. Quem entrou no PG Azul na semana passada não "faltou" aos encontros de setembro. Presença em encontro para o qual não era esperada (visitou outro PG) conta como presença, mas não entra no denominador.

### D-M06-6 — A lista de presença do conselheiro

`[REQ]` F3: "toca nos nomes presentes (lista pré-ordenada por frequência)". Uma tela, um formulário, um botão: os esperados em ordem de frequência, cada um com o que respondeu; quem não era esperado e apareceu se acrescenta pela busca; **quem chegou pela primeira vez** se cadastra ali mesmo — nome, e o resto se quiser — já dentro do grupo e já presente (F1).

A lista inteira vai numa gravação só, no fim. Perder o sinal no meio da marcação não perde nada; com JavaScript, um envio que falhar mantém as marcações na tela para tentar de novo.

### D-M06-7 — Sinais, não ranking

`[DEC]` A visão do grupo mostra, só para quem cuida dele:

- **frequência das últimas 8 semanas** de cada pessoa, ao lado do nome;
- **"não vem há 3 encontros"** — quem costumava vir e parou;
- **"já veio 3 vezes em 60 dias"** — visitante que talvez queira mudar de estágio (F1). O sistema sinaliza; quem decide é o conselheiro (RN-03).

Não existe lista ordenada por frequência para membros, nem número de faltas visível entre pares. O relatório de frequência existe para quem tem responsabilidade pastoral (`attendance.report`), no escopo dela.

### D-M06-8 — Quem vê respostas e presenças

`[DEC]`

| O quê                                     | Quem vê                                                               |
| ----------------------------------------- | --------------------------------------------------------------------- |
| Totais de respostas de um evento          | Quem vê o evento — "12 vão" é informação útil e não expõe ninguém     |
| **Quem** respondeu o quê, e quem esteve   | `attendance.view` no grupo do evento: conselheiro do grupo, liderança |
| A própria resposta e a própria frequência | A própria pessoa (escopo `self`)                                      |
| Frequência de alguém, no perfil           | `attendance.view` no grupo da pessoa                                  |
| Relatório de frequência                   | `attendance.report` — do grupo (conselheiro) ou de todos (liderança)  |

### D-M06-9 — Encerrar série com respostas cancela, não apaga

`[DEC]` Corrige G1: ocorrência futura **com** RSVP ou presença é cancelada ("encontro semanal encerrado"); sem nada preso a ela, continua saindo da agenda como no M05.

### Fora deste módulo

- **Fila offline** de RSVP e presença (A-07) — depois do piloto, com o service worker do PWA. A lista de presença já é uma gravação só no fim, o que cobre o caso comum de sinal ruim durante a marcação.
- Check-in por QR Code (RF-06.5, `Could`) — a chave existe e continua desligada.
- Lembrete de RSVP pendente — M08, com as notificações.

---

## 4. O que será construído

### 4.1 Banco

| Tabela / coluna                     | Papel                                                         |
| ----------------------------------- | ------------------------------------------------------------- |
| `rsvp_option`                       | Respostas da equipe: texto, significado, se aceita convidados |
| `event_type_rsvp_option`            | Quais respostas cada tipo oferece                             |
| `rsvp`                              | Resposta atual — uma por pessoa e evento                      |
| `rsvp_history`                      | Todas as respostas, preenchida por gatilho, append-only       |
| `attendance`                        | Quem esteve — distinta do RSVP                                |
| `event.attendance_taken_at` / `_by` | A lista foi feita (D-M06-4)                                   |
| `event_type.counts_for_attendance`  | O tipo entra na frequência (G3)                               |

### 4.2 Telas

| Rota                    | Permissão                              | O que faz                                                             |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `/agenda/[id]` (ação)   | ver o evento                           | "Você vai?" — responder em um toque; totais; quem respondeu (D-M06-8) |
| `/inicio` (ação)        | ver o evento                           | Os botões no próximo encontro (F2)                                    |
| `/e/[codigo]` (ação)    | pública; responder exige sessão        | Responder pelo link do WhatsApp                                       |
| `/agenda/[id]/presenca` | `attendance.record` no grupo do evento | A lista de presença (D-M06-6)                                         |
| `/frequencia`           | `attendance.report` em algum escopo    | Relatório por pessoa, grupo, período e tipo                           |

E: frequência e sinais na visão do grupo; frequência no perfil; respostas por tipo na tela de tipos de evento; confirmação × presença no evento depois da lista feita (RF-06.4).

---

## 5. Regras de negócio aplicáveis

| ID    | Regra                                     | Como é garantida                                                      |
| ----- | ----------------------------------------- | --------------------------------------------------------------------- |
| RN-11 | Respostas configuráveis por tipo          | Tabelas + tela; significado fixo para os indicadores                  |
| RN-12 | Toda resposta é versionada                | Gatilho do banco preenche `rsvp_history`; append-only                 |
| RN-13 | Presença é distinta do RSVP               | Tabelas separadas; o indicador confirmação × presença compara as duas |
| RN-14 | Check-in nunca condiciona a entrada       | Nada neste módulo depende de check-in                                 |
| RN-15 | Ausência de RSVP não é falta              | Falta só existe em lista feita (D-M06-4); teste específico            |
| RN-30 | Menor sem responsável: só nome e presença | O cadastro na porta respeita o regime; presença é permitida sempre    |

---

## 6. Riscos

| Risco                                                 | Mitigação                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Frequência virar instrumento de cobrança              | Sinais em vez de ranking; nada de frequência visível entre pares; relatório só com `attendance.report` |
| "Ninguém fez a lista" virar "todo mundo faltou"       | Só evento com lista feita conta (D-M06-4), com teste                                                   |
| Pessoa nova no grupo aparecer como faltosa no passado | Esperado = estava no grupo naquele dia (D-M06-5), com teste                                            |
| Sinal ruim no salão do PG                             | Lista é uma gravação só; com JS, falha de envio não apaga as marcações                                 |
| Histórico de RSVP esquecido por algum caminho novo    | Preenchido por gatilho do banco                                                                        |

---

## 7. O que mudou durante a implementação

A implementação confirmou o plano. O que ela acrescentou — quase tudo achado pelos próprios testes:

| #   | O que                                                                                                                                                                         | Por quê                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| I1  | A guarda de rotas ganhou a categoria **"pública com ação protegida"**. O link do evento continua abrindo sem login; responder por ele exige sessão                            | A guarda acusou `/e/[codigo]` — lista de públicas que verifica permissão engana quem lê. Agora a exceção é explícita      |
| I2  | **"Entrar para confirmar" volta ao link.** `/entrar?voltar=/e/<código>` — com o mesmo `destinoInterno` que já barrava redirecionamento aberto na confirmação de senha         | Sem isso, quem abriu o link no WhatsApp entrava e caía no início, longe do botão                                          |
| I3  | **Id malformado na URL responde 404**, não 500. As rotas `[id]` viraram `[id=id]` (um _matcher_ de uuid), e os serviços do M06 descartam ids malformados vindos de formulário | Herdado do M02 ao M05: `/pessoas/abc` chegava ao Postgres como erro de sintaxe. Achado ao testar a lista com id inventado |
| I4  | Encerrar a série diz quantas datas **saíram** e quantas **ficaram canceladas** por já terem respostas                                                                         | D-M06-9 sem essa frase pareceria um erro: "encerrei e a data continua lá"                                                 |
| I5  | Na lista de presença, os campos de "chegou pela primeira vez" **esvaziam depois de salvar**                                                                                   | Com JavaScript, o nome ficava no campo — e um segundo "salvar" cadastraria a mesma pessoa de novo                         |
| I6  | Na tela de tipos, **marcar todas as respostas grava o padrão** ("todas"), e não a lista                                                                                       | Assim uma resposta criada depois também vale para o tipo; marcar nenhuma é recusado, em vez de virar "todas" sem aviso    |
| I7  | Uma classe CSS chamada `visitante` virou `na-porta`                                                                                                                           | O teste "estágios são dados" (M02) a pegou: a chave de um estágio escrita à mão no código                                 |

---

## 8. Critérios de aceitação

Verificado em **10/10/2026**: `npm test` → **393 testes** (30 de integração e 17 de unidade novos) · `npm run test:e2e` → **83 testes** em dois projetos de navegador (10 novos, um deles sem JavaScript) · `npm run check` → **0 erros em 830 arquivos** · `npm run build` → sucesso.

### ✅ Entregável do roteiro (seção 19.1)

| Critério                    | Evidência                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **RSVP em 1 toque**         | No início, no evento e pelo link público logado; a escolha aparece marcada na hora e sobrevive ao recarregar (`presenca.spec.ts`)         |
| **Lista de presença**       | Esperados pré-ordenados por frequência, com o que cada um respondeu; quem chegou na porta já sai presente e no grupo (`presenca.spec.ts`) |
| **Relatório de frequência** | `/frequencia` por período, grupo e tipo, em ordem alfabética, no escopo de quem pede (`presenca.test.ts`, `presenca.spec.ts`)             |
| **Botão de WhatsApp**       | Veio com o M05; o link que ele compartilha agora confirma presença                                                                        |

### ✅ RSVP (D-M06-1 a D-M06-3)

| Critério                                          | Evidência                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Mudar a resposta preserva a anterior — pelo banco | Uma resposta atual, duas no histórico; um `INSERT` direto também vai para o histórico    |
| O histórico não se altera                         | `UPDATE` e `DELETE` em `rsvp_history` recusados; trocar a pessoa de uma resposta, também |
| Cada tipo oferece as suas respostas               | Reunião de liderança sem "talvez" — recusado no serviço e no gatilho                     |
| Convidados só com resposta que os aceita          | "Vou +2" grava 2; "talvez +5" grava 0; o atalho pelo banco é recusado                    |
| Quem não vê o evento não responde                 | Membro do PG Verde recebe "não existe" para o PG Azul                                    |
| Evento cancelado não recebe resposta              | Serviço e gatilho                                                                        |
| Sem sessão, o link mostra "entre para confirmar"  | E o login traz de volta ao link (`presenca.spec.ts`)                                     |

### ✅ Frequência (D-M06-4, D-M06-5)

| Critério                                        | Evidência                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Sem lista feita, ninguém faltou                 | Evento sem lista, com "não vou" respondido: zero esperados, percentual nulo                  |
| Sem RSVP, ninguém faltou                        | Falta só existe em lista feita — testado no cálculo puro e no banco                          |
| Quem entrou no grupo depois não é faltoso antes | Novato: zero esperados, sem sinal; `presenca-calculo.test.ts` cobre entrada e saída do grupo |
| Visitar outro PG não é faltar ao seu            | Presença fora do esperado conta, mas não entra no denominador                                |
| Tipo que não conta fica de fora (G3)            | Lista de uma reunião de liderança não muda a frequência de ninguém                           |
| Refazer a lista substitui, não soma             | Marcados entram, desmarcados saem; id inventado é ignorado                                   |
| Lista só no dia do encontro ou depois           | Encontro de amanhã: `periodo_invalido`                                                       |

### ✅ Quem vê o quê (D-M06-7, D-M06-8)

| Critério                                                     | Evidência                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Totais para quem vê o evento; nomes só para quem cuida       | `quemRespondeu` nulo para o membro; a região "Quem respondeu" nem aparece para ele           |
| Frequência de alguém: a própria pessoa e quem cuida do grupo | Colega do mesmo grupo e conselheiro de outro grupo recebem nulo                              |
| Sinais só para quem cuida do grupo                           | `frequenciaDoGrupo` recusa membro e conselheiro vizinho                                      |
| "Não vem há 3 encontros" e "já veio 3 vezes em 60 dias"      | Cenário completo no banco e na tela do grupo (`presenca.spec.ts`)                            |
| Nada de ranking                                              | Relatório e visão do grupo em ordem de nome — os testes conferem a ordem                     |
| Relatório no escopo de quem pede                             | Conselheiro: só o grupo dele, sem "todos os grupos"; membro: 403 e nem vê o item em **Mais** |

### ✅ Também

- **Encerrar série com respostas cancela, não apaga** (D-M06-9): a data com resposta fica, cancelada, com a resposta; as outras saem (`presenca.test.ts`).
- Responder e fazer a lista **sem JavaScript** (`sem-javascript.spec.ts`).
- Nenhuma tela nova rola para o lado no celular (o teste mede a largura).

### Depois do MVP

- **Deploy** — a última etapa do roteiro (domínio, D-06; VPS, D-07.2).
- Fila offline de RSVP e presença (A-07), com o service worker do PWA.
- Check-in por QR Code (RF-06.5) e lembrete de RSVP pendente (M08).
