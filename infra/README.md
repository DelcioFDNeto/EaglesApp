# Infraestrutura do Eagles App

Como o backup é cifrado, como a chave é guardada e como a restauração é
testada. Se você só vai ler uma coisa aqui, leia a seção da chave privada.

---

## Backup

O `backup.sh` roda todo dia às 3h dentro do contêiner `backup`. Ele:

1. gera o dump do Postgres e o comprime;
2. confere que o dump está íntegro — marcador de fim presente e tabela
   `person` no conteúdo;
3. **cifra com a chave pública** e apaga o texto em claro;
4. envia a cópia cifrada para fora da VPS;
5. aplica a retenção e varre resíduos em claro de execuções interrompidas.

### Falha fechada

Sem `EAGLES_BACKUP_RECIPIENT`, o backup **não roda** — e recusa antes mesmo de
gerar o dump. Isso é deliberado. Um dump em claro carrega nome, telefone,
e-mail e data de nascimento da comunidade inteira; ele não é uma alternativa
aceitável a não ter backup, é um vazamento à espera do disco errado.

O script também sai com código 1 quando a cópia externa não acontece. O backup
local continua lá, mas o monitor precisa reclamar: backup que mora só na
máquina que pode morrer não é backup.

---

## A chave

A cifragem é **assimétrica**, com [age](https://age-encryption.org). São duas
chaves com destinos diferentes:

| Chave       | Onde fica                        | Serve para |
| ----------- | -------------------------------- | ---------- |
| **Pública** | na VPS, no `.env`                | cifrar     |
| **Privada** | **fora da VPS**, com a liderança | decifrar   |

É por isso que vale a pena: quem invadir a VPS consegue criar backups novos,
mas **não consegue ler nenhum backup antigo**. Se a chave privada estivesse na
máquina junto com os dados, a cifragem não protegeria de nada.

### Gerando o par

```sh
age-keygen -o eagles-backup.key
# Public key: age1qz...      <- esta vai para o .env da VPS
```

O arquivo `eagles-backup.key` contém a chave privada. Faça isto com ele:

```sh
chmod 600 eagles-backup.key
```

E então:

- **guarde em pelo menos dois lugares** — um gerenciador de senhas da liderança
  e uma cópia offline. Chave perdida é backup perdido: não existe recuperação,
  e é exatamente esse o ponto;
- **nunca** a coloque na VPS, no repositório, no Drive da equipe ou no WhatsApp;
- quem tem a chave deve ser mais de uma pessoa. Uma pessoa só é ponto único de
  falha, e a hora de descobrir isso não é durante um desastre.

---

## Restauração

### Ensaio mensal — obrigatório

Backup nunca restaurado deve ser considerado inexistente. Uma vez por mês,
baixe o backup mais recente e rode:

```sh
./restore.sh \
  --arquivo eagles_2026-08-23_0300.sql.gz.age \
  --chave ~/eagles-backup.key \
  --ensaio
```

O ensaio restaura num banco temporário, confere que o esquema voltou inteiro
— 12 tabelas, a tabela `person` e a view `person_view` — e descarta o banco.
Produção não é tocada em momento algum.

Se o ensaio falhar, o backup está quebrado **agora**, num dia em que ninguém
perdeu nada. É para isso que ele existe.

### Restauração de verdade

```sh
./restore.sh --arquivo <arquivo>.age --chave ~/eagles-backup.key --forcar
```

O `--forcar` é exigido quando o banco de destino já tem pessoas cadastradas,
porque restaurar por cima apaga o que está lá. Sem ele, o script recusa e diz
quantas pessoas seriam perdidas.

---

## Rodar fora do contêiner

Os dois scripts aceitam `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` e `DESTINO`
por ambiente. Os padrões apontam para o contêiner; sobrescrevê-los é o que
permite testar tudo numa máquina local, sem Docker:

```sh
EAGLES_BACKUP_RECIPIENT=age1... PGHOST=127.0.0.1 PGPORT=5432 \
  DESTINO=/tmp/backups sh backup.sh
```

---

## Subir em produção

Pré-requisitos: uma máquina com Docker e Docker Compose, as portas 80 e 443
abertas, e o `DOMINIO` já apontando para o IP dela (o Caddy pede o
certificado na primeira subida — sem o DNS certo, o desafio do Let's Encrypt
falha).

```sh
cp .env.example .env    # preencha a seção "Só em produção"
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```

A ordem é garantida pelo próprio compose: Postgres saudável → serviço
`migrate` aplica as migrações e sai → app sobe → Caddy publica com HTTPS. Uma
migração que falha segura o app velho no ar (ou nenhum, na primeira vez) em
vez de subir código novo com banco velho.

O monitor (Uptime Kuma) é opcional e não fica exposto na internet:

```sh
docker compose -f infra/docker-compose.yml --env-file .env --profile monitor up -d
ssh -L 3001:127.0.0.1:3001 usuario@sua-vps   # e abra http://localhost:3001
```

Crie a conta de administrador dele na primeira abertura — a primeira pessoa
que abre a tela é quem a cria. Numa VM de 1 GB, um monitor externo gratuito
apontando para `https://SEU_DOMINIO/api/health` sai mais barato em memória.

### Duas coisas para não esquecer

- **O fuso aparece em dois lugares e precisa ser o mesmo.** `FUSO`, no
  `.env`, é o do Postgres (o "hoje" dos gatilhos e da idade) e o do agendamento
  do backup. O app usa o fuso da equipe gravado no banco (`team.timezone`,
  `America/Sao_Paulo` por padrão). Mudou um, mude o outro.
- **O log de acesso do Caddy (`/data/access.log`) não guarda o token dos
  convites**: o caminho `/convite/…` sai mascarado e o `Referer` sai inteiro do
  registro. Se trocar o formato do log, mantenha o filtro — convite de
  recuperação é a conta de alguém.

---

## O que foi validado, e o que ainda não

Em **11/10/2026** a pilha rodou pela primeira vez, com as imagens e o
Caddyfile deste diretório (`DOMINIO=localhost`):

- Caddy oficial aceita o Caddyfile (`caddy validate`) — antes, a diretiva
  `rate_limit` (plugin, fora do Caddy oficial) impedia o Caddy de subir;
- Postgres → `migrate` (12 migrações) → app saudável → Caddy, nessa ordem;
- login completo por HTTPS, cookie `Secure; HttpOnly; SameSite=Lax`, POST de
  outra origem recusado (403), HTTP redirecionado para HTTPS;
- memória em repouso: app ~50 MB, Postgres ~42 MB, Caddy ~15 MB;
- `backup.sh` e `restore.sh` contra esse banco: dump cifrado sem sobra em
  claro, retenção preservando o dia 1º, ensaio restaurando e descartando o
  banco temporário — inclusive quando o ensaio falha no meio —, recusa de
  restaurar por cima de banco com pessoas, e recusa quando não dá para contar.

Ainda **não** validados, por limite do ambiente de teste, não do projeto:

- o build de `Dockerfile.backup` (`apk add age rclone`) — o repositório do
  Alpine estava bloqueado pelo proxy do ambiente; os scripts foram testados
  com o `age` oficial fora do contêiner;
- o certificado real do Let's Encrypt e o envio ao B2 — exigem domínio
  público e credenciais.

Esses três são os primeiros a conferir na VPS de verdade.

Em **17/10/2026** o Caddyfile rodou de novo — Caddy oficial 2.11.7 na frente
do app compilado — e mostrou o que a leitura não mostrava: o bloco `header`
sobrescrevia os cabeçalhos que o app manda por página, e os padrões com `?`
num bloco só não valiam quando o app mandava qualquer um deles. Hoje cada
cabeçalho de segurança sai uma vez só, o do app prevalece e o Caddy completa o
que falta (os arquivos estáticos não passam pelo app). Detalhe em
[`docs/revisao-2026-10-17.md`](../docs/revisao-2026-10-17.md).
