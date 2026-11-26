# DESIGN.md — Eagles App

Fonte única de verdade para tokens de interface, arquitetura de UI e regras de uso. Todas as telas do produto são **modo Operate** (sistema, dashboard, formulários, admin). Nunca aplicar ritmo ou estética de landing page dentro de telas operacionais.

## 1. Modo de operação

| Superfície                                                          | Modo        | Regra                                                                                                                                |
| ------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/entrar`, `/convite/[token]`, `/inicio`, `/conta/sessoes`, `/sair` | **Operate** | Telas de sistema. Hierarquia tipográfica, superfícies limpas, alvos de toque ≥ 44px, sem animação decorativa, sem copy de marketing. |
| `docs/site/*.html`                                                  | **Read**    | Conteúdo estático. Somente correções de shell P0 (doctype, lang, charset, viewport, contraste `.close`).                             |

## 2. Tokens de cor (WCAG 2.1 AA)

Contraste mínimo 4,5:1 para texto normal sobre fundo claro e escuro. Mínimo 3:1 para bordas de campo e componentes de UI.

### Marca (extraída dos pixels da logo)

| Token               | Claro     | Escuro    | Uso                             |
| ------------------- | --------- | --------- | ------------------------------- |
| `--cor-marca`       | `#A91825` | `#EF5A66` | Ação primária preenchida, links |
| `--cor-marca-hover` | `#8E1420` | `#F47A84` | Hover da ação primária          |
| `--cor-marca-suave` | `#F6E4E5` | `#33141A` | Fundo sutil de marca            |
| `--cor-sobre-marca` | `#FFFFFF` | `#1A0207` | Texto sobre marca               |

### Neutros com viés quente

| Token                | Claro     | Escuro    | Uso                                                                                          |
| -------------------- | --------- | --------- | -------------------------------------------------------------------------------------------- |
| `--cor-fundo`        | `#FBF7F6` | `#17090C` | Fundo da página                                                                              |
| `--cor-superficie`   | `#FFFFFF` | `#1F0D11` | Superfície de cartão / superfície elevada                                                    |
| `--cor-superficie-2` | `#F5EEED` | `#2A1217` | Superfície secundária (avisos info, linhas suaves)                                           |
| `--cor-superficie-3` | `#EDE2E1` | `#38191F` | Superfície terciária (tags, pinos)                                                           |
| `--cor-texto`        | `#241416` | `#F2ECEC` | Texto primário (4,5:1+ em ambos os temas)                                                    |
| `--cor-texto-2`      | `#5A3E42` | `#C6B0B3` | Texto secundário (legenda, rótulo)                                                           |
| `--cor-texto-3`      | `#7A5A5E` | `#9E8689` | Texto terciário / ajuda — **só usar em tamanho ≥ 1rem ou com fundo de contraste suficiente** |
| `--cor-linha`        | `#D2BFBF` | `#3A1C22` | Borda sutil (3:1 sobre fundo)                                                                |
| `--cor-linha-forte`  | `#BF9A9A` | `#4E252C` | Borda de campo ativa / foco (3:1)                                                            |

### Estados semânticos (ícone + texto, nunca cor sozinha)

| Token                 | Claro     | Escuro    |
| --------------------- | --------- | --------- |
| `--cor-sucesso`       | `#15803D` | `#5DD48B` |
| `--cor-sucesso-suave` | `#E3F2E8` | `#17301F` |
| `--cor-aviso`         | `#B45309` | `#E9A03C` |
| `--cor-aviso-suave`   | `#FBEEDD` | `#33230F` |
| `--cor-erro`          | `#B91C1C` | `#F4757F` |
| `--cor-erro-suave`    | `#FDEAEA` | `#331013` |
| `--cor-perigo`        | `#580F20` | `#F0A9AF` | Ação destrutiva: SEMPRE contorno + ícone, nunca preenchido |
| `--cor-perigo-suave`  | `#F6E4E5` | `#33141A` |

### Foco e sombra

| Token        | Claro                                                                 | Escuro                                                        |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `--cor-foco` | `#A91825`                                                             | `#EF5A66`                                                     |
| `--sombra-1` | `0 1px 2px rgba(88,15,32,0.06)`                                       | `0 1px 2px rgba(0,0,0,0.4)`                                   |
| `--sombra-2` | `0 1px 2px rgba(88,15,32,0.06), 0 8px 24px -12px rgba(88,15,32,0.18)` | `0 1px 2px rgba(0,0,0,0.4), 0 8px 28px -14px rgba(0,0,0,0.7)` |

> Regra: sombra só em superfície elevada (`--sombra-2`). Cartões planos usam apenas borda `--cor-linha` + fundo `--cor-superficie`.

## 3. Tipografia

| Escala         | Uso                             | Fonte     | Tamanho  | Peso    |
| -------------- | ------------------------------- | --------- | -------- | ------- |
| `--texto-xs`   | Legenda, ajuda, código          | system-ui | 0.75rem  | 500     |
| `--texto-sm`   | Rótulo, legenda, aviso          | system-ui | 0.875rem | 500     |
| `--texto-base` | Corpo, input, botão             | system-ui | 1rem     | 400–600 |
| `--texto-lg`   | Subtítulo                       | Archivo   | 1.125rem | 600     |
| `--texto-xl`   | Seção / h2                      | Archivo   | 1.375rem | 700     |
| `--texto-2xl`  | Título de página / h1           | Archivo   | 1.75rem  | 800     |
| `--texto-3xl`  | Marca grande (entrar / convite) | Archivo   | 2.25rem  | 800     |

- **Títulos, botões e marca:** Archivo auto-hospedado (`font-src 'self'`). ~25 KB, cabe no orçamento de bundle.
- **Corpo de texto, inputs, rótulos:** `system-ui` (sem flash de fonte na hidratação, performático em rede fraca).
- Linha do corpo: `1.55`. Títulos: `1.2`. `text-wrap: pretty` em parágrafos; `text-wrap: balance` em títulos.

## 4. Espaçamento

| Token     | Valor   | Uso                              |
| --------- | ------- | -------------------------------- |
| `--esp-1` | 0.25rem | Gap interno de ícone/texto       |
| `--esp-2` | 0.5rem  | Gap entre label e input          |
| `--esp-3` | 0.75rem | Padding padrão, gap entre seções |
| `--esp-4` | 1rem    | Padding de cartão, seção         |
| `--esp-5` | 1.5rem  | Padding inline de botão cheio    |
| `--esp-6` | 2rem    | Padding de vazio centralizado    |
| `--esp-7` | 3rem    | Espaço entre blocos grandes      |

Conteúdo operacional sempre com `max-width: 560px`, `margin-inline: auto`, padding `var(--esp-4)`.

## 5. Formas

| Token          | Valor | Uso                                |
| -------------- | ----- | ---------------------------------- |
| `--raio-sm`    | 6px   | Input, badge pequeno               |
| `--raio`       | 10px  | Botão, cartão, aviso               |
| `--raio-lg`    | 14px  | Cartão de vazio, instalar PWA      |
| `--raio-cheio` | 999px | Pílula, marcador                   |
| `--toque-min`  | 44px  | Alvo mínimo de toque (não reduzir) |

## 6. Motion

- Transições apenas em propriedades compostas: `transform`, `opacity`, `background-color`, `border-color`.
- Duração padrão: `160ms cubic-bezier(0.2, 0, 0.2, 1)` (ease-out).
- `:active` → `transform: scale(0.97)` ancorado no gatilho.
- `@media (hover: hover)` para `:hover` (não aplicar hover em touch).
- `prefers-reduced-motion: reduce` → desativar animações, **exceto** spinner de carregamento (mantido, sem `!important` que congele).
- Sem `transition: all`, sem `ease-in`, sem fade-in em todo bloco, sem delays artificiais.

## 7. Regras de uso (anti "cara de IA")

1. **Não há cards aninhados.** Uma superfície por nível. Não colocar `.cartao` dentro de `.pilha` dentro de `.conteudo` quando um único nível basta.
2. **Não há faixa lateral (`border-left` + raio) como enfeite.** Usar hierarquia tipográfica e alinhamento rigoroso.
3. **Não há ícone acima de todo título.** Título direto, legenda opcional abaixo.
4. **Não há grids simétricos idênticos em toda seção.** Cada seção tem uma função; o layout segue a função.
5. **Não há sombra genérica em tudo.** Sombra só onde há elevação real.
6. **Cores nunca como único sinal.** Todo estado (erro, sucesso, aviso) tem ícone + texto.
7. **Microcopy direta.** Sem travessão decorativo, sem negrito de efeito, sem jargão técnico vazando para o usuário.
8. **Estados completos:** vazio útil, carregamento sem layout shift, erro acionável, offline com botão de recarregar, sucesso, permissão negada.

## 8. PWA / manifest (notas para Fase 3)

- `theme-color` deve variar por esquema de cor (claro/escuro) — hoje é único (`#A91825`).
- `background_color` vermelho gera flash ao abrir — ajustar para neutro quente.
- `orientation: portrait` trava o app; avaliar remoção.
- Ícone `maskable` com margem insuficiente — revisar em fase de assets.

---

Próximos passos na Fase 2: aplicar tokens nos componentes (`Botao`, `Campo`, `Aviso`, `Marca`), refazer `/inicio`, remover RBAC/flags do membro comum, e ajustar `tokens.css` com os valores acima.
