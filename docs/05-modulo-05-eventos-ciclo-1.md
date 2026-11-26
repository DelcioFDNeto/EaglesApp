# M05 Eventos — Ciclo 1: criar, editar e cancelar pela tela

**Data:** 26/11/2026
**Status:** implementado e testado (API + telas). Falta conferir as telas no navegador.
**Por quê agora:** primeiro dos bloqueios do PG piloto. Sem criar evento pela tela, ninguém tem o que confirmar.

## O que entrou

| Camada | Entrega                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Banco  | Migração `0008_eventos_edicao`: `event.cancelled_at`, `cancelled_by_person_id`, `cancel_reason`; `event_type.active`; CHECKs de status |
| API    | `PATCH /api/eventos/[id]` (editar, cancelar, reativar) · `GET /api/eventos/opcoes` · `PUT /api/eventos/tipos/[id]`                     |
| API    | `POST /api/eventos` passa a validar o responsável e a auditar; `POST /api/eventos/tipos` passa a auditar                               |
| Telas  | `/eventos/novo` · `/eventos/[id]/editar` · `/eventos/tipos` · botões Editar/Cancelar/Reativar no evento · "Novo evento" na lista       |

Fora deste ciclo: **eventos recorrentes** (o PG de toda quinta). Fica para o ciclo 2.

## Regras de negócio

| #    | Regra                                                                                                                                                    | Origem                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| E-01 | **Cancelar não apaga nada.** As respostas de presença ficam no histórico. O evento guarda quem cancelou, quando e o motivo (opcional, visível a todos).  | `[REQ]` usuário, 26/11/2026           |
| E-02 | Evento cancelado não aceita novas respostas; pode ser reativado, e reativar limpa os dados do cancelamento.                                              | `[DEC]`                               |
| E-03 | Não existe exclusão de evento. Cancelar cobre o caso sem perder histórico.                                                                               | `[DEC]` (decorre de E-01)             |
| E-04 | Editar exige `event.manage` no PG atual do evento **e** no PG de destino, se ele mudar. Evento da equipe toda (sem PG) exige permissão global.           | `[DEC]`, escopo de grupo (seção 11.2) |
| E-05 | Uma opção de resposta que já tem respostas pode mudar de rótulo, mas não pode ser removida (409). A chave é o que fica gravado.                          | `[DEC]`                               |
| E-06 | Tipo de evento não é excluído, é **desativado**: some dos eventos novos, continua valendo nos antigos.                                                   | `[DEC]`                               |
| E-07 | Criar tipo: qualquer um com `event.manage` (inclusive conselheiro). Editar/desativar: só `event.manage` **global**, porque muda o que todos os PGs veem. | `[DEC]`                               |
| E-08 | Responsável precisa ser da mesma equipe (antes não era conferido no POST).                                                                               | `[DEC]`, correção                     |
| E-09 | Toda criação, edição, cancelamento e reativação vai para a auditoria, com antes/depois **só do que mudou**. Salvar sem mudança não gera registro.        | RN-28                                 |

O banco garante sozinho: status só entre `scheduled`, `ongoing`, `completed` e `cancelled`; e o evento está cancelado **se e somente se** tem `cancelled_at`.

## Contratos

`PATCH /api/eventos/[id]`: todos os campos são opcionais, e um campo desconhecido devolve 400 (proteção contra _mass assignment_). `null` apaga um campo opcional.
`status: 'cancelled'` cancela (aceita `motivoCancelamento`); `status: 'scheduled'` a partir de um evento cancelado o reativa.
Respostas: 200 `{ alterado }` · 400 dados/período · 403 escopo · 404 fora da equipe · 409 opção com respostas.

`GET /api/eventos/opcoes`: `{ podeSemGrupo, tipos (só ativos), grupos (do escopo), pessoas (só id e nome) }`. Membro recebe 403.

## Testes

- `tests/integration/api-eventos-edicao.test.ts`: 14 casos (escopo de conselheiro, cancelamento preserva respostas, reativação, CHECKs do banco, opções de resposta, tipos, opções do formulário, isolamento entre equipes).
- `tests/unit/formulario-evento.test.ts`: 7 casos (datas locais, chaves de opção, validação, corpo enviado à API).

## Critérios de aceitação

- [x] Líder cria, edita, cancela e reativa um evento; conselheiro faz o mesmo só no próprio PG
- [x] Cancelar mantém as respostas e mostra o motivo a todos
- [x] Tipos podem ser criados, editados e desativados sem quebrar eventos antigos
- [x] Toda mudança aparece na auditoria
- [x] Telas conferidas no celular (360 px, claro e escuro) no Chrome com API simulada — falta apenas conferência ponta a ponta com PostgreSQL local numa máquina com Docker
