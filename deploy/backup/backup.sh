#!/bin/sh
# Backup do banco do Eagles — roda todo dia (ver agendador.sh).
#
# Regras (seção 15.5): backup que mora só na máquina que pode morrer NÃO é
# backup, e backup nunca restaurado deve ser considerado inexistente. Então,
# a cada execução:
#
#   1. pg_dump no formato custom (comprimido);
#   2. RESTAURA o dump num banco temporário e confere que os dados voltaram —
#      um dump que não restaura é descartado e a execução falha;
#   3. criptografa (AES-256, senha em BACKUP_SENHA) antes de sair daqui;
#   4. envia para fora da VPS (rclone) e confere que chegou inteiro;
#   5. aplica retenção local e remota;
#   6. só então marca sucesso — o healthcheck do container lê essa marca.
#
# Conexão com o banco pelas variáveis padrão do Postgres: PGHOST, PGUSER,
# PGPASSWORD, PGDATABASE.

set -eu

DIR=${BACKUP_DIR:-/backups}
RETENCAO_LOCAL=${BACKUP_RETENCAO_LOCAL:-7}
RETENCAO_REMOTA_DIAS=${BACKUP_RETENCAO_REMOTA_DIAS:-90}
BANCO_TESTE=eagles_verificacao_backup
DATA=$(date +%Y-%m-%d_%H%M)
NOME="eagles_${DATA}.dump.gpg"
TMP=$(mktemp -d)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
falhar() {
	log "ERRO: $*" >&2
	printf '%s\n' "$(date '+%Y-%m-%d %H:%M:%S') ERRO: $*" > "$DIR/ultimo-erro.txt"
	exit 1
}
limpar() {
	rm -rf "$TMP"
	dropdb --if-exists "$BANCO_TESTE" > /dev/null 2>&1 || true
}
trap limpar EXIT

[ -n "${BACKUP_SENHA:-}" ] || falhar "BACKUP_SENHA não definida: o backup não sai sem criptografia."
[ "${#BACKUP_SENHA}" -ge 16 ] || falhar "BACKUP_SENHA precisa de pelo menos 16 caracteres."
mkdir -p "$DIR"

# --- 1. Dump -----------------------------------------------------------------
log "dump de ${PGDATABASE}…"
pg_dump --format=custom --compress=9 --no-owner --no-privileges -f "$TMP/banco.dump" \
	|| falhar "pg_dump falhou."

TAMANHO=$(wc -c < "$TMP/banco.dump" | tr -d ' ')
[ "$TAMANHO" -ge 4096 ] || falhar "dump com $TAMANHO bytes: pequeno demais para ser válido."

# --- 2. Restauração de verdade, num banco descartável ------------------------
log "restaurando em ${BANCO_TESTE} para verificar…"
dropdb --if-exists "$BANCO_TESTE" > /dev/null 2>&1 || true
createdb "$BANCO_TESTE" || falhar "não foi possível criar o banco de verificação."
pg_restore --no-owner --no-privileges --exit-on-error -d "$BANCO_TESTE" "$TMP/banco.dump" \
	|| falhar "o dump NÃO restaura. Backup descartado."

# O banco restaurado precisa ter a estrutura e os dados essenciais.
TABELAS=$(psql -d "$BANCO_TESTE" -tAc \
	"select count(*) from information_schema.tables where table_schema = 'public'")
ORIGEM=$(psql -tAc "select count(*) from person")
RESTAURADO=$(psql -d "$BANCO_TESTE" -tAc "select count(*) from person")
MIGRACOES=$(psql -d "$BANCO_TESTE" -tAc "select count(*) from drizzle.__drizzle_migrations")

[ "$TABELAS" -ge 30 ] || falhar "restauração com só $TABELAS tabelas."
[ "$RESTAURADO" = "$ORIGEM" ] || falhar "pessoas: $ORIGEM no banco, $RESTAURADO na restauração."
[ "$MIGRACOES" -ge 1 ] || falhar "restauração sem o histórico de migrações."
dropdb "$BANCO_TESTE"
log "restauração conferida: $TABELAS tabelas, $RESTAURADO pessoas, $MIGRACOES migrações"

# --- 3. Criptografia ---------------------------------------------------------
printf '%s' "$BACKUP_SENHA" | gpg --batch --yes --quiet --pinentry-mode loopback \
	--passphrase-fd 0 --symmetric --cipher-algo AES256 \
	-o "$TMP/$NOME" "$TMP/banco.dump" || falhar "criptografia falhou."

# A senha abre o arquivo? (gpg confere a integridade ao decifrar)
printf '%s' "$BACKUP_SENHA" | gpg --batch --quiet --pinentry-mode loopback \
	--passphrase-fd 0 -d "$TMP/$NOME" > "$TMP/conferencia.dump" 2> /dev/null \
	|| falhar "o arquivo criptografado não abre com a BACKUP_SENHA."
cmp -s "$TMP/banco.dump" "$TMP/conferencia.dump" || falhar "o arquivo decifrado difere do dump."

mv "$TMP/$NOME" "$DIR/$NOME"
log "local: $DIR/$NOME ($((TAMANHO / 1024)) KB antes de criptografar)"

# --- 4. Cópia fora da VPS ----------------------------------------------------
REMOTO=""
if [ -n "${BACKUP_RCLONE_CONF:-}" ]; then
	# rclone.conf completo, em base64 (qualquer provedor que o rclone aceite).
	printf '%s' "$BACKUP_RCLONE_CONF" | base64 -d > "$TMP/rclone.conf"
	export RCLONE_CONFIG="$TMP/rclone.conf"
	REMOTO=${BACKUP_DESTINO:-}
elif [ -n "${BACKUP_B2_CONTA:-}" ] && [ -n "${BACKUP_B2_CHAVE:-}" ] && [ -n "${BACKUP_B2_BUCKET:-}" ]; then
	# Backblaze B2: o caminho mais simples (10 GB grátis).
	export RCLONE_CONFIG_B2_TYPE=b2
	export RCLONE_CONFIG_B2_ACCOUNT="$BACKUP_B2_CONTA"
	export RCLONE_CONFIG_B2_KEY="$BACKUP_B2_CHAVE"
	REMOTO="b2:${BACKUP_B2_BUCKET}/eagles"
fi

if [ -z "$REMOTO" ]; then
	falhar "sem cópia externa configurada (BACKUP_B2_* ou BACKUP_RCLONE_CONF + BACKUP_DESTINO). O arquivo ficou só na VPS."
fi

log "enviando para ${REMOTO}…"
rclone copyto "$DIR/$NOME" "$REMOTO/$NOME" --retries 3 || falhar "envio para $REMOTO falhou."
rclone check "$DIR" "$REMOTO" --one-way --include "$NOME" > /dev/null 2>&1 \
	|| falhar "a cópia em $REMOTO não confere com o arquivo local."
log "cópia externa conferida"

# --- 5. Retenção -------------------------------------------------------------
# Local: os N mais recentes. Remota: tudo até X dias.
ls -1t "$DIR"/eagles_*.dump.gpg 2> /dev/null | tail -n "+$((RETENCAO_LOCAL + 1))" | while read -r velho; do
	rm -f "$velho"
done
rclone delete "$REMOTO" --min-age "${RETENCAO_REMOTA_DIAS}d" --include 'eagles_*.dump.gpg' \
	> /dev/null 2>&1 || log "AVISO: não foi possível aplicar a retenção remota."

# --- 6. Sucesso --------------------------------------------------------------
printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$NOME" > "$DIR/ultimo-sucesso.txt"
rm -f "$DIR/ultimo-erro.txt"
log "backup concluído: $NOME"
