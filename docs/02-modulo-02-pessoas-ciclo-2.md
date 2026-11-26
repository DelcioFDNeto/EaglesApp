# M02 Pessoas — Ciclo 2: editar pessoa e caminhada (jornada), com histórico

**Data:** 26/11/2026
**Status:** implementado e testado (API + telas). Falta conferir as telas no navegador.
**Por quê agora:** segundo bloqueio do PG piloto. Sem isso, ninguém leva um visitante a recorrente nem a membro (seção 10 do briefing).

## Decisões do usuário (26/11/2026)

| #    | Decisão                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| J-01 | **Só o estágio "membro Eagles" dá acesso de membro.** Visitante e recorrente ficam com o acesso de visitante. A troca é automática. |
| J-02 | **Conselheiro, no próprio PG, move entre visitante e recorrente.** Entrar em "membro" ou sair dele é dos líderes.                   |

## O que entrou

| Camada | Entrega                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Banco  | Migração `0009_jornada_estagio` (só dados): perfil para todos, estágio alinhado ao acesso, nascimento trazido para `person`      |
| API    | `GET` e `PATCH /api/pessoas/[id]` · `POST /api/pessoas/[id]/estagio`                                                             |
| API    | `POST /api/pessoas`: campo `estagio` (padrão visitante) no lugar de `papel`; grava o primeiro registro do histórico ("Cadastro") |
| API    | `PUT /api/pessoas/me`: não muda mais o estágio; nascimento gravado em `person`; regra de idade                                   |
| Telas  | `/pessoas/[id]` (dados, caminhada, histórico) · nome clicável e estágio na lista · cadastro com os estágios permitidos           |

## Regras de negócio

| #    | Regra                                                                                                                                                                                   | Origem                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| J-03 | A jornada tem três estágios: visitante, recorrente, membro. Conselheiro e líder são **papéis de acesso**, não estágios.                                                                 | `[DEC]`                  |
| J-04 | Mudar de estágio grava o histórico (de, para, motivo, quem, quando, PG) e a auditoria (inclusive a troca de papel base).                                                                | `[REQ]` §10, RN-28       |
| J-05 | A troca de acesso só mexe no papel base (`visitante` ↔ `membro`, escopo próprio). Papéis de PG (conselheiro), globais e personalizados não são tocados.                                 | `[DEC]`                  |
| J-06 | A primeira entrada em "membro" grava a data de entrada nos Eagles. Sair e voltar não a apaga.                                                                                           | `[DEC]`                  |
| J-07 | Cadastrar alguém direto como membro segue J-02: só líderes.                                                                                                                             | `[DEC]`, decorre de J-02 |
| J-08 | A própria pessoa não muda o próprio estágio (o campo é ignorado em `/api/pessoas/me`).                                                                                                  | `[DEC]`, decorre de J-04 |
| P-01 | Editar dados exige `person.update` e `person.view_sensitive` no PG da pessoa (ou globais). Líder só é editado por líder.                                                                | `[DEC]`, seção 11.2      |
| P-02 | Contato, nascimento, família e observações só aparecem com `person.view_sensitive` (ou para a própria pessoa).                                                                          | RN-32                    |
| P-03 | A auditoria de edição guarda **quais** campos mudaram, não os valores: contato e observações não vão para o log.                                                                        | `[DEC]`, RN-28           |
| P-04 | O contato editado na ficha é para falar com a pessoa. O contato de **login** só muda pelo convite.                                                                                      | `[DEC]`                  |
| I-01 | Idade mínima de 16 anos.                                                                                                                                                                | `[REQ]` D-03             |
| I-02 | 16 e 17 anos: só nome e presença. Contato, observações e família são recusados, e ninguém dessa idade fica com conta de acesso, até existir o registro de consentimento do responsável. | ADR 0003, RN-30          |
| I-03 | A data de nascimento que vale é `person.birth_date` (o perfil guarda só uma cópia).                                                                                                     | ADR 0003                 |

## Por que a migração mexe em dados

Antes deste ciclo, todo perfil nascia "visitante", inclusive o de quem foi cadastrado com acesso de membro. Com J-01 ligado sem alinhar os dados, o primeiro conselheiro que marcasse um desses membros como "recorrente" tiraria o acesso dele. A migração põe no estágio "membro" quem já tem papel `membro`, `conselheiro`, `lider` ou `master`. Ninguém perde nem ganha acesso com ela.

## Fica para depois

- **Anúncios "para conselheiros" e "para líderes"** ainda usam o campo de estágio, que não guarda mais esses valores. O certo é direcionar pelo papel de acesso: ajustar no M08.
- **Registro de consentimento** do responsável (ADR 0003): até lá, menores ficam no cadastro mínimo.
- **Transferir de PG**: é o próximo bloqueio do piloto (M04).

## Testes

`tests/integration/api-pessoas-jornada.test.ts`, com 17 casos:

- quem vê e quem edita;
- cada fronteira de J-02;
- a troca real de acesso, conferida no `loadActor`;
- data de entrada;
- papéis de PG preservados;
- auditoria sem valores sensíveis;
- piso de idade e regime de menor;
- perfil próprio;
- cadastro com estágio;
- a migração 0009 aplicada sobre dados no formato antigo.

## Critérios de aceitação

- [x] Líder e conselheiro editam os dados de uma pessoa do seu alcance
- [x] Conselheiro leva visitante a recorrente; líder leva a membro, e o acesso acompanha
- [x] Cada mudança aparece no histórico da pessoa e na auditoria
- [x] Regra de idade aplicada na ficha e no perfil próprio
- [x] Telas conferidas no celular (360 px, claro e escuro) no Chrome com API simulada — falta apenas conferência ponta a ponta com PostgreSQL local numa máquina com Docker
