# Matriz de permissões — semente de papéis

Gerado por `tests/unit/matriz-de-permissoes.test.ts`. Não edite à mão:
mude a semente em `src/lib/server/policy/roles.ts` e rode os testes com `-u`.

Esta é a configuração de INSTALAÇÃO. Depois de semeados, papéis e
permissões são editados na tela de administração, e o banco passa a valer.

## Pessoas

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `person.view` | ✓ global | ✓ no grupo | ✓ próprio | — |
| `person.create` | ✓ global | ✓ no grupo | — | — |
| `person.update` | ✓ global | ✓ no grupo | — | — |
| `person.delete` | ✓ global | — | — | — |
| `person.view_sensitive` | ✓ global | ✓ no grupo | — | — |
| `person.export` | ✓ global | — | — | — |
| `person.invite` | ✓ global | ✓ no grupo | — | — |

## Grupos

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `group.view` | ✓ global | ✓ no grupo | ✓ próprio | — |
| `group.manage` | ✓ global | — | — | — |
| `group.assign_member` | ✓ global | ✓ no grupo | — | — |

## Eventos

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `event.view` | ✓ global | ✓ no grupo | ✓ próprio | ✓ próprio |
| `event.manage` | ✓ global | ✓ no grupo | — | — |
| `event.publish` | ✓ global | ✓ no grupo | — | — |

## Presença

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `attendance.view` | ✓ global | ✓ no grupo | ✓ próprio | — |
| `attendance.record` | ✓ global | ✓ no grupo | — | — |
| `attendance.report` | ✓ global | ✓ no grupo | — | — |

## Responsabilidades

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `responsibility.view` | ✓ global | ✓ no grupo | ✓ próprio | — |
| `responsibility.manage` | ✓ global | ✓ no grupo | — | — |

## Financeiro

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `finance.view_own` | ✓ global | ✓ no grupo | ✓ próprio | — |
| `finance.view_group` | ✓ global | ✓ no grupo | — | — |
| `finance.view_all` | ✓ global | — | — | — |
| `finance.create` | ✓ global | ✓ no grupo | — | — |
| `finance.approve` | ✓ global | — | — | — |
| `finance.reverse` | ✓ global | — | — | — |

## Comunicação

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `announcement.create` | ✓ global | ✓ no grupo | — | — |
| `announcement.send` | ✓ global | ✓ no grupo | — | — |

## Inteligência artificial

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `ai.use_basic` | ✓ global | ✓ no grupo | ✓ próprio | — |
| `ai.use_analytics` | ✓ global | ✓ no grupo | — | — |
| `ai.use_finance` | ✓ global | — | — | — |

## Configurações

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `settings.manage` | ✓ global | — | — | — |

## Papéis e permissões

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `rbac.manage` | ✓ global | — | — | — |

## Auditoria

| Permissão | Líder | Conselheiro | Membro | Visitante |
| --- | --- | --- | --- | --- |
| `audit.view` | ✓ global | — | — | — |
