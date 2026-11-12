# Déploiement de production sur un VPS Docker

Le Compose de production sert le frontend statique avec Nginx, démarre le backend en
mode production et applique uniquement les migrations Prisma versionnées. Il ne lance
jamais `prisma db push`. MySQL utilise un volume Docker externe pour empêcher la
création accidentelle d’un nouveau volume vide à la place des données existantes.

## Accès initial à l'administration

Le premier compte utilisateur doit se connecter avec Firebase afin que son adresse
e-mail vérifiée soit liée à son compte Planner Pro. Depuis la VM, attribuez ensuite
le rôle initial avec le script à usage unique :

```sh
cd /opt/planner-pro
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend \
  node scripts/bootstrap-platform-admin.cjs
```

Le script demande l'adresse e-mail, refuse les comptes non vérifiés par Firebase et
refuse de s'exécuter si un rôle d'administration existe déjà. L'opération est
consignée dans le journal d'audit de la plateforme. Déconnectez-vous puis reconnectez-
vous dans l'application pour afficher l'accès « Administration ».

L'espace admin initial est volontairement en lecture seule : indicateurs agrégés,
état des dépendances et journal des actions administratives. Les actions de gestion
seront ajoutées après la mise en place de leurs contrôles d'accès, d'audit et de
révocation de session.

## Firebase Auth et synchronisation Firestore

Firebase Auth sert à vérifier l’identité. MySQL reste la source de vérité des données
métier. La synchronisation Firestore est une étape de miroir optionnelle, désactivée
par défaut, et couvre actuellement uniquement les mutations de projets et de tâches.
Elle ne migre pas les données existantes, n’inclut pas les autres modèles métier et ne
fournit pas encore de synchronisation hors ligne. Ne pas activer le flag comme une
bascule de source de vérité.

Les règles `firestore.rules` refusent actuellement tous les accès directs depuis les
clients. Le worker serveur utilise le compte de service Firebase Admin, qui contourne
les règles Firestore. Ce refus est volontaire tant qu’une stratégie complète
d’autorisation par espace et une liaison vérifiée entre les utilisateurs Planner Pro et
les UID Firebase ne sont pas déployées. Ne pas ouvrir les règles pour débloquer un test
client.

1. Dans Firebase Console, créer une application Web, activer le fournisseur
   e-mail/mot de passe et autoriser `localhost`.
2. Mettre les paramètres Web (`VITE_FIREBASE_API_KEY`,
   `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_APP_ID`) dans `frontend/.env.local` pour Vite, ou dans le `.env`
   racine pour Docker Compose.
3. Créer un compte de service Firebase dédié et configurer
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` et `FIREBASE_PRIVATE_KEY` dans
   `backend/.env` ou dans l’environnement du backend. La clé privée reste côté
   serveur ; dans un fichier `.env`, représenter ses sauts de ligne avec `\n`.
4. Pour tester le miroir en préproduction uniquement, appliquer la migration outbox,
   vérifier la configuration Admin et définir `FIRESTORE_SYNC_ENABLED=true`. Les
   erreurs de connexion au démarrage sont explicites ; les échecs d’écriture sont
   conservés dans l’outbox avec reprise exponentielle. Contrôler cette file et comparer
   les documents avant toute extension de périmètre. Laisser la valeur à `false` en
   production jusque-là.
5. Mettre à jour le schéma local puis démarrer le backend et le frontend. Le Compose de
   développement applique le modèle Prisma avec `prisma db push`; en production,
   utiliser uniquement la migration versionnée avec `prisma migrate deploy`. Les
   nouveaux comptes doivent confirmer leur adresse e-mail avant d’accéder à Planner
   Pro.

Les anciens comptes continuent à utiliser leur connexion actuelle. Un compte existant
n’est jamais rattaché automatiquement à une identité Firebase ou GitHub de même adresse :
la connexion est refusée (409). Pour ajouter une méthode de connexion, l’utilisateur se
connecte avec sa méthode habituelle, ouvre « Sécurité du compte », confirme son identité
(mot de passe ou connexion récente, plus le code MFA si elle est active), puis lie son
compte Firebase ou GitHub. Une notification est envoyée à chaque liaison ou déliaison.
Planner-Pro ne crée jamais de compte Firebase Authentication à la place de l’utilisateur.

## Préparer le VPS

1. Vérifier que Docker Compose v2 et un reverse proxy TLS sont prêts. Pour
   `planner-pro.boukarou-os.com`, créer aussi un enregistrement A
   `api.planner-pro.boukarou-os.com` vers l'IP du VPS.
2. Copier `.env.production.example` vers `.env.production`. Ce fichier est ignoré par
   Git et doit rester privé. Pour une nouvelle production isolée, utiliser des
   identifiants MySQL dédiés et un nouveau volume vide avec le nom défini dans
   `MYSQL_VOLUME_NAME`. Ne jamais réutiliser le volume de préproduction ou celui
   d'une autre application. Pour migrer des données existantes, suivre plutôt la
   procédure de baseline ci-dessous.
3. Générer un `JWT_SECRET` dédié (par exemple `openssl rand -hex 32`) et une
   `ENCRYPTION_KEY` de 32 caractères (par exemple `openssl rand -base64 24`).
   Les mots de passe MySQL utilisés dans `DATABASE_URL` doivent être encodables sans
   échappement URL ; des valeurs hexadécimales générées conviennent.
4. Régler `FRONTEND_URL`, `CORS_ORIGINS` et `VITE_API_URL` sur les origines HTTPS
   publiques. Pour les valeurs de ce dépôt, le reverse proxy doit diriger
   `planner-pro.boukarou-os.com` vers `127.0.0.1:8080` et
   `api.planner-pro.boukarou-os.com` vers `127.0.0.1:3003`, avec la prise en charge
   WebSocket pour l'API.
   En-têtes de sécurité du frontend (CSP, HSTS) : la CSP est servie en `Report-Only` par
   défaut (`CSP_MODE`) ; procédure de bascule en blocage dans
   `docs/security/en-tetes-frontend.md`. Le reverse proxy ne doit pas supprimer ces en-têtes.
   Adresse IP des clients et limites de débit (S24, S23) : le backend lit l'adresse réelle du
   client dans `X-Forwarded-For` en faisant confiance à `TRUST_PROXY_HOPS` reverse proxys.
   La variable est **obligatoire** dans `.env.production` (le Compose refuse de démarrer sans
   elle, aucune valeur par défaut). Valeur attendue : `1`, soit un seul Nginx d'hôte devant
   `127.0.0.1:3003` (décision d'exploitation du 2026-11-10) ; 2 si un CDN ou un répartiteur de
   charge venait à le précéder. Trop bas, tous les clients partagent un compteur ; trop haut, un
   client peut falsifier son adresse. Vérification après déploiement : une requête portant
   `X-Forwarded-For: 1.2.3.4` ne doit jamais faire apparaître `1.2.3.4` comme adresse du client.
   Le Nginx de l'API doit transmettre l'adresse en l'ajoutant à la chaîne existante :
   `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`.

   Webhook GitHub (S23, S24) : le backend lit au plus **2 Mo** sur cette route (413 au-delà),
   sans analyser le corps tant que la signature n'est pas vérifiée, et répond 429 sans lire le
   corps après 20 refus par minute pour un couple adresse/projet, ou après 100 refus par minute pour
   une adresse tous projets confondus (compteur agrégé : changer d'identifiant de projet ne
   contourne pas la limite). Côté Nginx, limiter le débit de
   cette route et aligner la taille de corps (dans `http { }` puis dans le serveur de l'API) :

   ```nginx
   limit_req_zone $binary_remote_addr zone=gh_webhook:10m rate=30r/m;

   location ~* ^/projects/[^/]+/webhooks/github/?$ {
       limit_req zone=gh_webhook burst=10 nodelay;
       limit_req_status 429;
       client_max_body_size 2m;
       proxy_pass http://127.0.0.1:3003;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       # mêmes en-têtes Host / Upgrade que les autres routes de l'API
   }
   ```

   **Obligatoire avant la mise en production de ce lot (r45-m1)** : `limit_req` et
   `client_max_body_size 2m` doivent être en place et vérifiés. Le `location` est insensible à la
   casse (`~*`) et accepte la barre finale (`/?`), comme le routage d'Express : sans cela, ces
   variantes d'URL échappent à la limite de débit. L'application n'a plus de limite de débit
   propre sur cette route (`@SkipThrottle()`) : hors refus d'authentification, seul Nginx la borne.

   Les adresses de GitHub sont partagées entre tous ses clients : si des livraisons légitimes
   reçoivent des 429 de Nginx, relever `rate` et `burst`. Le défaut de 1 Mo de
   `client_max_body_size` rejetterait sinon les livraisons de plus de 1 Mo avant le backend.

   Comptes verrouillés (S24) : après 5 tentatives en une minute sur un compte, le backend répond
   429 ; au 10e échec cumulé sur 24 h, le compte est verrouillé 15 min (30 min au 20e, doublant
   jusqu'à 24 h). Chaque pose de verrou est journalisée au niveau `warn` (« Verrouillage de compte
   posé », avec une empreinte de 12 caractères, jamais l'adresse). **Déblocage** : les clés Redis
   sont `lockout:login:<sha256 de l'e-mail en minuscules>:{lock,minute,total}` (et
   `lockout:mfa:<sha256 de l'identifiant utilisateur>:...` pour le MFA). Pour débloquer un compte :

   ```sh
   H=$(printf %s 'utilisateur@exemple.com' | sha256sum | cut -d' ' -f1)
   docker compose --env-file .env.production -f docker-compose.prod.yml exec cache \
     redis-cli DEL "lockout:login:$H:lock" "lockout:login:$H:minute" "lockout:login:$H:total"
   ```

   Pour tout débloquer : `redis-cli --scan --pattern 'lockout:*'` puis `DEL` des clés listées
   (ne jamais utiliser `FLUSHALL`, Redis porte aussi les tickets MFA et les clés anti-rejeu).

5. Pour activer Firebase Auth, créer une application Web Firebase, activer le
   fournisseur e-mail/mot de passe et ajouter le domaine de l’application aux
   domaines autorisés. Renseigner les variables `VITE_FIREBASE_*` pour le build
   frontend, puis `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` et
   `FIREBASE_PRIVATE_KEY` depuis un compte de service dédié côté backend. Ne jamais
   placer la clé privée dans le frontend, Git ou un message. Sans ces variables,
   l’authentification Firebase reste désactivée ; MySQL/Prisma demeure la base métier.

Les comptes existants continuent de se connecter avec leur méthode actuelle.
Pour lier un compte existant à Firebase, créer un accès Firebase avec la même adresse,
la vérifier, puis se connecter via l’onglet Firebase. Les projets et données existants
restent attachés au même utilisateur MySQL.

## Pré-production isolée par tunnel SSH

Pour valider une première pré-production sans DNS ni changement du reverse proxy
partagé, utiliser un nouveau projet Compose et un volume MySQL dédié. Configurer
`FRONTEND_URL` et `CORS_ORIGINS` à `http://localhost:18080`, et
`VITE_API_URL` à `http://localhost:13003`. Les ports publiés par Compose restent
liés à `127.0.0.1` sur le VPS. Dans `.env.production`, définir
`FRONTEND_HOST_PORT=18080` et `BACKEND_HOST_PORT=13003` pour garder cette stack
isolée des ports de production ; MySQL et Redis ne publient aucun port sur l’hôte, et
ne sont joignables que depuis le réseau Docker isolé de cette stack.

Créer le volume externe unique une seule fois, puis lancer uniquement le Compose de
production depuis son répertoire isolé. Ne pas exécuter `docker compose down` depuis
le dossier d’un autre projet. Depuis le poste de test, ouvrir le tunnel :

```sh
ssh -i /path/to/ssh-key \
  -L 18080:127.0.0.1:18080 \
  -L 13003:127.0.0.1:13003 \
  ubuntu@<VPS>
```

Ouvrir ensuite `http://localhost:18080`. Firebase Auth autorise déjà `localhost` ;
aucun domaine ni changement Nginx n’est requis pour cette validation. Cette phase
utilise une base MySQL neuve et isolée, sans toucher aux bases des autres stacks.

## Basculer une base existante créée avec `prisma db push`

La migration versionnée est une baseline complète du schéma actuel. Sur la base
existante, il faut l’enregistrer comme déjà appliquée avant le premier démarrage de
production ; ne pas exécuter sa création sur des tables existantes.

1. Faire une sauvegarde MySQL vérifiée et relever le nom du volume. Ne jamais utiliser
   `docker compose down -v`.
2. Construire l’image backend de la nouvelle version :

   ```sh
   docker compose --env-file .env.production -f docker-compose.prod.yml build backend
   ```

3. Tant que l’ancien service MySQL publie son port 3306, comparer son schéma au modèle
   versionné. La commande est en lecture seule ; un écart ou une erreur impose d’arrêter
   la procédure et d’examiner le schéma avant toute résolution :

   ```sh
   docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps \
     -e DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@host.docker.internal:3306/${MYSQL_DATABASE}" \
     backend pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code
   ```

   Avec le fichier d’environnement de Compose, les variables sont interpolées par
   Compose. La commande doit indiquer qu’aucune différence n’a été détectée.

4. Après validation de la sauvegarde et du schéma sans différence, marquer la baseline
   comme appliquée :

   ```sh
   docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps \
     -e DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@host.docker.internal:3306/${MYSQL_DATABASE}" \
     backend pnpm exec prisma migrate resolve --applied 20260527085855_init_production
   ```

5. Arrêter l’ancienne stack sans supprimer son volume, puis démarrer la stack de
   production :

   ```sh
   docker compose down
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
   ```

   Cette stack réutilise le volume déclaré dans `MYSQL_VOLUME_NAME`. Vérifier les logs
   du backend avant d’ouvrir le trafic.

## TLS MySQL (obligatoire)

Depuis le correctif de sécurité S4, toutes les connexions à MySQL sont chiffrées et
vérifiées :

- MySQL démarre avec `--require-secure-transport=ON` et refuse les connexions TCP en clair ;
- le backend (`DATABASE_SSL=true`, `DATABASE_SSL_CA=/run/secrets/mysql-ca.pem`) vérifie le
  certificat du serveur ; il refuse de démarrer en production sans `DATABASE_SSL=true` ;
- `wait-for-db.js` et `prisma migrate deploy` utilisent la même AC (la configuration
  Prisma ajoute `sslaccept=strict` et `sslcert` au DSN de la CLI).

### Première installation

Sur l'hôte, depuis la racine du dépôt, **avant** le premier `docker compose up` :

```bash
ops/mysql-tls/generate-certs.sh            # écrit dans secrets/mysql/ (ignoré par Git)
```

Le script produit `ca.pem` (AC publique, montée dans `db` et `backend`), `ca-key.pem`
(clé de l'AC, montée nulle part : à sauvegarder hors ligne puis à retirer de l'hôte si
possible), `server-cert.pem` (SAN `DNS:db`) et `server-key.pem` (droits `600`, attribuée à
l'utilisateur `mysql` de l'image via un conteneur jetable : aucun `sudo` requis). Il faut
que Docker soit utilisable par l'utilisateur qui lance le script.

### Vérification après démarrage

```bash
# Chiffrement effectif depuis le backend (doit afficher un chiffrement non vide)
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend \
  node -e "const m=require('mariadb');const {buildMariaDbOptions}=require('./dist/prisma/prisma.service');m.createConnection(buildMariaDbOptions()).then(async c=>{console.log(await c.query(\"SHOW SESSION STATUS LIKE 'Ssl_cipher'\"));await c.end()})"

# Refus des connexions en clair (doit échouer avec « insecure transport are prohibited »)
docker compose -f docker-compose.prod.yml --env-file .env.production exec db \
  sh -c 'mysql --ssl-mode=DISABLED -h 127.0.0.1 -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "SELECT 1"'
```

### Rotation

Le certificat serveur est valable 825 jours (`MYSQL_TLS_DAYS`), l'AC 3650 jours
(`MYSQL_TLS_CA_DAYS`). Pour renouveler le certificat serveur en conservant l'AC, relancer
`ops/mysql-tls/generate-certs.sh`, puis redémarrer `db` et `backend`. Pour remplacer aussi
l'AC (compromission ou expiration), utiliser `ROTATE_CA=1 ops/mysql-tls/generate-certs.sh`,
puis redémarrer `db` et `backend` ensemble : l'ancienne AC n'est plus acceptée.

La clé publique RSA épinglée (`DATABASE_RSA_PUBLIC_KEY`) n'est pas autorisée en production :
elle protège le mot de passe mais ne chiffre pas le trafic (développement et staging seulement).

## Nouvelle base vide

Créer d’abord le volume nommé dans `MYSQL_VOLUME_NAME`, puis lancer la commande de
démarrage ci-dessus. `prisma migrate deploy` créera le schéma depuis la baseline avant
de démarrer le backend.

## Déploiements suivants

Les changements de schéma doivent être livrés sous forme de nouvelles migrations
Prisma. Le démarrage exécute `prisma migrate deploy` avant l’API ; il n’altère jamais
le schéma par introspection ou synchronisation implicite. Sauvegarder MySQL avant
chaque changement de schéma et contrôler les logs après le redémarrage.

## Arrêt propre du backend

Le point d'entrée (`backend/src/main.ts`, `installShutdownSignals`) traite `SIGTERM` et `SIGINT` :

- `app.close()` cesse d'accepter des connexions, ferme les connexions inactives et **attend la fin
  des requêtes en cours**, puis exécute les crochets de destruction (Prisma, Redis, adaptateur
  Socket.IO) et le processus sort en **code 0**. Un arrêt sans requête bloquée dure moins de 3 s.
- Une requête encore en vol au bout de **8 s** n'est plus attendue : le processus sort en **code 1**
  et la requête est coupée. Un échec de `close()` donne aussi le code 1.
- La fermeture de chaque client Redis (`quit()`) est bornée à 2 s, puis la connexion est coupée de
  force : une panne de Redis ne bloque pas l'arrêt.
- Les clients WebSocket sont déconnectés et se reconnectent d'eux-mêmes.
- Un second signal pendant l'arrêt est ignoré (un seul `close()`).

Exigences d'exploitation :

- **`stop_grace_period` du service backend supérieur à 8 s.** `docker-compose.prod.yml` le déclare
  explicitement à `15s` (r58-a1) : ne pas le réduire, sinon `docker stop` finit en SIGKILL (137)
  avant le filet de 8 s. Vérifier après déploiement :
  `docker inspect -f '{{.Config.StopTimeout}}' <conteneur>` renvoie `15`.
- Ne pas appeler `app.enableShutdownHooks()` en plus : NestJS se renverrait le signal (code 143) et
  un second `close()` s'ajouterait.
- `init: true` n'est pas nécessaire (Node installe lui-même le gestionnaire de signal).
- Garder `restart: unless-stopped` : un code 0 ou 1 de sortie est suivi d'un redémarrage, sauf arrêt
  demandé par `docker stop`. Avec `on-failure`, un code 0 ne redémarrerait pas.
- Contrôle après un déploiement : `docker compose stop backend` en moins de 3 s et
  `docker inspect -f '{{.State.ExitCode}}' <conteneur>` renvoie `0` ; les journaux contiennent
  « SIGTERM reçu : arrêt en cours. ». Une sortie en 137 ou en code 1 est un signal d'alarme
  (requête bloquante ou Redis).

## Sauvegardes de production

Les sauvegardes locales protègent contre certaines erreurs logiques, mais pas contre
la perte de la VM ou de son disque. Copier régulièrement les sauvegardes chiffrées
vers un stockage hors VM avec accès dédié et rétention indépendante.

1. Installer `gpg`, `gzip` et `flock` sur l’hôte.
2. Créer un secret de chiffrement dédié, distinct de tous les secrets applicatifs,
   puis le conserver dans un gestionnaire de secrets et sur un support de reprise
   contrôlé. Ne pas le mettre dans le dépôt, `.env.production` ou le même disque que
   les sauvegardes :

   ```sh
   sudo install -d -m 700 /etc/planner-pro
   sudo sh -c 'umask 077; openssl rand -hex 32 > /etc/planner-pro/backup-passphrase'
   sudo chmod 600 /etc/planner-pro/backup-passphrase
   ```

3. Installer le script et les unités systemd du dépôt :

   ```sh
   sudo install -o root -g root -m 700 scripts/backup-production.sh \
     /opt/planner-pro/scripts/backup-production.sh
   sudo install -o root -g root -m 600 ops/systemd/planner-pro-backup.service \
     /etc/systemd/system/planner-pro-backup.service
   sudo install -o root -g root -m 644 ops/systemd/planner-pro-backup.timer \
     /etc/systemd/system/planner-pro-backup.timer
   sudo install -d -o root -g root -m 700 /var/backups/planner-pro
   sudo systemctl daemon-reload
   sudo systemctl enable --now planner-pro-backup.timer
   ```

4. Lancer une première sauvegarde, puis vérifier son état et le contenu chiffré :

   ```sh
   sudo systemctl start planner-pro-backup.service
   sudo systemctl status planner-pro-backup.service
   sudo systemctl list-timers planner-pro-backup.timer
   sudo find /var/backups/planner-pro -maxdepth 1 -type f -printf '%f %s bytes\n'
   ```

   Le script effectue un dump InnoDB cohérent avec `--single-transaction`, chiffre
   avec GPG/AES-256, vérifie le déchiffrement et l’intégrité gzip avant de publier
   atomiquement le fichier, puis supprime les sauvegardes locales de plus de 30 jours.
   Les fichiers sont privés au compte root (`0700` pour le répertoire, `0600` pour
   le fichier). Les sauvegardes échouées ne sont jamais considérées comme valides.

5. Restaurer périodiquement une sauvegarde récente dans un MySQL isolé, sans port
   publié et sans volume de production, puis contrôler les migrations et un échantillon
   de données métier. Tester aussi la procédure avec une clé de chiffrement récupérée
   depuis le support de reprise.

6. Transférer les fichiers `.sql.gz.gpg` vers un stockage chiffré hors de la VM et
   surveiller la réussite des transferts. La rétention locale de 30 jours ne remplace
   pas une copie hors site ni un test de restauration.

## Connexion simulée (développement uniquement)

La route `POST /auth/mock/login` (compte de démonstration) n'est enregistrée que si `NODE_ENV=development` **et** `ENABLE_DEV_AUTH=true`. Dans tous les autres cas (production, préproduction, `NODE_ENV` absent), elle n'existe pas (404). Ne jamais définir `ENABLE_DEV_AUTH` en production. Le build frontend de production ne contient plus ni la route ni le formulaire de démonstration.
