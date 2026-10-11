#!/bin/sh
# Backup do Eagles App.
#
# Duas regras que não se negociam:
#
#   1. Backup que mora só na máquina que pode morrer NÃO é backup.
#      A cópia externa é obrigatória.
#
#   2. Backup de dados pessoais NÃO sai da VPS em claro.
#      O dump leva nome, telefone, e-mail e data de nascimento de uma
#      comunidade inteira. Cifrado sempre, antes de tocar a rede.
#
# A cifragem é ASSIMÉTRICA (age). A VPS guarda apenas a chave PÚBLICA, então
# um invasor que tome a máquina consegue criar backups novos, mas não consegue
# ler nenhum dos antigos. A chave privada fica fora da VPS — ver infra/README.md.
#
# Restauração: infra/restore.sh. Backup nunca restaurado deve ser considerado
# inexistente; a restauração é testada uma vez por mês.

set -eu

# --- Parâmetros -------------------------------------------------------------
# Os padrões valem dentro do contêiner do docker-compose; todos podem ser
# sobrescritos por ambiente, que é o que permite testar este script fora dele.
PGHOST_=${PGHOST:-postgres}
PGUSER_=${PGUSER:-eagles}
PGDATABASE_=${PGDATABASE:-eagles}
DESTINO=${DESTINO:-/backups}
ORIGEM_ANEXOS=${ORIGEM_ANEXOS:-/dados/arquivos}
RETENCAO=${RETENCAO_DIARIA:-7}

DATA=$(date +%Y-%m-%d_%H%M)
BASE="$DESTINO/eagles_$DATA.sql.gz"
ANEXOS="$DESTINO/anexos_$DATA.tar.gz"
SAIDA=0

log() { echo "[$(date -Iseconds)] $*"; }
erro() { echo "[$(date -Iseconds)] ERRO: $*" >&2; }

log "iniciando backup"

# --- Falha fechada: sem chave pública, não há backup ------------------------
# Antes de gastar tempo com o dump. Um backup em claro não é uma alternativa
# aceitável a nenhum backup — é um vazamento esperando o disco certo.
if [ -z "${EAGLES_BACKUP_RECIPIENT:-}" ]; then
	erro "EAGLES_BACKUP_RECIPIENT não definida — a chave pública age que cifra o backup."
	erro "Sem ela o dump sairia em claro. Gere o par com 'age-keygen' e veja infra/README.md."
	exit 1
fi

if ! command -v age > /dev/null 2>&1; then
	erro "'age' não encontrado no contêiner. Ele é quem cifra o backup."
	exit 1
fi

mkdir -p "$DESTINO"

# --- Banco ------------------------------------------------------------------
pg_dump -h "$PGHOST_" -U "$PGUSER_" -d "$PGDATABASE_" --no-owner --no-privileges \
	| gzip -9 > "$BASE.parcial"

# Renomeia só no fim: um dump interrompido nunca vira "o backup de hoje".
mv "$BASE.parcial" "$BASE"

TAMANHO=$(wc -c < "$BASE")
if [ "$TAMANHO" -lt 1024 ]; then
	erro "dump com $TAMANHO bytes — vazio ou truncado logo no início."
	rm -f "$BASE"
	exit 1
fi

# --- Verificação do conteúdo, enquanto ainda dá para ler --------------------
# Depois de cifrar não temos como conferir nada: a chave privada não está aqui.
if ! gzip -t "$BASE"; then
	erro "arquivo corrompido."
	rm -f "$BASE"
	exit 1
fi

if ! gzip -dc "$BASE" | tail -5 | grep -q "PostgreSQL database dump complete"; then
	erro "dump incompleto — falta o marcador de fim."
	rm -f "$BASE"
	exit 1
fi

# Verificação semântica, e não de tamanho: um limiar em bytes reprovaria o
# backup de uma comunidade recém-cadastrada, que é justamente quando perder
# os dados dói mais. O que importa é o dump trazer o esquema esperado.
if ! gzip -dc "$BASE" | grep -q 'CREATE TABLE public.person'; then
	erro "dump não contém a tabela 'person' — não é um backup do Eagles."
	rm -f "$BASE"
	exit 1
fi

log "banco: $((TAMANHO / 1024)) KB, íntegro"

# --- Cifragem ---------------------------------------------------------------
cifrar() {
	origem=$1
	if ! age -r "$EAGLES_BACKUP_RECIPIENT" -o "$origem.age" "$origem"; then
		erro "falha ao cifrar $origem — a chave pública é válida?"
		rm -f "$origem" "$origem.age"
		exit 1
	fi
	# Conferência possível sem a chave privada: o arquivo existe, não está
	# vazio e traz o cabeçalho do formato.
	if [ ! -s "$origem.age" ] || ! head -c 21 "$origem.age" | grep -q "age-encryption.org"; then
		erro "$origem.age não parece um arquivo age válido."
		rm -f "$origem" "$origem.age"
		exit 1
	fi
	# O texto em claro morre aqui. Nunca é copiado para fora.
	rm -f "$origem"
}

cifrar "$BASE"
log "banco cifrado: $BASE.age"

# --- Anexos (fotos, comprovantes) -------------------------------------------
if [ -d "$ORIGEM_ANEXOS" ] && [ -n "$(ls -A "$ORIGEM_ANEXOS" 2>/dev/null)" ]; then
	tar -czf "$ANEXOS" -C "$(dirname "$ORIGEM_ANEXOS")" "$(basename "$ORIGEM_ANEXOS")"
	cifrar "$ANEXOS"
	log "anexos cifrados: $ANEXOS.age"
fi

# --- Cópia externa ----------------------------------------------------------
# Só arquivos .age chegam aqui — não existe caminho que envie texto em claro.
if [ -n "${B2_BUCKET:-}" ] && command -v rclone > /dev/null 2>&1; then
	# Cada envio num `if`: sob `set -e`, uma falha solta aqui encerrava o
	# script antes da retenção e da varredura de texto em claro (varredura).
	if rclone copy "$BASE.age" "b2:$B2_BUCKET/banco/" --quiet; then
		log "cópia externa do banco enviada"
	else
		erro "cópia externa do banco FALHOU. O backup de hoje existe só nesta máquina."
		SAIDA=1
	fi
	if [ -f "$ANEXOS.age" ]; then
		if rclone copy "$ANEXOS.age" "b2:$B2_BUCKET/anexos/" --quiet; then
			log "cópia externa dos anexos enviada"
		else
			erro "cópia externa dos anexos FALHOU."
			SAIDA=1
		fi
	fi
else
	erro "sem cópia externa: configure B2_BUCKET e o rclone."
	erro "O backup de hoje existe só nesta máquina — um disco perdido leva tudo."
	SAIDA=1
fi

# --- Retenção: 7 diários, e o do dia 01 de cada mês por um ano --------------
# O nome é eagles_AAAA-MM-DD_HHMM: o dia 01 é "-01_". O padrão antigo,
# '*_01_*', nunca casava — e os mensais iam embora junto com os diários.
find "$DESTINO" -name 'eagles_*.sql.gz.age' -mtime "+$RETENCAO" \
	! -name 'eagles_????-??-01_*' -delete 2>/dev/null || true
find "$DESTINO" -name 'eagles_????-??-01_*.sql.gz.age' -mtime +400 -delete 2>/dev/null || true
find "$DESTINO" -name 'anexos_*.tar.gz.age' -mtime "+$RETENCAO" -delete 2>/dev/null || true

# Varredura de segurança: se algum texto em claro sobrou de uma execução
# interrompida, ele não pode ficar no volume.
find "$DESTINO" \( -name '*.sql.gz' -o -name '*.tar.gz' -o -name '*.parcial' \) -delete 2>/dev/null || true

log "backup concluído"
exit "$SAIDA"
