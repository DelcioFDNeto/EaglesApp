# Módulo 02 — Pessoas

- **Status:** **implementado** e verificado em 09/09/2026
- **Ciclo:** MVP, semanas 3–4
- **Depende de:** M01 (banco, política, auditoria, design system) — estável
- **Bloqueia:** M04 (Grupos), M05 (Eventos), M06 (Presença)

---

## 1. Objetivo

Dar ao Eagles App a entidade que sustenta todo o resto: **a pessoa**.

Ao final do M02, a liderança consegue cadastrar quem chega, acompanhar a
evolução de visitante até membro, registrar vínculos familiares e emitir o
convite de acesso — tudo isso respeitando quem pode ver o quê.

O que este módulo **não** é: uma ficha cadastral completa. É o cadastro
progressivo do briefing, em que só o nome é obrigatório e o resto chega quando
a relação amadurece.

---

## 2. Decisões deste módulo

### D-M02-1 — O módulo entra em duas fatias

`[DEC]` **Fatia A (este ciclo):** modelo da pessoa, jornada de status, vínculos,
consentimento, telas de cadastro e perfil, autocadastro de visitante e detecção
de duplicidade.

**Fatia B (próximo ciclo):** foto (RF-02.2), campos personalizados (RF-02.4) e
importação por planilha (RF-02.7).

**Por quê.** Foto não é "mais um campo": é armazenamento de arquivo, validação
de tipo real, reprocessamento da imagem para remover EXIF — que inclui as
coordenadas de GPS de onde a foto foi tirada — e uma rota autorizada para
servir o arquivo. Fazer isso junto com o resto dilui a atenção justamente na
parte com superfície de segurança. As três funcionalidades da fatia B são
`Should`, não `Must`, e nenhuma delas bloqueia M04, M05 ou M06.

### D-M02-2 — Status é dado, não enum

`[REQ]` RN-02 exige criar estágios novos sem alterar código. `membership_status`
nasce semeado com visitante, participante recorrente e membro, e a liderança
pode acrescentar outros.

Nenhum código faz `if (status === 'membro')`. Onde a regra depende do estágio,
ela lê uma propriedade da linha (`is_terminal`, `grants_role_id`), nunca a chave.

### D-M02-3 — Vínculos numa tabela só, com direção onde importa

`[DEC]` `person_relation` guarda irmão, cônjuge, namorado e responsável legal.

Os três primeiros são **simétricos**: "A é irmão de B" é o mesmo fato que
"B é irmão de A". Guardar as duas linhas convida à divergência — apaga-se uma e
o vínculo fica meio existente. Então grava-se **uma linha**, com ordenação
canônica (`person_a < person_b`) garantida por CHECK, e a consulta olha os dois
lados.

`responsavel_legal` é **dirigido**: `person_a` é o responsável, `person_b` é o
menor. O mesmo CHECK permite qualquer ordem só para esse tipo.

### D-M02-4 — Consentimento é log de eventos, não linha editável

`[DEC]` O ADR 0003 exige que revogar consentimento **crie uma linha nova** e que
nada seja apagado do histórico. Uma coluna `revoked_at` atualizável contradiz
isso — é UPDATE numa tabela que deveria ser append-only.

A implementação usa uma linha por **evento**: `kind`, `granted` (concedido ou
revogado), quem concedeu, quem registrou, evidência e data. O estado atual é a
linha mais recente de cada `(pessoa, tipo)`. O banco recusa UPDATE e DELETE,
como na auditoria.

É um refinamento da forma descrita no ADR, não do comportamento: tudo que o ADR
determina continua valendo, e a append-only passa a ser real em vez de
convencionada.

### D-M02-5 — Autocadastro nasce desligado

`[DEC]` RF-02.3 pede autocadastro de visitante por link/QR **do evento**, mas
eventos só existem no M05. Entra agora a versão de equipe: um link público,
atrás da chave de funcionalidade `autocadastro_visitante`, **desligada por
padrão** (RN-29), com limite de tentativas por IP.

Quando o M05 chegar, o mesmo formulário passa a aceitar um evento na URL. O
desenho já prevê a coluna de origem para não migrar dado depois.

---

## 3. O que será construído

### 3.1 Banco

**`person` ganha** — `phone`, `whatsapp`, `email`, `relationship_status`,
`joined_at`, `current_status_id`, `source` (como a pessoa chegou).

**Tabelas novas**

| Tabela                  | Papel                                                      |
| ----------------------- | ---------------------------------------------------------- |
| `membership_status`     | Estágios da jornada, configuráveis (RN-02)                 |
| `person_status_history` | Append-only: toda mudança com autor, motivo e data (RN-04) |
| `person_relation`       | Irmão, cônjuge, namorado, responsável legal                |
| `consent`               | Log de consentimento, append-only (ADR 0003)               |

**Regras no banco, não só no código:** `person_view` recriada com as colunas
novas; CHECK de coerência nos vínculos; gatilhos de append-only em
`person_status_history` e `consent`; índice de busca por nome sem acento.

### 3.2 Regime de dados de menor (ADR 0003)

O ponto mais delicado do módulo. Uma função única decide o regime, e todo o
resto a consulta:

```
regimeDe(pessoa, consentimentos) → { podeGuardarContato, podeGuardarFoto, ... }
```

`is_minor` nulo — data de nascimento desconhecida — significa **regime
restrito**, nunca "é maior de idade".

Menor sem responsável vinculado e sem consentimento de `dados_cadastrais` fica
em cadastro mínimo: nome e presença, mais nada (RN-30). O serviço **recusa
gravar** contato nesse estado; a tela nem mostra os campos. Como hoje não há
menores (D-03), o caminho existe testado e inativo.

### 3.3 Telas

| Rota                   | Permissão                         | O que faz                                      |
| ---------------------- | --------------------------------- | ---------------------------------------------- |
| `/pessoas`             | `person.view`                     | Lista com busca, filtro por status             |
| `/pessoas/nova`        | `person.create`                   | Cadastro progressivo — só o nome é obrigatório |
| `/pessoas/[id]`        | `person.view`                     | Perfil, vínculos e linha do tempo              |
| `/pessoas/[id]/editar` | `person.update`                   | Edição, com campos sensíveis por permissão     |
| `/sou-novo`            | pública, atrás de chave desligada | Autocadastro de visitante                      |

O conselheiro vê as pessoas dos seus grupos; o líder vê todas. Como os grupos
só chegam no M04, o recorte por grupo entra preparado e exercitado por teste,
mas ainda sem dados de grupo para recortar.

### 3.4 Detecção de duplicidade (RF-02.6)

Compara nome normalizado (sem acento, sem caixa, espaços colapsados) e telefone
só com dígitos. **Avisa, nunca bloqueia** — "parece que Ana Clara Souza já
existe" com link para o cadastro. Duas pessoas podem ter o mesmo nome, e um
sistema que impede o segundo cadastro força a liderança a inventar contorno.

---

## 4. Regras de negócio aplicáveis

| ID    | Regra                                            | Como é garantida                                                                  |
| ----- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| RN-01 | Pessoa existe sem conta                          | Já garantido no M01; o cadastro nunca cria `user_account`                         |
| RN-02 | Jornada com estágios criáveis sem código         | `membership_status` como dado; nenhuma comparação por chave no código             |
| RN-03 | Outside não promove ninguém                      | Nenhuma transição automática de status existe. Toda mudança tem autor humano      |
| RN-04 | Mudança de status é histórico imutável           | `person_status_history` com gatilho que recusa UPDATE e DELETE                    |
| RN-05 | Só o nome é obrigatório em nível de sistema      | `NOT NULL` apenas em `full_name`; o resto é opcional no banco e no formulário     |
| RN-28 | Alterações relevantes vão para a auditoria       | `person.criada`, `person.atualizada`, `person.status_alterado`, `person.removida` |
| RN-29 | Funcionalidade opcional funciona desligada       | Autocadastro atrás de chave; teste cobre o estado desligado                       |
| RN-30 | Menor sem consentimento fica em cadastro mínimo  | `regimeDe()` no serviço recusa gravar contato; a tela não renderiza os campos     |
| RN-32 | Contato de menor só para `person.view_sensitive` | Filtro na camada de leitura, não na tela                                          |
| RN-34 | Revogar consentimento remove o dado              | Revogar `dados_cadastrais` de menor limpa os campos de contato na mesma transação |

---

## 5. Riscos

| Risco                                               | Mitigação                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Regime de menor implementado só na interface        | A decisão vive no serviço; o teste tenta gravar contato de menor direto pelo serviço |
| `person_view` esquecida ao adicionar coluna         | A view usa `SELECT p.*`, que congela as colunas na criação — a migração a recria     |
| Cadastro virar formulário longo e ninguém preencher | Só o nome é obrigatório; o resto fica atrás de "adicionar mais informações"          |
| Status virar `if` espalhado pelo código             | Teste que varre o código atrás de comparação literal com chave de status             |
| Autocadastro público aberto a robô                  | Chave desligada por padrão, limite por IP reaproveitado do M01                       |

---

## 6. Critérios de aceitação

Verificado em **09/09/2026**: `npm test` → **156 testes** · `npm run test:e2e` → **43 testes** em dois projetos de navegador · `npm run check` → **0 erros em 694 arquivos** · `npm run build` → sucesso · **3 KB** de JS de entrada comprimido.

### ✅ Atendidos

| Critério                                                            | Evidência                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Cadastro só com o nome (RN-05)                                      | `pessoas.test.ts` "cria pessoa só com o nome"; e2e "cadastra alguém informando apenas o nome"     |
| Campo vazio vira `null`, nunca `''`                                 | `pessoa-validacao.test.ts`                                                                        |
| Estágio padrão atribuído, com a primeira linha de histórico (RN-04) | `pessoas.test.ts` "atribui o estágio padrão e já grava a primeira linha"                          |
| Histórico de estágio é append-only                                  | O banco recusa UPDATE e DELETE — gatilho da migração 0003, testado                                |
| Consentimento é append-only, e revogar APAGA o dado (RN-34)         | `pessoas.test.ts` "revogar cria linha nova e APAGA o contato"                                     |
| Regime restrito recusa gravar contato de menor (RN-30)              | O SERVIÇO recusa, não a tela. Quatro testes, incluindo idade desconhecida                         |
| Idade desconhecida é tratada como menor                             | `regime-de-dados.test.ts` — o caso que mais importa, porque é o estado normal de um cadastro novo |
| Contato só para `person.view_sensitive` (RN-32)                     | `pessoas.test.ts`; e2e confirma que o telefone não aparece no HTML do membro                      |
| Vínculo simétrico é uma linha só, visível dos dois lados            | `pessoas.test.ts`, incluindo criação em ordem invertida                                           |
| Duplicidade avisa e deixa continuar (RF-02.6)                       | Integração + e2e, com o botão mudando para "Cadastrar mesmo assim"                                |
| Autocadastro funciona DESLIGADO (RN-29)                             | e2e: a rota responde 404, e o POST com `Origin` correto também                                    |
| Menor não informa o próprio contato no formulário público           | Integração + e2e, inclusive indo direto ao POST sem passar pela tela                              |
| Estágios são dados, não enum (RN-02)                                | `estagios-sao-dados.test.ts` varre o código atrás de comparação literal                           |
| Busca ignora acento                                                 | Coluna gerada no banco, com teste provando que casa com a normalização do TypeScript              |
| Toda rota declara sua permissão                                     | `rotas-declaram-permissao.test.ts`, agora ciente de `canAnywhere`                                 |

### ⬜ Fora desta fatia (D-M02-1)

Foto (RF-02.2), campos personalizados (RF-02.4) e importação por planilha (RF-02.7) — a fatia B.

### ⬜ Limitação conhecida, resolvida no M04

`person.update` e `person.delete` são verificadas COM escopo do grupo da pessoa. Como grupos só existem no M04, hoje o contexto de grupo é sempre nulo e **apenas quem tem escopo global edita**. Um conselheiro cadastra e consulta, mas ainda não edita.

Foi escolha consciente de errar para o lado seguro: leitura e criação foram liberadas por `canAnywhere` porque não têm alvo com grupo; escrita sobre registro existente ficou restrita, porque é onde o estrago é irreversível.

---

## 7. Defeitos encontrados fora do escopo do módulo

Três problemas do M01 que só apareceram quando o M02 exercitou caminhos novos. Todos corrigidos neste ciclo.

### 7.1 A CSP impedia a aplicação de hidratar — o mais grave

`hooks.server.ts` montava a CSP à mão com `script-src 'self'`. O SvelteKit emite um `<script>` **inline** para iniciar a aplicação, e a política bloqueava exatamente esse script.

O efeito foi silencioso da pior forma possível: como as telas vêm renderizadas do servidor e os formulários funcionam sem JavaScript, **tudo continuava funcionando**. Só que sem hidratar nunca — sem navegação no cliente, sem `use:enhance`, sem service worker, sem nenhuma reatividade. Numa arquitetura escolhida justamente por processar a interação no dispositivo quando a rede é ruim, a característica principal estava desligada desde o primeiro dia.

Nenhum teste pegava porque todos verificavam **resultado**, e o resultado era idêntico. Foi preciso uma tela que dependesse de reatividade de verdade — o autocadastro, que troca os campos conforme a idade — para o problema aparecer.

**Correção:** a CSP passou para `kit.csp` em `svelte.config.js`, onde o próprio SvelteKit acrescenta o nonce aos scripts que gera. Continua sem `unsafe-inline`. **Guarda:** `tests/e2e/hidratacao.spec.ts` reprova se houver violação de CSP no console ou se a navegação interna virar recarga de página.

### 7.2 O conselheiro não conseguia abrir o app

`/inicio` verificava `event.view` com contexto de pessoa. Os papéis de conselheiro são atribuídos a um GRUPO, e uma atribuição de grupo não autoriza sem `groupId` no contexto — então todo conselheiro recebia "acesso negado" na tela inicial.

O papel estava certo; a pergunta é que era a errada. Passou a usar `authorizeAnywhere`, porque o painel é do próprio usuário e não pertence a grupo nenhum. **Guarda:** teste que entra com cada papel semeado e confere que o painel abre — nenhum teste do M01 entrava como conselheiro.

### 7.3 Atrás do proxy, o limite de login travaria a comunidade inteira

Sem `ADDRESS_HEADER` configurado, `getClientAddress()` devolve o IP do Caddy para todo mundo. O limite de 20 tentativas por IP em 5 minutos viraria um bloqueio geral numa noite de PG — e a auditoria registraria o IP errado em cada linha.

**Correção:** `ADDRESS_HEADER` e `XFF_DEPTH` no `docker-compose`, e o teto por IP virou `LOGIN_MAX_POR_IP`, configurável, porque o valor certo depende de como o app está exposto.

### 7.4 Menores

`npm run db:seed` quebrava fora do ciclo do SvelteKit: `vite.script.config.ts` não repetia os aliases `$server`/`$shared`. E `db.execute()` com SQL cru devolve formatos DIFERENTES no PGlite dos testes e no postgres.js da produção — a consulta à `person_view` passava no teste e dava 500 no ar. A view passou a ser declarada no Drizzle e consultada pelo construtor.
