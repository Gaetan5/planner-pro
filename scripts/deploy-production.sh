#!/usr/bin/env bash
# Déploiement de production, à exécuter SUR la VM (jamais depuis un poste ni depuis le CI).
#
#   scripts/deploy-production.sh [--dry-run] <sha-complet-de-40-caractères>
#
# Codes de sortie : 0 déployé et vérifié ; 1 refus ou échec avant tout changement (ou changement
# annulé sans toucher aux conteneurs) ; 2 vérification échouée, retour automatique réussi ;
# 3 vérification échouée ET retour automatique en échec (intervention manuelle) ; 4 verrou pris ;
# 64 usage.
#
# Ce script ne peut pas annuler une migration Prisma déjà appliquée : voir docs/deployment-production.md.
# shellcheck disable=SC2329  # fonctions appelées par trap EXIT
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib/production-common.sh
source "$SCRIPT_DIR/lib/production-common.sh"

MIN_FREE_KB="${MIN_FREE_KB:-5242880}"
BACKUP_MAX_AGE_MIN=10

SHA=""
PREV_SHA=""
STATE="init" # init -> merged -> deploying -> done
START_EPOCH=$(date +%s)
BACKUP_FILE=""
ROLLBACK_TAG=""
ROLLBACK_SHA=""
ROLLBACK_RESULT="non tenté"
FAILURE_REASON=""
DEPLOY_LOGS=""

usage() {
  printf 'Usage : %s [--dry-run] <sha-complet-de-40-caractères>\n' "$0" >&2
  exit 64
}

fail() {
  FAILURE_REASON="$*"
  log ERROR "$*"
  return 1
}

# --- Étape 1 : prérequis -------------------------------------------------------------------------

step_prereqs() {
  log STEP "1/8 Prérequis"
  docker info >/dev/null 2>&1 || fail "Docker n'est pas actif." || return 1
  [[ -r "$PROJECT_DIR/$ENV_FILE_NAME" ]] || fail "$PROJECT_DIR/$ENV_FILE_NAME absent ou illisible." || return 1
  [[ -r "$PROJECT_DIR/$COMPOSE_FILE_NAME" ]] || fail "$COMPOSE_FILE_NAME absent." || return 1

  local root free
  root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null) || root=/
  [[ -d "$root" ]] || root=/
  free=$(df -Pk "$root" | awk 'NR==2 {print $4}')
  if [[ ! "$free" =~ ^[0-9]+$ ]] || ((free < MIN_FREE_KB)); then
    fail "Espace disque insuffisant sur $root : ${free:-?} Ko libres, $MIN_FREE_KB Ko requis." || return 1
  fi
  log INFO "espace libre sur $root : $((free / 1024)) Mo"

  # Incident du 2026-11-11 : un Nginx d'hôte avait pris les ports 80/443 à la place du conteneur
  # de proxy. Les ports doivent être publiés par Docker (docker-proxy) et Nginx ne doit pas tourner.
  if systemctl is-active --quiet nginx 2>/dev/null; then
    fail "ALERTE : le service nginx de l'hôte est actif ; il ne doit pas tenir les ports 80/443 (incident du 2026-11-11). Déploiement refusé." || return 1
  fi
  local port holder
  for port in 80 443; do
    holder=$(docker ps --filter "publish=$port" --format '{{.Names}}' 2>/dev/null | head -n 1) || holder=""
    if [[ -z "$holder" ]]; then
      fail "ALERTE : aucun conteneur Docker ne publie le port $port (docker-proxy absent). Déploiement refusé." || return 1
    fi
    if ! ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; then
      fail "ALERTE : le port $port n'est pas en écoute sur l'hôte. Déploiement refusé." || return 1
    fi
    log INFO "port $port publié par le conteneur $holder"
  done
}

# --- Vérification du SHA (lecture seule, avant toute modification) ------------------------------

step_validate_sha() {
  log STEP "2/8 Vérification du SHA $SHA"
  cd "$PROJECT_DIR"
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$PROJECT_DIR n'est pas un dépôt Git." || return 1
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD)
  [[ "$branch" == "main" ]] || fail "Le dépôt est sur « $branch » (main attendu)." || return 1
  require_clean_tree || fail "Arbre de travail non propre ou illisible : déploiement refusé." || return 1
  PREV_SHA=$(git rev-parse HEAD)
  # Lecture seule côté VM : seul le suivi distant est mis à jour
  git fetch --quiet origin main || fail "git fetch a échoué." || return 1
  git cat-file -e "$SHA^{commit}" 2>/dev/null || fail "Commit $SHA inconnu après fetch." || return 1
  git merge-base --is-ancestor "$SHA" origin/main || fail "$SHA n'est pas un ancêtre de origin/main (ni égal)." || return 1
  git merge-base --is-ancestor "$PREV_SHA" "$SHA" ||
    fail "$SHA ne prolonge pas le commit déployé $PREV_SHA (retour en arrière : utiliser rollback-production.sh)." || return 1
  if [[ "${REQUIRE_SIGNED_COMMITS:-0}" == "1" ]]; then
    # Option : clé de confiance hors dépôt (gpg.ssh.allowedSignersFile ou trousseau GPG de l'utilisateur)
    git verify-commit "$SHA" >/dev/null 2>&1 || fail "Le commit $SHA n'a pas de signature de confiance (REQUIRE_SIGNED_COMMITS=1)." || return 1
  fi
  if ! git diff --quiet "$PREV_SHA" "$SHA" -- scripts/ ops/; then
    log WARN "Les scripts de déploiement ou ops/ changent dans ce déploiement : cette exécution utilise encore l'ancienne version des scripts."
  fi
  log INFO "déployé : $PREV_SHA ; cible : $SHA"
}

# --- Étape 2 : sauvegarde ------------------------------------------------------------------------

step_backup() {
  log STEP "3/8 Sauvegarde de la base"
  if ((DRY_RUN)); then
    # Lecture seule : droits sudo et find réels, sans lancer la sauvegarde
    sudo -n -l "$SYSTEMCTL_BIN" start "$BACKUP_UNIT" >/dev/null 2>&1 ||
      fail "sudo refuse « $SYSTEMCTL_BIN start $BACKUP_UNIT » (règle sudoers absente ou inexacte)." || return 1
    recent_backups >/dev/null 2>&1 || fail "sudo refuse le find sur $BACKUP_DIR (règle sudoers absente ou inexacte)." || return 1
    log DRY "[dry-run] droits sudo vérifiés ; la sauvegarde ne serait lancée qu'en déploiement réel"
    return 0
  fi
  log CMD "sudo -n $SYSTEMCTL_BIN start $BACKUP_UNIT"
  sudo -n "$SYSTEMCTL_BIN" start "$BACKUP_UNIT" || fail "La sauvegarde a échoué : déploiement arrêté, rien n'a été modifié." || return 1
  local found
  found=$(recent_backups 2>/dev/null) || fail "Lecture de $BACKUP_DIR refusée (sudo find) : déploiement arrêté." || return 1
  found=$(grep -E '\.sql\.gz\.gpg$' <<<"$found" | sort | tail -n 1) || found=""
  [[ -n "$found" ]] || fail "Aucun fichier *.sql.gz.gpg de moins de $BACKUP_MAX_AGE_MIN min dans $BACKUP_DIR : déploiement arrêté." || return 1
  BACKUP_FILE="$found"
  log INFO "sauvegarde : $BACKUP_FILE"
}

# Arguments exacts de la règle sudoers documentée (aucun joker)
recent_backups() {
  sudo -n "$FIND_BIN" "$BACKUP_DIR" -maxdepth 1 -type f -mmin "-$BACKUP_MAX_AGE_MIN"
}

# --- Étape 3 : points de retour ------------------------------------------------------------------

step_rollback_points() {
  log STEP "4/8 Points de retour (images en cours)"
  # Toujours un point horodaté des images EN COURS, y compris à SHA identique (redéploiement) :
  # un retour automatique doit revenir à ce qui tournait. rollback-latest ne bouge que si le commit change.
  local ts svc repo cid img
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  for svc in backend frontend; do
    repo="$COMPOSE_PROJECT-$svc"
    cid=$(dc ps -q "$svc" 2>/dev/null | head -n 1) || cid=""
    if [[ -z "$cid" ]]; then
      log WARN "service $svc non démarré : pas de point de retour pour lui"
      ROLLBACK_TAG=""
      return 0
    fi
    img=$(docker inspect -f '{{.Image}}' "$cid") || fail "inspect de $cid impossible." || return 1
    run docker tag "$img" "$repo:rollback-$ts" || return 1
    if [[ "$PREV_SHA" != "$SHA" ]]; then
      run docker tag "$img" "$repo:rollback-latest" || return 1
    fi
  done
  ROLLBACK_TAG="rollback-$ts"
  ROLLBACK_SHA="$PREV_SHA"
  if ((!DRY_RUN)); then
    printf '%s\n' "$PREV_SHA" >"$(point_sha_file "$ROLLBACK_TAG")"
    if [[ "$PREV_SHA" != "$SHA" ]]; then
      printf '%s\n' "$PREV_SHA" >"$(point_sha_file rollback-latest)"
    fi
  fi
  prune_rollbacks
}

# --- Étape 4 : code ------------------------------------------------------------------------------

step_update_git() {
  log STEP "5/8 Mise à jour du code (fast-forward uniquement)"
  cd "$PROJECT_DIR"
  require_clean_tree || fail "Arbre de travail non propre ou illisible : déploiement refusé." || return 1
  run git merge --ff-only "$SHA" || fail "git merge --ff-only a échoué." || return 1
  ((DRY_RUN)) || STATE="merged"
}

# --- Étape 5 : build et démarrage ---------------------------------------------------------------

step_build_and_up() {
  log STEP "6/8 Build et démarrage"
  cd "$PROJECT_DIR"
  run dc build backend frontend || fail "Le build a échoué (les conteneurs en cours n'ont pas été touchés)." || return 1
  ((DRY_RUN)) || STATE="deploying"
  run dc up -d db cache || fail "Démarrage de db/cache en échec." || return 1
  # Recréation forcée : stop_grace_period et la nouvelle image doivent s'appliquer, db/cache restent en place
  run dc up -d --force-recreate --no-deps backend || fail "Recréation du backend en échec." || return 1
  run dc up -d || fail "docker compose up -d en échec." || return 1
}

# --- Étape 6 : vérifications ---------------------------------------------------------------------

step_verify() {
  log STEP "7/8 Vérifications"
  if ((DRY_RUN)); then
    # Lecture seule : état actuel des conteneurs, accès HTTP depuis la VM, ports du proxy (sans redémarrage)
    check_containers || fail "dry-run : conteneurs en cours non sains." || return 1
    check_http || fail "dry-run : les domaines publics ne répondent pas comme attendu depuis la VM." || return 1
    check_proxy_ports || fail "dry-run : $PROXY_CONTAINER ne publie pas 80/443." || return 1
    log DRY "[dry-run] état actuel conforme ; migrations et node -v ne sont vérifiés qu'en déploiement réel"
    return 0
  fi
  if ! verify_all; then
    DEPLOY_LOGS=$(dc logs --no-color --no-log-prefix backend 2>&1 || true)
    fail "Les vérifications post-déploiement ont échoué." || return 1
  fi
  STATE="done"
}

# --- Étape 7 : retour automatique ---------------------------------------------------------------

migration_was_applied() {
  grep -qE 'All migrations have been successfully applied|Applying migration' <<<"$DEPLOY_LOGS"
}

auto_rollback() {
  log STEP "Retour automatique vers les images $ROLLBACK_TAG"
  if [[ -z "$ROLLBACK_TAG" ]]; then
    ROLLBACK_RESULT="impossible (aucun point de retour)"
    return 1
  fi
  [[ -n "$DEPLOY_LOGS" ]] || DEPLOY_LOGS=$(dc logs --no-color --no-log-prefix backend 2>&1 || true)
  if [[ -n "$DEPLOY_LOGS" ]]; then
    # Hors de la sortie (donc du journal GitHub Actions) : fichier de journal de la VM seulement
    {
      printf '%s dernières lignes du backend en échec :\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      tail -n 40 <<<"$DEPLOY_LOGS"
    } >>"$LOG_FILE"
    log INFO "journal du backend en échec écrit dans $LOG_FILE (non affiché ici)."
  fi
  if ! restore_from_tag "$ROLLBACK_TAG" "$ROLLBACK_SHA"; then
    ROLLBACK_RESULT="ÉCHEC du retour des images"
    return 1
  fi
  PROXY_RESTARTED=0
  if retry check_containers && verify_public; then
    ROLLBACK_RESULT="réussi (images $ROLLBACK_TAG, commit ${ROLLBACK_SHA:-inchangé})"
    return 0
  fi
  ROLLBACK_RESULT="images remises mais vérifications en échec"
  return 1
}

summary() {
  local rc=$1 dur=$(($(date +%s) - START_EPOCH)) status
  case "$rc" in
    0) status="SUCCÈS" ;;
    2) status="ÉCHEC, retour automatique effectué" ;;
    3) status="ÉCHEC CRITIQUE, retour automatique en échec" ;;
    4) status="REFUSÉ, verrou pris" ;;
    *) status="ÉCHEC" ;;
  esac
  log INFO "================ Résumé du déploiement ================"
  log INFO "résultat        : $status (code $rc)"
  log INFO "cible           : ${SHA:-?}"
  log INFO "précédent       : ${PREV_SHA:-?}"
  log INFO "durée           : ${dur}s"
  log INFO "sauvegarde      : ${BACKUP_FILE:-aucune}"
  log INFO "point de retour : ${ROLLBACK_TAG:-aucun}"
  log INFO "retour auto     : $ROLLBACK_RESULT"
  log INFO "journal         : ${LOG_FILE:-?}"
  [[ -z "$FAILURE_REASON" ]] || log INFO "cause           : $FAILURE_REASON"
  if ((rc != 0)) && [[ "$STATE" == "deploying" ]]; then
    log WARN "ATTENTION : une migration Prisma déjà appliquée NE PEUT PAS être annulée automatiquement."
    if migration_was_applied; then
      log WARN "Des migrations ont été appliquées par ce déploiement : la base est au schéma du commit ${SHA:-?}."
    fi
    log WARN "Si le schéma n'est plus compatible avec les anciennes images, restaurer la sauvegarde : ${BACKUP_FILE:-voir $BACKUP_DIR}"
    log WARN "(procédure : docs/deployment-production.md, « Restaurer une sauvegarde »)."
  fi
}

on_exit() {
  local rc=$1
  set +e +E
  trap - EXIT
  if ((DRY_RUN == 0 && rc != 0)); then
    case "$STATE" in
      merged)
        log WARN "Retour du dépôt au commit précédent $PREV_SHA (conteneurs non touchés)."
        git -C "$PROJECT_DIR" reset --hard "$PREV_SHA" >/dev/null 2>&1 || log ERROR "git reset impossible."
        ;;
      deploying)
        if auto_rollback; then rc=2; else rc=3; fi
        ;;
    esac
  fi
  summary "$rc"
  finish_logging
  exit "$rc"
}

main() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --dry-run) DRY_RUN=1 ;;
      -*) usage ;;
      *) [[ -z "$SHA" ]] || usage; SHA=$arg ;;
    esac
  done
  [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || usage

  init_logging deploy
  trap 'on_exit $?' EXIT
  log INFO "Déploiement de production$( ((DRY_RUN)) && printf " (dry-run)") : $SHA"
  acquire_lock || exit 4
  step_prereqs
  step_validate_sha
  step_backup
  step_rollback_points
  step_update_git
  step_build_and_up
  step_verify
  log STEP "8/8 Terminé"
  if ((!DRY_RUN)); then
    run docker image prune -f >/dev/null || true
  fi
}

# Une seule ligne : bash doit avoir tout lu avant que git ne remplace ce fichier pendant le déploiement
main "$@"; exit 0
