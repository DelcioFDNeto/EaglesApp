# DESIGN.md — Eagles App

Fonte única de verdade para tokens de interface, arquitetura de UI e regras de uso. Todas as telas do produto são **modo Operate** (sistema, dashboard, formulários, admin). Nunca aplicar ritmo ou estética de landing page dentro de telas operacionais.

> Sincronizado com [`src/lib/styles/tokens.css`](src/lib/styles/tokens.css) e [`src/lib/ui/Moldura.svelte`](src/lib/ui/Moldura.svelte) na revisão `b9ee85d` (`27/11/2026`).

## 1. Modo de operação

| Superfície                                                                                                                                                                                                                                                                                                                                               | Modo        | Regra                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Telas autenticadas (`Moldura`):** `/inicio`, `/eventos`, `/eventos/novo`, `/eventos/[id]`, `/eventos/[id]/editar`, `/eventos/tipos`, `/frequencia`, `/draft`, `/grupos`, `/grupos/[id]`, `/pessoas`, `/pessoas/[id]`, `/responsabilidades`, `/comunicacao`, `/financeiro`, `/assistente`, `/lideranca`, `/admin`, `/perfil`, `/conta/sessoes`, `/menu` | **Operate** | Telas de sistema dentro da moldura (menu lateral no desktop, barra inferior no celular). Hierarquia tipográfica, superfícies limpas, alvos de toque ≥ 44 px, sem animação decorativa, sem copy de marketing. |
| **Telas sem sessão (`PainelEntrada`):** `/entrar`, `/convite/[token]`, `/esqueci-senha`, `/resetar-senha`, `/solicitar-cadastro`                                                                                                                                                                                                                         | **Operate** | Fora da moldura. No desktop ganham painel vermelho da marca à esquerda; no celular permanecem centralizadas e limpas.                                                                                        |
| `docs/site/*.html`                                                                                                                                                                                                                                                                                                                                       | **Read**    | Conteúdo estático de documentação.                                                                                                                                                                           |

## 2. Tokens de cor (WCAG 2.1 AA)

Contraste mínimo 4,5:1 para texto normal sobre fundo claro e escuro. Mínimo 3:1 para bordas de campo e componentes de UI (WCAG 1.4.11).

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
| `--cor-texto-2`      | `#4A3236` | `#C6B0B3` | Texto secundário (legenda, rótulo)                                                           |
| `--cor-texto-3`      | `#6D5054` | `#9E8689` | Texto terciário / ajuda — **só usar em tamanho ≥ 1rem ou com fundo de contraste suficiente** |
| `--cor-linha`        | `#D2BFBF` | `#3A1C22` | Borda sutil                                                                                  |
| `--cor-linha-forte`  | `#99777A` | `#87636A` | Borda de campo ativa / controles de formulário (contraste ≥ 3:1, WCAG 1.4.11)                |

### Estados semânticos (ícone + texto, nunca cor sozinha)

| Token                 | Claro     | Escuro    | Uso                                                        |
| --------------------- | --------- | --------- | ---------------------------------------------------------- |
| `--cor-sucesso`       | `#0D5C34` | `#5DD48B` | Confirmação, presença, acesso ativo                        |
| `--cor-sucesso-suave` | `#DCF3E0` | `#17301F` | Fundo de sucesso                                           |
| `--cor-aviso`         | `#7A4A0C` | `#E9A03C` | Aviso, pendência, evento cancelado                         |
| `--cor-aviso-suave`   | `#FBEEDD` | `#33230F` | Fundo de aviso                                             |
| `--cor-erro`          | `#7A1C1C` | `#F4757F` | Erro de validação ou falha de requisição                   |
| `--cor-erro-suave`    | `#FDEAEA` | `#331013` | Fundo de erro                                              |
| `--cor-perigo`        | `#580F20` | `#F0A9AF` | Ação destrutiva: SEMPRE contorno + ícone, nunca preenchido |
| `--cor-perigo-suave`  | `#F6E4E5` | `#33141A` | Fundo suave de ação destrutiva                             |

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

- **Títulos, botões e marca:** Archivo auto-hospedado (`font-src 'self'`, pesos `400–500` e `600–800`). ~25 KB, cabe no orçamento de bundle.
- **Corpo de texto, inputs, rótulos:** `system-ui` (sem flash de fonte na hidratação, performático em rede fraca).
- Linha do corpo: `1.55`. Títulos: `1.2`. `text-wrap: pretty` em parágrafos; `text-wrap: balance` em títulos.

## 4. Espaçamento e layout

| Token     | Valor   | Uso                              |
| --------- | ------- | -------------------------------- |
| `--esp-1` | 0.25rem | Gap interno de ícone/texto       |
| `--esp-2` | 0.5rem  | Gap entre label e input          |
| `--esp-3` | 0.75rem | Padding padrão, gap entre seções |
| `--esp-4` | 1rem    | Padding de cartão, seção         |
| `--esp-5` | 1.5rem  | Padding inline de botão cheio    |
| `--esp-6` | 2rem    | Padding de vazio centralizado    |
| `--esp-7` | 3rem    | Espaço entre blocos grandes      |

Conteúdo operacional sempre dentro de `.conteudo` (`margin-inline: auto`, padding `var(--esp-4)`):

| Onde                       | Largura do `.conteudo`                                    |
| -------------------------- | --------------------------------------------------------- |
| Celular (< 960px)          | 560px                                                     |
| Desktop (≥ 960px)          | 760px, ao lado do menu lateral de 256px                   |
| Desktop, `.conteudo.largo` | 1080px (painel com duas colunas, ex.: `/inicio` ≥ 1180px) |

### Moldura e navegação (`src/lib/ui/Moldura.svelte`)

- **Celular:** faixa da marca no topo + barra inferior com até 4 atalhos do dia a dia e "Mais" (`/menu`).
- **Desktop:** menu lateral fixo, agrupado em Dia a dia / Cuidar / Administrar, com a conta e o botão Sair no rodapé.
- Os itens vêm de [`src/lib/navegacao.ts`](src/lib/navegacao.ts), filtrados pelas permissões. O menu só esconde; quem barra é o servidor.
- Telas de topo não têm "← Início": a moldura já leva lá. Telas de detalhe mantêm o voltar delas ("← Eventos", "← Pessoas").
- Telas sem sessão (entrar, convite, senha) ficam fora da moldura; no desktop ganham o painel da marca ([`PainelEntrada.svelte`](src/lib/ui/PainelEntrada.svelte)).

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

## 8. Marca, ícones e prévia de links

- **Arte:** a águia da `Eagles.png`, recortada sem o letreiro (ilegível em ícone), sobre `#A91825`.
- **Ícones:** `icone-192/512` (`any`, águia em ~88% do quadro) e `icone-maskable-192/512` (~72%, dentro da área segura do Android), `apple-touch-icon` (180) e `favicon` (64).
- **Marca no app:** `marca-96/192.png` em quadrado arredondado ([`Marca.svelte`](src/lib/ui/Marca.svelte)).
- **Prévia de links (WhatsApp):** `og-eagles.jpg` (1200×630, < 100 KB) e metatags Open Graph no [`src/app.html`](src/app.html), com endereço absoluto vindo de `PUBLIC_SITE_URL`.
- `theme-color` separado para claro (`#A91825`) e escuro (`#17090C`). O app não trava mais na vertical.
- **Pendente:** logo vetorial (SVG). A arte de origem é um JPEG de 640 px; os ícones grandes saem levemente suaves.
