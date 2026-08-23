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

## Pendente

O deploy ainda não foi aplicado: falta o domínio (D-06) e as specs da VPS
(D-07.2). Enquanto isso, `docker-compose.yml`, `Caddyfile` e as imagens estão
versionados e prontos, mas nunca rodaram numa máquina real — e ninguém deve
tratá-los como validados até que rodem.
