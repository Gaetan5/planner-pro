# Runbook : reprise des données compromises de la Phase 0 (constat S28)

| Champ | Valeur |
| --- | --- |
| Constats couverts | S28 (effets en base de S1, S2 et S5) |
| Auteur | senior-fixer |
| Public | Exploitant de la production, avec un second relecteur pour chaque `--apply` |
| Prérequis | Correctifs de la Phase 0 déployés (code et migrations) ; accès en lecture/écriture à MySQL en TLS |

Les correctifs S1, S2 et S5 empêchent de nouvelles exploitations, mais laissent en base les **effets** des exploitations passées. Ce runbook décrit leur reprise. **Aucune étape n'est automatique** : chaque script tourne d'abord en mode rapport (aucune écriture), puis seulement après relecture avec `--apply`.

> Les rapports CSV contiennent des adresses e-mail : ils sont écrits avec les droits `600` dans `backend/reprise-phase0/` (ignoré par Git). Ne pas les transmettre par messagerie ; les supprimer à la clôture de l'incident.

## 0. Ordre d'exécution

| Étape | Action | Écrit en base ? |
| --- | --- | --- |
| 1 | Sauvegarde vérifiée de MySQL | Non |
| 2 | Déploiement des correctifs et des migrations Phase 0 (`prisma migrate deploy`) | Oui (migrations) |
| 3 | Export des requêtes de revue de la section 3 (**avant** tout `--apply`) | Non |
| 4 | Scripts en mode rapport (sections 1 et 2) | Non |
| 5 | Relecture des CSV par deux personnes | Non |
| 6 | Scripts avec `--apply` | Oui |
| 7 | Seconde exécution avec `--apply` : doit annoncer 0 modification (idempotence) | Non (attendu) |
| 8 | Contact des titulaires concernés (section 4) | Non |
| 9 | Archivage des CSV `--apply` avec le ticket d'incident (section 5) | Non |

### 1. Sauvegarde

Suivre « Sauvegardes de production » dans `docs/deployment-production.md`, et **vérifier la restauration** dans un MySQL isolé avant de continuer. Conserver l'horodatage de la sauvegarde dans le ticket d'incident.

### 2. Migrations

Les migrations `20261108000000_s2_disable_unimplemented_sso_providers` (désactivation des configurations SAML2 et OIDC_GENERIC) et `20261108000100_s1_scim_provisioned_by_workspace` sont appliquées par la commande de démarrage du backend (`prisma migrate deploy`). Contrôler ensuite :

```sql
SELECT migration_name, finished_at FROM `_prisma_migrations` ORDER BY finished_at DESC LIMIT 3;
SELECT provider, enabled, COUNT(*) FROM `SSOConfiguration` GROUP BY provider, enabled;
```

Aucune configuration `SAML2` ou `OIDC_GENERIC` ne doit rester `enabled = 1`.

## Exécution des scripts

Tous les scripts se lancent depuis `backend/`, avec le même environnement que l'API (`DATABASE_URL`, `DATABASE_SSL=true`, `DATABASE_SSL_CA`, `ENCRYPTION_KEY`, `NODE_ENV=production`). Dans le compose de production, l'environnement du conteneur `backend` convient :

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend \
  pnpm exec tsx scripts/<script>.ts            # mode rapport
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend \
  pnpm exec tsx scripts/<script>.ts --apply    # application, en une transaction
```

Option commune : `--csv=<chemin>` pour choisir le fichier de rapport. Les rapports sont écrits dans le conteneur : les récupérer avec `docker compose cp backend:/home/node/app/backend/reprise-phase0 ./reprise-phase0`.

> `tsx` est une dépendance de développement. Si l'image de production n'en dispose pas, lancer les scripts depuis un poste d'administration (`cd backend && npx tsx --env-file=<fichier d'environnement> scripts/<script>.ts`), en TLS vers la base.

### Section 1 : comptes et memberships du repli SSO générique (S2)

Script : `backend/scripts/cleanup-generic-sso.ts`.

Le callback SSO authentifiait `user@<domaine>` **sans aucune vérification** pour les fournisseurs SAML2 et OIDC_GENERIC (`ssoUid = generic:<domaine>:<code>`). Toute membership obtenue ainsi l'a été sans authentification. Pour chaque compte `ssoUid LIKE 'generic:%'`, le script :

1. supprime ses memberships dans les workspaces dont la configuration SSO est `SAML2` ou `OIDC_GENERIC` ;
2. signale sans la supprimer toute membership `OWNER` (action CSV `MEMBERSHIP_OWNER_CONSERVÉE_À_REVOIR`), à traiter manuellement ;
3. efface `ssoUid` ;
4. suspend le compte s'il n'a ni mot de passe, ni Firebase, ni GitHub, et plus aucune membership.

Points de relecture du CSV :
- `MEMBERSHIP_OWNER_CONSERVÉE_À_REVOIR` : un compte créé par le repli serait propriétaire d'un workspace. Il faut identifier qui a créé ce workspace et pourquoi, puis transférer ou supprimer manuellement.
- Comptes **non suspendus** mais disposant d'un `firebaseUid` ou d'un `githubId` : la liaison automatique par e-mail (S8) a pu donner ce compte à quelqu'un. À croiser avec la section 3.2.

### Section 2 : données du calendrier simulé (S5)

Script : `backend/scripts/cleanup-simulated-calendar.ts`. Il :

1. supprime les intégrations dont le jeton déchiffré commence par `mock-` ;
2. supprime les créneaux des tâches « Synchronisation Calendrier » qui correspondent aux motifs du simulateur (10-12 h ou 14-16 h UTC, durée exacte de 2 h). **Un import réel peut coïncider** avec ces motifs : relire les lignes `CRÉNEAU_SIMULÉ_SUPPRIMÉ` ;
3. réattribue au propriétaire du workspace (`Workspace.ownerId`) les tâches de synchronisation possédées par un utilisateur **non membre** du workspace (créées avec `user.findFirst()`). La mise à jour est conditionnelle sur l'ancien propriétaire. Les colonnes CSV `taskId`, `workspaceId`, `oldUserId` et `newUserId` servent de journal de reprise.

## 3. Requêtes de revue (lecture seule, à exporter AVANT tout `--apply`)

### 3.1 Comptes suspendus globalement

Avant les correctifs, **seul SCIM écrivait `User.isSuspended`** : la console d'administration n'a pas d'action de suspension (`PlatformAuditLog` ne connaît que `USER_ROLE_UPDATED`, `USER_SESSIONS_REVOKED` et `USER_IMPERSONATED`). Tout compte suspendu avant la reprise l'a donc été par une clé SCIM, ou par une modification SQL manuelle. Le script de la section 1 ajoute lui-même des suspensions : exporter cette liste **avant** son `--apply`.

```sql
SELECT u.id, u.email, u.platformRole, u.createdAt,
       (SELECT COUNT(*) FROM `PlatformAuditLog` l WHERE l.targetId = u.id) AS actionsAdmin,
       (SELECT GROUP_CONCAT(DISTINCT m.workspaceId) FROM `Membership` m
         JOIN `SCIMApiKey` k ON k.workspaceId = m.workspaceId
         WHERE m.userId = u.id) AS workspacesAvecCleScim
FROM `User` u
WHERE u.isSuspended = TRUE
ORDER BY u.platformRole IS NULL, u.createdAt;
```

Priorité : les comptes avec `platformRole` (une suspension de SUPER_ADMIN par SCIM était possible), puis ceux qui n'ont aucune membership dans un workspace doté d'une clé SCIM. Dans ce dernier cas, la suspension vient d'un workspace qui a ensuite retiré la membership. Pour réactiver un compte après confirmation du titulaire : `UPDATE User SET isSuspended = FALSE WHERE id = ?` (en transaction, avec trace dans le ticket).

### 3.2 E-mails potentiellement remplacés par SCIM (S1)

L'attaque S1 rattachait un compte **existant** à un workspace par `POST /scim/v2/Users`, puis remplaçait son e-mail par `PUT`. L'attaquant se connectait ensuite par Firebase ou GitHub avec le nouvel e-mail (liaison automatique). Il n'existe ni historique des e-mails ni horodatage de liaison : la requête cible le **motif**, c'est-à-dire un compte plus ancien que sa membership dans un workspace SCIM et désormais lié à Firebase ou GitHub.

```sql
SELECT u.id, u.email, u.createdAt AS compteCree, m.workspaceId, m.createdAt AS membershipCreee,
       u.firebaseUid IS NOT NULL AS lieFirebase, u.githubId IS NOT NULL AS lieGithub,
       u.passwordHash IS NOT NULL AS aMotDePasse
FROM `User` u
JOIN `Membership` m ON m.userId = u.id
WHERE m.workspaceId IN (SELECT DISTINCT workspaceId FROM `SCIMApiKey`)
  AND m.createdAt > u.createdAt
  AND m.role = 'MEMBER'
  AND (u.firebaseUid IS NOT NULL OR u.githubId IS NOT NULL)
ORDER BY m.createdAt;
```

Les faux positifs sont attendus (un utilisateur invité puis provisionné légitimement). Pour chaque ligne, vérifier avec le titulaire que l'e-mail actuel est bien le sien. Comparer aussi avec les journaux d'accès du reverse proxy (`PUT /scim/v2/Users/<id>`), qui sont la seule trace disponible.

### 3.3 Memberships issues du repli SSO

Elles sont listées par le CSV de la section 1. Contrôle croisé :

```sql
SELECT u.id, u.email, m.workspaceId, m.role, s.provider
FROM `User` u
JOIN `Membership` m ON m.userId = u.id
LEFT JOIN `SSOConfiguration` s ON s.workspaceId = m.workspaceId
WHERE u.ssoUid LIKE 'generic:%';
```

## 4. Contact des titulaires

1. Constituer la liste à partir des CSV et des sections 3.1 et 3.2 : comptes suspendus par SCIM, e-mails potentiellement remplacés, memberships OWNER conservées.
2. Contacter chaque titulaire par un **canal indépendant** de l'adresse e-mail enregistrée, puisqu'elle a pu être remplacée : contact connu du client, administrateur du workspace d'origine.
3. Message type : nature de l'incident (défaut corrigé le <date>), données concernées (accès au compte ou appartenance à un espace), actions effectuées (réactivation, retrait d'accès), action demandée (vérifier l'adresse du compte, changer le mot de passe, vérifier les espaces de travail).
4. Tracer chaque contact dans le ticket d'incident (date, canal, réponse). Évaluer avec le DPO l'obligation de notification (RGPD, art. 33 et 34).

## 5. Clôture

- **Conserver le CSV produit par chaque `--apply`** (`cleanup-generic-sso` et `cleanup-simulated-calendar`) avec le ticket d'incident, **pendant toute la durée de rétention des sauvegardes**. Il n'existe pas de mode `--restore` (décision de l'architecte : un rejeu à l'envers réintroduirait des memberships obtenues sans authentification). Voies de retour :
  1. la sauvegarde complète dont la restauration a été testée (étape 1) ;
  2. pour un faux positif isolé, une correction ciblée à partir du CSV, par les parcours normaux : invitation pour recréer une membership, réaffectation par un OWNER pour une tâche.
  
  Les CSV contiennent des adresses e-mail : les stocker dans l'espace du ticket (accès restreint), jamais en pièce jointe d'un message. Ils sont donc exclus de la consigne « supprimer les CSV » ci-dessous, qui ne concerne que les copies de travail.

- Seconde exécution de chaque script avec `--apply` : les compteurs doivent tous être à 0.
- Réexécution des requêtes 3.1 à 3.3 : seuls les cas traités manuellement subsistent.
- Suppression des copies de travail des CSV (`backend/reprise-phase0/`, conteneur et poste d'administration) une fois l'archive du ticket vérifiée, puis clôture du ticket.

## 6. Check-list d'exploitation du premier déploiement TLS (S4)

À faire une fois, lors du premier déploiement de `docker-compose.prod.yml` avec TLS MySQL :

1. **Générer les certificats** : `ops/mysql-tls/generate-certs.sh` (voir `docs/deployment-production.md`, section « TLS MySQL »).
2. **Sortir `ca-key.pem` de l'hôte de production** : la clé privée de l'AC n'est montée nulle part et ne sert qu'à signer un nouveau certificat serveur. La copier vers un coffre hors ligne (gestionnaire de secrets de l'équipe, support chiffré), puis la supprimer de `secrets/mysql/` avec `shred -u secrets/mysql/ca-key.pem` (ou `rm` sur un volume chiffré). Pour une rotation du certificat serveur, la remettre temporairement dans `secrets/mysql/`, relancer `ops/mysql-tls/generate-certs.sh`, puis la retirer de nouveau. Vérifier : `ls secrets/mysql/` ne liste que `ca.pem`, `server-cert.pem` et `server-key.pem`.
3. **Démarrer** : `docker compose -f docker-compose.prod.yml --env-file .env.production up -d`.
4. **Vérifier `prisma migrate deploy` en TLS** : il s'exécute dans la commande de démarrage du backend. Consigner dans le ticket d'exploitation la sortie complète de :

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production logs backend | grep -iE "migration|applied|prisma|MySQL est prêt"
   docker compose -f docker-compose.prod.yml --env-file .env.production exec backend pnpm exec prisma migrate status
   ```

   Résultat attendu : « Database schema is up to date » (ou les migrations de la Phase 0 listées comme appliquées), sans erreur `insecure transport`.
5. **Consigner `Ssl_cipher`** : exécuter la commande de la section « Vérification après démarrage » de `docs/deployment-production.md` et copier la valeur dans le ticket (attendu : un chiffrement non vide, par exemple `TLS_AES_256_GCM_SHA384`). Exécuter aussi le test de refus en clair de cette section (attendu : échec « insecure transport are prohibited »).
6. Ce déploiement applique aussi les migrations `20261108000000` et `20261108000100` : exécuter les contrôles de la section 2 du présent runbook.
