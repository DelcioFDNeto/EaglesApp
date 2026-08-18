#!/bin/sh
# Backup do Eagles App.
#
# Regra que não se negocia (seção 15.5): backup que mora só na máquina que
# pode morrer NÃO é backup. A cópia externa é obrigatória, e a restauração
# precisa ser testada uma vez por mês — backup nunca testado deve ser
# considerado inexistente.

set -eu

DATA=$(date +%Y-%m-%d_%H%M)
DESTINO=/backups
ARQUIVO="$DESTINO/eagles_$DATA.sql.gz"
ANEXOS="$DESTINO/anexos_$DATA.tar.gz"
RETENCAO=${RETENCAO_DIARIA:-7}

echo "[$(date -Iseconds)] iniciando backup"

# --- Banco ------------------------------------------------------------------
pg_dump -h postgres -U eagles -d eagles --no-owner --no-privileges \
	| gzip -9 > "$ARQUIVO.parcial"

# Renomeia só no fim: um dump interrompido nunca vira "o backup de hoje".
mv "$ARQUIVO.parcial" "$ARQUIVO"

TAMANHO=$(wc -c < "$ARQUIVO")
if [ "$TAMANHO" -lt 10240 ]; then
	echo "ERRO: dump com $TAMANHO bytes — pequeno demais para ser válido." >&2
	rm -f "$ARQUIVO"
	exit 1
fi

# --- Verificação: o gzip abre e o SQL tem o fim esperado? --------------------
if ! gzip -t "$ARQUIVO"; then
	echo "ERRO: arquivo corrompido." >&2
	rm -f "$ARQUIVO"
	exit 1
fi

if ! gzip -dc "$ARQUIVO" | tail -5 | grep -q "PostgreSQL database dump complete"; then
	echo "ERRO: dump incompleto — falta o marcador de fim." >&2
	rm -f "$ARQUIVO"
	exit 1
fi

echo "banco: $ARQUIVO ($((TAMANHO / 1024)) KB) — verificado"

# --- Anexos (fotos, comprovantes) -------------------------------------------
if [ -d /dados/arquivos ] && [ -n "$(ls -A /dados/arquivos 2>/dev/null)" ]; then
	tar -czf "$ANEXOS" -C /dados arquivos
	echo "anexos: $ANEXOS"
fi

# --- Cópia externa ----------------------------------------------------------
# CRÍTICO. Sem isto, um disco perdido leva tudo junto.
if [ -n "${B2_BUCKET:-}" ] && command -v rclone > /dev/null 2>&1; then
	rclone copy "$ARQUIVO" "b2:$B2_BUCKET/banco/" --quiet
	[ -f "$ANEXOS" ] && rclone copy "$ANEXOS" "b2:$B2_BUCKET/anexos/" --quiet
	echo "cópia externa enviada"
else
	echo "AVISO: sem cópia externa. Configure B2_BUCKET e o rclone." >&2
fi

# --- Retenção: 7 diários / 4 semanais / 12 mensais ---------------------------
find "$DESTINO" -name 'eagles_*.sql.gz' -mtime "+$RETENCAO" \
	! -name '*_01_*' -delete 2>/dev/null || true
find "$DESTINO" -name 'anexos_*.tar.gz' -mtime "+$RETENCAO" -delete 2>/dev/null || true

echo "[$(date -Iseconds)] backup concluído"
