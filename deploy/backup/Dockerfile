# Backup do banco: mesmo Postgres do serviço `db` (pg_dump compatível), mais
# gpg para criptografar e rclone para mandar para fora da VPS.
FROM postgres:16-alpine

RUN apk add --no-cache gnupg rclone tzdata

COPY deploy/backup/backup.sh /usr/local/bin/backup.sh
COPY deploy/backup/restaurar.sh /usr/local/bin/restaurar.sh
COPY deploy/backup/agendador.sh /usr/local/bin/agendador.sh
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restaurar.sh /usr/local/bin/agendador.sh

# Saudável = houve backup completo (restaurado, criptografado e fora da VPS)
# nas últimas 26 h. Depois do primeiro dia, qualquer falha deixa o serviço
# vermelho no Easypanel.
HEALTHCHECK --interval=30m --timeout=10s --start-period=30m \
	CMD find /backups/ultimo-sucesso.txt -mmin -1560 | grep -q . || exit 1

ENTRYPOINT ["/usr/local/bin/agendador.sh"]
