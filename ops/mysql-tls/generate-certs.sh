#!/usr/bin/env bash
# Génère l'autorité de certification privée et le certificat serveur TLS de MySQL (audit S4).
#
# Usage (depuis la racine du dépôt, sur l'hôte de production) :
#   ops/mysql-tls/generate-certs.sh [répertoire_de_sortie]      # défaut : secrets/mysql
#
# Variables facultatives :
#   MYSQL_TLS_SERVER_NAME  nom DNS du serveur dans le certificat (défaut : db, nom du service compose)
#   MYSQL_TLS_DAYS         validité du certificat serveur en jours (défaut : 825)
#   MYSQL_TLS_CA_DAYS      validité de l'AC en jours (défaut : 3650)
#   MYSQL_IMAGE            image utilisée pour attribuer la clé serveur à l'utilisateur mysql
#                          (défaut : mysql:8.0, la même que docker-compose.prod.yml)
#   ROTATE_CA=1            régénère aussi l'AC (sinon l'AC existante est réutilisée)
#
# Fichiers produits :
#   ca.pem           AC publique : montée dans MySQL et dans le backend (lecture seule)
#   ca-key.pem       clé privée de l'AC (600) : n'est montée nulle part, à conserver hors ligne
#   server-cert.pem  certificat serveur (SAN = MYSQL_TLS_SERVER_NAME)
#   server-key.pem   clé privée serveur (600, propriétaire = utilisateur mysql de l'image)
set -euo pipefail

OUT_DIR="${1:-secrets/mysql}"
SERVER_NAME="${MYSQL_TLS_SERVER_NAME:-db}"
DAYS="${MYSQL_TLS_DAYS:-825}"
CA_DAYS="${MYSQL_TLS_CA_DAYS:-3650}"
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.0}"

umask 077
mkdir -p "$OUT_DIR"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# 1. Autorité de certification privée (réutilisée sauf ROTATE_CA=1)
if [[ "${ROTATE_CA:-0}" == "1" || ! -f "$OUT_DIR/ca.pem" || ! -f "$OUT_DIR/ca-key.pem" ]]; then
  openssl genrsa -out "$WORK_DIR/ca-key.pem" 4096
  openssl req -x509 -new -sha256 -days "$CA_DAYS" -key "$WORK_DIR/ca-key.pem" \
    -subj "/CN=Planner-Pro MySQL CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$WORK_DIR/ca.pem"
else
  cp "$OUT_DIR/ca.pem" "$WORK_DIR/ca.pem"
  cp "$OUT_DIR/ca-key.pem" "$WORK_DIR/ca-key.pem"
fi

# 2. Certificat serveur signé par l'AC, SAN = nom du service compose
openssl genrsa -out "$WORK_DIR/server-key.pem" 2048
openssl req -new -sha256 -key "$WORK_DIR/server-key.pem" -subj "/CN=$SERVER_NAME" \
  -out "$WORK_DIR/server.csr"
cat > "$WORK_DIR/server-ext.cnf" <<EXT
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:$SERVER_NAME
EXT
openssl x509 -req -sha256 -days "$DAYS" -in "$WORK_DIR/server.csr" \
  -CA "$WORK_DIR/ca.pem" -CAkey "$WORK_DIR/ca-key.pem" -CAcreateserial \
  -extfile "$WORK_DIR/server-ext.cnf" -out "$WORK_DIR/server-cert.pem"
openssl verify -CAfile "$WORK_DIR/ca.pem" "$WORK_DIR/server-cert.pem" >/dev/null

# 3. Droits : clés privées en 600, certificats publics en 644
chmod 600 "$WORK_DIR/ca-key.pem" "$WORK_DIR/server-key.pem"
chmod 644 "$WORK_DIR/ca.pem" "$WORK_DIR/server-cert.pem"

# 4. Installation atomique (mv remplace aussi une ancienne clé appartenant à l'utilisateur mysql)
for file in ca.pem ca-key.pem server-cert.pem server-key.pem; do
  mv -f "$WORK_DIR/$file" "$OUT_DIR/$file"
done

# 5. mysqld s'exécute sous l'utilisateur mysql de l'image : la clé serveur (600) doit lui
#    appartenir. On utilise l'image elle-même pour obtenir le bon UID, sans sudo.
ABS_OUT_DIR="$(cd "$OUT_DIR" && pwd)"
docker run --rm --entrypoint chown -v "$ABS_OUT_DIR/server-key.pem:/tls/server-key.pem" \
  "$MYSQL_IMAGE" mysql:mysql /tls/server-key.pem

echo "Certificats MySQL générés dans $OUT_DIR (SAN DNS:$SERVER_NAME, validité serveur $DAYS jours)."
echo "Redémarrer les services db et backend pour les prendre en compte."
