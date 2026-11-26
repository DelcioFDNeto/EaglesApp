#!/bin/sh
# Agenda o backup: uma vez alguns minutos depois de subir (o primeiro deploy
# já sai protegido) e depois todo dia às BACKUP_HORA (padrão 03:00, no fuso TZ).
#
# Laço simples em vez de cron: um processo a menos para depurar quando o
# backup não roda e ninguém percebe — e o healthcheck acusa se isso acontecer.

set -u

HORA=${BACKUP_HORA:-3}
ESPERA_INICIAL=${BACKUP_ESPERA_INICIAL:-300}

segundos_ate_a_hora() {
	agora=$(( $(date +%H | sed 's/^0//') * 3600 + $(date +%M | sed 's/^0//') * 60 + $(date +%S | sed 's/^0//') ))
	alvo=$(( HORA * 3600 ))
	falta=$(( (alvo - agora + 86400) % 86400 ))
	[ "$falta" -eq 0 ] && falta=86400
	echo "$falta"
}

echo "agendador de backup: primeira execução em ${ESPERA_INICIAL}s, depois todo dia às ${HORA}h ($(date +%Z))"
sleep "$ESPERA_INICIAL"

while true; do
	/usr/local/bin/backup.sh || echo "backup falhou; nova tentativa no próximo horário (veja ultimo-erro.txt)"
	sleep "$(segundos_ate_a_hora)"
done
