# Varredura de erros — módulos 01 a 06 e infraestrutura

- **Data:** 11/10/2026, depois do fechamento do MVP
- **Escopo:** todo o código de `src/`, a semente e `infra/` (deploy, backup, restauração)
- **Resultado:** 32 defeitos corrigidos — 1 crítico de segurança, 1 crítico de deploy —, cada um com teste que o reproduz
- **Revisada em 17/10/2026:** [`revisao-2026-10-17.md`](revisao-2026-10-17.md) — o que esta varredura deixou passar. As linhas abaixo ficam como estavam; o que mudou desde então está no fim

---

## Como foi feita

1. **Revisão completa** do código, módulo a módulo, procurando defeitos de correção e de segurança — não estilo.
2. **Nenhum achado foi aceito sem conferência no código.** Cada um virou um teste que falharia antes da correção; os que não se reproduziram ficaram de fora.
3. **A infraestrutura rodou de verdade pela primeira vez.** Até aqui, `docker-compose.yml`, `Caddyfile` e os scripts de backup estavam versionados, mas nunca tinham subido numa máquina. Nesta varredura a pilha de produção subiu inteira (Caddy oficial, migrações, app, Postgres), com login por HTTPS, e os scripts de backup e restauração rodaram contra esse banco.

---

## Segurança

| #   | Gravidade   | O que acontecia                                                                                                                                                                                                                                                                                                        | Correção                                                                                                                                                           |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | **crítica** | **Convite como atalho para poder.** Quem gera o convite recebe o link — e quem tem o link fica com a conta. O conselheiro de um PG em que o líder é membro gerava um "convite de recuperação" para o líder, abria o link e assumia a conta dele. O mesmo valia para o primeiro convite de quem já tinha papel de líder | **Trava 5:** só convida quem já detém, no mesmo alcance, tudo o que a conta convidada vai poder (`permissoesForaDoAlcance`). Teste do ataque e do caso de todo dia |
| S2  | alta        | Um papel personalizado com `person.update` e sem `view_sensitive` recebia o formulário com nascimento e contato **vazios** — salvar só o nome apagava telefone, e-mail e observações                                                                                                                                   | O formulário só mostra esses campos a quem os vê; o serviço recusa escrevê-los a quem não os vê                                                                    |
| S3  | média       | A data de nascimento exata ia na página de perfil para qualquer membro, embora a tela só a mostrasse a quem vê dados sensíveis                                                                                                                                                                                         | Vai junto com o contato; a idade continua pública como antes                                                                                                       |
| S4  | média       | O aviso "já existe alguém com este telefone" dizia o **nome** do dono do número, mesmo de outro grupo — um oráculo "número → pessoa"                                                                                                                                                                                   | O aviso continua; o nome só aparece para quem pode ver o contato daquela pessoa                                                                                    |
| S5  | média       | O vínculo "responsável legal" conferia permissão sobre um lado só — e ele muda o regime de dados do menor (ainda sem tela)                                                                                                                                                                                             | Permissão sobre as duas pessoas, mesma equipe                                                                                                                      |
| S6  | média       | Remover uma pessoa podia zerar os administradores da equipe, e deixava os papéis dela para trás                                                                                                                                                                                                                        | Os papéis saem junto, sob a mesma trava do último administrador (ainda sem tela)                                                                                   |
| S7  | baixa       | O sinal "é menor de idade" e os motivos de saída/mudança de grupo (texto livre, às vezes pessoal) iam na página para qualquer membro                                                                                                                                                                                   | Só para quem vê os dados sensíveis daquela pessoa ou daquele grupo                                                                                                 |
| S8  | baixa       | Convite para conta desativada era consumido e a pessoa voltava ao login sem entender                                                                                                                                                                                                                                   | Recusado na emissão e no aceite, com a explicação                                                                                                                  |

## Dados e erros de tela

| #   | Gravidade | O que acontecia                                                                                                                                                          | Correção                                                                                                                                                         |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | alta      | **Editar só o título de um retiro de sexta a domingo o encurtava para sexta**; a vigília de sábado para domingo não se editava                                           | A edição tem "termina em outro dia?" e calcula o fim como a criação. O término em outro dia aparece no evento, na agenda, no link público e no texto do WhatsApp |
| D2  | média     | Ids malformados em filtros e formulários viravam erro 500 (pessoas, grupos, estágios, papéis, tipos)                                                                     | Formato conferido na fronteira de cada serviço; URL com id inválido responde 404 pelo roteador                                                                   |
| D3  | média     | O V8 aceita "31/02" e o transforma em 3 de março: a data passava na validação e virava 500 no banco — ou o evento mudava de dia em silêncio                              | Validação confere o calendário                                                                                                                                   |
| D4  | média     | Arquivar grupo e excluir papel eram recusados por atribuições **vencidas** ou de pessoas removidas, que nenhuma tela mostrava — sem saída                                | Uma regra só de "atribuição em vigor" (antes, seis cópias), usada pela política, pelas telas, pelas travas e pelo gatilho do banco (migração 0011)               |
| D5  | média     | Na lista de presença, o visitante da porta era cadastrado **antes** de a lista ser validada: evento cancelado com a tela aberta gerava um cadastro a cada nova tentativa | O estado do evento é conferido antes de cadastrar; depois de cadastrado, a tela volta com a pessoa marcada e os campos vazios                                    |
| D6  | média     | Login por telefone: "+55 11 98765-4321" e "(11) 98765-4321" eram contas diferentes                                                                                       | O 55 do país sai na normalização; o formato antigo continua sendo encontrado                                                                                     |
| D7  | média     | O autocadastro gastava a cota de cadastros com erro de digitação — numa noite de PG, no mesmo Wi-Fi, bloquearia os visitantes seguintes                                  | Cota de **envios** (folgada, contra robô) separada da de **cadastros** (só o válido conta)                                                                       |
| D8  | média     | Revogação de consentimento gravava o registro e apagava o contato fora de transação; como o registro é append-only, um erro no meio não teria conserto                   | Uma transação                                                                                                                                                    |
| D9  | média     | Estágio removido com o perfil aberto levava à página genérica de erro                                                                                                    | A recusa aparece na própria tela                                                                                                                                 |
| D10 | baixa     | Datas formatadas no servidor sem fuso: em UTC (a VPS), a validade do convite e as datas de seis telas viravam o dia seguinte depois das 21h                              | Fuso explícito                                                                                                                                                   |
| D11 | baixa     | O contador de tentativas de login em memória nunca era podado; as chaves são escolhidas por quem tenta entrar                                                            | Poda oportunista a cada 10 minutos                                                                                                                               |

## Infraestrutura de deploy

| #   | Gravidade   | O que acontecia                                                                                                                         | Correção                                                                                                             |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| I1  | **crítica** | **O Caddy não subia:** `rate_limit` não existe no Caddy oficial (é um plugin) — "unrecognized directive". Sem Caddy, sem HTTPS, sem app | Diretiva removida; os limites que importam já estão na aplicação. Conferido com o binário oficial (`caddy validate`) |
| I2  | alta        | O e-mail do ACME caía no padrão `admin@localhost`, que o Let's Encrypt recusa — o certificado não sairia                                | `ACME_EMAIL` obrigatório no `.env` e repassado ao Caddy                                                              |
| I3  | alta        | Sem `.dockerignore`, o build levava o `node_modules` da máquina (binários de outra plataforma), o `.env` com segredos e o `.git`        | `.dockerignore`                                                                                                      |
| I4  | alta        | As migrações viajavam na imagem, mas nada as aplicava                                                                                   | Serviço `migrate`: o app só sobe depois que as migrações terminam bem                                                |
| I5  | alta        | A cópia externa do backup falharia sempre: as credenciais do B2 não chegavam ao `rclone`                                                | Variáveis `RCLONE_CONFIG_B2_*` no compose                                                                            |
| I6  | alta        | `restore.sh` **apagava o banco de destino** se a contagem de pessoas falhasse por qualquer motivo (falha aberta)                        | Falha fechada: sem contar, não apaga sem `--forcar`                                                                  |
| I7  | média       | O backup rodava "24h depois de o contêiner subir": o `date` do Alpine não entende `tomorrow 03:00`                                      | Próximas 3h no fuso da equipe — testado no contêiner                                                                 |
| I8  | média       | A retenção apagava os backups mensais junto com os diários (padrão de nome errado)                                                      | Preserva o dia 1º por um ano — testado                                                                               |
| I9  | média       | Falha no envio dos anexos encerrava o backup antes da retenção e da varredura de texto em claro                                         | Cada envio tratado                                                                                                   |
| I10 | média       | Ensaio de restauração que falhava deixava um banco com os dados da comunidade decifrados                                                | Limpeza na saída, por qualquer caminho — testado com dump quebrado                                                   |
| I11 | média       | O Uptime Kuma ficava exposto em `monitor.<domínio>`: a primeira pessoa que abre a tela cria o administrador                             | Opcional (perfil `monitor`), só na própria máquina, acesso por túnel SSH                                             |
| I12 | baixa       | O banco em UTC fazia o "hoje" dos gatilhos e da idade virar o dia seguinte às 21h                                                       | Banco no fuso da equipe                                                                                              |
| I13 | baixa       | Duas réplicas e o monitor por padrão: pesado para uma VM gratuita de 1 GB                                                               | Uma réplica por padrão (`APP_REPLICAS`), monitor opcional                                                            |

## Limpezas que vieram junto

Uma regra para formato de id (eram quatro cópias), uma para idade (duas), uma para "atribuição em vigor" (seis); a tradução do público do evento reaproveitada na frequência; o cálculo de frequência com as passagens indexadas por pessoa (antes, um relatório de um ano fazia dezenas de milhões de comparações); imports sem uso removidos.

## Deixado como está, de propósito

- **A agenda materializa encontros ao ler, e consulta o fuso da equipe três vezes por tela.** Custo desprezível nesta escala; mexer seria mexer no caminho mais testado do M05 sem ganho perceptível.
- **Cada réplica do app tem o próprio contador de tentativas de login.** Com uma réplica (o novo padrão), não há diferença.

---

## Verificação

`npm test` → **418 testes** (eram 393) · `npm run test:e2e` → **84 testes** (eram 83) · `npm run check` → **0 erros em 833 arquivos** · `npm run build` → sucesso.

Pilha de produção, rodando: Caddy válido → Postgres → 12 migrações → app saudável; login por HTTPS com cookie `Secure; HttpOnly; SameSite=Lax`; POST de outra origem recusado; **~105 MB de memória em repouso** (app ~50, Postgres ~42, Caddy ~15). Backup cifrado, retenção, ensaio, recusa de sobrescrever e limpeza do ensaio com falha — todos exercitados.

Não validados aqui, por limite do ambiente de teste: o build da imagem de backup (repositório do Alpine bloqueado pelo proxy do ambiente), o certificado real do Let's Encrypt e o envio ao B2 — os três primeiros itens a conferir na VPS. Ver `infra/README.md`.

---

## O que a revisão de 17/10/2026 mudou aqui

- **S1:** a trava 5 também vale no **aceite** — conferida só na emissão, bastava guardar o link até a promoção de quem foi convidado.
- **S5:** **desfazer** o vínculo também confere os dois lados.
- **S6:** remover a pessoa também encerra as sessões e cancela os convites dela, e não toca em nada fora da equipe.
- **D1:** o evento de vários dias continua no início enquanto acontece; "das 22h às 0h" é aceito e exibido como fim do mesmo dia.
- **D6:** a busca do "formato antigo" (com o 55) saiu — era ambígua e nunca houve deploy. O telefone de entrada tem uma forma só, conferida pelo banco (migração 0012).
- **I1:** sem o `rate_limit`, os cabeçalhos do Caddy passaram a ser só o padrão: antes, sobrescreviam os do app.
