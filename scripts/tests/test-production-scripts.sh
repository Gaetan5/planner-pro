#!/usr/bin/env bash
# Tests des scripts de déploiement : aucune connexion, aucun vrai Docker. docker, sudo, systemctl,
# ss et curl sont remplacés par des doublures ; git est le vrai git, sur des dépôts temporaires.
# Usage : scripts/tests/test-production-scripts.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$HERE/.." && pwd)"
ROOT_TMP="$(mktemp -d)"
trap 'rm -rf "$ROOT_TMP"' EXIT
ORIG_PATH="$PATH"
REAL_GIT="$(command -v git)"
export REAL_GIT
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
ko() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
assert_eq() { if [[ "$2" == "$3" ]]; then ok "$1"; else ko "$1 (attendu « $3 », obtenu « $2 »)"; fi; }
assert_calls() { if grep -qE -- "$2" "$T/fake/calls.log"; then ok "$1"; else ko "$1 (absent des appels : $2)"; fi; }
assert_no_calls() { if grep -qE -- "$2" "$T/fake/calls.log"; then ko "$1 (appel inattendu : $2)"; else ok "$1"; fi; }
assert_out() { if grep -qE -- "$2" "$T/out.txt"; then ok "$1"; else ko "$1 (absent de la sortie : $2)"; fi; }

make_doubles() {
  local b="$T/bin"
  mkdir -p "$b" "$T/fake"
  : >"$T/fake/calls.log"
  : >"$T/fake/tags"
  cat >"$b/docker" <<'D'
#!/usr/bin/env bash
echo "docker $*" >>"$FAKE/calls.log"
case "$1" in
  info) [[ -z "${FAKE_DOCKER_DOWN:-}" ]] || exit 1; [[ "$*" != *DockerRootDir* ]] || echo "$FAKE"; exit 0 ;;
  ps) [[ -n "${FAKE_NO_PROXY:-}" ]] || echo ekose-nginx-1; exit 0 ;;
  inspect)
    case "$3" in
      *'.Image}}'*) echo "sha256:old-${4#cid-}" ;;
      *StopTimeout*) echo 15 ;;
      *) if [[ "${FAKE_UNHEALTHY:-}" == "${4#cid-}" ]]; then echo "running unhealthy 0"; else echo "running healthy ${FAKE_RESTART_COUNT:-0}"; fi ;;
    esac; exit 0 ;;
  image)
    case "$2" in
      inspect) grep -qxF "$3" "$FAKE/tags" ;;
      ls) grep "^${@: -1}:" "$FAKE/tags" | cut -d: -f2 ;;
      prune) exit 0 ;;
    esac; exit $? ;;
  restart) echo "$2" >>"$FAKE/restarted"; rm -f "$FAKE/stale"; exit 0 ;;
  port) [[ -z "${FAKE_PORT_LOST:-}" ]] || exit 1; printf '80/tcp -> 0.0.0.0:80\n443/tcp -> 0.0.0.0:443\n'; exit 0 ;;
  tag) echo "$3" >>"$FAKE/tags"; exit 0 ;;
  rmi) grep -vxF "$2" "$FAKE/tags" >"$FAKE/tags.new"; mv "$FAKE/tags.new" "$FAKE/tags"; exit 0 ;;
  compose)
    shift
    while [[ "${1:-}" == --env-file || "${1:-}" == -f ]]; do shift 2; done
    sub=$1; shift
    case "$sub" in
      build) [[ -z "${FAKE_BUILD_FAIL:-}" ]] || exit 1 ;;
      up)
        [[ -z "${FAKE_STALE_PROXY:-}" ]] || touch "$FAKE/stale"
        if [[ " $* " == *" --no-build "* ]]; then [[ -n "${FAKE_ROLLBACK_BROKEN:-}" ]] || rm -f "$FAKE/broken";
        elif [[ -n "${FAKE_BREAK_ON_UP:-}" ]]; then touch "$FAKE/broken"; fi ;;
      ps) echo "cid-${@: -1}" ;;
      logs)
        if [[ -f "$FAKE/broken" && "${FAKE_BREAK_ON_UP:-}" == migration ]]; then echo "Error: P3009 migrate found failed migrations"
        else echo "All migrations have been successfully applied."; fi ;;
      exec) echo v22.1.0 ;;
    esac; exit 0 ;;
esac
exit 0
D
  cat >"$b/sudo" <<'D'
#!/usr/bin/env bash
# Émule sudoers : seules les deux lignes documentées sont permises, arguments EXACTS
echo "sudo $*" >>"$FAKE/calls.log"
[[ "$1" == -n ]] && shift
list=0
if [[ "$1" == -l ]]; then list=1; shift; fi
[[ -z "${FAKE_SUDO_DENY:-}" ]] || { echo "sudo: a password is required" >&2; exit 1; }
cmd="$*"
case "$cmd" in
  "$SYSTEMCTL_BIN start planner-pro-backup.service") ;;
  "/usr/bin/find $BACKUP_DIR -maxdepth 1 -type f -mmin -10") ;;
  *) echo "sudo: a password is required" >&2; exit 1 ;;
esac
((list)) && exit 0
exec "$@"
D
  cat >"$b/git" <<'D'
#!/usr/bin/env bash
for a in "$@"; do
  if [[ "$a" == status && -n "${FAKE_GIT_STATUS_FAIL:-}" ]]; then echo "fatal: simulated" >&2; exit 128; fi
done
exec "$REAL_GIT" "$@"
D
  cat >"$b/systemctl" <<'D'
#!/usr/bin/env bash
echo "systemctl $*" >>"$FAKE/calls.log"
case "$1" in
  is-active) [[ -n "${FAKE_HOST_NGINX:-}" ]]; exit $? ;;
  start)
    [[ -z "${FAKE_BACKUP_FAIL:-}" ]] || exit 1
    [[ -n "${FAKE_BACKUP_NOFILE:-}" ]] || touch "$BACKUP_DIR/planner-pro-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.gpg" ;;
esac
exit 0
D
  cat >"$b/ss" <<'D'
#!/usr/bin/env bash
[[ -n "${FAKE_NO_LISTEN:-}" ]] || echo "LISTEN 0 4096 0.0.0.0:80 0.0.0.0:*"
D
  cat >"$b/curl" <<'D'
#!/usr/bin/env bash
echo "curl $*" >>"$FAKE/calls.log"
method=GET; url="${@: -1}"
while (($#)); do [[ "$1" == -X ]] && method=$2; shift; done
[[ ! -f "$FAKE/broken" && ! -f "$FAKE/stale" ]] || { printf 502; exit 0; }
case "$method $url" in
  "GET "*/features) printf 200 ;;
  "POST "*/projects) printf 401 ;;
  "GET "*) printf 200 ;;
esac
D
  chmod +x "$b"/*
}

make_repos() {
  git init -q --bare -b main "$T/origin.git"
  git init -q -b main "$T/seed"
  (
    cd "$T/seed" || exit 1
    git config user.email t@example.invalid; git config user.name t
    printf '.env.production\n' >.gitignore
    echo v1 >docker-compose.prod.yml
    git add . && git commit -qm c1
    git remote add origin "$T/origin.git" && git push -q origin main
  )
  git clone -q "$T/origin.git" "$T/proj"
  (
    cd "$T/seed" || exit 1
    echo v2 >docker-compose.prod.yml && mkdir -p scripts && echo a >scripts/x.sh && git add scripts && git commit -qam c2
    echo v3 >docker-compose.prod.yml && git commit -qam c3
    git push -q origin main
    git checkout -q -b side c1_placeholder 2>/dev/null || git checkout -q -b side HEAD~2
    echo side >side.txt && git add side.txt && git commit -qm side
    git push -q origin side
    git checkout -q main
  )
  touch "$T/proj/.env.production"
  C1=$(git -C "$T/seed" rev-parse HEAD~2); C2=$(git -C "$T/seed" rev-parse HEAD~1)
  SIDE=$(git -C "$T/seed" rev-parse side)
  git -C "$T/proj" fetch -q origin side
}

setup() {
  export PATH="$ORIG_PATH"
  T="$(mktemp -d "$ROOT_TMP/case.XXXXXX")"
  make_doubles
  make_repos
  mkdir -p "$T/backups" "$T/home"
  # Les tags « en cours » comme s'ils venaient de la production
  export FAKE="$T/fake" BACKUP_DIR="$T/backups" PROJECT_DIR="$T/proj" STATE_DIR="$T/state" HOME="$T/home"
  export SYSTEMCTL_BIN="$T/bin/systemctl" RETRIES=2 RETRY_DELAY=0 MIN_FREE_KB=1
  export WEB_URL=https://web.test API_URL=https://api.test
  export PATH="$T/bin:$ORIG_PATH"
  unset FAKE_DOCKER_DOWN FAKE_NO_PROXY FAKE_UNHEALTHY FAKE_BUILD_FAIL FAKE_BREAK_ON_UP FAKE_ROLLBACK_BROKEN \
    FAKE_RESTART_COUNT FAKE_CI_SUCCESS FAKE_SUDO_DENY FAKE_GIT_STATUS_FAIL REQUIRE_SIGNED_COMMITS FAKE_STALE_PROXY FAKE_PORT_LOST FAKE_HOST_NGINX FAKE_BACKUP_FAIL FAKE_BACKUP_NOFILE FAKE_NO_LISTEN KEEP_ROLLBACKS
}

# deploy <args...> : exécute le script, mémorise sortie et code
deploy() { "$SCRIPTS/deploy-production.sh" "$@" >"$T/out.txt" 2>&1; RC=$?; }
head_sha() { git -C "$T/proj" rev-parse HEAD; }

echo "== dry-run : aucune modification"
setup
deploy --dry-run "$C2"
assert_eq "dry-run : code 0" "$RC" 0
assert_eq "dry-run : HEAD inchangé" "$(head_sha)" "$C1"
assert_no_calls "dry-run : pas de build, up, tag ni sauvegarde" 'compose.* (build|up) |docker tag|^systemctl start'
assert_out "dry-run : plan affiché" '\[dry-run\].*merge --ff-only'
assert_eq "dry-run : journal écrit" "$(find "$T/state/logs" -name 'deploy-*.log' | wc -l)" 1

echo "== déploiement nominal"
setup
deploy "$C2"
assert_eq "code 0" "$RC" 0
assert_eq "HEAD = cible" "$(head_sha)" "$C2"
assert_calls "sauvegarde via sudo systemctl" 'sudo -n .*/systemctl start planner-pro-backup.service'
assert_calls "backend recréé sans dépendances" 'up -d --force-recreate --no-deps backend'
assert_calls "étiquette rollback-latest backend" 'docker tag sha256:old-backend planner-pro-production-backend:rollback-latest'
assert_calls "étiquette rollback-latest frontend" 'docker tag sha256:old-frontend planner-pro-production-frontend:rollback-latest'
assert_eq "commit du point de retour" "$(cat "$T/state/rollback-points/rollback-latest")" "$C1"
assert_out "résumé lisible" 'résultat +: SUCCÈS'
assert_calls "contrôle HTTP de l'API" 'curl .*https://api.test/features'

echo "== redéploiement idempotent du même commit"
deploy "$C2"
assert_eq "code 0" "$RC" 0
assert_eq "point de retour non écrasé" "$(cat "$T/state/rollback-points/rollback-latest")" "$C1"

echo "== SHA qui ne prolonge pas le commit déployé"
deploy "$C1"
assert_eq "refus (code 1)" "$RC" 1
assert_out "motif" 'ne prolonge pas'

echo "== SHA refusés"
setup
deploy "$SIDE"
assert_eq "SHA hors main : code 1" "$RC" 1
assert_out "motif ancêtre de origin/main" "pas un ancêtre de origin/main"
assert_no_calls "aucune sauvegarde ni build" '^systemctl start|compose.* build'
deploy "$C2; rm -rf /"
assert_eq "SHA malformé : code 64" "$RC" 64
deploy ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD
assert_eq "SHA en majuscules : code 64" "$RC" 64
deploy deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
assert_eq "SHA inconnu : code 1" "$RC" 1

echo "== arbre non propre"
setup
echo x >"$T/proj/untracked.txt"
deploy "$C2"
assert_eq "code 1" "$RC" 1
assert_no_calls "aucune sauvegarde" '^systemctl start'

echo "== prérequis"
setup; FAKE_HOST_NGINX=1 deploy "$C2"
assert_eq "nginx d'hôte actif : refus" "$RC" 1
assert_out "alerte" 'ALERTE'
assert_no_calls "rien lancé" '^systemctl start|compose'
setup; FAKE_NO_PROXY=1 deploy "$C2"
assert_eq "aucun docker-proxy sur 80/443 : refus" "$RC" 1
setup; FAKE_NO_LISTEN=1 deploy "$C2"
assert_eq "port non en écoute : refus" "$RC" 1
setup; FAKE_DOCKER_DOWN=1 deploy "$C2"
assert_eq "Docker inactif : refus" "$RC" 1
setup; MIN_FREE_KB=999999999999 deploy "$C2"
assert_eq "disque insuffisant : refus" "$RC" 1
setup; rm "$T/proj/.env.production"; deploy "$C2"
assert_eq ".env.production absent : refus" "$RC" 1

echo "== sauvegarde"
setup; FAKE_BACKUP_FAIL=1 deploy "$C2"
assert_eq "service en échec : code 1" "$RC" 1
assert_eq "HEAD inchangé" "$(head_sha)" "$C1"
assert_no_calls "pas de build" 'compose.* build'
setup; touch -d '1 hour ago' "$T/backups/planner-pro-old.sql.gz.gpg"; FAKE_BACKUP_NOFILE=1 deploy "$C2"
assert_eq "aucun fichier récent : code 1" "$RC" 1
assert_no_calls "pas de build" 'compose.* build'

echo "== échec du build : dépôt restauré, conteneurs intacts"
setup; FAKE_BUILD_FAIL=1 deploy "$C2"
assert_eq "code 1" "$RC" 1
assert_eq "HEAD restauré" "$(head_sha)" "$C1"
assert_no_calls "aucun up" 'compose.* up '

echo "== échec de vérification : retour automatique"
setup; FAKE_BREAK_ON_UP=http deploy "$C2"
assert_eq "code 2" "$RC" 2
assert_eq "HEAD restauré" "$(head_sha)" "$C1"
assert_calls "images rollback-latest remises en :latest" "docker tag .*backend:rollback-[0-9TZ]+ .*backend:latest"
assert_calls "recréation sans build" 'up -d --force-recreate --no-deps --no-build backend frontend'
assert_out "avertissement migration" 'NE PEUT PAS être annulée'
assert_out "fichier de sauvegarde indiqué" 'restaurer la sauvegarde : .*planner-pro-.*\.sql\.gz\.gpg'
setup; FAKE_BREAK_ON_UP=migration deploy "$C2"
assert_eq "erreur de migration détectée : code 2" "$RC" 2
setup; FAKE_UNHEALTHY=backend deploy "$C2"
assert_eq "conteneur non sain : code 2 ou 3" "$([[ $RC == 2 || $RC == 3 ]] && echo y)" y
setup; FAKE_BREAK_ON_UP=http FAKE_ROLLBACK_BROKEN=1 deploy "$C2"
assert_eq "retour en échec : code 3" "$RC" 3
assert_out "résumé critique" 'ÉCHEC CRITIQUE'

echo "== proxy aux IP périmées (502) : un redémarrage unique d'ekose-nginx-1"
setup; FAKE_STALE_PROXY=1 deploy "$C2"
assert_eq "code 0 après redémarrage du proxy" "$RC" 0
assert_eq "un seul redémarrage" "$(wc -l <"$T/fake/restarted")" 1
assert_calls "docker restart ekose-nginx-1" '^docker restart ekose-nginx-1$'
assert_calls "ports 80/443 contrôlés" '^docker port ekose-nginx-1$'
assert_no_calls "aucun autre ordre sur le proxy" 'docker (stop|rm|kill|exec) .*ekose'
setup; deploy "$C2"
assert_no_calls "pas de redémarrage sans 502" 'docker restart'
setup; FAKE_STALE_PROXY=1 FAKE_PORT_LOST=1 deploy "$C2"
assert_eq "ports perdus après redémarrage : échec (2 ou 3)" "$([[ $RC == 2 || $RC == 3 ]] && echo y)" y
setup; FAKE_BREAK_ON_UP=http deploy "$C2"
assert_eq "au plus 2 redémarrages (déploiement puis retour)" "$([[ $(wc -l <"$T/fake/restarted" 2>/dev/null || echo 0) -le 2 ]] && echo y)" y

echo "== verrou"
setup
mkdir -p "$T/state"
( flock -n 9 && sleep 5 ) 9>"$T/state/deploy.lock" &
holder=$!
sleep 0.3
deploy "$C2"
assert_eq "déploiement concurrent : code 4" "$RC" 4
assert_no_calls "rien lancé" '^systemctl start|compose'
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null

echo "== conservation des N derniers points de retour"
setup
for ts in 20260101T000000Z 20260102T000000Z 20260103T000000Z; do
  for r in backend frontend; do echo "planner-pro-production-$r:rollback-$ts" >>"$T/fake/tags"; done
done
KEEP_ROLLBACKS=2 deploy "$C2"
assert_eq "code 0" "$RC" 0
assert_calls "suppression du plus ancien" 'docker rmi planner-pro-production-backend:rollback-20260101T000000Z'
assert_no_calls "rollback-latest jamais supprimé" 'rmi .*rollback-latest'

echo "== rollback-production.sh"
setup
deploy "$C2"
: >"$T/fake/calls.log"
"$SCRIPTS/rollback-production.sh" rollback-latest >"$T/out.txt" 2>&1; RC=$?
assert_eq "retour manuel : code 0" "$RC" 0
assert_eq "HEAD = commit du point de retour" "$(head_sha)" "$C1"
assert_no_calls "aucune commande sur la base" 'mysql|migrate|^systemctl start'
"$SCRIPTS/rollback-production.sh" "rollback-latest; x" >"$T/out.txt" 2>&1; RC=$?
assert_eq "étiquette invalide : code 64" "$RC" 64
"$SCRIPTS/rollback-production.sh" rollback-20200101T000000Z >"$T/out.txt" 2>&1; RC=$?
assert_eq "étiquette inconnue : code 1" "$RC" 1
: >"$T/fake/calls.log"
"$SCRIPTS/rollback-production.sh" --dry-run rollback-latest >"$T/out.txt" 2>&1; RC=$?
assert_eq "dry-run : code 0" "$RC" 0
assert_no_calls "dry-run : aucun tag ni up" 'docker tag|compose.* up '

echo "== deploy-ssh-wrapper.sh"
setup
# shellcheck disable=SC2016
printf '%s\n' '#!/usr/bin/env bash' 'echo "STUB $*" >>"$FAKE/calls.log"' >"$T/bin/stub-deploy"; chmod +x "$T/bin/stub-deploy"
wrap() { PLANNER_PRO_TEST=1 SSH_ORIGINAL_COMMAND="$1" DEPLOY_SCRIPT_OVERRIDE="$T/bin/stub-deploy" "$SCRIPTS/deploy-ssh-wrapper.sh" >"$T/out.txt" 2>&1; RC=$?; }
wrap "deploy $C2"; assert_eq "commande valide : code 0" "$RC" 0; assert_calls "script appelé avec le SHA" "STUB $C2"
: >"$T/fake/calls.log"
wrap "dry-run $C2"; assert_calls "dry-run transmis" "STUB --dry-run $C2"
: >"$T/fake/calls.log"
for bad in "" "bash" "deploy" "deploy $C2 extra" "deploy ${C2^^}" "deploy $C2; id" "deploy \$(id)" "deploy ${C2:0:39}" "rollback rollback-latest"; do
  wrap "$bad"; assert_eq "refus de « $bad »" "$RC" 126
done
assert_no_calls "aucun script exécuté" 'STUB'
PLANNER_PRO_TEST=1 SSH_ORIGINAL_COMMAND="" DEPLOY_SCRIPT_OVERRIDE="$T/bin/stub-deploy" "$SCRIPTS/deploy-ssh-wrapper.sh" >/dev/null 2>&1; assert_eq "sans commande : 126" "$?" 126

# Sans PLANNER_PRO_TEST=1, la surcharge est ignorée (le chemin de production est utilisé)
: >"$T/fake/calls.log"
SSH_ORIGINAL_COMMAND="deploy $C2" DEPLOY_SCRIPT_OVERRIDE="$T/bin/stub-deploy" "$SCRIPTS/deploy-ssh-wrapper.sh" >/dev/null 2>&1
assert_no_calls "surcharge du script ignorée hors test" 'STUB'

echo "== CD-1 : redéploiement raté du même SHA"
setup
deploy "$C2"
: >"$T/fake/calls.log"
FAKE_BREAK_ON_UP=http deploy "$C2"
assert_eq "code 2" "$RC" 2
assert_eq "HEAD reste sur la cible (pas C1)" "$(head_sha)" "$C2"
assert_calls "retour au point horodaté" 'docker tag .*backend:rollback-[0-9]{8}T[0-9]{6}Z .*backend:latest'
assert_no_calls "rollback-latest (N-1) jamais remis en :latest" 'docker tag .*backend:rollback-latest .*backend:latest'
assert_eq "rollback-latest inchangé (commit N-1)" "$(cat "$T/state/rollback-points/rollback-latest")" "$C1"

echo "== CD-3 : git status en échec n'est pas pris pour un arbre propre"
setup; FAKE_GIT_STATUS_FAIL=1 deploy "$C2"
assert_eq "déploiement refusé (code 1)" "$RC" 1
assert_out "motif" 'git status a échoué'
assert_no_calls "aucune sauvegarde lancée" '^systemctl start'
setup; deploy "$C2"; FAKE_GIT_STATUS_FAIL=1 "$SCRIPTS/rollback-production.sh" rollback-latest >"$T/out.txt" 2>&1; RC=$?
assert_eq "retour manuel refusé (code 1)" "$RC" 1
assert_eq "HEAD inchangé" "$(head_sha)" "$C2"

echo "== r61-m5 : dry-run complet en lecture seule"
setup; FAKE_SUDO_DENY=1 deploy --dry-run "$C2"
assert_eq "sudo refusé : code 1" "$RC" 1
setup; FAKE_UNHEALTHY=backend deploy --dry-run "$C2"
assert_eq "conteneur non sain : code 1" "$RC" 1
setup; touch "$T/fake/broken"; deploy --dry-run "$C2"
assert_eq "domaines en 502 : code 1" "$RC" 1
assert_no_calls "dry-run : pas de redémarrage du proxy" 'docker restart'
setup; FAKE_PORT_LOST=1 deploy --dry-run "$C2"
assert_eq "ports du proxy absents : code 1" "$RC" 1
setup; deploy --dry-run "$C2"
assert_calls "dry-run : droits sudo contrôlés" '^sudo -n -l .*systemctl start planner-pro-backup.service'
assert_calls "dry-run : find réel" '^sudo -n /usr/bin/find .* -maxdepth 1 -type f -mmin -10'
assert_no_calls "dry-run : sauvegarde non lancée" '^systemctl start'

echo "== r61-m3 : appels sudo exacts (la doublure refuse tout écart)"
setup; deploy "$C2"
assert_eq "déploiement avec sudo strict : code 0" "$RC" 0
assert_calls "systemctl exact" "^sudo -n $T/bin/systemctl start planner-pro-backup.service\$"
assert_calls "find exact" "^sudo -n /usr/bin/find $T/backups -maxdepth 1 -type f -mmin -10\$"
doc=docs/deployment-production.md
cd "$SCRIPTS/.." || exit 1
if grep -qF 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl start planner-pro-backup.service' $doc &&
  grep -qF 'deploy ALL=(root) NOPASSWD: /usr/bin/find /var/backups/planner-pro -maxdepth 1 -type f -mmin -10' $doc; then
  ok "lignes sudoers documentées identiques aux appels"; else ko "lignes sudoers documentées"; fi
assert_eq "valeurs par défaut des binaires sudo" "$(grep -cE '^SYSTEMCTL_BIN="\$\{SYSTEMCTL_BIN:-/usr/bin/systemctl\}"|^FIND_BIN="\$\{FIND_BIN:-/usr/bin/find\}"' scripts/lib/production-common.sh)" 2
if grep -q '^ExecStart=/usr/local/lib/planner-pro/backup-production.sh$' ops/systemd/planner-pro-backup.service &&
  ! grep -q '/opt/planner-pro/scripts' ops/systemd/planner-pro-backup.service; then
  ok "CD-3 : unité de sauvegarde hors du clone Git"; else ko "CD-3 : unité de sauvegarde"; fi

echo "== r61-m7 : SHA du fichier d'état validé avant reset --hard"
setup; deploy "$C2"
printf '%s\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa >"$T/state/rollback-points/rollback-latest"
: >"$T/fake/calls.log"
"$SCRIPTS/rollback-production.sh" rollback-latest >"$T/out.txt" 2>&1; RC=$?
assert_eq "SHA inconnu : refus (code 1)" "$RC" 1
assert_eq "HEAD inchangé" "$(head_sha)" "$C2"
assert_no_calls "aucune image retaguée" 'docker tag'
printf '%s\n' 'not-a-sha; rm -rf /' >"$T/state/rollback-points/rollback-latest"
"$SCRIPTS/rollback-production.sh" rollback-latest >"$T/out.txt" 2>&1; RC=$?
assert_eq "valeur non hexadécimale : refus" "$RC" 1

echo "== r61-m6 : journal du backend hors de la sortie"
setup; FAKE_BREAK_ON_UP=migration deploy "$C2"
if grep -q 'P3009' "$T/out.txt"; then ko "journal du backend affiché dans la sortie"; else ok "journal du backend absent de la sortie"; fi
if grep -q 'P3009' "$T"/state/logs/deploy-*.log; then ok "journal du backend dans le fichier de la VM"; else ko "journal du backend absent du fichier"; fi

echo "== r61-a1 / CD-2.4 : avertissement scripts modifiés, commits signés"
setup; deploy --dry-run "$C2"
assert_out "avertissement sur changement de scripts" 'utilise encore l.ancienne version'
setup; REQUIRE_SIGNED_COMMITS=1 deploy "$C2"
assert_eq "commit non signé refusé (code 1)" "$RC" 1
assert_no_calls "aucune sauvegarde" '^systemctl start'

echo "== r61-m2 : garde statique du workflow deploy.yml"
wf=.github/workflows/deploy.yml
for needle in "github.event.workflow_run.conclusion == 'success'" "github.event.workflow_run.event == 'push'" \
  "github.event.workflow_run.head_branch == 'main'" "github.event.workflow_run.head_repository.full_name == github.repository" \
  "vars.DEPLOY_ENABLED == 'true'" "name: production" "StrictHostKeyChecking=yes" "cancel-in-progress: false" \
  "github.event.workflow_run.head_sha" "github.ref == 'refs/heads/main'"; do
  if grep -qF -- "$needle" $wf; then ok "deploy.yml : $needle"; else ko "deploy.yml : $needle absent"; fi
done
if grep -qE 'pull_request|pull_request_target' $wf; then ko "deploy.yml : déclencheur pull_request"; else ok "deploy.yml : aucun déclencheur de PR"; fi
perms=$(awk '/^permissions:/{f=1;next} f&&/^[^ ]/{f=0} f' $wf)
if grep -q write <<<"$perms" || [[ -z "$perms" ]]; then ko "deploy.yml : permissions"; else ok "deploy.yml : permissions sans écriture"; fi
bad=$(awk '/^ *run:/{match($0,/^ */);ind=RLENGTH;inrun=1;if($0 ~ /\$\{\{/)print NR;next} inrun{match($0,/^ */);if(RLENGTH<=ind&&$0 !~ /^ *$/)inrun=0; else if($0 ~ /\$\{\{/)print NR}' $wf)
if [[ -z "$bad" ]]; then ok "deploy.yml : aucune expression \${{ }} dans un bloc run"; else ko "deploy.yml : expression dans run (lignes $bad)"; fi
if grep -E '^\s*-?\s*uses:' $wf | grep -vqE '@[0-9a-f]{40}'; then ko "deploy.yml : action non épinglée"; else ok "deploy.yml : actions épinglées (ou absentes)"; fi

echo "== r62-m2 : SHA de retour existant mais hors de l'historique"
setup; deploy "$C2"
printf '%s\n' "$SIDE" >"$T/state/rollback-points/rollback-latest"
: >"$T/fake/calls.log"
"$SCRIPTS/rollback-production.sh" rollback-latest >"$T/out.txt" 2>&1; RC=$?
assert_eq "SHA hors historique : refus (code 1)" "$RC" 1
assert_out "motif" 'invalide ou hors de l.historique'
assert_eq "HEAD inchangé" "$(head_sha)" "$C2"
assert_no_calls "aucune image retaguée" 'docker tag'
assert_no_calls "aucun recreate" 'compose.* up '

echo "== r62-m3 : RestartCount passé"
setup; FAKE_RESTART_COUNT=1 deploy --dry-run "$C2"
assert_eq "dry-run : code 0" "$RC" 0
assert_out "dry-run : avertissement" 'WARN .*redémarrage\(s\) passé'
setup; FAKE_RESTART_COUNT=1 deploy "$C2"
assert_eq "déploiement réel : redémarrages bloquants (code 3)" "$RC" 3
assert_eq "HEAD restauré" "$(head_sha)" "$C1"
setup; deploy "$C2"; FAKE_RESTART_COUNT=1 "$SCRIPTS/rollback-production.sh" rollback-latest >"$T/out.txt" 2>&1; RC=$?
assert_eq "retour manuel : redémarrages bloquants (code 3)" "$RC" 3

echo "== r62-m1 : étape « CI réussie » du workflow_dispatch"
cd "$SCRIPTS/.." || exit 1
wf=.github/workflows/deploy.yml
ci_line=$(grep -n 'name: Exiger une CI réussie' $wf | cut -d: -f1)
ssh_line=$(grep -n 'name: Déployer sur la VM' $wf | cut -d: -f1)
if [[ -n "$ci_line" && -n "$ssh_line" ]] && ((ci_line < ssh_line)); then ok "étape CI présente avant l'étape SSH"; else ko "ordre des étapes CI / SSH"; fi
ci_step=$(awk -v s="$ci_line" 'NR>s && /^      - name:/{exit} NR>=s' $wf)
if grep -qxF "        if: github.event_name == 'workflow_dispatch'" <<<"$ci_step"; then ok "étape CI : condition workflow_dispatch exacte"; else ko "étape CI : condition"; fi
# shellcheck disable=SC2016
for needle in 'gh run list' '--workflow ci.yml' '--status success' '--commit "$SHA"' '--event push' 'exit 1'; do
  if grep -qF -- "$needle" <<<"$ci_step"; then ok "étape CI : $needle"; else ko "étape CI : $needle absent"; fi
done
if grep -q 'continue-on-error' $wf; then ko "deploy.yml : continue-on-error"; else ok "deploy.yml : aucun continue-on-error"; fi
ssh_step=$(awk -v s="$ssh_line" 'NR>s && /^      - name:/{exit} NR>=s' $wf)
if grep -qE '^\s+if:' <<<"$ssh_step"; then ko "étape SSH conditionnelle (peut être sautée)"; else ok "étape SSH sans condition"; fi
if grep -qx 'permissions:' $wf && [[ "$(awk '/^permissions:/{f=1;next} f&&/^[^ ]/{f=0} f' $wf | grep -v '^ *#' | grep -v '^ *$' | tr -d ' ' | tr '\n' ' ')" == "actions:read " ]]; then ok "permissions = actions: read seul"; else ko "permissions"; fi
# Exécution réelle du bloc run avec une doublure de gh
cat >"$T/bin/gh" <<'D'
#!/usr/bin/env bash
echo "gh $*" >>"$FAKE/calls.log"
args=" $* "
# Sans filtre de statut, une exécution (même échouée) existe toujours : le filtre est indispensable
if [[ "$args" == *" --status success "* && "$args" == *" --commit $SHA "* && "$args" == *" --workflow ci.yml "* ]]; then
  echo "${FAKE_CI_SUCCESS:-0}"
else
  echo 1
fi
D
chmod +x "$T/bin/gh"
awk -v s="$ci_line" 'NR>s && /^      - name:/{exit} NR>s && f{sub(/^          /,"");print} NR>s && /^        run: \|/{f=1}' $wf >"$T/ci-step.sh"
if [[ -s "$T/ci-step.sh" ]]; then ok "bloc run extrait"; else ko "bloc run non extrait"; fi
: >"$T/fake/calls.log"
SHA="$C2" FAKE_CI_SUCCESS=1 bash "$T/ci-step.sh" >"$T/out.txt" 2>&1; assert_eq "CI réussie : étape passe" "$?" 0
SHA="$C2" FAKE_CI_SUCCESS=0 bash "$T/ci-step.sh" >"$T/out.txt" 2>&1; assert_eq "CI absente ou échouée : étape échoue" "$?" 1
assert_calls "gh appelé avec le SHA" "gh run list .*--commit $C2"

echo "== shellcheck"
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck -x "$SCRIPTS"/deploy-production.sh "$SCRIPTS"/rollback-production.sh "$SCRIPTS"/deploy-ssh-wrapper.sh \
    "$SCRIPTS"/lib/production-common.sh "$HERE"/test-production-scripts.sh; then ok "shellcheck sans avertissement"; else ko "shellcheck"; fi
else
  echo "  shellcheck indisponible : étape ignorée (le CI l'exécute)"
fi

echo
echo "Résultat : $PASS réussis, $FAIL en échec"
((FAIL == 0))
