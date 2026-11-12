#!/usr/bin/env bash
# Commande forcée (`command=`) de la clé SSH dédiée au déploiement : seule la forme
#   deploy <sha de 40 caractères hexadécimaux minuscules>
#   dry-run <sha de 40 caractères hexadécimaux minuscules>
# est acceptée dans SSH_ORIGINAL_COMMAND. Tout le reste est refusé avant toute exécution.
set -euo pipefail
export LC_ALL=C

DEPLOY_SCRIPT="/opt/planner-pro/scripts/deploy-production.sh"
# Surcharge réservée aux tests : jamais honorée en production
if [[ "${PLANNER_PRO_TEST:-}" == "1" && -n "${DEPLOY_SCRIPT_OVERRIDE:-}" ]]; then
  DEPLOY_SCRIPT="$DEPLOY_SCRIPT_OVERRIDE"
fi
original="${SSH_ORIGINAL_COMMAND:-}"

if [[ "$original" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  exec "$DEPLOY_SCRIPT" "${BASH_REMATCH[1]}"
elif [[ "$original" =~ ^dry-run\ ([0-9a-f]{40})$ ]]; then
  exec "$DEPLOY_SCRIPT" --dry-run "${BASH_REMATCH[1]}"
fi

printf 'Commande refusée : attendu « deploy <sha de 40 caractères> ».\n' >&2
exit 126
