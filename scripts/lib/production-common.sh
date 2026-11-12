# shellcheck shell=bash
# Fonctions communes à scripts/deploy-production.sh et scripts/rollback-production.sh.
# Fichier à sourcer, jamais à exécuter. Tout est surchargeable par l'environnement (tests, VM).

PROJECT_DIR="${PROJECT_DIR:-/opt/planner-pro}"
COMPOSE_FILE_NAME="${COMPOSE_FILE_NAME:-docker-compose.prod.yml}"
ENV_FILE_NAME="${ENV_FILE_NAME:-.env.production}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-planner-pro-production}"
IMAGE_BACKEND="${IMAGE_BACKEND:-${COMPOSE_PROJECT}-backend}"
IMAGE_FRONTEND="${IMAGE_FRONTEND:-${COMPOSE_PROJECT}-frontend}"
STATE_DIR="${STATE_DIR:-${HOME:-/tmp}/.local/state/planner-pro}"
LOG_DIR="${LOG_DIR:-$STATE_DIR/logs}"
LOCK_FILE="${LOCK_FILE:-$STATE_DIR/deploy.lock}"
POINTS_DIR="${POINTS_DIR:-$STATE_DIR/rollback-points}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/planner-pro}"
BACKUP_UNIT="${BACKUP_UNIT:-planner-pro-backup.service}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"
FIND_BIN="${FIND_BIN:-/usr/bin/find}"
WEB_URL="${WEB_URL:-https://planner-pro.boukarou-os.com}"
API_URL="${API_URL:-https://api.planner-pro.boukarou-os.com}"
RETRIES="${RETRIES:-24}"
RETRY_DELAY="${RETRY_DELAY:-5}"
KEEP_ROLLBACKS="${KEEP_ROLLBACKS:-5}"
DRY_RUN="${DRY_RUN:-0}"
# Proxy public d'un autre projet (ekose) : seule action autorisée dessus, un redémarrage si 502
PROXY_CONTAINER="${PROXY_CONTAINER:-ekose-nginx-1}"
PROXY_RESTARTED=0
HTTP_SAW_502=0

log() {
  local level=$1
  shift
  printf '%s %-5s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$*"
}

# Journal horodaté : tout ce qui est affiché est aussi écrit dans $LOG_FILE. La déconnexion du
# client SSH (HUP, tube cassé) ne doit pas interrompre une opération en cours.
init_logging() {
  local name=$1
  trap '' HUP PIPE
  mkdir -p "$LOG_DIR" "$POINTS_DIR"
  chmod 700 "$STATE_DIR" 2>/dev/null || true
  LOG_FILE="$LOG_DIR/$name-$(date -u +%Y%m%dT%H%M%SZ)-$$.log"
  exec > >(tee --output-error=warn-nopipe -a "$LOG_FILE") 2>&1
  TEE_PID=$!
  # Conserve les 30 derniers journaux de chaque type
  find "$LOG_DIR" -maxdepth 1 -type f -name "$name-*.log" -printf '%f\n' 2>/dev/null |
    sort -r | tail -n +31 | while read -r old; do rm -f "$LOG_DIR/$old"; done
}

finish_logging() {
  exec 1>&- 2>&-
  wait "${TEE_PID:-}" 2>/dev/null || true
}

# Exécute une commande qui modifie l'état ; en mode --dry-run, l'affiche seulement.
run() {
  if ((DRY_RUN)); then
    log DRY "[dry-run] $*"
    return 0
  fi
  log CMD "$*"
  "$@"
}

dc() {
  docker compose --env-file "$PROJECT_DIR/$ENV_FILE_NAME" -f "$PROJECT_DIR/$COMPOSE_FILE_NAME" "$@"
}

acquire_lock() {
  mkdir -p "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log ERROR "Un déploiement ou un retour arrière est déjà en cours (verrou $LOCK_FILE)."
    return 1
  fi
}

# Arbre Git propre ? Le code de retour de git est contrôlé : une erreur n'est jamais prise pour « propre ».
require_clean_tree() {
  local st
  if ! st=$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null); then
    log ERROR "git status a échoué dans $PROJECT_DIR : état du dépôt inconnu."
    return 1
  fi
  if [[ -n "$st" ]]; then
    log ERROR "Arbre de travail non propre dans $PROJECT_DIR."
    return 1
  fi
}

# retry <commande...> : au plus $RETRIES essais, $RETRY_DELAY secondes d'écart.
retry() {
  local i
  for ((i = 1; i <= RETRIES; i++)); do
    if "$@"; then
      return 0
    fi
    if ((i < RETRIES)); then
      log INFO "essai $i/$RETRIES de « $1 » non concluant, nouvel essai dans ${RETRY_DELAY}s"
      sleep "$RETRY_DELAY"
    fi
  done
  log ERROR "« $1 » toujours en échec après $RETRIES essais"
  return 1
}

# --- Vérifications d'état (retournent 0/1, ne quittent jamais) -----------------------------------

check_containers() {
  local svc cid state status health restarts ok=0
  for svc in db cache backend frontend; do
    cid=$(dc ps -q "$svc" 2>/dev/null | head -n 1) || cid=""
    if [[ -z "$cid" ]]; then
      log WARN "service $svc : aucun conteneur"
      ok=1
      continue
    fi
    state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$cid" 2>/dev/null) || state=""
    read -r status health restarts <<<"$state"
    if [[ "$status" != "running" ]] || [[ "$health" != "healthy" && "$health" != "none" ]]; then
      log WARN "service $svc : état $status / santé ${health:-?}"
      ok=1
    elif [[ "$svc" == "backend" || "$svc" == "frontend" ]] && [[ "${restarts:-0}" != "0" ]]; then
      if ((DRY_RUN)); then
        # Contrôle à blanc : un ancien redémarrage est sans conséquence (le déploiement recrée les conteneurs)
        log WARN "service $svc : $restarts redémarrage(s) passé(s) (avertissement seulement en dry-run)"
      else
        log WARN "service $svc : $restarts redémarrage(s) depuis la création (boucle de crash ?)"
        ok=1
      fi
    fi
  done
  return "$ok"
}

check_migrations() {
  local logs
  logs=$(dc logs --no-color --no-log-prefix backend 2>&1) || return 1
  if grep -qE 'P3009|P3018|P3006|migrate found failed migrations|Error: P[0-9]{4}' <<<"$logs"; then
    log WARN "erreur de migration dans les journaux du backend"
    return 1
  fi
  if grep -qE 'All migrations have been successfully applied|No pending migrations' <<<"$logs"; then
    return 0
  fi
  log WARN "journaux du backend : aucune confirmation de migration pour l'instant"
  return 1
}

check_node() {
  local out
  out=$(dc exec -T backend node -v 2>/dev/null) || return 1
  if [[ "$out" =~ ^v[0-9]+\.[0-9]+ ]]; then
    log INFO "backend : Node $out"
    return 0
  fi
  log WARN "node -v inattendu dans le backend : $out"
  return 1
}

http_code() {
  local method=$1 url=$2
  curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X "$method" \
    -H 'Content-Type: application/json' --data '{}' "$url" 2>/dev/null || true
}

check_http() {
  local ok=0 code
  HTTP_SAW_502=0
  code=$(http_code GET "$API_URL/features")
  [[ "$code" != "502" ]] || HTTP_SAW_502=1
  [[ "$code" == "200" ]] || {
    log WARN "GET $API_URL/features : $code (200 attendu)"
    ok=1
  }
  code=$(http_code POST "$API_URL/projects")
  [[ "$code" != "502" ]] || HTTP_SAW_502=1
  [[ "$code" == "401" ]] || {
    log WARN "POST $API_URL/projects sans jeton : $code (401 attendu)"
    ok=1
  }
  code=$(http_code GET "$WEB_URL/")
  [[ "$code" != "502" ]] || HTTP_SAW_502=1
  [[ "$code" == "200" ]] || {
    log WARN "GET $WEB_URL/ : $code (200 attendu)"
    ok=1
  }
  return "$ok"
}

# Après recréation des conteneurs, ekose-nginx-1 garde les anciennes IP (résolues au démarrage) et
# répond 502 ; un reload ne suffit pas. Redémarrage unique (par phase), puis contrôle des ports publiés.
check_proxy_ports() {
  local ports
  ports=$(docker port "$PROXY_CONTAINER" 2>/dev/null) || return 1
  grep -qE '^80/tcp ->' <<<"$ports" && grep -qE '^443/tcp ->' <<<"$ports"
}

restart_proxy() {
  PROXY_RESTARTED=1
  log WARN "502 sur les domaines publics : redémarrage unique de $PROXY_CONTAINER (IP des conteneurs en cache)."
  run docker restart "$PROXY_CONTAINER" || {
    log ERROR "Redémarrage de $PROXY_CONTAINER impossible."
    return 1
  }
  ((DRY_RUN)) && return 0
  retry check_proxy_ports || {
    log ERROR "ALERTE : $PROXY_CONTAINER ne publie pas les ports 80/443 après redémarrage."
    return 1
  }
}

# Contrôles publics avec réessais ; au premier 502 persistant, un seul redémarrage du proxy.
verify_public() {
  if check_http; then
    return 0
  fi
  if ((HTTP_SAW_502 && !PROXY_RESTARTED)); then
    restart_proxy || return 1
  fi
  retry check_http
}

verify_all() {
  retry check_containers || return 1
  retry check_migrations || return 1
  retry check_node || return 1
  verify_public || return 1
  local cid timeout
  cid=$(dc ps -q backend 2>/dev/null | head -n 1) || cid=""
  timeout=$(docker inspect -f '{{.Config.StopTimeout}}' "$cid" 2>/dev/null) || timeout="?"
  if [[ "$timeout" != "15" ]]; then
    log WARN "StopTimeout du backend : $timeout (15 attendu, stop_grace_period non appliqué ?)"
  fi
  return 0
}

# --- Points de retour ----------------------------------------------------------------------------

point_sha_file() { printf '%s/%s' "$POINTS_DIR" "$1"; }

# restore_from_tag <étiquette> [sha] : remet les images étiquetées en service (la base n'est pas touchée).
restore_from_tag() {
  local tag=$1 sha=${2:-} repo
  for repo in "$IMAGE_BACKEND" "$IMAGE_FRONTEND"; do
    if ! docker image inspect "$repo:$tag" >/dev/null 2>&1; then
      log ERROR "image absente : $repo:$tag"
      return 1
    fi
  done
  if [[ -n "$sha" ]]; then
    # Le SHA vient d'un fichier d'état : il doit exister et appartenir à l'historique connu
    if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]] || ! git -C "$PROJECT_DIR" cat-file -e "$sha^{commit}" 2>/dev/null ||
      ! { git -C "$PROJECT_DIR" merge-base --is-ancestor "$sha" HEAD 2>/dev/null ||
        git -C "$PROJECT_DIR" merge-base --is-ancestor "$sha" origin/main 2>/dev/null; }; then
      log ERROR "SHA de retour invalide ou hors de l'historique ($sha) : retour refusé."
      return 1
    fi
  fi
  for repo in "$IMAGE_BACKEND" "$IMAGE_FRONTEND"; do
    run docker tag "$repo:$tag" "$repo:latest" || return 1
  done
  if [[ -n "$sha" ]]; then
    run git -C "$PROJECT_DIR" reset --hard "$sha" || return 1
  fi
  run dc up -d --force-recreate --no-deps --no-build backend frontend
}

prune_rollbacks() {
  local repo tag
  for repo in "$IMAGE_BACKEND" "$IMAGE_FRONTEND"; do
    docker image ls --format '{{.Tag}}' "$repo" 2>/dev/null |
      { grep -E '^rollback-[0-9]{8}T[0-9]{6}Z$' || true; } | sort -r | tail -n +$((KEEP_ROLLBACKS + 1)) |
      while read -r tag; do
        run docker rmi "$repo:$tag" || log WARN "suppression de $repo:$tag impossible"
        if [[ "$repo" == "$IMAGE_BACKEND" && "$DRY_RUN" == "0" ]]; then rm -f "$(point_sha_file "$tag")"; fi
      done
  done
}
