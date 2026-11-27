# M06 Presença — Ciclo 4: histórico de respostas, chamada completa e frequência

**Data:** 27/11/2026
**Status:** implementado e testado (API + telas). Telas conferidas no Chrome com dados de exemplo; falta conferir com dados reais.
**Por quê agora:** quarto bloqueio do PG piloto. Sem chamada completa e frequência, o app não ajuda a perceber quem está se afastando (seção 2 da arquitetura: "Pessoas somem sem ninguém notar").

## O que entrou

| Camada | Entrega                                                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Banco  | Migração `0011_presenca_historico`: tabela `rsvp_history` (append-only), retrato inicial com a resposta atual de cada um; o histórico de PG passa a aceitar a exclusão em cascata                                |
| API    | `GET /api/frequencia` (PG ou equipe) · `GET /api/frequencia/pessoa/[id]` · `DELETE /api/eventos/[id]/presenca` (desfazer)                                                                                        |
| API    | Presença: lista `paraChamada` (PG inteiro e quem respondeu) · relatório do evento com `mudancasDeResposta` · confirmação pelas opções do próprio evento                                                          |
| Telas  | `/frequencia` (indicadores, presença por mês, pessoas) · chamada completa com Veio/Atrasou/Faltou e Desfazer · mudanças de resposta · frequência na ficha da pessoa · "conta como vou" em cada opção de resposta |

## Definições (o que cada número quer dizer)

| Termo                | Definição                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chamada feita**    | O evento tem ao menos um registro de presença. Evento sem chamada não conta para ninguém.                                                          |
| **Esperado**         | Num encontro de PG, quem estava naquele PG **na data** do encontro (pelo histórico de PGs do ciclo 3). Mudar de PG não arrasta faltas antigas.     |
| **Veio**             | Presença "presente" ou "atrasado".                                                                                                                 |
| **Falta**            | Esperado, chamada feita, e não veio (marcado "faltou" ou simplesmente não marcado).                                                                |
| **Frequência (%)**   | Só nos encontros do PG da pessoa. Evento da equipe toda (Outside, conselho...) conta presenças, sem %, porque não há como saber quem era esperado. |
| **Confirmou e veio** | Dos esperados que responderam um "vou", quantos vieram. "Vieram sem confirmar" inclui quem não respondeu.                                          |
| **"Vou"**            | Cada opção de resposta diz se conta como confirmação. Sem marcação, vale o padrão: Confirmado, Atrasado e Convidado contam; Talvez e Não vou não.  |

## Regras de negócio

| #    | Regra                                                                                                                                                            | Origem                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| P-01 | Toda resposta fica no histórico, inclusive as trocadas. Repetir a mesma resposta não cria linha. O histórico não aceita edição nem exclusão direta.              | `[REQ]` RN-12                                  |
| P-02 | Não responder nunca é falta, e responder "não vou" não muda a conta: só aparece como contexto ("falta com resposta").                                            | RN-15                                          |
| P-03 | A chamada lista o PG inteiro e quem respondeu: quem veio sem usar o app também é marcado.                                                                        | `[DEC]`, F3                                    |
| P-04 | Um toque errado na chamada pode ser desfeito.                                                                                                                    | `[DEC]`                                        |
| P-05 | **Sem ranking.** Pessoas sempre em ordem alfabética. A visão da equipe mostra cada PG sem nomes.                                                                 | `[DEC]`, persona "o fiscal"                    |
| P-06 | Frequência de alguém: só a própria pessoa e quem tem `attendance.report` no PG dela (ou global). Colega de PG não vê.                                            | `[DEC]`, seção 4                               |
| P-07 | Sinal de atenção: "não veio nos últimos N encontros" a partir de 2 faltas seguidas, com a data da última presença. É convite ao cuidado, não alerta disciplinar. | `[REQ]` §20 (destacar quem precisa de atenção) |
| P-08 | Consulta limitada a 2 anos por vez.                                                                                                                              | `[DEC]`                                        |

## Mudança que afeta o ciclo 3

O histórico de PG (`group_member_history`) bloqueava qualquer exclusão, até a cascata. Isso impediria apagar uma pessoa (por exemplo, num pedido de exclusão pela LGPD). Os dois históricos passam a recusar a exclusão **direta**, mas deixam a cascata apagar junto com a pessoa ou o evento.

## Fica para depois

- "Sua frequência" no perfil do membro: a API já permite (P-06), falta a tela.
- Chamada de evento da equipe toda: hoje lista só quem respondeu; falta buscar e acrescentar qualquer pessoa.
- Comparar períodos (este trimestre × o anterior).

## Testes

- `tests/unit/frequencia.test.ts`: 12 casos com números calculados à mão (troca de PG no meio do período, evento sem chamada, atrasado, "não vou", faltas seguidas, visita a outro PG, ordem alfabética, opções personalizadas).
- `tests/integration/api-frequencia.test.ts`: 11 casos (histórico de respostas e gatilho, cascata, chamada completa, desfazer, opção personalizada, quem vê o quê, período inválido, migração).
- Os quatro arquivos de integração mais novos passaram a gerar o hash de senha uma vez por arquivo: um hash por pessoa estourava o tempo das preparações com a bateria em paralelo.

## Critérios de aceitação

- [x] Trocar de resposta preserva a anterior, e quem cuida do PG vê as trocas
- [x] A chamada permite marcar quem veio sem ter respondido, e desfazer um toque errado
- [x] Relatório por PG, por período, por pessoa, por tipo de evento (equipe), com evolução mensal
- [x] Indicador confirmação × presença
- [x] Ninguém vê frequência de quem não está sob o seu cuidado
- [ ] Conferido com dados reais de um PG: **pendente**
