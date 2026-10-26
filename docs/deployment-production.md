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

Les anciens comptes continuent à utiliser leur connexion actuelle. Pour les lier sans
perdre leurs données, s’inscrire dans Firebase avec la même adresse e-mail, confirmer
cette adresse, puis se connecter avec l’onglet Firebase. Le backend associe alors le
UID Firebase au même compte MySQL.

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

## Nouvelle base vide

Créer d’abord le volume nommé dans `MYSQL_VOLUME_NAME`, puis lancer la commande de
démarrage ci-dessus. `prisma migrate deploy` créera le schéma depuis la baseline avant
de démarrer le backend.

## Déploiements suivants

Les changements de schéma doivent être livrés sous forme de nouvelles migrations
Prisma. Le démarrage exécute `prisma migrate deploy` avant l’API ; il n’altère jamais
le schéma par introspection ou synchronisation implicite. Sauvegarder MySQL avant
chaque changement de schéma et contrôler les logs après le redémarrage.

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
