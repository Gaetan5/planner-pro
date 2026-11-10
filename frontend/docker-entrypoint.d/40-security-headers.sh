#!/bin/sh
# En-têtes de sécurité du frontend (S22). Exécuté au démarrage par l'entrypoint de l'image nginx
# officielle : génère le fichier inclus par nginx.prod.conf, à partir de variables d'environnement
# du conteneur (aucun domaine n'est codé en dur).
#
#   VITE_API_URL    obligatoire : URL de l'API (la même que celle compilée dans le frontend).
#                   Donne `connect-src` (HTTP et WebSocket de socket.io, même hôte).
#   CSP_MODE        `report-only` (défaut : la CSP signale sans bloquer) ou `enforce` (bloque).
#   CSP_REPORT_URI  facultatif : URL qui reçoit les rapports de violation de la CSP.
#
# Toute valeur invalide arrête le conteneur (pas de repli silencieux).
set -eu

OUT="${SECURITY_HEADERS_FILE:-/etc/nginx/snippets/security-headers.conf}"
MODE="${CSP_MODE:-report-only}"
API="${VITE_API_URL:-}"
REPORT_URI="${CSP_REPORT_URI:-}"

fail() {
  echo "security-headers: $1" >&2
  exit 1
}

case "$MODE" in
  report-only) HEADER_NAME="Content-Security-Policy-Report-Only" ;;
  enforce) HEADER_NAME="Content-Security-Policy" ;;
  *) fail "CSP_MODE doit valoir 'report-only' ou 'enforce' (reçu : '$MODE')" ;;
esac

[ -n "$API" ] || fail "VITE_API_URL est obligatoire (origine de l'API pour connect-src)"
# `sed` valide ligne par ligne : une valeur multiligne passerait la validation avec une CSP tronquée
case "$API" in
  *[[:cntrl:]]*) fail "VITE_API_URL contient un saut de ligne ou un caractère de contrôle" ;;
esac
SCHEME=$(printf '%s' "$API" | sed -nE 's#^(https?)://.*#\1#p')
HOSTPORT=$(printf '%s' "$API" | sed -nE 's#^https?://([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(:[0-9]{1,5})?(/[^[:space:]]*)?$#\1\2#p')
[ -n "$SCHEME" ] && [ -n "$HOSTPORT" ] || fail "VITE_API_URL invalide : attendu http(s)://hôte[:port][/chemin]"
PORT=$(printf '%s' "$HOSTPORT" | sed -nE 's#^.*:([0-9]+)$#\1#p')
if [ -n "$PORT" ]; then
  # Port décimal sans zéro initial, de 1 à 65535
  case "$PORT" in
    0*) fail "VITE_API_URL : port invalide ($PORT), attendu 1 à 65535" ;;
  esac
  [ "${#PORT}" -le 5 ] && [ "$PORT" -le 65535 ] || fail "VITE_API_URL : port invalide ($PORT), attendu 1 à 65535"
fi
if [ "$SCHEME" = "https" ]; then WS_SCHEME="wss"; else WS_SCHEME="ws"; fi

REPORT_DIRECTIVE=""
if [ -n "$REPORT_URI" ]; then
  case "$REPORT_URI" in
    *[[:cntrl:]]*) fail "CSP_REPORT_URI contient un saut de ligne ou un caractère de contrôle" ;;
  esac
  # Caractères qui sortiraient de la directive CSP ou de la chaîne nginx (injection d'en-tête)
  case "$REPORT_URI" in
    *[!A-Za-z0-9._~:/?\#@\&=%+,-]*) fail "CSP_REPORT_URI contient un caractère interdit" ;;
  esac
  case "$REPORT_URI" in
    http://* | https://* | /*) ;;
    *) fail "CSP_REPORT_URI doit commencer par http://, https:// ou /" ;;
  esac
  REPORT_DIRECTIVE="; report-uri $REPORT_URI"
fi

# Sources, avec leur raison d'être :
#  - script-src 'self' : aucun script inline ni eval (défense en profondeur de S20) ;
#  - style-src 'unsafe-inline' : les composants React utilisent des attributs style="..." ;
#  - img-src data: https: : icône et QR code en data: URI, avatars distants ;
#  - font-src 'self' : police auto-hébergée (@fontsource), aucune source Google Fonts ;
#  - media-src assets.mixkit.co : son de notification de mention (AppContext) ;
#  - connect-src : API, socket.io (wss) et Firebase Auth par e-mail/mot de passe
#    (identitytoolkit : connexion ; securetoken : rafraîchissement du jeton Firebase) ;
#  - frame-src 'none' : pas de connexion Google par popup ni redirection dans le code actuel.
CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; media-src 'self' https://assets.mixkit.co; connect-src 'self' ${SCHEME}://${HOSTPORT} ${WS_SCHEME}://${HOSTPORT} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'${REPORT_DIRECTIVE}"

mkdir -p "$(dirname "$OUT")"
TMP="$OUT.tmp"
{
  printf 'add_header %s "%s" always;\n' "$HEADER_NAME" "$CSP"
  # HSTS : tous les sous-domaines sont en HTTPS ; pas de `preload` (décision explicite requise)
  printf 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\n'
  printf 'add_header X-Content-Type-Options "nosniff" always;\n'
  # Redondant avec frame-ancestors, mais appliqué même quand la CSP est en Report-Only
  printf 'add_header X-Frame-Options "DENY" always;\n'
  printf 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n'
  printf 'add_header Permissions-Policy "camera=(), geolocation=(), microphone=(self)" always;\n'
} > "$TMP"
mv -f "$TMP" "$OUT"
echo "security-headers: $HEADER_NAME, API $SCHEME://$HOSTPORT" >&2
