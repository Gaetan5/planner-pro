#!/bin/sh
# Vérifie les en-têtes de sécurité du frontend (S22) sur la page d'entrée et sur un asset .js.
# Usage : scripts/check-headers.sh [URL_DU_FRONTEND]   (défaut : http://localhost:8080)
# Variable : EXPECT_CSP_MODE=report-only (défaut) ou enforce.
set -eu

BASE="${1:-http://localhost:8080}"
BASE="${BASE%/}"
MODE="${EXPECT_CSP_MODE:-report-only}"
case "$MODE" in
  report-only) CSP_HEADER="content-security-policy-report-only" ;;
  enforce) CSP_HEADER="content-security-policy" ;;
  *) echo "EXPECT_CSP_MODE invalide : $MODE" >&2; exit 2 ;;
esac

FAILED=0
ok() { echo "  ok    $1"; }
ko() { echo "  ECHEC $1" >&2; FAILED=1; }

# $1 = en-têtes en minuscules, $2 = contexte
check() {
  headers="$1"
  ctx="$2"
  has() { printf '%s\n' "$headers" | grep -qiE -- "$1"; }
  has "^$CSP_HEADER: " && ok "$ctx : $CSP_HEADER" || ko "$ctx : $CSP_HEADER absent"
  # L'autre variante ne doit pas être posée (une seule politique, mode sans ambiguïté)
  if [ "$MODE" = "report-only" ]; then
    has "^content-security-policy: " && ko "$ctx : CSP bloquante présente alors que report-only attendu" || true
  else
    has "^content-security-policy-report-only: " && ko "$ctx : CSP report-only présente alors que enforce attendu" || true
  fi
  csp=$(printf '%s\n' "$headers" | grep -i "^$CSP_HEADER: " | head -n 1)
  for directive in "default-src 'self'" "frame-ancestors 'none'" "base-uri 'self'" "form-action 'self'" "object-src 'none'" "frame-src 'none'"; do
    printf '%s' "$csp" | grep -qF -- "$directive" && ok "$ctx : $directive" || ko "$ctx : directive '$directive' absente"
  done
  script_src=$(printf '%s' "$csp" | sed -nE "s/.*(script-src[^;]*).*/\1/p")
  case "$script_src" in
    "script-src 'self'") ok "$ctx : script-src 'self' seul" ;;
    *) ko "$ctx : script-src inattendu ('$script_src')" ;;
  esac
  printf '%s' "$csp" | grep -qiE "googleapis\.com/css|fonts\.g(oogleapis|static)" && ko "$ctx : source Google Fonts dans la CSP" || ok "$ctx : aucune source Google Fonts"
  has "^strict-transport-security: max-age=[0-9]+; includesubdomains" && ok "$ctx : HSTS includeSubDomains" || ko "$ctx : HSTS incomplet"
  has "^strict-transport-security:.*preload" && ko "$ctx : HSTS preload non décidé" || true
  has "^x-content-type-options: nosniff" && ok "$ctx : nosniff" || ko "$ctx : X-Content-Type-Options"
  has "^x-frame-options: deny" && ok "$ctx : X-Frame-Options" || ko "$ctx : X-Frame-Options"
  has "^referrer-policy: strict-origin-when-cross-origin" && ok "$ctx : Referrer-Policy" || ko "$ctx : Referrer-Policy"
  has "^permissions-policy: " && ok "$ctx : Permissions-Policy" || ko "$ctx : Permissions-Policy"
}

echo "Page d'entrée : $BASE/"
HOME_HEADERS=$(curl -sS -o /dev/null -D - "$BASE/" | tr -d '\r')
check "$HOME_HEADERS" "/"

ASSET=$(curl -sS "$BASE/" | grep -oE '/assets/[^"]+\.js' | head -n 1 || true)
if [ -z "$ASSET" ]; then
  ko "aucun asset .js trouvé dans la page d'entrée"
else
  echo "Asset : $BASE$ASSET"
  ASSET_HEADERS=$(curl -sS -o /dev/null -D - "$BASE$ASSET" | tr -d '\r')
  check "$ASSET_HEADERS" "$ASSET"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "Des en-têtes de sécurité manquent ou sont incorrects." >&2
  exit 1
fi
echo "Tous les en-têtes attendus sont présents."
