#!/bin/sh
set -e

# O compose só sobe a API quando o healthcheck do Postgres passa
# (depends_on: service_healthy). As tentativas abaixo cobrem o intervalo em
# que o banco já responde ao healthcheck mas ainda recusa conexões.
echo "Executando migrações..."
tentativa=1
until node --experimental-strip-types db/migrate.ts; do
  if [ "$tentativa" -ge 5 ]; then
    # Sem migração, a API não sobe: rodar código novo contra schema antigo
    # corromperia dados. O restart do compose tenta de novo.
    echo "Migrações falharam após $tentativa tentativas. Abortando."
    exit 1
  fi
  tentativa=$((tentativa + 1))
  echo "Nova tentativa em 3s ($tentativa/5)..."
  sleep 3
done

echo "Iniciando API..."
exec "$@"
