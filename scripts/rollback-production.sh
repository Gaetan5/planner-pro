#!/usr/bin/env bash
# Retour manuel aux images d'un point de retour, SUR la VM. La base de données n'est jamais touchée.
#
#   scripts/rollback-production.sh [--dry-run] [--keep-code] <rollback-latest | rollback-AAAAMMJJTHHMMSSZ>
#   scripts/rollback-production.sh --list
#
# Remet les images <projet>-backend/frontend:<étiquette> en service et, sauf --keep-code, ramène le
# dépôt au commit enregistré pour ce point de retour. Codes : 0 ok ; 1 refus/échec ; 3 vérification
# échouée après retour ; 4 verrou pris ; 64 usage.
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib/production-common.sh
source "$SCRIPT_DIR/lib/production-common.sh"

TAG=""
KEEP_CODE=0
LIST=0

usage() {
  printf 'Usage : %s [--dry-run] [--keep-code] <rollback-latest|rollback-AAAAMMJJTHHMMSSZ> | --list\n' "$0" >&2
  exit 64
}

list_points() {
  local repo=$IMAGE_BACKEND tag sha
  while read -r tag; do
    sha="?"
    [[ -f "$(point_sha_file "$tag")" ]] && sha=$(<"$(point_sha_file "$tag")")
    printf '%s  commit %s\n' "$tag" "$sha"
  done < <(docker image ls --format '{{.Tag}}' "$repo" | grep -E '^rollback-' | sort -r)
}

main() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --dry-run) DRY_RUN=1 ;;
      --keep-code) KEEP_CODE=1 ;;
      --list) LIST=1 ;;
      -*) usage ;;
      *) [[ -z "$TAG" ]] || usage; TAG=$arg ;;
    esac
  done
  if ((LIST)); then
    list_points
    return 0
  fi
  [[ "$TAG" =~ ^rollback-(latest|[0-9]{8}T[0-9]{6}Z)$ ]] || usage

  init_logging rollback
  log INFO "Retour manuel vers $TAG$( ((DRY_RUN)) && printf " (dry-run)")"
  acquire_lock || return 4
  docker info >/dev/null 2>&1 || { log ERROR "Docker n'est pas actif."; return 1; }
  [[ -r "$PROJECT_DIR/$ENV_FILE_NAME" ]] || { log ERROR "$ENV_FILE_NAME absent."; return 1; }

  local sha=""
  if ((!KEEP_CODE)) && [[ -f "$(point_sha_file "$TAG")" ]]; then
    sha=$(<"$(point_sha_file "$TAG")")
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { log ERROR "SHA enregistré invalide pour $TAG."; return 1; }
    require_clean_tree || return 1
  elif ((!KEEP_CODE)); then
    log WARN "Aucun commit enregistré pour $TAG : le code du dépôt reste inchangé."
  fi
  if ! restore_from_tag "$TAG" "$sha"; then
    log ERROR "Retour impossible."
    return 1
  fi
  if ((DRY_RUN)); then
    log DRY "[dry-run] vérifications non exécutées"
    return 0
  fi
  if retry check_containers && verify_public; then
    log INFO "Retour effectué vers $TAG${sha:+ (commit $sha)}. La base n'a pas été modifiée."
    log INFO "Si des migrations avaient été appliquées, vérifier la compatibilité du schéma ou restaurer une sauvegarde (docs/deployment-production.md)."
    return 0
  fi
  log ERROR "Les vérifications ont échoué après le retour vers $TAG."
  return 3
}

# Une seule ligne : bash doit avoir tout lu avant toute modification du fichier par git
rc=0; main "$@" || rc=$?; if [[ -n "${TEE_PID:-}" ]]; then finish_logging; fi; exit "$rc"
