#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PROJECT_DIR="${PROJECT_DIR:-/opt/planner-pro}"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$PROJECT_DIR/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/planner-pro}"
PASSPHRASE_FILE="${PASSPHRASE_FILE:-/etc/planner-pro/backup-passphrase}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

for command in docker gpg gzip flock find install mktemp date chmod mv rm stat; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$command" >&2
    exit 1
  fi
done

if [[ ! -r "$ENV_FILE" || ! -r "$COMPOSE_FILE" ]]; then
  printf 'Production Compose or environment file is not readable.\n' >&2
  exit 1
fi

if [[ ! -s "$PASSPHRASE_FILE" || ! -r "$PASSPHRASE_FILE" ]]; then
  printf 'Backup encryption passphrase file is missing or unreadable.\n' >&2
  exit 1
fi
if [[ "$(stat -c '%a' "$PASSPHRASE_FILE")" != "600" ]]; then
  printf 'Backup encryption passphrase file must have mode 600.\n' >&2
  exit 1
fi

if [[ ! "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  printf 'RETENTION_DAYS must be a positive integer.\n' >&2
  exit 1
fi

install -d -m 700 "$BACKUP_DIR"
GNUPGHOME="${GNUPGHOME:-$BACKUP_DIR/.gnupg}"
install -d -m 700 "$GNUPGHOME"
exec 9>"$BACKUP_DIR/.backup.lock"
if ! flock -n 9; then
  printf 'Another production backup is already running.\n' >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/planner-pro-$timestamp.sql.gz.gpg"
temporary_file="$(mktemp "$BACKUP_DIR/.planner-pro-$timestamp.XXXXXX.gpg")"

cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT

if [[ -e "$backup_file" ]]; then
  printf 'Backup already exists for timestamp %s; refusing to overwrite it.\n' "$timestamp" >&2
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  sh -ec 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump --user=root --single-transaction --routines --triggers --events --hex-blob --databases "$MYSQL_DATABASE"' |
  gzip -c |
  gpg --homedir "$GNUPGHOME" --batch --yes --pinentry-mode loopback \
    --passphrase-file "$PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --output "$temporary_file"

if [[ ! -s "$temporary_file" ]]; then
  printf 'Encrypted backup output is empty.\n' >&2
  exit 1
fi

gpg --homedir "$GNUPGHOME" --batch --quiet --pinentry-mode loopback \
  --passphrase-file "$PASSPHRASE_FILE" \
  --decrypt "$temporary_file" |
  gzip -t

chmod 600 "$temporary_file"
mv -- "$temporary_file" "$backup_file"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'planner-pro-*.sql.gz.gpg' \
  -mtime "+$RETENTION_DAYS" -delete

printf 'Encrypted MySQL backup verified: %s\n' "$backup_file"
