# M04 Grupos — Ciclo 3: editar e arquivar PGs, transferir pessoas com histórico

**Data:** 26/11/2026
**Status:** implementado e testado (API + telas). Falta conferir as telas no navegador.
**Por quê agora:** terceiro bloqueio do PG piloto. Os PGs são reorganizados ao longo do ano (§5), e até aqui não havia como mover ninguém nem saber por onde a pessoa passou.

## Decisões do usuário (26/11/2026)

| #    | Decisão                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-01 | **Conselheiro edita nome e descrição do próprio PG.** Criar e arquivar PGs fica com os líderes, porque mudam a estrutura de todos.                         |
| G-02 | **Conselheiro move quem está no PG dele para qualquer outro PG.** Não traz ninguém de outro PG. A mudança fica no histórico, e quem recebe vê quem chegou. |

## O que entrou

| Camada        | Entrega                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Banco         | Migração `0010_grupos_transferencia`: tabela `group_member_history` (append-only por gatilho), `group.archived_at/_by`, retrato inicial do histórico, permissão `group.update` |
| API           | `POST /api/grupos/transferencias` (uma ou várias pessoas, tudo ou nada) · `PATCH /api/grupos/[id]` (editar, arquivar, reativar)                                                |
| API           | `GET /api/grupos/[id]` com permissões e "chegadas e saídas" · `GET /api/grupos?arquivados=1` · ficha da pessoa com caminho entre PGs e destinos permitidos                     |
| Caminho único | Cadastro, tela e sugestão da IA aceita gravam a mudança pelo mesmo código (`$server/grupos/transferencia`), sempre com histórico                                               |
| Telas         | PG: editar, arquivar/reativar, marcar integrantes e mover, chegadas e saídas · Lista: mostrar arquivados · Ficha da pessoa: "Mudar de PG" e linha do tempo única               |

## Regras de negócio

| #    | Regra                                                                                                                                                                 | Origem                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| G-03 | Uma pessoa, um PG por vez (já garantido por índice único).                                                                                                            | `[REQ]` §5               |
| G-04 | Toda entrada, saída e transferência vai para `group_member_history` (de, para, motivo, quem, quando, origem: cadastro/manual/ia), que não aceita edição nem exclusão. | `[REQ]` §5, RN-28        |
| G-05 | **Excluir PG = arquivar.** O PG some das listas e não recebe ninguém nem evento, mas eventos e histórico continuam apontando para ele. Pode ser reativado.            | `[DEC]`                  |
| G-06 | Só arquiva PG **vazio e sem eventos marcados**. A resposta diz quantas pessoas ou eventos faltam resolver.                                                            | `[DEC]`                  |
| G-07 | Tirar alguém de todos os PGs, ou pôr num PG quem não tem nenhum: só líderes.                                                                                          | `[DEC]`, decorre de G-02 |
| G-08 | Transferência em lote é tudo ou nada: se alguém da lista não pode ser movido por quem pede, ninguém muda, e a resposta diz quem barrou.                               | `[DEC]`                  |
| G-09 | Líder só é movido por líder (mesma regra da ficha, P-01 do ciclo 2).                                                                                                  | `[DEC]`                  |
| G-10 | Mover um conselheiro de PG não muda o escopo de conselheiro dele: pertencer a um PG e cuidar de um PG são eixos independentes (seção 5.2).                            | `[DEC]`                  |
| G-11 | Sugestão de divisão da IA: aplicada só depois de alguém aceitar. Pula PG arquivado ou pessoa que saiu depois da sugestão, e conta quantas pulou.                      | `[REQ]` §6, RN-26        |

## Permissão nova

`group.update` ("Editar nome e descrição do grupo") separa o que G-01 dá ao conselheiro do resto de `group.manage` (criar e arquivar). A migração a acrescenta ao catálogo e aos papéis **líder** e **conselheiro** já instalados. Uma liderança que tenha mexido nesses papéis continua podendo tirá-la pela Administração.

## Fica para depois

- Sugestões da IA para reorganizar (§6) já passam pelo histórico, mas a tela de revisar a sugestão não foi tocada neste ciclo.
- A função dentro do PG (`group_member.role_key`) continua sem tela.

## Testes

`tests/integration/api-grupos-transferencia.test.ts`, com 12 casos:

- cada fronteira de G-02 e G-07;
- tudo ou nada;
- chegadas e saídas por papel;
- edição pelo conselheiro e arquivamento pelo líder, com os dois bloqueios de G-06;
- PG arquivado recusado na transferência, no evento e no cadastro;
- gatilho append-only;
- ficha da pessoa;
- cadastro gravando a entrada;
- os dois trechos de dados da migração 0010.

`tests/integration/api-ia.test.ts` passou a conferir que cada transferência aceita da IA deixa rastro com origem `ia`.

## Critérios de aceitação

- [x] Líder e conselheiro movem pessoas conforme G-02, uma ou várias de uma vez
- [x] Cada mudança aparece no histórico da pessoa, nas chegadas e saídas do PG e na auditoria
- [x] Conselheiro edita o próprio PG; líder arquiva e reativa
- [x] PG arquivado não recebe ninguém nem evento
- [ ] Telas conferidas no celular (360 px, claro e escuro): **pendente**
