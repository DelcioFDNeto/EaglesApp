#!/bin/sh
# Restaura um backup do Eagles.
#
# Uso (no console do container `backup`):
#
#   restaurar.sh listar                       # backups locais e remotos
#   restaurar.sh <arquivo> [banco]            # restaura num banco NOVO (padrão:
#                                             # eagles_restaurado) para conferir
#   restaurar.sh <arquivo> eagles --substituir
#                                             # desastre: SUBSTITUI o banco da
#                                             # API (pare a API antes!)
#
# <arquivo> pode ser um nome local (eagles_AAAA-MM-DD_HHMM.dump.gpg) ou estar
# só no remoto — nesse caso é baixado. Pede a mesma BACKUP_SENHA do backup.

set -eu

DIR=${BACKUP_DIR:-/backups}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
falhar() { log "ERRO: $*" >&2; exit 1; }

configurar_remoto() {
	REMOTO=""
	if [ -n "${BACKUP_RCLONE_CONF:-}" ]; then
		printf '%s' "$BACKUP_RCLONE_CONF" | base64 -d > "$TMP/rclone.conf"
		export RCLONE_CONFIG="$TMP/rclone.conf"
		REMOTO=${BACKUP_DESTINO:-}
	elif [ -n "${BACKUP_B2_CONTA:-}" ] && [ -n "${BACKUP_B2_CHAVE:-}" ] && [ -n "${BACKUP_B2_BUCKET:-}" ]; then
		export RCLONE_CONFIG_B2_TYPE=b2
		export RCLONE_CONFIG_B2_ACCOUNT="$BACKUP_B2_CONTA"
		export RCLONE_CONFIG_B2_KEY="$BACKUP_B2_CHAVE"
		REMOTO="b2:${BACKUP_B2_BUCKET}/eagles"
	fi
}

[ $# -ge 1 ] || falhar "informe 'listar' ou o nome do arquivo. Veja o cabeçalho deste script."
configurar_remoto

if [ "$1" = "listar" ]; then
	echo "Locais ($DIR):"
	ls -1t "$DIR"/eagles_*.dump.gpg 2> /dev/null | xargs -n1 basename 2> /dev/null || echo "  (nenhum)"
	if [ -n "$REMOTO" ]; then
		echo "Remotos ($REMOTO):"
		rclone lsf "$REMOTO" --include 'eagles_*.dump.gpg' | sort -r
	fi
	exit 0
fi

ARQUIVO=$(basename "$1")
DESTINO=${2:-eagles_restaurado}
SUBSTITUIR=${3:-}

[ -n "${BACKUP_SENHA:-}" ] || falhar "BACKUP_SENHA não definida."

if [ "$DESTINO" = "${PGDATABASE:-eagles}" ] && [ "$SUBSTITUIR" != "--substituir" ]; then
	falhar "restaurar em '$DESTINO' apaga o banco da API. Pare a API e repita com --substituir."
fi

if [ -f "$DIR/$ARQUIVO" ]; then
	cp "$DIR/$ARQUIVO" "$TMP/$ARQUIVO"
elif [ -n "$REMOTO" ]; then
	log "baixando $ARQUIVO de $REMOTO…"
	rclone copyto "$REMOTO/$ARQUIVO" "$TMP/$ARQUIVO" || falhar "não encontrei $ARQUIVO no remoto."
else
	falhar "$ARQUIVO não está em $DIR e não há remoto configurado."
fi

printf '%s' "$BACKUP_SENHA" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 \
	-d "$TMP/$ARQUIVO" > "$TMP/banco.dump" || falhar "não abriu: senha errada ou arquivo corrompido."

log "restaurando em '$DESTINO'…"
dropdb --if-exists --force "$DESTINO"
createdb "$DESTINO"
pg_restore --no-owner --no-privileges --exit-on-error -d "$DESTINO" "$TMP/banco.dump"

PESSOAS=$(psql -d "$DESTINO" -tAc "select count(*) from person")
log "restaurado em '$DESTINO': $PESSOAS pessoas."
[ "$DESTINO" = "${PGDATABASE:-eagles}" ] && log "Banco da API substituído. Pode subir a API de novo."
exit 0
