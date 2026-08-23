#!/bin/sh
# Restauração do backup do Eagles App.
#
# Backup nunca restaurado deve ser considerado inexistente. Este script existe
# para que a restauração seja testada de rotina, e não descoberta no pior dia.
#
# A chave privada NÃO vive na VPS. Ela fica com a liderança, fora da máquina —
# é o que garante que quem invadir o servidor não leia os backups antigos.
# Por isso este script normalmente roda no computador de quem tem a chave.
#
# Uso:
#   ./restore.sh --arquivo eagles_2026-08-23_0300.sql.gz.age --chave ~/eagles-backup.key
#
#   --ensaio   restaura num banco temporário, confere e o descarta.
#              É o teste mensal: prova que o backup abre, sem tocar produção.
#
#   --forcar   exigido para restaurar por cima de um banco que já tem dados.

set -eu

ARQUIVO=''
CHAVE=''
BANCO=${PGDATABASE:-eagles}
HOSTE=${PGHOST:-localhost}
PORTA=${PGPORT:-5432}
USUARIO=${PGUSER:-eagles}
ENSAIO=0
FORCAR=0

erro() { echo "ERRO: $*" >&2; }
uso() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

while [ $# -gt 0 ]; do
	case "$1" in
		--arquivo) ARQUIVO=${2:?--arquivo exige um caminho}; shift 2 ;;
		--chave)   CHAVE=${2:?--chave exige um caminho}; shift 2 ;;
		--banco)   BANCO=${2:?--banco exige um nome}; shift 2 ;;
		--host)    HOSTE=${2:?--host exige um endereço}; shift 2 ;;
		--porta)   PORTA=${2:?--porta exige um número}; shift 2 ;;
		--usuario) USUARIO=${2:?--usuario exige um nome}; shift 2 ;;
		--ensaio)  ENSAIO=1; shift ;;
		--forcar)  FORCAR=1; shift ;;
		-h|--help) uso ;;
		*) erro "opção desconhecida: $1"; uso ;;
	esac
done

[ -n "$ARQUIVO" ] || { erro "falta --arquivo"; uso; }
[ -n "$CHAVE" ] || { erro "falta --chave (a identidade age que decifra)"; uso; }
[ -f "$ARQUIVO" ] || { erro "arquivo não encontrado: $ARQUIVO"; exit 1; }
[ -f "$CHAVE" ] || { erro "chave não encontrada: $CHAVE"; exit 1; }

command -v age > /dev/null 2>&1 || { erro "'age' não está instalado."; exit 1; }
command -v psql > /dev/null 2>&1 || { erro "'psql' não está instalado."; exit 1; }

# A chave privada não pode estar legível para o resto da máquina.
PERM=$(stat -c '%a' "$CHAVE" 2>/dev/null || stat -f '%Lp' "$CHAVE" 2>/dev/null || echo '')
case "$PERM" in
	600|400) ;;
	'') echo "AVISO: não consegui conferir a permissão de $CHAVE." >&2 ;;
	*) erro "$CHAVE está com permissão $PERM. Use 'chmod 600' — é uma chave privada."; exit 1 ;;
esac

psql_() { psql -h "$HOSTE" -p "$PORTA" -U "$USUARIO" "$@"; }

if [ "$ENSAIO" -eq 1 ]; then
	ALVO="ensaio_restauracao_$(date +%Y%m%d_%H%M%S)"
	echo "Ensaio: restaurando em '$ALVO', sem tocar em '$BANCO'."
else
	ALVO=$BANCO
fi

# --- Decifra e confere antes de escrever qualquer coisa ---------------------
TEMP=$(mktemp -d)
# shellcheck disable=SC2064
trap "rm -rf '$TEMP'" EXIT INT TERM
DUMP="$TEMP/dump.sql"

echo "Decifrando…"
if ! age -d -i "$CHAVE" "$ARQUIVO" | gzip -dc > "$DUMP"; then
	erro "não foi possível decifrar. A chave corresponde a este arquivo?"
	exit 1
fi

if ! tail -5 "$DUMP" | grep -q "PostgreSQL database dump complete"; then
	erro "o dump decifrado está incompleto — falta o marcador de fim."
	exit 1
fi
echo "Dump íntegro: $(wc -l < "$DUMP") linhas."

# --- Proteção contra restaurar por cima de dados vivos ----------------------
if [ "$ENSAIO" -eq 0 ]; then
	EXISTE=$(psql_ -d postgres -tAc \
		"SELECT 1 FROM pg_database WHERE datname='$ALVO'" 2>/dev/null || echo '')
	if [ -n "$EXISTE" ]; then
		PESSOAS=$(psql_ -d "$ALVO" -tAc \
			"SELECT count(*) FROM person" 2>/dev/null || echo 0)
		if [ "${PESSOAS:-0}" -gt 0 ] && [ "$FORCAR" -eq 0 ]; then
			erro "'$ALVO' já tem $PESSOAS pessoas cadastradas."
			erro "Restaurar por cima apaga tudo. Se é isso mesmo, repita com --forcar."
			exit 1
		fi
	fi
	psql_ -d postgres -c "DROP DATABASE IF EXISTS \"$ALVO\"" > /dev/null
fi

psql_ -d postgres -c "CREATE DATABASE \"$ALVO\"" > /dev/null
echo "Restaurando em '$ALVO'…"

if ! psql_ -d "$ALVO" -v ON_ERROR_STOP=1 -q -f "$DUMP" > /dev/null; then
	erro "a restauração falhou. O banco '$ALVO' ficou incompleto."
	exit 1
fi

# --- Conferência: o banco restaurado responde? ------------------------------
TABELAS=$(psql_ -d "$ALVO" -tAc \
	"SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
PESSOAS=$(psql_ -d "$ALVO" -tAc "SELECT count(*) FROM person")
PERMS=$(psql_ -d "$ALVO" -tAc "SELECT count(*) FROM permission")

echo "Restaurado: $TABELAS tabelas, $PESSOAS pessoas, $PERMS permissões."

if [ "$TABELAS" -lt 12 ]; then
	erro "esperava ao menos 12 tabelas e encontrei $TABELAS. Backup suspeito."
	exit 1
fi

# A view derivada precisa ter voltado junto — é ela que decide o regime de
# tratamento de dados de menor (ADR 0003).
if ! psql_ -d "$ALVO" -tAc "SELECT 1 FROM person_view LIMIT 1" > /dev/null 2>&1; then
	erro "a view person_view não voltou. Backup incompleto."
	exit 1
fi

if [ "$ENSAIO" -eq 1 ]; then
	psql_ -d postgres -c "DROP DATABASE \"$ALVO\"" > /dev/null
	echo "Ensaio concluído: o backup abre e está completo. Banco temporário descartado."
else
	echo "Restauração concluída em '$ALVO'."
fi
