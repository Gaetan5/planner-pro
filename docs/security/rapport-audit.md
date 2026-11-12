# Rapport d'audit de sécurité, d'architecture et de produit : Planner-Pro

| Champ | Valeur |
| --- | --- |
| Auteur | senior-security-architect |
| Date | 2026-10-29 |
| Branche auditée | `security/phase-0` (HEAD `9c0d9bd`) |
| Périmètre | `backend/` (NestJS 10, Prisma 7 / adaptateur MariaDB, MySQL 8, Socket.IO, Redis), `frontend/` (React 18 / Vite), `docker-compose*.yml`, `.github/workflows/ci.yml`, `firestore.rules` |
| Méthode | Revue de code manuelle ligne par ligne, `pnpm audit --prod`, exécution de la suite Jest backend (32 suites, 185 tests, tous verts : **aucun ne couvre les scénarios d'attaque ci-dessous**) |
| Statut | **Source de vérité** pour l'agent `fixeur`. Les identifiants sont stables : ne jamais renuméroter, ajouter les nouveaux constats à la suite. |
| Révision | r60 (2026-11-12) : sous-lot A9-b3 (`jose` 6.2.17, transformateur Jest dédié) VALIDÉ, feu vert de commit, déploiement séparé après A9-b2 observé 24 h, essai IdP réel requis ; aucun nouveau constat ; ouverts A9-b4 (r56-a1), A8, P2. Avant : r59 (2026-11-12) : sous-lot A9-b2 (NestJS 11.2.9, Express 5.2.1, surcharge `body-parser` par majeure ; r58-a1) VALIDÉ, feu vert de commit, déploiement séparé après A9-b0 à A9-b1 observés 24 h ; aucun nouveau constat ; ouverts A9-b3, A9-b4 (r56-a1), A8, P2. Avant : r58 (2026-11-12) : sous-lot A9-b1 (throttler 6, config 4, jwt 11 sur NestJS 10 ; r57-m1, r57-a1, r57-a2) VALIDÉ, feu vert de commit ; ouverts r58-m1 (Prettier du fichier des exceptions d'audit, à corriger avant le commit docs) et r58-a1 ; puis A9-b2 à A9-b4, A8, P2. Avant : r57 (2026-11-12) : sous-lot A9-b0b (arrêt propre O23, test anti-CSRF r56-m1) VALIDÉ, feu vert de commit ; ouverts r57-m1 (tests de garde manquants) avant A9-b2, r57-a1, r57-a2 ; puis A9-b1 à A9-b4, A8, P2. Avant : r56 (2026-11-12) : sous-lot A9-b0 (caractérisation, table des routes, Node 22) VALIDÉ, feu vert de commit ; ouverts r56-m1 et O23 (reclassé Mineur) dans un sous-lot A9-b0b avant A9-b2, r56-a1, r56-a2 ; puis A9-b1 à A9-b4, A8, P2. Avant : r55 (2026-11-11) + « Spécification A9-b (architecte) » (2026-11-11) : lot P7-e (r54-m1, r54-a1) VALIDÉ, ouvert r55-a1. SCIM activable en production après déploiement de ce lot (conditions dans « Revue r55 »). Voir la section « Revue r55 » à la fin. |

> Note de reconstruction : le plan de référence S1–S21 / A1–A9 / P1–P8 n'avait jamais été enregistré. La numérotation ci-dessous a été reconstruite en respectant le découpage par phase. Chaque constat a été **revérifié dans le code actuel** ; les anciens documents (`docs/audit_roadmap_phases.md`, `docs/etat_des_lieux.md`, `docs/manifeste_actions_restantes.md`) contiennent des affirmations fausses, signalées en section 1.3.

---

## 1. Résumé exécutif

### 1.1 Verdict

**État : NON déployable en production multi-tenant.** Le socle (Argon2id, AES-256-GCM, fail-fast des secrets, Helmet sur l'API, ValidationPipe global) est sain, mais les fonctionnalités « entreprise » ajoutées récemment (SCIM, SSO, MFA, console admin, invitations externes) ont été livrées sans modèle de menace. Plusieurs chaînes permettent à **n'importe quel utilisateur inscrit** de prendre le contrôle du compte d'un autre tenant ou de s'authentifier sans identifiants :

1. **S1 (SCIM)** : tout utilisateur est OWNER de son espace d'onboarding, peut donc créer une clé SCIM, rattacher la victime par e-mail puis modifier son e-mail ou la suspendre **globalement**.
2. **S2 (SSO fallback)** : pour un fournisseur `SAML2`/`OIDC_GENERIC`, le callback authentifie `user@domaine` **sans aucune vérification**.
3. **S10 (SSO OIDC)** : l'`id_token` n'est pas validé et la liaison se fait par e-mail non vérifié (variante « nOAuth »), ce qui permet une prise de contrôle de compte arbitraire.
4. **S3 (ticket MFA)** : le ticket MFA est accepté comme jeton d'accès, ce qui contourne entièrement le MFA.

Risque principal : **prise de contrôle de comptes inter-tenants (ATO) et contournement d'authentification.** Les Phases 0 à 2 sont bloquantes avant toute mise en production.

### 1.2 Synthèse chiffrée

| Sévérité | Sécurité (S) | Architecture (A) | Produit (P) | Total |
| --- | --- | --- | --- | --- |
| Critique | 4 (S1, S2, S3, S10) | 0 | 0 | **4** |
| Majeur | 17 | 7 | 6 | **30** |
| Mineur | 7 | 2 | 2 | **11** |
| **Total** | **28** | **9** | **8** | **45** |

| Phase | Constats |
| --- | --- |
| Phase 0 (urgences) | S1, S2, S3, S4, S5, S28, P1, P3 (+ S14 étape 1 et S18 étape 0 avancées) |
| Phase 1 (authentification, sessions) | S6, S7, S8, S9, S27, A3, P6 |
| Phase 2 (SSO/SCIM) | S10, S11 |
| Phase 3 (autorisation, IDOR, temps réel) | S12, S13, S14, S15, S16, A1, A2, A4 |
| Phase 4 (invitations, console admin) | S17, S18, P4 |
| Phase 5 (durcissement) | S19, S20, S21, S22, S23, S24, S25, S26, A5, A6, A7, P5, P8 |
| Phase 6 (audit log, e2e, CI) | A8, A9, P2, P7 |

### 1.3 Éléments déjà corrigés (vérifiés) et affirmations erronées des anciens documents

| Sujet | Statut vérifié | Preuve |
| --- | --- | --- |
| Fail-fast `JWT_SECRET` | **CORRIGÉ** | `backend/src/auth/auth.module.ts:21-29` |
| Fail-fast et format `ENCRYPTION_KEY`, AES-256-GCM | **CORRIGÉ** | `backend/src/auth/encryption.util.ts:11-63` |
| Argon2id et migration paresseuse PBKDF2 | **CORRIGÉ** | `encryption.util.ts:68-98`, `auth.service.ts:404-416` |
| Helmet sur l'API | **CORRIGÉ** (API seulement, pas le frontend : voir S22) | `backend/src/main.ts:9` |
| CORS obligatoire en production | **CORRIGÉ** | `main.ts:12-21` |
| ValidationPipe global `whitelist` + `forbidNonWhitelisted` | **CORRIGÉ**, mais contourné par les corps typés en interface ou inline (S23) | `main.ts:10` |
| IDOR WebSocket `join-task` | **CORRIGÉ** (`typing` et les rooms workspace restent ouverts : S16) | `tracking.gateway.ts:152-189` |
| Jetons d'invitation et clés SCIM hachés SHA-256, affichés une seule fois | **CORRIGÉ** | `invitations.service.ts:21-23,74-75`, `scim.service.ts:279-280` |
| Adaptateur Redis Socket.IO | **CORRIGÉ** | `tracking.gateway.ts:43-56` |
| Secrets obligatoires dans le compose de production, backend lié à 127.0.0.1 | **CORRIGÉ** | `docker-compose.prod.yml` |
| « Stockage du token en cookie httpOnly : TERMINÉ » (`audit_roadmap_phases.md`, Sprint 0 §3) | **FAUX** : le JWT est renvoyé dans le corps puis stocké dans `localStorage` et envoyé en `Bearer` | `auth.controller.ts:37,52,117` ; `frontend/src/context/AppContext.tsx:818-822,520-526` |
| « Rate limiting auth : TERMINÉ » | **PARTIEL** : inefficace derrière le reverse proxy et en multi-instance (S24) | `app.module.ts:21-26`, `main.ts` (pas de `trust proxy`) |
| « Synchronisation réelle iCal/OAuth (Phase 7) » | **FAUX en partie** : un simulateur injecte de faux événements et de fausses plages en base (S5/P1) | `calendar-sync.service.ts:240-247,783-834` |

---

## 2. Échelle et conventions

- **Sévérité** : Critique (CVSS ≥ 9.0, ou contournement complet d'un contrôle d'authentification) ; Majeur (impact réel inter-tenant, ATO ou intégrité) ; Mineur (impact limité, défense en profondeur) ; Amélioration.
- **CVSS** : v3.1, score de base. Hypothèse de départ : tout visiteur peut s'inscrire (`POST /auth/register`) et devient OWNER de son espace d'onboarding (`auth.service.ts:583-597`), donc **PR:L ≈ quiconque**.
- **Critère d'acceptation** : condition vérifiable par la revue. **Test attendu** : test automatisé à ajouter (unitaire Jest ou e2e `supertest`, dans `backend/tests/`) qui doit échouer avant le correctif et passer après.
- Les chemins sont relatifs à la racine du dépôt ; `backend/src/` est abrégé en `src/` lorsqu'il n'y a pas d'ambiguïté.

---

## 3. Constats de sécurité

### PHASE 0 : urgences

#### S1 : SCIM : modification et suspension globale de comptes d'autres tenants, et révocation de clés inter-workspace

- **Phase** : 0. **Sévérité** : Critique. **CVSS 9.9** `AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H`
- **Localisation** :
  - `src/auth/scim/scim.service.ts:114-171` (`createUser` rattache tout utilisateur existant par e-mail)
  - `scim.service.ts:174-197` (`updateUser` écrit `User.email`, `User.name`, `User.isSuspended` globaux)
  - `scim.service.ts:200-232` (`patchUser` écrit `User.isSuspended` et `User.name` globaux)
  - `scim.service.ts:315-322` (`revokeApiKey` : `where: { id: keyId }` sans `workspaceId`)
  - `scim.service.ts:276-297` + `auth.service.ts:583-597` (tout utilisateur est OWNER, donc peut créer une clé SCIM)
- **Cause** : la clé SCIM est limitée à un workspace, mais les opérations écrivent sur l'entité `User` **globale**. La seule vérification (`getUser`) exige que la cible soit membre du workspace, et `createUser` permet justement de rendre membre n'importe quel utilisateur existant à partir de son e-mail.
- **Scénario** : l'attaquant s'inscrit, crée une clé SCIM sur son espace, appelle `POST /scim/v2/Users {userName: "victime@corp.com"}` (la victime devient MEMBER), puis `PUT /scim/v2/Users/:id {userName: "attaquant@x.com"}`. L'e-mail de la victime est remplacé ; l'attaquant se connecte ensuite via Firebase ou GitHub avec cet e-mail : la liaison automatique par e-mail (`auth.service.ts:66-80`, `213-229`) lui donne le compte. Variante : `PATCH active=false` suspend la victime sur toute la plateforme (y compris un SUPER_ADMIN).
- **Impact** : prise de contrôle de n'importe quel compte, déni de service ciblé, énumération des comptes (réponse 409 ou 201).
- **Remédiation attendue** :
  1. SCIM ne doit **jamais** modifier `User.email` ni `User.isSuspended`. `active=false` doit agir sur l'appartenance au workspace uniquement (supprimer la `Membership` ou ajouter `Membership.suspendedAt`, à documenter). `User.name` ne peut être modifié que si l'utilisateur a été créé par ce workspace (ajouter `User.provisionedByWorkspaceId`, migration Prisma).
  2. `createUser` pour un e-mail **déjà existant** : refuser avec `409` (`scimType: uniqueness`) sauf si le domaine de l'e-mail correspond au domaine **vérifié** du workspace (la vérification de domaine arrive en Phase 2, S10). D'ici là : toujours 409 pour un utilisateur existant.
  3. `revokeApiKey` : `updateMany({ where: { id: keyId, workspaceId, revokedAt: null } })`, puis `404` si `count === 0`.
  4. Mesure immédiate : SCIM désactivé par défaut derrière un drapeau `FEATURE_SCIM_ENABLED` (voir P3). Si le drapeau est faux, les routes `/scim/v2/*` et la gestion des clés répondent `404`.
  5. Les rôles attribués par SCIM restent `MEMBER` (déjà le cas) ; ajouter une entrée d'audit pour chaque opération SCIM (voir A8).
- **Critère d'acceptation** : aucune route SCIM ne peut changer l'e-mail ni l'état de suspension global d'un utilisateur ; une clé du workspace A ne peut ni lire, ni modifier, ni révoquer une ressource du workspace B ; un e-mail existant n'est jamais rattaché silencieusement.
- **Tests attendus** (`backend/tests/e2e/scim.e2e-spec.ts` ou unitaires `scim.service.spec.ts`) :
  - `PUT /scim/v2/Users/:id` avec un nouvel `userName` : `User.email` inchangé en base.
  - `PATCH active=false` : `User.isSuspended` reste `false`, la membership du workspace est retirée ou suspendue, celle d'un autre workspace est intacte.
  - `POST /scim/v2/Users` avec l'e-mail d'un utilisateur existant : 409, aucune membership créée.
  - `DELETE /workspaces/A/scim/keys/<cléDeB>` par un OWNER de A : 404, la clé de B n'est pas révoquée.
  - Avec `FEATURE_SCIM_ENABLED` non défini : `GET /scim/v2/Users` renvoie 404.

- **Statut (r2)** : **VALIDÉ**. Écarts acceptés, qui remplacent les points 1 et 2 de la remédiation ci-dessus :
  - `active=false` **supprime** la `Membership` du workspace (aucun champ `suspendedAt`) ;
  - un compte est visible par le workspace W s'il en est **membre ou s'il a été créé par W** (`User.provisionedByWorkspaceId`), ce qui permet la réactivation par l'IdP ;
  - tout changement d'e-mail est refusé en **400** (`scimType: mutability`) ;
  - la membership OWNER ne peut pas être retirée par SCIM.
  
  Suites rattachées : S11 (PATCH `emails[...]` à refuser en 400, domaine vérifié pour `createUser`), S8 (pré-occupation de compte), S28 (revue des suspensions et e-mails modifiés avant correctif).

#### S2 : SSO : authentification sans vérification via le fallback « générique » (SAML2 / OIDC_GENERIC)

- **Phase** : 0. **Sévérité** : Critique. **CVSS 9.8** `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`
- **Localisation** : `src/auth/sso/sso.service.ts:201-206` (branche `else`), `sso.service.ts:213-283` (provisionnement JIT et attribution du rôle), `sso.controller.ts:63-72` (callback `@Public`), `sso.dto.ts:26-27` (`SAML2`, `OIDC_GENERIC` acceptés), `workspace.prisma:83-88`.
- **Cause** : pour tout fournisseur autre qu'Azure ou Google, le callback fixe `email = user@<domain>` et accepte **n'importe quel `code`** sans contacter d'IdP ni vérifier d'assertion SAML.
- **Scénario** : `POST /auth/sso/callback {"code":"x","domain":"acme.com"}` sur un domaine configuré en SAML2 renvoie un JWT valide pour `user@acme.com` et une membership dans le workspace d'ACME avec `defaultRole`, qui peut être `ADMIN` voire `OWNER` (voir S10).
- **Impact** : accès non authentifié à tout workspace configuré en SAML2 ou OIDC générique ; prise de contrôle de tout compte `user@<domaine>`.
- **Remédiation attendue** :
  1. Supprimer la branche de fallback. Pour un fournisseur non implémenté, lever `NotImplementedException` (501), **avant** toute recherche ou création d'utilisateur.
  2. `ConfigureSsoDto.provider` : n'accepter que les fournisseurs réellement implémentés (`OIDC_AZURE_AD`, `OIDC_GOOGLE`) tant que SAML/OIDC générique ne sont pas développés (Phase 2), via `@IsIn([...])`.
  3. `getAuthorizationUrl` (`sso.service.ts:110-116`) : supprimer la redirection `entryPoint` pour SAML tant que la validation d'assertion n'existe pas.
  4. Script ou migration : passer `enabled=false` sur toute `SSOConfiguration` existante dont le fournisseur est `SAML2` ou `OIDC_GENERIC`.
  5. SSO derrière `FEATURE_SSO_ENABLED` (voir P3), désactivé par défaut tant que S10 n'est pas corrigé.
- **Critère d'acceptation** : aucun chemin de `handleCallback` n'émet de JWT sans un échange de code réussi auprès d'un IdP réel suivi d'une validation de jeton.
- **Tests attendus** : `sso.service.spec.ts` : config `SAML2` activée et callback avec un code arbitraire : exception, `user.create`/`user.findFirst`/`jwtService.sign` jamais appelés. DTO : `provider: 'SAML2'` donne une erreur 400.

- **Statut (r3)** : **VALIDÉ**. Nettoyage des memberships `generic:%` : S28 (validé).

#### S3 : le ticket MFA est accepté comme jeton d'accès (contournement complet du MFA)

- **Phase** : 0. **Sévérité** : Critique (contournement total d'un contrôle d'authentification). **CVSS 8.1** `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N`
- **Localisation** : émission `src/auth/auth.service.ts:425-429` (`{sub, mfaPending:true}` signé avec le **même secret** que le JWT d'accès) ; acceptation `src/auth/jwt.guard.ts:33-38` (aucun contrôle de `mfaPending` ni du type de jeton) ; WebSocket `tracking.gateway.ts:72`, `notifications.gateway.ts:66`.
- **Cause** : il n'y a pas de séparation des types de jetons. Le guard ne vérifie que la signature et `sub`.
- **Scénario** : avec le mot de passe d'une victime (fuite, réutilisation), `POST /auth/login` renvoie `mfaTicket`. `Authorization: Bearer <mfaTicket>` donne ensuite accès à toutes les API pendant 5 minutes, y compris `POST /auth/mfa/disable` (si l'attaquant obtient un code) et `POST /auth/mfa/setup`, qui écrase le secret (voir S6), d'où une persistance.
- **Impact** : le MFA n'apporte aucune protection.
- **Remédiation attendue** :
  1. Ajouter un claim `typ` sur tous les jetons : `typ: 'access'` pour les jetons de session (centraliser l'émission : A3), `typ: 'mfa_ticket'` plus `aud: 'mfa-challenge'` pour le ticket. Signer le ticket avec une clé distincte (`MFA_TICKET_SECRET` obligatoire en fail-fast, ou clé dérivée par HKDF de `JWT_SECRET` avec un label dédié).
  2. `JwtAuthGuard` **et** les deux gateways WebSocket : rejeter tout jeton dont `typ !== 'access'` ou qui contient `mfaPending`. Factoriser la vérification dans un service unique (`TokenService.verifyAccessToken`) utilisé par HTTP et WS.
  3. `verifyMfaChallenge` : vérifier `typ === 'mfa_ticket'` avec la clé dédiée ; rendre le ticket à usage unique (`jti` stocké dans Redis, TTL 5 min, supprimé au succès) ; limiter à 5 essais par ticket (compteur Redis), puis invalider le ticket.
  4. Les jetons existants sans `typ` sont rejetés, ce qui force une reconnexion (acceptable, à mentionner au changelog).
- **Critère d'acceptation** : un ticket MFA est rejeté (401 ou déconnexion) partout sauf sur `POST /auth/mfa/challenge` ; il ne sert qu'une fois.
- **Tests attendus** :
  - e2e : login d'un compte MFA, puis `GET /projects` avec `Bearer <mfaTicket>` : 401.
  - Gateway : handshake `auth.token = mfaTicket` : `client.disconnect(true)` appelé.
  - Challenge réussi, puis réutilisation du même ticket : 401.
  - Six codes faux sur le même ticket : le sixième renvoie 401 même avec un code valide.
  - Jeton signé sans `typ` : 401.

- **Statut (r3)** : **VALIDÉ** (503 borné à 2 s livré et testé). Historique r2 : À REPRENDRE. Disponibilité : quand Redis est indisponible, le parcours MFA se bloque (client ioredis `maxRetriesPerRequest: null`) au lieu d'échouer proprement. Exigence ajoutée : chaque appel Redis du parcours MFA est borné à 2 s, avec `ServiceUnavailableException` (503) en cas d'erreur ou de dépassement, et aucun jeton ni ticket émis. **Test** : faux Redis qui rejette ou ne répond pas : 503 en moins de 2,5 s, ni `accessToken` ni `mfaTicket`.

#### S4 : connecteur MariaDB vulnérable à l'exécution, échange d'identifiants non sécurisé et DSN root par défaut

- **Phase** : 0. **Sévérité** : Majeur. **CVSS 7.4** `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N`
- **Localisation** :
  - Dépendance : `@prisma/adapter-mariadb@7.8.0` résout **`mariadb@3.4.5`** (`pnpm-lock.yaml`). La dépendance directe `mariadb@^3.5.3` (`backend/package.json`, utilisée seulement par `backend/wait-for-db.js:2`) **n'est pas** celle chargée par Prisma.
  - `pnpm audit --prod` : mariadb < 3.4.6 (GHSA, fuite du mot de passe en clair à un MitM malgré la configuration, transmission en clair) ; < 3.4.7 / < 3.5.4 (injection SQL dans le protocole texte, injection via clés d'objet dans `SET`, exposition de mémoire non initialisée) ; < 3.5.4 (crash par exception non interceptée).
  - `src/prisma/prisma.service.ts:9-10` : DSN par défaut `mysql://root:root_password@localhost:3306/...` si `DATABASE_URL` est absent, **y compris en production**.
  - `prisma.service.ts:18` : `allowPublicKeyRetrieval: true` sans TLS, ce qui permet à un MitM de fournir sa clé publique et d'obtenir le mot de passe.
- **Impact** : interception des identifiants base, injection SQL au niveau du driver, crash du processus.
- **Remédiation attendue** :
  1. Racine `package.json` : `"pnpm": { "overrides": { "mariadb": ">=3.5.4" } }`. Passer la dépendance directe à `^3.5.4`. Régénérer le lockfile.
  2. `PrismaService` : en `NODE_ENV=production`, lever une erreur si `DATABASE_URL` est absent (aucun fallback). Le fallback local n'est autorisé qu'avec `NODE_ENV` dans `development` ou `test` (liste blanche explicite, voir A7).
  3. TLS : ajouter `ssl` piloté par `DATABASE_SSL=true|false` (avec `rejectUnauthorized: true` et `DATABASE_SSL_CA` facultatif). `allowPublicKeyRetrieval` n'est autorisé qu'avec `ssl` désactivé **et** un environnement non productif ; sinon `false`.
- **Critère d'acceptation** : `pnpm why mariadb` ne montre que des versions ≥ 3.5.4 ; `pnpm audit --prod` ne remonte plus d'avis `mariadb` ; le démarrage échoue en production sans `DATABASE_URL`.
- **Tests attendus** : `prisma.service.spec.ts` : (a) `NODE_ENV=production` sans `DATABASE_URL` : `new PrismaService()` lève une erreur ; (b) `NODE_ENV=production` : options de l'adaptateur avec `allowPublicKeyRetrieval === false`. Étape CI (A9) : `pnpm audit --prod --audit-level=high` sans avis `mariadb`.

- **Statut (r3)** : **VALIDÉ** (TLS obligatoire en production, compose, certificats, CLI Prisma sans repli root, override dupliqué). **Vérification d'exploitation au premier déploiement** : conserver la sortie de `prisma migrate deploy` en TLS et `SHOW SESSION STATUS LIKE 'Ssl_cipher'` depuis le backend ; en cas d'échec, rouvrir S4. La preuve `migrate status` en TLS est acceptée pour la validation du code. Historique r2 : À REPRENDRE. Code applicatif conforme (`mariadb` 3.5.4 seul, arrêt au démarrage, TLS et clé épinglée). Compléments exigés :
  1. **TLS obligatoire en production** et modification de `docker-compose.prod.yml` par fixeur :
     - AC privée et certificat serveur (SAN `db`) générés par `ops/mysql-tls/generate-certs.sh` dans `secrets/mysql/` (ignoré par git) ;
     - MySQL avec `--require-secure-transport=ON` ;
     - backend avec `DATABASE_SSL=true` et `DATABASE_SSL_CA` ;
     - DSN TLS aussi pour la CLI Prisma (`migrate deploy`) ;
     - documentation dans `docs/deployment-production.md`.
     
     La clé RSA épinglée n'est tolérée qu'en développement et staging.
  2. **`backend/prisma.config.ts:7`** : supprimer le repli `root:root_password@localhost` hors `development`/`test`, sans casser `prisma generate` au build.
  3. Dupliquer l'override `mariadb` dans `pnpm-workspace.yaml` (le pnpm ≥ 10 ignore `package.json#pnpm.overrides`).
  
  **Critères** : compose de production fonctionnel avec `Ssl_cipher` non vide ; connexion sans TLS refusée ; `migrate deploy` en production sans `DATABASE_URL` en échec explicite, sans viser `localhost` ; build sans `DATABASE_URL` OK.

#### S5 : calendrier simulé actif hors test : fausses données écrites en base, faux jetons OAuth, endpoint de démo public

- **Phase** : 0. **Sévérité** : Majeur. **CVSS 5.4** `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N` (impact d'intégrité métier élevé, voir P1)
- **Localisation** :
  - `src/projects/calendar-sync.service.ts:783-891` (`syncCalendarEvents`) : sans URL ni jeton, ou sans identifiants OAuth, des événements **simulés** (`alice@test.com`, l.830/834) sont **importés en base** comme `TimeBlock` ; la tâche « Synchronisation Calendrier » est créée avec `userId = (await prisma.user.findFirst()).id` (l.850-852), c'est-à-dire **un utilisateur arbitraire, potentiellement d'un autre tenant**. Déclenchable par tout membre, y compris VIEWER (`projects.controller.ts:623-627`).
  - `calendar-sync.service.ts:201-247` : `detectCalendarConflicts` renvoie de faux conflits (« Rendez-vous dentiste ») à l'interface, avec le fallback `alice@test.com` (l.204).
  - `calendar-sync.service.ts:577-578,700` : jetons `mock-access-token-<Math.random>` persistés comme intégration « active » dès que `NODE_ENV !== 'production'` (staging, `NODE_ENV` absent) ou lorsque l'échange échoue hors production ; `getIntegrationsStatus` les affiche `CONNECTED`/`DEMO`.
  - `src/projects/projects.controller.ts:457-509` : `GET /projects/mock-calendar` est `@Public()` et reflète le paramètre `email` sans échappement dans un ICS ou un JSON (injection de contenu).
  - `generateAuthUrl` (l.548, 555) : `client_id` de secours `mock-google-client-id`.
- **Impact** : corruption des plannings (fausses plages, fausses alertes), rattachement d'objets à des utilisateurs étrangers, surface publique inutile, confiance utilisateur détruite.
- **Remédiation attendue** :
  1. Supprimer `getSimulatedEvents` et tous ses appels hors du code de test. Sans source réelle (URL ou OAuth avec identifiants), `detectCalendarConflicts` ignore l'intégration et `syncCalendarEvents` renvoie `{ importedCount: 0, skipped: [{ integrationId, reason: 'NOT_CONFIGURED' }] }`.
  2. Supprimer tous les jetons `mock-*` : si les identifiants OAuth manquent, `handleOAuthCallback` lève `ServiceUnavailableException` **quel que soit `NODE_ENV`** ; `generateAuthUrl` aussi.
  3. La tâche de synchronisation est créée avec `userId = utilisateur appelant` (passer `req.user.id` au service) et jamais avec `user.findFirst()`.
  4. `syncCalendarEvents` et `exportToCalendar` sont réservés aux rôles `OWNER`/`ADMIN`.
  5. Supprimer `GET /projects/mock-calendar` (déplacer la fixture dans `backend/tests/fixtures/`).
  6. Fournir un script de nettoyage (`backend/scripts/cleanup-simulated-calendar.ts`) qui supprime les `TimeBlock` de la tâche « Synchronisation Calendrier » dont les créneaux correspondent aux motifs simulés, et les `Integration` dont le jeton déchiffré commence par `mock-`.
- **Critère d'acceptation** : `grep -rn "mock-\|getSimulatedEvents\|alice@test.com\|mock-calendar" backend/src` ne renvoie rien (hors `*.spec.ts`) ; aucune écriture en base sans source réelle.
- **Tests attendus** : `calendar-sync.service.spec.ts` : (a) intégration sans URL ni jeton : `syncCalendarEvents` renvoie 0 et `timeBlock.create` n'est pas appelé ; (b) identifiants absents et `NODE_ENV=staging` : `handleOAuthCallback` lève une erreur, `integration.upsert` n'est pas appelé ; (c) la tâche créée a `userId === appelant`. e2e : `GET /projects/mock-calendar` renvoie 404 ; un VIEWER sur `POST .../calendar/sync` reçoit 403.

- **Statut (r3)** : **VALIDÉ** (lint corrigé, réattribution livrée dans S28). Historique r2 : exigence ajoutée : le script réattribue automatiquement (avec `--apply`) au `Workspace.ownerId` les tâches de synchronisation dont le propriétaire n'est pas membre du workspace, et les liste en CSV. Suivi dans **S28**.

#### S28 : reprise des données compromises par les failles de la Phase 0
- **Phase** : 0 (complément). **Sévérité** : Majeur. **CVSS 7.1** `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N` (persistance des effets des failles S1, S2 et S5 après correction du code)
- **Constat (r2)** : les correctifs S1, S2 et S5 empêchent les nouvelles exploitations, mais laissent en base les **effets** des exploitations passées :
  - memberships obtenues sans authentification via le repli SSO (`User.ssoUid LIKE 'generic:%'`), et comptes `user@<domaine>` récupérables ensuite par liaison Firebase automatique (S8) ;
  - comptes suspendus globalement ou e-mails remplacés par SCIM avant le correctif, indiscernables d'une action légitime faute d'audit (A8) ;
  - créneaux simulés, intégrations à jetons `mock-*`, tâches « Synchronisation Calendrier » possédées par un utilisateur étranger au workspace (S5).
- **Remédiation attendue** :
  1. `backend/scripts/cleanup-generic-sso.ts`, en mode rapport par défaut, avec `--apply` dans une transaction. Pour chaque `User` dont `ssoUid LIKE 'generic:%'` :
     - supprimer ses `Membership` dans les workspaces dont la `SSOConfiguration.provider` vaut `SAML2` ou `OIDC_GENERIC` (une membership `OWNER` est signalée, pas supprimée) ;
     - mettre `ssoUid = NULL` ;
     - passer `isSuspended = true` si le compte n'a ni `passwordHash`, ni `firebaseUid`, ni `githubId` et plus aucune membership.
     
     Sortie CSV.
  2. `backend/scripts/cleanup-simulated-calendar.ts` : avec `--apply`, réattribuer au `Workspace.ownerId` les tâches de synchronisation dont le `userId` n'est pas membre du workspace du projet (CSV `taskId`, `workspaceId`, ancien et nouveau `userId`).
  3. `docs/security/runbook-reprise-phase0.md` : ordre d'exécution (sauvegarde, migrations, scripts en mode rapport, revue, `--apply`), requêtes de revue en lecture seule pour les comptes `isSuspended = TRUE` (comparaison avec `PlatformAuditLog`) et pour les e-mails potentiellement modifiés (comptes dont `firebaseUid`/`githubId` a été lié après la création d'une membership SCIM), et procédure de contact des titulaires concernés.
- **Critère d'acceptation** : les deux scripts sont idempotents (une seconde exécution avec `--apply` ne modifie rien), n'écrivent rien sans `--apply` et passent le lint.
- **Statut (r3)** : **VALIDÉ** (scripts, CSV, runbook). Décision : **pas de mode `--restore`**. Le retour arrière passe par la sauvegarde dont la restauration a été testée, plus une correction ciblée à partir du CSV via les parcours normaux. Ajouts documentaires au runbook, non bloquants : conserver le CSV `--apply` avec le ticket d'incident ; retirer `ca-key.pem` de l'hôte ; vérifier `migrate deploy` en TLS. **L'exécution des scripts reste une action d'exploitation à décider par l'utilisateur.**
- **Tests attendus** : tests unitaires des fonctions de sélection et de transformation (Prisma simulé) : un utilisateur `generic:` OWNER n'est pas supprimé ; un utilisateur sans aucun identifiant est suspendu ; une tâche dont le propriétaire est membre n'est pas réattribuée ; aucune écriture en mode rapport.

### PHASE 1 : MFA, sessions, contrôles à la connexion, OAuth GitHub

#### S6 : cycle de vie du MFA faible (écrasement du secret, secret en clair, rejeu, pas de codes de secours)

- **Phase** : 1. **Sévérité** : Majeur. **CVSS 6.8** `AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:N`
- **Localisation** : `src/auth/auth.service.ts:457-476` (`setupMfa` écrase `mfaSecret` même si `mfaEnabled=true`, sans réauthentification) ; `auth.service.ts:501-520` (`disableMfa` : un code TOTP suffit, ni mot de passe ni réauthentification) ; `prisma/schema/auth.prisma:11` (`mfaSecret` stocké **en clair**) ; `src/auth/totp.util.ts:100-125` (pas d'anti-rejeu : un même code reste valable environ 90 s) ; aucun code de récupération ; `auth.controller.ts:78-107` (corps sans DTO).
- **Impact** : une session volée (ou le ticket de S3) suffit à remplacer le facteur de la victime ; une fuite de la base expose tous les secrets TOTP.
- **Remédiation attendue** :
  1. `setupMfa` : refuser (409) si `mfaEnabled=true`. Stocker le secret en attente dans `mfaPendingSecret` (nouvelle colonne) et ne le promouvoir dans `mfaSecret` qu'à la confirmation.
  2. Chiffrer `mfaSecret` et `mfaPendingSecret` avec `encrypt()` (AES-GCM), avec une migration des valeurs existantes (script idempotent qui détecte le format `iv:tag:data`).
  3. `disableMfa` et la régénération des codes de secours : exiger code TOTP **et** mot de passe (ou réauthentification de moins de 5 min pour les comptes sans mot de passe).
  4. Anti-rejeu : conserver `mfaLastUsedStep` (entier) et refuser un pas de temps ≤ au dernier utilisé.
  5. Générer 10 codes de récupération à usage unique (hachés en Argon2) à la confirmation et les afficher une seule fois.
  6. DTO `MfaCodeDto` (`@Matches(/^\d{6}$/)`) et `MfaChallengeDto`.
- **Critère d'acceptation** : impossible de changer de facteur sans prouver la possession du facteur actuel et du mot de passe ; aucun secret TOTP en clair en base ; un code ne passe qu'une fois.
- **Tests attendus** : `auth.service.spec.ts` : `setupMfa` avec `mfaEnabled=true` : 409 ; `disableMfa` sans mot de passe : 400 ou 401 ; même code TOTP soumis deux fois dans la fenêtre : le second est refusé ; la valeur persistée de `mfaSecret` correspond à `/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/` ; un code de secours fonctionne une seule fois.

#### S7 : sessions non révocables, jeton exposé au JavaScript, pas de déconnexion serveur

- **Phase** : 1. **Sévérité** : Majeur. **CVSS 7.4** `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N`
- **Localisation** :
  - `src/auth/auth.module.ts:30` : JWT valable **7 jours**, sans `jti`, sans stockage de session.
  - `auth.controller.ts:20-27` (cookie de 1 h) contre `sso.controller.ts:31-38` (cookie de 7 j) : incohérence.
  - Jeton renvoyé dans le corps (`auth.controller.ts:37,52,117`, `sso.service.ts:268-277`, `admin.service.ts:257-267`), puis stocké dans `localStorage` (`frontend/src/context/AppContext.tsx:818-822` et suivantes) et envoyé en `Bearer` (`AppContext.tsx:520-526`).
  - `src/auth/jwt.guard.ts:33-38` : aucune vérification de `isSuspended`, de l'existence de l'utilisateur ou d'une révocation.
  - `src/admin/admin.service.ts:195-226` : « révocation des sessions » = suppression dans `RefreshToken`, une table **jamais alimentée**, donc sans effet (fausse sécurité).
  - Aucun endpoint `POST /auth/logout` ; le `logout` frontend (`AppContext.tsx:528-541`) n'efface pas le cookie httpOnly, qui reste prioritaire (`jwt.guard.ts:46-49`).
- **Impact** : un jeton volé (XSS : S20) reste valable 7 jours ; la suspension SCIM ou admin et la « révocation » ne coupent pas les sessions actives ; la session survit à la déconnexion sur un poste partagé.
- **Remédiation attendue** :
  1. Jeton d'accès court (15 min) avec `jti` et `sid` ; jeton de rafraîchissement opaque (256 bits) stocké **haché** dans `RefreshToken` (le modèle existe), rotation à chaque usage, détection de réutilisation (révocation de toute la famille).
  2. Le guard HTTP et les gateways WS vérifient, via un cache Redis de 60 s maximum, que la session `sid` n'est pas révoquée et que `user.isSuspended === false`.
  3. Cookies uniquement : `accessToken` et `refreshToken` en `httpOnly; Secure; SameSite=Strict` (`Path=/auth/refresh` pour le refresh). **Ne plus renvoyer le jeton dans le corps.** Supprimer `token` du `localStorage` côté frontend et utiliser `credentials: 'include'`. Pour Socket.IO, s'authentifier par cookie au handshake (`withCredentials`).
  4. `POST /auth/logout` : révoque la session et efface les cookies. `revokeUserSessions` (admin) révoque réellement toutes les sessions du compte.
  5. Durée des cookies alignée sur la durée du jeton, sur tous les chemins de connexion (voir A3).
- **Critère d'acceptation** : après logout, suspension ou révocation admin, toute requête HTTP ou WS avec l'ancien jeton échoue en moins de 60 s ; aucun jeton n'est lisible par le JavaScript.
- **Tests attendus** : e2e : login, logout, puis `GET /projects` avec l'ancien cookie : 401 ; login, `PATCH` suspension, puis requête : 401 ; `POST /admin/users/:id/revoke-sessions` : l'ancien jeton est rejeté ; rotation du refresh : le rejeu de l'ancien refresh révoque la famille. Frontend : `grep -n "token:" AppContext.tsx` ne montre plus de stockage du jeton.

#### S8 : contrôles non uniformes à la connexion (MFA et suspension contournés par GitHub, Firebase et SSO)

- **Phase** : 1. **Sévérité** : Majeur. **CVSS 7.4** `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N`
- **Localisation** : `src/auth/auth.service.ts:54-111` (`loginWithFirebase` : ni `isSuspended` ni MFA ; liaison automatique d'un compte existant par e-mail l.70-80) ; `auth.service.ts:153-245` (`loginWithGitHub` : ni `isSuspended` ni MFA) ; `src/auth/sso/sso.service.ts:262-277` (pas de MFA) ; `auth.service.ts:248-277` (`mockLogin`, voir S26).
- **Cause** : chaque fournisseur émet son propre JWT ; les contrôles ne sont implémentés que dans `login()` (l.418-440).
- **Impact** : un compte suspendu ou protégé par MFA reste accessible par un autre fournisseur ; liaison silencieuse d'un compte mot de passe à une identité Firebase.
- **Remédiation attendue** :
  1. Créer `AuthService.completeLogin(user, { method, amr })` (voir A3), seul point d'émission de session. Il applique dans l'ordre : `isSuspended` (403), politique MFA (si `mfaEnabled` et que la méthode n'apporte pas de MFA vérifié, renvoyer `mfaRequired` + ticket), `enforceSSO` du domaine (si un `SSOConfiguration.enforceSSO` correspond au domaine de l'e-mail, refuser mot de passe, GitHub et Firebase), émission de session et audit.
  2. Tous les chemins (`login`, `verifyMfaChallenge`, `loginWithGitHub`, `loginWithFirebase`, `handleCallback` SSO, impersonation) passent par `completeLogin`.
  3. Liaison d'identité externe à un compte existant : jamais automatique ; seulement depuis une session authentifiée (`/auth/firebase/link`, équivalents GitHub et SSO), sinon 409 « compte existant, connectez-vous puis liez ».
  4. (r2, risque résiduel de S1) **Pré-occupation SCIM** : un compte créé par SCIM (`provisionedByWorkspaceId` non nul, sans identifiant propre) ne doit jamais être réclamé par une connexion externe. Le premier rattachement d'identifiant exige une invitation ou un e-mail de vérification envoyé à l'adresse. **Test** : compte provisionné par SCIM puis connexion Firebase avec le même e-mail vérifié : 409, aucune mise à jour de `firebaseUid`.
- **Critère d'acceptation** : la matrice {mot de passe, GitHub, Firebase, SSO} × {suspendu, MFA actif, enforceSSO} donne partout le même comportement.
- **Tests attendus** : tests paramétrés (`it.each`) sur `AuthService` : utilisateur suspendu, chaque méthode : 403 ; MFA actif, chaque méthode : `mfaRequired` sans `accessToken` ; e-mail Firebase vérifié correspondant à un compte existant non lié : 409.

#### S9 : OAuth GitHub : pas de `state` (CSRF de connexion), liaison par e-mail non vérifié, portée excessive

- **Phase** : 1. **Sévérité** : Majeur. **CVSS 6.8** `AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:H/A:N`
- **Localisation** : `frontend/src/components/Login.tsx:54`, `InvitationAcceptance.tsx:57` (pas de `state`, `scope=user,repo`) ; `src/auth/auth.service.ts:153-245` : pas de contrôle `response.ok` (l.173, 192, 201), l'e-mail public `userData.email` est utilisé sans vérification (l.198), `primary` est utilisé sans `verified` (l.208), e-mail fabriqué `${login}@github.planner.pro` (l.209), `upsert` par **e-mail** (l.213) qui rattache et écrase les infos GitHub de tout compte existant ; `auth.controller.ts:34` : `body: { code: string }` sans DTO.
- **Impact** : prise de contrôle d'un compte existant si l'e-mail GitHub n'est pas vérifié ; CSRF de connexion (la victime est connectée au compte de l'attaquant) ; jeton GitHub stocké avec un accès complet en écriture à tous les dépôts privés.
- **Remédiation attendue** :
  1. `state` : `GET /auth/github/authorize` génère un `state` de 32 octets, le stocke dans un cookie `httpOnly; SameSite=Lax` signé (TTL 10 min) et redirige. `POST /auth/github/login {code, state}` exige l'égalité en temps constant puis efface le cookie.
  2. Identité par `githubId` (unique), **pas** par e-mail : rechercher par `githubId` ; s'il est absent, n'utiliser que les e-mails `verified === true` de `/user/emails` ; si un compte existe avec cet e-mail mais sans `githubId`, renvoyer 409 (liaison seulement depuis une session : S8). Supprimer l'e-mail fabriqué (refuser la connexion sans e-mail vérifié).
  3. Vérifier `res.ok` sur les trois appels GitHub.
  4. Portée : `read:user user:email` pour la connexion ; demander `repo` (ou mieux, une GitHub App) uniquement lors de l'action « connecter un dépôt ».
  5. DTO `GithubLoginDto { code: string; state: string }`.
- **Critère d'acceptation** : connexion impossible sans `state` valide ; aucun compte existant n'est rattaché par e-mail lors d'une connexion non authentifiée.
- **Tests attendus** : `auth.service.spec.ts` (fetch mocké) : e-mail primaire `verified:false` : 401 ; compte existant avec le même e-mail sans `githubId` : 409 et aucun `update` ; `state` absent ou différent : 401 ; `tokenResponse.ok === false` : 401.

#### S27 : énumération des comptes et comparaison non constante

- **Phase** : 1. **Sévérité** : Mineur. **CVSS 5.3** `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N`
- **Localisation** : `auth.service.ts:352-354` (`register` : « Cet e-mail est déjà utilisé ») ; `auth.service.ts:400-402` (utilisateur inexistant : réponse immédiate sans hachage, oracle temporel) ; `encryption.util.ts:97` (comparaison PBKDF2 legacy par `===`) ; `invitations.service.ts:177-202` (`checkInvitation` public renvoie l'e-mail invité) ; `sso.service.ts:43-67` (`discover` révèle le nom du workspace pour un domaine).
- **Remédiation attendue** : `register` renvoie une réponse générique (202 « si l'adresse est disponible, un e-mail de confirmation est envoyé », avec vérification de l'e-mail : P6) ; `login` exécute `argon2.verify` sur un hachage factice si l'utilisateur est absent ; `crypto.timingSafeEqual` pour PBKDF2 ; `checkInvitation` masque l'e-mail (`j***@d***.com`) ; `discover` ne renvoie pas `workspaceName`.
- **Critère d'acceptation et tests** : temps de réponse de `login` (utilisateur absent ou présent) dans le même ordre de grandeur (test : `argon2.verify` appelé dans les deux cas) ; `checkInvitation` ne contient pas l'e-mail complet.

### PHASE 2 : SSO / SCIM

#### S10 : SSO OIDC : `id_token` non validé, liaison par e-mail non vérifié (nOAuth), domaine non prouvé, `state` ignoré

- **Phase** : 2 (mitigation **immédiate** en Phase 0 par le drapeau P3). **Sévérité** : Critique. **CVSS 9.6** `AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:N`
- **Localisation** :
  - `src/auth/sso/sso.service.ts:165-171,195-200` : l'`id_token` est décodé en base64 **sans vérifier** la signature, `iss`, `aud`, `exp` ni `nonce`.
  - `sso.service.ts:139,168` : tenant `common` par défaut ; e-mail tiré de `email || preferred_username || upn`, des claims **non vérifiés** et modifiables par l'administrateur d'un tenant Azure tiers. Google : `email_verified` et `hd` non contrôlés.
  - `sso.service.ts:213-246` : `findFirst({ OR: [{ email }, { ssoUid }] })` lie **n'importe quel compte** de la plateforme portant cet e-mail ; aucune vérification que le domaine de l'e-mail correspond à `ssoConfig.domain`.
  - `sso.service.ts:308-358` : tout OWNER ou ADMIN peut revendiquer n'importe quel domaine (premier arrivé), sans preuve DNS ; `defaultRole` peut valoir `OWNER` (`sso.dto.ts:61-63`) ; `clientSecret` stocké en clair (`workspace.prisma:96`).
  - `sso.service.ts:84` et `sso.controller.ts:63-72` : `state` non signé, jamais vérifié au callback ; `redirectUri` fourni par le client (`sso.controller.ts:55-60`, `sso.dto.ts:20-22`).
- **Scénario** : l'attaquant crée un workspace, configure le SSO Azure avec sa propre application et `issuer = son tenant`, crée dans son tenant un utilisateur dont l'attribut mail vaut `pdg@victime.com`, se connecte : le callback trouve le compte `pdg@victime.com` et émet son JWT.
- **Impact** : prise de contrôle de n'importe quel compte de la plateforme ; squat du domaine d'une organisation.
- **Remédiation attendue** :
  1. Validation complète de l'`id_token` avec `jose` (`createRemoteJWKSet` sur le JWKS découvert via `/.well-known/openid-configuration`) : signature, `iss` égal à l'émetteur attendu du tenant **configuré** (interdire `common`/`organizations` : exiger un tenant ID GUID), `aud === clientId`, `exp`/`iat`, `nonce`.
  2. Flux d'autorisation : `state` et `nonce` aléatoires de 32 octets plus PKCE (`code_verifier`), stockés côté serveur (Redis, TTL 10 min) ou dans un cookie signé ; vérifiés et consommés au callback. `redirect_uri` fixé côté serveur (`APP_URL/auth/sso/callback`), jamais fourni par le client.
  3. Identité : clé = `(issuer, sub)` (ou `oid`+`tid` pour Azure) dans `ssoUid`. Liaison à un compte existant par e-mail **uniquement si** le domaine de l'e-mail est égal à `ssoConfig.domain`, que ce domaine est **vérifié** et, côté Google, que `email_verified === true` et `hd === domain`. Sinon 409.
  4. Vérification de domaine : `SSOConfiguration.domainVerifiedAt` et `domainVerificationToken` ; vérification par enregistrement DNS TXT `planner-pro-verification=<token>` ; `enabled` ne peut être vrai que si le domaine est vérifié.
  5. `defaultRole` limité à `MEMBER` ou `VIEWER`. `clientSecret` chiffré avec `encrypt()`.
- **Critère d'acceptation** : un jeton d'un autre tenant, d'une autre audience, expiré ou avec un mauvais nonce est rejeté ; aucun compte hors du domaine vérifié n'est lié ; impossible d'activer le SSO sans preuve DNS.
- **Tests attendus** : `sso.service.spec.ts` avec un JWKS local (paire de clés générée en test) : signature invalide, `iss` différent, `aud` différent, `nonce` différent, `state` inconnu : tous 401 ; e-mail `x@autre.com` sur une config `acme.com` : 409 sans `update` ; `configureWorkspaceSSO({enabled:true})` sans domaine vérifié : 400 ; `defaultRole: 'OWNER'` : 400.

#### S11 : SCIM : durcissement (validation, expiration, conformité)

- **Phase** : 2. **Sévérité** : Mineur. **CVSS 5.4** `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N`
- **Localisation** : `src/auth/scim/scim.dto.ts:1-57` (**interfaces**, donc aucune validation : `ValidationPipe` ignore les types non classe) ; `scim.controller.ts:117-125` (`body: { name: string }`) ; `scim.service.ts:276-297` (clés sans expiration par défaut, `name.trim()` plante si `name` est absent : 500) ; `scim.service.ts:258` (`filter: { supported: true }` alors que le filtrage n'est pas implémenté) ; `scim.service.ts:66-67` (`startIndex`/`count` : `parseInt` sans contrôle de NaN) ; `scim.guard.ts` (pas de limitation de débit spécifique) ; pas d'audit.
- **Remédiation attendue** : DTO classes `class-validator` (`CreateScimUserDto`, `ScimPatchRequestDto` avec `@ValidateNested`, `op` ∈ `add|replace|remove`), `CreateScimKeyDto { name: 1..100 }` ; expiration par défaut de 365 jours ; implémenter `filter=userName eq "..."` ou déclarer `supported:false` ; `ParseIntPipe` borné ; `@Throttle` dédié (par exemple 300/min par clé) ; audit de chaque opération (A8) ; réponses d'erreur au format SCIM (`urn:ietf:params:scim:api:messages:2.0:Error`).
- **Compléments (r2, issus de la revue de S1)** :
  1. `PATCH` sur un chemin `emails[...]` (valeur chaîne ou tableau) dont l'adresse diffère de l'actuelle : **400 `mutability`** (aujourd'hui ignoré silencieusement). **Test** : `{op:'replace', path:'emails[type eq "work"].value', value:'x@y.com'}` donne 400.
  2. **Condition de réactivation de `FEATURE_SCIM_ENABLED`** : `createUser` exige que le domaine de l'e-mail soit égal au domaine **vérifié** (DNS, S10) de la `SSOConfiguration` du workspace, sinon 403 (`scimType: invalidValue`). **Test** : `x@autre.com` sur un workspace `acme.com` vérifié donne 403 ; workspace sans domaine vérifié donne 403.
- **Tests attendus** : corps invalides : 400 ; création de clé sans `name` : 400 (et non 500) ; `ServiceProviderConfig.filter.supported` cohérent avec un test de filtre.

### PHASE 3 : autorisation centralisée, IDOR, temps réel

#### S12 : modèle d'autorisation incohérent : les rôles projet sont contournés par l'appartenance au workspace

- **Phase** : 3. **Sévérité** : Majeur. **CVSS 7.1** `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N`
- **Localisation** : `getProject` exige un rôle projet (`projects.service.ts:233-241`), mais :
  - `projects.service.ts:201-231` (`getProjects`) renvoie **tous** les projets et **toutes** les tâches de tout workspace dont l'utilisateur est membre (y compris VIEWER, ou invité externe « projet » : S17).
  - `comments.service.ts:71,174,384,418,449` : commenter, lister, joindre, supprimer une pièce jointe pour tout membre du workspace, y compris VIEWER, sans rôle projet. `deleteAttachment` est permis à **n'importe quel** membre.
  - `sprint.service.ts:20-35,68-77,131-140,169-170,289-290,325-334` : un VIEWER peut créer, modifier ou supprimer des sprints.
  - `tracking/tracking.service.ts:14-19,137-143` : démarrer un minuteur sur, ou lire les logs de, toute tâche du workspace.
  - `copilot.service.ts:33-60` : alertes sur tous les projets du workspace pour tout membre.
  - `tracking.gateway.ts:76-84`, `notifications.gateway.ts:75-84` : diffusion de toutes les tâches du workspace à tous ses membres (S16).
  - `proactive-scheduler` : `autoScheduleWorkspace` ouvert aux MEMBER (`projects.controller.ts:629-637`) et replanifie tous les projets.
- **Cause** : pas de politique centrale (A2). Chaque service réimplémente son propre `assertWorkspace*`.
- **Impact** : le cloisonnement par projet promis (rôles `CLIENT`/`COMMENTER`, invitation externe) est inexistant ; fuite de données entre projets ; modifications par des VIEWER.
- **Remédiation attendue** :
  1. Définir une **matrice de permissions** unique (fichier `src/authz/permissions.ts`), action → rôles : `project.read`, `task.write`, `comment.write`, `attachment.delete`, `sprint.manage`, `timelog.write`, `workspace.integrations.manage`, etc. Règle : OWNER/ADMIN du workspace = MANAGER implicite ; MEMBER **sans** `ProjectMembership` = pas d'accès au projet (décision produit à confirmer, voir P4 ; l'alternative documentée est « MEMBER = CONTRIBUTOR implicite sur les projets non restreints », mais VIEWER et invité externe ne voient que leurs projets).
  2. `getProjects` filtre par `ProjectPermissionsService.listAccessibleProjectIds(userId)`.
  3. Commentaires et pièces jointes : `assertProjectRole(task.projectId, ['MANAGER','CONTRIBUTOR','COMMENTER'])` pour écrire, rôles de lecture pour lire ; `deleteAttachment` réservé à l'auteur ou au MANAGER (ajouter `Attachment.uploadedById`).
  4. Sprints : `OWNER`/`ADMIN`/`MEMBER` pour gérer, VIEWER en lecture seule.
  5. Tracking, copilot, conflits de calendrier : filtrer sur les projets accessibles.
- **Critère d'acceptation** : un utilisateur avec `ProjectMembership.role = CLIENT` sur le projet P1 ne voit ni ne modifie rien de P2 dans le même workspace, par **aucune** route REST ni WS.
- **Tests attendus** : e2e « matrice RBAC » : fixture workspace W avec P1 et P2, utilisateurs OWNER, MEMBER, VIEWER et CLIENT(P1). Pour chaque route listée, assertion du code attendu (200/403) et du contenu (`GET /projects` du CLIENT ne contient que P1). Ce test doit être table-driven et couvrir toutes les routes de `projects.controller.ts`, `comments.controller.ts` et `tracking.controller.ts`.

#### S13 : IDOR `associateTasksToSprint` : seule la première tâche est vérifiée, puis les tâches étrangères sont diffusées

- **Phase** : 3. **Sévérité** : Majeur. **CVSS 7.1** `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N`
- **Localisation** : `src/projects/sprint.service.ts:216-235` (contrôle sur `taskIds[0]` uniquement, puis `updateMany` sur **tous** les `taskIds`) ; `projects.controller.ts:667-695` (corps `{ taskIds: string[] }` sans DTO ; relit les tâches avec `TASK_INCLUDE` et les **diffuse** dans la room du workspace de la première tâche).
- **Scénario** : `POST /projects/sprints/backlog/tasks {taskIds: [maTâche, tâcheVictime1, ...]}` : les tâches de la victime sont sorties de leur sprint et leur contenu complet (titre, description, assignés et leurs e-mails) est émis vers la room de l'attaquant. Les identifiants de tâches étrangères sont obtenables via S15.
- **Remédiation attendue** :
  1. DTO `AssociateTasksDto { @IsArray() @ArrayMaxSize(200) @IsUUID('4',{each:true}) taskIds }`.
  2. Charger **toutes** les tâches (`findMany({ id: { in } , deletedAt: null }, include: project)`), exiger `tasks.length === taskIds.length`, que toutes appartiennent au **même** workspace, que ce workspace soit celui du sprint (si `sprintId`), et que l'appelant ait `task.write` sur chaque projet (S12). Sinon 403, sans aucune écriture.
  3. Contrôleur : diffuser uniquement les tâches effectivement modifiées, vers la room du workspace vérifié (idéalement via un `RealtimeService` : A4).
- **Critère d'acceptation** : aucune tâche hors du périmètre autorisé n'est modifiée ni diffusée.
- **Tests attendus** : `sprint.service.spec.ts` : `[tâcheA, tâcheB_autreWorkspace]` : 403 et `updateMany` non appelé ; sprint du workspace A avec une tâche du workspace B : 403 ; e2e : la room WS de l'attaquant ne reçoit aucun `task-status-changed` étranger.

#### S14 : IDOR sur les intégrations : `exportToCalendar` utilise une intégration d'un autre workspace ; fuite de jetons chiffrés

- **Phase** : 3. **Sévérité** : Majeur. **CVSS 6.4** `AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N`
- **Localisation** : `src/projects/calendar-sync.service.ts:34-42` (`findUnique({ id: integrationId })` sans `workspaceId`) ; `projects.controller.ts:578-586` (seule l'appartenance au workspace du **chemin** est vérifiée, VIEWER inclus) ; `refreshAccessToken` (l.690) est appelé sur l'intégration étrangère ; `integration.service.ts:37-50` (`listIntegrations` renvoie `accessToken`/`refreshToken` chiffrés à tout membre, VIEWER inclus) ; `projects.controller.ts:554-576` (`toggle`/`delete` appellent le service même si l'intégration est introuvable : code mort trompeur).
- **Impact** : écriture des créneaux de l'attaquant dans l'agenda Google ou Outlook d'un autre client avec ses jetons OAuth ; exposition du texte chiffré des jetons.
- **Remédiation attendue** : toutes les méthodes du service prennent `(workspaceId, integrationId)` et filtrent `where: { id, workspaceId }` (404 sinon) ; `exportToCalendar`, `sync`, `toggle`, `delete` réservés à OWNER/ADMIN ; `listIntegrations` et `getIntegrationsStatus` projettent explicitement les champs (`select`) **sans** `accessToken`, `refreshToken`, `url` (ou URL masquée) ; supprimer les branches `if (!integration) return service.toggle(...)`.
- **Étape 1 avancée en complément de Phase 0 (r2) : VALIDÉE (r3)**. Le reste de S14 demeure en Phase 3, avec en plus le masquage de `url` dans les réponses `create`/`toggle`. `exportToCalendar`, `refreshAccessToken` (appelé depuis l'export) et `syncCalendarEvents` chargent l'intégration avec `where: { id, workspaceId }` (404 sinon) ; `listIntegrations` projette sans `accessToken`/`refreshToken`. Motif : tout utilisateur est OWNER de son espace, donc la restriction OWNER/ADMIN de S5 ne protège pas les jetons OAuth d'autres clients. **Tests** : `exportToCalendar(wsA, integrationDeB)` : 404 et `refreshAccessToken`/`fetch` non appelés ; réponse de `listIntegrations` sans clés de jetons. Le reste de S14 demeure en Phase 3.
- **Tests attendus** : `exportToCalendar(wsA, integrationDeB)` : 404 et `refreshAccessToken` non appelé ; `listIntegrations` : aucune clé `accessToken`/`refreshToken` dans la réponse ; VIEWER sur `/export` : 403.

#### S15 : IDOR IA : analyse de commande, voix et vision sur n'importe quel workspace (énumération des membres et tâches)

- **Phase** : 3. **Sévérité** : Majeur. **CVSS 6.5** `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N`
- **Localisation** : `src/projects/ai.controller.ts:43-51,56-78,124-145` et `src/tracking/tracking.gateway.ts:238-274` (`voice-end`) : aucune vérification d'appartenance ; `src/projects/ai.service.ts:156-175` (`resolveActions` charge tous les membres, e-mails compris, et toutes les tâches du `workspaceId` fourni) ; `analyzeCommand` (l.33-105) renvoie les actions résolues (identifiants de tâches et d'utilisateurs, noms).
- **Impact** : lecture inter-tenant des noms et identifiants de membres et de tâches, qui alimente S13 ; consommation du quota Gemini pour le compte d'autres workspaces.
- **Remédiation attendue** : au début de `analyzeCommand`, `analyzeImageAndResolve`, `transcribeAndAnalyzeVoice` et `executeActions` : `assertWorkspaceAccess(workspaceId, userId, ['OWNER','ADMIN','MEMBER'])` ; si `projectId` est fourni, vérifier qu'il appartient au workspace et que l'appelant a `task.write` ; `resolveActions` restreint aux projets accessibles (S12) ; DTO pour `execute` (`ExecuteAiActionsDto` avec `@ValidateNested`, `@ArrayMaxSize(50)`) ; la diffusion de `ai.controller.ts:94-118` ne cible que le workspace vérifié.
- **Tests attendus** : `ai.service.spec.ts` : utilisateur non membre : 403 et `membership.findMany`/`task.findMany` non appelés ; gateway `voice-end` avec un workspace étranger : `{status:'error'}`.

#### S16 : temps réel (Socket.IO) : rooms workspace trop larges et jamais révoquées, `typing` sans contrôle, DoS mémoire

- **Phase** : 3. **Sévérité** : Majeur. **CVSS 7.1** `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:H`
- **Localisation** :
  - `tracking.gateway.ts:76-84` et `notifications.gateway.ts:75-84` : jonction automatique de `workspace:<id>` pour **tous** les workspaces à la connexion ; tout `task-status-changed` (`projects.controller.ts:369-406`) est reçu par les VIEWER, CLIENT et invités externes, quel que soit le projet. Les rooms ne sont jamais recalculées (une membership retirée garde le flux jusqu'à la déconnexion).
  - `tracking.gateway.ts:204-219` (`typing`) : émission vers `task:<id>` **sans** vérifier que le socket a rejoint la room (usurpation d'indicateur de saisie sur toute tâche).
  - `tracking.gateway.ts:221-236` (`voice-chunk`) : `audioChunks` sans limite de taille ni de nombre, et `@SkipThrottle()` (l.22), ce qui permet d'épuiser la mémoire du processus.
  - `tracking.gateway.ts:72` / `notifications.gateway.ts:66` : `verifyAsync` accepte le ticket MFA (S3) et ne vérifie ni suspension ni révocation (S7).
  - `ai.controller.ts:94-100` : `project-data-updated` peut être émis vers la room de n'importe quel `workspaceId` du corps.
- **Remédiation attendue** :
  1. Rooms par **projet** (`project:<id>`), jointes selon `listAccessibleProjectIds` ; les diffusions de tâches ciblent `project:<projectId>`. Garder `workspace:<id>` uniquement pour des événements non sensibles.
  2. Lors d'un changement de membership ou de rôle (invitations, SCIM, suppression, `removeProjectRole`), appeler `server.in('user:<id>').socketsLeave(...)` ou forcer la reconnexion.
  3. `typing` : exiger `client.rooms.has('task:'+taskId)`.
  4. `voice-chunk` : taille maximale par chunk (64 Ko) et par session (10 Mo) ; au-delà, purge et erreur. Limiter le débit des messages WS (compteur par socket).
  5. Authentification WS via le `TokenService` commun (S3/S7), avec revalidation de session périodique.
- **Tests attendus** : `tracking.gateway.spec.ts` : `typing` sans `join-task` préalable : aucune émission ; `voice-chunk` au-delà de 10 Mo : erreur et buffer vidé ; un CLIENT de P1 ne reçoit pas l'événement d'une tâche de P2 ; après `removeProjectRole`, le socket a quitté `project:<id>`.

### PHASE 4 : invitations, console admin

#### S17 : invitations : lien non lié à l'e-mail, escalade ADMIN vers OWNER, invité « projet » rendu membre du workspace, attribution de rôle inter-tenant

- **Phase** : 4. **Sévérité** : Majeur. **CVSS 7.1** `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N`
- **Localisation** :
  - `src/projects/invitations.service.ts:204-388` (`validateAndAcceptInvitation`) : `invitation.email` n'est **jamais** comparé à `loggedUser.email` ; quiconque détient le lien (e-mail transféré, journaux, proxy) l'accepte.
  - `invitations.service.ts:47-56` et `dto/create-invitation.dto.ts:10-11` : un ADMIN peut créer une invitation `role: OWNER` (escalade de privilège via un second compte).
  - `invitations.service.ts:294-301` : une invitation **à un projet** crée une `Membership` **workspace** avec le rôle de l'invitation (ADMIN possible) ; combiné à S12, l'invité externe voit tout le workspace.
  - `invitations.service.ts:53,71-72` : `durationDays` sans maximum (`@Min(1)` seulement).
  - `invitations.service.ts:215-236` : contrôles de statut hors transaction (double acceptation concurrente).
  - `src/projects/projects.controller.ts:107-120` + `project-permissions.service.ts:39-78` : `assignProjectRole` accepte n'importe quel `targetUserId` de la plateforme (même hors workspace) ; corps sans DTO.
- **Remédiation attendue** :
  1. Invitation nominative (`email` non nul) : accepter seulement si `loggedUser.email.toLowerCase() === invitation.email` (403 sinon, avec un message invitant à changer de compte, comme le prévoit déjà l'UI). Lien anonyme : autorisé uniquement pour un rôle ≤ `MEMBER` et un projet, avec un plafond d'utilisations (champ `maxUses`) ou à usage unique.
  2. Rôle invitable ≤ rôle de l'invitant, et `OWNER` jamais invitable (le transfert de propriété est un flux dédié).
  3. Invitation projet : créer une membership workspace **`GUEST`** (nouveau rôle, ou `VIEWER` sans visibilité implicite des projets : décision P4) plus `ProjectMembership` ; le rôle projet est choisi explicitement (`projectRole` dans le DTO), au lieu d'être déduit du rôle workspace.
  4. `durationDays` : `@Max(30)`.
  5. Acceptation atomique : `updateMany({ where: { id, status: PENDING, expiresAt: { gt: now } }, data: { status: ACCEPTED } })` dans la transaction, avec contrôle de `count === 1`.
  6. `assignProjectRole` : DTO (`@IsUUID targetUserId`, `@IsEnum(ProjectRole) role`) ; la cible doit être membre du workspace du projet ; un MANAGER ne peut pas attribuer `MANAGER` s'il n'est pas OWNER/ADMIN (à confirmer : P4).
- **Tests attendus** : `invitations.service.spec.ts` : invitation pour `a@x.com` acceptée par `b@y.com` : 403 ; ADMIN qui invite en `OWNER` : 403 ; invitation projet acceptée : membership workspace de rôle `GUEST`/`VIEWER`, et `GET /projects` ne renvoie que le projet invité (lien S12) ; deux acceptations concurrentes : une seule réussit ; `assignProjectRole` vers un utilisateur hors workspace : 403.

#### S18 : console admin : escalade PLATFORM_ADMIN vers SUPER_ADMIN, impersonation sans limites, révocation factice

- **Phase** : 4. **Sévérité** : Majeur. **CVSS 6.5** `AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:N`
- **Localisation** : `src/admin/platform-admin.guard.ts:31-33` (tout `platformRole` non nul passe) ; `src/admin/admin.service.ts:143-193` (un PLATFORM_ADMIN peut promouvoir quiconque, lui-même compris, SUPER_ADMIN) ; `admin.service.ts:228-269` (impersonation : jeton de session normal de 7 jours, possible sur un SUPER_ADMIN, claim `impersonatedBy` ignoré par le guard, sans motif ni durée courte, actions non tracées sous l'identité de l'admin) ; `admin.service.ts:195-226` (révocation sans effet : S7) ; `frontend/src/components/AdminConsole.tsx:318-343` (session admin sauvegardée en `sessionStorage`) ; aucune MFA exigée pour les rôles plateforme.
- **Remédiation attendue** :
  0. **(r2, complément de Phase 0) : VALIDÉE (r3)**. Drapeau `FEATURE_IMPERSONATION_ENABLED`, désactivé par défaut, via `config/features.ts` : `POST /admin/users/:id/impersonate` renvoie 404 quand il est faux ; `GET /features` expose `impersonation` ; le bouton est masqué dans `AdminConsole.tsx`. **Tests** : 404 drapeau absent, route servie drapeau à `true` ; test vitest du bouton masqué.
  1. Décorateur `@PlatformRoles(...)` : `updateUserRole` et `impersonate` réservés à `SUPER_ADMIN` ; interdire de modifier son propre rôle ; interdire d'impersonner un utilisateur ayant un `platformRole`.
  2. Impersonation : DTO `{ reason: string (10..500) }` obligatoire ; jeton `typ:'access'` avec `act: { sub: adminId }` (RFC 8693), durée de 15 min, non renouvelable ; le guard propage `req.user.impersonatedBy` ; `logAction`/`PlatformAuditLog` enregistrent l'acteur réel ; certaines actions sont interdites en impersonation (changement de mot de passe/MFA, suppression de workspace, `/admin/*`).
  3. MFA obligatoire pour tout compte avec `platformRole` (refus d'accès à `/admin/*` si `mfaEnabled=false`).
  4. Révocation réelle (S7).
- **Tests attendus** : `admin.service.spec.ts` : PLATFORM_ADMIN qui modifie un rôle : 403 ; impersonation d'un SUPER_ADMIN : 403 ; jeton d'impersonation : `exp - iat ≤ 900` et `act.sub === adminId` ; requête `/admin/overview` avec un jeton d'impersonation : 403.

### PHASE 5 : SSRF, XSS, en-têtes, DTO, rate limiting, webhook, dépendances, code mort

#### S19 : SSRF par les URL d'intégration (flux iCal/JSON et webhooks Slack/Teams)

- **Phase** : 5. **Sévérité** : Majeur. **CVSS 7.7** `AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:N/A:N`
- **Localisation** : `src/projects/integration.service.ts:4-9` (`IntegrationDto` est une **interface**, donc aucune validation) ; `integration.service.ts:20-32` (URL stockée telle quelle) ; `calendar-sync.service.ts:297-304` (`fetch(url)` sans restriction ; le contenu JSON/ICS est analysé et les titres sont **renvoyés** dans les messages de conflit, l.276-287) ; `calendar-sync.service.ts:812-814` ; `integration.service.ts:146-157` (POST vers une URL arbitraire, corps de réponse journalisé). Tout utilisateur est OWNER de son espace et peut donc créer une intégration.
- **Impact** : requêtes vers le réseau interne (`cache:6379`, `db:3306`, `host.docker.internal` déclaré dans le compose, métadonnées cloud `169.254.169.254`), lecture partielle des réponses via les titres d'événements, scan de ports.
- **Remédiation attendue** :
  1. DTO classe `CreateIntegrationDto` : `@IsIn(['SLACK','TEAMS','GOOGLE_CALENDAR','OUTLOOK'])`, `@IsUrl({ protocols:['https'], require_protocol:true, require_tld:true })`, longueur maximale de 2048.
  2. Liste blanche d'hôtes par type : Slack `hooks.slack.com`, Teams `*.webhook.office.com` / `*.logic.azure.com`, calendriers ICS : HTTPS public uniquement.
  3. Module `src/common/safe-fetch.ts` : résolution DNS préalable, refus des IP privées, loopback, link-local, CGNAT, ULA et IPv4-mapped (`ipaddr.js`), connexion épinglée sur l'IP résolue (agent `undici` avec `lookup` personnalisé, contre le rebinding DNS), `redirect: 'manual'` (ou revalidation à chaque saut, 3 au maximum), timeout de 5 s, réponse limitée à 1 Mo, `Content-Type` attendu (`text/calendar`, `application/json`). Utiliser `safeFetch` pour **tous** les fetchs pilotés par une donnée utilisateur.
  4. Ne pas renvoyer ni journaliser le corps de réponse des webhooks.
- **Critère d'acceptation** : aucun appel sortant n'est possible vers une plage privée ou réservée, y compris via redirection ou DNS.
- **Tests attendus** : `safe-fetch.spec.ts` : `http://127.0.0.1`, `http://169.254.169.254`, `http://[::1]`, `http://cache:6379`, un domaine résolvant vers 10.0.0.1 (lookup mocké) et une redirection 302 vers 127.0.0.1 : tous rejetés ; `createIntegration` avec `type: 'FOO'` ou `url: 'http://...'` : 400.

#### S20 : XSS stockée via les pièces jointes et injection HTML dans les e-mails

- **Phase** : 5. **Sévérité** : Majeur. **CVSS 8.7** `AV:N/AC:L/PR:L/UI:R/S:C/C:H/I:H/A:N`
- **Localisation** :
  - Backend : `src/projects/comments.controller.ts:128-141` (`body` inline sans DTO), `dto/create-comment.dto.ts:13-15` (`attachments` non validées : `@IsArray` seulement), `comments.service.ts:366-404` : `fileUrl` arbitraire, `javascript:` compris.
  - Frontend : `frontend/src/components/TaskCommentsPanel.tsx:504,607` : `<a href={att.fileUrl}>`. React 18.3.1 **n'interdit pas** les URL `javascript:` (simple avertissement). Le jeton étant dans `localStorage` (S7), un clic entraîne la prise de contrôle du compte.
  - E-mails : `src/mail/mail.service.ts:54,154` (`workspaceName`, `invitedByName`) et `187,195,278` (`senderName`, `taskTitle`) interpolés **sans échappement** dans le HTML, ce qui permet d'envoyer depuis le domaine Planner-Pro un e-mail d'hameçonnage avec liens ou formulaires injectés.
- **Remédiation attendue** :
  1. DTO `AttachmentDto` (`@ValidateNested({each:true})`, `@ArrayMaxSize(10)`) : `fileUrl` limité à `https:` (URL d'un stockage objet : P5) ou `data:` avec un type MIME en liste blanche (`image/png|jpeg|gif|webp`, `application/pdf`) ; `fileName` ≤ 255, sans `/\\`. Validation identique dans `createAttachmentForTask`.
  2. Frontend : fonction `safeHref(url)` qui n'accepte que `https:`/`data:` (types autorisés) et renvoie `undefined` sinon ; l'appliquer à tout `href` alimenté par des données. Prévoir la montée vers React 19 (blocage natif).
  3. E-mails : fonction `escapeHtml()` appliquée à toute variable interpolée dans le HTML ; sujets nettoyés (pas de CR/LF).
  4. Défense en profondeur : CSP stricte côté frontend (S22).
- **Tests attendus** : backend : `fileUrl: 'javascript:alert(1)'` : 400 ; `mail.service.spec.ts` : `workspaceName = '<a href=x>'` donne `&lt;a href=x&gt;` dans le HTML ; frontend (vitest) : une pièce jointe `javascript:` est rendue sans attribut `href`.

#### S21 : webhook GitHub : secret global partagé, signature calculée sur un JSON re-sérialisé, aucune liaison dépôt-projet

- **Phase** : 5. **Sévérité** : Mineur. **CVSS 4.3** `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N`
- **Localisation** : `src/projects/projects.service.ts:375-395` (HMAC sur `JSON.stringify(payload)` et non sur le corps brut, donc les signatures légitimes échouent ; `return NODE_ENV === 'test'` si le secret est absent) ; `projects.service.ts:408-441` et `tasks.service.ts:530-548` (`closeTaskFromWebhook` ferme **toute** tâche de la plateforme par UUID, sans vérifier `payload.repository.full_name === project.githubRepo`) ; secret unique `GITHUB_WEBHOOK_SECRET` à communiquer à chaque client ; pas d'anti-rejeu (`X-GitHub-Delivery`).
- **Impact** : avec le secret (forcément partagé entre clients), fermeture de tâches de n'importe quel tenant ; fonctionnalité inopérante en pratique.
- **Remédiation attendue** : `NestFactory.create(AppModule, { rawBody: true })` et HMAC sur `req.rawBody` ; secret **par projet** (`Project.githubWebhookSecret` chiffré, généré à la liaison du dépôt) avec route `POST /projects/:id/webhooks/github` ; ne fermer que les tâches de **ce** projet dont le dépôt correspond ; mémoriser `X-GitHub-Delivery` dans Redis (TTL 24 h) pour refuser les rejeux ; supprimer le passe-droit `NODE_ENV === 'test'` (injecter le secret dans les tests).
- **Tests attendus** : signature calculée sur le corps brut avec espaces : acceptée ; tâche d'un autre projet référencée dans un commit : non fermée ; même `X-GitHub-Delivery` deux fois : le second est ignoré.

#### S22 : en-têtes de sécurité absents côté frontend

- **Phase** : 5. **Sévérité** : Mineur. **CVSS 4.7** `AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:N/A:N`
- **Localisation** : `frontend/nginx.prod.conf` : ni CSP, ni HSTS, ni `X-Frame-Options`/`frame-ancestors`, ni `Referrer-Policy`, ni `Permissions-Policy`, ni `X-Content-Type-Options`. Helmet ne protège que les réponses de l'API (`main.ts:9`).
- **Remédiation attendue** : ajouter dans `nginx.prod.conf` (avec `always`) : `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' <API> wss://<API> https://*.googleapis.com https://*.firebaseio.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` (à ajuster aux domaines Firebase réellement utilisés), `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), geolocation=(), microphone=(self)`. Ne pas redéfinir de `add_header` dans le bloc des assets sans répéter les en-têtes (nginx n'hérite pas).
- **Critère et test** : script `scripts/check-headers.sh` (ou test CI avec un conteneur nginx) qui vérifie la présence de chaque en-tête sur `/` et sur un asset `.js`.
- **Complément r41 (r40-a1 ii)** : `Cache-Control: no-store` (et `Pragma: no-cache`) aussi sur `POST /projects/:projectId/webhooks/github/secret`, hors `/auth/*` donc non couverte par l'intercepteur d'O16 : prévoir un motif explicite ou un `@Header` sur la route ; et sur la réponse de `POST /auth/github/sync` (déjà sous `/auth/*`, à vérifier par test). **Test** : ces deux réponses portent `Cache-Control: no-store`.

#### S23 : corps de requête non validés (types inline et interfaces contournant le ValidationPipe)

- **Phase** : 5. **Sévérité** : Mineur. **CVSS 5.3** `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L`
- **Localisation** (liste exhaustive vérifiée) : `auth.controller.ts:34,75,95,104,154` ; `scim.controller.ts:71,82,93,120` ; `projects.controller.ts:110,546` (`IntegrationDto`), `611` (`{provider, code}`), `671` (`{taskIds}`) ; `comments.controller.ts:131` ; `notes.controller.ts` (`{title, content}` sur `POST` et `PUT`) ; `ai.controller.ts:61-64,82-88,129-132` ; paramètre `projects.controller.ts:302-306` (`status` de `DeliverableStatus` non validé) ; paramètres de requête `limit`, `start`, `end` (`parseInt`/`new Date` sans borne).
- **Cause** : `ValidationPipe` ne valide que les classes décorées.
- **Remédiation attendue** : un DTO classe par corps, avec bornes de taille (`@MaxLength`, `@ArrayMaxSize`) ; `ParseUUIDPipe` sur tous les `:id` ; `ParseEnumPipe` pour `:status` ; `ParseIntPipe` + `@Max` pour `limit` ; `json` limité (par exemple `app.useBodyParser('json', { limit: '1mb' })`). Ajouter une règle ESLint (ou un test) qui interdit `@Body()` sur un type non classe.
- **Test attendu** : test « méta » qui parcourt les métadonnées Nest (`Reflect.getMetadata('design:paramtypes', ...)`) de tous les contrôleurs et échoue si un `@Body()` a pour type `Object` ou une interface. Plus des tests 400 ciblés sur les routes sensibles.
- **Complément r41 (r40-a1 iii)** : limite de corps JSON explicite. La valeur par défaut d'Express (100 ko) renvoie 413 aux livraisons GitHub volumineuses (jusqu'à 25 Mo). Prévoir une limite dédiée à la route des livraisons GitHub (valeur choisie et documentée), le défaut restant bas ailleurs. **Test** : une livraison signée de plus de 100 ko mais sous la limite dédiée est acceptée ; au-delà, 413 ; une autre route garde la limite par défaut.

#### S24 : limitation de débit inefficace (proxy, mémoire locale, routes non couvertes)

- **Phase** : 5. **Sévérité** : Mineur. **CVSS 5.3** `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`
- **Localisation** : `src/main.ts` (pas de `app.set('trust proxy', ...)` alors que le backend est derrière un reverse proxy : `docker-compose.prod.yml` lie `127.0.0.1:3003`, donc tous les clients partagent l'IP du proxy, d'où un déni de service global des routes `@Throttle(5/min)` ou, inversement, une protection nulle) ; `app.module.ts:21-26` (stockage en mémoire, inefficace en multi-instance) ; `auth.controller.ts:133-136` (`mock/login` sans `@Throttle` spécifique, voir S26) ; brute-force du code MFA limité par IP mais pas par compte ni par ticket (S3) ; gateways en `@SkipThrottle()`.
- **Remédiation attendue** : `app.getHttpAdapter().getInstance().set('trust proxy', 1)` (nombre de sauts paramétrable par `TRUST_PROXY_HOPS`) ; stockage Redis du throttler (`@nest-lab/throttler-storage-redis` ou équivalent) ; limites **par compte** (clé `email`) sur login et MFA en plus de l'IP ; verrouillage progressif après 10 échecs ; limitation de débit WS (S16).
- **Tests attendus** : e2e avec `X-Forwarded-For` différents : deux IP distinctes ont des compteurs distincts ; six tentatives de login sur le même e-mail depuis six IP : la sixième renvoie 429.
- **Complément r41 (r40-a1 iv)** : la route publique `POST /projects/:projectId/webhooks/github/:deliveryRoute` (livraisons GitHub) subit le throttler global : GitHub peut recevoir des 429 et perdre des livraisons. Prévoir un `@SkipThrottle` dédié (la signature HMAC par projet est le contrôle) ou une limite par `projectId` et non par IP. **Test** : N livraisons signées valides depuis une même IP ne renvoient jamais 429 ; une signature invalide reste limitée.

#### S25 : dépendances vulnérables (hors mariadb, traité en S4)

- **Phase** : 5. **Sévérité** : Majeur. **CVSS 7.5** `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`
- **Constat** (`pnpm audit --prod` du 2026-10-29 : 83 avis, dont 33 élevés) : `multer@2.0.2` (8 DoS, upload IA exposé), `socket.io-parser` < 4.2.7, `engine.io` < 6.6.10, `ws` < 8.21.0 (DoS mémoire WS), `body-parser@1.20.4` < 1.20.9 (DoS), `nodemailer@8.0.10` (ReDoS addressparser, contournement `disableFileAccess`), `lodash@4.17.21` (via `@nestjs/config`, injection de code via `_.template` et pollution de prototype), `mysql2@3.15.3` (via `prisma` CLI : dégradation vers `mysql_clear_password`), `@nestjs/core@10.4.22` (avis modéré, correctif en 11.1.18), `file-type`, `fast-uri`, `hono` (outillage Prisma), et côté frontend `@grpc/grpc-js@1.9.16` via `firebase@11.10.0`.
- **Remédiation attendue** : `overrides` (dans `pnpm-workspace.yaml`, lu par pnpm ≥ 10, et dans `package.json#pnpm`, lu par pnpm 9 : voir S4 r2) pour les correctifs compatibles (`multer>=2.5.0`, `socket.io-parser>=4.2.7`, `engine.io>=6.6.10`, `ws>=8.21.0`, `body-parser>=1.20.9`, `lodash>=4.18.0`, `mysql2>=3.23.1`, `fast-uri>=3.1.9`) ; `nodemailer` en ≥ 10.0.13 ; `firebase` en version corrigée ; planifier la migration NestJS 11 (ticket séparé, A9). La CI échoue sur `high` (A9).
- **Critère d'acceptation** : `pnpm audit --prod --audit-level=high` renvoie un code 0, ou chaque exception restante est justifiée dans `docs/security/audit-exceptions.md` (paquet, raison, date de revue).

#### S26 : code mort et surfaces de démonstration exposées en production

- **Phase** : 5. **Sévérité** : Mineur. **CVSS 5.3** `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`
- **Localisation** : `auth.controller.ts:133-136` + `auth.service.ts:248-277` (`mock/login` : crée un compte sans limite dès que `NODE_ENV !== 'production'`, donc ouvert si `NODE_ENV` est absent ou vaut `staging`) ; `ai.service.ts:45-83` (préfixe `MOCK:`) et `ai.controller.ts:66,133` (`isMock` fourni par le client) ; `tracking.gateway.ts:241` (`isMock`) ; `prisma.service.ts:27-48` (utilisateur `default-user-id` hors production) ; modèle `RefreshToken` inutilisé (S7) ; `backend/tsconfig.tsbuildinfo` versionné ; `backend/firestore-debug.log` présent dans l'arborescence ; `projects.controller.ts:554-576` (branches mortes, S14).
- **Remédiation attendue** : supprimer `mock/login` du code de production (ou l'enregistrer seulement si `ENABLE_DEV_AUTH === 'true'` **et** `NODE_ENV === 'development'`, avec un module chargé conditionnellement) ; supprimer `MOCK:` et `isMock` (le mock passe par l'injection du provider `AI_PROVIDER` en test) ; seed par défaut seulement dans `prisma/seed.ts` ; retirer `tsconfig.tsbuildinfo` et `*.log` de l'index et les ajouter à `.gitignore`.
- **Tests attendus** : e2e avec `NODE_ENV` non défini : `POST /auth/mock/login` renvoie 404 ; `grep -rn "isMock\|'MOCK:'" backend/src` vide hors spec.

---

## 4. Constats d'architecture

| ID | Constat | Phase | Sévérité | Localisation | Impact | Recommandation et critère d'acceptation |
| --- | --- | --- | --- | --- | --- | --- |
| **A1** | Authentification **opt-in** : `JwtAuthGuard` n'est pas global ; chaque contrôleur doit penser à `@UseGuards`. Le décorateur `@Public()` existe mais n'a de sens que sur une classe gardée. | 3 | Majeur | `app.module.ts:41-46` (seul `ThrottlerGuard` est global), `jwt.guard.ts:15-21` | Un nouveau contrôleur est public par défaut (non sécurisé par défaut) | Enregistrer `JwtAuthGuard` en `APP_GUARD` (après `ThrottlerGuard`), annoter explicitement `@Public()` les routes publiques (login, register, firebase/login, sso/discover, sso/callback, invitations/check, webhook, scim avec `ScimAuthGuard`). **Test** : test méta qui énumère toutes les routes (`DiscoveryService`) et compare la liste des routes publiques à une liste blanche figée dans le test. |
| **A2** | Autorisation éclatée : au moins 9 implémentations privées `assertWorkspaceMember/Role/Access` (projects, resources, sprint, comments, milestones, finances, invitations, sso, scim) aux sémantiques divergentes (deletedAt vérifié ou non, rôles), en plus de `ProjectPermissionsService`. | 3 | Majeur | `projects.service.ts:81-107`, `resources.service.ts:13-37`, `sprint.service.ts:20-33`, `comments.service.ts:35-48`, `milestones.service.ts:13-48`, `finances.service.ts:10-29`, `invitations.service.ts:25-45`, `sso.service.ts:368-381`, `scim.service.ts:324-337` | Cause racine de S12 à S15 ; dérive à chaque nouvelle fonctionnalité | Module `src/authz/` : `PolicyService.can(user, action, resource)` et `assert(...)`, matrice déclarative (S12), décorateur `@RequirePermission('task.write', { from: 'param:taskId' })` + guard ; supprimer les assertions privées. **Critère** : `grep -rn "private async assertWorkspace" backend/src` vide ; le test matrice RBAC de S12 passe. |
| **A3** | Identité fragmentée : 6 chemins d'émission de JWT (`login`, `verifyMfaChallenge`, `loginWithGitHub`, `loginWithFirebase`, `mockLogin`, `register`) plus `SsoService` et `AdminService`, chacun avec son `jwtService.sign` et sa propre durée de cookie. | 1 | Majeur | `auth.service.ts:93,232,264,375,426,441,557` ; `sso.service.ts:267` ; `admin.service.ts:244` ; cookies `auth.controller.ts:20-27`, `sso.controller.ts:31-38` | Cause racine de S3, S7 et S8 | `SessionService` unique (`issue`, `refresh`, `revoke`, `verifyAccess`), seul détenteur de `JwtService.sign`, appelé par `AuthService.completeLogin`. **Critère** : `grep -rn "jwtService.sign" backend/src` ne renvoie que `session.service.ts`. |
| **A4** | Deux gateways Socket.IO sur le **même** namespace par défaut, avec la même logique d'authentification et de rooms dupliquée et deux adaptateurs Redis ; diffusion WS codée dans les contrôleurs. | 3 | Mineur | `tracking.gateway.ts:23-96`, `notifications.gateway.ts:16-91` ; diffusions dans `projects.controller.ts:369-406,437-455,519-526,675-693`, `comments.controller.ts:44-63`, `ai.controller.ts:94-118` | Double authentification et double jonction des rooms, incohérences, difficulté à appliquer S16 | Une seule gateway d'authentification (ou un `WsAuthMiddleware` via `server.use`), un `RealtimeService.emitToProject/emitToUser` appelé par les **services** après commit. **Critère** : aucun `trackingGateway.server` dans les contrôleurs. |
| **A5** | Contrôleurs « obèses » avec accès Prisma direct et logique métier (714 lignes dans `projects.controller.ts`), DTO absents et `any` généralisé (`@Req() req: any`). | 5 | Mineur | `projects.controller.ts` (injection de `PrismaService` l.53), `ai.controller.ts:37` | Contrôles de sécurité difficiles à auditer, duplications | Découper par sous-domaine (`TasksController`, `SprintsController`, `IntegrationsController`, `CalendarController`) ; aucun `PrismaService` dans un contrôleur ; `@User()` typé au lieu de `req: any`. **Critère** : `grep -n "PrismaService" backend/src/**/*.controller.ts` vide. |
| **A6** | Miroir Firestore incohérent et inscriptible par les clients : les règles cherchent `membership:<auth.uid>` et `personal-<auth.uid>` (UID Firebase), alors que la synchronisation écrit `membership:<Membership.id>` et `personal-<User.id Prisma>`. Les règles autorisent des écritures clientes (projets, tâches, entités) sur un miroir dont MySQL est la source de vérité. | 5 | Majeur | `firestore.rules:10-24,46-66` ; `firestore-sync.service.ts:270-283` ; `projects.service.ts:322` | Accès Firestore cassé pour les workspaces partagés, ou ouvert à la falsification si les clés venaient à concorder ; données divergentes non ré-importées | Décider : (a) miroir **lecture seule**, avec `allow write: if false` partout, plus des documents `members/{firebaseUid}` écrits par le backend avec la correspondance `User.firebaseUid` ; ou (b) abandonner le miroir. **Test** : `firestore-rules.spec.ts` couvre une écriture client refusée et la lecture d'un membre réel autorisée avec des IDs cohérents. |
| **A7** | Comportements de sécurité **fail-open** conditionnés à `NODE_ENV` (absent signifie mode dev) : mock login, fallback DSN root, mocks calendrier, passe-droit webhook, cookie `secure`, utilisateur seed. | 5 | Majeur | `auth.service.ts:249`, `prisma.service.ts:9-10,28`, `calendar-sync.service.ts:586-588`, `projects.service.ts:377-378`, `auth.controller.ts:23`, `sso.controller.ts:35` | Un déploiement de staging ou un oubli de variable active des portes dérobées | Module `src/config/env.ts` validé au démarrage (zod ou `class-validator`) : `NODE_ENV ∈ {development,test,production}` **obligatoire**, comportements de dev activés par des drapeaux explicites (`ENABLE_DEV_AUTH`) refusés si `NODE_ENV=production`. **Test** : démarrage sans `NODE_ENV` : échec ; `ENABLE_DEV_AUTH=true` avec `NODE_ENV=production` : échec. |
| **A8** | Journal d'audit non fiable : deux tables (`AuditLog`, `PlatformAuditLog`), écriture hors transaction et erreurs avalées (`console.error`), `changes` stocké en `JSON.stringify` dans une colonne `Json` (double encodage), `ipAddress` jamais renseigné, aucun événement d'authentification, SSO, SCIM, MFA, invitation ou intégration. | 6 | Majeur | `project-permissions.service.ts:205-229` ; `auth.prisma:43-55` ; `system.prisma:87-99` | Pas de traçabilité forensique ; répudiation possible | `AuditService.record(tx, event)` **dans** la transaction métier ; schéma unifié (`actorId`, `actAs`/impersonation, `action`, `targetType`, `targetId`, `workspaceId`, `ip`, `userAgent`, `metadata Json`) ; événements obligatoires : login (succès/échec), MFA (setup/confirm/disable/challenge), session révoquée, SSO configuré, clé SCIM créée/révoquée, opérations SCIM, invitation créée/acceptée, changement de rôle, impersonation, intégration créée/supprimée. Table en ajout seul (aucune route de modification). **Test** : chaque action listée produit une ligne (tests paramétrés). |
| **A9** | CI insuffisante pour une branche de sécurité : ne s'exécute que sur `main` (pas sur `security/*`), `pnpm install --no-frozen-lockfile`, Node 18 (EOL) contre Node 20 en Docker, aucun `pnpm audit`, aucun test e2e (le dossier `backend/tests/integration/projects/` est **vide**), aucune vérification de dérive des migrations. | 6 | Majeur | `.github/workflows/ci.yml:2-6,31-35` ; `backend/Dockerfile:1` | Régressions de sécurité non détectées | Déclencheurs `pull_request` sur toutes les branches et `push` sur `main` et `security/**` ; `--frozen-lockfile` ; Node 20 ; jobs `audit` (`pnpm audit --prod --audit-level=high`), `e2e` (MySQL + Redis en services, `prisma migrate deploy` puis `jest --config jest-e2e.json`), `prisma migrate diff --exit-code` ; secret scanning (gitleaks). **Critère** : un PR qui réintroduit S3 (test e2e) fait échouer la CI. **(r3) Montée vers pnpm 10** : `packageManager: pnpm@10.x`, pnpm 10 dans les deux Dockerfiles et dans `pnpm/action-setup`, `--frozen-lockfile` partout, régénération du lockfile, **puis** suppression de `package.json#pnpm.overrides` (seule source : `pnpm-workspace.yaml`). Critère : installation sans avertissement d'override ignoré, `pnpm why mariadb -r` en 3.5.4. |

---

## 5. Constats produit et projet

| ID | Observation | Phase | Sévérité | Risque | Suggestion et critère d'acceptation |
| --- | --- | --- | --- | --- | --- |
| **P1** | La « synchronisation calendrier réelle » est en partie une simulation présentée comme réelle (faux rendez-vous « dentiste », statut `CONNECTED`/`DEMO`, fausses plages importées) ; la roadmap la déclare mature à 75 %. | 0 | Majeur | Perte de confiance, décisions de planification fondées sur de fausses données, fausses alertes copilote | Corriger S5 ; l'UI affiche « Non configuré » au lieu de données simulées ; la roadmap est corrigée. **Critère** : aucun événement simulé visible en production ; `IntegrationsPanel` affiche l'état réel. |
| **P2** | Documentation de pilotage non fiable : `audit_roadmap_phases.md` marque « TERMINÉ » des éléments faux (cookie httpOnly, rate limiting) ; `etat_des_lieux.md` cite « 116 tests » contre 185 aujourd'hui, etc. | 6 | Mineur | Faux sentiment de sécurité, mauvaises priorisations | Ce rapport devient la référence ; ajouter en tête des anciens documents un bandeau « Obsolète : voir docs/security/rapport-audit.md ». **Définition de terminé** : un item de sécurité est « TERMINÉ » seulement avec un test automatisé référencé. |
| **P3** | Fonctionnalités entreprise (SSO, SCIM, console admin, impersonation) livrées sans **kill switch** ni limitation par offre ; tout utilisateur gratuit peut configurer SSO et SCIM. | 0 | Majeur | Exposition immédiate des failles S1, S2, S10 ; périmètre qui dépasse la maturité sécurité | Drapeaux `FEATURE_SSO_ENABLED`, `FEATURE_SCIM_ENABLED` (défaut `false`) lus via la config validée (A7). Désactivés : routes en 404, onglets UI masqués. Activation par workspace seulement si `Workspace.plan = ENTERPRISE` (ou liste blanche admin) après livraison de la Phase 2. **Critère** : avec les drapeaux à `false`, `POST /auth/sso/callback`, `GET /scim/v2/Users` et `POST /workspaces/:id/scim/keys` renvoient 404 (tests e2e). |
| **P4** | La promesse « invitation externe avec RBAC dédié » (commit `4c9571a`) n'est pas tenue : l'invité devient membre du workspace et voit tout (S12, S17). Le modèle de rôles (workspace contre projet) n'est pas spécifié. | 4 | Majeur | Fuite de données client vers des prestataires externes, risque contractuel et RGPD | Rédiger une **matrice de rôles** validée par le PO (`docs/security/matrice-rbac.md`) : rôles workspace (OWNER, ADMIN, MEMBER, VIEWER, GUEST) × rôles projet (MANAGER, CONTRIBUTOR, COMMENTER, CLIENT) × actions. Elle sert de spécification au test matrice de S12. Trancher : un MEMBER voit-il les projets dont il n'est pas membre ? |
| **P5** | Les pièces jointes sont stockées en Data URL base64 dans MySQL (`Attachment.fileUrl @db.Text`) alors que le parseur JSON est limité à 100 Ko par défaut : la fonctionnalité casse au-delà d'environ 70 Ko et alourdit la base. | 5 | Majeur | Fonctionnalité inutilisable, base gonflée, vecteur XSS (S20) | Stockage objet (S3/GCS) avec URL présignées (upload direct, GET présigné à courte durée), antivirus facultatif, taille maximale et liste blanche MIME côté serveur. **Critère** : upload de 10 Mo réussi ; aucun `data:` stocké en base. |
| **P6** | Parcours de compte incomplets : pas de vérification d'e-mail à l'inscription, pas de réinitialisation de mot de passe, pas de codes de récupération MFA, pas de déconnexion serveur ni de liste des sessions. | 1 | Majeur | Comptes verrouillés (support coûteux), inscriptions avec l'e-mail d'un tiers (pré-ATO via liaison Firebase ou GitHub par e-mail) | Livrer avec S6 et S7 : vérification d'e-mail (jeton haché, TTL 24 h), réinitialisation de mot de passe (jeton à usage unique de 30 min, révocation des sessions), codes de récupération, page « Sessions actives ». |
| **P7** | Pas de stratégie de tests de sécurité : 185 tests unitaires verts, mais **aucun** ne couvre un scénario d'abus (IDOR, inter-tenant, contournement d'authentification) ; pas d'e2e. | 6 | Majeur | Les correctifs régresseront | Chaque constat S est livré avec son test d'abus (section « Tests attendus ») ; suite `backend/tests/e2e/security/*.e2e-spec.ts` exécutée en CI (A9). |
| **P8** | Les modes démo (mock login, `MOCK:`, `isMock`, simulateur calendrier) sont mêlés au code produit sans séparation d'environnement. | 5 | Mineur | Confusion fonctionnelle, surface d'attaque (S26) | Instance « démo » séparée avec seed dédié (`prisma/seed.ts`) au lieu de branches conditionnelles dans le code de production. |

---

## 6. Plan d'action priorisé (à suivre par `fixeur`)

Règles d'exécution :
- Respecter l'ordre des phases ; à l'intérieur d'une phase, l'ordre indiqué.
- Une branche ou un commit par constat (`fix(security): S1 ...`), avec les **tests d'abus** listés. Consigner chaque correctif dans `docs/security/journal-corrections.md` avec le statut `CORRIGÉ – À REVOIR`.
- Toute divergence avec la remédiation attendue doit être signalée en `À VALIDER PAR L'ARCHITECTE` avec sa justification.
- Ne pas casser la suite existante : `pnpm --filter backend test` et `pnpm --filter frontend test:run` restent verts.

### Phase 0 : urgences (bloquant ; à livrer avant toute exposition publique)

| Ordre | ID | Action résumée | Effort indicatif |
| --- | --- | --- | --- |
| 0.1 | **P3** | Drapeaux `FEATURE_SSO_ENABLED` / `FEATURE_SCIM_ENABLED` (défaut `false`), routes en 404, UI masquée. Mitigation immédiate de S1, S2 et **S10** | 0,5 j |
| 0.2 | **S3** | Séparation des types de jetons (`typ`), clé de ticket dédiée, rejet par le guard HTTP et les gateways WS, ticket à usage unique avec 5 essais | 1 j |
| 0.3 | **S2** | Suppression du fallback SSO générique, `provider` restreint, désactivation des configurations SAML2/OIDC_GENERIC existantes | 0,5 j |
| 0.4 | **S1** | SCIM : aucune écriture globale sur `User`, 409 sur e-mail existant, suspension limitée à la membership, `revokeApiKey` limité au workspace | 1 j |
| 0.5 | **S4** | Override `mariadb>=3.5.4`, fail-fast `DATABASE_URL` en production, TLS et `allowPublicKeyRetrieval` conditionnels | 0,5 j |
| 0.6 | **S5** | Suppression du simulateur, des jetons mock et de `mock-calendar` ; `userId` de l'appelant ; OWNER/ADMIN ; script de nettoyage des données simulées | 1 j |
| 0.7 | **P1** | UI d'intégrations affichant l'état réel ; mise à jour de la roadmap | 0,5 j |

#### Complément de Phase 0 (r2, après la revue des corrections)
| Ordre | ID | Action | Effort indicatif |
| --- | --- | --- | --- |
| 0.8 | P3, S2, S5 | Corriger les 3 erreurs ESLint introduites (`feature-flags.spec.ts`, `sso.dto.ts`, script hors tsconfig) | 0,1 j |
| 0.9 | **S3** | 503 borné à 2 s si Redis est indisponible dans le parcours MFA | 0,25 j |
| 0.10 | **S4** | TLS MySQL en production (compose, certificats, DSN de la CLI Prisma), `prisma.config.ts` sans repli root, override dans `pnpm-workspace.yaml` | 1 j |
| 0.11 | **S18**, étape 0 | Drapeau `FEATURE_IMPERSONATION_ENABLED` | 0,25 j |
| 0.12 | **S14**, étape 1 | Intégration liée au workspace et projection sans jetons | 0,25 j |
| 0.13 | **S28** | Scripts de reprise et runbook | 1 j |

### Phase 1 : MFA, sessions révocables, contrôles uniformes, OAuth GitHub

Ordre : **A3** (SessionService, prérequis), **S7** (sessions et cookies, avec retrait du `localStorage` côté frontend), **S8** (`completeLogin` unique), **S6** (cycle de vie MFA), **S9** (OAuth GitHub), **P6** (vérification d'e-mail, réinitialisation, codes de secours), **S27**.

### Phase 2 : SSO / SCIM (réactivation des drapeaux P3 seulement à la fin de cette phase)

Ordre : **S10** (validation OIDC complète, `state`/`nonce`/PKCE, vérification DNS du domaine, liaison par domaine vérifié, `defaultRole` borné, secret chiffré), **S11** (DTO SCIM, expiration, conformité, audit).

### Phase 3 : autorisation centralisée, IDOR, temps réel

Ordre : **A1** (guard global), **A2** (PolicyService et matrice, en s'appuyant sur P4 si tranché, sinon la règle par défaut de S12), **S12**, **S13**, **S14**, **S15**, **A4** puis **S16**.

### Phase 4 : invitations, console admin

Ordre : **P4** (matrice RBAC validée), **S17**, **S18**.

### Phase 5 : durcissement

Ordre : **S20** (XSS, prioritaire tant que le jeton n'est pas sorti du `localStorage`), **S19** (safeFetch), **S25** (dépendances), **S23** (DTO et test méta), **S24** (trust proxy, throttler Redis), **S22** (en-têtes nginx), **S21** (webhook), **A7** (config validée), **S26** et **P8** (code mort et démo), **A5**, **A6**, **P5**.

### Phase 6 : audit log, tests e2e, CI

Ordre : **A9** (CI sur toutes les branches, audit, e2e), **P7** (suite e2e de sécurité regroupant les tests d'abus), **A8** (audit transactionnel unifié), **P2** (bandeaux d'obsolescence, définition de terminé).

---

## 7. Limites de l'audit

- Revue statique et tests unitaires ; aucun test dynamique n'a été mené contre un environnement déployé. Les scénarios sont déduits du code et doivent être confirmés par les tests d'abus demandés.
- Le frontend n'a été revu que pour les puits XSS, le stockage des jetons et les flux OAuth ; `firebase-auth.ts`, la configuration Firebase et `firestore-backfill` n'ont pas été analysés en profondeur.
- Les modules métier non sensibles (finances, CPM, scheduler) n'ont été vérifiés que pour leurs contrôles d'accès.
- Les fichiers `.env*` n'ont pas été consultés, à dessein : la robustesse réelle de `JWT_SECRET` et `ENCRYPTION_KEY` (entropie) n'est pas vérifiée. Recommandation : `JWT_SECRET` ≥ 32 octets aléatoires ; `ENCRYPTION_KEY` dérivée de 32 octets aléatoires (le code actuel attend 32 **caractères UTF-8**, ce qui réduit l'entropie si la clé est une phrase lisible ; préférer un encodage base64 ou hex de 32 octets, avec migration des données chiffrées).

---

## 8. Historique des révisions

| Révision | Date | Contenu |
| --- | --- | --- |
| r1 | 2026-10-29 | Rapport initial : 44 constats. |
| r2 | 2026-10-29 | Revue des corrections de la Phase 0 (`journal-corrections.md`). Vérifié par l'architecte : backend 36 suites et 269 tests verts ; frontend 10 fichiers et 24 tests verts ; builds OK ; `prisma validate` OK ; plus d'avis `mariadb` ; **3 erreurs ESLint introduites**. Verdicts : S1 et P1 VALIDÉ ; P3, S2 et S5 À REPRENDRE (lint) ; S3 À REPRENDRE (503 Redis) ; S4 À REPRENDRE (TLS en production, `prisma.config.ts`, override). Ajout de **S28**. Mises à jour de S1, S4, S8, S11, S14 (étape 1 avancée) et S18 (étape 0 avancée). |
| r3 | 2026-10-30 | Revue de la reprise r2. Vérifié par l'architecte : backend 39 suites et 307 tests verts ; frontend 10 fichiers et 26 tests verts ; builds OK ; ESLint 0 erreur sur les fichiers modifiés ; `prisma generate` OK sans `DATABASE_URL` ; `migrate status` en production sans URL refusé explicitement. Verdicts : P3, S2, S3, S4, S5, S28, S14 étape 1, S18 étape 0 VALIDÉ. **Phase 0 VALIDÉE côté code.** Décisions : `migrate status` accepté comme preuve TLS de la CLI (vérification de `migrate deploy` au premier déploiement) ; montée vers pnpm 10 en Phase 6 (A9) ; pas de `--restore` pour S28. |

**Constats ouverts à la fin de r2** (historique) :
- complément de Phase 0 : P3, S2, S5 (lint), S3, S4, S18 étape 0, S14 étape 1, S28 ;
- Phases 1 à 6 : tous les autres constats, sauf S1 et P1 (clos).

**Constats ouverts à la fin de r3** :
- **Phase 0 : close côté code.** Actions d'exploitation en attente d'une décision de l'utilisateur :
  1. appliquer les migrations `20261108000000` et `20261108000100` ;
  2. générer les certificats MySQL et déployer ; consigner `migrate deploy` et `Ssl_cipher` (S4) ;
  3. exécuter les scripts S28 selon le runbook.
- Fixeur, prochaine étape : trois ajouts documentaires au runbook (S28), puis la **Phase 1** : A3, S7, S8, S6, S9, P6, S27.
- Encore ouverts :
  - S6 à S27 sauf S14 étape 1 et S18 étape 0 (S14 et S18 restent ouverts pour leurs autres étapes) ;
  - A1 à A9 ;
  - P2 et P4 à P8.


---

## Revue de la Phase 1 (A3 → S9) (r4, 2026-10-30)

Revue des entrées A3, S7, S8, S6 et S9 du journal (statut `CORRIGÉ – À REVOIR`), faite sur le code réel de la branche `security/phase-0` (modifications non commitées). Le fixeur travaillait en parallèle sur P6 et S27 : les chiffres ci-dessous incluent donc son travail P6 en cours. P6 et S27 ne sont pas revus ici.

### Vérifications refaites par l'architecte

| Vérification | Résultat |
| --- | --- |
| `cd backend && npx jest` (avec `DATABASE_URL` pointant vers `127.0.0.1:1`, injoignable, pour ne jamais toucher la MySQL de dev) | 45/45 suites, 416/416 tests. Un premier passage, lancé pendant que le fixeur ajoutait `MailService` (P6), avait 4 suites en échec (`Nest can't resolve … MailService`). C'était transitoire : vert au second passage. |
| `cd frontend && npx vitest run` | 13/13 fichiers, 43/43 tests |
| `env -u DATABASE_URL npx nest build` (backend) | OK |
| `npx vite build` (frontend) | OK |
| ESLint sur `backend/src/auth`, `src/admin`, les gateways, `tests/unit/auth`, `tests/http/session-lifecycle.spec.ts`, `tests/http/http-test-app.ts`, `scripts/encrypt-mfa-secrets.ts` | **1 erreur** : `auth.service.ts:782` `no-useless-assignment` (`let valid = false` dans `verifyCurrentFactor`, code S6). Le journal annonçait 0 erreur. |
| ESLint frontend (`api-session.ts`, `github-oauth.ts`, `AppContext.tsx`, `AdminConsole.tsx`, `Login.tsx`, `App.tsx`, `main.tsx`) | 0 erreur |
| `grep -rn "jwtService.sign\|signAccessToken" backend/src` hors specs | `jwtService.sign` seulement dans `token.service.ts` (accès et ticket MFA) ; `signAccessToken` appelé seulement par `session.service.ts:115,209` |
| `grep -rn "res.cookie\|maxAge" backend/src` hors specs | cookies de session définis seulement dans `session-cookies.ts` ; seule autre occurrence : le cookie `github_oauth_state` |
| `grep -rn "user.token\|Authorization\|accessToken" frontend/src` hors specs | aucun jeton lu ni stocké par le JavaScript ; `planner_user` ne contient plus qu'un profil, et l'ancien `token` est purgé au démarrage (`AppContext.tsx:519-523`) |

### A3 : un seul point d'émission de session : **VALIDÉ**

- `SessionService` est le seul appelant de `TokenService.signAccessToken`. `AuthService.completeLogin` est le seul point d'entrée : mot de passe, MFA, GitHub, Firebase, mock, SSO (`sso.service.ts`) et impersonation (`admin.service.ts`) y passent. Les cookies n'ont qu'une définition (`session-cookies.ts`).
- **Écart sur le critère du grep : accepté.** Les deux couches sont bien séparées : la signature bas niveau (`TokenService`, déjà validée avec S3) et la politique de session (`SessionService`). Nouveau critère, qui remplace celui de la section 4 : « `jwtService.sign` n'apparaît que dans `token.service.ts` ; `signAccessToken` n'est appelé que par `session.service.ts` ». Il est vérifié.
- Actions non bloquantes :
  1. `src/auth/session.test-support.ts` utilise `jest.fn()` et se retrouve compilé dans `dist/` (il n'y a pas de `tsconfig.build.json`). Le déplacer sous `backend/tests/support/`. **Critère** : `ls backend/dist/**/session.test-support*` ne renvoie rien après `nest build`.
  2. Migration `20261109000000` : la table `RefreshToken` devrait être vide, mais rien ne le garantit. Un `ALTER … ADD familyId NOT NULL` sur des lignes existantes leur donne `familyId = ''`. Ajouter `DELETE FROM RefreshToken;` avant l'`ALTER` (aucune de ces lignes n'est utilisable).

### S7 : sessions révocables, cookies httpOnly, déconnexion serveur : **À REPRENDRE** (deux points ciblés, le socle est solide)

Constaté dans le code :

- jeton d'accès de 15 min avec `sid` et `jti` ; un jeton sans `sid` est rejeté ;
- refresh opaque de 256 bits, haché en SHA-256, consommé de façon atomique (`updateMany` sur `revokedAt: null`), révocation de la famille sur réutilisation ;
- cache Redis de 60 s invalidé à la révocation, repli sur la base en 500 ms ;
- `POST /auth/logout` idempotent ; `revokeUserSessions` révoque réellement ;
- `DELETE /auth/sessions/:sid` borné au propriétaire ;
- WebSocket authentifié par cookie ;
- frontend sans jeton lisible.

Les tests HTTP (`session-lifecycle.spec.ts`) couvrent les quatre scénarios demandés : logout, suspension, révocation admin et rejeu du refresh.

**Réponses aux écarts et questions du fixeur :**

1. **`Path=/auth` pour le refresh : accepté.** Le logout avec un jeton d'accès expiré a besoin du cookie de refresh. L'exposition supplémentaire se limite aux routes `/auth/*` du même backend. Remédiation S7.3 mise à jour : `Path=/auth`.
2. **Surveillance de la session, et non du jeton, toutes les 60 s sur les sockets : accepté sur le principe.** Couper une socket à chaque expiration du jeton de 15 min n'apporterait rien, puisque la révocation reste détectée. **Mais le délai n'est pas tenu dans un cas** : `ws-auth.ts:40-48` appelle `isSessionActive`, qui lit d'abord le cache Redis (`session.service.ts:268-271`). Prenons une suspension posée en base, sans passer par `revoke`. Si le cache a été rempli juste avant par une requête HTTP, la socket peut survivre jusqu'à environ 120 s (cache de 60 s, plus un intervalle de 60 s). Le critère est « moins de 60 s ». → **Action S7-a.**
3. **CSRF par `SameSite=Strict` et CORS : accepté pour les attaques inter-sites, insuffisant pour les sites voisins.** `SameSite` protège contre les autres *sites*, pas contre les autres *sous-domaines* du même site. Or `*.boukarou-os.com` est un site partagé (charte « Boukarou OS », plusieurs applications possibles). Deux voies restent ouvertes depuis un sous-domaine voisin compromis ou hostile :
   - un formulaire `application/x-www-form-urlencoded`, que Nest analyse par défaut, part avec les cookies ;
   - un handshake Socket.IO par cookie (*Cross-Site WebSocket Hijacking*), puisque l'option `cors` de Socket.IO ne s'applique pas au transport WebSocket.

   Le passage du WebSocket au cookie, introduit par S7, crée ce second vecteur : avant, `auth.token` était explicite, donc immunisé. → **Nouveau constat S29, action S7-b.**
4. **7 jours glissants et plafond de 30 jours : accepté comme décision produit par défaut.** C'est cohérent avec les usages SaaS B2B, et l'inactivité de 7 jours joue le rôle de délai d'inactivité. Deux réserves, à traiter plus tard (pas dans cette phase) :
   - comptes `platformRole` : plafond de 12 h (Phase 4, avec S18.3) ;
   - durée configurable par workspace : backlog produit.
5. **Retrait du `Bearer` : à faire, mais pas maintenant.** Le Bearer ne crée pas de risque nouveau : aucun jeton n'est plus lisible par le JavaScript, et le cookie reste prioritaire (`jwt.guard.ts:46-53`). Il est même immunisé contre le CSRF. Décision :
   - garder le Bearer jusqu'à la Phase 5 ;
   - à ce moment-là, le retirer du guard HTTP et du handshake WS, sauf si un consommateur documenté existe. Dans ce cas, le remplacer par des jetons d'API personnels à portée limitée (backlog), jamais par le jeton de session.
6. **Garde-fou `DATABASE_URL` en `NODE_ENV=test` : accepté et rendu obligatoire.** Le garde-fou de `http-test-app.ts` est bon, mais il ne couvre que les tests HTTP. → **Mise à jour d'A7** (voir plus bas), à faire dès le complément de Phase 1 parce que le risque porte sur la base de dev réelle.

**Actions S7 :**

- **S7-a** : la revalidation périodique des sockets doit interroger la base **sans** passer par le cache. Par exemple `isSessionActive(sid, userId, { bypassCache: true })` dans `ws-auth.ts`, et la valeur lue rafraîchit le cache. Le coût est d'une requête indexée par socket et par minute, acceptable.
  - **Test** (`notifications.gateway.spec.ts`, timers factices) : cache Redis pré-rempli « actif », puis `isSuspended = true` en base sans `revoke`. La socket est déconnectée au premier tick (60 s au plus).
- **S7-b** : voir S29 (contrôle de l'`Origin` sur le handshake WS authentifié par cookie). S7 est clos quand S29 est validé.
- **S7-c** : écrire `docs/security/runbook-phase1.md`. Il est cité par la migration `20261109000100` (en-tête SQL) mais **n'existe pas**. Contenu attendu :
  - ordre de déploiement (migrations A3/S7, S6, P6) ;
  - annonce de la déconnexion générale (jetons sans `sid`) ;
  - exécution de `scripts/encrypt-mfa-secrets.ts` : rapport, revue, `--apply`, sauvegarde préalable, CSV conservé ;
  - révocation côté GitHub des anciens jetons à portée `repo` ;
  - contrat des cookies pour les éventuels scripts ;
  - retour arrière.

  **Critère** : le fichier existe et chaque migration de la Phase 1 y est citée.

### S8 : contrôles uniformes à la connexion : **VALIDÉ**

- `completeLogin` applique, pour toutes les méthodes : suspension (403), puis `enforceSSO`, puis MFA (ticket), puis émission. Le ticket conserve la méthode d'origine **côté serveur** (`<userId>|<méthode>` dans Redis), ce qui l'empêche d'être falsifié. Au challenge, la suspension et `enforceSSO` sont réévalués.
- Plus aucune liaison automatique : Firebase et GitHub sur un compte existant donnent 409 sans `update` ; un compte provisionné par SCIM n'est jamais réclamé. La matrice de `login-policy.spec.ts` (24 tests) correspond au critère d'acceptation.

**Réponses aux écarts :**

1. **Ordre suspension → `enforceSSO` → MFA : accepté.** Inutile de consommer un ticket et une saisie TOTP pour une méthode qui sera refusée de toute façon. Comme `enforceSSO` est réévalué au challenge (`primaryMethod`), un `enforceSSO` posé entre le ticket et le code est bien appliqué. Remédiation S8.1 mise à jour dans ce sens.
2. **`enforceSSO` conditionné à `FEATURE_SSO_ENABLED` : accepté, et c'est la bonne lecture du risque.** Tant que S10 n'a pas prouvé la propriété du domaine, `enforceSSO` est un vecteur de déni de service contre une organisation tierce. → **Mise à jour de S10** (voir plus bas).
3. et 4. **Accepté.** La liaison GitHub passe par `/auth/github/link` (voir S9 et P9) ; la liaison SSO relève de la Phase 2. Pour la pré-occupation SCIM, la règle générale du 409 et le premier rattachement par réinitialisation de mot de passe (P6) satisfont S8.4.

### S6 : cycle de vie du MFA : **À REPRENDRE** (trois actions courtes)

Constaté :

- `setupMfa` refuse avec 409 si le MFA est actif, et le secret en attente est chiffré ;
- `confirmMfa` promeut le secret, consomme le pas de temps et livre 10 codes Argon2id ;
- `disableMfa` et la régénération exigent le facteur actuel **et** le mot de passe (ou une connexion de moins de 5 min) ;
- anti-rejeu par `mfaLastUsedStep`, avec une mise à jour conditionnelle `lt` (sûre en concurrence) ;
- code de secours à usage unique (`updateMany` sur `usedAt: null`) ;
- DTO en place ;
- lecture tolérante des secrets encore en clair ;
- script de chiffrement idempotent, non exécuté.

Les tests attendus par le rapport sont tous présents dans `mfa-lifecycle.spec.ts`.

**Réponses aux questions :**

- **Code de secours accepté pour désactiver le MFA (avec le mot de passe) : accepté.** Un code de secours permet déjà de se connecter. L'accepter pour la désactivation n'ajoute aucune capacité à un attaquant, et c'est le parcours normal en cas de perte de l'appareil. Le refuser pour la régénération est cohérent. Recommandation non bloquante : envoyer un e-mail de notification à la désactivation du MFA et à la régénération des codes, puisque `MailService` est maintenant disponible (P6).
- **Absence d'écran d'activation du MFA : pris acte.** Le backend ne peut pas être reproché au fixeur sur ce point, mais sans écran le MFA reste inaccessible aux utilisateurs. → **Nouveau constat produit P9.**

**Actions S6 :**

- **S6-a** : corriger l'erreur ESLint `auth.service.ts:782` (`no-useless-assignment`). **Critère** : `npx eslint src/auth` donne 0 erreur.
- **S6-b** : `setupMfa` et `confirmMfa` n'exigent aucune réauthentification. Une session volée sur un compte **sans** MFA permet donc d'enrôler le facteur de l'attaquant. Le titulaire est alors verrouillé hors de son compte et l'attaquant détient les codes de secours. C'est l'impact décrit dans S6 (« une session volée suffit à remplacer le facteur »), dans sa variante « premier facteur ». Correctif : appeler `assertReauthenticated(user, dto.password, sid)` dans `setupMfa`, ce qui suppose d'ajouter un DTO `SetupMfaDto { password?: string }`.
  - **Tests** : `setupMfa` sans mot de passe, sur un compte qui en a un, est refusé sans écriture de `mfaPendingSecret` ; compte sans mot de passe avec une connexion de plus de 5 min : refusé.
- **S6-c** : couvert par S7-c. Les étapes de `encrypt-mfa-secrets.ts` doivent figurer dans `runbook-phase1.md`.

### S9 : OAuth GitHub : **À REPRENDRE** (une régression fonctionnelle, un durcissement)

Constaté :

- `state` de 32 octets, cookie signé par HMAC (clé HKDF dédiée), vérifié en temps constant **avant** tout appel à GitHub, puis effacé ;
- identité par `githubId` ; seuls les e-mails `verified === true` sont retenus ; 409 sans `update` sur un e-mail connu ; plus d'e-mail fabriqué ;
- `res.ok` contrôlé sur les trois appels ;
- portée `read:user user:email` ; DTO en place.

Le critère d'acceptation de sécurité est atteint (`github-oauth.spec.ts`, 19 tests).

**Réponse à l'écart :** `authorize` renvoie un JSON `{ url }` au lieu d'une redirection 302 : **accepté**. L'appel `fetch` avec `credentials: 'include'` vers l'API du même site pose bien le cookie, et la navigation suit vers GitHub. La sécurité est équivalente (le `state` reste lié au cookie de ce navigateur) et l'erreur reste affichable dans l'application.

**Actions S9 :**

- **S9-a (régression)** : `loginWithGitHub` (`auth.service.ts:361-366`) **écrase `githubAccessToken`** avec le jeton de connexion, à portée `read:user user:email`. Un utilisateur dont le jeton actuel porte `repo` le perd à sa prochaine connexion GitHub, et `getGitHubRepositories` cesse de voir ses dépôts privés. L'écriture a en outre lieu **avant** les contrôles de `completeLogin` (suspension, `enforceSSO`, MFA). Correctif :
  - à la connexion, ne jamais persister le jeton GitHub. Mettre à jour `githubUsername` seulement, et seulement après le succès de `completeLogin` ;
  - le jeton n'est stocké que par `/auth/github/link` avec la finalité `repos`, et seulement si le champ `scope` de la réponse de GitHub contient `repo`.

  **Tests** : connexion d'un compte lié dont le jeton stocké est `X` : `githubAccessToken` reste `X` ; compte suspendu : aucune écriture.
- **S9-b (durcissement)** : la finalité (`login`, `link`, `repos`) n'est liée ni au `state` ni au cookie. Le frontend ne peut donc pas savoir, au retour de GitHub, quelle route appeler : `App.tsx:115-117` appelle toujours `login`. Correctif :
  - inclure la finalité dans la valeur signée (`<state>.<purpose>.<hmac>`) ;
  - faire vérifier par `/auth/github/login` que la finalité vaut `login`, et par `/auth/github/link` qu'elle vaut `link` ou `repos` ;
  - exposer la finalité au frontend : soit dans l'URL de retour (`redirect_uri` avec `?gh=link`), soit par un `GET /auth/github/pending` qui renvoie la finalité du cookie.

  **Tests** : un `state` émis pour `login` présenté à `/link` donne 401, et inversement.
- L'écran de liaison GitHub et de connexion d'un dépôt relève de P9.

### Nouveaux constats

#### S29 : CSRF et détournement de WebSocket depuis un sous-domaine du même site ; cookies sans préfixe `__Host-`

- **Phase** : 1 (complément, lié à la clôture de S7). **Sévérité** : Mineur. **CVSS 4.2** `AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N`.
- **Localisation** :
  - `backend/src/auth/ws-auth.ts:15-21` : WebSocket authentifié par le cookie `accessToken`, sans contrôle d'`Origin` ;
  - `backend/src/tracking/tracking.gateway.ts:24-29` et `backend/src/notifications/notifications.gateway.ts:20-25` : l'option `cors` de Socket.IO ne s'applique pas au transport WebSocket ;
  - `backend/src/main.ts` : analyseur `urlencoded` actif par défaut, aucun contrôle d'`Origin` ni de `Sec-Fetch-Site` sur les méthodes à effet ;
  - `backend/src/auth/session-cookies.ts:27-38` : cookies sans préfixe.
- **Cause** : `SameSite=Strict` protège contre les autres **sites**. Or tous les sous-domaines de `boukarou-os.com` forment un seul site. Une page hostile ou victime d'une XSS sur un sous-domaine voisin peut donc :
  - ouvrir une socket authentifiée par le cookie de la victime, lire ses notifications et ses événements de suivi, et en émettre ;
  - envoyer des formulaires `POST` avec les cookies ;
  - déposer un cookie `accessToken` sur `Domain=.boukarou-os.com` (*cookie tossing*), ce qui revient à connecter la victime au compte de l'attaquant.
- **Remédiation attendue** :
  1. Handshake Socket.IO : `allowRequest` (ou un middleware `server.use`) qui refuse le handshake quand le jeton vient du **cookie** et que l'en-tête `Origin` est absent ou hors de `CORS_ORIGINS`. Le `Bearer` explicite reste accepté sans `Origin` jusqu'à son retrait (Phase 5).
  2. HTTP : middleware global sur `POST`, `PUT`, `PATCH` et `DELETE`. Si la requête porte le cookie `accessToken` ou `refreshToken`, exiger un `Origin` (à défaut, un `Referer`) présent dans `CORS_ORIGINS`, sinon 403. Exemptions explicites et listées : webhook GitHub, SCIM (authentifié par clé, sans cookie).
  3. En production, nommer le cookie d'accès `__Host-accessToken` (`Secure`, `Path=/`, sans `Domain`). Le cookie de rafraîchissement ne peut pas porter `__Host-` à cause de `Path=/auth` : le préfixer `__Secure-` et le traiter comme non fiable s'il apparaît en double (refus si deux valeurs sont reçues).
- **Critère d'acceptation** : aucune requête à effet ni aucun handshake WS authentifié par cookie n'aboutit depuis une origine absente de `CORS_ORIGINS`.
- **Tests attendus** :
  - `session-lifecycle.spec.ts` : `POST /auth/logout`, ou une route protégée en `POST`, avec cookie et `Origin: https://evil.boukarou-os.com` donne 403 ; avec `Origin` autorisé, 2xx ;
  - test de gateway : handshake avec cookie et `Origin` étranger refusé ; avec `Authorization: Bearer` et sans `Origin`, accepté.

#### P9 : écrans de sécurité du compte absents (MFA, codes de secours, liaison GitHub et Firebase, sessions actives)

- **Phase** : 1 (complément). **Sévérité** : Majeur (produit).
- **Observation** :
  - les routes `/auth/mfa/setup|confirm|disable|recovery-codes`, `/auth/github/link` (finalités `link` et `repos`) et `/auth/sessions` existent, mais aucun écran ne les appelle (aucun appel à `startGitHubAuthorization('link'|'repos')`) ;
  - les messages 409 renvoient l'utilisateur vers « liez … depuis votre profil », un écran qui n'existe pas pour GitHub ;
  - depuis S9, plus aucun parcours n'obtient la portée `repo` : l'intégration de dépôts GitHub est inutilisable pour les nouveaux comptes.
- **Risque** : MFA inaccessible aux utilisateurs, ce qui annule en pratique S6 ; comptes bloqués en 409 sans issue, donc des tickets de support ; régression de l'intégration GitHub.
- **Suggestion** : un écran « Sécurité du compte » qui regroupe :
  - activation du MFA (QR code depuis `authUri`, confirmation, affichage unique des 10 codes avec téléchargement) ;
  - désactivation et régénération (code, ou code de secours, plus mot de passe) ;
  - liaison GitHub et Firebase ;
  - liste et révocation des sessions ;
  - bouton « Connecter un dépôt » (finalité `repos`) dans les intégrations.

  Cet écran s'appuie sur S9-b pour router le retour de GitHub.
- **Critère** : tests vitest. Le parcours d'activation affiche les codes une seule fois. Le retour GitHub avec la finalité `link` appelle `/auth/github/link`. La page des sessions appelle `DELETE /auth/sessions/:sid`.

### Mises à jour de remédiations existantes (décisions de cette revue)

- **A3**, critère : remplacé par « `jwtService.sign` seulement dans `token.service.ts`, `signAccessToken` appelé seulement par `session.service.ts` ».
- **S7.3** : `Path=/auth` pour le cookie de rafraîchissement (au lieu de `/auth/refresh`). Durées retenues : 7 jours glissants, plafond de 30 jours.
- **S8.1** : ordre retenu : suspension, puis `enforceSSO`, puis MFA. `enforceSSO` est réévalué au challenge selon la méthode d'origine du ticket.
- **S10**, ajout d'un point : `enforceSSO` n'est appliqué que si `FEATURE_SSO_ENABLED=true` **et** si le domaine de la configuration est prouvé (`domainVerifiedAt` non nul, une fois S10 livré).
  - **Test** : `enforceSSO=true` sur un domaine non vérifié : les connexions par mot de passe restent autorisées.
- **S18.2**, complément : liste des routes **interdites en session d'impersonation** (403 si `req.user.impersonatedBy` est présent), à couvrir par un test paramétré :
  - `/auth/mfa/*` ;
  - `/auth/github/link` et `/auth/firebase/link` ;
  - `DELETE /auth/sessions/:sid` ;
  - `/auth/password/*` ;
  - `/admin/*`.

  Sans cela, une impersonation de 15 min pourrait lier le GitHub ou le Firebase de l'administrateur au compte cible, et devenir un accès **persistant**. Le drapeau `FEATURE_IMPERSONATION_ENABLED` doit rester désactivé tant que ce point n'est pas fait. Autre ajout : à l'impersonation, révoquer la session de l'administrateur (`actor.sid`). Son cookie de rafraîchissement est effacé (`session-cookies.ts:40-41`), mais sa famille reste active 7 jours sans pouvoir être utilisée.
- **A7**, ajout d'un point, **à avancer au complément de Phase 1** : en `NODE_ENV=test`, aucun repli de DSN. `buildMariaDbOptions` lève une erreur sans `DATABASE_URL` ; la configuration Jest (`setupFiles`) fixe `DATABASE_URL` sur une adresse injoignable (`127.0.0.1:1`) sauf pour la suite e2e explicite, qui exige sa propre URL. **Test** : `prisma.service.spec.ts`, cas `NODE_ENV=test` sans `DATABASE_URL` : erreur (le cas « repli local autorisé » est retiré pour `test`).

### Synthèse de la revue r4

| ID | Verdict r4 |
| --- | --- |
| A3 | VALIDÉ (2 actions non bloquantes) |
| S7 | À REPRENDRE (S7-a, S7-b par S29, S7-c) |
| S8 | VALIDÉ |
| S6 | À REPRENDRE (S6-a, S6-b, S6-c par S7-c) |
| S9 | À REPRENDRE (S9-a, S9-b) |
| S29 | Nouveau, ouvert |
| P9 | Nouveau, ouvert |

Aucune nouvelle faille critique. La seule régression est fonctionnelle (S9-a) ; le seul affaiblissement introduit est le WebSocket par cookie sans contrôle d'`Origin` (S29).

**Actions pour fixeur, dans l'ordre :**

1. S6-a : erreur ESLint `auth.service.ts:782`.
2. S7-a : revalidation WS sans le cache, et son test.
3. S29 : contrôle de l'`Origin` (WS, puis HTTP) ; préfixes de cookies en production.
4. S6-b : réauthentification pour `setupMfa`.
5. S9-a : ne plus écraser `githubAccessToken` à la connexion.
6. S9-b : finalité liée au `state`.
7. S7-c : `docs/security/runbook-phase1.md`.
8. A7 (avancé) : pas de repli de DSN en `NODE_ENV=test`.
9. Non bloquants A3 : déplacer `session.test-support.ts`, `DELETE FROM RefreshToken` dans la migration.
10. Puis P6 et S27 (en cours), puis P9.

**Constats ouverts à la fin de r4** :

- Phase 1 : S6, S7, S9, P6, S27, S29, P9.
- Phases 2 à 6 : S10 à S26 sauf S14 étape 1 et S18 étape 0 ; A1, A2, A4 à A9 ; P2, P4, P5, P7, P8.
- Clos : S1, S2, S3, S4, S5, S8, S28, A3, P1, P3.

---

## Revue P6 et S27 (r5, 2026-10-30)

Revue des entrées P6 et S27 du journal (statut `CORRIGÉ – À REVOIR`), faite sur le code réel. Le fixeur appliquait en parallèle les actions de la r4 (S7-a, S29, S6-b, S9-a/b, runbook, A7, S18.2) : ces actions ne sont **pas** revues ici.

### Vérifications refaites par l'architecte

| Vérification | Résultat |
| --- | --- |
| `cd backend && npx jest` (`DATABASE_URL` sur `127.0.0.1:1`, injoignable) | 48/48 suites, 430/430 tests. Le journal annonce 47 et 428 : l'écart vient du travail r4 en cours. |
| `cd frontend && npx vitest run` | 14/14 fichiers, 53/53 tests |
| ESLint sur les fichiers P6/S27 (`auth.service.ts`, `encryption.util.ts`, `mail.service.ts`, `invitations.service.ts`, `mask-email.ts`, `sso.service.ts`, `dto/`, `tests/unit/auth`, `account-routes.spec.ts`, `account-api.ts`, `AccountLinkPage.tsx`, `Login.tsx`, `App.tsx`) | 0 erreur. L'erreur S6-a de la r4 (`auth.service.ts:782`) est corrigée. |

### P6 : vérification d'e-mail et réinitialisation de mot de passe : **À REPRENDRE** (une faille introduite, un oracle temporel)

Constaté, et conforme :

- jetons de 256 bits, stockés en SHA-256 ;
- typés : la confusion entre vérification et réinitialisation est testée ;
- usage unique atomique (`updateMany` sur `usedAt: null`) ;
- un nouveau jeton invalide le précédent ;
- durées de 24 h (vérification) et 30 min (réinitialisation) ;
- `register` en 202 sans session ;
- `login` répond 403 pour un compte non vérifié, **après** le contrôle du mot de passe ;
- `resetPassword` révoque toutes les sessions et conserve le MFA ;
- liens consommés par un **clic**, pas à l'ouverture (protection contre les scanners de liens) ;
- jeton retiré de l'URL côté frontend ;
- reprise `emailVerifiedAt = createdAt` dans la migration.

**Actions P6 :**

- **P6-a (Majeur, faille introduite) : des liens secrets sont écrits dans les journaux.** `MailService.sendMail` (`backend/src/mail/mail.service.ts:378-397`) passe en mode simulé dans deux cas :
  - SMTP absent ;
  - **tout échec d'envoi**, même avec un vrai SMTP configuré.

  Dans les deux cas, il journalise le texte complet du message. Ce texte contient désormais les liens de réinitialisation et de vérification, c'est-à-dire des jetons secrets. En production, quiconque lit les journaux (exploitation, agrégateur, prestataire) peut réinitialiser le mot de passe de n'importe quel compte qui a fait une demande dans les 30 dernières minutes. C'est CWE-532, qui mène à une prise de contrôle de compte. Correctif :
  1. hors `NODE_ENV ∈ {development, test}`, ne jamais journaliser le corps d'un message : seulement le destinataire masqué (`maskEmail`), le sujet et l'erreur ;
  2. en production, refuser le démarrage si les variables `SMTP_*` sont absentes (même logique fail-closed qu'A7), ou désactiver explicitement les routes `register`, `forgot` et `resend` (503) ;
  3. le repli « simulé » après un échec d'envoi n'est autorisé qu'en développement.

  **Tests** (`mail.service.spec.ts`) : en `NODE_ENV=production` avec un transporteur qui échoue, aucune trace du jeton dans les appels au `Logger` (espion sur `log`, `warn`, `error`, `debug`) ; démarrage en production sans SMTP : erreur explicite (ou 503 sur `/auth/password/forgot`).
- **P6-b (Mineur, oracle temporel ; lié à S27)** : `requestPasswordReset`, `resendVerification` et `register` **attendent** l'envoi de l'e-mail (`await this.safeMail(...)`). Ce n'est le cas que si le compte existe (pour `forgot` et `resend`), ou avec un coût différent (pour `register` : transaction et onboarding d'un côté, simple notification de l'autre). Un aller-retour SMTP coûte de 100 ms à plusieurs secondes, ce qui fait de la durée de réponse un oracle d'existence du compte, beaucoup plus net que celui que S27 vient de fermer sur `login`. Correctif : l'envoi est **détaché de la réponse** (envoi non attendu avec capture d'erreur, ou file d'envoi). Les écritures en base restent dans la requête.
  - **Test** : avec un `MailService` dont la promesse ne se résout jamais, `requestPasswordReset`, `resendVerification` et `register` (adresse existante comme nouvelle) se résolvent tous, et renvoient le même message.
- **P6-c (non bloquant)** : une inscription jamais vérifiée bloque l'adresse sans limite de durée. Un tiers qui inscrit `victime@x.com` empêche ensuite la victime de créer son compte par Firebase ou GitHub (409), tant qu'elle ne passe pas par « Mot de passe oublié ». Deux correctifs :
  - purger les comptes jamais vérifiés de plus de 7 jours (tâche planifiée, avec leurs données d'onboarding) ;
  - dans les messages 409 de Firebase et GitHub, mentionner « Mot de passe oublié ».
- **P6-d (non bloquant)** : `sendEmailVerificationEmail` insère le **nom saisi** par le demandeur dans un e-mail légitime envoyé à une adresse qui n'est pas forcément la sienne (texte libre, possibilité d'hameçonnage). L'HTML est échappé, mais pas le contenu. Solution : retirer le nom de cet e-mail (« Bonjour, »), ou le borner (`@MaxLength(80)`, sans `://`).
- Résultat de `resetPassword` : la mise à jour du mot de passe et le marquage « vérifié » sont deux écritures hors transaction. À regrouper (non bloquant).

**Réponses aux questions :**

1. **Reporter l'écran « Sessions actives » et l'écran MFA : accepté**, ils sortent de P6. Ils sont déjà portés par **P9** (écran « Sécurité du compte », tâche produit). Réserve : P9 doit être livré **avant l'ouverture de la Phase 1 aux utilisateurs**. Sans lui, le MFA n'est pas activable et S6 reste théorique. P6 est clos sans ces écrans.
2. **Réinitialisation qui marque le compte vérifié, y compris pour un compte SCIM : accepté.** Le lien prouve le contrôle de la boîte aux lettres, ce qui est une preuve **plus forte** que l'adresse affirmée par l'IdP d'un workspace dont le domaine n'est pas encore prouvé (S10). Deux garde-fous existent déjà et suffisent :
   - le MFA est conservé ;
   - un `enforceSSO` sur un domaine prouvé continuera de refuser la connexion par mot de passe (S8 et mise à jour S10).

   À ajouter avec A8 : un événement d'audit « premier accès d'un compte provisionné par SCIM ».
3. **`sendAccountExistsEmail` : à garder.** C'est le pendant indispensable d'une réponse générique : sans lui, le vrai titulaire qui a oublié son compte n'a aucun retour. OWASP recommande ce schéma. Le risque de courriel non sollicité n'est pas plus grand que celui de « Mot de passe oublié », qui existe déjà. Conditions :
   - le message ne contient aucune donnée saisie par le demandeur (c'est le cas) ;
   - l'envoi suit P6-b (détaché) ;
   - limitation **par adresse destinataire** (au plus 1 notification par heure et par adresse) : elle relève de **S24** (limitation de débit avec Redis), et non d'A7 comme l'écrit le journal.
4. **Pré-remplir l'e-mail d'invitation : ne jamais renvoyer l'adresse en clair.** On n'a pas besoin de la pré-remplir, il suffit de ne pas la demander :
   - le parcours « Créer un compte » depuis une invitation envoie `POST /auth/register { invitationToken, name, password }`, **sans e-mail** ;
   - le serveur prend l'adresse de l'invitation ;
   - le compte est créé **vérifié**, puisque le jeton a été envoyé à cette adresse : c'est une preuve équivalente au lien de vérification ;
   - l'interface n'affiche que l'adresse masquée (« Vous rejoindrez en tant que j***@e***.com »).

   Conditions, rattachées à **S17** :
   - jeton d'invitation à usage unique et à durée bornée ;
   - acceptation de l'invitation toujours explicite ;
   - si un compte existe déjà pour cette adresse : même réponse générique, notification, puis connexion.

   **Tests** : `register` avec `invitationToken` valide crée le compte avec l'adresse de l'invitation et `emailVerifiedAt` renseigné ; un corps contenant un `email` différent est ignoré ou refusé (400) ; un jeton expiré ou consommé donne 400.

### S27 : énumération des comptes et comparaisons non constantes : **VALIDÉ** pour son périmètre

Constaté :

- `login` vérifie un hachage Argon2id factice (mêmes paramètres, calculé une fois) quand le compte est absent **ou sans mot de passe** ; le message 401 est identique ;
- `register` hache dans les deux branches ;
- PBKDF2 legacy comparé par `timingSafeEqual`, avec un contrôle de longueur sans exception ;
- `checkInvitation` masque l'adresse et ne renvoie plus l'e-mail de l'invitant ;
- `discover` ne renvoie plus `workspaceName`.

Les tests de `enumeration-timing.spec.ts` couvrent le critère.

- **Écart sur le critère : accepté.** On vérifie que `argon2.verify` est appelé, au lieu de mesurer une durée instable en CI. C'est ce que le rapport proposait.
- **Écart sur `workspaceName` dans `checkInvitation` : accepté.** Il faut posséder un jeton de 256 bits.
- Résidu connu, non bloquant : un compte encore en PBKDF2 legacy (1 000 itérations) répond plus vite qu'un compte Argon2. Il reste donc détectable, mais seulement par qui connaît l'adresse, et la migration différée l'efface à la première connexion.
- L'oracle temporel des nouvelles routes P6 est traité sous **P6-b**. S27 ne repasse pas à « À REPRENDRE » pour autant : le défaut vient de P6.

### Synthèse de la revue r5

| ID | Verdict r5 |
| --- | --- |
| P6 | À REPRENDRE (P6-a bloquant, P6-b ; P6-c et P6-d non bloquants) |
| S27 | VALIDÉ |

**Actions pour fixeur (P6/S27), dans l'ordre :**

1. P6-a : ne plus journaliser le corps des e-mails hors développement ; fail-closed sans SMTP en production.
2. P6-b : envoi d'e-mail détaché de la réponse (`register`, `forgot`, `resend`), avec un test de promesse jamais résolue.
3. Formulaire d'inscription par invitation sans e-mail (question 4). À planifier avec S17 ; pas un prérequis à la clôture de P6.
4. Non bloquants : P6-c (purge des comptes non vérifiés, message 409), P6-d (nom retiré de l'e-mail de vérification), transaction dans `resetPassword`.

Toujours dues au titre de la r4, en cours chez le fixeur et non revues ici : S7-a, S29, S6-b, S9-a, S9-b, S7-c (`runbook-phase1.md`), A7 (DSN en test), S18.2.

**Constats ouverts à la fin de r5** :

- Phase 1 : S6, S7, S9 (actions r4), P6 (P6-a, P6-b), S29, P9.
- Phases 2 à 6 : S10 à S26 sauf S14 étape 1 et S18 étape 0 ; A1, A2, A4 à A9 ; P2, P4, P5, P7, P8.
- Clos : S1, S2, S3, S4, S5, S8, S27, S28, A3, P1, P3.

---

## Revue r6 (2026-10-31) : actions r4 et r5, clôture de la Phase 1

Revue des entrées de la section « Actions de la revue r4 (Phase 1) et de la revue r5 (P6) » du journal, faite sur le code réel. Le fixeur ne travaillait pas pendant cette revue.

### Vérifications refaites par l'architecte

| Vérification | Résultat |
| --- | --- |
| `cd backend && npx jest` (`DATABASE_URL` sur `127.0.0.1:1` ; `tests/support/jest-env.ts` la force de toute façon) | 53/53 suites, 497/497 tests (conforme au journal) |
| `cd frontend && npx vitest run` | 14/14 fichiers, 56/56 tests (conforme) |
| `env -u DATABASE_URL npx nest build` | OK ; `find dist -name "*.spec.js" -o -name "*test-support*"` vide |
| `npx vite build` | OK |
| ESLint frontend `src` | 0 erreur |
| ESLint backend `src tests` | **7 erreurs**, toutes dans `backend/tests/support/session.test-support.js`. Ce fichier est un artefact compilé non suivi par git, avec `.d.ts` et `.js.map` (voir A3-c). 0 erreur sur les fichiers source. |
| Contournement de S18.2 par la casse | **Confirmé** sur l'Express 4.22.1 du projet : `POST /Auth/GitHub/Link` atteint le gestionnaire de `/auth/github/link` (`req.path = /Auth/GitHub/Link`), alors que l'expression de blocage ne correspond pas. Script de preuve dans le bac à sable de session, rien dans le dépôt. |

### Verdicts par constat

**S6 (S6-a, S6-b) : VALIDÉ.**
- L'erreur ESLint de `verifyCurrentFactor` est corrigée.
- `setupMfa(userId, dto, sid)` appelle `assertReauthenticated` avant toute écriture. La réauthentification passe avant le contrôle `mfaEnabled`, donc l'existence du MFA n'est pas révélée sans mot de passe.
- `POST /auth/mfa/setup` est limité à 5/min.
- Les tests de refus sans écriture sont présents. **S6 est clos.**

**S7 (S7-a, S7-c) : VALIDÉ.**
- `isSessionActive(…, { bypassCache: true })` lit la base, rafraîchit le cache si la session est active et le supprime sinon. Le tick WS l'utilise.
- Le test `ws-revalidation.spec.ts` reproduit le scénario de 120 s de la r4 et coupe la socket au premier tick.
- `runbook-phase1.md` couvre :
  - ordre de déploiement et variables ;
  - déconnexion générale ;
  - les trois migrations, reprise P6 comprise ;
  - le script MFA en quatre temps ;
  - les jetons GitHub ;
  - le contrat des cookies ;
  - les vérifications, le retour arrière et la purge.
- S7-b est soldé par S29. **S7 est clos.**

**S9 (S9-a, S9-b, `GET /auth/github/pending`) : VALIDÉ.**
- `loginWithGitHub` ne persiste plus aucun jeton. `githubUsername` n'est mis à jour qu'après `completeLogin`.
- `linkGitHubAccount` ne stocke le jeton (chiffré) que si la finalité est `repos` **et** que la liste des portées, découpée, contient exactement `repo`. `public_repo` ne passe donc pas.
- La finalité est signée dans le cookie (`<state>.<finalité>.<HMAC>`) et chaque route n'accepte que les siennes.
- `/pending` ne révèle que la finalité d'un cookie valablement signé, propre à ce navigateur, et répond 401 sinon. Il ne sert pas d'oracle.
- Le frontend aiguille vers `login` ou `link` (`App.tsx:119-121`).
- Remarque non bloquante : un nouveau compte GitHub est créé **avant** `completeLogin`. Sur un domaine `enforceSSO`, il est donc créé puis refusé (403). C'est sans gravité (adresse vérifiée par GitHub, aucune session), mais la création pourrait être conditionnée au même contrôle `enforceSSO`. À traiter avec S10. **S9 est clos.**

**S29 : VALIDÉ.**
- `originCheckMiddleware`, placé après `cookieParser`, refuse avec 403 les requêtes `POST`, `PUT`, `PATCH` et `DELETE` portant un cookie de session, quel que soit le préfixe, sauf avec une `Origin` autorisée (ou, à défaut, un `Referer` autorisé). `Origin: null` est refusé. Si `Origin` est présent et refusé, le `Referer` n'est pas consulté.
- Les exemptions (webhook GitHub, SCIM) sont ancrées. Le routage Express ne tient pas compte de la casse : une variante comme `/SCIM/v2` n'est donc pas exemptée et reste contrôlée, ce qui va dans le sens sûr.
- Handshake WS : `Origin` exigée quand le jeton vient du cookie.
- En production, les cookies s'appellent `__Host-accessToken` et `__Secure-refreshToken`. Une valeur en double est refusée et le nom sans préfixe est ignoré.
- Les 10 tests HTTP et 8 tests unitaires couvrent le critère d'acceptation. **S29 est clos.**

**A7, point avancé (pas de repli de DSN en test) : VALIDÉ.**
- `allowsLocalDsnFallback` n'est vrai qu'en `development`.
- `jest-env.ts`, via `setupFiles`, écrase `DATABASE_URL`, même si elle est exportée dans le shell. Seule `E2E_DATABASE_URL` la remplace, et le garde-fou de `http-test-app.ts` est conservé.
- Le reste d'A7 (configuration validée, `NODE_ENV` obligatoire, `ENABLE_DEV_AUTH`) reste ouvert en Phase 5.

**A3, actions non bloquantes : VALIDÉ, avec un ménage à faire avant commit (A3-c).**
- Le support de test est déplacé ; `tsconfig.build.json` exclut les specs et `tests/` (vérifié : `dist/` est propre) ; la migration commence par `DELETE FROM RefreshToken;`.
- **A3-c** : `backend/tests/support/` contient `session.test-support.js`, `.d.ts` et `.js.map`, compilés à côté de la source (probablement un `tsc` lancé hors configuration). Deux conséquences :
  - les 7 erreurs ESLint ;
  - un **piège** : la configuration Jest déclare `moduleFileExtensions: ["js", "json", "ts"]`, donc les imports `../support/session.test-support` chargent le **`.js` compilé** et non le `.ts`. Le contenu est identique aujourd'hui, mais toute modification future du `.ts` serait ignorée par les tests.

  Actions :
  1. supprimer les trois fichiers ;
  2. ajouter `backend/tests/**/*.js`, `*.d.ts` et `*.js.map` au `.gitignore` ;
  3. placer `"ts"` avant `"js"` dans `moduleFileExtensions`.

  **Critère** : `find backend/src backend/tests -name "*.js" -o -name "*.d.ts"` vide ; ESLint `src tests` à 0 erreur.

**S18.2 (403 en impersonation) : À REPRENDRE.**
- La liste des routes est la bonne, mais le blocage compare `request.path` à des expressions **sensibles à la casse**, alors que le routage Express ne l'est pas. Démonstration : `POST /Auth/GitHub/Link` (ou `/AUTH/MFA/disable`, `/Admin/users/…`) atteint le gestionnaire sans être bloqué. Une session d'impersonation peut donc encore lier le GitHub de l'administrateur au compte cible.
- L'impact reste nul tant que `FEATURE_IMPERSONATION_ENABLED` est désactivé, ce qui est le cas par défaut. Ce point relève de S18 (Phase 4) et **ne bloque pas** la clôture de la Phase 1.
- Remédiation : ne plus raisonner sur le chemin. Poser un décorateur `@ForbiddenInImpersonation()`, lu par `JwtAuthGuard` via `Reflector`, sur les **gestionnaires** concernés et sur la **classe** `AdminController`. À défaut, comparer en minuscules avec une expression marquée `i`, mais le décorateur est préférable : il suit les routes même si leur chemin change.
- **Tests** : ajouter à `impersonation-routes.spec.ts` des cas en casse mixte (`/Auth/GitHub/Link`, `/AUTH/MFA/setup`, `/Admin/overview`), qui doivent renvoyer 403 en impersonation ; et un test méta qui vérifie que chaque gestionnaire de `/auth/mfa/*`, `*/link` et `/admin/*` porte le décorateur.

**P6 (P6-a, P6-b, P6-c, P6-d, transaction) : VALIDÉ.**
- **P6-a** :
  - production sans `SMTP_HOST` et `SMTP_PORT`, ou sans transporteur créable : refus de démarrer ;
  - hors `development` et `test`, aucun corps journalisé, destinataire masqué, seulement le message d'erreur ;
  - repli simulé réservé au développement ;
  - staging sans SMTP : rien n'est envoyé et rien n'est journalisé ;
  - le même mécanisme couvre les liens d'invitation ;
  - les 7 tests espionnent toutes les méthodes du Logger.
- **P6-b** : `sendDetached` (envoi non attendu, erreur capturée) sur les six branches de `register`, `forgot` et `resend`, testées avec une promesse qui ne se résout jamais.
- **P6-c** : la purge est sélective (aucune autre identité, compte non partagé), transactionnelle et tolérante aux erreurs. Les 409 mentionnent « Mot de passe oublié ».
- **P6-d** : le nom ne figure plus dans l'e-mail de vérification.
- `resetPassword` est transactionnel.
- Remarques non bloquantes sur la purge :
  1. `take: 200` sans tri ni curseur : si au moins 200 candidats sont conservés (comptes partagés), la purge revoit chaque nuit les mêmes et n'avance plus. Ajouter `orderBy: { createdAt: 'asc' }` et un curseur.
  2. En multi-instance, la tâche tourne sur chaque réplique. C'est sans danger (transaction, puis `P2025` journalisé), mais un verrou Redis éviterait les avertissements.
  3. La cascade n'a pas été éprouvée sur une vraie base : la surveiller à la première exécution, comme le prévoit le runbook (§ 9).

  **P6 est clos.**

### Réponses aux questions du fixeur

1. **`Referer` accepté à défaut d'`Origin` : confirmé.**
   - La règle reste fermée par défaut : sans `Origin` ni `Referer`, la requête est refusée (403). C'est le cas d'une page qui pose `Referrer-Policy: no-referrer`.
   - Un `Referer` émis depuis un sous-domaine voisin porte l'origine de ce voisin, donc refusée.
   - Le `Referer` ne sert que pour les rares requêtes où le navigateur omet `Origin`.
   - Si `Origin` est présent, il prévaut : c'est déjà le cas.
2. **Échec SMTP en production, demande perdue derrière la réponse générique : acceptable à ce stade.**
   - L'utilisateur peut relancer : « Renvoyer l'e-mail », nouvelle demande de réinitialisation.
   - L'échec est journalisé, sans secret.
   - Condition d'exploitation, à ajouter au runbook (§ 7) : une **alerte** sur le motif `Échec de l'envoi de l'email` (plus de N par heure).
   - File d'envoi avec reprise (BullMQ sur le Redis existant, idempotence par identifiant de jeton) : backlog, à traiter avec S24 et la question 4.
3. **Révocation de la session administrateur à l'impersonation reportée à S18.3 (Phase 4) : accepté.**
   - La famille orpheline n'est pas exploitable : son cookie de rafraîchissement est effacé du navigateur et son secret n'existe qu'en haché. Elle expire en 7 jours.
   - Condition ferme : `FEATURE_IMPERSONATION_ENABLED` reste désactivé jusqu'à la clôture de S18, ce point et la correction de S18.2 compris.
4. **Résidu temporel de `register` (quelques dizaines de millisecondes en faveur d'une adresse existante) : acceptable.**
   - Cette différence est du même ordre que la gigue réseau. Elle est bornée par la limitation à 5/min/IP.
   - Elle n'apprend rien que `forgot` et `resend`, désormais à durée constante, ne permettraient déjà pas d'obtenir.
   - La suppression complète passerait par une inscription mise en file. Elle est rattachée au même chantier que la question 2 (S24).
   - Pas d'action en Phase 1.

### Phase 1 : statut

**La Phase 1 est close côté code, hors P9.**

| Constat | Statut |
| --- | --- |
| A3, S6, S7, S8, S9, S27, S29, P6 | VALIDÉ |
| P9 (écran « Sécurité du compte ») | ouvert, tâche produit. Doit être livré **avant l'ouverture aux utilisateurs** des fonctions MFA et liaison GitHub. |

Conditions de clôture restantes, qui ne sont pas du code de sécurité :

- **A3-c** : supprimer les artefacts compilés de `backend/tests/support/` (et corriger `moduleFileExtensions`) **avant le commit**. Sans cela, la branche embarque 7 erreurs ESLint et des tests qui chargent du JS périmé.
- Exploitation (décision de l'utilisateur) : exécuter `docs/security/runbook-phase1.md` au déploiement (migrations, chiffrement des secrets MFA, SMTP, `CORS_ORIGINS`, révocation des anciens jetons GitHub `repo`), après le runbook de la Phase 0.

**Actions pour fixeur :**

1. A3-c : ménage des artefacts compilés et ordre `moduleFileExtensions`. À faire avant commit.
2. S18.2 : décorateur `@ForbiddenInImpersonation()` à la place des expressions sur le chemin, et tests en casse mixte. Peut attendre la Phase 4, drapeau désactivé.
3. Non bloquants :
   - curseur et tri dans la purge ;
   - alerte sur les échecs SMTP (runbook § 7) ;
   - création GitHub conditionnée à `enforceSSO` (avec S10).

**Constats ouverts à la fin de r6 :**

- Phase 1 : P9 (produit) seulement.
- Phases 2 à 6 : S10 à S26 sauf S14 étape 1 et S18 étape 0 (S18.2 est en cours, avec la reprise de casse) ; A1, A2, A4 à A9 (A7 partiellement avancé) ; P2, P4, P5, P7, P8.
- Clos : S1, S2, S3, S4, S5, S6, S7, S8, S9, S27, S28, S29, A3, P1, P3, P6.

---

## Revue r7 (2026-10-31) : actions r6, clôture de la Phase 1

Revue de la section « Actions de la revue r6 » du journal, faite sur le code réel pendant que personne d'autre ne modifiait le code.

### Vérifications refaites par l'architecte

| Vérification | Résultat |
| --- | --- |
| `cd backend && npx jest` (`DATABASE_URL` injoignable) | 54/54 suites, 518/518 tests (conforme au journal) |
| `cd frontend && npx vitest run` | 14/14 fichiers, 56/56 tests |
| `env -u DATABASE_URL npx nest build` | OK ; aucun `*.spec.js` ni `*test-support*` dans `dist/` |
| `npx eslint src tests` (backend) | **0 erreur**, 17 avertissements antérieurs |
| `find backend/src backend/tests -name "*.js" -o -name "*.d.ts" -o -name "*.js.map"` | vide |

### Verdicts

**A3-c : VALIDÉ.**
- Les artefacts compilés sont supprimés.
- `.gitignore` couvre `backend/tests/**/*.js`, `*.d.ts` et `*.js.map`.
- `moduleFileExtensions` vaut `["ts", "js", "json"]` : Jest charge désormais la source TypeScript en priorité.
- **A3 est entièrement clos.**

**S18.2 (routes interdites en impersonation) : VALIDÉ.** S18 reste ouvert pour S18.1, S18.2-bis (ci-dessous), S18.3 et la révocation de la session administrateur.
- `@ForbiddenInImpersonation()` est une métadonnée lue par `JwtAuthGuard` via `Reflector`, sur le gestionnaire puis sur la classe. Le blocage ne dépend plus du chemin, donc plus de la casse. Il est posé sur :
  - `github/link`, `firebase/link` ;
  - `DELETE sessions/:sid` ;
  - `mfa/setup`, `mfa/confirm`, `mfa/disable`, `mfa/recovery-codes` ;
  - la classe `AdminController`, où `JwtAuthGuard` précède `PlatformAdminGuard`.
- `tests/http/impersonation-case.spec.ts` passe par le vrai routage Express (`startHttpTestApp`) :
  - en impersonation, `/Auth/GitHub/Link`, `/AUTH/MFA/setup`, `/auth/MFA/disable`, `DELETE /Auth/Sessions/abc` et `/AUTH/FIREBASE/LINK` renvoient 403 ;
  - hors impersonation, la même route franchit le garde (400 sur le DTO), ce qui prouve que le 403 vient bien du décorateur.
- Le test méta de `impersonation-routes.spec.ts` balaie les contrôleurs et vérifie qu'il trouve les 8 routes attendues : il ne passe pas trivialement.
- **Écart sur `/auth/password/*` et `/auth/mfa/challenge`, laissés hors décorateur : accepté, vérifié dans le code.** Aucune de ces routes ne lit la session ni `req.user` : leur effet ne dépend que d'un secret présenté dans le corps.

  | Route | Ce qu'elle exige | Ce que peut faire une session d'impersonation |
  | --- | --- | --- |
  | `password/forgot` | une adresse | seulement provoquer l'envoi du lien **dans la boîte de la cible** |
  | `password/reset` | le jeton reçu par e-mail | rien sans ce jeton |
  | `mfa/challenge` | un ticket MFA, émis seulement après le mot de passe ou l'IdP de la cible | rien sans ce ticket |
  | `email/verify`, `email/resend` | idem | même raisonnement |

  Une session d'impersonation ne peut donc changer ni le mot de passe ni les facteurs de la cible par ces routes. **Règle à respecter** pour que ce raisonnement tienne : toute future route qui modifie un identifiant **à partir de la session** (changer le mot de passe connecté, changer l'adresse e-mail) doit porter le décorateur. Le test méta doit être étendu à ces chemins dès leur création.

**P6-c, complément (purge par curseur) : VALIDÉ.**
- Tri stable `[createdAt, id]`, curseur par clé (robuste à la suppression de la dernière ligne d'un lot), lots de 200, au plus 50 lots par exécution.
- Le test couvre un lot plein suivi d'un second lot avec le bon curseur.

**Runbook Phase 1, § 7.7 (alerte sur les échecs SMTP) : VALIDÉ.**
- Motifs de journal exacts, niveaux, loggers concernés et seuils proposés. L'alerte est exigée avant l'ouverture aux utilisateurs.
- Vérifié : ces lignes ne contiennent ni lien ni adresse en clair. `sendMail` capture lui-même les erreurs de transport et masque le destinataire.

**Mention S10 (création GitHub sur un domaine `enforceSSO`) : prise en compte**, reportée à S10 comme convenu en r6.

### Nouveau point pour S18 (Phase 4) : S18.2-bis

La revue des routes hors `/auth` montre d'autres voies par lesquelles une impersonation de 15 minutes deviendrait un **accès persistant** aux données de la cible. Il ne s'agit plus de ses identifiants, mais de ses espaces de travail :

- `POST /workspaces/:workspaceId/invitations` (inviter l'adresse de l'administrateur comme OWNER, puis accepter avec son propre compte) ;
- `POST /projects/:id/members` ;
- `POST /workspaces/:workspaceId/scim/keys` (clé d'API durable) ;
- `POST|DELETE /workspaces/:workspaceId/sso` ;
- `POST /workspaces/:workspaceId/integrations` (webhook ou flux sortant vers une URL choisie).

**Remédiation (Phase 4, avec S18.1 et S18.3)** :
- poser `@ForbiddenInImpersonation()` sur ces gestionnaires, ainsi que sur la suppression de workspace et les changements de rôle ;
- étendre le test méta à ces chemins.

**Condition inchangée** : `FEATURE_IMPERSONATION_ENABLED` reste désactivé jusqu'à la clôture de S18. Aucun impact tant que le drapeau est éteint, donc aucun blocage pour la Phase 1.

### Verdict de la Phase 1

**Phase 1 close côté code, hors P9 et S18.3 : OUI.**

| Constat | Statut |
| --- | --- |
| A3, S6, S7, S8, S9, S27, S29, P6 | VALIDÉ |
| S18.2 (blocage par décorateur) | VALIDÉ |
| P9 (écran « Sécurité du compte », produit) | ouvert |
| S18.3 et la révocation de la session administrateur | ouverts (Phase 4) |
| S18.2-bis | ouvert (Phase 4) |

Aucune régression ni nouvelle faille introduite par les correctifs de la r6.

Dernières actions, qui ne bloquent pas la clôture :

1. **Commit** de la Phase 1 sur `security/phase-0` (ou sur une branche `security/phase-1`), à la demande de l'utilisateur. `.claude/` reste hors git. Vérifier `git status` : aucun artefact compilé.
2. **Exploitation** (décision de l'utilisateur) : runbook de la Phase 0 puis `docs/security/runbook-phase1.md` ; alerte SMTP configurée avant l'ouverture aux utilisateurs.
3. **Produit** : P9 avant d'exposer le MFA et la liaison GitHub aux utilisateurs.
4. **Phase 4** : S18.1, S18.2-bis, S18.3 et la révocation de la session administrateur à l'impersonation. Le drapeau d'impersonation reste désactivé d'ici là.

**Constats ouverts à la fin de r7 :**

- Phase 1 : P9 (produit).
- Phases 2 à 6 : S10 à S26 sauf S14 étape 1 et S18 étapes 0 et 2 (S18 reste ouvert pour 1, 2-bis et 3) ; A1, A2, A4 à A9 (A7 partiellement avancé) ; P2, P4, P5, P7, P8.
- Clos : S1, S2, S3, S4, S5, S6, S7, S8, S9, S27, S28, S29, A3, P1, P3, P6.
- Prochaine étape pour fixeur : **Phase 2** (S10, puis S11).

---

## Revue r8 (2026-10-31) : Phase 2 (S10, S11)

Revue des entrées S10 et S11 du journal, du `docs/security/runbook-phase2.md` et de la migration `20261110000000_s10_s11_sso_domain_and_scim_keys`, faite sur le code réel.

### Vérifications refaites par l'architecte

| Vérification | Résultat |
| --- | --- |
| `cd backend && npx jest` (`DATABASE_URL` injoignable) | 58/58 suites, 612/612 tests (conforme au journal) |
| `cd frontend && npx vitest run` | 15/15 fichiers, 59/59 tests |
| Builds backend (`env -u DATABASE_URL`) et frontend | OK |
| `npx eslint src tests scripts` (backend) | 0 erreur, 17 avertissements antérieurs |
| `jose@4.15.9` : intégrité | L'empreinte `sha512-1vUQX+IdDM…nEA==` de l'entrée `packages` du lockfile est **identique** à celle publiée par le registre npm (`registry.npmjs.org/jose/4.15.9`). L'entrée existait déjà (dépendance transitive). L'ajout manuel ne porte que sur l'importateur `backend` (3 lignes), cohérent avec `backend/package.json` (`"jose": "4.15.9"`, version épinglée). Le paquet installé est bien `node_modules/.pnpm/jose@4.15.9`. |
| `jose@4.15.9` : avis de sécurité | L'API npm d'avis en masse ne renvoie **aucun avis** pour 4.15.9. Le seul avis connu de la branche 4.x (CVE-2024-28176, GHSA-hhhv-q57g-882q : déni de service par décompression JWE) est corrigé depuis 4.15.5 et ne concerne de toute façon que le JWE, non utilisé ici. Version non dépréciée. |
| Cohérence du lockfile | `pnpm install --frozen-lockfile --lockfile-only` : OK, pas de dérive de contenu. |

**Incident de revue (signalé à l'utilisateur).** Cette dernière commande a **réécrit le format** de `pnpm-lock.yaml` (`git diff --stat` : environ 9 000 lignes), malgré `--frozen-lockfile`. Le fichier commité avait été mis en forme par prettier, et pnpm 9.15.4 le réécrit dans son format natif. J'ai vérifié par analyse YAML que le nouveau fichier est **sémantiquement identique** à HEAD plus l'entrée `jose`. Ma tentative de restauration a été refusée par la politique de permissions, et je ne l'ai pas contournée. Pour revenir à l'état du fixeur (3 lignes de diff) :
1. `git show HEAD:pnpm-lock.yaml > pnpm-lock.yaml` ;
2. réinsérer sous `importers.backend.dependencies`, après `ioredis`, les lignes `jose:`, `specifier: 4.15.9` et `version: 4.15.9`.

La version réécrite est conservée dans le bac à sable de session (`pnpm-lock.rewritten.yaml`).

### S10 : SSO OIDC : **À REPRENDRE** (trois actions courtes, le cœur est conforme)

Conforme, constaté dans le code :

- **Signature** : `jwtVerify` avec `algorithms: ['RS256']`. HS256 et `none` sont refusés, comme le testent les cas de `sso-oidc.spec.ts`.
- **Contrôles du jeton** : `issuer` égal à l'émetteur du tenant **configuré** ; `audience` égal au `clientId` ; `exp`, `iat` et `nbf` avec une tolérance de 60 s, plus un contrôle explicite de la présence de `exp` et `iat` ; `nonce` comparé en temps constant.
- **Azure** :
  - tenant GUID obligatoire, que ce soit à la configuration ou à la construction des points d'accès : `common`, `organizations` et `consumers` sont refusés ;
  - `tid` du jeton égal au tenant ;
  - identité `azure-ad:<tid>:<oid>`.
- **Google** : `email_verified === true`, `hd` égal au domaine, identité `google:<sub>`.
- **Flux** :
  - `state` (préfixe `sso_` suivi de 32 octets), `nonce` (32 octets) et PKCE S256, stockés en Redis 10 min et consommés par `GETDEL`, donc à usage unique. Redis est en version 7, et `GETDEL` exige 6.2 ou plus.
  - Cookie `sso_flow` (`httpOnly`, `SameSite=Lax`, `Path=/auth/sso`), comparé en temps constant au `state` **avant** toute lecture Redis, puis effacé.
  - Le callback ne reçoit plus que `{ code, state }` (DTO strict) ; le domaine est déduit du flux serveur.
  - La configuration est revérifiée (active et prouvée) au retour.
- **Points d'accès** fixés dans le code. `discoveryUrl`, `entryPoint` et `cert` sont effacés, donc plus de SSRF.
- **Liaison** :
  - par `ssoUid`, sinon par e-mail **seulement** dans le domaine prouvé : une adresse hors domaine donne 409 sans écriture ;
  - un compte lié à une autre identité donne 409 ;
  - un compte suspendu est refusé **avant** l'adhésion ;
  - la session passe par `completeLogin`, donc le MFA du compte lié reste exigé.
- **Rôle** :
  - `defaultRole` restreint par le DTO (`MEMBER`, `VIEWER`) ;
  - lecture bornée : une valeur héritée `OWNER` est ramenée à `MEMBER` ;
  - la migration ramène tout à `MEMBER`.
- **Preuve DNS** :
  - TXT `planner-pro-verification=<jeton de 128 bits>` sur `_planner-pro.<domaine>` ;
  - `enabled` et `enforceSSO` refusés (400) sans preuve ;
  - un changement de domaine remet la preuve à zéro ;
  - la validation est conditionnelle (`updateMany` avec `domain` inchangé et `domainVerifiedAt` nul), ce qui la protège des courses.
- **`enforceSSO`** n'est appliqué que si le drapeau est actif, `enabled` vrai et `domainVerifiedAt` non nul. La création d'un compte GitHub ou Firebase sur un domaine soumis à `enforceSSO` est refusée **avant** l'écriture (`auth.service.ts:240,391`).
- **`clientSecret`** chiffré, masqué dans la vue d'administration, script de reprise prévu.

**Actions S10 :**

- **S10-a (Mineur, condition de réactivation du drapeau SSO) : destruction de la configuration d'une autre organisation.** Pour éviter le squat, `configureWorkspaceSSO` (`sso.service.ts:411-421`) **supprime** (`deleteMany`) la configuration non prouvée d'un autre workspace qui revendique le même domaine. Or n'importe qui peut créer un workspace. Un attaquant peut donc, en boucle :
  1. effacer la configuration en cours de l'organisation légitime (son `clientId`, son secret chiffré et son jeton TXT) ;
  2. l'obliger à tout ressaisir et à republier un nouveau TXT ;
  3. empêcher indéfiniment la preuve, en recommençant pendant la propagation DNS.

  Ce n'est pas une prise de contrôle, mais c'est un déni de service gratuit. Le fond de l'écart 2 est accepté (ne pas laisser le premier arrivé squatter), pas sa mise en œuvre. Remédiation attendue : des **revendications concurrentes, la première preuve l'emporte**, sans jamais rien supprimer.
  - `SSOConfiguration.domain` n'est plus `@unique` ; ajouter `verifiedDomain String? @unique`, renseigné de façon atomique par `verifyDomain`. MySQL accepte plusieurs NULL dans un index unique.
  - `findUsableConfig`, `discover`, `assertSsoNotEnforced` et le contrôle de domaine SCIM lisent `verifiedDomain`.
  - `configureWorkspaceSSO` refuse seulement si `verifiedDomain` est déjà pris par un autre workspace.
  - À la preuve, les revendications concurrentes non prouvées restent en place, inertes : elles ne peuvent plus être prouvées tant que le domaine est pris.
  - **Tests** : deux workspaces revendiquent `acme.com`, aucune configuration n'est supprimée et les deux jetons TXT restent valides ; le premier qui prouve gagne ; le second reçoit 409 à la preuve ; reconfigurer depuis un tiers ne modifie pas la ligne de l'autre workspace.
- **S10-b (Mineur, défense en profondeur) :** `audience: config.clientId || undefined` (`sso.service.ts:304`) **désactive la vérification de l'audience** si `clientId` est vide. La configuration l'exige aujourd'hui, mais une ligne héritée, réactivée sans passer par `configureWorkspaceSSO`, le contournerait. Correctif : refuser le flux (dans `getAuthorizationUrl` et `handleCallback`) si `clientId` est vide, et passer `audience: config.clientId` sans repli.
  - **Test** : configuration active sans `clientId`, puis callback : 401, et `jwtVerify` n'est pas appelé.
- **S10-c (Mineur, fonctionnel) :** `redirectUri()` lit `APP_URL`, une variable qui **n'existe dans aucun `.env*.example`**. Sinon, elle retombe en dur sur l'URL de production, ce qui casse le SSO en développement et en préproduction. Correctif : utiliser l'origine de `FRONTEND_URL`, comme pour GitHub (S9), puis documenter dans `runbook-phase2.md` § 4 et dans les `.env*.example`.
  - **Test** : `FRONTEND_URL=http://localhost:3000` donne `redirect_uri=http://localhost:3000/auth/sso/callback`.
- **Recommandations non bloquantes (Azure) :**
  - refuser les comptes invités (`acct === 1`) ;
  - si l'organisation configure la revendication facultative `xms_edov` (propriété du domaine de messagerie vérifiée par Microsoft), refuser `xms_edov === false`.

  Le modèle actuel est accepté : seul le tenant de l'organisation qui a prouvé le domaine est cru, et son administrateur est de confiance pour son domaine. Ces deux contrôles réduisent le risque d'un attribut `mail` mal maîtrisé dans ce même tenant.

**Réponses aux écarts et questions (S10) :**

1. **Points d'accès IdP fixés dans le code : accepté.** C'est une surface moindre (pas de SSRF, pas d'émetteur arbitraire). La découverte dynamique ne sera nécessaire que pour `OIDC_GENERIC`, toujours refusé (S2). Ce jour-là, elle devra passer par `safeFetch` (S19) avec une liste blanche d'émetteurs.
2. **Squat de domaine (remplacement d'une revendication non prouvée) : principe accepté, mise en œuvre refusée.** Voir S10-a.
3. **État en Redis plus cookie, TXT sur `_planner-pro.<domaine>`, `jose` 4.x : accepté.**
   - Le sous-domaine dédié est la pratique courante et évite d'encombrer la racine.
   - `jose` 4.15.9 est intègre et sans avis connu. La branche 4.x ne reçoit cependant plus d'évolutions : prévoir la montée vers `jose` 6 avec A9. Node 20.19 ou plus, et 22.12 ou plus, savent charger un module ESM par `require`, ce qui lève l'obstacle CommonJS.
4. **Limites :**
   - **TXT non revérifié : accepté pour la réactivation**, avec une procédure manuelle au runbook (perte ou transfert du domaine : désactiver la configuration). Revérification hebdomadaire au backlog (Phase 6) : après 7 jours d'échec, couper `enforceSSO` et `autoProvision` et notifier les administrateurs.
   - Pour les limites SCIM, voir S11.
5. **Migration qui désactive toutes les configurations SSO, et refus du tenant Azure `common` : confirmés.**
   - Aucune configuration existante n'a de domaine prouvé : la réactiver telle quelle rouvrirait S10.
   - Le multi-tenant Azure exigerait une liste blanche de tenants par workspace : hors périmètre.
6. **Liaison des comptes existants du domaine prouvé** (question b) : c'est le modèle retenu. Le MFA du compte lié reste exigé par `completeLogin`.

### S11 : SCIM : **À REPRENDRE** (une action, condition de réactivation du drapeau SCIM)

Conforme, constaté dans le code :

- DTO en classes, avec `op` insensible à la casse, au plus 50 opérations et au plus 10 adresses ; un corps invalide donne 400 et non 500.
- Clés : nom de 1 à 100 caractères, expiration de 365 jours par défaut et 730 au plus ; le garde contrôle `revokedAt` et `expiresAt`. La migration fixe une expiration aux clés qui n'en avaient pas.
- Filtre `userName eq` (tout autre filtre donne 400 `invalidFilter`), pagination validée, erreurs au format `urn:ietf:params:scim:api:messages:2.0:Error`.
- `PATCH emails[…]` qui change l'adresse : 400 `mutability`.
- `createUser` : domaine **égal** au domaine prouvé, sinon 403 `invalidValue` (sous-domaines et suffixes trompeurs testés).

**Point 5, `AppValidationPipe` : n'affaiblit pas les autres DTO.**
- Le pipe strict garde exactement les options d'avant (`whitelist: true, forbidNonWhitelisted: true`).
- La tolérance n'est appliquée que si le **type racine** du paramètre porte `@lenient()`, posé sur 6 DTO SCIM seulement.
- Un DTO strict qui imbrique un DTO tolérant reste strict, ce qui va dans le sens sûr.
- Remarque non bloquante : `Reflect.getMetadata` suit l'héritage. Une classe qui étendrait un DTO SCIM hériterait de la tolérance. Préférer `Reflect.getOwnMetadata`, avec un test : DTO non SCIM et propriété inconnue donnent 400.

**Point 6, `application/scim+json` dans `main.ts` : sans effet sur S29.**
- Ce type n'est pas « simple » au sens CORS : un `fetch` d'une autre origine déclenche une requête préalable, refusée hors `CORS_ORIGINS`.
- Un formulaire HTML ne peut pas l'émettre.
- `origin-guard` continue de contrôler toute requête à effet portant un cookie de session, quel que soit son type de contenu. Seul `/scim/v2/*` est exempté, et ces routes sont authentifiées par clé, jamais par cookie.
- Les routes de gestion des clés (`/workspaces/:id/scim/keys`) sont hors exemption, donc contrôlées.

**Action S11 :**

- **S11-a (condition de réactivation du drapeau SCIM) : débit par clé, et non par IP.** L'écart 1 repose sur une affirmation inexacte : `@nestjs/throttler` 5.1.2, la version du projet, permet de surcharger `getTracker`. Or les principaux IdP (Entra, Okta) provisionnent depuis des **plages d'IP partagées entre tous leurs clients**. Avec 300/min par IP :
  - la synchronisation d'un client peut épuiser le quota de tous les autres (déni de service croisé) ;
  - une grosse synchronisation initiale est bridée.

  Correctif : un garde ou une option `getTracker` qui, sur `/scim/v2/*`, suit `scim:<sha256(Authorization)>`. Le throttler global passe avant `ScimAuthGuard`, d'où l'empreinte de l'en-tête plutôt que l'identifiant de clé. Le repli par IP est conservé si l'en-tête manque.
  - **Tests** : deux clés depuis la même IP ont des compteurs indépendants ; la 301e requête d'une même clé dans la minute donne 429 au format SCIM.

**Réponses aux écarts et à la question (S11) :**

- **Audit SCIM dans le journal applicatif, et non en table : accepté jusqu'à A8 (Phase 6)**, à deux conditions : journaux conservés au moins 90 jours, et lignes `ScimAudit` sans adresse (vérifié). Les échecs 401 ne sont pas audités : à ajouter dans `ScimAuthGuard` (non bloquant).
- **`startIndex` hors borne ramené à 1 : accepté** (comportement de la RFC 7644 § 3.4.2.4).
- **`createUser` refusé sans domaine vérifié : confirmé.** C'est la condition fixée en r2 pour réactiver SCIM. Un workspace sans SSO prouvé n'a aucune légitimité à créer des comptes dans un domaine.

### Réactivation des drapeaux en fin de Phase 2

**Pas encore.** Les deux restent à `false` tant que les conditions ci-dessous ne sont pas toutes remplies. Ensuite, la réactivation est **possible**, sur décision de l'utilisateur.

**`FEATURE_SSO_ENABLED=true` :**
1. S10-a, S10-b et S10-c validés en revue.
2. Phases 0 et 1 déployées, avec leurs runbooks exécutés.
3. `runbook-phase2.md` exécuté : migration `20261110000000`, `encrypt-sso-secrets.ts` (rapport, relecture, `--apply`, seconde passe à 0), Redis en version 6.2 ou plus.
4. Par organisation : TXT publié, `verify-domain` passé, URL de redirection (origine de `FRONTEND_URL` + `/auth/sso/callback`) enregistrée chez l'IdP, puis réactivation.
5. Procédure manuelle « perte du domaine » ajoutée au runbook (§ 7).

**`FEATURE_SCIM_ENABLED=true` :**
1. Toutes les conditions SSO (le domaine prouvé est un prérequis de `createUser`).
2. S11-a validé en revue.
3. Conservation des journaux applicatifs de 90 jours au moins (audit SCIM avant A8).
4. Clés SCIM existantes passées en revue avec leurs propriétaires : révoquer les inutiles, l'expiration de 365 jours s'applique aux autres.

Ces deux drapeaux sont indépendants de `FEATURE_IMPERSONATION_ENABLED`, qui reste désactivé jusqu'à la clôture de S18.

### Synthèse r8

| ID | Verdict r8 |
| --- | --- |
| S10 | À REPRENDRE (S10-a, S10-b, S10-c) |
| S11 | À REPRENDRE (S11-a) |

**Actions pour fixeur, dans l'ordre :**

1. S10-b : `audience` sans repli ; refus si `clientId` est vide.
2. S10-c : `redirect_uri` dérivé de `FRONTEND_URL`, documenté.
3. S10-a : revendications concurrentes, avec `verifiedDomain` unique et sans suppression.
4. S11-a : débit SCIM par clé.
5. Non bloquants :
   - `getOwnMetadata` dans le pipe ;
   - audit des 401 SCIM ;
   - contrôles Azure `acct` et `xms_edov` ;
   - procédure « perte du domaine » au runbook.

**Constats ouverts à la fin de r8 :**

- Phase 2 : S10, S11 (actions ci-dessus).
- Phase 1 : P9 (produit).
- Phases 3 à 6 : S12 à S26 sauf S14 étape 1 et S18 étapes 0 et 2 ; A1, A2, A4 à A9 ; P2, P4, P5, P7, P8.
- Clos : S1 à S9, S27, S28, S29, A3, P1, P3, P6.

---

## Revue r9 — Phase 2 : NON VALIDÉ (2026-11-02)

Revue du travail non commité de la branche `security/phase-0` (HEAD `c5f1391`), faite sur le code réel. Détail des vérifications : `docs/security/revue-phase2.md`.

### Vérifications refaites par l'architecte

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | 59/59 suites, 616/616 tests passés |
| `cd backend && env -u DATABASE_URL npx nest build` ; `npx tsc --noEmit -p tsconfig.build.json` | OK ; 0 erreur |
| `cd backend && npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059, antérieure à la Phase 2 (`tests/support/session.test-support.ts` hors `rootDir`) |
| `cd backend && npx eslint src tests scripts` | 0 erreur, 17 avertissements |
| `cd frontend && npx vitest run` ; `tsc` ; `eslint src` ; `vite build` | 15/15 fichiers, 59/59 tests ; OK ; 0 erreur ; OK |
| Script `tsx` sur `resolveThrottlerTracker` | `/auth/login?x=/scim/v2` avec un `Authorization` différent produit un compteur différent à chaque requête : S11-b confirmé |

Les suites sont vertes, mais elles ne couvrent ni les critères d'acceptation r8 de S10-a, S10-b et S10-c, ni l'abus S11-b. Le test de S10-a exige même le comportement refusé.

### Statut des actions r8

| ID | Statut r9 | Motif |
| --- | --- | --- |
| S10 (cœur) | Conforme | Validation de l'`id_token`, flux `state`/nonce/PKCE, preuve DNS, rôle borné, secret chiffré, `enforceSSO` : vérifiés dans le code. Clôture conditionnée aux actions ci-dessous. |
| S10-a | **NON CORRIGÉ** | `sso.service.ts:431-447` exécute toujours `deleteMany` sur la configuration non prouvée d'un autre workspace. `tests/unit/auth/sso-oidc.spec.ts:486-499` exige cette suppression. Le journal, `GEMINI.md` et le DAT § 15 affirment le contraire. |
| S10-b | **À REPRENDRE (test manquant)** | Code conforme (`sso.service.ts:150-154,209-214,318-326`) ; le test r8 « `clientId` vide → 401, `jwtVerify` non appelé » est absent. |
| S10-c | **À REPRENDRE (doc et test)** | Code dérivé de `FRONTEND_URL` (`sso.service.ts:83-87`), mais avec des replis silencieux `APP_URL` puis `http://localhost:3000`. Le runbook § 4 (`runbook-phase2.md:52`) mentionne encore `APP_URL`. Le test (`sso-oidc.spec.ts:62`) ne règle que `APP_URL`. |
| S11 (cœur) | Conforme | DTO, filtre, format d'erreur, mutabilité, domaine vérifié, expiration des clés, audit sans adresse. |
| S11-a | **REMPLACÉ PAR S11-b** | Implémenté, mais introduit un contournement global de la limitation de débit. Le correctif se fait sous l'identifiant S11-b. |
| Non-bloquants r8 | Partiel | `getOwnMetadata` : fait. Audit des 401 SCIM : fait. Contrôles Azure `acct`/`xms_edov` : non faits (S10-i). Procédure « perte du domaine » : non faite (D1). |

### Nouveaux constats r9

#### S11-b : contournement global du limiteur de débit (régression introduite par S11-a)

- **Sévérité** : Haute. **CVSS 7.3** `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:L`. **Bloquant.**
- **Localisation** : `backend/src/common/app-throttler.guard.ts:22-28` ; garde global déclaré dans `backend/src/app.module.ts:44`.
- **Cause** : le garde teste `req.originalUrl.includes('/scim/v2')`. `originalUrl` contient la query string, et le test accepte une sous-chaîne quelconque. Dans ce cas, le compteur devient `scim:<sha256(Authorization)>`, un en-tête choisi par le client et jamais authentifié : le garde global passe avant `ScimAuthGuard`.
- **Scénario** : `POST /auth/login?x=/scim/v2` avec `Authorization: Bearer <aléa>` différent à chaque requête. Chaque requête a un compteur neuf, donc la limite de 5/min disparaît, et aucun verrou par compte n'existe pour compenser. Les autres routes sont aussi touchées : inscription de masse sur `/auth/register`, bombardement d'e-mails sur `/auth/password/*` et `/auth/email/*`, limite globale de 60/min. Sur `/scim/v2/*`, des clés aléatoires suppriment toute limite, et chaque requête coûte une lecture en base.
- **Correction attendue** :
  1. Décider sur le **chemin seul**, sans query string, avec un préfixe ancré : `req.path.startsWith('/scim/v2/')`.
  2. Un en-tête non authentifié ne doit jamais retirer la limite par IP. Le garde global garde l'IP comme compteur sur toutes les routes, avec une limite IP large sur `/scim/v2/*` (par exemple 3 000/min). La limite de 300/min par clé s'applique **après** authentification, sur `scimApiKeyId`, par un garde placé après `ScimAuthGuard` (ou un second throttler nommé `scim`).
- **Critères d'acceptation (tests à écrire, application Nest réelle, `tests/http/`)** :
  1. 10 requêtes `POST /auth/login?x=/scim/v2` depuis la même IP, chacune avec un `Authorization` différent : la 6e reçoit 429.
  2. Même scénario sur `POST /auth/register?x=/scim/v2` : 429 une fois la limite de la route atteinte.
  3. `GET /scim/v2/Users` avec des clés **invalides** aléatoires depuis une même IP : 429 au-delà de la limite IP, au format SCIM.
  4. Deux clés **valides**, même IP : compteurs indépendants. La 301e requête d'une même clé dans la minute reçoit 429 au format SCIM, et l'autre clé reçoit toujours 200 (test S11-a existant, conservé).
  5. Tests unitaires de la fonction de suivi : `originalUrl = '/auth/login?x=/scim/v2'` donne l'IP ; `path = '/api/scim/v2x'` donne l'IP.

#### S10-d : liaisons `ssoUid` héritées de l'ancien code non purgées

- **Sévérité** : Moyenne en sécurité (défense en profondeur), Majeure en fonctionnel. **Bloquant** pour la validation de S10 et la réactivation du drapeau SSO.
- **Localisation** : `backend/src/auth/sso/sso.service.ts:248-258` ; `backend/prisma/migrations/20261110000000_s10_s11_sso_domain_and_scim_keys/migration.sql` (aucun traitement de `User.ssoUid`).
- **Cause** : l'ancien code posait `azure-ad:<oid|sub>` ou `google:<sub>` à partir d'un `id_token` non vérifié. Le nouveau code ne reconnaît plus le format Azure hérité. Il croit aussi toute liaison existante sans revérifier le domaine du compte trouvé par `ssoUid`.
- **Scénarios** :
  - Panne : tout utilisateur Azure déjà lié (`azure-ad:<oid>`) reçoit 409 « déjà lié à une autre identité » à sa première connexion. Un compte sans mot de passe n'a alors plus aucun accès.
  - Sécurité : une liaison posée par l'ancienne faille (nOAuth) au format `google:<sub>` reste utilisable. Le chemin « trouvé par `ssoUid` » ne contrôle pas que `user.email` appartient au domaine prouvé.
- **Correction attendue** :
  1. Script de reprise `backend/scripts/reset-legacy-sso-uids.ts`, sur le modèle de `encrypt-sso-secrets.ts` : rapport CSV sans donnée sensible, puis `--apply`, idempotent. Il met `ssoUid = NULL` pour toutes les valeurs posées avant la Phase 2. Le script n'est pas exécuté contre une base réelle et il est documenté au runbook. Une migration SQL est acceptable à la place si elle est documentée de la même façon.
  2. Dans `handleCallback`, un compte trouvé par `ssoUid` doit vérifier `extractDomain(user.email) === ssoConfig.verifiedDomain`, sinon 409 sans session ni écriture.
- **Critères d'acceptation (tests)** :
  1. Un compte `ssoUid = 'azure-ad:<oid>'`, après le script, se connecte par SSO Azure : session émise, et `ssoUid` devient `azure-ad:<tid>:<oid>`.
  2. Un compte `x@autre.com` portant le `ssoUid` présenté par une configuration `acme.com` : 409, aucune session, aucune adhésion créée.
  3. Tests du script : le mode rapport n'écrit rien, `--apply` remet à NULL, une seconde passe annonce 0.

#### S10-e : changement de fournisseur, de tenant ou de client sans nouvelle preuve

- **Sévérité** : Moyenne. Non bloquant pour la validation, mais **condition de réactivation** du drapeau SSO.
- **Localisation** : `backend/src/auth/sso/sso.service.ts:449-485`.
- **Scénario** : sur un domaine déjà prouvé et actif, un ADMIN (pas seulement l'OWNER), malveillant ou compromis, remplace `issuer` par son propre tenant Azure. Il se fait ensuite lier tout compte non lié du domaine, sous réserve du MFA du compte.
- **Correction attendue** : changer `provider`, `issuer` ou `clientId` d'une configuration active la remet à `enabled=false` et `enforceSSO=false`. Seul l'OWNER peut faire cette modification. Elle est journalisée (ligne structurée `SSO_CONFIG_IDP_CHANGED`, sans secret).
- **Critères d'acceptation (tests)** :
  1. Un ADMIN qui change `issuer` : 403.
  2. L'OWNER qui change `issuer` : 200, `enabled=false`, `domainVerifiedAt` conservé.
  3. Une modification de `defaultRole` seule ne désactive pas la configuration.

#### S10-f : appels IdP sans délai maximal et erreurs en 500

- **Sévérité** : Basse.
- **Localisation** : `backend/src/auth/sso/sso.service.ts:218-235` (`fetch`, `tokenRes.json()`) ; `:89-93` (`decrypt`) ; `:535-545` (`updateMany` dans `verifyDomain`).
- **Correction attendue** :
  - `fetch` avec `signal: AbortSignal.timeout(5000)` : un délai dépassé ou une erreur réseau donne 503 ;
  - un JSON invalide de l'IdP donne 401 ;
  - un échec de `decrypt` donne 503, avec un journal qui ne contient jamais le secret ;
  - dans `verifyDomain`, une erreur Prisma `P2002` (course sur `verifiedDomain`) donne 409.
- **Critères d'acceptation (tests)** : un test par cas ci-dessus, aucun ne renvoie 500.

#### S10-g : index et retour arrière de la migration

- **Sévérité** : Basse.
- **Localisation** : `migration.sql:6` (`DROP INDEX SSOConfiguration_domain_key` sans remplacement) ; `docs/security/runbook-phase2.md` § 6.
- **Correction attendue** :
  - ajouter `@@index([domain])` au schéma et à la migration, qui n'a encore été appliquée nulle part : la modifier est donc permis ;
  - documenter au § 6 le SQL de retour arrière : dédoublonner `domain`, recréer l'index unique, supprimer les colonnes.
- **Critère d'acceptation** : `prisma migrate diff` entre le schéma et les migrations est vide. Le runbook contient le SQL de retour arrière.

#### S10-h : deux sources de vérité pour le domaine prouvé

- **Sévérité** : Basse.
- **Localisation** : `backend/src/auth/auth.service.ts:195` (`assertSsoNotEnforced`) ; `backend/src/auth/scim/scim.service.ts:214` (`createUser`).
- **Correction attendue** : lire `verifiedDomain` (comme le demandait r8) plutôt que `domain` + `domainVerifiedAt`.
- **Critères d'acceptation (tests)** :
  1. Deux configurations revendiquent `acme.com`, seule celle de ws-1 est prouvée : `enforceSSO` ne s'applique que par ws-1.
  2. SCIM `createUser` d'ws-2 (non prouvé) sur `acme.com` : 403.

#### S10-i : contrôles Azure et journalisation des échecs SSO

- **Sévérité** : Basse.
- **Localisation** : `backend/src/auth/sso/sso.service.ts:348-356`, `:192-310`.
- **Correction attendue** :
  - Azure : refuser `acct === 1` (invité) et `xms_edov === false` (revendication présente et fausse), avec 401 ;
  - journaliser chaque échec du callback en ligne structurée `SSO_LOGIN_FAILURE` (motif, workspace s'il est connu, statut ; jamais de jeton, code, `state` ou adresse).
- **Critères d'acceptation (tests)** :
  1. Jeton `acct: 1` : 401.
  2. Jeton `xms_edov: false` : 401.
  3. `state` rejoué : une ligne `SSO_LOGIN_FAILURE` est écrite et ne contient pas la valeur du `state`.

#### D1 : documents de suivi incohérents et revues « VALIDÉ » non attribuables

- **Sévérité** : Moyenne (gouvernance). **Bloquant.**
- **Localisation** :
  - `docs/security/journal-corrections.md:1064-1080` et `:1095-1108` : deux sections « Revue architecte (2026-10-31) : VALIDÉ » qui contredisent r8 et citent un fichier inexistant (`oidc-key-source.ts`) ;
  - `GEMINI.md` et `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` § 15 : « S10-a, S10-b, S10-c traités » ;
  - `docs/security/runbook-phase2.md` § 2, 4, 6 et 7.
- **Correction attendue** : voir les consignes d'hygiène ci-dessous.
- **Critère d'acceptation** : `grep -n "Revue architecte (2026-10-31)" docs/security/journal-corrections.md` ne renvoie rien. Aucun document ne déclare S10-a, S10-b, S10-c ou S11-b corrigé avant la revue de l'architecte.

#### L1 : lockfile réécrit et artefacts de build

- **Sévérité** : Basse (hygiène de livraison). **Préalable au commit.**
- **Localisation** : `pnpm-lock.yaml` (environ 9 000 lignes de diff, incident de la revue r8) ; `backend/tsconfig.tsbuildinfo` (modifié) ; `backend/tsconfig.build.tsbuildinfo` (non suivi) ; `backend/dist/` (anciens `*.spec.js`, faute de `deleteOutDir`).
- **Correction attendue** : voir les consignes d'hygiène ci-dessous.
- **Critère d'acceptation** : `git diff --stat pnpm-lock.yaml` affiche 3 insertions ; `git status` ne liste aucun `*.tsbuildinfo` ; `pnpm install --frozen-lockfile` passe sans modifier le lockfile. Pour le vérifier : `git diff --stat` avant et après.

### Consignes d'hygiène avant commit (obligatoires)

1. **Lockfile** : `git show HEAD:pnpm-lock.yaml > pnpm-lock.yaml`, puis réinsérer à la main, sous `importers.backend.dependencies` et après `ioredis`, les trois lignes `jose:`, `specifier: 4.15.9` et `version: 4.15.9`. Résultat attendu : 3 lignes ajoutées au diff. Ne lancer aucune commande pnpm qui réécrit le fichier.
2. **Artefacts** :
   - ajouter `*.tsbuildinfo` à `.gitignore` ;
   - restaurer `backend/tsconfig.tsbuildinfo` (`git checkout -- backend/tsconfig.tsbuildinfo`), puis le retirer de l'index par `git rm --cached` dans le commit, sur décision de l'utilisateur ;
   - ajouter `"compilerOptions": { "deleteOutDir": true }` dans `backend/nest-cli.json`.
3. **Journal** : retirer de `journal-corrections.md` les deux sections « Revue architecte (2026-10-31) : VALIDÉ » (S10, lignes 1064-1080 ; S11, lignes 1095-1108). Elles ne sont pas de l'architecte. Remettre le statut de l'entrée S10-a (r8) à `À REPRENDRE`. Ajouter une entrée par action r9 avec le statut `CORRIGÉ – À REVOIR` une fois l'action faite.
4. **Runbook `runbook-phase2.md`** :
   - § 2 : `verifiedDomain`, suppression de l'index unique sur `domain`, index non unique (S10-g), traitement des `ssoUid` hérités (S10-d) ;
   - § 4 : URL de retour = origine de `FRONTEND_URL` + `/auth/sso/callback` ;
   - § 6 : SQL de retour arrière ;
   - § 7 : limite SCIM par clé authentifiée et par IP (S11-b) ;
   - nouvelle procédure « perte ou transfert du domaine » : désactiver la configuration, supprimer `verifiedDomain`, prévenir les administrateurs.
5. **`GEMINI.md` et DAT § 15** : remplacer « S10-a, S10-b, S10-c traités » par « Phase 2 : revue r9 NON VALIDÉE, actions r9 en cours ».
6. Ne pas modifier l'en-tête de ce rapport ni le statut d'un constat : c'est le rôle de l'architecte.

### Plan d'action r9 pour fixeur (ordre obligatoire)

Méthode inchangée : un test d'abus qui échoue d'abord, puis le correctif minimal, puis les suites complètes, les builds et ESLint. Aucune exécution contre une base réelle, aucun commit. `FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED` restent à `false`.

| # | ID | Action | Terminé quand |
| --- | --- | --- | --- |
| 1 | S11-b | Réécrire la sélection du compteur : chemin seul, préfixe ancré ; IP toujours limitée ; 300/min par `scimApiKeyId` après `ScimAuthGuard`. | Les 5 tests S11-b passent ; un test d'abus a échoué avant le correctif (consigné au journal) ; le test d'isolation S11-a reste vert. |
| 2 | S10-a | Supprimer le `deleteMany` de `configureWorkspaceSSO` (`sso.service.ts:431-447`) ; remplacer le test `sso-oidc.spec.ts:486-499`. | Tests : deux revendications de `acme.com` coexistent, avec deux jetons distincts et aucune ligne supprimée ; le premier `verifyDomain` réussit ; le second reçoit 409 ; une reconfiguration par ws-2 ne modifie aucun champ de la ligne de ws-1. `grep -n deleteMany src/auth/sso/sso.service.ts` ne renvoie rien. |
| 3 | S10-d | Script de remise à NULL des `ssoUid` hérités, et contrôle du domaine du compte trouvé par `ssoUid`. | Les 3 critères S10-d passent ; script documenté au runbook ; script non exécuté contre une base réelle. |
| 4 | S10-b | Ajouter le test : `clientId` vide sur une configuration active. | Le callback renvoie 401 et la source de clés (`OidcKeySource.getKeys`, espionnée) n'est jamais appelée ; `getAuthorizationUrl` renvoie 400. |
| 5 | S10-c | Retirer les replis `APP_URL` et localhost en production ; écrire le test. | Test `FRONTEND_URL=http://localhost:3000` : `redirect_uri=http://localhost:3000/auth/sso/callback`. Test `NODE_ENV=production` sans `FRONTEND_URL` : erreur explicite, aucune URL en localhost. Plus aucune occurrence d'`APP_URL` dans `src/auth/sso`. |
| 6 | S10-f | Délai maximal, 503, 401 et 409 au lieu de 500. | Un test par cas, aucun 500. |
| 7 | S10-e | Changement d'IdP : OWNER seul, désactivation, journal. | Les 3 critères S10-e passent. |
| 8 | S10-h | Lire `verifiedDomain` dans `assertSsoNotEnforced` et SCIM `createUser`. | Les 2 critères S10-h passent. |
| 9 | S10-g | Ajouter `@@index([domain])` ; SQL de retour arrière au runbook. | Le critère S10-g est rempli. |
| 10 | S10-i | Contrôles Azure `acct` et `xms_edov` ; ligne `SSO_LOGIN_FAILURE`. | Les 3 critères S10-i passent. |
| 11 | D1, L1 | Appliquer les consignes d'hygiène 1 à 5. | Les critères D1 et L1 sont remplis. |
| 12 | Clôture | Lancer toutes les suites et outils. | Backend : `jest` tout vert, `nest build`, `tsc -p tsconfig.build.json`, `eslint src tests scripts` sans erreur. Frontend : `vitest`, `tsc`, `eslint`, `vite build` OK. Résultats exacts consignés au journal (section « Résultats (r9) »), chaque entrée en `CORRIGÉ – À REVOIR`. |

Les actions 1 à 5 et 11 sont **bloquantes** pour la validation de la Phase 2. Les actions 6 à 10 sont attendues dans la même livraison. S10-e est en plus une condition de réactivation de `FEATURE_SSO_ENABLED`.

### Synthèse r9

| ID | Verdict r9 |
| --- | --- |
| S10 | À REPRENDRE (S10-a, S10-b, S10-c, S10-d ; S10-e à S10-i) |
| S11 | À REPRENDRE (S11-b) |
| D1, L1 | Ouverts |

**Constats ouverts à la fin de r9 :**

- Phase 2 : S10 (S10-a à S10-i), S11 (S11-b), D1, L1.
- Phase 1 : P9 (produit).
- Phases 3 à 6 : S12 à S26 sauf S14 étape 1 et S18 étapes 0 et 2 ; A1, A2, A4 à A9 ; P2, P4, P5, P7, P8.
- Clos : S1 à S9, S27, S28, S29, A3, P1, P3, P6.

---

## Revue r10 — Phase 2 : VALIDÉ (2026-11-02)

Revue des entrées r9 du journal (`journal-corrections.md`, « Actions de la revue r9 » et « Résultats (r9) »). Chaque critère « terminé » du plan r9 a été vérifié dans le code, les tests et les documents. Les commandes de clôture ont été relancées par l'architecte. Une recherche active de contournements a porté sur la limitation de débit et sur la règle « compte trouvé par `ssoUid` ⇒ domaine prouvé ».

### Vérifications refaites par l'architecte

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **61/61 suites, 657/657 tests passés** |
| `cd backend && env -u DATABASE_URL npx nest build` | exit 0 ; `find dist -name '*.spec.js'` : 0 (`deleteOutDir` effectif) |
| `cd backend && npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `cd backend && npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059, antérieure à la Phase 2 (inchangée) |
| `cd backend && npx eslint src tests scripts` | 0 erreur, 17 avertissements |
| `cd backend && npx prettier --check src tests scripts` | conforme |
| `cd backend && npx prisma validate` | schéma valide |
| `prisma migrate diff --from-schema <schéma HEAD> --to-schema prisma/schema --script`, **sans base** | Produit exactement le DDL de la migration `20261110000000` : `DROP INDEX SSOConfiguration_domain_key`, 3 colonnes, `SSOConfiguration_verifiedDomain_key` unique, `SSOConfiguration_domain_idx`, et rien d'autre. Ce contrôle remplace la comparaison avec une base fantôme (voir la réponse sur S10-g). |
| `cd frontend && npx vitest run` ; `tsc --noEmit -p .` ; `eslint src` ; `vite build` | 15/15 fichiers, 59/59 tests ; exit 0 ; 0 erreur (36 avertissements) ; OK |
| `git diff --stat pnpm-lock.yaml` | 1 fichier, 3 insertions |
| `grep -n "Revue architecte (2026-10-31)" docs/security/journal-corrections.md` | aucun résultat |

Le build a de nouveau modifié `backend/tsconfig.tsbuildinfo`. L'architecte a restauré ce fichier (`git checkout --`) pour rendre l'arbre de travail dans l'état laissé par fixeur.

### Statut des constats

| ID | Statut r10 | Vérification |
| --- | --- | --- |
| **S11-b** | **CLOS** | `app-throttler.guard.ts:17-21` : le compteur global est **toujours l'IP**, sans lecture de l'URL ni de l'en-tête. `ScimKeyThrottlerGuard` (`:35-54`) s'exécute **après** `ScimAuthGuard` (`scim-http.ts`, `UseGuards(ScimAuthGuard, ScimKeyThrottlerGuard)`), compte sur `scimApiKeyId` (identifiant en base) et refuse si ce champ est absent. Les clés invalides restent bornées par la limite IP de 3 000/min et par route. `Retry-After` est en secondes, comme le renvoie le stockage du throttler en 5.1.2. Le 429 passe par `ScimExceptionFilter` (format SCIM). Tests : 3 unitaires, plus `login` et `register` avec `?x=/scim/v2` (429 à la 6e), 3 000 clés invalides (429), isolation de deux clés valides. Aucune route `@ScimEndpoint` n'échappe au garde par clé ; `ServiceProviderConfig` (publique, sans donnée) reste sous la limite IP par défaut. |
| **S10-a** | **CLOS** | Plus aucun `deleteMany` dans `sso.service.ts`. Le refus d'un domaine prouvé par un autre workspace est conservé. Tests de revendications concurrentes présents : 2 lignes, 2 jetons, premier `verifyDomain` gagnant, second en 409, ligne de ws-1 intacte. |
| **S10-b** | **CLOS** | Test `it.each(['', null])` : callback en 401 sans appel à `getKeys`, à `fetch` ni à `completeLogin` ; `getAuthorizationUrl` en 400. Contrôle de mutation consigné. |
| **S10-c** | **CLOS** | `redirectUri()` (`sso.service.ts:93-103`) : plus d'`APP_URL`. Le repli sur localhost n'existe qu'hors production ; en production, 503 explicite, calculé avant l'écriture Redis. Runbook § 4 corrigé. |
| **S10-d** | **CLOS** | `sso.service.ts:316-322` : un compte trouvé par `ssoUid` doit avoir `extractDomain(user.email) === ssoConfig.verifiedDomain`, sinon 409 avant toute écriture, adhésion ou session. Les deux chemins de liaison sont couverts. Par `ssoUid` : contrôle explicite. Par e-mail : `identity.email` est déjà contraint au domaine prouvé (l.309) et le compte trouvé porte cette adresse. `ssoUid` n'est lu nulle part ailleurs (`grep` sur `src`), et `User.ssoUid` est `@unique`. Script `reset-legacy-sso-uids.ts` : conditionnel, idempotent, CSV sans identifiant IdP, `--apply` refusé si `FEATURE_SSO_ENABLED=true`. L'expression `CURRENT_AZURE_FORMAT` ne peut pas retenir une valeur héritée : l'ancien format n'a qu'un segment après `azure-ad:`, et l'`oid` émis par Microsoft ne contient pas de `:`. |
| **S10-e** | **CLOS** | Changer `provider`, `issuer` ou `clientId` sur un domaine prouvé exige l'OWNER (403 sinon), force `enabled=false` et `enforceSSO=false`, conserve la preuve et journalise `SSO_CONFIG_IDP_CHANGED` sans secret. Contournements essayés, sans succès : changer de domaine puis revenir donne un nouveau jeton et une nouvelle preuve DNS ; supprimer puis recréer la configuration (ADMIN) donne aussi un nouveau jeton et une nouvelle preuve. |
| **S10-f** | **CLOS** | `AbortSignal.timeout`. Délai dépassé ou erreur réseau : 503. JSON invalide : 401. Échec de `decrypt` : 503 (journal sans secret). `P2002` : 409. Six tests. |
| **S10-g** | **CLOS** | `@@index([domain])` et `SSOConfiguration_domain_idx`. Le DDL de la migration est identique au diff de schéma calculé par l'architecte. SQL de retour arrière au runbook § 6. |
| **S10-h** | **CLOS** | `assertSsoNotEnforced` et SCIM `createUser` lisent `verifiedDomain`. Tests de revendications concurrentes présents. |
| **S10-i** | **CLOS** | `acct === 1` et `xms_edov === false` donnent 401. `SSO_LOGIN_FAILURE` enveloppe tout le callback, sans jeton, code, `state` ni adresse ; une erreur non HTTP est journalisée `ERREUR_INTERNE`. |
| **D1** | **CLOS** | Sections « VALIDÉ » non attribuables retirées. Statuts r8 rectifiés. `GEMINI.md`, DAT § 15 et runbook (§ 1, 2, 3 bis, 4, 6, 7, 8) à jour. |
| **L1** | **CLOS côté code** | Lockfile : 3 lignes. `*.tsbuildinfo` dans `.gitignore`. `deleteOutDir` activé. **Reste à l'utilisateur, au moment du commit** : `git rm --cached backend/tsconfig.tsbuildinfo`, sinon chaque build le fait réapparaître dans `git status`. |
| **S10** | **CLOS côté code** | Toutes les actions r8 et r9 sont closes. |
| **S11** | **CLOS côté code** | S11-a remplacé par S11-b, clos. |

### Réponses aux questions de fixeur

- **(a) Un compteur de 300/min par clé, commun à toutes les routes SCIM : accepté.** C'est plus strict que le comportement natif (300 par route) et cela répond à l'intention de S11 : borner une clé, pas une route. Les IdP (Entra, Okta) respectent `Retry-After` et reprennent la synchronisation. Si une synchronisation initiale importante est bridée en production, augmenter `SCIM_KEY_LIMIT` par configuration, sans revenir au comptage par route. Sur la question complémentaire : la clé non authentifiée n'est bornée que par la limite IP de 3 000/min et par route, ce qui est **accepté**. Le coût par requête se limite à une lecture par index unique (`tokenHash`), et l'échec est journalisé.
- **(b) Toutes les liaisons `google:<sub>` remises à NULL : confirmé.** Elles ont été posées sans vérification et sont indiscernables des liaisons légitimes. Le reliage se fait de façon sûre au prochain login, par l'adresse, dans le domaine prouvé, avec `email_verified` et `hd`. Conséquence à documenter au runbook § 3 bis : un compte dont l'adresse Planner-Pro diffère de l'adresse Google ne sera pas relié. Avec `autoProvision`, un second compte serait alors créé : relire le CSV avant `--apply` et traiter ces cas à la main. Le refus de `--apply` sous `FEATURE_SSO_ENABLED=true` est approuvé.
- **(c) Réactivation explicite par l'OWNER après un changement d'IdP : accepté.** La preuve DNS porte sur le domaine, pas sur l'IdP. La sécurité repose donc sur le fait que seul l'OWNER choisit l'IdP. Qu'un ADMIN puisse ensuite réactiver une configuration dont l'IdP a été choisi par l'OWNER reste dans le modèle de rôles. Une nouvelle preuve DNS n'est pas exigée.
- **S10-g écrit après la modification du schéma, `migrate diff` non exécuté : accepté.** Le diff de schéma sans base, fait par l'architecte, équivaut au critère pour cette migration. L'exploitant appliquera la migration sur une base jetable avant la production (runbook § 1, étape 2).

### Observations non bloquantes (hors Phase 2, à traiter en Phase 5 avec la limitation de débit)

- **O1** : `trust proxy` n'est pas configuré (`main.ts`). Derrière un proxy inverse, `req.ip` est l'adresse du proxy, et toutes les limites par IP (connexion 5/min, SCIM 3 000/min) deviennent **globales**. Le risque est un déni de service par épuisement, pas un contournement. Ce comportement existait avant la Phase 2. À traiter avec S2x (limitation de débit) en Phase 5 : `app.set('trust proxy', <nombre de sauts>)`, plus un test.
- **O2** : le stockage du throttler est en mémoire, donc propre à chaque instance. Avec N instances, les limites sont multipliées par N. Prévoir un stockage Redis en Phase 5. Ce comportement existait avant la Phase 2.
- **O3** : `SSO_LOGIN_FAILURE` journalise `error.message`. Les messages actuels sont constants et sans donnée personnelle. Garder cette règle lors de futures évolutions, ou journaliser un code de motif plutôt qu'un message.
- **O4** : `processCallback` compare `identity.email` et `hd` à `ssoConfig.domain`, alors que la règle S10-d utilise `verifiedDomain`. Les deux valeurs sont égales par construction (configuration trouvée par `verifiedDomain`, et un changement de domaine remet la preuve à zéro). Harmoniser sur `verifiedDomain` à la prochaine intervention.

### Conditions de réactivation des drapeaux (décision de l'utilisateur)

Les conditions de la revue r8 sont désormais remplies **côté code**. Restent les conditions d'exploitation, à remplir avant la décision de l'utilisateur.

**`FEATURE_SSO_ENABLED=true` :**
1. Phases 0 et 1 déployées.
2. Runbook Phase 2 exécuté : migration (d'abord sur une base jetable), `encrypt-sso-secrets.ts`, `reset-legacy-sso-uids.ts` (CSV relu), Redis 6.2 ou plus, `FRONTEND_URL` renseignée.
3. Par organisation : TXT publié, `verify-domain` passé, URL de retour enregistrée chez l'IdP.

**`FEATURE_SCIM_ENABLED=true` :**
1. Toutes les conditions SSO.
2. Journaux applicatifs conservés au moins 90 jours.
3. Revue des clés SCIM existantes.

**Commit :** soumis à l'accord de l'utilisateur, avec `git rm --cached backend/tsconfig.tsbuildinfo`.

### Synthèse r10

| ID | Verdict r10 |
| --- | --- |
| S10 (S10-a à S10-i) | VALIDÉ, clos côté code |
| S11 (S11-a remplacé, S11-b) | VALIDÉ, clos côté code |
| D1 | VALIDÉ, clos |
| L1 | VALIDÉ ; reste `git rm --cached` au commit, sur décision de l'utilisateur |

**Constats ouverts à la fin de r10 :**

- Phase 1 : P9 (produit).
- Phases 3 à 6 : S12 à S26 sauf S14 étape 1 et S18 étapes 0 et 2 ; A1, A2, A4 à A9 ; P2, P4, P5, P7, P8. Les observations O1 et O2 sont à rattacher au constat de limitation de débit de la Phase 5.
- Clos : S1 à S11, S27, S28, S29, A3, P1, P3, P6.
- **Prochaine étape pour fixeur : Phase 3** (A1, A2, A4, S12, S13, S14 suite, S15, S16), après commit de la Phase 2 sur décision de l'utilisateur.

### Clôture de la Phase 2 (revue finale, 2026-11-02)

- **Verdict : VALIDÉ.** Commit local fait par l'architecte sur `security/phase-0`, sans push.
- **Correctif de configuration fait à la clôture (L1)** : `backend/tsconfig.build.json` passe en `"incremental": false`. Sans lui, `deleteOutDir` (ajouté en r9) combiné à un `tsconfig.build.tsbuildinfo` à jour produisait un `dist` vide malgré un code de sortie 0. Ce cas pouvait se produire dans l'image Docker, car `backend/Dockerfile` ne supprime que `tsconfig.tsbuildinfo` et le dépôt n'a pas de `.dockerignore`. Vérifié : deux builds successifs produisent 116 `.js` et 0 `*.spec.js`.
- **Ajout au backlog de la Phase 5 (avec A7/A9)** : `.dockerignore` pour `backend/` (`dist`, `*.tsbuildinfo`, `.env*`, `node_modules`).
- **Reste à l'utilisateur** : exécution du runbook Phase 2, puis décision de réactiver `FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED`. Les conditions sont listées dans la section « Revue r10 ».
- **Prochaine étape pour fixeur** : Phase 3, en commençant par O4 puis O3.

---

## Revue r11 — Phase 3 : NON VALIDÉ (2026-11-02)

Revue du travail non commité de la Phase 3 (au-dessus de `aaf696d`) : O4, O3, A1, A2, S12, S13, S14 (suite), S15, A4, S16. Elle a été faite sur le code réel ; les commandes ont été relancées par l'architecte et les points sensibles reproduits.

### Vérifications refaites par l'architecte

| Commande ou contrôle | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **69/69 suites, 1122/1122 tests passés** |
| `nest build` | exit 0 ; 122 `.js`, 0 `*.spec.js` |
| `tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `tsc --noEmit -p tsconfig.json` | 1 erreur TS6059, antérieure (désormais signalée sur `tracking.gateway.spec.ts`) |
| `eslint src tests scripts` | 0 erreur, **20** avertissements (17 auparavant) |
| `prettier --check` ; `prisma validate` | conforme ; valide |
| Frontend : `vitest`, `tsc`, `eslint`, `vite build` | 15/15 fichiers, 59/59 tests ; OK ; 0 erreur (36 avertissements) ; OK |
| `prisma migrate diff --from-schema <HEAD> --to-schema prisma/schema --script` (sans base) | Identique au DDL de `20261111000000_s12_attachment_uploader` : colonne, index, clé étrangère `ON DELETE SET NULL`. Migration additive, reprise de données sûre (jointure sur `Comment`), retour arrière documenté au runbook § 1. |
| Routes publiques : comparaison des décorateurs entre HEAD et l'arbre (script) | Aucune route auparavant protégée n'est devenue publique. Les 28 routes `@Public()` sont exactement la liste blanche de `tests/unit/authz/public-routes.spec.ts`. Les routes `/admin/*` restent sous `PlatformAdminGuard`. |
| Ordre des gardes | Gardes globaux dans l'ordre débit → `FeatureFlagGuard` (404 avant 401) → `JwtAuthGuard`, puis gardes de contrôleur (`PlatformAdminGuard`, `ScimAuthGuard` → `ScimKeyThrottlerGuard`). Conforme. |
| Gardes globaux et Socket.IO (preuve : serveur Socket.IO réel dans le bac à sable, `JwtAuthGuard` global instrumenté) | Les `APP_GUARD` ne s'exécutent **pas** sur les messages WebSocket : pas de régression du temps réel. L'authentification WS repose sur `handleConnection` (`authenticateSocket`, revalidation de session), ce qui est conforme. |
| `PolicyService` avec une base simulée : utilisateur dont la `Membership` a été supprimée (désactivation SCIM) | `listAccessibleProjectIds('bob')` → `['P1', 'P2']` ; `assertProject(P1/P2, 'task.write')` → **AUTORISÉ** (voir S12-a) |

### Statut des constats

| ID | Statut r11 | Constat |
| --- | --- | --- |
| O3 | **CLOS** | `SSO_LOGIN_FAILURE` journalise un motif dérivé du seul statut HTTP (`failureReason`), jamais le message. |
| O4 | **CLOS** | Adresse, `hd` et règle `ssoUid` comparés au seul `verifiedDomain` ; flux Redis sur `verifiedDomain` ; refus si `verifiedDomain` est vide. |
| A1 | **CLOS** | `JwtAuthGuard` global, liste blanche figée par un test méta. |
| A2 | **À REPRENDRE** | `PolicyService` et matrice (`src/authz/`) conformes dans le principe ; plus aucun `private async assertWorkspace*`. Restent un contrôle local divergent dans `milestones.service.ts:15-27,394-401` (accès accordé à tout membre du workspace, voir S12-b) et la règle d'appartenance au workspace (S12-a). L'écart « pas de `@RequirePermission` ni de garde, politique appelée par les services » est **accepté**, à condition que le test de matrice par route (S12-d) existe. |
| S12 | **À REPRENDRE** | Filtrage des projets, commentaires, pièces jointes (`uploadedById`), sprints, minuteur, copilote, créneaux et conflits : conforme. Bloquants : S12-a, S12-b, S12-c, S12-d. |
| S13 | **CLOS** | DTO (UUID v4, 200 au plus) ; toutes les tâches chargées ; même workspace ; sprint du même workspace ; `sprint.manage` et `task.write` sur chaque projet avant toute écriture ; diffusion vers `project:<id>` des seules tâches modifiées. |
| S14 (suite) | **CLOS** | `(workspaceId, integrationId)` partout ; `toggle` et `delete` résolvent le workspace et répondent 404 sans oracle ; export, sync et callback réservés à OWNER/ADMIN ; projection sans jetons ; URL masquée. |
| S15 | **CLOS** | `authorize()` (`ai.use`, puis `task.write` sur un projet du même workspace) avant toute lecture et tout appel à Gemini ; résolution limitée aux projets accessibles ; DTO `execute` ; signal non sensible au workspace vérifié. La question du DTO strict est traitée en décision 4. |
| A4 | **CLOS** | Une seule gateway ; `RealtimeService` unique ; plus aucun accès au serveur Socket.IO hors gateway et service. L'écart « émission depuis les contrôleurs » est **accepté** jusqu'à la Phase 6 (émission après écriture, sur des données déjà autorisées). |
| S16 | **À REPRENDRE** | Salons `project:<id>`, `typing` limité au salon rejoint, limites audio et débit par socket, authentification commune avec revalidation, recalcul des salons et échec fermé : conformes. Bloquant : S16-a. |

### Nouveaux constats r11

#### S12-a : l'accès aux projets survit à la perte de l'appartenance au workspace (contournement du déprovisionnement SCIM)

- **Sévérité** : Majeur. **CVSS 7.1** `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N`. **Bloquant.**
- **Localisation** : `backend/src/authz/policy.service.ts:74-95` (`effectiveProjectRole` : le créateur est `MANAGER` et la `ProjectMembership` fait foi **sans** vérifier la `Membership` du workspace) ; `:166-200` (`listAccessibleProjectIds` : `OR [{ userId }, { id: { in: grantedIds } }]` sans condition d'appartenance).
- **Scénario** : l'IdP désactive Bob (SCIM `active=false`, ce qui supprime sa `Membership` : S1). Bob garde un accès en écriture à tous les projets qu'il a créés et à ceux où il a une `ProjectMembership`, par REST. `refreshUserRooms`, appelé par SCIM, le **réabonne** même à leurs salons temps réel. Reproduit avec le vrai `PolicyService`. Le même défaut existait avant la Phase 3, mais la politique centrale l'étend désormais à toutes les routes et au temps réel, et il annule l'effet de S1.
- **Correction attendue** : pour tout projet rattaché à un workspace (`workspaceId` non nul), **aucun** rôle de projet (créateur, `ProjectMembership`, OWNER/ADMIN) n'est accordé sans `Membership` dans ce workspace non supprimé. Dans `effectiveProjectRole`, lire la `Membership` d'abord et renvoyer `null` si elle est absente. Dans `listAccessibleProjectIds`, restreindre les trois branches du `OR` aux workspaces de l'utilisateur. Les projets personnels (`workspaceId` nul) restent réservés au créateur.
- **Critères d'acceptation (tests)** :
  1. `policy.service.spec` : après suppression de la `Membership`, le créateur d'un projet et le détenteur d'une `ProjectMembership` reçoivent 403 sur `assertProject` et n'apparaissent plus dans `listAccessibleProjectIds`.
  2. Test SCIM : `PATCH active=false` donne 403 sur `GET /projects/:id` pour un projet créé par l'utilisateur, et `refreshUserRooms` le retire de `project:<id>`.
  3. Projet personnel : le créateur garde l'accès.

#### S12-b : IDOR résiduel sur les livrables (`milestones.service.ts`)

- **Sévérité** : Majeur. **CVSS 6.5** `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N`. **Bloquant.**
- **Localisation** :
  - `backend/src/projects/milestones.service.ts:394-416` (`getDeliveryReport`, route `GET /projects/:id/delivery-report`) : accès accordé à **tout membre du workspace**, VIEWER et CLIENT d'un autre projet compris. La réponse contient le nom et l'état du projet, les compteurs de tâches et de temps passé, et les **livraisons complètes** (`deliveries` avec leur checklist). Un projet absent lève `throw new Error`, donc un 500.
  - `:269-286` (`toggleDeliveryChecklistItem`) : OWNER, ADMIN **et MEMBER** du workspace, sans rôle de projet, peuvent cocher les livraisons d'un projet qui ne leur est pas ouvert.
  - `:15-27` (`assertProjectAccess` local) : même motif « tout membre du workspace ».
- **Correction attendue** :
  - `getDeliveryReport` : `policy.assertProject(projectId, userId, 'project.read')` ; 404 ou 403 via la politique ; plus aucun `throw new Error`.
  - Écritures sur livrables, livraisons et checklist : `project.manage`, ou `project.write` si le produit le préfère, mais un **rôle de projet** dans tous les cas.
  - Supprimer `assertProjectAccess` local au profit de `PolicyService`.
- **Critères d'acceptation (tests)** :
  1. CLIENT de P1 sur `GET /projects/P2/delivery-report` : 403, aucune donnée.
  2. MEMBER sans rôle sur P2 : `toggleDeliveryChecklistItem` donne 403, sans écriture.
  3. Projet inexistant : 404, pas 500.
  4. Ces routes figurent dans le test de matrice S12-d.

#### S12-c : notifications envoyées à des utilisateurs sans accès au projet (mentions et assignations)

- **Sévérité** : Moyen. **CVSS 4.3** `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`. **Bloquant**, car le critère d'acceptation de S12 exige « par **aucune** route REST ni WS ».
- **Localisation** :
  - `backend/src/projects/comments.service.ts:306-331` (`parseMentions` cherche parmi **tous** les membres du workspace) ;
  - `comments.controller.ts:43-56,95-110` (`mention-notification` contient le **commentaire complet**) ;
  - notification persistante avec le titre de la tâche (`comments.service.ts:118-126,286-294`) ;
  - `tasks.service.ts:83-100` (`getAccessibleUserIds` = membres du workspace) : on peut assigner une tâche à quelqu'un qui n'a pas accès au projet, et il en reçoit la notification.
- **Scénario** : sur P2, un contributeur écrit « @alice » ; Alice, CLIENT de P1 seulement, reçoit par WebSocket et dans `GET /notifications` le texte du commentaire et le titre de la tâche de P2.
- **Correction attendue** :
  - Mentions : ne résoudre que les utilisateurs ayant `comment.read` sur le projet de la tâche. Une mention inconnue ou non autorisée est ignorée, sans erreur, pour ne pas créer d'oracle.
  - Assignations : n'accepter que les utilisateurs ayant `task.read` sur le projet. Un identifiant non autorisé est ignoré, comme aujourd'hui pour un non-membre.
  - La correction passe par une méthode de `PolicyService`, par exemple `filterUsersWithProjectAction(projectId, userIds, action)`.
- **Critères d'acceptation (tests)** :
  1. Mention d'un utilisateur sans rôle sur le projet : ni notification persistée, ni `emitToUser`.
  2. Mention d'un COMMENTER du projet : notifié.
  3. `assigneeIds` contenant un membre du workspace sans rôle sur le projet : il n'est pas assigné et ne reçoit pas de notification.

#### S12-d : test de matrice par route absent (critère d'acceptation de S12)

- **Sévérité** : Moyen (assurance). **Bloquant.**
- **Constat** : l'écart « le test de matrice ne parcourt pas chaque route » est **refusé**. C'était le test d'acceptation explicite de S12 (« table-driven, toutes les routes de `projects.controller.ts`, `comments.controller.ts` et `tracking.controller.ts` »), et son absence explique qu'S12-b soit passé inaperçu. Les tests par service actuels sont utiles mais ne couvrent pas le câblage contrôleur → service.
- **Correction attendue** : `tests/http/rbac-matrix.spec.ts`, sur une application Nest réelle avec `JwtAuthGuard` global, `FakePrisma` et `tests/support/rbac-fixture.ts`. Fixture : workspace W avec P1 et P2 ; utilisateurs OWNER, ADMIN, MEMBER sans rôle, MEMBER CONTRIBUTOR(P1), VIEWER, CLIENT(P1), COMMENTER(P1), et un non-membre. Une ligne par route, avec le code attendu par profil et, pour les lectures, l'absence de toute donnée de P2 dans la réponse du CLIENT(P1).
- **Critères d'acceptation** :
  1. Un test méta énumère les routes des trois contrôleurs, plus `ai.controller.ts` et la route `delivery-report`, et **échoue** si une route n'a pas de ligne dans la table.
  2. Le test échoue sur le code actuel (S12-b) puis passe après correction ; l'échec initial est consigné au journal.

#### S16-a : les salons `task:<id>` ne sont jamais révoqués

- **Sévérité** : Moyen. **CVSS 5.4** `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N`. **Bloquant.**
- **Localisation** : `backend/src/realtime/realtime.service.ts` (`refreshUserRooms` ne traite que `project:` et `workspace:`) ; `tracking.gateway.ts:169-211` (`join-task`) ; émissions `emitToTask` de `comments.controller.ts:43,78,97` (`new-comment` et `comment-updated` contiennent le commentaire complet).
- **Scénario** : Carol, COMMENTER de P2, ouvre la tâche T (`join-task`) puis perd son rôle (`removeProjectRole`) ou est désactivée par SCIM. `refreshUserRooms` la retire de `project:P2`, mais sa socket reste dans `task:T`. Elle continue de recevoir le texte de chaque nouveau commentaire de T jusqu'à sa déconnexion.
- **Correction attendue** : `refreshUserRooms` quitte aussi tout salon `task:<id>` dont la tâche n'est plus dans un projet accessible, en vérifiant par lot avec `prisma.task.findMany({ where: { id: { in } } , select: { id, projectId } })`. À défaut, il quitte **tous** les `task:*` et le client les rejoint à nouveau. En défense en profondeur, `emitToTask` peut cibler `task:<id>` **et** `project:<projectId>` par intersection, ou les commentaires peuvent être émis vers `project:<id>` avec `taskId` dans la charge.
- **Critères d'acceptation (tests)** :
  1. Unitaire : après `removeProjectRole`, la socket a quitté `project:P2` **et** `task:T`.
  2. **Intégration sur un vrai serveur Socket.IO** (écart « pas de test Socket.IO réel » refusé pour ce point ; `socket.io-client@4.7.5` est disponible dans le magasin pnpm, comme le montre la preuve de l'architecte) : client connecté, `join-task` sur T, puis retrait du rôle, puis création d'un commentaire sur T. Le client ne reçoit **aucun** `new-comment`. Un client resté autorisé le reçoit.

### Constats non bloquants (même livraison souhaitée)

| ID | Sévérité | Localisation | Constat | Correction attendue |
| --- | --- | --- | --- | --- |
| S16-b | Mineur (fonctionnel) | `projects.service.ts:147` (création de projet) ; `invitations.service.ts:222-268` (chemin « déjà membre du workspace ») | Pas de `refreshUserRooms` : le créateur d'un projet, les OWNER/ADMIN et l'invité déjà membre ne reçoivent aucun événement temps réel du nouveau projet avant de se reconnecter. C'est une régression par rapport à l'ancien salon workspace. | Créateur et invité : `refreshUserRooms(userId)` après commit. OWNER et ADMIN du workspace : le faire pour chacun, ou ajouter un salon `workspace-admin:<id>` qui reçoit les événements de tous les projets. Test unitaire. |
| S12-e | Mineur | `resources.service.ts:58-157` (`GET /projects/resources/capacity`) | Tout membre, VIEWER compris, reçoit les `resourceProfile` de tous les membres, avec `costRateCents` et `billingRateCents`, alors que `workspace.finances.read` est réservé à OWNER/ADMIN. Ce défaut existait avant la Phase 3. | Retirer les taux pour les non-ADMIN (projection) ; test. |
| A2-b | Mineur | `sprint.service.ts:217-222` | Sprint introuvable : 404, alors que les tâches refusées donnent 403 : oracle d'existence d'un sprint. | Même 403 `denied()`. |
| Q-1 | Mineur | backend ESLint | 3 nouveaux avertissements (17 → 20). | Les corriger ou les justifier au journal. |

### Réponses aux écarts de fixeur

- **Pas de `@RequirePermission` ni de garde** : accepté. Une politique appelée depuis les services couvre aussi les appels internes (IA, ordonnanceur), ce qu'un garde de route ne ferait pas. Condition : le test de matrice par route (S12-d).
- **Émission temps réel dans les contrôleurs** : acceptée jusqu'à la Phase 6, sous réserve de S16-a.
- **Pas de test sur un vrai serveur Socket.IO** : refusé pour la révocation (S16-a, critère 2), accepté ailleurs.
- **Test de matrice qui ne parcourt pas chaque route** : refusé (S12-d).
- **Mentions** : le classement « hors périmètre » est refusé (S12-c), car le critère d'acceptation de S12 couvre toutes les routes REST et WS.
- **`assignProjectRole` sans contrôle d'appartenance de la cible** : reste en S17 (Phase 4). S12-a neutralise l'effet, puisqu'une `ProjectMembership` sans `Membership` n'ouvrira plus aucun accès.

### Recommandations sur les décisions produit (à trancher par l'utilisateur)

1. **P4, MEMBER ou VIEWER sans `ProjectMembership`** : **garder la règle stricte**, sans accès implicite.
   - C'est le seul modèle compatible avec les rôles CLIENT et COMMENTER et avec l'invitation externe (S17). Un « CONTRIBUTOR implicite » rouvrirait S12 pour tous les MEMBER.
   - En revanche, le déploiement tel quel **retire en silence** l'accès à des utilisateurs existants : la requête SQL du runbook § 2 le mesure, mais rien ne le compense. Avant la production, fournir un script de reprise `grant-legacy-project-access.ts` (rapport, puis `--apply`, idempotent, CSV sans adresse), qui accorde CONTRIBUTOR aux MEMBER et CLIENT aux VIEWER sur les projets existants de leur workspace. L'utilisateur choisit de l'exécuter ou non.
   - Si un besoin de projets « ouverts à tout le workspace » apparaît, l'ajouter en Phase 4 par un attribut explicite du projet (`visibility`), jamais par défaut.
2. **`timelog.read` réservé à MANAGER et CONTRIBUTOR** : **accepté.** Les relevés de temps sont des données personnelles de productivité. COMMENTER et CLIENT n'en ont pas besoin ; le client voit l'agrégat dans le rapport de livraison (`project.read`, une fois S12-b corrigé). Option plus stricte à envisager plus tard : CONTRIBUTOR ne voit que ses propres relevés, MANAGER voit tous ceux du projet.
3. **O4, refuser toute configuration où `domain` diffère de `verifiedDomain`** : **non, inutile.** L'API ne peut pas produire cet écart : un changement de domaine remet `verifiedDomain` à NULL. Le code n'utilise plus que `verifiedDomain` pour toute décision (O4 clos). Un écart introduit en base à la main reste sans danger, puisque seul le domaine prouvé est cru. Un refus en écriture n'apporterait qu'un message d'erreur de plus.
4. **DTO strict de `ai/execute`** : **garder le DTO strict**, sans `@lenient()`, mais **normaliser à la source**.
   - Le schéma Gemini (`gemini.service.ts`) contraint les types, mais `estimatedMinutes` est un `NUMBER` qui peut être décimal, et `IsInt` le refuse alors au retour.
   - Dans `resolveActions`, ne renvoyer au client que les champs de `ResolvedAiAction`, arrondir `estimatedMinutes` à un entier borné et retirer les valeurs `null`.
   - Ajouter un test aller-retour : la sortie d'`analyzeCommand` (y compris `estimatedMinutes: 45.5` et un champ inconnu renvoyé par le fournisseur) est acceptée telle quelle par `POST /projects/ai/execute`.
   - Le frontend (`AiCommandBar.tsx`) ne modifie que des champs connus, en chaîne : il est compatible.

### Plan d'action r11 pour fixeur (ordre obligatoire)

Méthode inchangée : un test d'abus qui échoue d'abord, avec l'échec consigné au journal, puis le correctif minimal, puis les suites complètes. Aucune exécution contre une base réelle, aucun commit. Les décisions produit 1, 2 et 4 attendent l'utilisateur. Seule la normalisation de la décision 4 (sans changer la rigueur du DTO) peut être faite dès maintenant. Le script de reprise de la décision 1 n'est à écrire **que si l'utilisateur le demande**.

| # | ID | Action | Terminé quand |
| --- | --- | --- | --- |
| 1 | S12-d | Écrire `tests/http/rbac-matrix.spec.ts` (table par route, test méta de complétude) **avant** les correctifs suivants. | Le test méta couvre toutes les routes de `projects`, `comments`, `tracking` et `ai`. L'échec initial (au moins `delivery-report` et `checklist`) est consigné. Les lignes passent après les actions 2 et 3. |
| 2 | S12-a | Appartenance au workspace exigée pour tout rôle de projet (`effectiveProjectRole`, `listAccessibleProjectIds`). | Les 3 critères S12-a passent, plus les lignes « non-membre » et « désactivé SCIM » de la matrice. |
| 3 | S12-b | `getDeliveryReport` et écritures de livraison par la politique ; suppression de `assertProjectAccess` local ; plus de `throw new Error`. | Les 4 critères S12-b passent. `grep -n "memberships: { some: { userId" src/projects/milestones.service.ts` ne renvoie rien. |
| 4 | S12-c | Mentions et assignations limitées aux utilisateurs ayant accès au projet (méthode de `PolicyService`). | Les 3 critères S12-c passent. |
| 5 | S16-a | Révocation des salons `task:*` dans `refreshUserRooms`, plus le test sur un vrai serveur Socket.IO. | Les 2 critères S16-a passent. Le test d'intégration démarre et arrête son serveur proprement (aucun handle ouvert signalé par Jest). |
| 6 | S16-b | `refreshUserRooms` après création de projet et après acceptation d'invitation par un membre existant ; solution pour OWNER et ADMIN. | Tests : le créateur, puis un ADMIN connecté, reçoivent `task-status-changed` d'une tâche du nouveau projet sans se reconnecter. |
| 7 | Décision 4 (partie technique) | Normaliser la sortie de `resolveActions` ; test aller-retour. | Le test aller-retour passe, et le DTO reste strict (`forbidNonWhitelisted` sur le corps). |
| 8 | S12-e, A2-b, Q-1 | Correctifs mineurs. | Tests associés ; ESLint revenu à 17 avertissements au plus, ou écarts justifiés. |
| 9 | Documents | Runbook Phase 3 : S12-a (effet sur les comptes désactivés), décisions en attente ; journal : une entrée par action. | Les entrées du journal sont en `CORRIGÉ – À REVOIR`. |
| 10 | Clôture | Toutes les suites et tous les outils. | Backend : `jest` vert, `nest build` sans `*.spec.js`, `tsc` (build) 0, ESLint 0 erreur, `prettier` et `prisma validate` OK. Frontend : `vitest`, `tsc`, `eslint`, `build` OK. Résultats exacts au journal (« Résultats (r11) »). |

**Constats ouverts à la fin de r11 :**

- Phase 3 : A2, S12 (S12-a à S12-e), S16 (S16-a, S16-b), A2-b, Q-1.
- Décisions produit en attente : P4, `timelog.read`, DTO IA.
- Phase 1 : P9.
- Phases 4 à 6 : S17 à S26 sauf S18 étapes 0 et 2 ; A5 à A9 ; P2, P4, P5, P7, P8.
- Clos : S1 à S11, S13, S14, S15, S27, S28, S29, A1, A3, A4, O3, O4, P1, P3, P6.

## Revue r12 — Phase 3 : NON VALIDÉ (2026-11-03)

Revue des actions r11 (journal, section « Actions de la revue r11 » et « Résultats (r11) » ; runbook Phase 3 § 4 et § 5). Toutes les commandes ont été relancées par l'architecte, les mutations rejouées, et deux preuves faites dans des fichiers jetables, supprimés ensuite. Aucune base réelle, aucun commit.

Les dix actions r11 sont faites, et les chiffres du journal sont exacts. Le verdict reste **NON VALIDÉ** pour une seule raison : le module des notes écrit des tâches et des assignations **sans passer par `PolicyService`** (S12-f). C'est un contournement résiduel de S12-a, prouvé ci-dessous. Il s'y ajoute une variante de S16-a sur le même chemin (S16-c). La revue r11 ne l'avait pas vu non plus, parce qu'elle bornait la matrice à quatre contrôleurs. Le correctif est court et touche un seul fichier de service.

### Vérifications refaites par l'architecte

| Commande ou contrôle | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **73/73 suites, 2183/2183 tests** (identique au journal) |
| `nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 122 `.js` ; 0 `*.spec.js` |
| `tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts` → `tests/support/session.test-support.ts`), antérieure, déjà relevée en r11 |
| `eslint src tests scripts` | 0 erreur, **17** avertissements (Q-1 tenu) |
| `prettier --check` ; `prisma validate` | conforme ; valide |
| Frontend `vitest` / `tsc` / `eslint` / `vite build` | 15/15 fichiers, 59/59 ; exit 0 ; 0 erreur (36 avertissements) ; OK |
| Mutation S12-a (ancien `effectiveProjectRole` sans `Membership`, ancienne branche `grantedIds`) | **35 échecs** (`policy.service.spec`, matrice, intégration) : identique au journal ; code restauré (`cmp`) |
| Rejeu `milestones.service.ts` de HEAD contre la matrice | **16 échecs sur 982** : identique au journal ; restauré |
| Mutation S16-a (aucun `task:*` quitté) | **3 échecs** (intégration Socket.IO et `realtime.spec`) ; restauré |
| Mutation S12-c (`filterUsersWithProjectAction` renvoie tout) | **7 échecs** (`notifications-access.spec`) ; restauré |
| `jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| Matrice : relevé des réponses 5xx (instrumentation temporaire, restaurée) | **120 cas sur 982 renvoient 500 ou 503, tous sur des profils autorisés.** Les 503 viennent du calendrier OAuth non configuré ; les 500 des limites du Prisma simulé (`include` absents, écritures partielles). Aucun cas refusé n'est masqué. Voir Q-2. |
| Inventaire des mutations d'appartenance (`membership.*`, `projectMembership.*`) | Chaque écriture après connexion est suivie de `refreshUserRooms` (rôle de projet, invitations, SCIM, création de projet). Aucune route de retrait de membre ni de changement de rôle de workspace n'existe. |
| Inventaire des écritures de `taskAssignee` et des créations de notifications | `tasks.service.ts` est filtré. **Restent non filtrés `notes.service.ts:343-353,436-490` et `resources.service.ts:238-358`**. L'affirmation du journal « aucune autre source » est donc inexacte : la recherche a porté sur `createNotification`, pas sur les assignations. |
| Preuve S12-f (test jetable, `NotesService` réel, Prisma simulé : `bob` sans aucune `Membership`) | `createNote('bob', …, '- [ ] Pirater #Roadmap')` donne `task.create` dans le projet de workspace `P-W1`, puis `taskAssignee.create` pour `alice-other-tenant`. **Reproduit.** Le fichier a été supprimé. |
| `pnpm audit` (dev) sur `socket.io-client@4.7.5` | La dépendance transitive `ws@8.17.1` porte GHSA-36xv-jgw5-4q75 (élevé, DoS) et un avis modéré. Ce `ws` est déjà présent par le frontend, avec la même résolution, et il sert uniquement côté client, en test. Voir Q6. |

### Statut des constats

| ID | Statut r12 | Constat |
| --- | --- | --- |
| S12-a | **CLOS** | `effectiveProjectRole` lit la `Membership` d'abord ; les trois branches de `listAccessibleProjectIds` sont bornées à `memberWorkspaceIds` ; projet personnel réservé au créateur ; `filterUsersWithProjectAction` applique la même règle. Les critères 1 et 3 sont remplis par `policy.service.spec` (créateur et `ProjectMembership`). Le critère 2 est rempli par composition (Q1). **Le chemin des notes est traité à part, en S12-f.** |
| S12-b | **CLOS** | Contrôles locaux supprimés, `grep "memberships: { some: { userId"` vide, `project.read`/`project.manage`/`project.write` par la politique, 404 au lieu du 500. Les 4 critères passent, la matrice couvre les routes. |
| S12-c | **CLOS** pour son périmètre (mentions, `assigneeIds` de `tasks.service`) | Les 3 critères passent ; mention non autorisée ignorée sans oracle ; une mention non autorisée ne masque pas un homonyme autorisé. Les autres chemins d'assignation sont en S12-f. |
| S12-d | **CLOS** | Application Nest réelle, 9 profils, variante P1, oracle écrit indépendamment de `permissions.ts`, test méta dans les deux sens (vérifié par la preuve de retrait d'une ligne), aucune écriture sur refus, aucune donnée de P2. Correction du `$transaction` simulé : justifiée. Amélioration non bloquante : Q-2. |
| S12-e | **CLOS** | Taux retirés hors OWNER/ADMIN ; test sur la valeur numérique. |
| A2-b | **CLOS** | Sprint absent ou d'un autre workspace : même 403 `denied()`. |
| Q-1 | **CLOS** | 17 avertissements. |
| S16-a | **CLOS** | Une seule requête par lot, `task:*` quittés si la tâche sort des projets accessibles, échec fermé conservé ; test sur un vrai serveur Socket.IO, avec vrai `POST` de commentaire, contrôle positif et client témoin. La variante « tâche déplacée » est en S16-c. |
| S16-b | **CLOS** | Créateur et OWNER/ADMIN recalculés après commit ; chemin « déjà membre » de l'invitation ; test d'intégration réel (créateur et ADMIN reçoivent, CLIENT de P1 non). |
| Décision 4 (technique) | **CLOS** | `normalizeResolvedAction` : liste fermée alignée sur le DTO, arrondi borné ; DTO strict inchangé (`forbidNonWhitelisted`) ; test aller-retour par le même `AppValidationPipe`. L'écart « pipe plutôt que `POST` » est accepté : c'est le pipe global. Observation O5 ci-dessous. |
| A2 | **À REPRENDRE** | Plus de contrôle local dans les services de `projects/`, mais `notes.service.ts` décide seul de l'accès aux projets (S12-f). |
| S12 | **À REPRENDRE** | Seul S12-f reste ouvert. |
| S16 | **À REPRENDRE** | Seul S16-c reste ouvert. |
| Documents (action 9) | **CLOS** | Runbook § 4 et § 5 exacts ; requête SQL § 4.1 correcte (jointure externe sur `Membership`). |

### Nouveaux constats r12

#### S12-f : le module des notes écrit dans les projets sans `PolicyService` (contournement résiduel de S12-a, assignation inter-tenant)

- **Sévérité** : Moyen. **CVSS 5.4** `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N`. **Bloquant**, parce qu'il annule en écriture le critère de S12-a (« aucun rôle de projet sans `Membership` ») et le principe d'A2 (un seul point de décision).
- **Localisation** :
  - `backend/src/notes/notes.service.ts:367-385` : projet cible cherché par `{ name, userId, deletedAt: null }`, sans workspace, sans `Membership`, sans politique ;
  - `:392-430` : mise à jour, y compris `projectId`, d'une tâche existante de l'auteur, sans contrôle sur l'ancien ni sur le nouveau projet ;
  - `:343-353` : assigné résolu parmi **tous les utilisateurs de la plateforme**, par `name` ou `githubUsername` ;
  - `:436-490` (lignes 439, 461, 487) : `taskAssignee.create` sans filtre.
  - Atteint par `POST /notes` et `PUT /notes/:id` (`createNote`, `updateNote` → `parseTasksFromContent`).
  - Annexe, même famille : `resources.service.ts:238-358` (`optimizeWorkspaceResources`, OWNER/ADMIN) réassigne des tâches à n'importe quel membre du workspace, VIEWER sans rôle compris, sans `task.read`.
- **Scénario (reproduit)** : Bob est désactivé par SCIM, ce qui supprime sa `Membership` dans W1. Son compte reste valide pour son espace personnel. Il écrit dans une note `- [ ] … #Roadmap`, où « Roadmap » est un projet de W1 qu'il avait créé. La tâche est créée dans ce projet. Il peut aussi renommer, réactiver ou déplacer ses tâches existantes de W1. Si Gemini propose un assigné « Alice », l'utilisatrice Alice d'un **autre tenant** est assignée, et son identifiant apparaît ensuite dans les assignés de la tâche (`assignees.userId`, synchronisation Firestore).
- **Correction attendue** :
  1. Projet cible : ne retenir qu'un projet personnel de l'auteur (`workspaceId: null`) ou un projet où `policy.assertProject(id, userId, 'task.write')` réussit. On peut chercher d'abord par nom parmi `listAccessibleProjectIds(userId, { action: 'task.write' })` et les projets personnels. Sinon, comportement actuel : création d'un projet **personnel** du même nom. Aucune erreur ni oracle.
  2. Tâche existante (marqueur `task:<id>`) : si l'auteur n'a plus `task.write` sur le projet actuel de la tâche, la ligne est laissée inchangée, sans mise à jour ni déplacement.
  3. Assigné : résoudre le nom **uniquement** parmi `policy.filterUsersWithProjectAction(project.id, <membres du workspace du projet>, 'task.read')`. Pour un projet personnel, seul l'auteur est assignable. Ne plus jamais chercher `user.findFirst` sur toute la plateforme.
  4. `optimizeWorkspaceResources` : candidats limités, pour chaque tâche, aux utilisateurs ayant `task.read` sur son projet (`filterUsersWithProjectAction`). Une tâche sans candidat n'est pas réassignée.
- **Critères d'acceptation (tests)** :
  1. `notes.service.spec` (ou `tests/unit/authz/notes-access.spec.ts`), avec le vrai `PolicyService` sur la fixture RBAC : créateur sans `Membership` (persona `deprovisioned` ou équivalent créateur), note `#<projet de W>` → **aucun** `task.create` dans ce projet ; une tâche est créée dans un projet personnel.
  2. Marqueur d'une tâche existante d'un projet devenu inaccessible : aucune `task.update`.
  3. Assigné d'un autre tenant, ou membre du workspace sans rôle sur le projet : aucun `taskAssignee.create`. COMMENTER ou plus du projet : assigné.
  4. `optimizeWorkspaceResources` : un VIEWER sans rôle n'est jamais choisi.
  5. Preuve « avant correctif » : le test 1 échoue sur le code actuel (consigné au journal).
  6. `grep -n "user.findFirst" src/notes/notes.service.ts` ne renvoie plus de recherche par `name` ou `githubUsername`.

#### S16-c : une tâche qui change de projet garde les abonnés `task:<id>` de l'ancien projet

- **Sévérité** : Mineur. **CVSS 3.1** `AV:N/AC:H/PR:L/UI:R/S:U/C:L/I:N/A:N`. **À livrer avec S12-f**, dans le même fichier.
- **Localisation** : `notes.service.ts:419-427` (`projectId: project.id`, ligne 425) : c'est le seul chemin qui déplace une tâche. Le salon `task:<id>` n'est recalculé qu'au changement de droits d'un utilisateur (`refreshUserRooms`), pas au changement de projet d'une tâche.
- **Scénario** : Carol, COMMENTER de P1, a ouvert la tâche T. L'auteur déplace T de P1 vers P2 par sa note. Carol, sans rôle sur P2, continue de recevoir `new-comment` et `comment-updated` de T, avec le texte complet.
- **Correction attendue** : au déplacement d'une tâche (`projectChanged`), après écriture, appeler une méthode `RealtimeService.evictTaskRoom(taskId)` (`server.in(taskRoom(id)).socketsLeave(taskRoom(id))`) : les clients autorisés rejoignent à nouveau la tâche par `join-task`. L'intersection `task:<id>` ∩ `project:<id>` dans `emitToTask` reste facultative (Phase 6).
- **Critère d'acceptation** : test unitaire. Après le déplacement de T, `socketsLeave('task:T')` est appelé. Un test d'intégration n'est pas exigé : le mécanisme de sortie de salon est déjà couvert par `task-room-revocation.spec.ts`.

### Constats non bloquants

| ID | Sévérité | Constat | Suite |
| --- | --- | --- | --- |
| Q-2 | Amélioration (assurance) | Matrice : pour un profil autorisé, seul « ni 401 ni 403 » est vérifié ; 120 cas autorisés finissent en 500 à cause du Prisma simulé. Les refus restent intégralement vérifiés, mais une sur-restriction ou un plantage avant la politique sur une route autorisée passerait. | Phase 6 (tests e2e) : exiger `< 500` pour les profils autorisés, avec une liste explicite et justifiée des routes limitées par le simulacre. |
| O5 | Amélioration | `normalizeResolvedAction` copie `priority`, `status` et `dependencyType` sans vérifier l'énumération. Le schéma Gemini (`notes/gemini.service.ts:241,267,284`) les contraint, mais un autre fournisseur ne le ferait pas. | Retirer toute valeur hors énumération, avec le test associé (5 lignes). Peut être fait avec S12-f. |
| S17 (complément) | Mineur | SCIM `DELETE /Users/:id` se contente de désactiver (`applyActiveState(false)`) : les `ProjectMembership` restent, et une reprovision ultérieure du même compte rend en silence les anciens rôles de projet. | Phase 4, avec S17 : sur `DELETE` (et non sur `active=false`), supprimer les `ProjectMembership` de l'utilisateur dans les projets du workspace ; test. |

### Réponses aux questions de fixeur

1. **S12-a critère 2, couverture par composition** : **acceptée.** Chaque maillon est testé séparément avec du code réel :
   - la désactivation SCIM supprime la `Membership` et appelle `refreshUserRooms` (`scim.service.spec.ts:219-225`) ;
   - sans `Membership`, `GET /projects/:id` donne un refus (matrice, profil `deprovisioned`, routes P1) ;
   - le créateur sans `Membership` est refusé (`policy.service.spec`, S12-a) ;
   - la socket quitte `project:` et `task:` (intégration Socket.IO réelle).

   Un test de bout en bout sur une vraie base est attendu en Phase 6 (e2e), pas maintenant.
2. **S12-b, oracle 400/403 sur les identifiants de jalon, livrable, livraison et checklist** : **accepté.** Ce sont des UUID v4 (`@default(uuid())`, 122 bits aléatoires). L'oracle ne révèle que l'existence, jamais le contenu, d'un identifiant que seul quelqu'un qui a eu accès connaît. Aucun changement exigé ; une harmonisation éventuelle relèvera du nettoyage d'A2 en Phase 6.
3. **A2-b, `updateSprint`/`deleteSprint` en 404** : **accepté**, même raisonnement (UUID, existence seule). A2-b visait le mélange d'identifiants de sprint et de tâches dans une même requête, qui est corrigé.
4. **S16-b, recalcul par administrateur** : **accepté.** Le coût, O(OWNER+ADMIN) recalculs par création de projet, reste faible pour les tailles visées. Le recalcul ne fait jamais échouer la création, et chaque `refreshUserRooms` échoue fermé. Un salon `workspace-admin:<id>` ne se justifiera qu'au-delà d'environ 50 administrateurs par workspace ou si la latence de `fetchSockets` avec Redis devient visible. Réévaluation en Phase 6.
5. **S16-a, défense en profondeur d'`emitToTask`** : non exigée pour S16-a, qui est clos. En revanche, l'architecte a trouvé un chemin concret où un abonné `task:<id>` survit sans changement de droits : le déplacement d'une tâche par les notes (S16-c). La correction ciblée (sortie du salon au déplacement) est exigée. L'intersection reste facultative.
6. **`socket.io-client@4.7.5` en devDependency** : **acceptée.** Version épinglée, identique à celle du frontend, aucun nouveau paquet dans le lock (+3 lignes), utilisée seulement en test. Le `ws@8.17.1` transitif porte des avis (GHSA-36xv-jgw5-4q75), mais il est déjà présent par le frontend et ne sert que de client contre un serveur local de test. Il sera traité avec S25 (Phase 5 : montée de version ou `overrides` de `ws` ≥ 8.21 pour les deux paquets).
7. **Runbook § 4.1, `ProjectMembership` orphelines sans nettoyage automatique** : **accepté.** Une ligne orpheline n'ouvre plus aucun accès (S12-a, vérifié par mutation), et la conserver permet de rétablir les rôles après une suspension temporaire `active=false`, ce qui est le comportement attendu d'une suspension. La suppression définitive (`DELETE` SCIM) doit en revanche purger ces lignes : c'est le complément S17 ci-dessus, en Phase 4. La requête SQL est correcte.

### Décisions produit (vérification, non tranchées)

| Décision | Signalée | Comportement par défaut appliqué |
| --- | --- | --- |
| P4 (MEMBER ou VIEWER sans `ProjectMembership`) | Oui (runbook § 2 et § 5, journal) | Règle stricte : refus vérifié par la matrice (profils `member` et `viewer` sur P1 et P2). Script `grant-legacy-project-access.ts` non écrit, conformément à la consigne. |
| `timelog.read` réservé à MANAGER et CONTRIBUTOR | Oui | `permissions.ts:53` : `WRITE_PROJECT`. |
| DTO strict de `ai/execute` | Oui | `AppValidationPipe` : `whitelist` et `forbidNonWhitelisted` ; un champ inconnu envoyé par le client est refusé (`ai-roundtrip.spec`). |

Les trois restent **en attente de l'utilisateur**. Les recommandations de r11 sont inchangées.

### Plan d'action r12 pour fixeur (ordre obligatoire)

Méthode inchangée : test d'abus qui échoue d'abord, avec l'échec consigné au journal, puis correctif minimal, puis suites complètes. Aucune base réelle, aucun commit. Ne pas toucher aux décisions produit.

| # | ID | Action | Terminé quand |
| --- | --- | --- | --- |
| 1 | S12-f | Notes : projet cible, tâche existante et assigné par `PolicyService` ; suppression de la recherche globale d'utilisateurs. `optimizeWorkspaceResources` : candidats filtrés par `task.read`. | Les 6 critères S12-f passent ; l'échec initial du critère 1 est consigné. |
| 2 | S16-c | `RealtimeService.evictTaskRoom(taskId)` appelé au déplacement d'une tâche par les notes. | Test unitaire ; `notes.module` importe le module temps réel sans dépendance circulaire (`nest build` et démarrage de test OK). |
| 3 | O5 (facultatif) | Valeurs hors énumération retirées par `normalizeResolvedAction`. | Test : `priority: 'URGENT'` retiré, action acceptée par le DTO. |
| 4 | Clôture | Toutes les suites et tous les outils, comme en r11 ; entrées du journal en `CORRIGÉ – À REVOIR`. | Backend : `jest` vert, `nest build` sans `*.spec.js`, `tsc` (build) 0, ESLint 0 erreur et 17 avertissements au plus, `prettier` et `prisma validate` OK. Frontend inchangé ou vert. Résultats exacts au journal (« Résultats (r12) »). |

**Constats ouverts à la fin de r12 :**

- Phase 3 : A2, S12 (S12-f), S16 (S16-c) ; O5 facultatif.
- Décisions produit en attente de l'utilisateur : P4, `timelog.read`, DTO IA.
- Phase 1 : P9.
- Phases 4 à 6 : S17 (avec le complément SCIM `DELETE`) à S26 sauf S18 étapes 0 et 2 ; A5 à A9 ; P2, P4, P5, P7, P8 ; Q-2.
- Clos : S1 à S11, S12-a à S12-e, S13, S14, S15, S16-a, S16-b, S27, S28, S29, A1, A2-b, A3, A4, O3, O4, P1, P3, P6, Q-1.

## Revue r13 — Phase 3 : NON VALIDÉ (2026-11-03)

Revue des actions r12 (journal, sections « Actions de la revue r12 », « Résultats (r12) » et « Points ouverts pour l'architecte (r12) »). Toutes les commandes ont été relancées par l'architecte, les mutations rejouées une par une, et trois preuves faites dans des fichiers jetables, supprimés ensuite. Aucune base réelle, aucun commit.

S12-f et O5 sont faits et tenus par des tests qui échouent quand on retire le correctif. Les chiffres du journal sont exacts. Le verdict reste **NON VALIDÉ** pour deux constats nouveaux sur le même fichier (`notes.service.ts`), tous deux prouvés. Premier constat : une note peut **sortir une tâche du workspace**, avec les commentaires et les pièces jointes des autres membres (S12-h, bloquant). Second constat : la synchronisation tâche vers note continue d'écrire les titres du workspace dans la note d'un auteur qui a perdu l'accès (S12-g). S16-c n'est pas tout à fait fini : l'implémentation d'`evictTaskRoom` n'est couverte par aucun test. Ce sont les deux derniers chemins des notes. La revue r12 ne les avait pas relevés, parce qu'elle s'était concentrée sur la création et l'assignation.

### Vérifications refaites par l'architecte

| Commande ou contrôle | Résultat |
| --- | --- |
| Intégrité de l'arbre après les `git stash` du fixeur | `git stash list` vide. `git status` : 83 entrées (72 suivies modifiées ou supprimées, 11 non suivies). `src/authz/`, `src/realtime/`, `dto/associate-tasks.dto.ts`, `dto/execute-ai-actions.dto.ts`, migration `20261111000000_s12_attachment_uploader`, `runbook-phase3.md`, `tests/http/{global-auth,projects-realtime-routes,rbac-matrix}.spec.ts`, `tests/support/rbac-fixture.ts`, `tests/unit/authz/` (10 fichiers), `tests/integration/realtime/task-room-revocation.spec.ts` : présents. Aucun marqueur de conflit dans `backend/src`, `backend/tests`, `docs/security`. Correctifs r11 en place (S12-a `policy.service.ts:97-106`, S12-b sans `memberships: { some: { userId`, S12-c et S16-a). `tests/integration/projects/` est vide, mais il l'était déjà à l'origine (A9) : rien n'a été perdu. **Arbre intact.** |
| `cd backend && env -u DATABASE_URL npx jest` | **74/74 suites, 2196/2196 tests** (identique au journal ; relancé une seconde fois après les mutations : identique) |
| `nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 122 `.js` ; 0 `*.spec.js` |
| `tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `eslint src tests scripts` ; `prettier --check src tests scripts` ; `prisma validate` | 0 erreur, 17 avertissements ; conforme ; valide |
| `jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| Frontend `vitest` / `tsc` / `eslint` / `vite build` | Aucun fichier modifié (`git status frontend` vide). 15/15 fichiers, 59/59 ; exit 0 ; 0 erreur (36 avertissements) ; OK |
| Rejeu du `notes.service.ts` de HEAD contre `notes-access.spec` | **8 échecs sur 10** : identique au journal (critère 5 de S12-f) |
| M1 : projet cible sans `id: { in: writableIds }` | 1 échec (créateur sans `Membership`) ; restauré |
| M2 : tâche existante sans contrôle `canWriteExisting` | 1 échec (projet devenu inaccessible) ; restauré |
| M3 : assigné non filtré par `task.read` (`candidates[0]`) | 1 échec (membre sans rôle) ; restauré |
| M4 : `optimizeWorkspaceResources` sans filtre `readers` | 2 échecs (`rbac-services.spec`, S12-f) ; restauré |
| M5 : appel `evictTaskRoom` retiré de `notes.service.ts` | 1 échec (déplacement P1 vers P2) ; restauré |
| M6 : O5, filtre d'énumération retiré | 1 échec (`ai-roundtrip.spec`) ; restauré |
| **M7 : `RealtimeService.evictTaskRoom` vidé (`return;`)** | **0 échec sur 525** (`tests/unit/authz`, `tests/integration`) : l'implémentation n'est testée nulle part (S16-c) ; restauré |
| Critère 6 de S12-f : `grep -n "user.findFirst" src/notes/notes.service.ts` | vide ; seul `user.findUnique` sur l'auteur subsiste (`resolveAssignee`, projet personnel) |
| Preuve S12-g (test jetable, vrai `PolicyService`, fixture RBAC) | Auteur `deprovisioned` (aucune `Membership`), tâche de `P-W1` liée à sa note ; `syncTaskStatusToNote('T9','DONE')` écrit dans sa note : `- [x] Rachat de ACME (confidentiel) #Roadmap-Secrete <!-- task:T9 -->`. **Reproduit.** Fichier supprimé. |
| Preuve S12-h (test jetable, vrai `PolicyService`, fixture RBAC) | CONTRIBUTOR de P1, tâche `TC` de P1 créée par sa note ; contenu `- [ ] Tâche C #Perso <!-- task:TC -->` : `task.update` avec `projectId: 'P-perso'` (projet personnel créé à la volée). **Reproduit.** Fichier supprimé. |
| Puits qui recopient des données de projet vers un destinataire (`note.update`, `aiBriefing.*`, courriels) | Courriel de mention : après le filtre S12-c. Briefing : `listAccessibleProjectIds` (`copilot.service.ts:210-243`). **Reste `syncTaskStatusToNote` (S12-g).** Seules les notes changent `Task.projectId` : l'API des tâches n'offre aucun déplacement. |

**Incident de procédure (architecte), sans effet sur l'arbre.** Lors du premier essai de mutation, `cp` (alias `cp -i`) a attendu une confirmation, puis `$C` n'a pas été découpé en mots sous zsh. Résultat : sept mutations sont restées appliquées en cumul pendant un passage de tests. Les fichiers ont été restaurés à partir de copies prises avant toute mutation et vérifiées par `cmp` contre l'état du fixeur. La ligne de `realtime.service.ts` a été rétablie à l'identique. Contrôle après restauration : diff de HEAD identique (89/129/76 lignes), `cmp` OK, puis suite complète de nouveau à 74/74 et 2196, ESLint 17, `prettier` conforme. Les résultats M1 à M7 ci-dessus viennent du second passage, qui isole chaque mutation (script `bash`, `/bin/cp -f`, restauration par `trap`).

### Statut des constats

| ID | Statut r13 | Constat |
| --- | --- | --- |
| S12-f | **CLOS** | Les 6 critères passent. Projet cible borné à `listAccessibleProjectIds(…, 'task.write')` ; tâche existante non écrivable laissée telle quelle ; assigné résolu parmi les membres du workspace du projet puis filtré par `task.read` (auteur seul en projet personnel) ; plus aucun `user.findFirst` ; `optimizeWorkspaceResources` limité aux lecteurs du projet, sans réassignation si aucun candidat. Mutations M1 à M4 détectées ; preuve « avant » rejouée (8/10). |
| O5 | **CLOS** | `RESOLVED_ACTION_ENUM_FIELDS` est aligné sur les `@IsIn` d'`ExecuteAiActionsDto` (`priority`, `status`, `dependencyType`) ; M6 détectée. |
| S16-c | **À REPRENDRE** (petit) | L'appel est en place et testé (M5), mais le critère r12 (« `socketsLeave('task:T')` est appelé ») n'est pas vérifié : le test simule tout `RealtimeService`, et M7 survit. Voir le plan d'action. |
| **S12-g** | **OUVERT** (nouveau, Mineur) | Fuite en lecture vers un auteur sans accès, via `syncTaskStatusToNote`. |
| **S12-h** | **OUVERT** (nouveau, Moyen, bloquant) | Déplacement d'une tâche hors de son workspace par une note. |
| A2 | Ouvert | Se ferme avec S12-g et S12-h : ce sont les deux derniers chemins des notes hors politique. |
| S12, S16 | Ouverts | S12-a à S12-f clos ; S12-g et S12-h ouverts. S16-a et S16-b clos ; S16-c à reprendre. |

### Nouveaux constats r13

#### S12-h : une note déplace une tâche hors de son workspace, avec le travail des autres membres

- **Sévérité** : Moyen. **CVSS 4.2** `AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:L/A:N`. **Bloquant** : c'est une suppression déguisée, qui contourne `comment.delete` et `attachment.delete` (MANAGER seul, `permissions.ts:49,52`), et une exfiltration hors du tenant.
- **Localisation** : `backend/src/notes/notes.service.ts:452` (`projectChanged`) et `:467-476` (`task.update` avec `projectId: project.id`). La destination est bien autorisée (`writableIds` ou projet personnel neuf), mais rien ne la borne au **workspace de la source**. Les `Comment`, `Attachment`, `TimeLog`, `TimeBlock` et `TaskAssignee` suivent la tâche (`taskId`). L'API des tâches n'offre aucun déplacement, donc ce chemin est le seul.
- **Scénario (reproduit)** : Carla, CONTRIBUTOR de P1 (W1), crée une tâche T par sa note. Des collègues y déposent commentaires confidentiels et pièces jointes. Carla remplace `#Projet1` par `#Perso` : T passe dans un projet personnel créé à la volée. Les membres de W1 ne voient plus T (effet de suppression, sans le rôle MANAGER exigé pour supprimer commentaires et pièces jointes). Carla garde tout après sa désactivation SCIM, ce qui annule S12-a pour ce contenu. Variante : si Carla est aussi CONTRIBUTOR dans un autre workspace W2, `#ProjetW2` fait passer T, et les commentaires de W1, chez les membres de W2.
- **Correction attendue** : dans le bloc de mise à jour d'une tâche existante, le déplacement n'est permis que si `project.workspaceId === existingTask.project.workspaceId` (deux projets du même workspace, ou deux projets personnels de l'auteur). Sinon, `projectId` reste inchangé : les autres champs (titre, statut, échéance) sont mis à jour normalement, sans erreur ni oracle, et `evictTaskRoom` n'est pas appelé. Le chargement du workspace source peut passer par `include: { project: { select: { workspaceId: true } } }` sur le `findFirst` de la ligne 426.
- **Critères d'acceptation (tests, dans `notes-access.spec.ts`)** :
  1. CONTRIBUTOR de P1, tâche de P1 liée à sa note, `#Perso` : aucun `task.update` avec un `projectId` différent de `P1` ; le titre ou le statut modifiés sont, eux, appliqués.
  2. Auteur membre de W et `OTHER_W` avec `task.write` sur un projet de chaque : aucun déplacement de W vers `OTHER_W`.
  3. Contrôle positif conservé : déplacement P1 vers P2 (même workspace, `task.write` sur les deux), suivi de l'éviction S16-c.
  4. Tâche d'un projet personnel déplacée vers un autre projet personnel de l'auteur : permis.
  5. Preuve « avant » : le test 1 échoue sur le code actuel (consigné au journal).

#### S12-g : la synchronisation tâche vers note écrit dans la note d'un auteur sans accès

- **Sévérité** : Mineur. **CVSS 3.1** `AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N`. À livrer avec S12-h : même fichier, même critère d'origine (S12-a, aucun accès sans `Membership`).
- **Localisation** : `backend/src/notes/notes.service.ts:219-273` (`syncTaskStatusToNote`), appelé par `tasks.service.ts:382` (`updateTask` avec `status` ou `title`) et `:554`. La note de l'auteur reçoit le titre courant et le nom du projet (`:257-266`) sans vérifier que cet auteur peut encore lire la tâche.
- **Scénario (reproduit)** : Bob est désactivé par SCIM ou retiré du projet. Sa note contient encore une ligne `<!-- task:T9 -->`. Un collègue renomme T9 (« Rachat de ACME (confidentiel) ») ou la passe à `DONE`. La nouvelle ligne est écrite dans la note de Bob, qu'il lit par `GET /notes`. Il suit ainsi les titres et l'état d'un projet auquel il n'a plus accès.
- **Correction attendue** : après le chargement de la tâche, si `policy.filterUsersWithProjectAction(task.projectId, [note.userId], 'task.read')` ne renvoie pas l'auteur, sortir sans écrire (aucun `note.update`, aucune invalidation de cache). Pas d'erreur : l'appelant (`updateTask`) ne doit pas échouer.
- **Critères d'acceptation** : (1) auteur `deprovisioned`, tâche d'un projet de W : aucun `note.update` ; (2) auteur avec `task.read` : la ligne est mise à jour (contrôle positif) ; (3) preuve « avant » : le test 1 échoue sur le code actuel ; (4) mutation « vérification retirée » : au moins un échec.

### Constats non bloquants

| ID | Sévérité | Constat | Suite |
| --- | --- | --- | --- |
| O6 | Amélioration (performance) | `listAccessibleProjectIds` est appelé une fois **par ligne de tâche** de la note (`notes.service.ts:392`), et `membership.findMany` une fois par assigné. Une note de 500 cases à cocher déclenche 500 calculs de droits. | Facultatif, dans la même livraison : calculer `writableIds` une seule fois avant la boucle. Aucun test de sécurité supplémentaire. |
| Q-2, complément S17, `ws`/S25 | Inchangés | Voir r12. | Phases 4 à 6. |

### Réponses aux questions de fixeur

1. **Contrainte `userId` du projet cible : conservée, accepté.** C'est le comportement d'origine. Il évite l'ambiguïté entre projets homonymes et n'empêche aucune fonction essentielle : il ne fait que créer un projet personnel. Viser tout projet de workspace où l'auteur a `task.write` serait une évolution produit, pas une exigence de sécurité. Rien à changer.
2. **Projet personnel homonyme créé avant le constat : accepté.** L'effet est idempotent (la ligne suivante retrouve ce projet) et sans portée de sécurité. Il n'y a pas d'ordre à changer. Avec S12-h, la règle de déplacement s'applique après la résolution du projet, comme aujourd'hui.
3. **Tâche d'un projet supprimé non modifiable par une note : accepté.** C'est cohérent avec la politique (projet supprimé = 404). Une tâche orpheline ne doit pas pouvoir être ressuscitée ni déplacée par une note. À mentionner dans le runbook (action 4).
4. **Tranché, aucune action, pas de renvoi en Phase 6.**
   - `calendar-sync.service.ts:743-763` : la seule route d'entrée, `POST /projects/workspaces/:id/calendar/sync` (`projects.controller.ts:569-576`), exige OWNER/ADMIN via `assertWorkspaceAccess`, qui délègue à `policy.assertWorkspaceRoles`. OWNER et ADMIN sont MANAGER implicites de tous les projets (`policy.service.ts:101`). Créer la tâche technique dans le premier projet est donc couvert par `task.write`.
   - `proactive-scheduler` : l'alerte `OVERLOADED` envoyée à l'utilisateur surchargé ne contient que son nom et des heures (`copilot.service.ts:190`), aucun titre. Les alertes qui citent des tâches (`CRITICAL`, `HIGH`) ne vont qu'aux OWNER/ADMIN (`proactive-scheduler.service.ts:74-85`). Les briefings sont bornés par `listAccessibleProjectIds` (`copilot.service.ts:210-243`). Le risque signalé n'existe pas.
5. **S16-c, test isolé : exigé.** M7 (implémentation vidée) passe 525/525, ce qui veut dire que le critère r12 n'est pas vérifié. Ajouter dans `tests/unit/authz/realtime.spec.ts` un test sur un serveur factice : `evictTaskRoom('T1')` appelle `server.in('task:T1')` puis `socketsLeave('task:T1')` ; sans serveur attaché, aucune exception. Le test d'intégration Socket.IO n'est pas exigé.
6. **Recherche par motifs : insuffisante seule.** Elle a manqué S12-g et S12-h, deux chemins du seul module, hors `projects/`, qui écrit dans des projets. Pour r13, il n'y a pas de recherche supplémentaire à faire : l'architecte a fait la recherche des puits (tableau ci-dessus), et le module des notes est désormais relu en entier. La relecture complète, contrôleur par contrôleur, relève d'A5 (Phase 6).

**Procédure de preuve (exigence, pour la suite).** Ne plus utiliser `git stash` pour les preuves « avant correctif » : avec plus de 80 fichiers non commités, un stash emporte tout le travail de la phase, et une erreur d'`unstash` le perd. Pour rejouer l'ancienne version d'un fichier, utiliser `git show HEAD:<chemin> > <chemin>` après une copie de sauvegarde dans le scratchpad (`/bin/cp -f`, pas l'alias `cp -i`). Restaurer ensuite par copie et vérifier par `cmp`. Puis consigner au journal `git stash list` (vide) et le nombre d'entrées de `git status`.

### Plan d'action r13 pour fixeur (ordre obligatoire)

Méthode inchangée : test d'abus qui échoue d'abord, avec l'échec consigné au journal, puis correctif minimal, puis suites complètes. Aucune base réelle, aucun commit, aucun `git stash`. Ne pas toucher aux décisions produit.

| # | ID | Action | Terminé quand |
| --- | --- | --- | --- |
| 1 | S12-h | Déplacement d'une tâche par une note limité au même workspace (ou entre projets personnels) ; sinon `projectId` inchangé, autres champs appliqués, aucune éviction. | Les 5 critères S12-h passent ; l'échec initial du critère 1 est consigné. |
| 2 | S12-g | `syncTaskStatusToNote` : aucune écriture si l'auteur de la note n'a plus `task.read` sur le projet de la tâche. | Les 4 critères S12-g passent ; l'échec initial est consigné. |
| 3 | S16-c | Test unitaire d'`evictTaskRoom` sur un serveur factice (`in('task:T1')`, `socketsLeave('task:T1')`, aucun serveur : pas d'exception). | La mutation M7 (`return;`) fait échouer ce test (consigné). |
| 4 | Runbook | `runbook-phase3.md` § 4.2 : changements visibles de r12 et r13 : un tag `#Projet` ne vise que les projets de l'auteur où il peut écrire, sinon un projet personnel ; une tâche dont l'auteur a perdu l'accès, ou dont le projet est supprimé, n'est plus modifiée par la note ; une tâche ne change plus de workspace par une note ; la note d'un auteur sans accès n'est plus synchronisée ; assigné IA sans accès ignoré ; optimisation de charge sans réassignation si aucun candidat autorisé. | Paragraphe présent. |
| 5 | O6 (facultatif) | `writableIds` calculé une fois par analyse de note. | Suites vertes. |
| 6 | Clôture | Toutes les suites et tous les outils, comme en r12 ; `git stash list` vide ; entrées du journal en `CORRIGÉ – À REVOIR`. | Backend : `jest` vert, `nest build` sans `*.spec.js`, `tsc` (build) 0, ESLint 0 erreur et 17 avertissements au plus, `prettier` et `prisma validate` OK. Frontend inchangé ou vert. Résultats exacts au journal (« Résultats (r13) »). |

**Constats ouverts à la fin de r13 :**

- Phase 3 : A2, S12 (S12-g, S12-h), S16 (S16-c, test) ; O6 facultatif.
- Décisions produit en attente de l'utilisateur, **non tranchées** : P4, `timelog.read`, DTO IA.
- Phase 1 : P9.
- Phases 4 à 6 : S17 (avec le complément SCIM `DELETE`) à S26 sauf S18 étapes 0 et 2 ; A5 à A9 ; P2, P4, P5, P7, P8 ; Q-2.
- Clos : S1 à S11, S12-a à S12-f, S13, S14, S15, S16-a, S16-b, S27, S28, S29, A1, A2-b, A3, A4, O3, O4, O5, P1, P3, P6, Q-1.

## Revue r14 — Phase 3 : NON VALIDÉ (2026-11-03)

Revue des actions r13 (journal : « Actions de la revue r13 », « Résultats (r13) », « Points ouverts pour l'architecte (r13) ») et du runbook `runbook-phase3.md` (§ 2, § 4.2, § 5). L'architecte a relancé toutes les commandes et rejoué les mutations une par une (sauvegarde `/bin/cp -f` dans le scratchpad, une seule substitution vérifiée, restauration, `cmp` : « restored » à chaque fois). Une preuve a été faite dans un fichier jetable, supprimé ensuite. Aucun `git stash`, aucune base réelle, script P4 jamais exécuté, aucun commit.

S12-h, S12-g, S16-c et O6 sont faits. Chacun est tenu par des tests qui échouent quand on retire le correctif, et les chiffres du journal sont exacts. Le verdict reste **NON VALIDÉ**, pour une régression prouvée du correctif S12-h. Quand une note vise un projet d'un autre workspace, le déplacement est bien refusé, mais l'assigné proposé par l'IA est toujours résolu dans le projet **refusé**. Il est ensuite attaché à la tâche restée dans son workspace, et les assignés légitimes sont supprimés (**S12-i**, nouveau, bloquant). Le correctif est petit et localisé. Le script P4 est sûr par construction, mais trois de ses exclusions ne sont pas testées : le faux Prisma refait lui-même les filtres.

### Vérifications refaites par l'architecte

| Commande ou contrôle | Résultat |
| --- | --- |
| État reçu | `git stash list` vide ; `git status --short` : 85 entrées ; empreinte `git diff` notée au début et identique à la fin (rien n'a été laissé modifié) |
| `cd backend && env -u DATABASE_URL npx jest` | **75/75 suites, 2213/2213 tests** (identique au journal) |
| `nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 122 `.js` ; 0 `*.spec.js` |
| `tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `eslint src tests scripts` ; `prettier --check` ; `prisma validate` | 0 erreur, 17 avertissements ; conforme ; valide |
| `jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| Frontend | `git status frontend` vide ; vitest 15 fichiers, 59/59 ; `tsc` 0 ; ESLint 0 erreur (36 avertissements) ; `vite build` OK |
| M8 : S12-h, `sameWorkspace = true` | 3 échecs (`tests/unit/authz`, `src/notes`, `tests/integration` : 544 tests) ; restauré |
| M9 : S12-h, `projectId: project.id` toujours écrit | 2 échecs ; restauré |
| M10 : S12-g, garde `readers.includes` retirée | 2 échecs ; restauré |
| M11 : S16-c, `evictTaskRoom` vidé (`return;`, ancienne M7) | **1 échec** (survivait en r13) ; restauré |
| M12 : O6, projet personnel non ajouté à `writableIds` | 1 échec (deux projets `#Perso` créés) ; restauré |
| P4-1 : `--apply` ignoré (écriture en mode rapport) | 1 échec ; restauré |
| P4-2 : rôles existants non exclus (`already.has` retiré) | 2 échecs ; restauré |
| P4-8 : adresse dans le CSV | 1 échec ; restauré |
| **P4-3 : `OWNER: 'CONTRIBUTOR'` ajouté au mapping** | **0 échec** ; restauré |
| **P4-4 : filtre `role` et `workspace.deletedAt` retiré de `membership.findMany`** | **0 échec** ; restauré |
| **P4-5 : `deletedAt: null` retiré de `project.findMany`** | **0 échec** ; restauré |
| P4-6 : `skipDuplicates: false` | 0 échec (le faux `createMany` ignore toujours les doublons). Garantie réelle vérifiée à la lecture : `@@unique([projectId, userId])` (`project.prisma:112`) et `skipDuplicates` (INSERT IGNORE sous MariaDB). Aucun chemin d'écriture n'est un `update` ni un `upsert`. |
| **Preuve S12-i** (test jetable, vrai `PolicyService`, fixture RBAC) | CONTRIBUTOR de P1 (W), aussi CONTRIBUTOR créateur de `PX` (« Externe », OTHER_W). Tâche `TC` de P1 liée à sa note. Ligne `- [ ] Tâche C #Externe <!-- task:TC -->`, IA : `assigneeName: 'outsider'` (OWNER d'OTHER_W). Résultat : aucun `task.update` (déplacement refusé, S12-h tient), mais **`taskAssignee.create({ taskId: 'TC', userId: 'u-outsider' })`**, précédé d'un `deleteMany({ where: { taskId: 'TC' } })`. **Reproduit.** Fichier supprimé. |

### Revue du script P4 (`backend/scripts/grant-legacy-project-access.ts`)

- **Sûreté de `--apply`** : mode rapport par défaut. `parseArgs` exige le jeton exact `--apply` (une faute de frappe ou `--apply=false` laisse en mode rapport). Le script ne s'exécute que par `require.main === module`, donc jamais à l'import par les tests ni par la CI. Conforme.
- **Aucun écrasement** : une seule écriture, `createMany` avec `skipDuplicates` sur `@@unique([projectId, userId])`. Les paires qui existent déjà sont exclues en amont (`already`), et l'INSERT IGNORE les ignore en cas de course. Aucun `update`, `upsert` ni `delete`. Conforme.
- **Transaction** : correcte, et utile si Prisma découpe le `createMany` en plusieurs requêtes. Les lectures sont faites hors transaction. Deux courses sont possibles entre lecture et écriture : un projet supprimé ou une `Membership` retirée entre-temps. Dans ce cas, la ligne créée reste sans effet, car la politique exige `deletedAt: null` et une `Membership` (S12-a). Point acceptable. Amélioration : la transaction interactive a un délai de 5 s par défaut. Sur une grosse base, elle échouera proprement (rollback) ; prévoir `{ timeout: 120_000 }`.
- **Idempotence** : vérifiée à la lecture et par le test (seconde exécution : 0 accès).
- **CSV** : identifiants et rôles seulement, droits 600, dossier `reprise-phase0/` ignoré par git (`.gitignore:19`). Les identifiants restent des données pseudonymes, d'où le droit 600, qui est suffisant.
- **Écarts** : (a) les exclusions OWNER/ADMIN, workspaces supprimés et projets supprimés ne sont pas testées (P4-3, P4-4 et P4-5 survivent). Elles sont sans effet de sécurité, car la politique neutralise ces lignes, mais le journal les donne pour couvertes. (b) Le **créateur** d'un projet (MEMBER) reçoit une ligne CONTRIBUTOR inutile, alors que la requête SQL du runbook § 2 l'exclut (`p.userId <> m.userId`). Le rapport du script et le décompte SQL ne concordent donc pas, ce qui gêne la décision de l'utilisateur. Le rôle effectif n'est pas dégradé : le créateur est testé avant la `ProjectMembership` (`policy.service.ts:101-102`).

### Statut des constats

| ID | Statut r14 | Constat |
| --- | --- | --- |
| S12-h | **CLOS** | Les 5 critères passent ; M8 et M9 détectées. Égalité stricte des `workspaceId` acceptée (question 1). La régression sur l'assigné est suivie à part (S12-i). |
| S12-g | **CLOS** | Les 4 critères passent ; M10 détectée ; aucune erreur remontée à `updateTask`. |
| S16-c | **CLOS** | Test isolé présent ; M11 (ex-M7) détectée. |
| O6 | **CLOS** | Un seul calcul par analyse ; projet personnel créé ajouté au cache (M12 détectée). |
| Runbook § 4.2 | Fait | Paragraphe « Reprise r12 et r13 » conforme. À compléter d'une ligne après S12-i. |
| **S12-i** | **OUVERT** (nouveau, Moyen, bloquant) | Assigné résolu dans le projet cible refusé (voir ci-dessous). |
| P4 (script) | **À REPRENDRE** (petit, non sécuritaire) | Tests d'exclusion à rendre effectifs ; créateur à exclure. |
| Décisions produit | **Tranchées par l'utilisateur le 2026-11-03** | P4 règle stricte avec script optionnel ; `timelog.read` MANAGER/CONTRIBUTOR ; DTO IA strict. Consigné ici. `src/authz/permissions.ts:11-13` dit encore « Décision produit à confirmer (P4) » : à mettre à jour. |
| A2 | Ouvert | Se ferme avec S12-i. |
| S12 | Ouvert | S12-a à S12-h clos ; S12-i ouvert. **S16 : clos** (S16-a, S16-b, S16-c). |

### Nouveau constat r14

#### S12-i : sur un déplacement refusé, l'assigné est résolu dans le projet refusé et attaché à la tâche

- **Sévérité** : Moyen. **CVSS 4.2** `AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:L/A:N`. **Bloquant** : régression introduite par le correctif S12-h, qui viole la règle S12-c (n'assigner que des personnes ayant `task.read` sur le projet **de la tâche**) et croise deux tenants.
- **Localisation** : `backend/src/notes/notes.service.ts:429-431`. `resolveAssignee(userId, project, …)` utilise le projet **cible** de la ligne. Puis, aux lignes `:501-510`, `taskAssignee.deleteMany({ where: { taskId } })` et `taskAssignee.create` s'appliquent à la tâche existante, **même quand `projectChanged` est faux** parce que le déplacement est refusé (S12-h).
- **Scénario (reproduit)** : Carla est CONTRIBUTOR dans W (P1) et dans OTHER_W (projet « Externe »). Sa ligne `- [ ] Tâche C #Externe <!-- task:TC -->`, avec un texte qui fait proposer « outsider » à l'IA, laisse TC dans P1 mais y attache un membre d'OTHER_W et supprime les assignés de W. Effets : l'identité (nom, e-mail via l'`include` des assignés) d'un membre d'un autre tenant est exposée aux membres de W ; les assignations de W perdent leur intégrité ; la charge et la synchronisation calendrier de W comptent une personne étrangère. Variante bénigne : une tâche personnelle reçoit comme assigné un membre de W (cible `#Alpha` refusée).
- **Correction attendue** : résoudre l'assigné contre le projet **effectif** de la tâche. Pour une tâche existante : `projectChanged ? project : { id: existingTask.projectId, workspaceId: existingTask.project.workspaceId }`. Pour une création : `project`. Le plus simple est de déplacer l'appel à `resolveAssignee` dans chaque branche, après le calcul de `projectChanged`. La branche « tâche non écrivable » ne doit toujours rien assigner.
- **Critères d'acceptation (dans `notes-access.spec.ts`)** :
  1. Scénario ci-dessus : aucun `taskAssignee.create` et aucun `taskAssignee.deleteMany` sur `TC`.
  2. Déplacement refusé (`#Perso` ou `#Externe`), assigné proposé = COMMENTER de P1 : assigné à TC (résolution contre P1, contrôle positif).
  3. Déplacement accepté P1 vers P2 (OWNER), assigné proposé = COMMENTER de P1 seulement : **non** assigné (résolution contre P2).
  4. Preuve « avant » : le test 1 échoue sur le code actuel (consigné).
  5. Mutation « résolution contre `project` » : au moins un échec.

### Réponses aux points ouverts (r13)

1. **S12-h, égalité stricte : confirmé.** Les déplacements personnel vers workspace et workspace vers personnel sont refusés tous les deux. Le premier ferait entrer dans un tenant du contenu non contrôlé ; le second est l'exfiltration de S12-h. Une ligne sans tag ne sort plus une tâche de son projet : c'est le comportement voulu, documenté au § 4.2. Amélioration non exigée (O7) : sur un déplacement refusé, le projet personnel cible (`#Perso`) est quand même créé, vide. Effet cosmétique, sans risque.
2. **O6, `resolveAssignee` sans cache : accepté.** L'appel n'a lieu que si l'IA propose un assigné, au plus une fois par ligne, et il est borné au workspace. Aucune action ; à revoir avec A5 si les performances le demandent.
3. **P4, « Membership active » = existence de la ligne : confirmé.** La désactivation SCIM supprime la `Membership` (`scim.service.ts:110-120`). Le périmètre large est assumé : l'utilisateur décide sur le rapport, et le runbook § 2 le dit. À corriger : exclure le créateur, pour aligner le script sur la requête SQL du runbook (voir le plan).
4. **Hors périmètre : confirmé.** Q-2, le complément S17 (SCIM `DELETE`) et `ws`/S25 restent en Phases 4 à 6.

### Plan d'action r14 pour fixeur (ordre obligatoire)

Méthode inchangée : un test d'abus qui échoue d'abord, avec l'échec consigné, puis le correctif minimal, puis les suites complètes. Aucune base réelle, aucun commit, aucun `git stash` (sauvegarde `/bin/cp -f`, restauration, `cmp`). Script P4 jamais exécuté.

| # | ID | Action | Terminé quand |
| --- | --- | --- | --- |
| 1 | S12-i | Assigné résolu contre le projet effectif de la tâche (existante : projet d'origine si le déplacement est refusé). | Les 5 critères S12-i passent ; échec initial du critère 1 consigné. |
| 2 | P4 (script) | (a) Faux Prisma qui **évalue** les `where` reçus, ou assertions `toHaveBeenCalledWith` sur `membership.findMany` (`role in [MEMBER, VIEWER]`, `workspace.deletedAt: null`) et `project.findMany` (`deletedAt: null`) ; plus un test pur `planLegacyGrants` avec des `Membership` OWNER/ADMIN : aucun accès. (b) Exclure le créateur du projet (`select userId` sur `project.findMany`, `project.userId === m.userId` ignoré), comme la requête SQL du runbook § 2. (c) Facultatif : `$transaction(…, { timeout: 120_000 })`. | P4-3, P4-4 et P4-5 font échouer au moins un test ; test « créateur non concerné » vert ; script toujours jamais exécuté. |
| 3 | Doc | `src/authz/permissions.ts:11-13` : « P4 tranchée le 2026-11-03 : règle stricte ». Runbook § 4.2 : une ligne pour S12-i (« l'assigné proposé est vérifié contre le projet où reste la tâche »). Runbook § 2 : mentionner l'exclusion du créateur. | Textes présents. |
| 4 | Clôture | Toutes les suites et tous les outils comme en r13 ; `git stash list` vide ; entrées en `CORRIGÉ – À REVOIR`. | Backend : `jest` vert, `nest build` sans `*.spec.js`, `tsc` (build) 0, ESLint 0 erreur et 17 avertissements au plus, `prettier` et `prisma validate` OK ; frontend inchangé. « Résultats (r14) » exacts au journal. |

**Constats ouverts à la fin de r14 :**

- Phase 3 : **S12-i** (bloquant), A2 (se ferme avec S12-i), P4 (script : tests et créateur), documentation (`permissions.ts`, runbook). O7 facultatif.
- Décisions produit : **tranchées par l'utilisateur le 2026-11-03** (P4 stricte avec script optionnel, `timelog.read`, DTO IA). Reste à la seule initiative de l'utilisateur : exécuter ou non le script P4 (rapport, puis `--apply` après sauvegarde).
- Phase 1 : P9.
- Phases 4 à 6 : S17 (avec le complément SCIM `DELETE`) à S26 sauf S18 étapes 0 et 2 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2.
- Clos : S1 à S11, S12-a à S12-h, S13 à S16, S27, S28, S29, A1, A2-b, A3, A4, O3 à O6, P1, P3, P6, Q-1.

## Revue r15 — Phase 3 : NON VALIDÉ (2026-11-04)

Revue des actions r14 (journal : « Actions de la revue r14 », « Résultats (r14) », « Points ouverts pour l'architecte (r14) »). L'architecte a relancé toutes les commandes et rejoué les mutations une par une : sauvegarde `/bin/cp -f` dans `/tmp`, une seule substitution dont l'unicité a été vérifiée, restauration et `cmp` (« restored » à chaque fois). Une preuve a été faite dans un fichier jetable, supprimé ensuite. Aucun `git stash`, aucune base réelle, script P4 jamais exécuté, aucun commit, `.claude/` non touché.

Tout ce que demandait r14 est fait et tenu par des tests : S12-i, le script P4 (exclusions effectives, créateur exclu, délai de transaction) et la documentation. Les chiffres du journal sont exacts, et l'arbre de travail est cohérent malgré la perte du scratchpad du fixeur. Le verdict reste pourtant **NON VALIDÉ**, à cause d'un nouveau constat de la même famille que S12-f, trouvé à la relecture des autres branches de `notes.service.ts`. **`deleteNote` met `deletedAt` sur toutes les tâches liées à la note sans aucun contrôle de politique.** Un auteur qui n'a plus `task.write` sur un projet (rétrogradé COMMENTER ou CLIENT, `ProjectMembership` retirée, ou désactivé par SCIM avec un compte qui reste actif) peut donc supprimer ses tâches de ce projet. Il lui suffit de supprimer sa note (**S12-j**, prouvé). Ce n'est pas une régression : le défaut existait avant la Phase 3. L'architecte aurait dû le relever dès r12, en même temps que S12-f. Le correctif tient en quelques lignes.

### Vérifications refaites par l'architecte

| Commande ou contrôle | Résultat |
| --- | --- |
| État reçu | `git stash list` vide ; 85 entrées dans `git status` ; empreinte de `git diff` (`e576a3a8…`), état et empreintes des 26 fichiers non suivis notés au début, **identiques à la fin** |
| Cohérence de l'arbre (scratchpad perdu) | Aucun reste de mutation dans `src` ni `scripts` (`projectChanged \|\| !projectChanged`, `true ?`, `OWNER: 'CONTRIBUTOR'`, `sameWorkspace = true`, `skipDuplicates: false` : absents). Les `where: {}` trouvés sont des préparations de tests SSO/SCIM légitimes, qui n'ont rien à voir avec les mutations. Aucun fichier `*.orig`, `*.bak`, `*.rej` ni `*~`. Les fichiers attendus sont tous présents (`notes-access.spec.ts`, spec du script, runbook) : les builds et `tsc` passent. |
| `cd backend && env -u DATABASE_URL npx jest` | **75/75 suites, 2221/2221 tests** (identique au journal) |
| `nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 122 `.js` ; 0 `*.spec.js` |
| `tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `eslint src tests scripts` ; `prettier --check` ; `prisma validate` | 0 erreur, 17 avertissements ; conforme ; valide |
| `jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| Frontend | `git status frontend` vide ; vitest 15 fichiers, 59/59 ; `tsc` 0 ; ESLint 0 erreur (36 avertissements) ; `vite build` OK |
| R1 : S12-i, tâche existante toujours résolue contre `project` | **2 échecs** (critères 1 et 2) ; restauré |
| R2 : S12-i, `deleteMany` inconditionnel avant `if (assigneeId)` | **2 échecs** ; restauré |
| R3 : S12-i, projet d'origine mais `workspaceId` du projet visé | **1 échec** (critère 2) ; restauré |
| R4 : branche de création résolue contre un autre projet | mutation invalide (erreur de compilation), écartée. La création résout contre `project`, qui est bien le projet de la tâche créée : correct à la lecture. |
| P4-1 : `--apply` ignoré | 1 échec ; restauré |
| P4-2 : `already.has` retiré | 2 échecs ; restauré |
| **P4-3 : `OWNER: 'CONTRIBUTOR'` dans le mapping** | **1 échec** (survivait en r14) ; restauré |
| **P4-4 : `where: {}` sur `membership.findMany`** | **4 échecs** (survivait en r14) ; restauré |
| P4-4b : `workspace.deletedAt` seul retiré | 4 échecs ; restauré |
| P4-4c : filtre `role` seul retiré | 1 échec ; restauré |
| **P4-5 : `deletedAt: null` retiré de `project.findMany`** | **4 échecs** (survivait en r14) ; restauré |
| P4-7 : créateur non exclu | 4 échecs ; restauré |
| P4-7b : `userId` perdu dans `scoped` (exclusion désactivée sans bruit) | 3 échecs ; restauré |
| P4-7c : `userId` retiré du `select` | erreur de compilation, donc suite en échec ; restauré |
| P4-9 : `timeout` retiré | 1 échec ; restauré |
| **Preuve S12-j** (test jetable, vrai `PolicyService`, fixture RBAC) | `USERS.commenter` (COMMENTER de P1) : `filterUsersWithProjectAction('P1', [commenter], 'task.write')` renvoie `[]`. Avec la note N9 liée à la tâche T9 de P1, `deleteNote(commenter, 'N9')` appelle `task.updateMany({ where: { noteId: 'N9' }, data: { deletedAt: … } })`. **Reproduit.** Fichier supprimé ; empreintes des fichiers non suivis identiques ensuite. |

### Revue du code

- **S12-i (`notes.service.ts:430-433`, `:503-523`, `:527`, `:552`)** : conforme. `resolveFor` est appelé après la décision de déplacement dans chacune des trois branches. Pour une tâche existante, la cible est `projectChanged ? project : { id: existingTask.projectId, workspaceId: existingTask.project?.workspaceId ?? null }`. La branche « tâche non écrivable » n'appelle rien. Si l'assigné est nul, il n'y a ni `findUnique`, ni `deleteMany`, ni `create`. Les tests contrôlent l'effet (aucun appel), le contrôle positif (critère 2) et la résolution contre le projet d'arrivée (critère 3).
- **Script P4** : conforme. Le faux Prisma évalue les `where` reçus et rejette tout opérateur inconnu. Le jeu de données contient chaque cas à exclure (OWNER, ADMIN, workspace supprimé, projet supprimé, projet personnel, créateur, rôle existant, compte désactivé). Les `toHaveBeenCalledWith` figent les filtres. La sûreté de `--apply`, l'idempotence et le CSV sans adresse sont inchangés depuis r14.
- **Autres branches de `notes.service.ts`** : `createNote`, `updateNote`, `getNotes` et `getNote` sont bornés à `userId` et ne touchent pas aux projets. `syncTaskStatusToNote` est gardé (S12-g). **`deleteNote` (`:162-190`, `tx.task.updateMany` à `:173`) n'est pas gardé** (S12-j ci-dessous). Seules les notes créent `task.noteId` (aucun autre écrivain dans `src`) : le problème se limite donc aux tâches de l'auteur.
- **Créateur MANAGER (question 2)** : confirmé dans les trois chemins de la politique. Ils sont tous conditionnés à une `Membership` active : `effectiveProjectRole` (`policy.service.ts:102`), `filterUsersWithProjectAction` (`:229`) et `listAccessibleProjectIds` (`:275`). Exclure le créateur du script ne fait perdre aucun accès.

### Statut des constats

| ID | Statut r15 | Commentaire |
| --- | --- | --- |
| S12-i | **VALIDÉ** | Les 5 critères sont tenus ; mutations R1 à R3 détectées. |
| P4 (script) | **VALIDÉ** | P4-3, P4-4 et P4-5 sont détectées ; créateur exclu (P4-7, P4-7b, P4-7c détectées) ; délai de transaction testé. Le script n'a jamais été exécuté. |
| Documentation (`permissions.ts:9-13`, runbook § 2 l. 39, § 4.2 l. 90) | **VALIDÉ** | Textes présents et exacts. |
| O7 | **Report accepté** (Amélioration, Phase 4 ou plus tard) | Voir la réponse 1. |
| **S12-j** | **Nouveau, ouvert, bloquant** | Voir ci-dessous. |
| A2 | Ouvert | Se ferme avec S12-j : c'est le dernier chemin d'écriture du module des notes qui passe hors `PolicyService`. |

### Nouveau constat r15

**S12-j — `deleteNote` supprime les tâches liées sans `task.write`** (Moyen ; CVSS 3.1 5.4, `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L` ; famille S12-f ; défaut antérieur à la Phase 3, pas une régression)

- **Où** : `backend/src/notes/notes.service.ts:162-190`. `tx.task.updateMany({ where: { noteId }, data: { deletedAt: new Date() } })` à la ligne 173.
- **Cause** : la suppression de la note propage `deletedAt` à toutes les tâches portant ce `noteId`, sans consulter la politique. Ailleurs, la suppression d'une tâche exige MANAGER ou CONTRIBUTOR (`tasks.service.ts:411-416`). L'analyse d'une note, elle, vérifie `task.write` avant de toucher une tâche existante (S12-f, `notes.service.ts:445-455`).
- **Vecteur** : `DELETE /notes/:id` par l'auteur de la note. Préconditions : avoir créé des tâches depuis une note dans un projet de workspace, puis avoir perdu `task.write` sur ce projet. C'est le cas d'un auteur rétrogradé COMMENTER ou CLIENT, d'une `ProjectMembership` retirée, ou d'une désactivation SCIM : SCIM ne retire que la `Membership` et ne suspend pas le compte (S1, `scim.service.ts:100-120`).
- **Impact** : une personne qui a perdu ses droits fait disparaître des tâches du projet, avec leur suivi, leurs commentaires, leurs dépendances et leurs assignations, alors que la matrice le lui interdit. Les données ne sont restaurables qu'en base. Pas de fuite de confidentialité.
- **Remédiation attendue** : dans `deleteNote`, ne propager `deletedAt` qu'aux tâches des projets où l'auteur a encore `task.write`. Calculer `writable = await this.policy.listAccessibleProjectIds(userId, { action: 'task.write' })`, ce qui inclut ses projets personnels, puis appeler `tx.task.updateMany({ where: { noteId, projectId: { in: writable } }, … })`. Les autres tâches restent intactes. La note est supprimée dans tous les cas, sans erreur ni oracle. Aucun changement d'API.
- **Critères d'acceptation** (dans `tests/unit/authz/notes-access.spec.ts`, avec le vrai `PolicyService` ; l'assertion doit porter sur l'effet, par exemple un faux `updateMany` qui évalue le `where` sur `prisma.data.tasks`, ou bien sur le `where` exact, et pas seulement sur « appelé ») :
  1. Un COMMENTER de P1 supprime sa note N9, liée à T9 (P1) et à T10 (son projet personnel) : T9 garde `deletedAt: null`, T10 est supprimée, la note est supprimée.
  2. Auteur désactivé par SCIM (`USERS.deprovisioned`, `ProjectMembership` CONTRIBUTOR sur P1 mais sans `Membership`) : sa tâche de P1 n'est pas supprimée.
  3. Contrôle positif : un CONTRIBUTOR de P1 supprime sa note, et sa tâche de P1 est supprimée.
  4. Échec du critère 1 sur le code actuel, consigné au journal.
  5. Mutation « `where: { noteId }` rétabli » : au moins un échec.
  6. Runbook § 4.2 : une ligne indiquant que supprimer une note ne supprime que les tâches des projets où l'auteur peut encore écrire.

### Constats non bloquants

- **O7** (Amélioration) : report accepté. Un projet personnel vide est créé lors d'un déplacement refusé. C'est cosmétique, sans risque d'accès, et l'éviter oblige à réordonner un code testé. À traiter avec A5, ou en Phase 4.
- **O8** (Amélioration, cohérence) : `deleteNote` n'émet aucun événement de synchronisation Firestore (`entityType: 'task'`, `delete`) pour les tâches qu'il supprime, alors que `deleteTask` le fait. Défaut antérieur, à traiter avec S12-j si c'est trivial, sinon en Phase 4. Non exigé pour la clôture.
- **P10** (décision produit, à poser en Phase 4) : le créateur reste MANAGER de son projet même si son rôle de workspace descend à VIEWER. C'est conforme à la matrice actuelle (« Le créateur d'un projet en est MANAGER ») et ce n'est pas une régression, mais l'utilisateur doit confirmer que c'est voulu.

### Réponses aux questions de fixeur (r14)

1. **Report d'O7 : accepté.** O7 reste ouvert en Amélioration, hors Phase 3.
2. **Créateur exclu du script : confirmé.** Il est MANAGER par `project.userId` dans les trois chemins de la politique, sous condition de `Membership` (lignes citées plus haut). Le rapport et la requête SQL du runbook § 2 donnent maintenant les mêmes décomptes.
3. **Hors périmètre : confirmé.** Q-2, le complément S17 (SCIM `DELETE`) et `ws`/S25 restent en Phases 4 à 6.
4. **A2 et S12-i** : S12-i est correct, mais A2 ne se ferme pas encore. `deleteNote` est le dernier chemin d'écriture du module des notes hors `PolicyService` (S12-j). A2 se ferme avec S12-j.

### Plan d'action r15 pour fixeur (ordre obligatoire)

Méthode inchangée : d'abord un test d'abus qui échoue, avec l'échec consigné ; puis le correctif minimal ; puis les suites complètes. Aucune base réelle, aucun commit, aucun `git stash` (sauvegarde `/bin/cp -f`, restauration, `cmp`). Script P4 jamais exécuté. Ne pas toucher au code validé en r15.

| # | ID | Action | Terminé quand |
| --- | --- | --- | --- |
| 1 | S12-j | Dans `deleteNote`, propagation de `deletedAt` limitée aux projets où l'auteur a `task.write`. | Les 6 critères S12-j sont tenus ; l'échec initial du critère 1 est consigné. |
| 2 | O8 (facultatif) | Événement Firestore `delete` pour chaque tâche supprimée par `deleteNote`, si c'est trivial. | Test vert, ou report motivé. |
| 3 | Clôture | Toutes les suites et tous les outils, comme en r14. | Backend : `jest` vert, `nest build` sans `*.spec.js`, `tsc` (build) 0, ESLint 0 erreur et 17 avertissements au plus, `prettier` et `prisma validate` OK, intégration 4/4 ; frontend inchangé ; `git stash list` vide ; « Résultats (r15) » exacts au journal. |

### Préparation du commit de Phase 3 (pour l'utilisateur, après validation seulement)

Cette liste est fournie dès maintenant pour éviter un aller-retour. Elle n'autorise **aucun** commit avant le verdict VALIDÉ, et c'est l'utilisateur qui décide. Elle reflète l'état reçu en r15 et devra être relue si S12-j ou O8 ajoutent des fichiers.

- **À inclure** : les 71 fichiers suivis modifiés ou supprimés de `git status` (`backend/package.json`, `backend/prisma/schema/{auth,system}.prisma`, `backend/src/**`, `backend/tests/**`, `docs/security/{journal-corrections,rapport-audit}.md`, `pnpm-lock.yaml`, et les suppressions de `backend/src/notifications/notifications.gateway{,.spec}.ts`). S'y ajoutent les 14 entrées non suivies, soit 26 fichiers :
  - `backend/prisma/migrations/20261111000000_s12_attachment_uploader/`
  - `backend/scripts/grant-legacy-project-access.ts`
  - `backend/src/authz/`
  - `backend/src/projects/dto/associate-tasks.dto.ts`
  - `backend/src/projects/dto/execute-ai-actions.dto.ts`
  - `backend/src/realtime/`
  - `backend/tests/http/global-auth.spec.ts`
  - `backend/tests/http/projects-realtime-routes.spec.ts`
  - `backend/tests/http/rbac-matrix.spec.ts`
  - `backend/tests/integration/`
  - `backend/tests/support/rbac-fixture.ts`
  - `backend/tests/unit/authz/`
  - `backend/tests/unit/scripts/grant-legacy-project-access.spec.ts`
  - `docs/security/runbook-phase3.md`
- **À exclure** (tous déjà ignorés, ne jamais forcer avec `git add -f`) : `.claude/` (`.git/info/exclude`), `.env`, `.env.production`, `backend/.env`, `frontend/.env`, `backend/dist/`, `frontend/dist/`, `backend/*.tsbuildinfo`, `backend/firestore-debug.log`, et tout CSV `backend/reprise-phase0/` (aucun aujourd'hui, le script n'a jamais tourné).
- **Commande** : `git add -A backend docs pnpm-lock.yaml`, puis contrôle de `git status`, qui ne doit lister aucun fichier ignoré ni rien sous `frontend/`. Éviter `git add .` à la racine.
- **Message proposé** :

```
fix(security): phase 3 du programme de remédiation (validée par l'architecte)

Autorisation par projet (S12) : matrice unique de permissions et PolicyService (A2),
règle stricte pour MEMBER/VIEWER sans ProjectMembership (P4), notes, IA, copilote,
pièces jointes, minuteur et temps réel alignés sur la politique (S12-a à S12-j, S16),
salon task:<id> évincé au déplacement ou au retrait de droits.
Script optionnel de reprise des accès (scripts/grant-legacy-project-access.ts,
mode rapport par défaut) et runbook docs/security/runbook-phase3.md.

```

**Constats ouverts à la fin de r15 :**

- Phase 3 : **S12-j** (bloquant) ; A2 (se ferme avec S12-j). O8 facultatif.
- Décisions produit : P4 tranchée (règle stricte, script optionnel). L'utilisateur seul décide d'exécuter ou non le script P4 (rapport d'abord, puis `--apply` après sauvegarde). P10 est à poser en Phase 4.
- Phase 1 : P9.
- Phases 4 à 6 : S17 (avec le complément SCIM `DELETE`) à S26, sauf les étapes 0 et 2 de S18 ; A5 à A9 ; P2, P5, P7, P8, P10 ; Q-2 ; O7.
- Clos : S1 à S11, S12-a à S12-i, S13 à S16, S27, S28, S29, A1, A2-b, A3, A4, O3 à O6, P1, P3, P6, Q-1, script P4.

## Revue r16 — Phase 3 : VALIDÉ (2026-11-04)

Revue des actions r15 (journal : « Actions de la revue r15 », « Résultats (r15) », « Points ouverts pour l'architecte (r15) »). L'architecte a relancé toutes les commandes et rejoué les mutations une par une : sauvegarde `/bin/cp -f` dans un dossier `mktemp -d` hors dépôt, une seule substitution dont l'unicité a été vérifiée, restauration et `cmp` (« restored » à chaque fois). Aucun `git stash`, aucune base réelle, script P4 jamais exécuté, aucun commit, `.claude/` non touché.

S12-j est corrigé comme demandé et tenu par des tests qui portent sur l'effet. A2 se ferme avec lui. La relecture finale de tous les chemins d'écriture des services de la Phase 3 ne montre aucun contournement de `PolicyService`. **La Phase 3 est validée côté code.** Le commit relève de l'utilisateur.

### Vérifications refaites par l'architecte

| Commande ou contrôle | Résultat |
| --- | --- |
| État reçu | `git stash list` vide ; 85 entrées ; empreinte de `git diff` `6ef3c74d…`. Statut et empreintes des 26 fichiers non suivis notés au début : **identiques après les mutations** |
| `cd backend && env -u DATABASE_URL npx jest` | **75/75 suites, 2224/2224 tests** (identique au journal) |
| `nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 122 `.js` ; 0 `*.spec.js` |
| `tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `eslint src tests scripts` ; `prettier --check` ; `prisma validate` | 0 erreur, 17 avertissements ; conforme ; valide |
| `jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| Frontend | `git status frontend` vide ; vitest 15 fichiers, 59/59 ; `tsc` 0 ; ESLint 0 erreur (36 avertissements) ; `vite build` OK |
| M1 : `where: { noteId }` rétabli (critère 5) | **2 échecs** (critères 1 et 2) ; restauré |
| M2 : `action: 'task.read'` au lieu de `task.write` | 1 échec (critère 1) ; restauré |
| M3 : `workspaceId: 'ws-1'` ajouté (projets personnels exclus) | 1 échec (critère 1 : T10 non supprimée) ; restauré |
| M4 : `tx.note.update` retiré | 2 échecs ; restauré |
| M5 : `projectId: { in: [] }` | 2 échecs (critères 1 et 3) ; restauré |
| Reste de mutation dans `src/notes` | aucun |

### Revue du code

- **S12-j (`notes.service.ts:162-196`)** : conforme. `writable` est calculé à la ligne 170 et `tx.task.updateMany({ where: { noteId, projectId: { in: writable } } })` est aux lignes 176-179. Sans `workspaceId`, `listAccessibleProjectIds` inclut les projets personnels, exclut les projets supprimés et exige une `Membership` pour chaque branche de workspace (`policy.service.ts`, `project.findMany`). `Task.projectId` est non nul (`task.prisma`), donc aucune tâche n'échappe au filtre. La note est supprimée dans tous les cas, sans erreur ni oracle. Remarque sans suite : `writable` est lu hors de la transaction, avec une fenêtre de concurrence négligeable (même schéma que dans `parseTasksFromContent`).
- **Tests S12-j** : vrai `PolicyService` et fixture RBAC. Le faux `updateMany` évalue `noteId` et `projectId.in` et rejette toute clé inconnue. Les assertions portent sur `deletedAt` des lignes : c'est un contrôle d'effet. Le contrôle positif (CONTRIBUTOR) écarte le correctif « ne rien supprimer » (M5).
- **Relecture finale des chemins d'écriture** (toutes les écritures Prisma des services modifiés ou ajoutés en Phase 3, classées par méthode) :
  - `notes.service.ts` : `createNote` et `updateNote` sont bornés à `userId`. `deleteNote` est gardé (S12-j). `syncTaskStatusToNote` est gardé (S12-g). Dans `parseTasksFromContent`, la cible est filtrée par `task.write`, la tâche existante est soumise à `filterUsersWithProjectAction(task.write)`, le déplacement reste dans le même workspace et l'assigné est résolu contre le projet effectif (S12-f, S12-h, S12-i). `project.create` crée un projet personnel de l'auteur.
  - Services de projets (`tasks`, `comments`, `dependencies`, `milestones`, `sprint`, `timeblocks`, `projects`, `project-permissions`, `resources`, `invitations`, `proactive-scheduler`), et `tracking.startTracking` : gardés par `PolicyService`, directement ou via `assertProjectRole`, `assertTaskAccess` ou `loadTask`, qui lui délèguent.
  - Écritures sans garde locale :
    - `integration.*` et `syncCalendarEvents` : OWNER/ADMIN au contrôleur, et `findOwned` borné au workspace ;
    - `createResourceLeave` et `deleteResourceLeave` : soi-même, ou OWNER/ADMIN d'un workspace commun ;
    - `stopActiveTracking` et notifications : bornés au propriétaire ;
    - `propagateScheduleUpdates` : appelé uniquement depuis `updateTask`, déjà gardé ;
    - `closeTaskFromWebhook` : webhook signé (Phases 0 et 1) ;
    - `aiCommandHistory` : historique propre à l'appelant ;
    - `updateAllUserBriefings` : tâche planifiée ;
    - SCIM et SSO : Phase 2, validés.

  **Aucun contournement de la politique ne subsiste.**

### Statut des constats

| ID | Statut r16 | Commentaire |
| --- | --- | --- |
| **S12-j** | **VALIDÉ** | 6 critères tenus ; M1 à M5 détectées. |
| **A2** | **VALIDÉ, fermé** | Dernier chemin d'écriture des notes désormais soumis à `PolicyService`. |
| O8 | **Report accepté** (Amélioration, Phase 4) | Helper `taskSyncPayload` partagé (tâches, sprints, notes), puis un événement `delete` par tâche réellement supprimée (`findMany` filtré par `writable` dans la transaction, avant `updateMany`). |
| O7 | Report accepté (r15) | Inchangé. |
| **O9** | **Nouveau, Amélioration (documentation), non bloquant** | Voir ci-dessous. |
| P10 | Décision produit, Phase 4 | Inchangé. |

### Nouveau constat r16

**O9 — Le DAT décrit encore la passerelle de notifications supprimée** (Amélioration, documentation, aucun risque d'exécution)

- **Où** : `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md`, ligne 81 (schéma : « Notifications Gateway ») et lignes 690 et 703 (lien vers `backend/src/notifications/notifications.gateway.ts`, exemple `notificationsGateway.server.to(...)`).
- **Cause** : la Phase 3 supprime `notifications.gateway.ts` au profit de `backend/src/realtime/` (salons `user:`, `project:` et `task:` gérés par la politique), sans mettre à jour cette section du DAT.
- **Remédiation attendue (Phase 4)** : décrire `RealtimeService` (salons, éviction `evictTaskRoom` et `refreshUserRooms`, contrôle `task.read` à l'abonnement) et retirer les références au fichier supprimé. Critère : `grep -n "notifications.gateway" docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` ne renvoie rien.

### Réponses aux questions de fixeur (r15)

1. **S12-j : VALIDÉ ; A2 : fermé.**
2. **Report d'O8 en Phase 4 : accepté**, avec la remédiation précisée ci-dessus.
3. **Hors périmètre : confirmé.** O7, O8, O9, P10, Q-2, le complément S17 et `ws`/S25 restent en Phases 4 à 6.

### Clôture : documentation de pilotage

Comme aux clôtures précédentes, l'architecte a mis à jour la section « État » de `GEMINI.md` et la ligne Phase 3 du DAT § 15.1 (« Validée côté code (revue r16) »).

### Commit de Phase 3 (décision de l'utilisateur ; aucun commit fait par l'architecte)

Liste revérifiée sur l'état reçu en r16. Aucun fichier nouveau depuis r15. S'y ajoutent `GEMINI.md` et `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md`, modifiés par l'architecte à la clôture.

- **À inclure, 73 fichiers suivis** :
  - les 69 fichiers modifiés de `git status` : `backend/package.json`, `backend/prisma/schema/{auth,system}.prisma`, `backend/src/**`, `backend/tests/**`, `docs/security/{journal-corrections,rapport-audit}.md`, `pnpm-lock.yaml` ;
  - les 2 suppressions `backend/src/notifications/notifications.gateway{,.spec}.ts` ;
  - `GEMINI.md` et `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md`.
- **À inclure, 14 entrées non suivies (26 fichiers)** :
  - `backend/prisma/migrations/20261111000000_s12_attachment_uploader/`
  - `backend/scripts/grant-legacy-project-access.ts`
  - `backend/src/authz/`
  - `backend/src/projects/dto/associate-tasks.dto.ts`
  - `backend/src/projects/dto/execute-ai-actions.dto.ts`
  - `backend/src/realtime/`
  - `backend/tests/http/global-auth.spec.ts`
  - `backend/tests/http/projects-realtime-routes.spec.ts`
  - `backend/tests/http/rbac-matrix.spec.ts`
  - `backend/tests/integration/`
  - `backend/tests/support/rbac-fixture.ts`
  - `backend/tests/unit/authz/`
  - `backend/tests/unit/scripts/grant-legacy-project-access.spec.ts`
  - `docs/security/runbook-phase3.md`
- **À exclure** (tous ignorés, vérifié par `git check-ignore -v` ; ne jamais forcer avec `git add -f`) :
  - `.claude/` (`.git/info/exclude`) ;
  - `.env`, `.env.production`, `backend/.env`, `frontend/.env` ;
  - `backend/dist/`, `frontend/dist/` ;
  - `backend/tsconfig.tsbuildinfo`, `backend/tsconfig.build.tsbuildinfo` ;
  - `backend/firestore-debug.log` ;
  - tout CSV `backend/reprise-phase0/` (le dossier n'existe pas : le script P4 n'a jamais tourné).

  Aucun fichier non suivi et non ignoré ne correspond à ces motifs. Rien sous `frontend/`.
- **Commande proposée** : `git add -A backend docs pnpm-lock.yaml GEMINI.md`, puis `git status`. Attendu : 99 fichiers indexés (73 suivis et 26 nouveaux), aucun sous `frontend/`, aucun fichier ignoré. Éviter `git add .` à la racine.
- **Après le commit, en exploitation (décision de l'utilisateur)** :
  1. appliquer la migration `20261111000000_s12_attachment_uploader` ;
  2. lire le runbook `docs/security/runbook-phase3.md` (règle stricte P4) ;
  3. exécuter éventuellement le script P4 : en mode rapport d'abord, puis `--apply` après une sauvegarde dont la restauration a été testée.
- **Message proposé** :

```
fix(security): phase 3 du programme de remédiation (validée par l'architecte)

Autorisation par projet (S12) : matrice unique de permissions et PolicyService (A1, A2),
règle stricte pour MEMBER/VIEWER sans ProjectMembership (P4), notes, IA, copilote,
pièces jointes, minuteur et temps réel alignés sur la politique (S12-a à S12-j,
S13 à S16) ; la suppression d'une note ne supprime que les tâches des projets où
l'auteur peut encore écrire ; salon task:<id> évincé au déplacement ou au retrait de
droits ; passerelle de notifications remplacée par RealtimeService.
Migration 20261111000000 (auteur des pièces jointes). Script optionnel de reprise
des accès (scripts/grant-legacy-project-access.ts, mode rapport par défaut, non
exécuté) et runbook docs/security/runbook-phase3.md.

Revues r11 à r16 de l'architecte : Phase 3 close côté code. Voir
docs/security/journal-corrections.md et docs/security/rapport-audit.md.

```

**Constats ouverts à la fin de r16 :**

- Phase 3 : **aucun**. Elle est close côté code.
- Décisions de l'utilisateur : commit de Phase 3 ; application de la migration `20261111000000` ; exécution éventuelle du script P4 ; P10, à poser en Phase 4.
- Phase 1 : P9.
- Phases 4 à 6 : S17 (avec le complément SCIM `DELETE`) à S26, sauf les étapes 0 et 2 de S18 ; A5 à A9 ; P2, P5, P7, P8, P10 ; Q-2 ; O7, O8, O9.
- Clos : S1 à S11, S12-a à S12-j, S13 à S16, S27, S28, S29, A1, A2, A2-b, A3, A4, O3 à O6, P1, P3, P6, Q-1, script P4.

---

## Revue r17 — Phase 4 : NON VALIDÉ (2026-11-04)

Revue des entrées Phase 4 du journal (plan, entrées par constat, « Résultats (Phase 4) », « Points ouverts pour l'architecte (Phase 4) »). L'architecte a relancé toutes les commandes et rejoué 29 mutations une par une : sauvegarde dans un dossier `mktemp -d` hors dépôt, une seule substitution dont l'unicité est vérifiée, tests ciblés, puis restauration et `cmp` (« restored » à chaque fois). Aucun `git stash`, aucune base réelle, aucun commit ; `.claude/` et `.github/workflows/ci.yml` non touchés.

Le travail est de bonne qualité. S17, S18.1 et S18.3 sont conformes et tenus par des tests qui détectent les mutations. **Un contournement de S18.2-bis subsiste** : le rattachement OAuth d'un calendrier (S18.2-ter, ci-dessous) donne, en impersonation, un canal de sortie durable vers un compte choisi par l'administrateur. S'y ajoute un complément court à S17 (S17-a : invitations en attente après un déprovisionnement SCIM). **La Phase 4 n'est pas validée.** Les corrections attendues sont petites (estimation : 0,5 j).

### Vérifications refaites par l'architecte

| Commande ou contrôle | Résultat |
| --- | --- |
| État reçu | `git stash list` vide ; 44 entrées ; empreinte de `git diff` `1de96caa…`. Empreintes des 10 fichiers non suivis notées au début : **identiques après les mutations** ; aucun reste de mutation dans `backend/src` |
| `cd backend && env -u DATABASE_URL npx jest` | **79/79 suites, 2313/2313 tests** (identique au journal) |
| `tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 125 `.js` ; 0 `*.spec.js` |
| `eslint src tests scripts` ; `prettier --check` ; `prisma validate` | 0 erreur, 17 avertissements ; conforme ; valide |
| `jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| `find src tests -name '*.js' -o -name '*.d.ts'` | vide |
| Frontend | vitest 15 fichiers, **61/61** ; `tsc` 0 ; ESLint 0 erreur (36 avertissements) ; `vite build` OK |
| O9 : `grep -n "notifications.gateway" docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` | aucune ligne (exit 1) |
| Écart de chiffres | `tests/unit/projects/invitations.service.spec.ts` compte **9** tests, et non 25 comme l'écrit l'entrée S17 du journal (sans effet sur le total, exact) |

### Mutations (cible : tests concernés)

| ID | Mutation | Résultat |
| --- | --- | --- |
| M1b | Comparaison de l'adresse neutralisée à l'acceptation | 1 échec ; restauré |
| M2 | `count !== 1` → `count < 0` (double acceptation) | 2 échecs ; restauré |
| M3 | Membership créée au rôle de l'invitation, et non `VIEWER`, pour une invitation de projet | **0 échec (survit)** ; restauré. Voir S17-a, point 3 |
| M4 | Refus de `OWNER` à la création retiré | 1 échec ; restauré |
| M5 | Contrôle « rôle invité ≤ rôle de l'invitant » à la création retiré | 0 échec : **mutation équivalente** (seuls OWNER et ADMIN invitent, et OWNER n'est jamais invitable : le contrôle ne peut rien refuser de plus). Défense en profondeur, acceptée sans test |
| M6 | Restrictions du lien anonyme retirées | 2 échecs ; restauré |
| M7 | Rétrogradation de projet par invitation permise | 1 échec ; restauré |
| M8 | Revérification de l'invitant à l'acceptation retirée | 1 échec ; restauré |
| M9, M10 | Plafond de 30 jours retiré (service, puis DTO) | 1 échec chacune ; restaurées |
| M11 | Cible hors workspace acceptée par `assignProjectRole` | 2 échecs ; restauré |
| M12b | `MANAGER` attribuable par un MANAGER | 1 échec ; restauré |
| M13 | Purge `projectMembership.deleteMany` du SCIM `DELETE` retirée | 2 échecs ; restauré |
| M14 | Contrôle MFA du garde retiré | 4 échecs ; restauré |
| M15 | Contrôle `@PlatformRoles` du garde retiré | 3 échecs ; restauré |
| M16 | `assertSuperAdmin` du service neutralisé | 2 échecs ; restauré |
| M17 | Modification de son propre rôle permise | 1 échec ; restauré |
| M18 | Impersonation d'un compte de plateforme permise | 3 échecs ; restauré |
| M19 | Révocation de la session de l'administrateur retirée | 1 échec ; restauré |
| M20 | Plafond des comptes de plateforme porté à 30 jours | 2 échecs ; restauré |
| M21 | Claim `act` retiré | 1 échec ; restauré |
| M22, M27 | `@ForbiddenInImpersonation()` retiré de `createApiKey`, puis de `assignProjectRole` | 2 échecs chacune ; restaurées |
| M23 | Motif d'impersonation de 1 caractère accepté | 1 échec ; restauré |
| M24 | O8 : événements `delete` sans le filtre `writable` | 2 échecs ; restauré |
| M25 | O7 : projet personnel créé sur un déplacement refusé | 1 échec ; restauré |
| M26 | `@IsUUID` retiré du DTO d'attribution | 1 échec ; restauré |

M1 et M12, dans leur forme `if (false)`, ne compilaient pas (0 test exécuté). Ils ont été remplacés par M1b et M12b, qui compilent.

### Revue du code

- **S17, invitations (`invitations.service.ts`)** : conforme aux 6 points de la remédiation.
  - L'adresse est comparée sans tenir compte de la casse avant toute écriture.
  - Le refus des lignes `OWNER` héritées et la revérification de l'invitant sont des ajouts plus restrictifs que le rapport, acceptés.
  - Acceptation atomique : `updateMany` sur `PENDING` et non expirée, contrôle de `count === 1`, tout dans la transaction.
  - Projet relu dans la transaction, avec `workspaceId` et `deletedAt: null`.
  - Rôle de projet jamais rétrogradé ; aucune membership de workspace existante modifiée (ni promue ni rétrogradée).
  - Le projet est borné au workspace à la création.
  - La comparaison repose sur `loggedUser.email`, qui vient du jeton. Aucune route ne change l'adresse d'un compte, et toutes les méthodes de connexion exigent une adresse vérifiée : connexion par mot de passe refusée sans `emailVerifiedAt`, GitHub, Firebase et SSO la posent. La liaison à l'adresse vaut donc preuve de possession. À revoir si un changement d'adresse est livré un jour.
  - Migration : additive, deux `UPDATE` bornés aux invitations `PENDING`. Correcte, runbook § 1 cohérent.
- **S17 (suite)** :
  - `assignProjectRole` : la cible doit avoir une `Membership` du workspace du projet, contrôlée avant l'écriture et le recalcul des salons ; projet personnel refusé ; `MANAGER` réservé à OWNER/ADMIN.
  - Le DTO est appliqué par le `ValidationPipe`. Les identifiants d'utilisateur sont des UUID v4 (`@default(uuid())`), à une exception près : le compte d'amorçage de développement `default-user-id` (`prisma.service.ts:93`, hors production). Il ne peut plus recevoir de rôle de projet par cette route, ce qui est sans conséquence.
  - SCIM `DELETE` : purge bornée à `project: { workspaceId }`, puis recalcul des salons ; `PATCH active=false` ne purge pas. Conforme.
- **S18.1** :
  - Garde : `Reflector.getAllAndOverride`, poignée puis classe, rôle relu en base.
  - Service : `assertSuperAdmin` relu en base (défense en profondeur), auto-modification interdite, cible de plateforme refusée.
  - La suppression du contrôle « dernier SUPER_ADMIN » est juste : un SUPER_ADMIN ne peut plus modifier que les autres, il en reste donc toujours au moins un.
- **S18.3** :
  - MFA exigée sur tout `/admin/*`. `completeLogin` impose le second facteur à toutes les méthodes sauf l'impersonation, SSO compris : `mfaEnabled` à vrai implique donc une connexion à deux facteurs, sauf pour une session ouverte avant l'activation (O11).
  - Plafond de 12 h appliqué au rafraîchissement, sur le rôle relu en base. Avec des jetons d'accès de 15 min, c'est suffisant.
  - Jeton d'impersonation : `act.sub` (RFC 8693), 15 min, sans secret de rafraîchissement remis (`session.service.ts:100-131`). `act` fait foi à la vérification.
  - Révocation de la session de l'administrateur après l'émission et le journal. Un échec d'émission ne révoque donc rien, et l'ordre est correct.
  - Motif et `impersonationSessionId` consignés dans `PlatformAuditLog`.
  - Frontend : seul le profil est conservé en `sessionStorage`, aucun jeton.
- **O8** : lecture des tâches supprimables dans la transaction, avant `updateMany`, avec le même filtre et `deletedAt: null`. Un événement par tâche, workspace `personal-<userId>` pour les projets personnels. Conforme. Remarque sans suite : `updateMany` réhorodate aussi les tâches déjà supprimées de la note, comportement antérieur et sans effet visible.
- **O7** : `ensureProject()` n'est appelé que pour une création ou pour une tâche d'un projet personnel. Conforme.
- **O9** : le § 13 du DAT décrit `RealtimeService` conformément au code (`evictTaskRoom`, `refreshUserRooms`, contrôle à `join-task`). Conforme.
- **P4 (`matrice-rbac.md`)** : fidèle à `permissions.ts` et au code de la Phase 4.

### Nouveaux constats r17

#### S18.2-ter : le rattachement OAuth d'un calendrier reste permis en impersonation (contournement de S18.2-bis)

- **Sévérité** : Mineur tant que `FEATURE_IMPERSONATION_ENABLED` est désactivé. **Bloque la clôture de S18** : Majeur dès l'ouverture du drapeau. CVSS 5.5 drapeau actif `AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:L/A:N`.
- **Où** : `backend/src/projects/projects.controller.ts:561-571` (`POST /projects/workspaces/:workspaceId/calendar/oauth/callback`, sans `@ForbiddenInImpersonation()`), et `calendar-sync.service.ts:570-597`. Ce dernier fait un `upsert` sur l'intégration `GOOGLE_CALENDAR`/`OUTLOOK` du workspace : il **remplace sans bruit** les jetons d'une intégration existante.
- **Scénario** :
  1. En impersonation d'un OWNER/ADMIN, l'administrateur obtient l'URL d'autorisation (`GET .../calendar/oauth/google/auth-url`, permis à tout membre) et autorise **son propre** compte Google.
  2. Il envoie le code au callback. Le workspace de la cible est alors lié à son agenda, avec un `refresh_token` durable.
  3. Chaque export (`POST .../integrations/:id/export`, lancé ensuite par la cible elle-même) pousse vers son agenda les titres et descriptions de tous les créneaux du workspace.

  C'est exactement la classe « flux sortant vers une destination choisie » de S18.2-bis, que `createIntegration` couvre déjà. Le test méta ne l'a pas vu, car il ne balaie que des motifs explicites.
- **Remédiation attendue** :
  1. `@ForbiddenInImpersonation()` sur `handleOAuthCallback`.
  2. Ajouter `[ProjectsController, 'handleOAuthCallback']` à la liste paramétrée de `tests/unit/auth/impersonation-routes.spec.ts`.
  3. Ajouter au balayage méta le motif `POST /^\/projects\/workspaces\/:workspaceId\/calendar\/oauth\/callback$/` et l'attendu correspondant.
- **Critère** : test qui échoue sans le décorateur (à consigner), puis vert. La mutation « décorateur retiré » doit faire échouer 2 tests, comme M22 et M27.

#### S17-a : un utilisateur déprovisionné par SCIM revient par une invitation en attente

- **Sévérité** : Mineur. CVSS 4.3 `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`.
- **Où** : `scim.service.ts`, `deleteUser` et l'application de `active=false`. La membership est retirée, mais les invitations `PENDING` du workspace adressées à l'adresse de l'utilisateur restent valides (jusqu'à 30 jours). `validateAndAcceptInvitation` ne regarde ni le SCIM ni l'historique.
- **Impact** : l'utilisateur, que l'IdP considère comme parti, accepte une invitation reçue avant son départ et retrouve une membership. Pour une invitation de projet, il retrouve aussi un rôle de projet, ce qui contourne l'intention du déprovisionnement (même famille que le complément S17).
- **Remédiation attendue** :
  1. Dans `deleteUser` **et** à la désactivation `active=false`, passer à `REVOKED` les invitations `PENDING` du workspace dont `email` est l'adresse (en minuscules) de l'utilisateur, avec l'événement Firestore `invitation` habituel.
  2. Tests : invitation en attente pour l'adresse, puis SCIM `DELETE` (et `active=false`) : invitation `REVOKED`, et l'acceptation échoue ; une invitation d'un autre workspace n'est pas touchée.
  3. Combler la mutation survivante M3 : une invitation de projet **héritée** (ligne `role: 'ADMIN'`, `projectId` non nul, `projectRole` nul, pas encore migrée) acceptée par un non-membre doit créer une membership `VIEWER` et une `ProjectMembership` `CLIENT`.
- **Critère** : tests qui échouent avant le correctif (à consigner) ; M3 détectée.

#### O10 : `state` OAuth du calendrier prévisible et non vérifié (Phase 5, avec S23)

- **Sévérité** : Amélioration, non exploitable aujourd'hui. Aucun écran du frontend n'appelle le callback, et la route exige une requête authentifiée en JSON, soumise à CORS et au contrôle d'origine (S29).
- **Où** : `calendar-sync.service.ts:512-528`. Le `state` vaut `workspaceId:provider`. Le callback ne le vérifie pas, et son corps est un type littéral (S23).
- **Remédiation (Phase 5)** :
  - `state` aléatoire signé, lié à l'utilisateur et au workspace, à usage unique (Redis, 10 min), vérifié au callback ;
  - DTO `@IsEnum` / `@IsString` ;
  - refuser de remplacer une intégration active d'un autre compte sans suppression explicite.

#### O11 : une session ouverte avant l'activation de la MFA reste valide

- **Sévérité** : Amélioration (Phase 5).
- **Constat** : `PlatformAdminGuard` lit `mfaEnabled`, et non la façon dont la session a été ouverte. Un compte de plateforme qui active sa MFA garde ses sessions antérieures, ouvertes sans second facteur, et elles passent le garde. Elles durent 12 h au plus, grâce au plafond de S18.3.
- **Remédiation (Phase 5)** : à `mfa/confirm`, révoquer les autres familles de sessions de l'utilisateur. Ou bien consigner `mfaAt` dans la session et l'exiger dans le garde.

#### P11 : un invité de projet voit l'annuaire du workspace (lié au point ouvert 1)

- **Constat** : `VIEWER` conserve `workspace.read` et `sprint.read`. Un invité externe, y compris le détenteur d'un lien anonyme, peut donc lire :
  - la liste de **tous** les membres du workspace avec leurs adresses e-mail (`projects.service.ts:103-112`, `getWorkspaceMembers`) ;
  - les sprints ;
  - le nom et le type des intégrations (URL masquées).

  Il ne voit aucun projet (règle stricte P4, vérifiée).
- **Risque** : fuite de données personnelles des collaborateurs vers un client ou un prestataire (RGPD). C'est l'intérêt même d'un rôle `GUEST`.
- **Décision demandée à l'utilisateur** : voir la question 1 ci-dessous. Ce point ne bloque pas S17, dont la remédiation admettait « `VIEWER` sans visibilité implicite des projets ».

### Statut des constats

| ID | Statut r17 | Commentaire |
| --- | --- | --- |
| **P4** (matrice écrite) | **VALIDÉ** | Fidèle au code. À compléter après les décisions 1, 3 et 4 ci-dessous. |
| **S17** (invitations) | **VALIDÉ** | 6 points de la remédiation tenus ; M1b, M2, M4, M6 à M10 détectées ; M5 équivalente. |
| **S17** (suite : `assignProjectRole`, SCIM `DELETE`) | **VALIDÉ** | M11 à M13 et M26 détectées. |
| **S17-a** | **Nouveau, Mineur, à corriger en Phase 4** | Voir ci-dessus (contient le test de M3). |
| **S18.1** | **VALIDÉ** | M15 à M18 détectées. |
| **S18.2-bis** | **À REPRENDRE** | Liste conforme au rapport, mais le callback OAuth du calendrier manque : S18.2-ter. |
| **S18.3** et révocation de la session administrateur | **VALIDÉ** | M14, M19 à M21 et M23 détectées. Attribution dans `AuditLog` reportée à A8 (voir le point 8 ci-dessous). |
| **O7** | **VALIDÉ** | M25 détectée. |
| **O8** | **VALIDÉ** | M24 détectée ; l'écart sur `sprint.service.ts` est accepté (point 9). |
| **O9** | **VALIDÉ** | Critère `grep` tenu ; § 13 conforme au code. |
| **O10, O11** | Nouveaux, Amélioration, Phase 5 | Non bloquants. |
| **P10, P11** | Décisions de l'utilisateur | Questions 1 et 4 ci-dessous. |
| S18 (global) | **Ouvert** | Se ferme avec S18.2-ter. `FEATURE_IMPERSONATION_ENABLED` reste désactivé. |

### Réponses aux points ouverts du fixeur (Phase 4)

1. **GUEST ou VIEWER : VIEWER accepté techniquement pour clore S17.** La question reste posée à l'utilisateur (voir P11). Recommandation de l'architecte : ne pas exposer l'annuaire à un invité externe. L'option la moins coûteuse, sans migration d'énumération, consiste à restreindre pour un `VIEWER` `getWorkspaceMembers` aux personnes des projets qu'il partage, et à retirer `sprint.read`. L'autre option est un rôle `GUEST` (migration d'énumération). À traiter en Phase 5 selon la réponse.
2. **Lien anonyme à usage unique, sans `maxUses` : VALIDÉ** (option explicitement admise par le rapport). Plafond retenu : projet obligatoire, rôle de projet ≤ CONTRIBUTOR, workspace `VIEWER`. Si l'utilisateur veut des liens réutilisables, il faudra `maxUses` (≤ 50 par exemple) et un compteur atomique (`updateMany` avec `uses < maxUses`) : nouvelle tâche, non due en Phase 4.
3. **MANAGER attribuable par un MANAGER : non, VALIDÉ.** Rétrograder ou retirer un autre MANAGER : question à l'utilisateur. Recommandation de l'architecte : réserver ces deux actions à OWNER/ADMIN, par symétrie avec l'attribution. Sinon, un MANAGER nommé par un administrateur peut évincer ses pairs. Coût : deux contrôles et deux tests. À faire en Phase 4 avec S17-a si l'utilisateur répond oui, sinon à consigner dans la matrice.
4. **P10 : question à l'utilisateur.** Recommandation de l'architecte : resserrer. Ne reconnaître le créateur MANAGER que si son rôle de workspace est au moins MEMBER. Rétrograder quelqu'un en VIEWER exprime l'intention de lui retirer l'écriture, et le maintien implicite de MANAGER la contredit sans bruit.
5. **`role` ignoré (forcé à VIEWER) pour une invitation de projet : VALIDÉ.** C'est le résultat le plus restrictif, et il est documenté dans le DTO et dans la matrice.
6. **MFA des comptes de plateforme : VALIDÉ.** Précondition de déploiement consignée au runbook § 3. Le compte d'amorçage de développement n'a pas de `platformRole` (`prisma.service.ts:99-104`). En revanche, l'administrateur du `seed.ts` est `SUPER_ADMIN` (`prisma/seed.ts:144`, `:151`) : il devra activer la MFA en développement pour accéder à `/admin/*`.
7. **Routes non décorées :**
   - `GET` et `DELETE` des invitations, révocation de clé SCIM, bascule, suppression et export d'une intégration : **laissées sans décorateur, accepté**. Elles ne créent aucun accès ni aucune destination nouvelle, et l'impersonation est tracée.
   - **Exception : le callback OAuth du calendrier**, qui en crée une (S18.2-ter, à corriger).
   - Facultatif, recommandé : `POST invitations/accept/:token`, pour qu'une impersonation n'inscrive pas la cible dans un workspace tiers.
8. **Attribution des actions sous impersonation reportée à A8 : acceptée, avec une condition.** La remédiation de S18 demandait que `logAction` enregistre l'acteur réel. Le `PlatformAuditLog`, avec le motif et `impersonationSessionId`, permet de reconstituer la fenêtre, mais pas l'action. Condition : **l'architecte recommande de ne pas ouvrir `FEATURE_IMPERSONATION_ENABLED` avant la livraison d'A8**. Si l'utilisateur l'ouvre avant, c'est un risque accepté, à consigner.
9. **`sprint.service.ts` non migré vers `taskSyncPayload` : accepté.** La charge partielle est volontaire, et la migrer changerait le contenu écrit dans Firestore.
10. **Ouverture de l'impersonation : non.** S18 n'est pas clos (S18.2-ter), et la condition du point 8 s'ajoute.
11. **Frontend (message 403 « autre adresse », boutons visibles pour un PLATFORM_ADMIN) : accepté, non bloquant.** Le serveur fait foi. Amélioration d'interface pour la Phase 5 : masquer le sélecteur de rôle et le bouton d'impersonation quand `platformRole !== 'SUPER_ADMIN'`, et afficher un message dédié au 403 d'acceptation.

### Questions pour l'utilisateur

1. **Invité de projet (P11)** : un invité externe doit-il voir la liste des membres du workspace (noms et adresses) et les sprints ? Recommandation : non.
2. **Liens anonymes** : faut-il des liens réutilisables (par exemple pour inviter toute une équipe client) ? Aujourd'hui, chaque lien sert une seule fois. Recommandation : garder l'usage unique.
3. **MANAGER contre MANAGER** : un MANAGER de projet (sans être administrateur du workspace) peut-il rétrograder ou retirer un autre MANAGER ? Recommandation : non, réservé à OWNER/ADMIN.
4. **P10** : un créateur de projet rétrogradé VIEWER du workspace doit-il rester MANAGER de son projet ? Recommandation : non.
5. **Impersonation** : accepter de l'ouvrir avant l'attribution des actions dans le journal d'audit (A8, Phase 6) ? Recommandation : non.

### Plan d'action r17 pour fixeur (ordre obligatoire)

1. **S18.2-ter** : décorateur sur `handleOAuthCallback`, liste paramétrée et balayage méta étendus (échec consigné avant le correctif).
2. **S17-a** : révocation des invitations `PENDING` de l'adresse au SCIM `DELETE` et à `active=false`, avec l'événement Firestore ; tests (échec consigné) ; test de la ligne d'invitation de projet héritée (mutation M3).
3. Si l'utilisateur répond « non » à la question 3 : rétrogradation et retrait d'un MANAGER réservés à OWNER/ADMIN (`assignProjectRole` quand la cible est MANAGER explicite, `removeProjectRole`), avec deux tests. Si la réponse n'est pas connue, ne rien changer et le consigner.
4. Journal : corriger le nombre de tests de `invitations.service.spec.ts` (9, et non 25).
5. Relancer toutes les suites (backend, intégration, frontend, builds, lint, prettier, `prisma validate`) et consigner les chiffres dans « Résultats (r17) ».
6. Hors périmètre de la reprise : O10, O11, P11 (Phase 5), A8 (Phase 6).

**Constats ouverts à la fin de r17 :**

- Phase 4 : **S18.2-ter, S17-a** (fixeur) ; question 3 (selon la réponse de l'utilisateur).
- Décisions de l'utilisateur : questions 1 à 5 ; commit de Phase 4 après validation ; application de la migration `20261112000000` (runbook Phase 4) ; activation de la MFA des comptes de plateforme avant le déploiement.
- Phase 1 : P9.
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8, P11 ; Q-2 ; O10, O11.
- Clos en r17 : P4, S17 (invitations et suite), S18.1, S18.3, O7, O8, O9.
- Clos auparavant : S1 à S11, S12-a à S12-j, S13 à S16, S27, S28, S29, A1, A2, A2-b, A3, A4, O3 à O6, P1, P3, P6, Q-1, script P4.

---

## Revue r18 — Phase 4 : NON VALIDÉ, corrections ciblées restantes (2026-11-04)

Revue des « Actions de la revue r17 » et des « Résultats (r17) » du journal. Toutes les commandes ont été relancées au premier plan. 11 mutations ont été rejouées selon le protocole habituel : sauvegarde dans un dossier `mktemp -d` hors dépôt, une seule substitution dont l'unicité est vérifiée, restauration et `cmp`. Aucun `git stash`, aucune base, aucun commit ; `.claude/`, `ci.yml` et `eslint.config.cjs` non touchés.

**S18.2-ter et S17-a sont VALIDÉS.** L'utilisateur a délégué les cinq décisions produit à l'architecte (voir ci-dessous). Trois d'entre elles demandent un correctif, que l'architecte garde en Phase 4. **La Phase 4 sera validée après ces trois corrections** (P11, P12, P10).

### Vérifications refaites par l'architecte

| Commande ou contrôle | Résultat |
| --- | --- |
| État reçu | `git stash list` vide ; 49 entrées ; empreinte de `git diff` `91e83832…` ; 11 fichiers non suivis. **Identiques après les mutations** |
| `cd backend && env -u DATABASE_URL npx jest` | **79/79 suites, 2321/2321 tests** (identique au journal) |
| `jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| `tsc` (build) ; `tsc -p tsconfig.json` | exit 0 ; 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `nest build` ; `*.spec.js` dans `dist` ; `*.js`/`*.d.ts` dans `src`/`tests` | exit 0 ; 0 ; 0 |
| `eslint src tests scripts` ; `prettier --check` ; `prisma validate` | 0 erreur, 17 avertissements ; conforme ; valide |
| Frontend `vitest` | 15 fichiers, 61/61 (aucun changement frontend depuis r17) |
| Détail des +8 tests | 63 dans `impersonation-routes` (+3), 21 dans `scim.service` (+4), 19 dans `invitations-security` (+1) : exact |

### Mutations

| ID | Mutation | Résultat |
| --- | --- | --- |
| N1 | `@ForbiddenInImpersonation()` retiré de `handleOAuthCallback` | 2 échecs (cas paramétré et balayage) ; restauré |
| N2 | Appel de révocation retiré de `deleteUser` | 1 échec ; restauré |
| N3 | Appel de révocation neutralisé dans `patchUser` (`active=false`) | 1 échec ; restauré |
| N4 | Filtre `status: PENDING` retiré du `findMany` | 2 échecs ; restauré |
| N5 | Adresse non mise en minuscules | 2 échecs ; restauré |
| N6 | Filtre `workspaceId` retiré (révocation inter-organisations) | 2 échecs ; restauré |
| N7 | `REVOKED` remplacé par `EXPIRED` | 2 échecs ; restauré |
| N8 | Événement Firestore jamais émis | 2 échecs ; restauré |
| N9 | Révocation sur tout `PATCH` qui ne vaut pas `active=true` | 1 échec ; restauré |
| N10 | `updateMany` sans condition `PENDING` | 2 échecs ; restauré |
| M3 | Membership d'une invitation de projet héritée au rôle de la ligne | **1 échec** (survivait en r17) ; restauré |

### Revue du code

- **S18.2-ter** (`projects.controller.ts:561-562`) : décorateur posé. Le cas est dans la liste paramétrée, et le motif `POST` exact est dans le balayage méta. Conforme.
- **S17-a** (`scim.service.ts:106-131`, appels aux lignes 397-399 et 421) :
  - filtre `workspaceId`, `PENDING` et adresse en minuscules ;
  - `updateMany` conditionnel dans une transaction, avec `count` contrôlé ;
  - événement Firestore `invitation` émis seulement si la ligne a bien changé ;
  - appelé par `DELETE` et par `active=false` uniquement.

  Les invitations créées depuis la Phase 4 sont stockées en minuscules. Les lignes plus anciennes à casse mixte sont couvertes par la collation insensible à la casse de MySQL. L'extraction `invitation-sync-payload.ts` reproduit exactement l'ancienne méthode privée : le format Firestore est inchangé. Conforme.
- **Correction du journal** (9 tests) : faite.

### Limite signalée par le fixeur : lien anonyme accepté par un utilisateur déjà déprovisionné

**Analyse.** Un lien anonyme est un jeton au porteur. Aucune adresse ne le rattache à une personne, donc le déprovisionnement ne peut pas le cibler. Le risque résiduel est borné :
- usage unique ;
- un seul projet ;
- rôle ≤ CONTRIBUTOR, et `VIEWER` sur le workspace ;
- 30 jours au plus ;
- **les liens créés par un administrateur déprovisionné meurent avec lui** : l'invitant est revérifié à l'acceptation (test « invitant déprovisionné », mutation M8 détectée en r17).

Il reste le cas d'un lien créé par un autre administrateur et connu de la personne partie. N'importe quel tiers à qui ce lien aurait été transmis pourrait l'utiliser de la même façon. C'est la nature même du lien anonyme, que la décision 2 maintient.

**Verdict : limite acceptée pour la Phase 4**, consignée comme **O12** (Amélioration, Phase 5) :
- Dans un workspace dont le SCIM est actif (au moins une clé SCIM non révoquée), l'IdP est la source de vérité. Refuser alors la **création** de liens anonymes : 400, l'invitation nominative reste possible. Les liens anonymes existants de ces workspaces sont révoqués par migration ou par un script en mode rapport.
- Runbook : au déprovisionnement d'une personne, revoir les liens anonymes en attente (`GET /projects/workspaces/:id/invitations`).
- Tests : création d'un lien anonyme avec une clé SCIM active : 400 ; sans clé SCIM : 201.

### Décisions de l'utilisateur du 2026-11-04 (déléguées à l'architecte)

L'utilisateur a répondu « conrado peut répondre ». Les recommandations de la r17 deviennent donc les décisions suivantes :

| N° | Question | Décision | Traitement |
| --- | --- | --- | --- |
| 1 | Un invité externe de projet voit-il l'annuaire (noms, e-mails) et les sprints ? | **Non.** | **P11**, Phase 4 (ci-dessous) |
| 2 | Liens anonymes réutilisables (`maxUses`) ? | **Non** : usage unique, sans `maxUses`. | Aucun changement (déjà en place) |
| 3 | Un MANAGER non OWNER/ADMIN peut-il rétrograder ou retirer un autre MANAGER ? | **Non.** | **P12**, Phase 4 (ci-dessous) |
| 4 | P10 : un créateur rétrogradé VIEWER reste-t-il MANAGER ? | **Non.** | **P10**, Phase 4 (ci-dessous) |
| 5 | Impersonation ouverte avant A8 ? | **Non** : `FEATURE_IMPERSONATION_ENABLED` reste désactivé jusqu'à la livraison d'A8 (Phase 6). | Aucun changement de code ; condition consignée |

**Pourquoi tout garder en Phase 4.** Ces trois points précisent le modèle d'invitation et de rôles livré en Phase 4. Sans P11, chaque lien anonyme livré en Phase 4 ouvre l'annuaire du workspace à son porteur. P12 et P10 tiennent en quelques lignes dans les fichiers déjà modifiés. Ensemble, ils représentent environ 1 j.

### Plan d'action r18 pour fixeur (ordre obligatoire)

Méthode inchangée : test d'abus qui échoue d'abord (échec consigné), correctif minimal, suites complètes. Mettre à jour `docs/security/matrice-rbac.md`, en remplaçant les mentions « par défaut, à confirmer » par « décision de l'utilisateur du 2026-11-04 », ainsi que le commentaire d'en-tête de `authz/permissions.ts`.

#### P11 — VIEWER sans annuaire ni sprints (Phase 4)

**Choix de l'architecte : restreindre `VIEWER`, sans créer `GUEST`.**
- Avec la règle stricte de P4, un VIEWER sans `ProjectMembership` ne voit déjà aucun projet : c'est fonctionnellement un invité.
- Un rôle `GUEST` demanderait une migration d'énumération. Il demanderait aussi une reprise ambiguë des VIEWER existants, qu'on ne sait pas distinguer des invités, et un rôle de plus dans toute la matrice.
- Contrepartie acceptée : un VIEWER interne perd lui aussi l'annuaire complet et les sprints. Un collaborateur interne doit être MEMBER.

Correctifs attendus :
1. **Matrice** (`permissions.ts`) :
   - `sprint.read` passe à `CONTRIBUTE_WORKSPACE` (OWNER, ADMIN, MEMBER) ;
   - nouvelle action `workspace.directory.read` = `CONTRIBUTE_WORKSPACE` ;
   - `workspace.read` reste ouvert à VIEWER (appartenance, nom du workspace).
2. **Annuaire filtré** : nouvelle méthode `PolicyService.listVisibleWorkspaceMemberIds(workspaceId, userId)`.
   - Avec `workspace.directory.read` : tous les membres.
   - Pour un VIEWER : lui-même, plus les personnes qui ont `project.read` sur au moins un projet qu'il peut lire. Calcul : `listAccessibleProjectIds`, puis `filterUsersWithProjectAction` par projet, ou une requête équivalente. OWNER/ADMIN en font partie, puisqu'ils sont MANAGER implicites.
   - Appliquée à trois endroits :
     - `ProjectsService.getWorkspaceMembers` (`projects.service.ts:103`) ;
     - `ProjectsService.getWorkspaces` (`projects.service.ts:84-99`, `include.memberships`, filtré par workspace selon le rôle de l'appelant dans chacun) ;
     - `ResourcesService.getResourceCapacityReport` (`resources.service.ts:67`) : 403 pour un VIEWER (`workspace.directory.read`), car le rapport expose la charge, les absences et les adresses de tous les membres.
3. **Intégrations** : `GET workspaces/:id/integrations` et `GET .../integrations/status` (`projects.controller.ts:458-468`) exigent `workspace.directory.read`, donc 403 pour un VIEWER. C'est de la configuration interne, qui n'a pas à être visible d'un invité.
4. **Frontend** : pour un VIEWER, ne pas appeler les routes de sprints, de capacité ni d'intégrations, et masquer les onglets correspondants. Aucune bannière d'erreur ne doit apparaître (test vitest d'un rendu VIEWER).
5. **Tests (critères)** :
   - Un VIEWER invité sur le projet P1 (`CLIENT`) d'un workspace avec 5 membres, dont M2 qui n'a accès qu'à P2 :
     - `GET /projects/workspaces/:id/members` ne renvoie que lui-même, les OWNER/ADMIN et les membres de P1 (ni M2 ni son adresse) ;
     - le même filtrage s'applique dans `GET /projects/workspaces` ;
     - `GET .../sprints`, la vélocité et le détail d'un sprint renvoient 403 ;
     - le rapport de capacité et `GET .../integrations` renvoient 403.
   - Contrôle positif : un MEMBER voit les 5 membres et les sprints.
   - La matrice HTTP (`rbac-matrix.spec.ts`) se met à jour avec la nouvelle matrice, et tous ses cas restent verts.
   - Mutation attendue : retirer le filtre VIEWER de `getWorkspaceMembers` fait échouer au moins un test.

#### P12 — Un MANAGER ne rétrograde ni ne retire un autre MANAGER (Phase 4)

1. `ProjectPermissionsService.assignProjectRole` et `removeProjectRole` : si l'acteur n'est pas OWNER/ADMIN du workspace et que le rôle **effectif** de la cible sur le projet est MANAGER, répondre 403 sans rien écrire. Le rôle effectif est celui de la politique : `ProjectMembership` MANAGER, créateur, ou OWNER/ADMIN.
2. Exception : l'acteur est la cible (se rétrograder ou quitter le projet). C'est permis, sauf s'il est le créateur, dont le rôle ne dépend pas de la `ProjectMembership`.
3. **Tests (critères)** :
   - MANAGER A (MEMBER du workspace) rétrograde MANAGER B en CONTRIBUTOR : 403, rôle de B inchangé ;
   - A retire B : 403, ligne conservée ;
   - un ADMIN rétrograde ou retire B : 200 ;
   - A se retire lui-même : 200 ;
   - A rétrograde un CONTRIBUTOR : 200 (contrôle positif).
   - Mutation attendue : retirer le contrôle dans `removeProjectRole` fait échouer au moins un test.

#### P10 — Créateur MANAGER seulement s'il est au moins MEMBER (Phase 4)

1. La règle « créateur = MANAGER » ne vaut, pour un projet de workspace, que si le rôle de workspace du créateur est OWNER, ADMIN ou MEMBER. Un créateur VIEWER retombe sur sa `ProjectMembership` éventuelle, ou n'a aucun accès. Les projets personnels sont inchangés.
2. Endroits à modifier ensemble (même règle partout, sinon la lecture et la liste divergent) :
   - `policy.service.ts:102` (`effectiveProjectRole`) ;
   - `policy.service.ts:229` (`filterUsersWithProjectAction`) ;
   - `policy.service.ts:275` (`listAccessibleProjectIds`, branche `{ userId, workspaceId: { in: memberWorkspaceIds } }` : limiter aux workspaces où le rôle n'est pas VIEWER).

   Consigner dans le journal le résultat de `grep -rn "project.userId\|userId === " backend/src/authz backend/src/realtime backend/src/projects`, et justifier chaque occurrence restante.
3. Il n'existe aujourd'hui aucune route qui change un rôle de workspace : le cas vient de la base, d'une reprise ou d'un futur flux. Aucun recalcul de salons n'est donc à ajouter. À prévoir dans tout futur flux de changement de rôle (consigner dans la matrice).
4. **Tests (critères)**, avec le vrai `PolicyService` et la fixture RBAC :
   - Créateur C de P1, `Membership` VIEWER, sans `ProjectMembership` :
     - `assertProject(P1, C, 'project.read')` : 403 ;
     - P1 absent de `listAccessibleProjectIds(C)` ;
     - C absent de `filterUsersWithProjectAction(P1, [C], 'task.read')`.
   - Le même créateur avec une `ProjectMembership` CLIENT : lecture permise, écriture refusée.
   - Créateur MEMBER : toujours MANAGER (contrôle positif).
   - Mutation attendue : rétablir la règle dans une seule des trois méthodes fait échouer au moins un test.

#### Ensuite

- Relancer toutes les suites (backend, intégration, frontend, builds, lint, prettier, `prisma validate`) et consigner « Résultats (r18) ».
- Hors périmètre : O10, O11, O12 (Phase 5) ; A8 (Phase 6).

### Statut des constats

| ID | Statut r18 |
| --- | --- |
| **S18.2-ter** | **VALIDÉ** (N1 détectée). **S18.2-bis : VALIDÉ, fermé avec lui.** **S18 : clos côté code.** L'impersonation reste désactivée jusqu'à A8 (décision 5). |
| **S17-a** | **VALIDÉ** (N2 à N10 et M3 détectées) |
| **P11** | **Décision prise (1)**, correctif dû en Phase 4 |
| **P12** (nouvel identifiant pour la décision 3) | **Décision prise (3)**, correctif dû en Phase 4 |
| **P10** | **Décision prise (4)**, correctif dû en Phase 4 |
| Décision 2 | Close, aucun changement |
| **O12** | Nouveau, Amélioration, Phase 5 (limite des liens anonymes après un déprovisionnement) |
| O10, O11 | Inchangés, Phase 5 |

**Constats ouverts à la fin de r18 :**

- Phase 4 (fixeur) : **P11, P12, P10**. La validation de la Phase 4 et sa clôture (`GEMINI.md`, DAT § 15.1, liste de commit) attendent ces trois corrections.
- Décisions de l'utilisateur : commit de Phase 4 après validation ; migration `20261112000000` (runbook Phase 4) ; MFA des comptes de plateforme avant le déploiement.
- Phase 1 : P9.
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10, O11, O12.
- Clos en r17 et r18 : P4, S17, S17-a, S18 (1, 2-bis, 2-ter, 3), O7, O8, O9.

## Revue r19 — Phase 4 : NON VALIDÉ, compléments ciblés sur P11 (2026-11-04)

Revue des « Actions de la revue r18 », des « Résultats (r18) » et des « Points ouverts pour l'architecte (r18) » du journal. Les commandes ont été relancées au premier plan. 13 mutations backend et 1 mutation frontend ont été rejouées selon le protocole habituel : sauvegarde dans un dossier `mktemp -d` hors dépôt, une seule substitution dont l'unicité est vérifiée, restauration et `cmp`. Aucun `git stash`, aucune base, aucun commit ; `.claude/` non touché.

**P12 et P10 sont VALIDÉS. P11 est À REPRENDRE** pour trois compléments de faible coût (environ une demi-journée) : un nouveau constat **P11-a** (absences d'un membre lisibles par un VIEWER), un test manquant (mutation R3 survivante) et un test frontend de l'appel à la capacité (mutation F1 survivante). **La Phase 4 sera validée après ces trois compléments.**

### Vérifications refaites par l'architecte

| Commande ou contrôle | Résultat |
| --- | --- |
| État reçu | `git stash list` vide ; 60 entrées ; empreinte de `git diff` `4a7b43eb…`. **Identiques après les mutations** |
| `cd backend && env -u DATABASE_URL npx jest` | **81/81 suites, 2355/2355 tests** (identique au journal) |
| `jest tests/integration --detectOpenHandles` | 4/4 |
| `tsc --noEmit -p tsconfig.build.json` ; `eslint src tests scripts` ; `prettier --check` | exit 0 ; 0 erreur, 17 avertissements ; conforme |
| Frontend `vitest` ; `tsc --noEmit -p .` | 15 fichiers, 63/63 ; exit 0 |

### Mutations (cible : `tests/unit/authz`, `tests/unit/projects`, `tests/http/rbac-matrix.spec.ts`, 1725 tests)

| ID | Mutation | Résultat |
| --- | --- | --- |
| R1b | Annuaire : `workspace.directory.read` remplacé par `workspace.read` dans `listVisibleWorkspaceMemberIds` (tout le monde voit tout) | 4 échecs ; restauré |
| R2 | Titulaires de `ProjectMembership` non ajoutés à l'annuaire du VIEWER | 3 échecs ; restauré |
| **R3** | Annuaire du VIEWER : créateur ajouté s'il est simplement membre (règle P10 retirée de `listVisibleWorkspaceMemberIds`) | **0 échec : survit** ; restauré |
| R4 | `sprint.read` rouvert à VIEWER | 3 échecs (dans `viewer-directory.spec.ts` seul) ; restauré |
| R5 | `GET .../integrations/status` : `workspace.read` au lieu de `workspace.directory.read` | 2 échecs ; restauré |
| Q1 | P12 : un acteur MEMBER traité comme OWNER/ADMIN | 3 échecs ; restauré |
| Q2 | P12 : exception du créateur retirée (toute auto-modification permise) | 1 échec ; restauré |
| Q3 | P12 : condition « l'acteur est la cible » retirée | 2 échecs ; restauré |
| Q4 | P12 : le créateur cible n'est plus protégé | 1 échec ; restauré |
| C1 | P10 : `creatorIsManager` vrai pour tout rôle (trois méthodes à la fois) | 4 échecs ; restauré |
| C2 | P10 : branche créateur de `listAccessibleProjectIds` ouverte à tous les workspaces | 2 échecs ; restauré |
| **F1** | Frontend : `AppContext` appelle `resources/capacity` même pour un VIEWER | **0 échec sur 63 : survit** ; restauré |

(R1, première version `caller || …`, ne compilait pas : écartée et remplacée par R1b.)

### Revue du code

- **P11** (`permissions.ts:27-31`, `policy.service.ts:80-121`, `projects.service.ts:84-128`, `resources.service.ts:67-75`, `projects.controller.ts:458-468`) : conforme au plan. `listVisibleWorkspaceMemberIds` borne bien le résultat aux titulaires d'une `Membership` ; `getWorkspaces` filtre par workspace selon le rôle de l'appelant ; `teams` n'expose aucun membre. Les autres consommateurs de `membership.findMany` (mentions, IA, notes, alertes prédictives) sont soit filtrés par les droits de projet, soit fermés au VIEWER (`ai.use`) : pas de fuite. **Reste le chemin des absences, voir P11-a.**
- **Frontend** : masquage par `currentUserRole` (premier workspace) dans `App.tsx`, par `getWorkspaceRole(activeWorkspaceId)` dans `GovernanceView.tsx`. Remarque non bloquante : le backend prend comme workspace par défaut la plus ancienne `Membership`, le frontend le plus ancien `Workspace`. Les deux peuvent diverger (utilisateur OWNER de son espace, invité VIEWER dans un espace plus ancien) : l'écran Ressources serait alors masqué à tort. C'est sans effet de sécurité, puisque le backend décide. À aligner en Phase 5 si le cas se présente (ajouté à O14 ci-dessous).
- **P12** (`project-permissions.service.ts:29-52`) : contrôle avant toute écriture, rôle **effectif** de la cible (créateur MEMBER et OWNER/ADMIN protégés), auto-rétrogradation permise sauf au créateur. Une promotion de soi en MANAGER reste impossible (`role === 'MANAGER'` exige OWNER/ADMIN). Conforme.
- **P10** (`policy.service.ts:131-156, 246-286, 292-340`) : même helper aux trois endroits ; projets personnels inchangés. Le `grep` demandé est consigné et chaque occurrence est justifiée ; vérifié. Conforme.
- **Documentation** : `matrice-rbac.md` (décisions, § 2, consigne pour un futur changement de rôle) et `runbook-phase4.md` § 5 : conformes. Suggestion pour le § 5 : ajouter à la première requête le nombre de `ProjectMembership` du VIEWER, pour distinguer d'un coup d'œil un invité de projet d'un collaborateur interne à promouvoir.

### Nouveau constat r19

#### P11-a : les absences d'un membre restent lisibles par un VIEWER (contournement partiel de P11)

- **Fichier** : `backend/src/projects/resources.service.ts:438-455` (`getResourceLeaves`), route `GET /projects/resources/:userId/leaves` (`projects.controller.ts:184-187`) ; la matrice HTTP l'attend au niveau `ANY` (`tests/http/rbac-matrix.spec.ts:154`).
- **Cause** : pour lire les absences d'un autre utilisateur, il suffit de partager un workspace avec lui, **quel que soit le rôle**.
- **Impact** : P11 ferme le rapport de capacité à un VIEWER parce qu'il expose les absences. Pourtant, un invité externe (`client`) lit toujours les absences datées, avec leur motif, de toute personne dont il connaît l'identifiant : OWNER/ADMIN et membres de son projet, que l'annuaire filtré lui donne précisément. Les absences sont des données personnelles (RGPD), et leur motif peut toucher à la santé. Les identifiants étant des UUID, la fuite reste bornée aux personnes que l'invité voit déjà.
- **Sévérité** : Mineur. CVSS 3.1 : 3.1 (AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N).
- **Remédiation attendue** :
  - si `actingUserId !== userId`, exiger un workspace commun où l'acteur a `workspace.directory.read` (OWNER, ADMIN, MEMBER) ; sinon 403. Passer par `PolicyService` (ou `WORKSPACE_PERMISSIONS['workspace.directory.read']`), sans liste de rôles en dur ;
  - la lecture de ses propres absences reste permise à tout le monde.
- **Critères d'acceptation** :
  - `client` (VIEWER) lit les absences de `owner` : 403, et aucune lecture de `resourceLeave` ;
  - `viewer` lit ses propres absences : 200 ;
  - `member` lit les absences de `owner` : 200 (contrôle positif) ;
  - un utilisateur d'un autre workspace : 403 (inchangé) ;
  - la matrice HTTP passe `GET /projects/resources/:userId/leaves` (cible : un autre utilisateur) au niveau « contribute », et tous ses cas restent verts ;
  - mutation : remettre un workspace commun quel que soit le rôle doit faire échouer au moins un test.

### Réponses aux points ouverts du fixeur (r18)

1. **Test d'`App.tsx` pour un VIEWER : écart accepté pour le rendu d'`App`, mais pas pour l'appel réseau.** Le masquage des onglets n'est qu'un confort, puisque le backend répond 403. Simuler une quinzaine de composants pour le prouver coûterait plus que le risque. En revanche, le critère « aucune bannière d'erreur » du plan r18 dépend de l'appel à `resources/capacity` dans `AppContext`, que rien ne protège (F1 survit). Le harnais `AppContext.session.spec.tsx` (fetch simulé, `AppProvider` réel) permet ce test à faible coût : **exigé** (voir le plan ci-dessous).
2. **O13 : accepté en Phase 5, Mineur**, avec une remédiation élargie. Le chemin est antérieur à la Phase 4 et le champ `githubRepo` n'est ni rendu en lien ni utilisé côté serveur : l'impact est faible. CVSS 3.1 : 2.7 (AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N). Remédiation attendue :
   - `assertProject(projectId, userId, 'project.manage')` dans `AuthService.syncRepositoryToProject` (`auth.service.ts:510-526`), ce qui applique aussi `deletedAt: null` et la règle P10 ;
   - un DTO validé pour `POST /auth/github/sync` (`projectId` UUID ; `repoFullName` conforme à `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`), car le corps n'est aujourd'hui validé par aucun DTO ;
   - tests : créateur VIEWER sans `ProjectMembership` : 403 ; créateur déprovisionné : 403 ; MANAGER non créateur : 200 ; `repoFullName` invalide : 400.

   `ResourcesService.createResourceAllocation` : d'accord, sans effet (OWNER/ADMIN obligatoire ensuite).
3. **Promotion des VIEWER internes en MEMBER : accepté comme prérequis de déploiement.** C'est une décision de l'utilisateur, ajoutée à la liste « Décisions de l'utilisateur » ci-dessous. Elle ne bloque pas la validation du code.

### Plan d'action r19 pour fixeur (ordre obligatoire)

Méthode inchangée : test qui échoue d'abord (échec consigné), correctif minimal, suites complètes, « Résultats (r19) » dans le journal.

1. **P11-a** : correctif et tests selon les critères ci-dessus.
2. **Test de l'annuaire pour un créateur (R3)**, dans `viewer-directory.spec.ts`. Ajouter à la fixture un projet PC du workspace W, sur lequel `client` a `CLIENT` :
   - créé par un MEMBER C1 sans `ProjectMembership` : C1 figure dans `listVisibleWorkspaceMemberIds(W, client)` ;
   - créé par un VIEWER C2 sans `ProjectMembership` : C2 n'y figure pas.

   La mutation R3 (`memberRole.has(project.userId)` au lieu de `this.creatorIsManager(...)`) doit échouer, et retirer toute la boucle des créateurs doit aussi faire échouer un test. Aucun changement de code attendu.
3. **Test frontend de l'appel à la capacité (F1)**, dans `AppContext.session.spec.tsx` ou dans un fichier voisin avec le même harnais :
   - `/projects/workspaces` renvoie un workspace où l'utilisateur est VIEWER : aucun appel à `/projects/resources/capacity` ;
   - le même avec MEMBER : un appel (contrôle positif).

   La mutation F1 (`if (defaultRole)`) doit faire échouer le test.
4. Relancer toutes les suites (backend, intégration, frontend, builds, lint, prettier, `prisma validate`) et consigner « Résultats (r19) ».

Hors périmètre : O10 à O14 (Phase 5) ; A8 (Phase 6).

### Statut des constats

| ID | Statut r19 |
| --- | --- |
| **P12** | **VALIDÉ** (Q1 à Q4 détectées) |
| **P10** | **VALIDÉ** (C1, C2 détectées ; mutations du fixeur cohérentes) |
| **P11** | **À REPRENDRE** : correctif conforme, mais deux tests manquent (R3, F1) et P11-a reste ouvert |
| **P11-a** | Nouveau, Mineur (CVSS 3.1), Phase 4 |
| **O13** | Nouveau, Mineur (CVSS 2.7), Phase 5 : `syncRepositoryToProject` hors politique, corps sans DTO |
| **O14** | Nouveau, Amélioration, Phase 5 : aligner le workspace « par défaut » entre le frontend (`workspaces[0]`) et le backend (plus ancienne `Membership`) |
| O10, O11, O12 | Inchangés, Phase 5 |

**Constats ouverts à la fin de r19 :**

- Phase 4 (fixeur) : **P11-a**, et les compléments de test de **P11** (R3, F1). La validation de la Phase 4 et sa clôture (`GEMINI.md`, DAT § 15.1, liste de commit) attendent ces trois points.
- Décisions de l'utilisateur, avant le déploiement :
  - commit de Phase 4 après validation ;
  - migration `20261112000000` (runbook Phase 4) ;
  - MFA des comptes de plateforme ;
  - promotion en MEMBER des VIEWER internes (runbook § 5).
- Phase 1 : P9.
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O14.
- Clos en r17 à r19 : P4, P10, P12, S17, S17-a, S18 (1, 2-bis, 2-ter, 3), O7, O8, O9.

## Revue r20 — Phase 4 : VALIDÉ (2026-11-04)

Revue des « Actions de la revue r19 », des « Résultats (r19) » et des « Points ouverts pour l'architecte (r19) » du journal. Les commandes ont été relancées. 7 mutations backend, 2 mutations frontend et 7 sondes de cas limites ont été rejouées : sauvegarde dans un dossier `mktemp -d` hors dépôt, une seule substitution dont l'unicité est vérifiée, restauration et `cmp`. La spec de sonde, temporaire, a été supprimée. Aucun `git stash`, aucune base, aucun commit ; `.claude/` non touché.

**P11-a, P11 (compléments R3 et F1) : VALIDÉS. La Phase 4 est entièrement VALIDÉE côté code.** Il reste les actions de clôture et les décisions de l'utilisateur listées en fin de section.

### Vérifications refaites par l'architecte

| Commande ou contrôle | Résultat |
| --- | --- |
| État reçu | `git stash list` vide ; 61 entrées ; empreinte de `git diff` `790d1b86…`. **Identiques après les mutations et les sondes** |
| `cd backend && env -u DATABASE_URL npx jest` | **81/81 suites, 2362/2362 tests** (identique au journal) |
| `jest tests/integration --detectOpenHandles` | 4/4 |
| `tsc --noEmit -p tsconfig.build.json` ; `eslint src tests scripts` ; `prettier --check src tests` | exit 0 ; 0 erreur, 17 avertissements ; conforme |
| Frontend `vitest run` ; `tsc --noEmit -p .` | **65/65** ; exit 0 |

(`nest build`, `vite build` et `prisma validate` n'ont pas été relancés : le diff r19 ne touche ni au schéma ni à la configuration de build, et `tsc` passe.)

### Mutations (cible backend : `tests/unit/authz`, `tests/unit/projects`, `tests/http/rbac-matrix.spec.ts`, 1732 tests)

| ID | Mutation | Résultat |
| --- | --- | --- |
| A1 | P11-a : filtre `role: { in: … }` retiré (tout workspace commun suffit, quel que soit le rôle) | 4 échecs (viewer-directory et matrice) ; restauré |
| A2 | P11-a : `workspace.directory.read` remplacé par `workspace.read` | 4 échecs ; restauré |
| A3 | P11-a : contrôle supprimé (`if (false)`) | 7 échecs ; restauré |
| A4 | P11-a : filtre `workspaceId: { in: … }` retiré (un rôle MEMBER dans n'importe quel workspace suffit) | 2 échecs (cas `outsider`) ; restauré |
| A5 | P11-a : contrôle appliqué aussi à ses propres absences (`if (true)`) | 1 échec (VIEWER sur ses absences) ; restauré |
| R3 | Annuaire : `memberRole.has(project.userId)` au lieu de `creatorIsManager(...)` | **1 échec** (r19 : survivait) ; restauré |
| R3b | Annuaire : ajout des créateurs supprimé | 1 échec (cas MEMBER) ; restauré |
| F1 | Frontend : `if (defaultRole)` au lieu de `… && defaultRole !== 'VIEWER'` | **1 échec sur 5** (r19 : survivait) ; restauré |
| F1b | Frontend : appel à la capacité jamais fait (`if (false)`) | 1 échec (contrôle positif MEMBER) ; restauré |

### Cas limites de la requête en deux temps (sondes jetables, toutes conformes)

| Cas | Attendu | Observé |
| --- | --- | --- |
| Cible sans aucune `Membership` (`workspaceId in []`) | 403 sans lecture | 403, `resourceLeave` non lu |
| Cible déprovisionnée par SCIM (`Membership` supprimée) | 403 | 403 |
| Appelant déprovisionné | 403 | 403 (et `JwtAuthGuard` bloque déjà un compte suspendu) |
| `PLATFORM_ADMIN` sans `Membership` | 403 (le rôle de plateforme n'ouvre pas les données d'un locataire ; la console admin a ses propres routes) | 403 |
| Appelant VIEWER dans les deux workspaces de la cible | 403 | 403 |
| Appelant VIEWER dans W et MEMBER dans W2 | 200 sur une cible de W2 ; 403 sur une cible de W seul | conforme : l'accès est bien évalué par workspace commun, pas par « meilleur rôle global » |

### Revue du code

- **P11-a** (`resources.service.ts:439-464`) : conforme. Le rôle vient de `WORKSPACE_PERMISSIONS['workspace.directory.read']` (pas de liste en dur) ; `workspace: { deletedAt: null }` sur les deux requêtes ; aucune lecture de `resourceLeave` avant la décision. La requête en deux temps est équivalente à la forme relationnelle et n'ouvre pas d'écart. Elle coûte une requête de plus, ce qui est négligeable.
- **Précision sur le journal** : le faux Prisma ne prend pas en charge `workspace: { deletedAt: null }` (il le traite comme toujours vrai), mais il évalue bien `workspace: { memberships: { some } }`. Le filtre « workspace supprimé » de P11-a n'est donc couvert par aucun test unitaire. C'est sans risque immédiat (Prisma l'applique en base) et c'est le cas de tous les services qui utilisent ce filtre : rattaché à O15 (Amélioration).
- **R3 et F1** : les tests sont ciblés et lisibles. Le harnais F1 garde 100 ms de marge avant de conclure à l'absence d'appel, ce qui suffit : `F1` est détectée de façon stable.
- **Matrice** : `GET /projects/resources/:userId/leaves` passe à `ws('contribute')`. Conforme au critère.

### Nouveau constat r20 (hors Phase 4)

#### O15 : création et suppression d'absences, rôles en dur et workspace supprimé non exclu

- **Fichier** : `backend/src/projects/resources.service.ts:395-411` (`createResourceLeave`), `:474-489` (`deleteResourceLeave`).
- **Cause** : antérieure à la Phase 4. Les rôles `OWNER`/`ADMIN` sont codés en dur au lieu de passer par `WORKSPACE_PERMISSIONS`. Le filtre `workspace: { memberships: { some } }` ne vérifie pas `deletedAt: null`. Un OWNER ou ADMIN d'un workspace **supprimé** (soft delete) peut donc encore créer ou supprimer les absences de ses anciens co-membres. En complément, `optimizeWorkspaceResources` (`:280`) charge les absences de tous les utilisateurs de la plateforme sur 30 jours, sans filtre `userId in` : aucune exposition (rien n'est renvoyé), mais ce n'est pas minimal (RGPD, performance).
- **Sévérité** : Mineur. CVSS 3.1 : 2.2 (AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N).
- **Remédiation attendue (Phase 5)** :
  - factoriser un helper unique `assertCanAccessLeaves(actingUserId, targetUserId, permission)`, utilisé en lecture (`workspace.directory.read`) et en écriture (une permission d'administration de `WORKSPACE_PERMISSIONS`), avec `deletedAt: null` ;
  - filtrer les absences d'`optimizeWorkspaceResources` par `userId: { in: memberIds }` ;
  - prendre en charge `workspace: { deletedAt: null }` dans `rbac-fixture.ts`, en ajoutant `deletedAt` aux workspaces de la fixture ;
  - tests : un ADMIN d'un workspace supprimé crée ou supprime une absence : 403 ; même cas en lecture pour P11-a : 403 ; mutation « `deletedAt` retiré » détectée.

### Réponses aux points ouverts du fixeur (r19)

1. **Changement visible (un VIEWER ne lit plus les absences d'autrui)** : voulu, accepté. À mentionner dans les notes de version de la Phase 4, avec P11.
2. **O13 et O14 en Phase 5** : confirmé.

### Statut des constats

| ID | Statut r20 |
| --- | --- |
| **P11** | **VALIDÉ** (R1b, R2, R3, R4, R5, F1 détectées) |
| **P11-a** | **VALIDÉ** (A1 à A5 détectées ; cas limites conformes) |
| **O15** | Nouveau, Mineur (CVSS 2.2), Phase 5 |
| O10 à O14 | Inchangés, Phase 5 |

**La Phase 4 est entièrement VALIDÉE côté code** (P4, P10, P11, P11-a, P12, S17, S17-a, S18.1, S18.2-bis, S18.2-ter, S18.3, O7, O8, O9).

**Actions restantes pour clore la Phase 4 (pas de nouvelle correction de code) :**

1. Fixeur : clôture documentaire, à savoir `GEMINI.md`, DAT § 15.1, liste des fichiers du commit (sans `.claude/`) et notes de version, dont les changements visibles de P11 et P11-a.
2. Utilisateur : commit de la Phase 4.
3. Utilisateur, avant le déploiement : migration `20261112000000` (runbook Phase 4), MFA des comptes de plateforme, promotion en MEMBER des VIEWER internes (runbook § 5).

**Constats ouverts à la fin de r20 :**

- Phase 1 : P9.
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O15.

## Revue r21 — P9, volet MFA (P9-MFA) : À REPRENDRE (2026-11-04)

Revue de l'entrée « P9-MFA » du journal (statut « CORRIGÉ – À REVOIR »). Le code et les tests ont été relus et les suites relancées. Une mutation frontend a été jouée puis annulée (sauvegarde, substitution, restauration vérifiée par `cmp`). Aucun commit ; `.claude/` non touché. Hors revue : `backend/src/auth/scim/scim.guard.ts` et la partie du journal antérieure à P9-MFA (modifications de l'utilisateur).

**Verdict : À REPRENDRE.** Le fond est bon : l'écran fait ce que P9 demande pour le volet MFA, aucun secret n'est persisté et la route `status` est correctement bornée. Restent quatre corrections courtes (moins d'une heure en tout) : la CI est rouge en l'état, le diff du lockfile est illisible et le journal contient deux affirmations inexactes.

### Vérifications refaites par l'architecte

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` (suite complète) | **81/81 suites, 2365/2365 tests**, 92 s. Aucun échec de temporisation reproduit |
| `nest build` ; ESLint et Prettier sur `auth.controller.ts`, `auth.service.ts`, `auth.service.spec.ts` | exit 0 ; 0 erreur ; conforme |
| `cd frontend && pnpm test:run` | **74/74** (16 fichiers) |
| `tsc --noEmit -p .` ; `pnpm build` (frontend) | exit 0 ; build OK (avertissement de taille de chunk préexistant) |
| ESLint sur les fichiers frontend touchés, et à la racine (`pnpm lint`, comme la CI) | **1 erreur** : `frontend/src/context/AppContext.tsx:263:5 Insert ··  prettier/prettier`. `prettier --check` signale le même fichier |
| `pnpm install --frozen-lockfile --ignore-scripts` sous **Node 20.20.2 et pnpm 9.15.4** (version de `packageManager`), sur une copie isolée des manifestes | OK, avec le lockfile livré **et** avec le lockfile reformaté par Prettier |
| Diff sémantique du lockfile (YAML parsé, HEAD comparé au fichier livré) | 3 ajouts seulement : `importers/frontend/dependencies/qrcode-generator`, `packages/qrcode-generator@2.0.4`, `snapshots/qrcode-generator@2.0.4`. Aucune autre version modifiée |
| `git diff --stat pnpm-lock.yaml` | **9081 lignes modifiées** (2510 ajouts, 6736 suppressions), et non « +11 lignes » comme l'annonce le journal. Le fichier livré est au format natif de pnpm alors que HEAD est au format Prettier. Après `prettier` : diff de 11 lignes |
| Registre npm, `qrcode-generator@2.0.4` | intégrité `sha512-mZSiP6Rn…r8Z9g==`, identique au lockfile ; dépôt `github.com/kazuhikoarase/qrcode-generator` (auteur historique), MIT, **aucune dépendance**, aucun script `install`/`postinstall`, ESM et types fournis. Provenance acceptable |

**Temporisations backend.** Les deux échecs annoncés comme non liés (`mfa-ticket.spec.ts`, `session-lifecycle.spec.ts`) ne se reproduisent pas sur une suite complète sans charge concurrente : le diagnostic « temporisation sous charge » est plausible et accepté. Aucun lien avec le diff (le seul changement backend est une lecture `select`).

### Mutation

| ID | Mutation | Résultat |
| --- | --- | --- |
| M1 | `SecurityPage.confirm` : `localStorage.setItem` des codes de secours et du secret TOTP | **Survit (8/8 verts)** : aucun test ne garde l'exigence « aucune persistance » |

### Revue du code

- **Persistance des secrets : conforme.** Le secret, l'`authUri` et les codes ne vivent que dans l'état React. Aucun `localStorage`, `sessionStorage` ou `console.*` dans `SecurityPage.tsx` et `security-api.ts`. Le QR est calculé en local (aucun appel externe : 3 appels `fetch` exactement dans le test d'activation). Le secret disparaît de l'écran dès la confirmation ou l'annulation. Le Blob du téléchargement est construit à la demande et son URL révoquée. Le profil `planner_user` mis en cache n'est pas enrichi.
- **Backend : conforme.** `getMfaStatus` lit seulement `mfaEnabled` et `passwordHash`, et ne renvoie qu'un booléen dérivé. La route porte `@ForbiddenInImpersonation()`, et le test méta S18.2 (`impersonation-routes.spec.ts`, `^/auth/mfa/`) le garantit pour toute future route `mfa/*`. `PlatformAdminGuard` lit `mfaEnabled` en base : un SUPER_ADMIN qui vient d'activer sa MFA accède à `/admin/*` sans se reconnecter. C'est l'effet attendu pour le déblocage de production (la réserve sur les sessions antérieures relève de O11).
- **Parcours : conforme au critère de P9.** Activation (réauthentification S6-b, QR et clé en texte, confirmation), codes affichés une seule fois avec une confirmation explicite avant fermeture, téléchargement `.txt`, désactivation par TOTP ou par code de secours, régénération. Les erreurs 400, 403 et compte sans mot de passe sont couvertes. Le lien depuis le 403 de la console d'administration est testé.
- **Régénération par TOTP seulement** : le rapport P9 dit « code, ou code de secours ». Le DTO backend (`RegenerateRecoveryCodesDto`) n'accepte que le TOTP, et l'écran s'y conforme. **Accepté** : un utilisateur qui a perdu son TOTP passe par la désactivation (code de secours), puis réactive. Remédiation de P9 mise à jour en ce sens.

### Exigences pour lever « À REPRENDRE »

1. **P9-MFA-a (bloquant, CI)** : corriger l'indentation de `frontend/src/context/AppContext.tsx:263` (troisième union de l'onglet, `| 'security'`). **Critère** : `pnpm lint` à la racine donne 0 erreur ; `npx prettier --check frontend/src/context/AppContext.tsx` est conforme.
2. **P9-MFA-b (bloquant, revue de la chaîne d'approvisionnement)** : remettre `pnpm-lock.yaml` au format de HEAD (`npx prettier --write pnpm-lock.yaml`). Un diff de 9 000 lignes rend invisible toute modification indésirable du lockfile. Je l'ai vérifié sémantiquement cette fois, mais ce contrôle ne doit pas devenir nécessaire à chaque fois. **Critère** : `git diff --stat pnpm-lock.yaml` donne environ 11 insertions et 0 suppression, limitées aux trois entrées `qrcode-generator` ; `pnpm install --frozen-lockfile` passe (vérifié par l'architecte sur le fichier reformaté, sous Node 20 et pnpm 9.15.4).
3. **P9-MFA-c (bloquant, test manquant)** : ajouter à `SecurityPage.spec.tsx` un test de non-persistance. Espionner `Storage.prototype.setItem` (ce qui couvre `localStorage` et `sessionStorage`) ainsi que `console.log`, `console.info`, `console.warn`, `console.error` et `console.debug`. Dérouler l'activation complète puis la régénération. **Critère** : aucun appel ne contient le secret (`JBSWY3DPEHPK3PXP`), l'`authUri` ou l'un des codes ; après démontage (`unmount`), `document.body` ne contient plus aucun code. La mutation M1 doit faire échouer ce test.
4. **P9-MFA-d (journal)** : corriger les deux affirmations inexactes de l'entrée P9-MFA. Le lockfile n'était pas à « +11 lignes » et l'ESLint des fichiers frontend touchés n'était pas à « 0 erreur ». Rendre les chiffres réels après correction.

### Points non bloquants (à traiter dans l'itération P9 suivante ou en Phase 5)

- **P9-MFA-e (Amélioration)** : si l'utilisateur change d'onglet avant « Terminer », le composant est démonté, les codes sont perdus et la MFA reste active. Il pourra régénérer ses codes, mais il ne le sait pas. Il faut au minimum une confirmation au changement d'onglet et un `beforeunload` tant que le panneau des codes est affiché.
- **P9-MFA-f (Amélioration)** : `download()` révoque l'URL du Blob juste après `click()` et n'attache pas le lien au DOM. Sous Safari, le téléchargement peut échouer. Ajouter le lien au DOM, puis appeler `URL.revokeObjectURL` dans un `setTimeout`.
- **P9-MFA-g (Mineur, texte)** : pour un compte sans mot de passe, les formulaires de désactivation et de régénération affichent « … et votre mot de passe » sans champ correspondant. Adapter le texte à `hasPassword`.
- Nouveaux constats **O16** et **O17** ci-dessous (Phase 5).

### Réponses aux questions du fixeur

1. **`GET /auth/mfa/status` plutôt que `mfaEnabled` dans `user` : VALIDÉ.** C'est le bon choix : le cache `planner_user` est périmé par construction, et l'état MFA doit être lu à la source au moment de l'affichage. **`hasPassword` : fuite acceptable.** La route ne prend aucun identifiant (pas d'énumération), ne répond qu'au titulaire authentifié, est interdite en impersonation et ne révèle qu'une propriété que l'utilisateur connaît déjà (sa méthode de connexion). Ne jamais l'ajouter à une réponse qui porte sur un autre compte (console d'administration comprise) sans revue.
2. **QR en `data:` URI : VALIDÉ.** La CSP attendue par S22 prévoit déjà `img-src 'self' data: https:`. Seule exigence : `data:` reste limité à `img-src`, jamais en `default-src` ni en `script-src`. L'option SVG via `dangerouslySetInnerHTML` est moins bonne et est écartée.
3. **Révocation des autres sessions à la désactivation : VALIDÉ** (comportement S6 existant, message de l'écran exact). L'asymétrie à l'activation (les sessions antérieures restent valides) est déjà portée par **O11**. Le futur écran « Sessions actives » de P9 devra proposer « Fermer les autres sessions » juste après l'activation.
4. **Réauthentification de moins de 5 min pour un compte sans mot de passe : VALIDÉ**, c'est la règle S6-b et elle ne doit pas être assouplie pour les SUPER_ADMIN. Consigne pour le runbook de déploiement : un SUPER_ADMIN Firebase ou GitHub se reconnecte, puis active sa MFA dans les 5 minutes.

### Mise à jour de la remédiation P9

- Régénération des codes : **code TOTP et mot de passe (ou connexion récente)**. Le code de secours n'est accepté que pour la désactivation (décision r21).
- Volet MFA : en cours (r21, À REPRENDRE sur P9-MFA-a à d). Volets restants : liaison GitHub et Firebase, sessions actives, « Connecter un dépôt ».

### Nouveaux constats r21

#### O16 : réponses `/auth/*` sans `Cache-Control: no-store`

- **Fichier** : `backend/src/main.ts` (Helmet ne fixe pas `Cache-Control`) ; aucun `no-store` dans `backend/src`.
- **Cause** : les réponses qui portent le secret TOTP (`POST /auth/mfa/setup`), les codes de secours (`/auth/mfa/confirm`, `/auth/mfa/recovery-codes`) et l'état du compte (`GET /auth/mfa/status`, `/auth/sessions`) ne portent pas d'en-tête d'interdiction de cache. Un `GET` peut être conservé par le navigateur ou par un proxy intermédiaire (avec un ETag Express). Le risque est faible pour les `POST`, mais il n'est pas exclu par contrat.
- **Sévérité** : Mineur. CVSS 3.1 : 2.5 (AV:L/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N). ASVS V8.2.1.
- **Remédiation attendue (Phase 5, avec S22)** : intercepteur ou middleware qui pose `Cache-Control: no-store` et `Pragma: no-cache` sur `/auth/*` et `/admin/*`. **Test** : `session-lifecycle.spec.ts`, `POST /auth/mfa/setup` et `GET /auth/mfa/status` renvoient `Cache-Control: no-store`.
- **Complément r41 (r40-a1 ii)** : l'intercepteur doit aussi couvrir `POST /projects/:projectId/webhooks/github/secret` (hors `/auth/*`, réponse portant le secret en clair). Voir S22.

#### O17 : lien « Activer la MFA » de la console d'administration détecté par le texte du message

- **Fichier** : `frontend/src/components/AdminConsole.tsx` (`/deux facteurs/i.test(reason)`) ; `backend/src/admin/platform-admin.guard.ts:42-45`.
- **Cause** : le frontend reconnaît le 403 « MFA obligatoire » à son libellé français. Une reformulation ou une traduction du message casse silencieusement le parcours de déblocage. Aucun impact de sécurité : le backend refuse dans tous les cas.
- **Sévérité** : Amélioration.
- **Remédiation attendue (Phase 5)** : le garde renvoie un code stable (`{ statusCode: 403, code: 'MFA_REQUIRED', message }`) et le frontend teste `code`. **Test** : le cas de `AdminConsole.spec.tsx` utilise `code` ; un message modifié avec `code` conservé mène toujours à l'écran.

### Statut des constats

| ID | Statut r21 |
| --- | --- |
| **P9** (volet MFA) | **À REPRENDRE** : P9-MFA-a, b, c et d bloquants ; e, f et g non bloquants |
| P9 (GitHub et Firebase, sessions, « Connecter un dépôt ») | ouvert |
| **O16** | Nouveau, Mineur (CVSS 2.5), Phase 5 |
| **O17** | Nouveau, Amélioration, Phase 5 |

**Constats ouverts à la fin de r21 :**

- Phase 1 : P9 (volet MFA : P9-MFA-a à d ; autres volets).
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O17.

## Revue r22 — P9, volet MFA (reprise P9-MFA-a à g) : VALIDÉ (2026-11-05)

Revue de la section « Reprise r21 (fixeur) — P9-MFA-a à g » du journal. Le code a été relu et les suites relancées. Cinq mutations frontend ont été jouées par un script hors dépôt : sauvegarde, une seule substitution dont l'unicité est vérifiée, restauration vérifiée par `filecmp`, et `git status` identique avant et après. Aucun commit, aucun `git stash` ; `.claude/` non touché.

**Verdict : P9-MFA VALIDÉ.** Les quatre points bloquants (a à d) sont corrigés, et les trois points non bloquants (e à g) sont traités. Un point résiduel non bloquant (P9-MFA-h). Un nouveau constat hors P9 (**O18**) : il rend la suite backend rouge aujourd'hui, donc la CI du futur commit.

### Vérifications refaites par l'architecte

| Commande | Résultat |
| --- | --- |
| `pnpm lint` (racine, comme la CI) | **0 erreur**, 53 avertissements (`no-explicit-any` préexistants) |
| `prettier --check` sur les 9 fichiers frontend du lot (dont `unsaved-codes.ts` et `SecurityPage.css`) | conforme |
| `cd frontend && pnpm test:run` | **76/76** (16 fichiers) |
| `tsc --noEmit -p .` ; `pnpm build` (frontend) | exit 0 ; build OK |
| `git diff --stat pnpm-lock.yaml` | **11 insertions, 0 suppression**, limitées aux trois entrées `qrcode-generator@2.0.4` (intégrité inchangée, identique au registre) |
| `pnpm install --frozen-lockfile --ignore-scripts` sous **Node 20.20.2 et pnpm 9.15.4**, sur une copie isolée des manifestes et du lockfile | OK ; lockfile non réécrit (`cmp` identique) |
| Backend : `git diff --stat backend/` | inchangé depuis r21 (9, 26 et 12 lignes, plus `scim.guard.ts` de l'utilisateur, hors revue) |
| `cd backend && env -u DATABASE_URL npx jest` ; `nest build` | **80/81 suites, 2363/2365** ; `nest build` exit 0. Les 2 échecs (`rbac-services.spec.ts`, S12-e) sont **sans lien avec P9** : voir O18 |

### Mutations frontend

| ID | Mutation | Résultat |
| --- | --- | --- |
| M1 | `confirm` : `localStorage.setItem` des codes de secours (mutation r21) | **Détectée** (1 échec sur 10) ; restaurée |
| M1b | `startSetup` : `sessionStorage.setItem` du secret TOTP | Détectée ; restaurée |
| M1c | `regenerate` : `console.debug` de la réponse (nouveaux codes) | Détectée ; restaurée |
| M3 | `RecoveryCodesPanel` : `setUnsavedCodes(false)` au montage | Détectée ; restaurée |
| M2 | `AppContext` : `setActiveTab` brut exposé à la place de `guardedSetActiveTab` | **Survit (76/76)** : voir P9-MFA-h |

### Revue des points

- **a : corrigé.** L'indentation est corrigée et `pnpm lint` passe à 0 erreur.
- **b : corrigé.** Le diff du lockfile fait 11 lignes, et `--frozen-lockfile` passe sous Node 20 et pnpm 9.15.4. La note du journal est exacte : tout `pnpm install` réécrit le fichier au format natif. À retenir : repasser `prettier` sur le lockfile après chaque installation.
- **c : corrigé.** Le test espionne `Storage.prototype.setItem` et les cinq méthodes de `console`, déroule l'activation puis la régénération, inspecte le contenu des deux stockages, puis vérifie le DOM après démontage. Les trois variantes de fuite (M1, M1b, M1c) sont détectées. Remarque mineure : `vi.restoreAllMocks()` est appelé en fin de test, donc il n'est pas exécuté si une assertion échoue avant. Le déplacer dans un `afterEach`.
- **d : corrigé.** L'entrée P9-MFA d'origine mentionne maintenant le diff réel du lockfile (+2353/−6728) et l'erreur ESLint manquée. Les chiffres de la reprise sont exacts (76/76, lint, 11 lignes).
- **e : traité.** Le module `unsaved-codes.ts` lève un drapeau tant que le panneau des codes est monté. Ce drapeau pose un écouteur `beforeunload` et déclenche un `window.confirm` au changement d'onglet. Il est idempotent, donc compatible avec le double montage de `StrictMode`. La limite déclarée par le fixeur (la déconnexion ne demande pas de confirmation) est **acceptée** : c'est une action explicite, et la régénération reste possible.
- **f : traité.** Le lien est ajouté au DOM puis retiré, et la révocation de l'URL est différée de 1 s.
- **g : traité.** Le texte des formulaires de désactivation et de régénération dépend maintenant de `hasPassword`.

### Point résiduel (non bloquant)

- **P9-MFA-h (Amélioration)** : le branchement de la garde dans `AppContext` (`setActiveTab: guardedSetActiveTab`) n'est couvert par aucun test, d'où la survie de M2. Le test e appelle `confirmLeaveUnsavedCodes()` directement. **Attendu (à la prochaine itération P9)** : un test qui rend `AppProvider` avec la page de sécurité et les codes affichés, avec `window.confirm` qui renvoie `false`, appelle `setActiveTab('dashboard')` via `useApp()` et vérifie que l'onglet actif reste `security`. M2 doit le faire échouer.

### Nouveau constat r22 (hors P9)

#### O18 : test S12-e dépendant de la date du jour (jours fériés)

- **Fichier** : `backend/tests/unit/authz/rbac-services.spec.ts:410-420` (`expect(report[0].weeklyCapacityMinutes).toBe(2400)`) ; calcul dans `backend/src/projects/resources.service.ts:80-81` (fenêtre `new Date()` + 7 jours) et `:530-578` (`getAdjustedCapacity`, qui retire les jours fériés).
- **Cause** : le test suppose une capacité pleine (5 jours ouvrés) sur la fenêtre glissante de 7 jours qui commence **aujourd'hui**. Dès que cette fenêtre contient un jour férié français, la capacité tombe à 4/5, soit 1920. Le 2026-11-05, la fenêtre contient le 11 novembre. Je l'ai vérifié en figeant l'horloge (`jest.useFakeTimers({ now })`, `Date` seul) : le 2026-11-04, 72/72 passent ; le 2026-11-05, 2 échecs (`member`, `contributor`). Le code de production est correct.
- **Impact** : la CI (`pnpm --filter backend test`) est rouge environ 7 jours avant chacun des 11 jours fériés de l'année, donc dès maintenant pour le commit de P9 et de la Phase 4. Aucun impact de sécurité.
- **Sévérité** : Mineur (qualité des tests), **à traiter en priorité** puisqu'il bloque la CI.
- **Remédiation attendue** : dans le `describe` S12-e, figer l'horloge sur une semaine sans jour férié (`jest.useFakeTimers({ now: new Date('2026-11-02T08:00:00Z'), doNotFake: [...] })` en `beforeEach`, `jest.useRealTimers()` en `afterEach`), ou bien affirmer seulement que `weeklyCapacityMinutes` est un nombre positif. **Critère** : la suite passe en figeant l'horloge au 2026-11-05 et au 2026-12-21. Chercher les autres tests qui dépendent de `new Date()` dans `resources.service` (capacité, `optimizeWorkspaceResources`) et les traiter de la même façon.

### Statut des constats

| ID | Statut r22 |
| --- | --- |
| **P9, volet MFA** | **VALIDÉ** (a à g) ; P9-MFA-h en Amélioration |
| P9 (GitHub et Firebase, sessions actives, « Connecter un dépôt ») | ouvert |
| **O18** | Nouveau, Mineur, priorité immédiate (CI rouge) |
| O16, O17 | inchangés, Phase 5 |

**Le volet MFA de P9 peut partir en production.** Les SUPER_ADMIN pourront l'activer dès le déploiement (runbook : un compte Firebase ou GitHub se reconnecte, puis active sa MFA dans les 5 minutes). Corriger O18 avant le commit, sinon la CI sera rouge.

**Constats ouverts à la fin de r22 :**

- Immédiat : O18.
- Phase 1 : P9 (liaison GitHub et Firebase, sessions actives, « Connecter un dépôt » ; P9-MFA-h).
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O17.

### Retour du fixeur après r22 (à relire par l'architecte)

Section ajoutée à la demande de l'utilisateur pour notifier l'architecte. Le détail et les preuves sont dans `journal-corrections.md`, section « Reprise r22 (fixeur) ». Aucun statut n'est modifié ici : seul l'architecte valide.

| ID | Statut proposé par le fixeur | Preuve |
| --- | --- | --- |
| **O18** | CORRIGÉ – À REVOIR | Horloge figée au 2026-06-01 (`rbac-services.spec.ts`, `useFakeTimers` limité à `Date`, `useRealTimers` en `afterEach`). Date système simulée au 2026-11-05 : 72/72 ; au 2026-12-21 : 72/72 ; sans le correctif au 2026-11-05 : 2 échecs. |
| **P9-MFA-h** | CORRIGÉ – À REVOIR | Test via `AppProvider` et `useApp().setActiveTab` (confirm à `false` : l'onglet reste `security`) ; `restoreAllMocks` en `afterEach` ; contre-mutation (`setActiveTab` brut) : échec constaté, puis restauré. |

Mesures après correction : backend `env -u DATABASE_URL npx jest` 81/81 suites, 2365/2365 tests ; frontend `pnpm test:run` 77/77 ; `pnpm build` frontend OK ; `pnpm lint` racine 0 erreur, 53 avertissements. Rien n'est committé.

## Revue r23 — O18 et P9-MFA-h ; verdict final du lot P9-MFA et O18 : VALIDÉ (2026-11-05)

Revue de la section « Reprise r22 (fixeur) — O18 et P9-MFA-h » du journal. Le code a été relu et les suites relancées. Douze dates ont été simulées sur le fichier corrigé, et trois contre-mutations frontend jouées par un script hors dépôt : sauvegarde, une seule substitution dont l'unicité est vérifiée, restauration vérifiée par `filecmp`, et `git status` identique avant et après. Aucun commit, aucun `git stash` ; `.claude/` non touché.

**Verdict final : le lot P9-MFA (volet MFA de P9) et O18 est VALIDÉ, bon pour le commit et le déploiement en production.** Il n'y a pas de point bloquant. Un nouveau constat **Critique**, **S30** (mots de passe par défaut dans le seed d'un dépôt public), est consigné ci-dessous sans correction : il ne bloque pas ce lot, sous les conditions de déploiement indiquées en fin de section.

### Vérifications refaites par l'architecte

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **81/81 suites, 2365/2365 tests** |
| `nest build` ; `tsc --noEmit -p tsconfig.build.json` ; `prettier --check` (`rbac-services.spec.ts`, `src/auth`) | exit 0 ; exit 0 ; conforme |
| `pnpm lint` (racine, comme la CI) | **0 erreur**, 53 avertissements préexistants |
| `cd frontend && pnpm test:run` ; `tsc --noEmit -p .` ; `pnpm build` | **77/77** (16 fichiers) ; exit 0 ; build OK |
| `pnpm-lock.yaml` et `frontend/package.json` | identiques (`cmp`) aux fichiers validés en r22 : `--frozen-lockfile` sous Node 20.20.2 et pnpm 9.15.4 reste acquis ; diff +11/−0 |

### O18 : l'horloge figée ne masque-t-elle rien ?

J'ai fait varier la date figée (`now`) sur 12 valeurs, à la place du 2026-06-01, puis relancé `rbac-services.spec.ts` :

| Date figée | Résultat |
| --- | --- |
| 2026-01-01, 2026-04-01, 2026-05-11, 2026-07-10, 2026-11-05, 2026-12-21, 2026-12-31 23:30Z, 2027-03-29 (fenêtres contenant respectivement le 1er janvier, le lundi de Pâques, l'Ascension, le 14 juillet, le 11 novembre, Noël, le 1er janvier 2027 et le lundi de Pâques 2027) | 70/72 : **seuls** les 2 cas S12-e `member` et `contributor` échouent |
| 2026-08-12, 2028-02-29, 2030-01-07, 2020-01-06 (fenêtres sans jour férié, années bissextiles comprises) | 72/72 |

**Conclusion : conforme.** Dans ce fichier, seul S12-e dépend de la date, et il ne devait pas en dépendre : son objet est l'absence des taux dans la réponse, pas le calendrier. Aucun autre test du fichier ne change de résultat selon la date. Ils utilisent des dates littérales (`2026-01-01` à `2026-01-14` pour les sprints) et des faux Prisma qui renvoient des listes vides pour les absences. La date retenue, le lundi 2026-06-01, est sûre : la Pentecôte 2026 tombe le 25 mai, et la fenêtre du 1er au 7 juin ne contient aucun jour férié. Le calcul des jours fériés reste couvert ailleurs, avec des dates explicites (`tests/unit/projects/resources.service.spec.ts`).

**`doNotFake` : conforme.** Seule `Date` est simulée. Les minuteries réelles sont conservées : `setTimeout`, `setInterval`, `setImmediate`, `nextTick`, `queueMicrotask`, `performance` et `hrtime`. `requestAnimationFrame` et `requestIdleCallback` n'existent pas dans l'environnement `node` de Jest (`testEnvironment: 'node'`). Les minuteries simulées de Jest sont propres à chaque fichier de test, et `afterEach(jest.useRealTimers)` restaure l'horloge à chaque test. Les autres fichiers qui simulent les minuteries (`ws-revalidation.spec.ts`, `tracking.gateway.spec.ts`) ne sont pas touchés, et la suite complète passe.

### P9-MFA-h : contre-mutation

| ID | Mutation | Résultat |
| --- | --- | --- |
| M2 | `AppContext` : `setActiveTab` brut exposé à la place de `guardedSetActiveTab` (survivait en r22) | **Détectée** (1 échec sur 11) ; restaurée |
| M1 | `confirm` : `localStorage.setItem` des codes (non-régression) | Détectée ; restaurée |
| M3 | `setUnsavedCodes(false)` au montage (non-régression) | Détectée (2 échecs) ; restaurée |

Le nouveau test rend `AppProvider`, active la MFA, puis appelle `useApp().setActiveTab('kanban')`. Avec un refus, l'onglet reste `security` et `confirm` est appelé une fois. Avec un accord, l'onglet passe à `kanban`. `vi.restoreAllMocks()` est maintenant dans un `afterEach`. **Conforme.**

### Statut des constats

| ID | Statut r23 |
| --- | --- |
| **O18** | **VALIDÉ** |
| **P9-MFA-h** | **VALIDÉ** |
| **P9, volet MFA** (P9-MFA-a à h) | **VALIDÉ, clos** |
| P9 (liaison GitHub et Firebase, sessions actives, « Connecter un dépôt ») | ouvert |
| **S30** | **Nouveau, Critique**, mesure d'urgence prise en production le 2026-11-05, correction du code ouverte |

**Conditions du commit et du déploiement de ce lot :**

1. Le commit contient aussi `backend/src/auth/scim/scim.guard.ts`, modifié par l'utilisateur et **hors des revues r21 à r23**. Le committer séparément, ou après une revue dédiée.
2. Ne pas committer `.claude/`.
3. Au déploiement : **ne pas exécuter `prisma db seed` ni `pnpm seed`** contre la production tant que S30 n'est pas corrigé (voir plus bas : le seed remettrait le rôle `SUPER_ADMIN` et le mot de passe Firebase connu).
4. Runbook : les SUPER_ADMIN activent leur MFA depuis l'écran « Sécurité du compte ». Un compte Firebase ou GitHub se reconnecte d'abord, puis l'active dans les 5 minutes.

### Nouveau constat r23

#### S30 : mots de passe par défaut d'un SUPER_ADMIN en clair dans le seed d'un dépôt public

- **Fichier** : `backend/prisma/seed.ts:106-108`.
  - Mots de passe de repli : `process.env.SEED_ADMIN_PASSWORD || 'Admin123!Secure'`, ainsi que `Manager123!Secure` et `User123!Secure`.
  - `:140-153` : `upsert` de `admin@planner-pro.com` avec `platformRole: SUPER_ADMIN` dans la branche `create` **et dans la branche `update`**.
  - `:53-89` (`ensureFirebaseAuthUser`) : remplace le mot de passe du compte Firebase existant par la même valeur et force `emailVerified: true`.
  - `:350-356` : affiche les mots de passe dans la console.
  - `:17` : DSN de repli `root:root_password`, déjà relevé dans A7.
- **Introduit par** : `c5835ef` (2026-10-27). Les valeurs sont dans l'historique Git public : elles sont **compromises définitivement**, quel que soit le correctif.
- **Cause** : valeurs par défaut sûres en apparence (« fail-open », comme A7). Le seed ne distingue pas les environnements, et son `update` réapplique les privilèges à chaque exécution.
- **Impact** : avant la mesure d'urgence, n'importe qui pouvait se connecter en production comme `admin@planner-pro.com` (SUPER_ADMIN) avec un mot de passe publié, par mot de passe ou par Firebase. La MFA de S18.3 bloquait `/admin/*` faute de second facteur. Mais un attaquant connecté pouvait **enrôler son propre TOTP** (`/auth/mfa/setup` exige seulement le mot de passe, qu'il connaît), puis administrer la plateforme. Les comptes `manager` et `user` donnaient accès à leurs données de workspace. **Risque résiduel après la mesure** : une nouvelle exécution du seed contre la production remet `SUPER_ADMIN` (branche `update`) et le mot de passe Firebase connu ; les comptes Firebase associés existent peut-être encore avec ces mots de passe.
- **Sévérité** : **Critique**. CVSS 3.1 avant la mesure : **9.8** (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H). CWE-798 et CWE-1392. ASVS V2.3.1 et V14.1.
- **Mesure déjà prise en production (2026-11-05, par l'utilisateur)** : rôle `SUPER_ADMIN` retiré à `admin@planner-pro.com` ; les trois comptes du seed suspendus ; jetons révoqués.
- **Actions d'exploitation restant à vérifier (sans code)** :
  1. Firebase Authentication du projet de production : les comptes `admin@`, `manager@` et `user@planner-pro.com` sont désactivés ou supprimés, et leurs jetons de rafraîchissement révoqués (`revokeRefreshTokens`).
  2. Investigation depuis le 2026-10-27 : connexions réussies de ces trois comptes (journal d'audit et sessions), MFA enrôlée sur `admin@` (`mfaEnabled`, `mfaPendingSecret`), actions d'administration, clés SCIM, intégrations, invitations ou liaisons GitHub et Firebase créées par ces comptes. Tout résultat positif est traité comme un **incident**.
  3. Vérifier qu'aucun autre environnement (staging, démo) ni aucun compte réel n'utilise ces valeurs.
  4. Ne pas exécuter le seed contre la production avant la correction ci-dessous.
- **Remédiation attendue (code, à traiter en priorité, avant toute nouvelle exécution du seed)** :
  1. **Aucune valeur par défaut** : supprimer les replis `|| '…'`. `SEED_ADMIN_PASSWORD`, `SEED_MANAGER_PASSWORD` et `SEED_USER_PASSWORD` sont **obligatoires**. Si l'une manque, le seed s'arrête avec un code non nul, **avant toute écriture** (base et Firebase).
  2. **Refus en production sans configuration explicite** : `NODE_ENV` doit être présent (refus s'il est absent, pas de mode dev implicite, cf. A7). Si `NODE_ENV=production`, le seed refuse de s'exécuter, sauf si **toutes** les variables `SEED_*_PASSWORD` sont fournies **et** que `SEED_ALLOW_PRODUCTION=true` est posé explicitement. Dans ce cas, il journalise un avertissement sans aucun secret. `DATABASE_URL` est obligatoire (suppression du repli `root:root_password`, cf. A7).
  3. **Qualité des valeurs** : refuser un mot de passe de moins de 16 caractères, ou égal à l'une des trois valeurs publiées (liste de refus en dur : `Admin123!Secure`, `Manager123!Secure`, `User123!Secure`), ou identique à un autre mot de passe du seed.
  4. **Pas d'élévation à la réexécution** : la branche `update` ne modifie jamais `platformRole`, `passwordHash`, `firebaseUid`, ni l'état de suspension. Un compte existant n'est ni promu, ni réactivé, ni réinitialisé. En production, le seed n'attribue **aucun** `platformRole` : la promotion d'un SUPER_ADMIN passe par un script dédié, journalisé dans l'audit et suivi de l'activation de la MFA.
  5. **Firebase** : ne jamais modifier le mot de passe ni `emailVerified` d'un compte Firebase existant. Désactiver la synchronisation Firebase quand `NODE_ENV=production`, sauf drapeau explicite.
  6. **Aucun secret dans les journaux** : supprimer les `console.log` des mots de passe (`:350-356`). Afficher seulement les adresses créées.
  7. **Détection** : ajouter une analyse de secrets à la CI (par exemple `gitleaks` en mode `detect`, avec une liste d'exceptions revue) et une règle qui fait échouer la CI si les trois valeurs publiées réapparaissent.
- **Tests attendus** (`backend/tests/unit/scripts/seed.spec.ts`, en isolant `main()` du lancement du script) :
  - variable `SEED_ADMIN_PASSWORD` absente : arrêt non nul, **zéro appel** à `prisma.user.upsert` et à Firebase ;
  - `NODE_ENV` absent : refus ;
  - `NODE_ENV=production` avec toutes les variables mais sans `SEED_ALLOW_PRODUCTION=true` : refus sans écriture ; avec le drapeau : exécution, sans aucun `platformRole` attribué ;
  - mot de passe égal à `Admin123!Secure`, ou de moins de 16 caractères : refus ;
  - compte existant suspendu et sans rôle : après le seed, toujours suspendu et sans rôle, avec un `passwordHash` inchangé ;
  - compte Firebase existant : `updateUser` n'est pas appelé avec `password` ;
  - aucun appel à `console.*` ne contient l'une des valeurs `SEED_*_PASSWORD` ;
  - le code source de `seed.ts` ne contient plus les trois valeurs publiées.
- **Critère d'acceptation** : il est impossible d'exécuter le seed sans fournir de secrets, impossible de l'exécuter en production sans un consentement explicite, et une réexécution ne réélève et ne réactive aucun compte.

**Constats ouverts à la fin de r23 :**

- **Immédiat : S30** (Critique ; mesure d'urgence prise ; vérifications d'exploitation 1 à 4 et correction du code à faire).
- Phase 1 : P9 (liaison GitHub et Firebase, sessions actives, « Connecter un dépôt »).
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O17.

## Ajout r23-bis — liaison d'identités externes (décision de l'utilisateur : option C) (2026-11-05)

**Décision de l'utilisateur** : un compte créé par GitHub (ou par une autre méthode) n'est **jamais** provisionné automatiquement dans Firebase Authentication, ni côté serveur par l'Admin SDK, ni ailleurs. Rattacher une identité externe (Firebase, GitHub) à un compte se fait uniquement par **liaison explicite**, depuis une session authentifiée, via l'écran « Sécurité du compte » (P9, volet liaison). MySQL reste l'annuaire de référence, et Firebase Authentication reste un fournisseur d'identité parmi d'autres (`docs/deployment-production.md:30-38`). La règle S8 « jamais de liaison par e-mail lors d'une connexion non authentifiée » est maintenue (`auth.service.ts:233-240` pour Firebase, `:381-389` pour GitHub).

**Ordre de traitement : S30 d'abord** (Critique, le fixeur y travaille), **puis S31**. S31 doit être livré **avant l'ouverture de l'écran de liaison de P9** : cet écran rendrait le défaut directement exploitable depuis l'interface.

#### S31 : liaison d'une identité Firebase ou GitHub sans réauthentification (porte dérobée persistante après un vol de session)

- **Phase** : 1 (complément, avec P9, volet liaison). **Sévérité** : **Majeur**. **CVSS 3.1 : 6.8** `AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:N`. Complexité élevée, car il faut d'abord voler une session ; une fois l'identité liée, l'accès au compte est complet et durable. CWE-306 (authentification manquante pour une fonction critique), CWE-620. ASVS V2.5 et V3.7.1.
- **Localisation** :
  - `backend/src/auth/auth.service.ts:260-290` (`linkFirebaseAccount`) et `:420-445` (`linkGitHubAccount`) : aucun appel à `assertReauthenticated` (`:831-852`), alors que `setupMfa`, `disableMfa` et `regenerateRecoveryCodes` l'appellent (`:877`, `:947`, `:974`) ;
  - `backend/src/auth/auth.controller.ts:125-127` (`POST /auth/github/link`) et `:366-371` (`POST /auth/firebase/link`) : protégés par session, `@ForbiddenInImpersonation()` (S18.2) et limitation de débit, mais sans exigence de réauthentification ;
  - pas de route de déliaison (aucun `unlink` dans `backend/src`) ;
  - pas de notification au titulaire (`backend/src/mail/mail.service.ts` : aucun modèle « identité liée ou déliée ») ;
  - `linkFirebaseAccount` ne compare pas l'e-mail Firebase à celui du compte (`:260-279`). Ce n'est pas une faille en soi si la réauthentification est exigée, mais rien ne montre l'adresse liée à l'utilisateur.
- **Scénario** :
  1. Un attaquant obtient une session valide de la victime : cookie volé par XSS (cf. S20), poste partagé resté connecté, jeton intercepté.
  2. Depuis cette session, il appelle `POST /auth/firebase/link` avec le `idToken` d'un compte Firebase **qu'il contrôle** (e-mail vérifié chez Firebase, n'importe quelle adresse). Ou bien `POST /auth/github/link` avec le code OAuth de **son** compte GitHub. Aucune preuve de connaissance du mot de passe, du TOTP ou d'une connexion récente n'est demandée.
  3. Son identité est désormais rattachée au compte de la victime (`firebaseUid` ou `githubId`). Il se reconnecte quand il veut par Firebase ou GitHub. L'accès **survit** à la révocation des sessions, au changement ou à la réinitialisation du mot de passe, et à l'expiration de la session volée. La victime n'en est pas informée.
  4. Si la victime a activé la MFA, `completeLogin` l'exige aussi pour la connexion par l'identité liée (S8). L'attaque est alors limitée aux comptes sans MFA, ou à un attaquant qui a aussi le second facteur. La majorité des comptes restent concernés, puisque la MFA n'est obligatoire que pour les comptes de plateforme (S18.3).
- **Remédiation attendue** (conditions 1 à 5 de l'option C) :
  1. **Réauthentification récente, obligatoire pour lier.** `linkFirebaseAccount` et `linkGitHubAccount` appellent `assertReauthenticated(user, password, sid)`, comme pour le MFA (S6-b) :
     - compte avec mot de passe : le mot de passe est fourni dans le corps (`LinkFirebaseDto { idToken, password? }`, `GithubLinkDto { code, state, password? }`) ;
     - compte sans mot de passe : connexion de moins de 5 minutes (`REAUTH_MAX_AGE_MS`) ;
     - **en plus**, si `mfaEnabled` est vrai : un code TOTP valide ou un code de secours, vérifié par `verifyCurrentFactor`, ce qui consomme le pas de temps.

     Pour GitHub, l'utilisateur revient de la redirection OAuth sans que le mot de passe ait transité : l'écran le demande au retour, puis l'envoie avec `code` et `state`. Le mot de passe n'est jamais conservé dans `sessionStorage` ni dans le `state`. Autre solution acceptée : une route `POST /auth/reauth` qui pose sur la session (`sid`) un marqueur de réauthentification d'au plus 5 minutes, à usage unique, consommé par la liaison. Dans les deux cas, la vérification se fait **avant** toute écriture et avant l'échange du code GitHub contre un jeton d'accès, ce qui évite de stocker un jeton `repo` si la réauthentification échoue.
  2. **Notification au titulaire.** Chaque liaison et chaque déliaison envoie un e-mail à l'adresse du compte (nouveau `MailService.sendIdentityLinkedEmail` et `sendIdentityUnlinkedEmail`). Le message indique le fournisseur, l'identifiant affichable (e-mail Firebase lié ou `githubUsername`), la date et le lien vers « Sécurité du compte ». Il ne contient aucun jeton ni secret. L'événement est aussi consigné dans le journal d'audit, avec `userId`, le fournisseur et `sid`.
  3. **Déliaison et dernière méthode de connexion.**
     - Nouvelles routes `POST /auth/firebase/unlink` et `POST /auth/github/unlink`, ou `DELETE /auth/identities/:provider`. Elles portent `@ForbiddenInImpersonation()` (à ajouter à la liste S18.2 et au balayage de `impersonation-routes.spec.ts`, dont l'expression `/link$/` ne couvre pas `unlink`), une limitation de débit et la **même réauthentification** qu'au point 1.
     - **Refus (409) de retirer la dernière méthode de connexion.** Une déliaison n'est permise que s'il reste au moins un autre moyen : `passwordHash` non nul, l'autre identité externe, ou un SSO actif pour le domaine.
     - La déliaison GitHub efface aussi `githubAccessToken`. Après une déliaison, les autres sessions sont révoquées (`revokeAllForUser(userId, sid)`), comme à la désactivation du MFA.
  4. **Protections existantes conservées.** 409 si l'identité est déjà liée à un autre compte (`:271-274`, `:425-428`) ; e-mail vérifié exigé par Firebase ; interdiction en impersonation ; aucune liaison par e-mail lors d'une connexion non authentifiée (S8, S9) ; aucun provisionnement Firebase côté serveur (décision ci-dessus).
  5. **Transparence de l'adresse liée.** L'écran « Sécurité du compte » affiche l'identité liée : e-mail Firebase (à conserver dans un nouveau champ `firebaseEmail`, ou à relire à la demande par l'Admin SDK) et `githubUsername`. L'écran de confirmation de la liaison affiche cette adresse **avant** validation et signale clairement quand elle diffère de l'e-mail du compte. Exiger l'égalité des e-mails n'est **pas** demandé : un utilisateur peut légitimement lier une adresse personnelle.
- **Tests attendus** :
  - `auth.service.spec.ts`, tests paramétrés sur `{ firebase, github } × { compte avec mot de passe, compte sans mot de passe }` :
    - mot de passe absent ou faux : 403, **aucun** `user.update`, et pour GitHub aucun échange `code` vers jeton (fetch non appelé) ;
    - compte sans mot de passe dont la session date de plus de 5 min : 403 ; de moins de 5 min : liaison effectuée ;
    - `mfaEnabled` sans code ou avec un code faux : 403 ou 400 et aucune écriture ; code valide : liaison effectuée et pas de temps consommé ;
    - liaison réussie : un appel à `sendIdentityLinkedEmail` vers l'adresse du compte, et une entrée d'audit.
  - Déliaison :
    - compte dont l'identité est la seule méthode (pas de `passwordHash`, une seule identité, pas de SSO) : **409** et aucune écriture ;
    - avec une autre méthode : 204, champ remis à `null` (et `githubAccessToken` effacé pour GitHub), notification envoyée, autres sessions révoquées, session courante conservée ;
    - sans réauthentification : 403.
  - `impersonation-routes.spec.ts` : les routes de déliaison sont dans la liste interdite, et le balayage méta couvre `/unlink$/` (ou `/identities/`).
  - `session-lifecycle.spec.ts` (HTTP) : `POST /auth/firebase/link` avec une session valide mais sans réauthentification donne 403 ; avec le mot de passe, 2xx.
  - Frontend (P9, volet liaison) : le retour GitHub avec la finalité `link` demande le mot de passe (ou le code MFA) avant d'appeler `/auth/github/link`. L'adresse liée est affichée avant confirmation. Le bouton « Délier » est désactivé, avec une explication, lorsqu'il s'agit de la dernière méthode de connexion.
- **Critère d'acceptation** : une session seule, sans preuve récente de connaissance du mot de passe ou d'une connexion de moins de 5 minutes, plus le second facteur si la MFA est active, ne permet ni de lier ni de délier une identité externe. Toute liaison ou déliaison est notifiée au titulaire. Aucun compte ne peut se retrouver sans méthode de connexion.

**Correction documentaire rattachée à S31** (à livrer avec S31 ; la description de l'écran relève de P9) :

- **Fichier** : `docs/deployment-production.md:68-71`. Le texte actuel dit qu'il suffit de s'inscrire dans Firebase avec la même adresse puis de se connecter par l'onglet Firebase, et que « le backend associe alors le UID Firebase au même compte MySQL ». **C'est faux depuis S8** : cette connexion renvoie 409 (`auth.service.ts:233-240`), et aucune liaison par e-mail n'a lieu. Ce texte guide en outre l'exploitation vers un parcours qui ressemble à la liaison automatique interdite.
- **Texte attendu** : « Un compte existant n'est jamais rattaché automatiquement à une identité Firebase ou GitHub de même adresse : la connexion est refusée (409). Pour ajouter une méthode de connexion, l'utilisateur se connecte avec sa méthode habituelle, ouvre "Sécurité du compte", confirme son identité (mot de passe ou connexion récente, plus le code MFA si elle est active), puis lie son compte Firebase ou GitHub. Une notification est envoyée à chaque liaison ou déliaison. Planner-Pro ne crée jamais de compte Firebase Authentication à la place de l'utilisateur. »
- **Critère** : `grep -n "associe alors" docs/deployment-production.md` ne renvoie plus rien ; le nouveau texte cite la réauthentification et le 409.

**Mise à jour de P9 (volet liaison)** : l'écran de liaison s'appuie sur S31 (réauthentification, déliaison, notification, affichage de l'adresse liée). **Il ne peut pas être ouvert aux utilisateurs avant que S31 soit VALIDÉ.**

**Constats ouverts après r23-bis :**

- **Immédiat, dans l'ordre : S30** (Critique ; correction en cours par le fixeur ; vérifications d'exploitation 1 à 4), **puis S31** (Majeur, CVSS 6.8, avec la correction de `deployment-production.md:68-71`).
- Phase 1 : P9 (liaison GitHub et Firebase, qui dépend de S31 ; sessions actives ; « Connecter un dépôt »).
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O17.

## Revue r24 — S30 (seed sans secret par défaut) : À REPRENDRE (2026-11-05)

Revue de l'entrée « S30 — Mots de passe par défaut du seed » du journal. Le code a été relu et les suites relancées. 11 contre-mutations du seed ont été jouées par un script hors dépôt (sauvegarde, substitutions dont l'unicité est vérifiée, restauration vérifiée par `filecmp`, `git status` identique avant et après). La CLI du seed a été lancée avec un environnement vide (`env -i`), donc sans aucune base. Gitleaks a été exécuté avec l'image épinglée sur une copie de l'arbre (`git ls-files -co --exclude-standard`). Aucun commit ; `.claude/` non touché. Hors revue : `backend/src/auth/scim/scim.guard.ts` (utilisateur) et `README.md`, modifié dans l'arbre de travail mais absent de l'entrée du fixeur.

**Verdict : À REPRENDRE, corrections courtes.** Le défaut critique est **fermé dans le code** : plus de valeur par défaut, refus en production, plus de réélévation du compte, plus de mot de passe dans les journaux, CI de détection en place. Restent trois exigences : une réélévation résiduelle des rôles de workspace par `upsert`, un compte Firebase recréé pour un compte MySQL existant, et deux trous dans le test des journaux.

### Vérifications refaites par l'architecte

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **82/82 suites, 2377/2377 tests** |
| `nest build` ; `tsc --noEmit -p tsconfig.build.json` ; Prettier et ESLint (`seed.ts`, `seed.spec.ts`, `ci.yml`) ; `pnpm lint` racine | exit 0 ; exit 0 ; conforme, 0 problème ; **0 erreur**, 53 avertissements préexistants |
| `printf '%s' '<valeur publiée>' \| sha256sum` pour les trois valeurs | identiques aux trois empreintes de `PUBLISHED_PASSWORD_SHA256` (`seed.ts:28-32`) |
| `env -i … npx tsx prisma/seed.ts` (aucune variable) | `NODE_ENV est obligatoire`, exit 1 (le point d'entrée `require.main === module` fonctionne bien sous `tsx`) |
| Idem avec `NODE_ENV=production` et trois mots de passe valides, sans drapeau | `Refusé en production sans SEED_ALLOW_PRODUCTION=true`, exit 1 |
| Idem avec `NODE_ENV=development` et `SEED_ADMIN_PASSWORD` égal à une valeur publiée | `valeur publiée dans le dépôt, refusée`, exit 1 |
| Idem avec des valeurs valides, sans `DATABASE_URL` | `DATABASE_URL est obligatoire`, exit 1, aucune connexion tentée |
| Registre `ghcr.io/v2/gitleaks/gitleaks/manifests/v8.21.2` | `docker-content-digest: sha256:0e99e882…a7f46`, **identique** à l'empreinte de `ci.yml` |
| Gitleaks (image épinglée, `detect --no-git -c .gitleaks.toml`) sur la copie de l'arbre | **exit 0, aucune fuite** : le job ne bloque pas à tort |
| Étape `git grep` de `ci.yml`, lancée telle quelle | exit 1 (rien trouvé) : l'étape passe |

### Contre-mutations du seed

| ID | Mutation | Résultat |
| --- | --- | --- |
| A1 | Valeur par défaut rétablie : `SEED_ADMIN_PASSWORD` facultatif, repli sur une valeur fixe | **Détectée** |
| A2 | Valeur par défaut rétablie, égale à une valeur publiée (écrite par concaténation), contrôle des variables manquantes supprimé | Survit, mais **mutant équivalent** : la liste de refus par empreinte rejette la valeur avant toute écriture (`SEED_ADMIN_PASSWORD : valeur publiée`) |
| B | `platformRole: SUPER_ADMIN` attribué aussi en production | **Détectée** |
| B2 | Drapeau `SEED_ALLOW_PRODUCTION` ignoré | **Détectée** |
| C1 | Compte existant : `prisma.user.update` (rôle et `passwordHash`) | **Détectée** |
| C2 | Compte existant : retour à un `upsert` qui réattribue le rôle | **Détectée** |
| C3 | Compte existant : objet renvoyé modifié en place (`isSuspended: false`, rôle) | Survit. Mutant sans écriture réelle, mais il révèle une faiblesse du test : `users[0]` **est** l'objet `existing` (même référence), donc `toEqual(existing)` est toujours vrai |
| D1 | Mot de passe ajouté au `console.log` de fin | **Détectée** |
| D2 | `console.warn(err)` dans le `catch` Firebase (l'erreur simulée contient `SEED_USER_PASSWORD`) | **Survit** : `JSON.stringify` d'un `Error` donne `{}`, le message n'est jamais inspecté |
| D3 | Mots de passe dans l'avertissement de production de `main()` | **Survit** : le test des journaux ne passe que par `runSeed` en développement |
| F1 | Compte Firebase existant : `updateUser({ password, emailVerified })` et rattachement | **Détectée** |

### Revue de la remédiation S30, point par point

| Point de la remédiation | Statut | Preuve |
| --- | --- | --- |
| 1. Aucune valeur par défaut ; arrêt avant toute écriture | **Conforme** | `resolveSeedConfig` (`seed.ts:45-87`) valide tout avant `createPrismaClient` et `initFirebaseAuth` (`main`, `:157-170`) ; A1 détectée |
| 2. `NODE_ENV` obligatoire ; production seulement avec `SEED_ALLOW_PRODUCTION=true` ; aucun `platformRole` en production ; `DATABASE_URL` obligatoire | **Conforme** | `:46-52`, `:74-79`, `:92-95`, `:235` ; liste fermée de `NODE_ENV` (une faute de frappe est refusée) ; B et B2 détectées ; CLI vérifiée |
| 3. Au moins 16 caractères, valeurs publiées refusées, valeurs différentes entre elles | **Conforme** | `:58-72` |
| 4. Pas d'élévation à la réexécution | **Partiel** | Comptes `User` conformes (`findUnique` puis `create`, C1 et C2 détectées). Mais `membership.upsert` (`seed.ts:271-287`) et `projectMembership.upsert` (même section, projet de démonstration) ont des branches `update: { role: OWNER, ADMIN, MEMBER, MANAGER, CONTRIBUTOR }`. Une réexécution **restaure les rôles** des comptes du seed dans le workspace « Planner Pro Entreprise », même si l'exploitation les avait rétrogradés. → **S30-a** |
| 5. Firebase : aucun compte existant modifié ; synchronisation coupée en production sauf drapeau | **Conforme, avec une réserve** | `:131-160`, `:84` ; F1 détectée. Réserve : `ensureFirebaseAuthUser` est appelé **avant** de savoir si le compte MySQL existe (`:180-198`). Si l'exploitation a supprimé le compte Firebase (action 1 de S30) mais pas le compte MySQL, le seed **recrée** un compte Firebase avec `emailVerified: true`, sans le rattacher. Ce n'est pas exploitable (la connexion Firebase répond 409), mais le seed recrée une identité que l'exploitation a retirée. → **S30-c** |
| 6. Aucun secret dans les journaux | **Code conforme, test insuffisant** | Aucun journal ne contient de mot de passe, et le `catch` n'affiche plus l'erreur brute (`:156-159`). Mais D2 et D3 survivent. → **S30-b** |
| 7. Analyse de secrets en CI | **Conforme**, réserves non bloquantes | Voir « Job `secrets-scan` » |

### Les 8 tests attendus

| Test attendu (r23) | Statut |
| --- | --- |
| Variable absente : arrêt, aucune écriture en base ni appel Firebase | Présent (`mariaDb` et `getAuth` non appelés) |
| `NODE_ENV` absent : refus | Présent |
| Production sans drapeau : refus ; avec drapeau : aucun `platformRole` | Présent (et `firebaseSync=false` vérifié) |
| Valeur publiée ou moins de 16 caractères : refus | Présent (trois valeurs, deux variables ; plus le cas des valeurs identiques) |
| Compte existant suspendu et sans rôle : inchangé | Présent mais **faible** (C3, même référence d'objet). → S30-b |
| Compte Firebase existant : pas de `updateUser` avec mot de passe | Présent |
| Aucun `console.*` ne contient un `SEED_*_PASSWORD` | Présent mais **incomplet** (D2, D3). → S30-b |
| `seed.ts` ne contient plus les trois valeurs | Présent (ainsi que l'absence de `root_password` et de `SEED_*_PASSWORD ||`) |

### Job `secrets-scan`

- **Épinglage : conforme.** `actions/checkout` est épinglé par SHA. L'image gitleaks est épinglée par empreinte, et j'ai vérifié sur `ghcr.io` que cette empreinte est celle de l'index multi-architecture `v8.21.2`. `--redact` évite d'afficher un secret dans les journaux de la CI.
- **Pas de blocage à tort : vérifié.** Sur l'arbre propre, exit 0. Sondes :

| Sonde | Résultat |
| --- | --- |
| Valeur publiée dans un fichier ordinaire | exit 7 (bloqué) |
| Valeur publiée dans un document de `docs/security/` autre que le rapport et le journal | exit 7 (bloqué) |
| Jeton GitHub factice `ghp_…` dans `backend/src/` | exit 7 (bloqué) |
| Même jeton dans `backend/tests/` | **exit 0 (non détecté)** |
| Même jeton dans `.github/workflows/ci.yml` | **exit 0 (non détecté)** |

- **Allowlist trop large (S30-d, non bloquant).** Sans les exceptions `backend/tests/` et `ci.yml`, gitleaks remonte **14 détections**, toutes `generic-api-key`, dans 12 fichiers de tests et dans `ci.yml`. Ces exceptions sont justifiées, mais elles excluent **tout** secret de ces chemins. Or `ci.yml` est précisément un endroit où l'on colle un vrai jeton par erreur.
- **Limite de `--no-git` (S30-e, non bloquant).** L'analyse ne voit que l'état final de l'arbre. Un secret ajouté puis retiré dans la même PR, qui reste donc dans l'historique public, n'est pas détecté. Acceptable comme premier niveau. À compléter par une analyse de la plage de commits de la PR.
- **Permissions (S30-f, non bloquant).** Le workflow ne déclare pas `permissions:`. Le `GITHUB_TOKEN` hérite donc des droits par défaut du dépôt. Ajouter `permissions: { contents: read }` au niveau du workflow.

### Exigences pour lever « À REPRENDRE »

1. **S30-a (bloquant, réélévation résiduelle)** : dans `seed.ts`, les `membership.upsert` et `projectMembership.upsert` passent à `update: {}` (ou `findUnique` puis `create`). Une adhésion existante n'est jamais modifiée. **Test** : une adhésion existante d'`admin@` en `VIEWER` reste `VIEWER` après le seed, et aucun `upsert` n'a de branche `update` non vide (vérification sur `mock.calls`).
2. **S30-b (bloquant, tests)** :
   - le test des journaux sérialise les arguments avec `util.inspect` (ou `String(arg)` et `arg.message`), et non `JSON.stringify`. La mutation D2 doit le faire échouer ;
   - ajouter un cas `main({ NODE_ENV: 'production', SEED_ALLOW_PRODUCTION: 'true', … })`, avec `runSeed` ou le client Prisma simulé, qui vérifie que l'avertissement de production ne contient aucun mot de passe. La mutation D3 doit le faire échouer ;
   - dans le test « compte existant », comparer à une copie profonde prise **avant** l'exécution (`structuredClone(existing)`). La mutation C3 doit le faire échouer.
3. **S30-c (bloquant, court)** : ne créer un compte Firebase que pour un compte MySQL **créé** dans la même exécution. Un compte MySQL existant ne déclenche aucun appel `createUser`. **Test** : compte MySQL existant et compte Firebase absent (`auth/user-not-found`) : `createUser` n'est pas appelé.

### Points non bloquants

- **S30-d** : remplacer les exceptions par chemin `backend/tests/` et `ci.yml` par des exceptions ciblées : `[allowlist] regexes` sur les valeurs factices réellement utilisées (préfixe commun du type `test-`), ou `.gitleaksignore` par empreinte. **Critère** : un `ghp_…` réaliste ajouté dans `backend/tests/` ou dans `ci.yml` donne exit 7, et l'arbre actuel donne exit 0.
- **S30-e** : sur `pull_request`, ajouter `gitleaks git --log-opts="<base>..<head>"` (avec `fetch-depth: 0`) pour analyser chaque commit de la PR.
- **S30-f** : `permissions: { contents: read }` dans `ci.yml`.
- **Rôle en préproduction (accepté)** : hors production, `staging` compris, `admin@` reçoit `SUPER_ADMIN` à la création. C'est acceptable : mot de passe fourni d'au moins 16 caractères, MFA exigée sur `/admin/*` (S18.3). Si la préproduction est exposée sur Internet, préférer `SEED_GRANT_SUPER_ADMIN=true` explicite (Amélioration).
- **`README.md`** : modifié dans l'arbre de travail, mais absent de l'entrée S30. À rattacher à son auteur avant le commit, ou à committer à part. Il ne contient aucune des valeurs publiées.

### Réponses aux questions du fixeur

1. **Empreintes SHA-256 : VALIDÉ.** Elles concilient bien la liste de refus et une source sans les valeurs. Une empreinte non salée est suffisante ici, puisque les valeurs sont déjà publiques : l'empreinte ne protège rien, elle évite seulement de republier les valeurs en clair et de déclencher la règle gitleaks. J'ai recalculé les trois empreintes : elles correspondent.
2. **Docker épinglé par empreinte plutôt que binaire avec somme : VALIDÉ, garder Docker.** L'empreinte d'image est une adresse de contenu, vérifiée par le moteur Docker au téléchargement. Une somme de contrôle téléchargée depuis la même page de version n'apporte pas plus de garantie. Seule condition : quand la version de gitleaks change, mettre à jour l'empreinte et vérifier qu'elle correspond au tag sur `ghcr.io`, dans la même PR.
3. **Actions d'exploitation : confirmé, elles restent à la charge de l'utilisateur** et aucun code ne peut les couvrir. Liste à jour :
   - désactiver ou supprimer dans Firebase Authentication de production les comptes `admin@`, `manager@` et `user@planner-pro.com`, et révoquer leurs jetons de rafraîchissement ;
   - remonter à partir du 2026-10-27 : connexions réussies, MFA enrôlée sur `admin@` (`mfaEnabled`, `mfaPendingSecret`), actions d'administration, clés SCIM, intégrations, invitations, liaisons GitHub ou Firebase. Tout résultat positif est un incident ;
   - vérifier les autres environnements (préproduction, démo) et les fichiers `.env` des serveurs : aucune des trois valeurs ne doit y figurer ;
   - ne jamais relancer le seed contre la production. Si un compte de démonstration doit un jour exister en production, le créer par un script dédié et audité, pas par le seed.

### Statut des constats

| ID | Statut r24 |
| --- | --- |
| **S30** (code) | **À REPRENDRE** : S30-a, b et c bloquants ; d, e et f non bloquants. Le risque critique est fermé dans le code |
| S30 (exploitation) | actions 1 à 4 à la charge de l'utilisateur, non confirmées |
| S31 | ouvert (après S30) |

**Constats ouverts à la fin de r24 :**

- **Immédiat, dans l'ordre : S30** (S30-a à c ; actions d'exploitation), **puis S31**.
- Phase 1 : P9 (liaison GitHub et Firebase, qui dépend de S31 ; sessions actives ; « Connecter un dépôt »).
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O17.

## Revue r25 — S30 (reprise S30-a à f) : VALIDÉ (2026-11-05)

Revue de la section « Reprise r24 (fixeur) — S30-a à f » du journal. Le code a été relu et les suites relancées. 12 contre-mutations du seed ont été jouées par un script hors dépôt (sauvegarde, substitutions dont l'unicité est vérifiée, restauration vérifiée par `filecmp`, `git status` identique avant et après). Gitleaks a été exécuté avec l'image épinglée (`v8.21.2`, confirmée par `gitleaks version`), en mode `--no-git` sur une copie de l'arbre, et en mode `git` sur un clone jetable. Dans ce clone, j'ai simulé la PR S30 par un commit des fichiers du lot, puis ajouté des commits de sonde. Aucun commit dans le dépôt ; `.claude/` non touché. Hors revue : `README.md` et `backend/src/auth/scim/scim.guard.ts` (modifications de l'utilisateur).

**Verdict final : S30 VALIDÉ côté code, bon pour le commit.** Il n'y a pas de déploiement : le seed ne tourne pas en production. Les actions d'exploitation 1 à 4 restent à la charge de l'utilisateur.

### Vérifications refaites par l'architecte

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **82/82 suites, 2380/2380 tests** |
| `nest build` ; `tsc --noEmit -p tsconfig.build.json` ; Prettier (`seed.ts`, `seed.spec.ts`, `ci.yml`) ; `pnpm lint` racine | exit 0 ; exit 0 ; conforme ; **0 erreur**, 53 avertissements préexistants |
| `detect --no-git` sur l'arbre de travail complet (`README.md` et `scim.guard.ts` compris) | exit 0 |
| Étape `git grep` des valeurs publiées | exit 1 (rien trouvé) : l'étape passe |

### Contre-mutations (15 tests dans `seed.spec.ts`)

| ID | Mutation | Résultat |
| --- | --- | --- |
| C3 | Compte existant modifié en place (`isSuspended: false`, rôle) | **Détectée** (copie profonde par `structuredClone`) |
| D2 | `console.warn(err)` dans le `catch` Firebase | **Détectée** (`util.inspect`) |
| D2b | `console.error('Firebase', err.message)` | **Détectée** |
| D3 | Mot de passe dans l'avertissement de production de `main()` | **Détectée** |
| S30-a (×3) | `update: { role }` rétabli sur l'adhésion OWNER d'`admin@`, MEMBER de `user@`, et l'adhésion de projet MANAGER | **Détectées** (chacune isolément) |
| S30-c | `ensureFirebaseAuthUser` appelé pour un compte MySQL existant | **Détectée** |
| S30-c bis | Appel Firebase replacé avant le `findUnique` (ordre de r24) | **Détectée** |
| Non-régression : A1 (valeur par défaut), B (`SUPER_ADMIN` en production), D1 (mot de passe dans le journal de fin) | — | **Détectées** |

### Nouvel `.gitleaks.toml` (S30-d) : conforme

- Les exceptions par chemin pour `backend/tests/` et `ci.yml` sont supprimées. Il ne reste que le rapport et le journal (documentation de S30). Quatre expressions régulières, ancrées `^…$`, ne visent que les valeurs factices connues.
- Sondes :

| Sonde | Résultat |
| --- | --- |
| Arbre actuel | exit 0 |
| `ghp_…` réaliste dans `backend/tests/` | **exit 7** |
| Même jeton dans `.github/workflows/ci.yml` | **exit 7** |
| Valeur factice `test-secret-…-0123456789…` | exit 0 (admise) |
| Ligne mêlant une valeur factice et un vrai jeton | **exit 7** : l'ancrage empêche qu'une valeur factice masque un secret voisin |

### Étape `gitleaks git` sur PR (S30-e) : conforme

- **Plage `base..tête`** : sur le clone, la PR S30 simulée (`HEAD~1..HEAD`) donne exit 0. Le commit retire des lignes contenant les valeurs publiées, mais gitleaks n'analyse que les ajouts, et le rapport et le journal sont exclus. Un commit qui ajoute un `ghp_` dans `backend/tests/` donne **exit 7**. Un ajout puis un retrait dans la même PR donne aussi **exit 7**, alors que `--no-git` ne le voit pas : la limite de r24 est couverte. Pour comparaison, l'historique complet (`--all`, 160 commits) donne exit 7 avec 3 détections, toutes dans `c5835ef` (`seed.ts`, 2026-10-27). Cela confirme que limiter la plage est **nécessaire** pour ne pas bloquer toutes les PR.
- **`fetch-depth: 0`** : nécessaire et suffisant pour que `base.sha` et `head.sha` soient présents, y compris pour une PR venant d'un fork (`head.sha` est un parent de `refs/pull/N/merge`).
- **`safe.directory`** : l'image tourne en `root` (vérifié avec `id`), alors que l'espace de travail du runner appartient à l'utilisateur `runner`. Sans `safe.directory`, Git refuserait le dépôt (« dubious ownership ») et l'étape échouerait à tort. Le passage par `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0` et `GIT_CONFIG_VALUE_0` est correct (Git 2.43.5 dans l'image). Je n'ai pas pu reproduire ce refus en local, car le Docker de ce poste fait correspondre `root` à l'utilisateur de l'hôte. **À confirmer à la première PR** : l'étape doit afficher « N commits scanned » et exit 0.
- **Risque de blocage à tort : faible.** Si `base.sha` est en retard et que la branche a fusionné `main` depuis, la plage inclut des commits de `main` déjà analysés. Ils ne contiennent rien de bloquant aujourd'hui (le seul historique fautif, `c5835ef`, est antérieur à toute base possible). Amélioration possible : `--log-opts="$(git merge-base <base> <tête>)..<tête>"`.
- **Injection** : `${{ github.event.pull_request.base.sha }}` et `head.sha` sont des empreintes hexadécimales, que l'auteur d'une PR ne peut pas choisir librement. Il n'y a pas d'injection de script. Bonne pratique (Amélioration) : les passer par `env:` plutôt que dans `run:`.
- **S30-f** : `permissions: { contents: read }` au niveau du workflow. Conforme.

### Points non bloquants restants

- Confirmer l'étape `gitleaks git` à la première PR réelle (voir plus haut).
- Améliorations : `merge-base` pour la plage, valeurs SHA passées par `env:`, `dir` à la place de `detect --no-git` au prochain changement de version de gitleaks (`detect` est déprécié depuis la v8.19, mais fonctionne en v8.21.2).
- **Commit** : committer le lot S30 (`backend/prisma/seed.ts`, `backend/tests/unit/scripts/seed.spec.ts`, `.gitleaks.toml`, `.github/workflows/ci.yml`, le rapport et le journal) **sans** `README.md` ni `scim.guard.ts`, qui ne sont pas revus, et sans `.claude/`.

### Statut des constats

| ID | Statut r25 |
| --- | --- |
| **S30** (code et CI) | **VALIDÉ** (S30-a à f) |
| S30 (exploitation) | actions 1 à 4 à la charge de l'utilisateur, non confirmées à ce jour : comptes Firebase de production, investigation depuis le 2026-10-27, autres environnements et fichiers `.env`, ne jamais relancer le seed en production |
| **S31** | ouvert, **suivant dans l'ordre** |

**Constats ouverts à la fin de r25 :**

- Immédiat : S31 (Majeur, CVSS 6.8, avec la correction de `deployment-production.md:68-71`) ; actions d'exploitation de S30.
- Phase 1 : P9 (liaison GitHub et Firebase, qui dépend de S31 ; sessions actives ; « Connecter un dépôt »).
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O17.

## Revue r26 — S31 (liaison d'identités avec réauthentification) : VALIDÉ (2026-11-05)

Revue de l'entrée « S31 — Liaison d'identités externes sans réauthentification » du journal (≈ l. 2693). Le rapport chiffré du fixeur ne m'étant pas parvenu, j'ai relancé toutes les mesures moi-même. Le code a été relu. 14 contre-mutations ont été jouées par un script hors dépôt (sauvegarde, substitutions dont l'unicité est vérifiée, restauration vérifiée par `filecmp`, `git status` identique avant et après). La migration a été comparée au différentiel de schéma calculé par Prisma. Aucun commit, aucune base touchée ; `.claude/` non touché. Hors revue : `README.md` et `backend/src/auth/scim/scim.guard.ts` (modifications de l'utilisateur).

**Verdict : S31 VALIDÉ, bon pour le commit et le déploiement en production**, aux conditions indiquées en fin de section. Un constat Mineur non bloquant (**S31-a**), à traiter avec l'écran de liaison de P9.

### Mesures (relancées par l'architecte)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **83/83 suites, 2421/2421 tests** |
| `nest build` ; `tsc --noEmit -p tsconfig.build.json` ; `prisma validate` | exit 0 ; exit 0 ; schéma valide |
| Prettier (`src/auth`, `src/mail`, `tests/unit/auth`, `tests/http`, `prisma/schema`) ; `pnpm lint` racine | conforme ; **0 erreur**, 53 avertissements préexistants |
| `cd frontend && pnpm test:run` ; `tsc --noEmit -p .` ; `pnpm build` | **77/77** ; exit 0 ; build OK |
| `prisma migrate diff --from-schema <schéma de HEAD> --to-schema prisma/schema --script` | exactement `ALTER TABLE User ADD COLUMN firebaseEmail VARCHAR(191) NULL;`, **identique** à `migration.sql` |
| `grep -n "associe alors" docs/deployment-production.md` | **vide** (exit 1) |

### Conformité aux conditions 1 à 5 (« Ajout r23-bis »)

| Condition | Statut | Preuve |
| --- | --- | --- |
| 1. Réauthentification récente pour lier : mot de passe, ou connexion de moins de 5 min, plus le second facteur si la MFA est active ; avant toute écriture ; pour GitHub, avant l'échange du code | **Conforme** | `assertIdentityReauth` (`auth.service.ts`, après `getMfaStatus`) appelle `assertReauthenticated`, puis `verifyCurrentFactor` si `mfaEnabled`, ce qui consomme le pas de temps. Firebase : avant `verifyIdToken`. GitHub : `verifyGithubOAuthState` (local), puis réauthentification, puis `fetchGitHubIdentity`. Preuve dans le corps (`FirebaseLinkDto`, `GithubLinkDto`, `IdentityReauthDto` ; `mfaCode` distinct du `code` OAuth) |
| 2. Notification au titulaire et entrée d'audit | **Conforme** | `recordIdentityChange` : `AuditLog` `IDENTITY_LINKED` ou `IDENTITY_UNLINKED` (fournisseur, identifiant affichable, `sid`, aucun secret) ; `sendIdentityLinkedEmail` et `sendIdentityUnlinkedEmail` (identifiant échappé en HTML, aucun jeton) ; envoi au mieux |
| 3. Déliaison : mêmes protections ; refus de la dernière méthode ; `githubAccessToken` effacé ; autres sessions révoquées | **Conforme**, réserve S31-a | `POST /auth/firebase/unlink` et `/auth/github/unlink` : 204, `@ForbiddenInImpersonation()`, 5/min ; 409 si non lié ; 409 s'il n'existe ni `passwordHash`, ni autre identité, ni `ssoUid` ; `revokeAllForUser(userId, sid)`. Balayage méta S18.2 étendu à `/(un)?link$/` |
| 4. Protections existantes conservées | **Conforme** | 409 si l'identité est liée ailleurs ; e-mail Firebase vérifié exigé ; aucune liaison par e-mail (`loginWithFirebase` et `loginWithGitHub` inchangés) ; aucun `createUser` Firebase |
| 5. Adresse liée affichée | **Conforme (côté API)** | `firebaseEmail` est conservé à la liaison et renvoyé par `linkFirebaseAccount` et `GET /auth/identities`. L'affichage avant confirmation relève de l'écran de P9 |

### Contre-mutations

Jouées sur `identity-linking.spec.ts`, `impersonation-routes.spec.ts`, `github-oauth.spec.ts` et `auth.service.spec.ts` (144 tests).

| ID | Mutation | Résultat |
| --- | --- | --- |
| M1 | Réauthentification retirée de la liaison Firebase | **Détectée** (6 échecs) |
| M1b | Réauthentification retirée de la liaison GitHub | **Détectée** (6) |
| M1c | Réauthentification retirée de la déliaison | **Détectée** (8) |
| M2 | MFA non exigée (contrôle `mfaEnabled` neutralisé) | **Détectée** (8). Une première forme (`if (false && …)`) ne compilait pas et a été remplacée |
| M3 | Échange du code GitHub fait **avant** la réauthentification | **Détectée** (5) |
| M4 | Retrait de la dernière méthode autorisé | **Détectée** (2) |
| M4b | L'identité à délier compte comme « autre méthode » | **Détectée** (2) |
| M5 | Sessions non révoquées après une déliaison | **Détectée** (2) |
| M5b | Session courante révoquée elle aussi | **Détectée** (2) |
| M6 | `@ForbiddenInImpersonation` retiré de `github/unlink` | **Détectée** (2) |
| M6b | Idem sur `firebase/unlink` | **Détectée** (2) |
| M7 | Pas d'audit ni de notification à la liaison Firebase | **Détectée** (1) |
| M8 | `githubAccessToken` conservé à la déliaison | **Détectée** (1) |

### Migration `20261113000000_s31_firebase_email`

- **Nature** : une seule instruction, `ALTER TABLE User ADD COLUMN firebaseEmail VARCHAR(191) NULL`. Additive, nullable, sans valeur par défaut, sans index ni contrainte. Elle correspond exactement au différentiel de schéma calculé par Prisma.
- **Impact en production (MySQL 8.0, `docker-compose.prod.yml:5`)** : l'ajout d'une colonne nullable en fin de table est traité en `ALGORITHM=INSTANT` (MySQL ≥ 8.0.12). La table n'est pas reconstruite et aucune ligne n'est réécrite. La durée ne dépend pas de la taille de `User` : de l'ordre de la seconde. Seul effet : un **verrou de métadonnées bref**, qui attend la fin des transactions en cours sur `User`. Une transaction longue, ou une session SQL interactive restée ouverte sur `User`, ferait patienter la migration **et** les requêtes suivantes sur `User` (connexions, sessions). Les données existantes ne sont pas modifiées : les liaisons Firebase existantes ont `firebaseEmail = NULL`, affiché « adresse inconnue » jusqu'à une nouvelle liaison.
- **Réversibilité** : la migration est réversible, et le retour arrière du code n'exige **pas** de la défaire. L'ancienne image du backend fonctionne avec la colonne présente (son client Prisma ne la connaît pas et ne la sélectionne pas). Pour la supprimer quand même : `ALTER TABLE User DROP COLUMN firebaseEmail` (aussi instantané en 8.0.29 et plus), puis suppression de la ligne correspondante dans `_prisma_migrations`. **Déconseillé** : les adresses liées depuis seraient perdues.
- **Application** : automatique au démarrage (`docker-compose.prod.yml:50`, `prisma migrate deploy && node dist/main`). **Aucun script de reprise n'est nécessaire.** Un runbook complet n'est pas nécessaire non plus, mais les vérifications avant et après ci-dessous doivent être faites. Remplir `firebaseEmail` par l'Admin SDK pour les liaisons existantes est **facultatif** : simple confort d'affichage, à ne faire qu'en lecture côté Firebase.

### Contrat d'API et frontend

- `frontend/src/github-oauth.ts:36-47` (`linkGitHub`) envoie encore `{ code, state }` seulement, et `App.tsx:113-118` l'appelle au retour de GitHub quand la finalité signée vaut `link` ou `repos`. Avec S31, cet appel renvoie **403** (« Le mot de passe est requis… »), affiché par `setOauthError`.
- **Pas de régression visible** : aucun écran ne démarre une autorisation `link` ou `repos`. Les seuls appels à `startGitHubAuthorization` (`Login.tsx:90`, `InvitationAcceptance.tsx:57`) utilisent la finalité par défaut `login`, dont le parcours est inchangé. Le frontend n'appelle jamais `/auth/firebase/link`. Ce chemin dormant échoue désormais en refusant, ce qui est le comportement voulu.
- **Exigence reportée sur P9 (écran de liaison)** :
  - au retour de GitHub avec la finalité `link` ou `repos`, demander le mot de passe (ou s'appuyer sur la connexion récente), plus `mfaCode` ou `recoveryCode` si la MFA est active, puis appeler `/auth/github/link` avec `{ code, state, password?, mfaCode?, recoveryCode? }` ;
  - mettre à jour `linkGitHub` et son test.

### Nouveau constat r26

#### S31-a : condition de course entre deux déliaisons simultanées (dernière méthode)

- **Fichier** : `backend/src/auth/auth.service.ts`, `unlinkIdentity` : lecture par `loadIdentityAccount`, contrôle `otherMethods`, puis `prisma.user.update` non conditionnel.
- **Cause** : le contrôle « il reste une autre méthode de connexion » est fait sur une lecture, puis l'écriture n'est pas conditionnée. Prenons un compte sans mot de passe, lié à Firebase **et** à GitHub, sans MFA, avec une connexion de moins de 5 min. Deux requêtes simultanées `firebase/unlink` et `github/unlink` lisent chacune l'autre identité comme encore liée, et réussissent toutes les deux. Le compte se retrouve sans méthode de connexion, contrairement au critère d'acceptation de S31. Avec la MFA, le pas de temps TOTP consommé fait échouer la seconde requête si elle réutilise le même code.
- **Impact** : verrouillage du compte par son propre titulaire, ou par un attaquant qui a **déjà** passé la réauthentification. Le compte reste récupérable par « Mot de passe oublié », qui pose un `passwordHash` (`resetPassword`). Aucune élévation possible.
- **Sévérité** : Mineur. CVSS 3.1 : 2.6 (AV:N/AC:H/PR:L/UI:R/S:U/C:N/I:N/A:L).
- **Remédiation attendue (avec l'écran de liaison de P9)** : écriture conditionnelle et atomique, par exemple `updateMany({ where: { id, OR: [{ passwordHash: { not: null } }, { ssoUid: { not: null } }, { <autre identité>: { not: null } }] }, data })`. Si `count === 0`, répondre 409 (ou faire la lecture et l'écriture dans une transaction avec `SELECT … FOR UPDATE`). **Test** : deux `unlinkIdentity` lancés par `Promise.all` sur un compte à deux identités et sans mot de passe : une seule réussit, l'autre donne 409, et il reste une identité.

### Points non bloquants

- **`ssoUid` comme « autre méthode »** : un `ssoUid` ancien ne garantit pas que le SSO du domaine est toujours actif. Le risque reste couvert par la récupération par « Mot de passe oublié ». Amélioration : vérifier aussi qu'une configuration SSO active existe pour le domaine.
- **Remplacement d'une identité déjà liée** : `link` remplace sans prévenir un `firebaseUid` ou un `githubId` déjà lié au même compte. La notification « liée » part, mais pas une notification « déliée » pour l'ancienne identité. Amélioration : envoyer les deux, ou exiger une déliaison préalable (409).
- **`idToken`** : `FirebaseLinkDto` n'a pas de `MaxLength`. Ajouter `@MaxLength(4096)`, comme pour les autres champs (cohérent avec S23).

### Réponses aux questions du fixeur

1. **Mot de passe dans le corps plutôt que `POST /auth/reauth` : VALIDÉ.** C'est l'une des deux options prévues au rapport. Elle est sans état, atomique et liée à l'action exacte. Le mot de passe ne transite que dans le corps HTTPS de cette requête et n'est jamais stocké côté navigateur. La contrainte d'interface est reportée sur P9 (voir plus haut).
2. **Ordre GitHub (`state` local, puis réauthentification, puis échange du code) : VALIDÉ.** Un `state` invalide est rejeté sans consommer de code TOTP ni faire d'appel réseau. Contrepartie acceptable : si l'échange du code échoue après une réauthentification réussie, le pas de temps TOTP est consommé, et l'utilisateur attend le code suivant (30 s).
3. **`GET /auth/identities` : VALIDÉ.** Lecture seule, aucun jeton (`githubAccessToken` et `mfaSecret` ne sont pas renvoyés ; `mfaSecret` est lu pour la réauthentification seulement), réservée au compte connecté. Elle reste accessible en impersonation, comme `GET /auth/sessions`. C'est acceptable, puisque l'administrateur qui impersonne voit déjà le compte. La route est ajoutée à la remédiation de S31 comme source de l'affichage de la condition 5.

### Conditions de déploiement en production

1. **Commit** : lot S31 seulement, à savoir `backend/prisma/schema/auth.prisma`, la migration, `auth.controller.ts`, `auth.service.ts`, `auth.service.spec.ts`, `mail.service.ts`, `dto/identity.dto.ts`, `identity-linking.spec.ts`, `fake-prisma.ts`, `session-lifecycle.spec.ts`, `github-oauth.spec.ts`, `impersonation-routes.spec.ts`, `docs/deployment-production.md`, le rapport et le journal. **Sans** `README.md`, `scim.guard.ts` ni `.claude/`.
2. **Avant** :
   - sauvegarde de la base (procédure de sauvegarde existante) ;
   - vérifier dans `_prisma_migrations` les migrations déjà appliquées. Si `20261112000000_s17_invitation_project_role` (Phase 4) n'y figure pas, elle s'appliquera au même démarrage : suivre d'abord le runbook de la Phase 4 ;
   - vérifier qu'aucune transaction longue n'est ouverte sur `User` (`SHOW PROCESSLIST`, `information_schema.innodb_trx`).
3. **Pendant** : la migration s'applique automatiquement au démarrage du conteneur backend, en quelques secondes. Aucune action manuelle.
4. **Après** :
   - `SHOW COLUMNS FROM User LIKE 'firebaseEmail'` renvoie une ligne ;
   - `_prisma_migrations` contient `20261113000000_s31_firebase_email` avec `finished_at` non nul ;
   - la connexion par mot de passe, Firebase et GitHub fonctionne ;
   - un appel `POST /auth/firebase/link` sans mot de passe renvoie 403.
5. **Retour arrière** : redéployer l'image précédente, sans toucher à la colonne.
6. **SMTP** : les notifications de liaison partent par la configuration d'envoi existante. Un échec d'envoi n'empêche pas l'opération.

### Statut des constats

| ID | Statut r26 |
| --- | --- |
| **S31** | **VALIDÉ** |
| **S31-a** | Nouveau, Mineur (CVSS 2.6), avec l'écran de liaison de P9 |
| S30 (exploitation) | actions 1 à 4 à la charge de l'utilisateur, non confirmées |

**Constats ouverts à la fin de r26 :**

- Exploitation : actions 1 à 4 de S30.
- Phase 1 : P9 (liaison GitHub et Firebase, à construire sur le contrat S31 avec S31-a ; sessions actives ; « Connecter un dépôt »).
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O17.

## Revue r27 — S31-a et P9, volet liaison d'identités : S31-a VALIDÉ ; P9 (liaison) À REPRENDRE, points mineurs (2026-11-05)

Revue de la section « Reprise après r26 (fixeur) » du journal (≈ l. 2774). J'ai relu le code et relancé toutes les mesures moi-même. J'ai joué 14 contre-mutations par un script hors dépôt : sauvegarde, substitution dont l'unicité est vérifiée, restauration vérifiée par `filecmp`, puis `git status --porcelain` et `md5sum` identiques avant et après. Aucun commit, `.claude/` non touché. **Hors revue** : `frontend/src/components/InvitationAcceptance.tsx` et `frontend/src/components/Login.css` (modifications de l'utilisateur).

**Verdict** :

- **S31-a : VALIDÉ.**
- **P9, volet liaison : À REPRENDRE.** Il est **conforme aux exigences de sécurité** de r23-bis et r26 : aucune liaison sans preuve, adresse Firebase montrée avant validation, « Délier » protégé. Restent quatre points mineurs, P9-L-a à P9-L-d, plus un point facultatif (P9-L-e). Aucun ne crée de faille. L'écran peut être commité en l'état si l'utilisateur le souhaite, mais P9 (liaison) ne sera clos qu'après la reprise.

### Mesures (relancées par l'architecte)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **83/83 suites, 2424/2424 tests** |
| `nest build` ; `tsc --noEmit -p tsconfig.build.json` | exit 0 ; exit 0 |
| `cd frontend && pnpm test:run` | **19 fichiers, 96/96** |
| `tsc --noEmit -p .` ; `pnpm build` | exit 0 ; build OK |
| `pnpm lint` racine | **0 erreur**, 53 avertissements préexistants |
| Prettier sur les 14 fichiers du lot | conforme |

Les chiffres annoncés par le fixeur sont confirmés.

### S31-a : déliaison atomique

- `auth.service.ts:983-1002` : `updateMany`. Le `where` porte l'identité encore liée **et** un `OR` sur `passwordHash`, `ssoUid` ou l'autre identité. Si `count === 0`, l'appel lève un 409 **avant** la révocation des sessions, l'audit et la notification.
- Sous MySQL/InnoDB, un `UPDATE … WHERE` pose un verrou exclusif sur la ligne et réévalue la condition sur la dernière version validée. La seconde déliaison concurrente attend la première, puis ne trouve plus de ligne (`count = 0`). La remédiation demandée en r26 est atteinte.
- Effet de bord accepté : si la MFA est active, le pas de temps TOTP est déjà consommé quand l'écriture échoue. L'utilisateur attend le code suivant, comme en r26 (question 2).
- `fake-prisma.ts`, `undefined` traité comme `null` : la correction est juste et conforme à la sémantique SQL. En revanche, elle **ne porte pas** les tests S31-a, puisque la table `user` du faux initialise déjà `ssoUid`, `firebaseUid` et `githubId` à `null` (mutation B5, non détectée, équivalente). La correction est sans risque et je la conserve.
- Tests : la course `firebase` contre `github` sans mot de passe, la double déliaison de la même identité et le cas avec mot de passe sont pertinents. Les espions « aucune écriture » portent bien sur `updateMany`.

### P9, volet liaison : conformité aux exigences r23-bis (tests frontend) et r26 (contrat d'API)

| Exigence | Statut | Preuve |
| --- | --- | --- |
| Le retour GitHub `link`/`repos` demande la preuve **avant** `/auth/github/link` | **Conforme** | `App.tsx:123-129` : `setPendingGitHub`, plus d'appel direct. `GitHubLinkConfirm` envoie `{ code, state, password?, mfaCode?, recoveryCode? }`. Le code et le `state` sont retirés de l'URL (`replaceState`, testé) |
| `linkGitHub` mis à jour et testé | **Conforme** | `github-oauth.ts:42-66` : preuve fusionnée, champs vides omis, `SecurityApiError` avec statut. Deux tests |
| Adresse liée affichée avant confirmation, écart signalé | **Conforme pour Firebase** ; écart accepté pour GitHub (question 1) | `IdentitiesSection` : étape `confirm` avec l'adresse Firebase, avertissement insensible à la casse. Rien n'est envoyé avant la preuve. Le mot de passe Firebase n'est jamais transmis au backend, et la session Firebase du navigateur est refermée |
| « Délier » désactivé avec explication pour la dernière méthode | **Conforme**, réserve P9-L-a | `IdentitiesSection.tsx:143-145` : règle recalculée côté client, sans `ssoUid` |
| Aucune liaison automatique ; preuve jamais conservée | **Conforme** | La preuve vit dans l'état React et est remise à vide après l'envoi. Le jeton Firebase reste en mémoire jusqu'à la confirmation ou l'annulation |
| E-mail Firebase non vérifié refusé côté client (en plus du serveur) | **Conforme** | `reload` puis `emailVerified`, déconnexion de Firebase si l'adresse n'est pas vérifiée |

### Contre-mutations de l'architecte (distinctes de celles du fixeur)

Backend : `identity-linking.spec.ts` et `auth.service.spec.ts`. Frontend : `IdentitiesSection`, `GitHubLinkConfirm`, `App.github-return` et `github-oauth`.

| ID | Mutation | Résultat |
| --- | --- | --- |
| B1 | Retrait de la clause « identité encore liée » du `where` | **Détectée** (1) |
| B2 | Dans le `OR`, l'autre identité remplacée par l'identité à délier | **Détectée** (1) |
| B3 | `count === 0` ignoré | **Détectée** (2) |
| B4 | `ssoUid` retiré du `OR` | **Non détectée**. Aucun test ne couvre `ssoUid` comme autre méthode, ni en lecture ni en écriture. Voir P9-L-a |
| B5 | Correctif `fake-prisma` annulé | Non détectée, **équivalente** (valeurs par défaut `null` du faux) |
| F1 | Code de récupération envoyé comme `mfaCode` | **Détectée** (1) |
| F2 | « Délier » : l'autre identité n'est plus prise en compte | **Détectée** (1) |
| F3 | Comparaison des adresses sensible à la casse | **Détectée** (1) |
| F4 | Session Firebase du navigateur non refermée après l'obtention du jeton | **Détectée** (1) |
| F5 | Déliaison envoyée sans preuve | **Détectée** (1) |
| F6 | « Lier GitHub » avec la finalité `login` | **Détectée** (1) |
| F7 | Adresse du compte absente de la confirmation GitHub | **Détectée** (3) |
| F8 | « Recommencer avec GitHub » relancé avec la finalité `login` au lieu de la finalité d'origine | **Non détectée**. Voir P9-L-d |
| F9 | E-mail Firebase non vérifié accepté côté client | **Détectée** (1) |

### Points à reprendre (P9, volet liaison)

#### P9-L-a (Mineur) : la règle « dernière méthode » est dupliquée côté client et ignore `ssoUid`

- **Fichiers** : `frontend/src/components/IdentitiesSection.tsx:143-145` ; `backend/src/auth/auth.service.ts:969-977` (lecture), `:983-993` (écriture) et `:1014-1022` (`getIdentities`).
- **Cause** : le client recalcule la règle à partir de `hasPassword` et de l'autre identité. Le serveur compte en plus `ssoUid`.
- **Impact** : prenons un compte SSO lié à GitHub, sans mot de passe. Le client lui refuse « Délier », alors que le serveur l'autoriserait : déni fonctionnel. La règle existe en deux endroits, et toute évolution (par exemple le point non bloquant r26 « vérifier qu'une configuration SSO active existe ») divergera. Côté backend, aucun test ne couvre `ssoUid` (mutation B4).
- **Remédiation attendue** :
  - extraire, dans `auth.service.ts`, une fonction unique `hasOtherLoginMethod(account, provider)`, utilisée par `unlinkIdentity` (contrôle en lecture) et par `getIdentities` ;
  - `getIdentities` renvoie `canUnlink: { firebase: boolean, github: boolean }`. La valeur est vraie seulement si l'identité est liée **et** s'il reste une autre méthode. Les champs `ssoUid` et `ssoProvider` ne sont pas exposés ;
  - le frontend utilise `identities.canUnlink[provider]` et ne recalcule plus la règle (type `Identities` mis à jour) ;
  - pas de booléen `hasSso` : voir la question 3.
- **Tests attendus** :
  - backend (`identity-linking.spec.ts`) : un compte sans mot de passe, avec `ssoUid` et GitHub lié, obtient `canUnlink.github === true`, et `unlinkIdentity('github')` réussit (champ remis à `null`) ;
  - backend : un compte sans mot de passe ni `ssoUid`, avec une seule identité, obtient `canUnlink === false` pour cette identité ;
  - la mutation B4 (retrait de `ssoUid` du `OR`) doit être détectée ;
  - frontend : avec `hasPassword: false`, une seule identité et `canUnlink.github: true`, le bouton est actif ; avec `canUnlink.github: false`, il est désactivé avec l'explication.

#### P9-L-b (Mineur) : état MFA périmé dans `IdentitiesSection`

- **Fichiers** : `IdentitiesSection.tsx:57-59`, une seule lecture au montage ; `App.tsx:206-212`, où `SecurityPage` et `IdentitiesSection` sont frères et ne partagent aucun état.
- **Cause** : quand l'utilisateur active (ou désactive) la MFA dans `SecurityPage`, puis délie ou lie Firebase sur le même écran, `IdentitiesSection` utilise encore l'ancien `mfaEnabled`.
- **Impact** : si la MFA vient d'être activée, le champ du code n'est pas affiché. Le serveur répond 400 (code requis) et l'utilisateur reste bloqué jusqu'au rechargement de la page. Dans l'autre sens, un champ inutile est demandé. Pas de faille, puisque le serveur reste l'autorité.
- **Remédiation attendue** : relire `getIdentities()` à l'ouverture de chaque formulaire de preuve (clic sur « Délier », passage à l'étape `confirm` de Firebase), avant d'afficher les champs. Autre solution acceptée : remonter l'état dans un parent commun et le rafraîchir après chaque action MFA.
- **Test attendu** : la première réponse de `/auth/identities` a `mfaEnabled: false`, la seconde `mfaEnabled: true`. Après le clic sur « Délier », le champ « Code à 6 chiffres » est affiché et le code est envoyé dans `mfaCode`.

#### P9-L-c (Mineur) : la notice de liaison réapparaît à chaque visite de l'onglet

- **Fichier** : `App.tsx:94`, `:176` et `:210`. `linkNotice` n'est jamais remis à vide, et `IdentitiesSection` l'utilise comme état initial à chaque montage.
- **Impact** : « Compte GitHub … associé » s'affiche de nouveau à chaque retour sur « Sécurité du compte », jusqu'au rechargement. Le message est trompeur, notamment après une déliaison.
- **Remédiation attendue** : consommer la notice une seule fois. Par exemple, une prop `onNoticeShown` qui remet `linkNotice` à `''` après le montage, ou une remise à vide au changement d'onglet.
- **Test attendu** : après `onDone`, la notice est affichée. On change d'onglet puis on revient sur `security` : la notice a disparu.

#### P9-L-d (Mineur, test) : « Recommencer avec GitHub » n'est pas vérifié sur la finalité

- **Fichier** : `GitHubLinkConfirm.spec.tsx`, test « refus (403) » ; code dans `GitHubLinkConfirm.tsx:98`.
- **Cause** : la mutation F8 (relance avec `login`) n'est pas détectée. Une relance avec la mauvaise finalité ferait entrer un utilisateur déjà connecté dans le parcours de connexion GitHub : changement de session, ou 409.
- **Test attendu** : pour `link` et `repos` (test paramétré), après un 403, le clic sur « Recommencer avec GitHub » appelle `startGitHubAuthorization` avec **la même finalité**.

#### P9-L-e (Amélioration, facultatif) : messages 409 qui renvoient vers « votre profil »

- **Fichier** : `auth.service.ts:239` et `:400` : « … puis liez votre compte Firebase / GitHub depuis votre profil ».
- **Remédiation** : remplacer « depuis votre profil » par « depuis « Sécurité du compte » ». C'est le libellé de l'écran qui existe désormais (P9, observation 2).
- **Critère** : `grep -n "depuis votre profil" backend/src` ne renvoie plus rien, et les tests qui vérifient ces messages sont adaptés.

### Réponses aux questions du fixeur

1. **GitHub, condition 5 (identité affichée avant validation) : écart ACCEPTÉ.** Afficher le nom GitHub avant la preuve imposerait d'échanger le code avant la réauthentification. Cela reviendrait sur l'ordre validé en r26 et stockerait (ou détiendrait) un jeton `repo` sans preuve, ce qui est refusé. Une route d'aperçu qui consomme le code est refusée aussi. Le risque visé par la condition 5, lier sans le savoir une identité qui n'est pas la sienne, est couvert autrement :
   - l'autorisation a été faite dans le navigateur de l'utilisateur, et le `state` est signé et lié à ce navigateur (S9-b) ;
   - le nom GitHub est affiché **aussitôt après** la liaison (notice, liste des identités) et part dans l'e-mail de notification ;
   - la déliaison est possible immédiatement.

   **Remédiation de la condition 5 mise à jour pour GitHub** : l'écran de confirmation affiche l'adresse du compte Planner-Pro. Le nom GitHub est affiché dès la fin de la liaison et figure dans la notification. Cette condition est satisfaite par le code actuel.
2. **Cookie de `state` effacé dès le premier essai : CONSERVER le comportement actuel.** Le `state` est à usage unique quelle que soit l'issue, ce qui est la propriété voulue par S9-b. Le garder jusqu'à une réauthentification réussie ouvrirait, pour une même autorisation GitHub, une fenêtre de rejeu et d'essais de mot de passe. Elle serait limitée par le débit (5/min), mais il faudrait la raisonner, et le gain fonctionnel est faible : une nouvelle autorisation GitHub déjà accordée revient en une redirection. L'interface actuelle (message, puis « Recommencer avec GitHub ») suffit, sous réserve de P9-L-d.
3. **`ssoUid` dans `GET /auth/identities` : NI `ssoUid` NI `hasSso` ; exposer `canUnlink` par fournisseur**, calculé par la même fonction que le contrôle de `unlinkIdentity` (P9-L-a). Un seul endroit porte la règle, rien de superflu n'est exposé, et toute évolution (vérification de la configuration SSO) s'applique aux deux côtés.
4. **Adresse du compte passée par `user.email` (`App.tsx`) : OK.** C'est l'utilisateur de la session courante, la même source que `/auth/me`. Elle n'est affichée qu'à titre d'information, et le serveur ne s'y fie pas. Si l'adresse change pendant la session, l'affichage peut être périmé jusqu'au rechargement : c'est acceptable.

Point 5 du fixeur (non bloquants r26 non traités : `MaxLength` de `idToken`, notification « déliée » au remplacement, vérification de la configuration SSO) : ils restent ouverts et non bloquants. Je recommande d'ajouter `@MaxLength(4096)` sur `idToken` dans la même reprise, puisque le coût est nul.

### Statut des constats

| ID | Statut r27 |
| --- | --- |
| **S31-a** | **VALIDÉ** |
| **P9, volet liaison** | **À REPRENDRE** : P9-L-a, P9-L-b, P9-L-c, P9-L-d (mineurs) ; P9-L-e facultatif |
| P9, « Sessions actives » et « Connecter un dépôt » | ouverts (hors lot) |
| Non bloquants r26 (`idToken` `MaxLength`, remplacement d'identité, configuration SSO) | ouverts, non bloquants |
| S30 (exploitation) | actions 1 à 4 à la charge de l'utilisateur, non confirmées |

**Constats ouverts à la fin de r27 :**

- Immédiat (fixeur) : P9-L-a à P9-L-d, plus P9-L-e et le `MaxLength` de `idToken` en option.
- Phase 1 : P9, « Sessions actives » (liste, `DELETE /auth/sessions/:sid`, « Fermer les autres sessions » après l'activation MFA) et « Connecter un dépôt » (finalité `repos`).
- Exploitation : actions 1 à 4 de S30.
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O17.

---

## Signalement r28 (signalé à la demande de l'utilisateur)

### P13 : Écran d'acceptation d'invitation — formulaire mock rejeté en production et absence d'authentification par e-mail/mot de passe

- **Phase** : 4 (Complément) / Phase 5. **Sévérité** : Majeur (blocage fonctionnel d'onboarding).
- **Fichier** : `frontend/src/components/InvitationAcceptance.tsx:258-270` (`handleBypass`, `mockLogin`).
- **Cause** : 
  1. L'écran d'acceptation d'invitation (`InvitationAcceptance.tsx`) expose un formulaire « OU CRÉER UN COMPTE DE DÉMO » relié à `mockLogin` (`POST /auth/mock/login`). En production, `AuthService.mockLogin` (`backend/src/auth/auth.service.ts:496-498`) rejette immédiatement avec une erreur 400 (`Le mode simulation n'est pas disponible en production`).
  2. L'invité non connecté ne dispose que du bouton de connexion GitHub OAuth ; aucun formulaire de connexion ou d'inscription par e-mail et mot de passe (`classicLogin` / `classicRegister`) n'est présent sur cette page.
- **Impact** : Tout collaborateur ou client invité sans compte GitHub reçoit une erreur bloquante s'il utilise le formulaire affiché, et ne peut pas accepter son invitation en production.
- **Remédiation attendue** :
  1. Supprimer le formulaire de bypass démo sur l'écran d'invitation (ou le conditionner strictement au mode hors production).
  2. Intégrer sur l'écran d'invitation les formulaires d'authentification standard (connexion / inscription mot de passe) pré-remplis avec l'adresse e-mail de l'invitation (règle S17).
- **Statut** : À INSTRUIRE PAR L'ARCHITECTE.


## Revue r28 — P9, volet liaison (reprise P9-L-a à P9-L-e) : VALIDÉ, volet clos (2026-11-05)

Revue de la section « Reprise r27 (fixeur) » du journal. J'ai relu le code et relancé toutes les mesures moi-même. J'ai joué 22 contre-mutations (dont B4 et F8, non détectées en r27) par un script hors dépôt : substitution dont l'unicité est vérifiée, restauration vérifiée par `filecmp`, puis `git status --porcelain` et `md5sum` identiques avant et après. Aucun commit, `.claude/` non touché. **Hors revue** : `InvitationAcceptance.tsx` et `Login.css`.

**Verdict : P9-L-a à P9-L-e et `MaxLength` de `idToken` VALIDÉS. Le volet liaison de P9 est CLOS.** Un nouveau constat de qualité, **O19** (test instable préexistant), ne bloque pas.

### Mesures (relancées par l'architecte)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest`, 1er passage (lancé **en même temps** que la suite frontend) | 83 suites, **2428/2429** : 1 échec, `tests/http/mfa-ticket.spec.ts` › « POST /auth/login (compte MFA), Redis en mode hang : 503 en moins de 2,5 s ». Voir O19 |
| Même commande, 2e passage (seule sur la machine) | **83/83 suites, 2429/2429** |
| `nest build` ; `tsc --noEmit -p tsconfig.build.json` | exit 0 ; exit 0 |
| `cd frontend && pnpm test:run` ; `tsc --noEmit -p .` ; `pnpm build` | **20 fichiers, 104/104** ; exit 0 ; build OK |
| `pnpm lint` racine ; Prettier sur les fichiers du lot | **0 erreur**, 53 avertissements préexistants ; conforme |
| `grep -rn "depuis votre profil" backend/src` | **vide** (exit 1) |

### Contre-mutations de l'architecte

| ID | Mutation | Résultat |
| --- | --- | --- |
| B1, B2, B3 | Écriture conditionnelle S31-a affaiblie (non-régression r27) | **Détectées** (1, 1, 2) |
| B4 | `ssoUid` retiré du `OR` SQL (non détectée en r27) | **Détectée** (1) |
| B4b | `ssoUid` retiré de `hasOtherLoginMethod` | **Détectée** (1) |
| B6 | `canUnlink.github` sans la condition « lié » | **Non détectée** : aucun cas « GitHub non lié, autre méthode présente ». Sans effet fonctionnel, car le bouton « Délier » n'est rendu que pour une identité liée et le serveur renvoie 409 si elle ne l'est pas. Amélioration ci-dessous |
| B6b | `canUnlink.firebase` toujours vrai | **Détectée** (3) |
| B7 | `@MaxLength(4096)` retiré de `idToken` | **Détectée** (1) |
| F1, F3 à F7, F9 | Non-régression r27 (preuve, casse, session Firebase, finalité, adresse affichée, e-mail non vérifié) | **Détectées** |
| F8 | « Recommencer avec GitHub » relancé en `login` (non détectée en r27) | **Détectée** (2) |
| F10 | `canUnlink` ignoré (toujours vrai) | **Détectée** (1) |
| F10b | `canUnlink` lu sur l'autre fournisseur | **Détectée** (5) |
| F11 | Pas de relecture de `getIdentities` à « Délier » | **Détectée** (3) |
| F12b | Pas de relecture avant la confirmation Firebase | **Détectée** (2) |
| F13 | Notice jamais consommée (`IdentitiesSection`) | **Détectée** (2) |
| F14 | `onNoticeShown` non branché dans `App.tsx` | **Détectée** (1) |

### Verdict par point

| Point | Verdict | Preuve |
| --- | --- | --- |
| P9-L-a | **VALIDÉ** | `auth.service.ts:127-146` : `hasOtherLoginMethod`, utilisée par `unlinkIdentity` et par `getIdentities` (`canUnlink`, vrai seulement si l'identité est liée). `ssoUid` n'est pas exposé (testé). Le frontend lit `identities.canUnlink[provider]` sans rien recalculer. B4, B4b, B6b, F10 et F10b sont détectées |
| P9-L-b | **VALIDÉ** | `getIdentities()` est relu à « Délier » et avant l'étape `confirm` de Firebase. Si la relecture échoue, le formulaire ne s'ouvre pas (`run` affiche l'erreur). F11 et F12b sont détectées |
| P9-L-c | **VALIDÉ** | `onNoticeShown` est appelé au montage. `App.tsx` remet `linkNotice` à vide, et `IdentitiesSection` garde sa copie locale pour l'affichage en cours. Le test `App.link-notice.spec.tsx` couvre le changement d'onglet et le retour. F13 et F14 sont détectées |
| P9-L-d | **VALIDÉ** | Test paramétré `link`/`repos`. F8 est détectée |
| P9-L-e | **VALIDÉ** | Les deux messages 409 renvoient vers « Sécurité du compte » ; le `grep` est vide |
| `MaxLength(4096)` sur `idToken` | **VALIDÉ** | Le test aux bornes 4096 et 4097 couvre B7. La borne est large pour un jeton d'identité Firebase (environ 1 à 1,5 ko, revendications personnalisées comprises) |

**Amélioration (non bloquante, sans identifiant)** : ajouter dans `identity-linking.spec.ts` le cas symétrique « mot de passe et Firebase seul lié : `canUnlink.github === false` », pour que B6 soit détectée.

### Nouveau constat r28

#### O19 (Mineur, qualité des tests) : borne de temps réel instable dans `tests/http/mfa-ticket.spec.ts`

- **Fichier** : `backend/tests/http/mfa-ticket.spec.ts:22` (`MAX_RESPONSE_MS = 3000`) et `:198-210`, test `it.each(['reject', 'hang'])` sur `POST /auth/login`. Côté source : `backend/src/auth/auth.service.ts:62` (`MFA_REDIS_TIMEOUT_MS = 2000`).
- **Constat** : l'échec est reproduit par l'architecte au premier passage complet, lancé en même temps que la suite frontend : mode `hang`, temps de réponse supérieur à 3 s. La suite passe seule, y compris sous une charge CPU artificielle (8 boucles actives sur 4 cœurs), ainsi qu'au second passage complet. L'instabilité est **préexistante** : le test date des phases 0 et 1 (`c5f1391`), et le lot r27 ne touche ni la connexion, ni le ticket MFA, ni Redis.
- **Cause** : en mode `hang`, la réponse attend tout le délai Redis (2 s), après la vérification Argon2 du mot de passe. Il ne reste qu'une marge d'1 s pour Argon2 (coûteux en CPU et en mémoire), le démarrage et l'ordonnancement. Sous la charge de plusieurs workers Jest et d'autres processus, cette marge est dépassée.
- **Impact** : faux rouge intermittent en CI, qui pousse à relancer « jusqu'au vert » et masquerait une vraie régression de la borne S3. Aucun impact en production.
- **Remédiation attendue** : rendre la borne indépendante de la charge, sans affaiblir ce qu'elle prouve (le parcours ne reste pas suspendu indéfiniment).
  - **Option A (préférée)** : rendre `MFA_REDIS_TIMEOUT_MS` injectable, avec 2000 ms par défaut (fournisseur ou option du module, pas une variable lue partout). Le test HTTP le fixe à 200 ms et vérifie `elapsed < 2000` : la réponse arrive bien avant tout blocage, avec une marge d'environ 1,8 s pour Argon2. Un test unitaire vérifie en plus, avec `jest.useFakeTimers()`, qu'une commande Redis suspendue est rejetée au bout de la valeur **par défaut** (2000 ms), et pas avant.
  - **Option B** : mesurer dans le même test le temps d'une connexion en mode `ok` (référence), puis vérifier `elapsed < référence + MFA_REDIS_TIMEOUT_MS + 1000`.
- **Critère** : 5 passages complets de `npx jest` lancés en même temps que `pnpm test:run` du frontend, sans échec de `mfa-ticket.spec.ts`. La mutation « délai Redis supprimé, attente infinie » fait toujours échouer le test, par dépassement de la borne ou du délai Jest.

### Statut des constats

| ID | Statut r28 |
| --- | --- |
| P9-L-a à P9-L-e, `MaxLength` de `idToken` | **VALIDÉ** |
| **P9, volet liaison** | **CLOS** |
| P9, « Sessions actives » et « Connecter un dépôt » | ouverts |
| **O19** | Nouveau, Mineur (qualité des tests) |
| Non bloquants r26 (remplacement silencieux d'une identité liée, vérification de la configuration SSO pour `ssoUid`) | ouverts, non bloquants |
| S30 (exploitation) | actions 1 à 4 à la charge de l'utilisateur, non confirmées |

**Commit** : le lot S31-a et P9 (liaison) peut être commité. Il comprend les fichiers du lot backend (`auth.service.ts`, `dto/identity.dto.ts`, `fake-prisma.ts`, `identity-linking.spec.ts`), les fichiers frontend (`App.tsx`, `security-api.ts`, `github-oauth.ts`, `github-oauth.spec.ts`, `SecurityPage.css`, les composants `IdentityProofFields`, `IdentitiesSection`, `GitHubLinkConfirm` et leurs tests, `App.github-return.spec.tsx`, `App.link-notice.spec.tsx`), le rapport et le journal. **Sans** `InvitationAcceptance.tsx`, `Login.css` ni `.claude/`. `GET /auth/identities` gagne `canUnlink` (ajout additif) ; aucune migration.

**Constats ouverts à la fin de r28 :**

- Phase 1 : P9, « Sessions actives » (liste, `DELETE /auth/sessions/:sid`, « Fermer les autres sessions » après l'activation MFA) et « Connecter un dépôt » (finalité `repos`).
- Qualité : O19.
- Non bloquants r26 : remplacement d'identité, configuration SSO.
- Exploitation : actions 1 à 4 de S30.
- Phases 5 et 6 : S19 à S26 ; A5 à A9 ; P2, P5, P7, P8 ; Q-2 ; O10 à O17.

## Revue r29 — Travail Gemini (InvitationAcceptance, Login.css) : VALIDÉ ; P13 instruit ; préparation du lot suivant (2026-11-05)

J'ai revu l'entrée « Travail Gemini (InvitationAcceptance / Login.css) » du journal. Pour ce lot, l'interdiction de toucher `InvitationAcceptance.tsx` et `Login.css` est levée. J'ai relu les deux fichiers et l'historique Git, rendu la page en headless Chrome (1280 px et 375 px) et relancé les mesures. Aucun commit, `.claude/` non touché. Je n'ai modifié aucun fichier de code.

**Verdict : le lot Gemini, dans son état actuel, est VALIDÉ (correctif d'affichage du logo).** Le parcours d'invitation présente en revanche un défaut produit **Majeur**, déjà visible à HEAD. Je l'instruis sous l'identifiant **P13**, et la remédiation est donnée plus bas.

### Revue du lot

- **Différence avec HEAD** :
  - `InvitationAcceptance.tsx:207-208` : `<div className="login-logo-container"><img … className="login-logo" /></div>`, la même structure que `Login.tsx:302-303` et `AccountLinkPage.tsx:51-52`.
  - `Login.css:100` : `object-fit: contain` ajouté.
  - Rien d'autre. La règle `.login-logo img` ajoutée par Gemini a été retirée par le fixeur. Elle n'existait pas à HEAD et était morte, puisque `.login-logo` porte désormais sur l'`<img>`.
- **Cause du défaut corrigé** : à HEAD, `.login-logo` (72 × 72 px) s'appliquait au `<div>` et l'`<img>` n'avait aucune contrainte. Le logo (JPEG de 1024 × 1024) s'affichait donc en taille native et recouvrait la carte d'invitation.
- **Rendu vérifié** :
  - en headless Chrome, avec la feuille CSS du build de production : logo de **72 × 72 px** centré à 1280 px, **60 × 60 px** à 375 px (la règle `@media (max-width: 768px)` de `Login.css:400-403` vient après la règle de base et l'emporte à spécificité égale) ;
  - aucun débordement de la carte ;
  - `.login-logo:hover` (`Login.css:106-108`) cible maintenant l'`<img>`, ce qui produit le même effet que sur `Login` ;
  - `object-fit: contain` est neutre pour un logo carré et protège d'un futur logo non carré.
- **Cohérence** : tous les imports, états et gestionnaires de `InvitationAcceptance.tsx` sont utilisés, `tsc` passe. Aucun test ne couvre ce composant (voir P13).

| Mesure | Résultat |
| --- | --- |
| `cd frontend && pnpm test:run` | **20 fichiers, 104/104** |
| `tsc --noEmit -p .` ; `pnpm build` | exit 0 ; build OK |
| `pnpm lint` racine | **0 erreur**, 53 avertissements préexistants |
| Prettier (`InvitationAcceptance.tsx`, `Login.css`) | conforme |

### Formulaires e-mail et mot de passe disparus : provenance et récupération

- Les quelque 185 lignes (`classicLogin`, `classicRegister`, `authMode`) ont été écrites par Gemini le 2026-11-05, entre 08 h 13 et 08 h 14 UTC. On les retrouve dans le journal local de Gemini, `~/.gemini/antigravity/brain/fc2d2132-…/.system_generated/logs/transcript_full.jsonl` (étapes 229, 231 et 237, appels `edit_file`). Elles sont donc **récupérables**, contrairement à ce qu'indique le journal du fixeur.
- Elles étaient présentes au début de r27 (`git diff --stat` : 210 lignes modifiées) et absentes à r29. Les scripts de l'architecte ne les ont pas touchées : `md5sum` de `frontend/src/components/*.tsx` identique avant et après chaque série de mutations en r27 et r28, et aucune mutation ne visait ce fichier.
- **Je déconseille de les restaurer telles quelles** :
  - `handleAuthSubmit` ignore le défi MFA renvoyé par `classicLogin` (`Promise<MfaChallenge | void>`, `AppContext.tsx:237`). Un compte avec MFA restait bloqué sans écran de code ;
  - elles dupliquent `Login.tsx` sans « Mot de passe oublié », sans Firebase ni SSO ;
  - elles ne résolvent pas la perte du jeton d'invitation au retour de GitHub (voir P13).

### Section « Signalement r28 » ajoutée par Gemini (≈ l. 3821)

Cette section a été écrite **directement dans le rapport** par un autre assistant, et non par l'architecte. Je la conserve pour la traçabilité et j'adopte l'identifiant **P13**. **Sa remédiation est remplacée par celle ci-dessous.** Le point 2 (« pré-rempli avec l'adresse e-mail de l'invitation ») contredit S27 : la route publique `GET /invitations/check/:token` ne renvoie que l'adresse **masquée**, et doit continuer ainsi. Désormais, seuls l'architecte et le fixeur (dans le journal) écrivent dans ces deux fichiers.

### Avis d'architecte et de produit sur le parcours d'invitation

**Situation actuelle.** Lorsqu'un jeton est dans l'URL, `App.tsx:155-156` affiche `InvitationAcceptance` avant `Login`. Un invité non connecté n'a que deux boutons :

1. **GitHub** : `redirect_uri` est l'origine du frontend (`auth.service.ts:341`). Au retour, l'URL ne contient plus `token` : la connexion réussit, mais **l'invitation est perdue**, et l'utilisateur doit recliquer le lien reçu par e-mail.
2. **« Compte de démo »** : `POST /auth/mock/login`, refusé en production (400).

Un invité qui a un compte par mot de passe, Firebase ou SSO, ou qui n'a pas de compte, ne peut donc pas rejoindre l'espace depuis le lien. **C'est un blocage d'accès des nouveaux utilisateurs en production : Majeur (produit).**

**Les trois options** :

| Option | Pour | Contre |
| --- | --- | --- |
| A. Réintégrer des formulaires e-mail et mot de passe dans la page d'invitation | Un seul écran | Duplique `Login` : MFA, mot de passe oublié, Firebase, SSO, vérification d'adresse. La version Gemini a déjà oublié la MFA. Deux codes d'authentification divergeront |
| **B. Réutiliser `Login` dans le contexte de l'invitation, avec un jeton conservé** (recommandée) | Toutes les méthodes et la MFA d'un coup, sans duplication ; corrige aussi la perte du jeton au retour de GitHub ou du SSO | Il faut persister le jeton pendant le parcours |
| C. GitHub seul | Rien à faire | Exclut tous les invités sans GitHub, et le jeton est perdu même avec GitHub : inacceptable |

**Recommandation : option B, dans le lot P13 ci-dessous.** L'utilisateur tranche ; si l'option A est retenue, les exigences de sécurité P13-c à P13-e s'appliquent à l'identique, et il faut en plus un test du défi MFA.

**Exigences de sécurité applicables, quelle que soit l'option** :

- **Jeton d'invitation** : c'est un secret porteur. Le backend le stocke haché, l'accepte une seule fois de façon atomique et vérifie son expiration (`invitations.service.ts:256-330`). Côté navigateur :
  - le retirer de l'URL dès le montage (`history.replaceState`) et non à la fin du parcours ;
  - le conserver au plus en `sessionStorage`, avec une échéance courte ;
  - ne jamais le mettre en `localStorage`, dans le `state` OAuth ni dans les journaux.
- **Adresse invitée et adresse du compte** : la règle S17 est conservée côté serveur (égalité insensible à la casse, `invitations.service.ts:290-298`). L'adresse complète n'est jamais affichée ni pré-remplie, seule l'adresse masquée l'est (S27). Si l'adresse ne correspond pas (403), l'écran explique la situation et propose « Changer de compte » (déconnexion qui conserve l'invitation en attente).
- **MFA** : l'acceptation n'a lieu qu'avec une session complète. Le ticket MFA n'est pas un jeton d'accès (S3, déjà garanti côté serveur). Le parcours doit aller jusqu'au bout du défi MFA.
- **Consentement** : pas d'acceptation automatique après la connexion. L'utilisateur clique « Accepter », ce qui évite qu'un lien transféré fasse rejoindre un espace sans le savoir.
- **Compte de démo** : voir le classement ci-dessous.

**Classement du défaut « compte de démo »** :

- **Côté serveur**, le défaut est déjà couvert par **S26** (Mineur, CVSS 5.3) : `mock/login` crée un compte sans vérification dès que `NODE_ENV !== 'production'`. La route est donc ouverte si `NODE_ENV` est absent ou vaut `staging`. Je ne crée pas de nouveau constat, mais **j'avance le volet `mock/login` de S26 dans le lot P13**, car le coût est faible et le lien est direct.
- **Côté client**, l'affichage dans `InvitationAcceptance` (formulaire principal, très visible) et dans `Login.tsx:727-740` (accordéon « (Dev) ») est un défaut **produit Mineur**, intégré à P13 (P13-d).

#### P13 (Majeur, produit) : un invité ne peut pas rejoindre l'espace depuis le lien d'invitation en production

- **Fichiers** :
  - `frontend/src/App.tsx:68-83` et `:155-156` ;
  - `frontend/src/components/InvitationAcceptance.tsx` (formulaire de démo `:258-270`, `handleGitHubLogin`, nettoyage de l'URL seulement dans `handleGoToApp`) ;
  - `frontend/src/components/Login.tsx:727-740` ;
  - `backend/src/auth/auth.controller.ts:405-414` et `auth.service.ts` (`mockLogin`).
- **Remédiation attendue** :
  - **P13-a, jeton conservé pendant l'authentification.**
    - Au montage avec `?token=` ou `?invite=` : retirer le paramètre de l'URL **immédiatement**, puis enregistrer `{ token, expiresAt: now + 30 min }` dans `sessionStorage` sous la clé `planner_pending_invite`.
    - `App.tsx` lit cette entrée au démarrage si l'URL ne contient pas de jeton, et l'ignore si elle a expiré (puis la supprime).
    - L'entrée est supprimée après une acceptation réussie, lors de « Ignorer l'invitation » et à la déconnexion explicite, sauf pour « Changer de compte » (P13-c).
    - Les retours GitHub, SSO et Firebase, ainsi que le défi MFA, restituent l'écran d'invitation une fois l'utilisateur connecté.
  - **P13-b, authentification par `Login`.**
    - Invité non connecté : l'écran affiche le résumé de l'invitation (espace, invitant, rôle, adresse masquée) et un bouton « Se connecter ou créer un compte ». Ce bouton affiche le composant `Login` existant, avec un bandeau : « Invitation à rejoindre {espace}, connectez-vous avec l'adresse {masquée} ».
    - Toutes les méthodes de `Login` restent disponibles : mot de passe avec MFA, Firebase, SSO, GitHub, mot de passe oublié, inscription. Aucun formulaire d'authentification n'est dupliqué dans `InvitationAcceptance`.
    - Une fois connecté, l'utilisateur revient sur l'écran d'acceptation, avec un clic explicite sur « Accepter ».
    - Inscription : la vérification d'adresse (P6) reste exigée. Le message de fin d'inscription précise : « Après avoir validé votre adresse, rouvrez le lien d'invitation ou revenez dans cet onglet. »
  - **P13-c, adresse différente.** Sur un 403 de `POST /projects/invitations/accept/:token`, afficher le message du serveur, l'adresse masquée et un bouton « Changer de compte ». Ce bouton déconnecte en conservant `planner_pending_invite`, puis réaffiche l'écran d'invitation non connecté. L'adresse invitée complète n'est jamais affichée ni pré-remplie.
  - **P13-d, plus de compte de démo hors développement.**
    - Le formulaire de démo est **supprimé** de `InvitationAcceptance`.
    - Dans `Login.tsx`, il n'est rendu que si `import.meta.env.DEV` est vrai, ce qui l'élimine du build de production.
    - Le texte « Erreur d'authentification » affiché par `alert()` est remplacé par un encart d'erreur.
  - **P13-e (S26, volet `mock/login` avancé).**
    - La route `POST /auth/mock/login` n'est enregistrée que si `ENABLE_DEV_AUTH === 'true'` **et** `NODE_ENV === 'development'` : contrôleur dédié dans un module chargé conditionnellement. Sinon elle n'existe pas (404).
    - Elle reçoit `@Throttle` (5/min) et un DTO (`name` : `IsString`, `MaxLength(80)`).
    - `.env.example` documente `ENABLE_DEV_AUTH=false`.
- **Tests attendus** :
  - `InvitationAcceptance.spec.tsx` (nouveau) :
    - non connecté : résumé avec l'adresse masquée, bouton « Se connecter ou créer un compte », **aucun** formulaire de démo ni appel à `/auth/mock/login` ;
    - le jeton disparaît de `window.location.search` dès le montage, et `sessionStorage` contient une entrée qui expire ;
    - connecté : « Accepter » appelle `/accept/:token` et supprime l'entrée ;
    - un 403 affiche « Changer de compte », qui conserve l'entrée ;
    - aucune acceptation automatique : l'API n'est pas appelée sans clic.
  - `App.invitation-return.spec.tsx` (nouveau) :
    - URL `/?code=…&state=…` sans jeton, `planner_pending_invite` valide et connexion GitHub réussie : l'écran d'invitation s'affiche ;
    - même scénario avec un défi MFA : l'écran s'affiche après la validation du code ;
    - entrée expirée : ignorée et supprimée.
  - Build : `grep -l "mock/login" frontend/dist/assets/*.js` ne renvoie rien après `pnpm build`.
  - Backend :
    - `NODE_ENV` non défini, ou `production`, ou `development` sans `ENABLE_DEV_AUTH=true` : `POST /auth/mock/login` renvoie 404 ;
    - `development` avec `ENABLE_DEV_AUTH=true` : 201, avec une limite de débit ;
    - le cas « e2e avec `NODE_ENV` non défini → 404 » prévu par S26 est couvert.
- **Critère d'acceptation** : en production, un invité dont l'adresse correspond peut rejoindre l'espace par n'importe quelle méthode de connexion, MFA comprise, à partir du seul lien reçu, sans manipuler l'URL. Aucun chemin d'interface ni route ne permet de compte de démo hors `development` explicitement activé.

### Préparation du lot suivant (pour le fixeur)

**Ordre de priorité** :

1. **O19** : petit, et il stabilise les mesures de tous les lots suivants. Remédiation en r28, à la section « O19 ».
2. **P13**, avec le volet `mock/login` de S26 (Majeur, accès des invités en production).
3. **P9-S, « Sessions actives »** : Phase 1, complète la MFA (r21 point 3).
4. **P9-R, « Connecter un dépôt »** : Phase 1, fonctionnalité perdue depuis S9.

Un lot par point, chacun revu séparément.

#### P9-S : écran « Sessions actives »

- **Existant** :
  - `GET /auth/sessions` (`auth.controller.ts:308-311`, `SessionService.listForUser`) : `id`, `createdAt`, `authenticatedAt`, `expiresAt`, `userAgent`, `current` ;
  - `DELETE /auth/sessions/:sid` (`:316-324`) : 204, ou 404 si la session n'appartient pas à l'utilisateur ; interdit en impersonation ;
  - pas de route pour fermer en une fois toutes les autres sessions.
- **Exigences backend** :
  - nouvelle route `POST /auth/sessions/revoke-others` : `revokeAllForUser(userId, sid)`, réponse 200 `{ revoked: number }` (précisé en r32), `@ForbiddenInImpersonation()`, `@Throttle` (5/min) ;
  - entrée `AuditLog` `SESSIONS_REVOKED` : nombre de sessions et `sid` courant, aucun jeton ;
  - **pas de réauthentification** : c'est une action de protection. Un voleur de session qui l'utilise déconnecte la victime, mais ne gagne aucun accès, et la victime se reconnecte ;
  - `DELETE /auth/sessions/:sid` reçoit aussi `@Throttle` (10/min) ;
  - la session courante ne peut pas être révoquée par cette route : 409 « Utilisez Se déconnecter ». Cela évite un état incohérent des cookies.
- **Exigences frontend** :
  - nouveau composant `SessionsSection` dans l'onglet `security`, sous les identités ;
  - pour chaque session : navigateur et système lisibles, tirés de `userAgent` (analyse simple, repli sur la chaîne tronquée à 120 caractères), date d'ouverture, dernière authentification, expiration, badge « Cette session » ;
  - bouton « Révoquer » sur les autres sessions seulement (confirmation, puis `DELETE`, puis rafraîchissement de la liste) ;
  - bouton « Fermer les autres sessions », affiché s'il existe au moins une autre session (`POST revoke-others`, puis notice « n sessions fermées ») ;
  - **après l'activation de la MFA**, `SecurityPage` propose « Fermer les autres sessions » (r21 point 3) ;
  - en impersonation, la liste reste visible et les actions sont masquées.
- **Tests attendus** :
  - backend :
    - `revoke-others` révoque les autres familles, conserve la courante et ne touche pas aux sessions d'un autre utilisateur ;
    - la route est dans la liste d'`impersonation-routes.spec.ts`, et le balayage méta la couvre (`/sessions/`) ;
    - entrée d'audit présente ;
    - `DELETE` sur la session courante : 409 ;
    - un jeton d'accès de la session révoquée est refusé à la requête suivante (cache invalidé, S7-a) ;
  - frontend :
    - rendu de la liste, badge, aucun bouton « Révoquer » sur la session courante ;
    - `DELETE` appelé avec le bon `sid`, puis la liste est rafraîchie ;
    - `revoke-others` et sa notice ;
    - invitation affichée après l'activation de la MFA ;
    - un 404 affiche une erreur et rafraîchit la liste.
- **Critère d'acceptation** : un utilisateur voit ses sessions ouvertes et peut fermer l'une d'elles ou toutes les autres. Après l'activation de la MFA, la fermeture des autres sessions lui est proposée. Aucune action n'est possible en impersonation.

#### P9-R : « Connecter un dépôt » (finalité `repos`)

- **Existant** :
  - la finalité `repos` est signée dans le `state` ;
  - le retour passe par `GitHubLinkConfirm` (preuve exigée, S31) ;
  - `GET /auth/github/repos` et `POST /auth/github/sync` (`auth.controller.ts:419-435`) existent, mais aucun écran ne les appelle ;
  - `syncRepositoryToProject` (`auth.service.ts`) a trois défauts : corps non typé (`{ projectId, repoFullName }` sans DTO, donc aucune validation : `projectId` peut être un objet d'opérateurs Prisma), droit limité au créateur (`project.userId`) au lieu du modèle de rôles, et `repoFullName` enregistré **sans vérifier** que le dépôt existe ni qu'il est accessible.
- **Exigences backend** :
  - `GithubSyncDto` : `projectId` (`IsString`, `MaxLength(64)`) et `repoFullName` (`Matches(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/)`) ;
  - autorisation par `policy.assertProject(projectId, userId, 'project.manage')`, au lieu de `project.userId` ;
  - vérification par `GET https://api.github.com/repos/{owner}/{repo}` avec le jeton de l'utilisateur, `AbortSignal.timeout(5000)` et `encodeURIComponent` sur chaque segment. Une réponse autre que 200 donne un 400, sans écriture. Le dépôt enregistré est le `full_name` canonique renvoyé par GitHub ;
  - `@Throttle` (10/min) sur `github/repos` et `github/sync` ;
  - **non bloquant r26, à traiter ici** : si le compte est déjà lié à un `githubId` différent de celui qui revient de GitHub, `linkGitHubAccount` répond 409 « Déliez d'abord le compte GitHub actuel » (finalités `link` et `repos`). Il ne remplace plus l'identité en silence.
- **Exigences frontend** :
  - dans `IntegrationsPanel`, pour un projet où l'utilisateur a `project.manage`, ajouter un bouton « Connecter un dépôt » ;
  - au clic, appeler `GET /auth/github/repos`. Si la réponse est 200, ouvrir le sélecteur. En cas de 400 (aucun GitHub lié) ou de 401/403 (portée insuffisante, jeton révoqué), enregistrer `{ projectId, expiresAt: now + 15 min }` dans `sessionStorage` (`planner_pending_repo`), puis lancer `startGitHubAuthorization('repos')` ;
  - au retour, `GitHubLinkConfirm` (finalité `repos`) mène, via `onDone`, à l'onglet des intégrations du projet en attente et ouvre le sélecteur. L'onglet `security` n'est plus utilisé pour cette finalité ;
  - le sélecteur liste les dépôts, puis appelle `POST /auth/github/sync` et affiche le dépôt lié. L'écran de confirmation rappelle que la portée `repo` donne accès aux dépôts privés.
- **Tests attendus** :
  - backend :
    - DTO : `projectId` objet, nom de dépôt invalide ou trop long → 400 ;
    - utilisateur sans `project.manage` → 403 ;
    - dépôt inaccessible (fetch simulé à 404) → 400 sans écriture ;
    - succès : nom canonique enregistré ;
    - délai dépassé → erreur sans écriture ;
    - liaison GitHub vers un autre `githubId` → 409 sans écriture ni échange de jeton conservé ;
  - frontend :
    - bouton absent sans `project.manage` ;
    - 200 → sélecteur, puis `sync` appelé avec le projet et le dépôt ;
    - 400 → `planner_pending_repo` enregistré, puis `startGitHubAuthorization('repos')` ;
    - au retour, le sélecteur s'ouvre sur le bon projet ;
    - entrée expirée ignorée.
- **Critère d'acceptation** : un gestionnaire de projet relie un dépôt **auquel il a réellement accès** en trois clics. Aucun nom de dépôt arbitraire n'est enregistré. Une liaison GitHub ne remplace jamais en silence une autre identité GitHub.

### Statut des constats

| ID | Statut r29 |
| --- | --- |
| Lot Gemini (logo de l'invitation, `Login.css`) | **VALIDÉ** |
| **P13** | Instruit, **Majeur (produit)**, ouvert ; remédiation P13-a à P13-e (option B recommandée, décision de l'utilisateur) |
| S26 | Ouvert ; volet `mock/login` avancé dans P13-e |
| P9-S, P9-R | Exigences rédigées, ouverts |
| O19 | Ouvert (remédiation r28) |

**Constats ouverts à la fin de r29 (ordre de traitement)** :

1. O19.
2. P13, avec P13-e (S26, `mock/login`).
3. P9-S.
4. P9-R, avec le non bloquant r26 « remplacement silencieux ».
5. Puis :
   - non bloquant r26 : configuration SSO pour `ssoUid` ;
   - exploitation : actions 1 à 4 de S30 ;
   - Phases 5 et 6 : S19 à S26 (hors volet `mock/login`), A5 à A9, P2, P5, P7, P8, Q-2, O10 à O17.

## Revue r30 — O19 et P13 (option B, volet `mock/login` de S26) : VALIDÉ ; nouveau constat S32 (2026-11-05)

Revue de la section « Lot r29 (fixeur) » du journal. J'ai relu le code et relancé les mesures. J'ai joué 22 contre-mutations : 20 sur les tests, 2 sur le build de production. Script hors dépôt, restauration vérifiée par `filecmp`, `git status --porcelain` et `md5sum` des 23 fichiers du lot identiques avant et après. J'ai aussi vérifié empiriquement que la route simulée est bien enregistrée à partir d'un fichier `.env`. Aucun commit ; le dossier d'agent local n'a pas été touché. L'historique a été réécrit depuis r29 : les identifiants de commit cités désormais sont `7fc9eb7` et `fb7d263`.

**Verdict** :

- **O19 : VALIDÉ.**
- **P13-a à P13-e : VALIDÉ.** Deux tests manquent et sont à ajouter au lot suivant (P13-f, non bloquant).
- **Nouveau constat S32 (Mineur)** : traversée de chemin côté client par le jeton d'invitation. Le défaut est préexistant, mais P13 l'a rendu plus durable (jeton conservé en `sessionStorage`). À traiter en tête du lot suivant.

### Mesures (relancées par l'architecte)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` (seul) | **85/85 suites, 2450/2450** |
| Même commande, lancée **en même temps** que `pnpm test:run` du frontend (critère O19) | **2450/2450**, `mfa-ticket.spec.ts` vert |
| `nest build` ; `tsc --noEmit -p tsconfig.build.json` | exit 0 ; exit 0 |
| `cd frontend && pnpm test:run` ; `tsc --noEmit -p .` ; `pnpm build` | **23 fichiers, 124/124** ; exit 0 ; build OK |
| `grep -l "mock/login" frontend/dist/assets/*.js` ; `grep -l "Simuler" frontend/dist/assets/*.js` | **vides** (exit 1) |
| `pnpm lint` racine ; Prettier (`backend/src/auth`, tests du lot, `frontend/src`, `docs/deployment-production.md`) | **0 erreur** (53 avertissements préexistants) ; conforme |
| Module compilé chargé avec un `.env` seul, dans un répertoire de test | `ENABLE_DEV_AUTH=true` et `NODE_ENV=development` : `DevAuthController` enregistré ; `ENABLE_DEV_AUTH=false` : absent ; `NODE_ENV=production` et `ENABLE_DEV_AUTH=true` : absent |

Sur le dernier point : `devAuthControllers()` est évalué au chargement du décorateur `@Module`. Dans le même littéral, `ConfigModule.forRoot()`, placé dans `imports`, est évalué avant `controllers` et charge `.env` de façon synchrone. La configuration par fichier `.env` fonctionne donc en développement. En production, elle reste fermée par défaut.

### Contre-mutations de l'architecte

| ID | Mutation | Résultat |
| --- | --- | --- |
| BM1 | Drapeau : `&&` remplacé par `\|\|` | **Détectée** (9) |
| BM2 | `NODE_ENV === 'development'` remplacé par `!== 'production'` | **Détectée** (3) |
| BM3 | `DevAuthController` toujours enregistré | **Détectée** (10) |
| BM4 | Garde de défense en profondeur de `AuthService.mockLogin` retirée | **Détectée** (1) |
| BM5, BM6 | `@Throttle` retiré ; `@MaxLength(80)` retiré | **Détectées** (1 ; 1) |
| BM7 | Délai Redis injecté ignoré (constante utilisée) | **Détectée** (3) |
| BM8 | Délai par défaut passé à 20 000 ms | **Détectée** (2) |
| FM1 | Jeton laissé dans l'URL | **Détectée** (3) |
| FM2 | `localStorage` au lieu de `sessionStorage` | **Détectée** (8) |
| FM3 ; FM4 | Expiration ignorée ; durée de vie de 30 jours | **Détectées** (2 ; 1) |
| FM5 | Un 403 efface l'invitation en attente (« Changer de compte » la perd) | **Détectée** (1) |
| FM6 | Entrée conservée après l'acceptation | **Détectée** (1) |
| FM7 | Entrée conservée quand le jeton est invalide | **Non détectée**. Effet limité : l'écran « Invitation invalide » réapparaît au rechargement pendant 30 min au plus. Voir P13-f |
| FM8 | Bandeau de `Login` sans l'adresse masquée | **Détectée** (1) |
| FM9 | `App` ignore l'entrée en attente | **Détectée** (3) |
| FM10 | État initial `showLogin` à `false` malgré un retour OAuth en erreur | Non détectée, **équivalente** : l'effet suivant le remet à `true` au premier rendu |
| FM11 | La déconnexion par l'en-tête ne supprime plus l'entrée | **Non détectée**. Le comportement exigé par P13-a est présent mais non testé. Voir P13-f |
| FM12 | Acceptation automatique dès que l'utilisateur est connecté | **Détectée** (1) |
| FB1 | Formulaire de démonstration rendu sans condition (build) | **Détectée** par `grep "Simuler"` sur `dist`. `grep "mock/login"` **ne la détecte pas** : la requête reste éliminée |
| FB2 | `requestMockLogin` défini sans condition (build) | **Détectée** (`grep "mock/login"` trouve le paquet) |

### Verdict par point

| Point | Verdict | Preuve |
| --- | --- | --- |
| O19 | **VALIDÉ** | Délai injectable (`MFA_REDIS_TIMEOUT_TOKEN`, `@Optional`, 2000 ms par défaut, inchangé en production). Le test HTTP utilise 200 ms et une borne de 2 s. `mfa-redis-timeout.spec.ts` vérifie la valeur par défaut et la non-expiration à 1999 ms avec des minuteries simulées. Vert en charge concurrente ; BM7 et BM8 détectées |
| P13-a | **VALIDÉ**, réserve P13-f | `invitation-store.ts` : jeton retiré de l'URL à la lecture, `sessionStorage` seulement, 30 min, entrée illisible ou expirée supprimée. `App.tsx:72` lit l'URL puis l'entrée en attente |
| P13-b | **VALIDÉ** | `InvitationAcceptance` ne contient plus aucun formulaire d'authentification et réutilise `Login`. Le bandeau montre l'adresse masquée, avec « Retour à l'invitation ». L'acceptation se fait sur clic explicite (FM12). Le message de fin d'inscription est adapté. Le retour OAuth en erreur et le défi MFA ramènent à `Login` |
| P13-c | **VALIDÉ** | Un 403 affiche l'adresse masquée, « Changer de compte » (déconnexion qui conserve l'entrée) et « Ignorer » |
| P13-d | **VALIDÉ** | Le formulaire et la requête de démonstration ne sont présents qu'avec `import.meta.env.DEV`, et absents du paquet de production (FB1, FB2). `alert()` est supprimé |
| P13-e (S26, volet `mock/login`) | **VALIDÉ** | `isDevAuthEnabled` : `development` **et** `ENABLE_DEV_AUTH === 'true'` (fermé par défaut). Contrôleur dédié enregistré seulement dans ce cas (404 sinon), `MockLoginDto` (1 à 80 caractères), `@Throttle` 5/min, garde dans le service en plus. `docs/deployment-production.md` documente le drapeau. S26 reste ouvert pour ses autres volets |

#### P13-f (Mineur, tests ; à faire avec le lot suivant)

- `App` : un test vérifie qu'un clic sur « Se déconnecter » dans l'en-tête supprime `planner_pending_invite` (FM11), et qu'une déconnexion provoquée par `SESSION_EXPIRED_EVENT` la conserve (comportement de la question 3).
- `InvitationAcceptance` : un test vérifie qu'un jeton refusé par `check` supprime l'entrée (FM7).
- Cosmétique : si `check` échoue alors qu'un retour OAuth en erreur est présent, `Login` s'affiche avec un bandeau sans nom d'espace (« Invitation à rejoindre . »). Afficher le bandeau seulement si `inviteInfo` est chargé.
- Contrôle de build, à ajouter en CI (`ci.yml`, étape après `pnpm build`) : `! grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js`.

### Nouveau constat r30

#### S32 (Mineur) : traversée de chemin côté client par le jeton d'invitation (requêtes authentifiées vers d'autres routes de l'API)

- **Fichiers** : `frontend/src/context/AppContext.tsx:1484-1503`. `checkInvitation` (`GET …/projects/invitations/check/${token}`, au montage) et `acceptInvitation` (`POST …/accept/${token}`, au clic) concatènent le jeton **sans `encodeURIComponent` ni contrôle de format**. Le jeton vient de `?token=` (décodé par `URLSearchParams`) puis, depuis P13-a, de `sessionStorage`. Le défaut est **préexistant** (déjà présent à HEAD) ; P13 ne l'a pas introduit.
- **Démonstration** : `?token=..%2F..%2F..%2Fauth%2Flogout` donne le jeton `../../../auth/logout`. `new URL('…/projects/invitations/accept/' + jeton)` est normalisé en `/auth/logout`. Le `fetch` global ajoute `credentials: 'include'` (`api-session.ts:91`), et la requête part de l'origine légitime, donc `originCheckMiddleware` l'accepte.
- **Scénario** : un lien d'invitation forgé, envoyé par courriel ou par messagerie, fait émettre par le navigateur de la victime connectée :
  - une requête `GET` authentifiée vers une route arbitraire de l'API, au chargement de la page ;
  - puis, si cette réponse est un 200 qui ressemble à une invitation, une requête `POST` authentifiée au corps vide vers la même route, lors du clic sur « Accepter ».

  C'est l'équivalent d'une CSRF à travers l'application elle-même (CWE-22 et CWE-352, client-side path traversal).
- **Sévérité** : Mineur. CVSS 3.1 : 3.1 (`AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:L/A:N`). L'exploitation exige un clic sur le lien, une route qui réponde 200 en `GET` **et** agisse en `POST` sans corps, ainsi qu'un clic sur « Accepter ». La lecture ne fuit pas vers l'attaquant (la réponse n'est affichée qu'à la victime). Le risque augmentera avec des routes `POST` sans corps comme `POST /auth/sessions/revoke-others` (P9-S).
- **Remédiation attendue** :
  - `invitation-store.ts` : `isInviteToken(token)` = `/^[a-f0-9]{64}$/` (format émis par `invitations.service.ts:117`, `randomBytes(32).toString('hex')`). `captureInviteFromUrl` retire toujours le paramètre de l'URL, mais **n'enregistre ni ne renvoie** un jeton invalide ; `readPendingInvite` supprime une entrée invalide ;
  - `AppContext.tsx` : `encodeURIComponent(token)` dans les deux URL, en défense en profondeur ;
  - autres `fetch` de l'application qui insèrent une valeur venue de l'URL ou du stockage dans un **chemin** (`grep -n '\${[a-zA-Z]*}' frontend/src/**/*.ts*` sur les appels à l'API) : encoder ces segments et les lister dans le journal.
- **Tests attendus** :
  - `invitation-store.spec.ts` : `?token=../../auth/logout` donne `null`, le paramètre est retiré de l'URL et rien n'est enregistré ; une entrée en attente au format invalide est supprimée ; un jeton hexadécimal de 64 caractères est accepté ;
  - `App.invitation-return.spec.tsx` ou un test du contexte : avec un jeton qui contient `/`, aucun `fetch` ne part vers un chemin hors de `/projects/invitations/` ;
  - la contre-mutation « encodage retiré **et** validation retirée » doit faire échouer au moins un test.
- **Critère d'acceptation** : aucune valeur venue de l'URL ou du stockage du navigateur ne peut modifier le chemin d'une requête vers l'API.

### Réponses aux questions du fixeur

1. **`.env.example` : oui, ajouter la ligne. C'est la session principale (ou l'utilisateur) qui s'en charge**, puisque ni le fixeur ni l'architecte ne modifient les fichiers `.env*`. Ce n'est pas bloquant, car une variable absente vaut « désactivé ». Texte à placer juste après le bloc `NODE_ENV=development` (vers la ligne 62) :

   ```
   # Connexion simulée POST /auth/mock/login (S26, P13-e) : n'existe que si NODE_ENV=development
   # ET ENABLE_DEV_AUTH=true. Ne jamais l'activer en production ni en préproduction.
   ENABLE_DEV_AUTH=false
   ```

2. **Jeton dans le chemin de `check` et `accept` : accepté en l'état, avec une amélioration non bloquante.** Le risque est borné : jeton haché en base, à usage unique, avec expiration, et adresse imposée par S17, donc un jeton lu dans un journal ne sert qu'au titulaire de l'adresse invitée. Amélioration à faire la prochaine fois que l'API des invitations est modifiée : passer le jeton dans le corps (`POST /projects/invitations/check` et `/accept` avec `{ token }`), ou exclure ces chemins des journaux d'accès du proxy. **Distinct** de ce point, le défaut de construction de l'URL côté client est traité par S32.
3. **Invitation conservée après une déconnexion par expiration ou par 401 : VALIDÉ.** La fenêtre est d'au plus 30 minutes, dans le même onglet (`sessionStorage`). L'acceptation exige une session complète et une adresse identique (S17), et l'utilisateur peut toujours cliquer « Ignorer ». Seule la déconnexion explicite supprime l'entrée, ce qui est conforme à P13-a. Ce comportement doit être couvert par un test (P13-f).

### Exigences complémentaires pour P9-S et P9-R

Les exigences de r29 restent valables. Compléments :

- **Ordre du lot suivant** :
  1. **S32 et P13-f** (petits ; S32 avant P9-S, qui ajoute une route `POST` sans corps) ;
  2. **P9-S** ;
  3. **P9-R**.
- **P9-S** :
  - `POST /auth/sessions/revoke-others` n'a pas de corps : la route est concernée par S32, qui doit donc être livré avant ;
  - `DELETE /auth/sessions/:sid` est appelé avec `encodeURIComponent(sid)`. Le format de `sid` est validé côté serveur (`ParseUUIDPipe`, ou expression régulière du format de `familyId`), avec un 400 sinon.
- **P9-R** :
  - l'entrée `planner_pending_repo` suit les mêmes règles que l'invitation en attente : `sessionStorage`, échéance, format de `projectId` validé à la lecture, segments encodés ;
  - `repoFullName` est transmis **dans le corps** de `POST /auth/github/sync`, jamais dans un chemin.

### Statut des constats

| ID | Statut r30 |
| --- | --- |
| O19 | **VALIDÉ** |
| P13 (P13-a à P13-e) | **VALIDÉ** ; P13-f (tests, Mineur) ouvert, non bloquant |
| S26, volet `mock/login` | **VALIDÉ** (autres volets de S26 ouverts) |
| **S32** | Nouveau, Mineur (CVSS 3.1), préexistant |
| P9-S, P9-R | Ouverts, non commencés |

**Commit** : le lot O19 et P13 peut être commité. Il comprend les 23 fichiers listés par `git status`, le rapport et le journal ; sans le dossier d'agent local. Changement cassant : `POST /auth/mock/login` renvoie 404 sauf si `NODE_ENV=development` et `ENABLE_DEV_AUTH=true` (à signaler aux développeurs). Aucune migration.

**Constats ouverts à la fin de r30, dans l'ordre de traitement** :

1. S32 et P13-f.
2. P9-S.
3. P9-R, avec le non bloquant r26 « remplacement silencieux ».
4. Session principale : ligne `ENABLE_DEV_AUTH=false` dans `.env.example`.
5. Puis :
   - non bloquant r26 : configuration SSO pour `ssoUid` ;
   - S30, actions d'exploitation 1 à 4 ;
   - Phases 5 et 6 : S19 à S26 (hors volet `mock/login`), A5 à A9, P2, P5, P7, P8, Q-2, O10 à O17.

## Revue r31 — S32 et P13-f : VALIDÉ ; amélioration P13-g (non bloquante) (2026-11-09)

Revue de la section « Lot r30 (fixeur) » du journal. J'ai relu le code, relancé les mesures et joué 15 contre-mutations sur les tests et 4 scénarios sur l'étape CI, hors dépôt. Restauration vérifiée par `filecmp` après chaque mutation, puis `git status --porcelain` et `md5sum` des 26 fichiers modifiés ou nouveaux identiques avant et après ; aucune remise en réserve (`git stash`) restante. Le lot r29, validé en r30, n'est pas revu à nouveau : aucune régression constatée. Aucun commit ; le dossier d'agent local et les fichiers `.env*` n'ont pas été touchés.

**Verdict** :

- **S32 : VALIDÉ.**
- **P13-f : VALIDÉ**, écart CI (`if grep … then exit 1`) accepté.
- **P13-g (Amélioration, non bloquante)** : l'étape CI de contrôle du build passe si le paquet est absent.

### Mesures (relancées par l'architecte)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest`, lancé en même temps que `pnpm test:run` du frontend | **85/85 suites, 2450/2450** |
| `cd frontend && pnpm test:run` ; `tsc --noEmit -p .` ; `pnpm build` | **24 fichiers, 145/145** ; exit 0 ; build OK |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine | **0 erreur** (53 avertissements préexistants) |
| Prettier sur les 8 fichiers de code du lot et `ci.yml` | conforme |

### Contre-mutations de l'architecte

Fichiers de test exécutés : `invitation-store.spec.ts`, `AppContext.invitation.spec.tsx`, `App.invitation-return.spec.tsx`, `InvitationAcceptance.spec.tsx`, `Login.spec.tsx` (50 tests).

| ID | Mutation | Résultat |
| --- | --- | --- |
| AM1 | `isInviteToken` réduit à `typeof value === 'string'` | **Détectée** (15) |
| AM2 | Gardes de `checkInvitation` et `acceptInvitation` retirées, validation du stockage conservée | **Détectée** (5) |
| AM3 | Validation, gardes et encodage retirés (critère r30) | **Détectée** (15) |
| AM4 | Ancres `^` et `$` retirées | **Détectée** (1) |
| AM5 | Expression insensible à la casse (`/i`) | **Détectée** (2) |
| AM6 | Ancre de fin seule retirée | **Détectée** (1) |
| AM7 | Jeton invalide enregistré avant la validation | **Détectée** (9) |
| AM8 | Jeton invalide : retour anticipé, paramètre laissé dans l'URL | **Détectée** (9) |
| AM9 | Entrée invalide non supprimée à la lecture | **Détectée** (3) |
| AM10 | En-tête : `clearPendingInvite()` retiré (FM11) | **Détectée** (1) |
| AM11 | `logout()` efface l'entrée (donc aussi sur `SESSION_EXPIRED_EVENT`) | **Détectée** (1) |
| AM12 | `check` refusé : entrée conservée (FM7) | **Détectée** (1) |
| AM13 | Bandeau fourni sans condition sur `inviteInfo` | **Détectée** (1) |
| AM14 | Encodage seul retiré | Non détectée, **équivalente** : la validation exclut tout caractère à encoder |
| AM15 | `acceptInvitation` appelle la route `check` | **Détectée** (1) |

Étape CI simulée sous `bash --noprofile --norc -eo pipefail` (interpréteur des étapes `run` de GitHub Actions), dans des répertoires de test :

| Scénario | `if grep … exit 1` (lot) | `! grep` en dernière ligne | `! grep` suivi d'une autre commande |
| --- | --- | --- | --- |
| Paquet contenant `mock/login` | échec (1) | échec (1) | **succès (0)** |
| Paquet contenant « Simuler une session » | échec (1) | échec (1) | **succès (0)** |
| Paquet propre | succès (0) | succès (0) | succès (0) |
| **Aucun paquet** (`frontend/dist/assets` absent) | **succès (0)** | **succès (0)** | succès (0) |

### Verdict par point

| Point | Verdict | Preuve |
| --- | --- | --- |
| S32 | **VALIDÉ** | `invitation-store.ts` : `isInviteToken` = `/^[a-f0-9]{64}$/` (le `$` de JavaScript sans drapeau `m` n'accepte pas de saut de ligne final, test dédié). `captureInviteFromUrl` retire toujours le paramètre et n'enregistre ni ne renvoie un jeton invalide ; `readPendingInvite` supprime une entrée invalide. `AppContext.tsx:1486` et `:1497` : refus avant tout `fetch`, puis `encodeURIComponent`. Tests demandés présents (store ; contexte : aucun `fetch` pour 5 jetons dangereux, seules les routes `check`/`accept` pour un jeton valide). AM1 à AM9 et AM15 détectées. Critère d'acceptation satisfait (audit des sources ci-dessous) |
| P13-f | **VALIDÉ** | FM11 (`App.invitation-return.spec.tsx`), conservation sur `SESSION_EXPIRED_EVENT` (`AppContext.invitation.spec.tsx`), FM7 et bandeau conditionnel (`InvitationAcceptance.spec.tsx`) : AM10 à AM13 détectées. Étape CI présente après `pnpm build`, fonctionnelle quand le paquet existe |

**Audit des sources (vérifié par l'architecte)** : dans `frontend/src`, hors tests, l'URL n'est lue que pour `?token=`/`?invite=` (S32), `?verify=`/`?reset=` (`account-api.ts`, transmis dans le corps d'un `POST`) et `?code=`/`?state=`/`?error=` (`App.tsx:99-112`, transmis dans le corps de `/auth/github/login` et `/auth/sso/callback`). Le stockage n'est lu que pour `planner_theme`, `planner_user` (profil ; `user.id` ne sert que dans une clé locale et des comparaisons), `planner_admin_original_session` (bannière) et l'invitation en attente. Les actions de la barre IA (`AiCommandBar.tsx`) sont envoyées dans le corps d'`executeAiActions`, pas dans un chemin. Aucune autre valeur venue de l'URL, du stockage ou d'une réponse de modèle n'atteint un chemin d'API.

#### P13-g (Amélioration, non bloquante) : contrôle CI du build ouvert en cas d'absence du paquet

- **Fichier** : `.github/workflows/ci.yml`, étape « Aucune connexion simulée dans le build de production ».
- **Cause** : si le motif `frontend/dist/assets/*.js` ne correspond à aucun fichier (sortie du build déplacée, renommage de `outDir`), `grep` sort en 2, la condition `if` est fausse et l'étape réussit sans rien contrôler. La forme `! grep` demandée en r30 avait le même défaut.
- **Impact** : faible. Le contrôle deviendrait silencieusement inopérant après une modification de la configuration de Vite. Les autres défenses (`import.meta.env.DEV`, 404 côté serveur hors développement) restent en place.
- **Remédiation attendue** : ajouter en première ligne du bloc `run` : `ls frontend/dist/assets/*.js > /dev/null`.
- **Critère d'acceptation** (vérifié par l'architecte sur la forme proposée) : sortie 2 sans paquet, 0 sur un build propre, 1 si l'une des deux chaînes est présente.

### Réponses aux questions du fixeur

1. **Autres segments de chemin non encodés : accepté, pas de lot dédié.** Les valeurs listées (`copilot/alerts?workspaceId=`, `briefing?workspaceId=`, `deliverables/…/status/${status}`, `audit/logs?limit=`) viennent de l'état de l'application ou des réponses de l'API, que l'utilisateur ne contrôle pas par un lien. Le critère d'acceptation de S32 est donc satisfait, et un encodage généralisé n'apporterait aujourd'hui qu'un gain de robustesse, sans réduction de risque mesurable. Règle de conduite, à appliquer sans lot spécifique : tout appel modifié ou ajouté encode ses segments de chemin (`encodeURIComponent`) et ses paramètres de requête (`URLSearchParams`) ; toute nouvelle valeur venue de l'URL ou du stockage est validée par format avant usage (déjà exigé pour P9-S et P9-R). Un utilitaire de construction d'URL commun pourra être introduit avec A5 à A9 (Phase 5), pas avant.
2. **CI : `if grep … then exit 1` au lieu de `! grep` : accepté**, l'écart est retenu dans le rapport. Précision factuelle : `! grep` seul fonctionne s'il est la **dernière** commande du bloc (le code de sortie de l'étape est celui de la dernière commande), mais il est ignoré par `-e` dès qu'une commande le suit. La forme `if` est robuste dans les deux cas. Elle partage le défaut corrigé par P13-g.

### Statut des constats

| ID | Statut r31 |
| --- | --- |
| S32 | **VALIDÉ** |
| P13-f | **VALIDÉ** ; P13 clos |
| P13-g | Nouveau, Amélioration, non bloquant |
| Ligne `ENABLE_DEV_AUTH=false` dans `.env.example` (question 1 de r30) | **Faite** par la session principale (présente dans le working tree) |
| P9-S, P9-R | Ouverts, non commencés |

**Commit** : **feu vert pour le lot r29 + r30.** Il comprend les fichiers listés par `git status` (y compris `.env.example`), le rapport et le journal, sans le dossier d'agent local. P13-g peut y être ajouté s'il est fait avant (une ligne dans `ci.yml`), sinon il passe dans le lot suivant. Changement cassant à signaler aux développeurs (rappel r30) : `POST /auth/mock/login` renvoie 404 sauf si `NODE_ENV=development` et `ENABLE_DEV_AUTH=true`. Aucune migration.

**r31-bis (P13-g) : VALIDÉ.** Bloc `run` réel de `ci.yml` exécuté sous `bash --noprofile --norc -eo pipefail` : sans paquet, exit 2 ; build propre, exit 0 ; chaîne interdite présente, exit 1. P13-g clos ; le feu vert de commit couvre le lot r29 + r30 + P13-g.

**Constats ouverts à la fin de r31, dans l'ordre de traitement** :

1. ~~P13-g~~ : VALIDÉ en r31-bis.
2. P9-S, selon les exigences de r29 et r30 (`sid` encodé et validé côté serveur, 400 sinon).
3. P9-R, avec le non bloquant r26 « remplacement silencieux » ; `planner_pending_repo` validé à la lecture, `repoFullName` dans le corps.
4. Puis :
   - non bloquant r26 : configuration SSO pour `ssoUid` ;
   - non bloquant r30 : jeton d'invitation dans le corps de `check`/`accept` à la prochaine modification de l'API des invitations ;
   - S30, actions d'exploitation 1 à 4 ;
   - Phases 5 et 6 : S19 à S26 (hors volet `mock/login`), A5 à A9, P2, P5, P7, P8, Q-2, O10 à O17.

## Revue r32 — P9-S, « Sessions actives » : VALIDÉ ; nouveaux constats P9-S-a et O20, non bloquants (2026-11-09)

Revue de la section « Lot P9-S (fixeur) » du journal. Le lot r29, r30 et P13-g est commité (`798f1df`) ; le working tree ne contient que P9-S (12 fichiers de code et de test, plus le journal). Exigences de référence : P9 (r4), r29 (§ « P9-S »), r30 (« Exigences complémentaires »), r31 (segments encodés, valeurs lues validées), S7-a (cache invalidé) et S18.2 (routes interdites en impersonation). J'ai relu le code, relancé les mesures et joué 27 contre-mutations, plus 2 témoins sans mutation, hors dépôt. Restauration vérifiée par `filecmp` après chaque essai, puis `git status --porcelain` et `md5sum` des 13 fichiers identiques avant et après ; aucun stash. Aucun commit ; le dossier d'agent local et les fichiers `.env*` n'ont pas été touchés.

**Verdict** :

- **P9-S : VALIDÉ.**
- **P9-S-a (Amélioration, non bloquant)** : le nombre de sessions fermées peut inclure des sessions expirées.
- **O20 (Mineur, outillage de test, non bloquant)** : délais de 5 s dépassés quand les deux suites tournent ensemble sur une machine saturée.

### Mesures (relancées par l'architecte)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` (seul) | **85/85 suites, 2462/2462** |
| `nest build` | exit 0 |
| `cd frontend && pnpm test:run` (seul) ; `tsc --noEmit -p .` ; `pnpm build` | **25 fichiers, 156/156** ; exit 0 ; build OK |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine ; Prettier sur les fichiers de code du lot | **0 erreur** (53 avertissements préexistants) ; conforme |
| Les deux suites lancées **ensemble**, 3 essais, charge de la machine de 15 à 18 sur 4 cœurs (processus extérieurs au projet) | Essai 1 : backend 2 échecs (1 suite), frontend vert. Essai 2 : backend vert, frontend 1 échec (`App.link-notice.spec.tsx`). Essai 3 : backend 1 échec (`session-lifecycle.spec.ts`, test S31 `firebase/link`), frontend 3 échecs (`App.link-notice`, `IdentitiesSection`, `SecurityPage` MFA). **Tous sont des dépassements du délai de 5 s**, aucun n'est une assertion. Voir O20 |

### Contre-mutations de l'architecte

Fichiers exécutés : backend `tests/http/session-lifecycle.spec.ts` et `tests/unit/auth/impersonation-routes.spec.ts` (106 tests) ; frontend `SessionsSection.spec.tsx`, `SecurityPage.spec.tsx` et `App.link-notice.spec.tsx` (23 tests). Les deux témoins sans mutation sont verts (106/106 et 23/23), et les noms des tests en échec ont été vérifiés : les détections ne sont pas des dépassements de délai.

| ID | Mutation | Résultat |
| --- | --- | --- |
| BM1 | `ParseUUIDPipe` retiré | **Détectée** (1 : test 400) |
| BM2 | 409 de la session courante retiré | **Détectée** (1) |
| BM3 | `sid` non mis en minuscules | **Détectée** (1 : contournement du 409 par la casse) |
| BM4 | `revoke-others` sans exclusion de la session courante | **Détectée** (2) |
| BM5 | `revokeAllForUser` sans filtre `userId` | **Détectée** (1) |
| BM6 | `revoke()` sans invalidation du cache Redis (S7-a) | **Détectée** (4) |
| BM7 | `revokeOwnSession` sans filtre `userId` (IDOR) | **Détectée** (1) |
| BM8 | Entrée d'audit `SESSIONS_REVOKED` supprimée | **Détectée** (1) |
| BM9 ; BM12 | `@ForbiddenInImpersonation()` retiré de `revoke-others` ; du `DELETE` | **Détectées** (3 ; 3) |
| BM10 | `@Throttle` du `DELETE` retiré | **Détectée** (1) |
| BM11 | Code 201 au lieu de 200 pour `revoke-others` | **Détectée** (1) |
| BM13 | Jeton de rafraîchissement ajouté dans `changes` de l'audit | **Détectée** (1) |
| FM1 | `sid` non encodé dans le chemin | **Détectée** (1) |
| FM2 | Impersonation ignorée (actions visibles) | **Détectée** (1) |
| FM3 | « Révoquer » proposé sur la session courante | **Détectée** (4) |
| FM4 ; FM5 | Pas de relecture de la liste après une erreur ; après une révocation | **Détectées** (1 ; 1) |
| FM6 | `revoke-others` envoyé avec un corps | **Détectée** (2) |
| FM7 ; FM8 | Pas de proposition après l'activation de la MFA ; `onSessionsClosed` non appelé | **Détectées** (1 ; 1) |
| FM9 | « Fermer les autres sessions » affiché sans autre session | **Détectée** (2) |
| FM10 | Révocation sans confirmation | **Détectée** (3) |
| FM11 | Troncature du `User-Agent` à 200 caractères | **Détectée** (1) |
| FM12 | Notice sans le nombre de sessions | **Détectée** (1) |
| FM13 | `refreshKey` ignoré (liste non relue après la fermeture depuis `SecurityPage`) | **Détectée** (1) |

### Verdict par point

| Exigence | Verdict | Preuve |
| --- | --- | --- |
| `POST /auth/sessions/revoke-others` : `revokeAllForUser(userId, sid)`, `{ revoked }`, `@ForbiddenInImpersonation()`, `@Throttle` 5/min, sans réauthentification ni corps | **VALIDÉ** | `auth.controller.ts`, `AuthService.revokeOtherSessions` ; BM4, BM5, BM9, FM6. `req.user.sid` est toujours présent : `verifyAccess` exige une session active liée au `sid` |
| Audit `SESSIONS_REVOKED` (nombre, `sid`, aucun jeton) | **VALIDÉ** | BM8, BM13 |
| `DELETE /auth/sessions/:sid` : `@Throttle` 10/min, 409 sur la session courante, `sid` validé côté serveur (400), encodé côté client (r30) | **VALIDÉ** | `ParseUUIDPipe` ; normalisation en minuscules avant la comparaison **et** avant la recherche, ce qui ferme le contournement du 409 par la casse sous une collation insensible à la casse et garde la clé de cache cohérente (les `familyId` sont des `randomUUID()` en minuscules). BM1 à BM3, BM10, BM12, FM1 |
| Isolation entre comptes ; jeton d'accès de la session révoquée refusé au tour suivant (S7-a) | **VALIDÉ** | BM5, BM6, BM7 |
| Couverture S18.2 (liste paramétrée et balayage méta) | **VALIDÉ** | `impersonation-routes.spec.ts` |
| Frontend `SessionsSection` : appareil lisible (repli à 120 caractères), dates, badge, « Révoquer » avec confirmation sur les autres sessions seulement, « Fermer les autres » si nécessaire, notice avec le nombre, relecture après une action ou une erreur, actions masquées en impersonation | **VALIDÉ** | FM2 à FM5, FM9 à FM13. Rendu par React, sans `dangerouslySetInnerHTML` : le `User-Agent`, contrôlé par le client, est échappé |
| Proposition « Fermer les autres sessions » après l'activation de la MFA (r21 point 3) | **VALIDÉ** | `SecurityPage.tsx`, après l'enregistrement des codes de récupération ; FM7, FM8 |

**Écarts signalés par le fixeur : acceptés.** `revoke-others` répond 200 : c'est une action, pas une création, donc 200 avec `{ revoked }` est correct. `DELETE` répond 400 si le `sid` n'est pas un UUID et 409 sur la session courante, conformément à r29 et r30. Le changement cassant est sans appelant existant. Remédiation de P9-S mise à jour en conséquence : `revoke-others` répond **200**.

### Nouveaux constats r32

#### P9-S-a (Amélioration, non bloquant) : nombre de sessions fermées gonflé par les sessions expirées

- **Fichier** : `backend/src/auth/session.service.ts:252-262` (`revokeAllForUser`), appelé par `AuthService.revokeOtherSessions`.
- **Cause** : la requête retient les familles `revokedAt: null` sans filtre `expiresAt`, alors que la liste (`listForUser`) exclut les sessions expirées.
- **Impact** : produit seulement. Un utilisateur qui voit une seule autre session peut lire « 6 sessions fermées », ce qui l'inquiète sans raison. Le même chiffre est enregistré dans l'audit. Aucun effet de sécurité : une session expirée est déjà refusée par `isSessionActive` et par le rafraîchissement (`session.service.ts:173`).
- **Remédiation attendue** : ajouter `expiresAt: { gt: new Date() }` au filtre de `revokeAllForUser`. Comme une session expirée est déjà inerte, ce filtre ne change pas le comportement de sécurité des autres appelants (suspension, mot de passe, déliaison).
- **Test attendu** : avec une autre session active et une session expirée non révoquée, `revoke-others` renvoie `{ revoked: 1 }` et l'audit enregistre `count: 1`.
- À faire avec P9-R, ou plus tôt.

#### O20 (Mineur, outillage de test, non bloquant) : délais de 5 s dépassés quand les suites tournent ensemble sur une machine saturée

- **Constat** : voir la dernière ligne du tableau des mesures. Ces échecs sont tous des dépassements du délai par défaut (5 s de Jest et de Vitest), dans des tests HTTP ou de rendu d'`App` lourds. La plupart sont antérieurs à ce lot ; `session-lifecycle.spec.ts` prend désormais 71 s à lui seul. Chaque suite est verte quand elle tourne seule.
- **Impact** : faux négatifs en CI ou sur un poste chargé ; risque qu'on prenne l'habitude d'ignorer un échec.
- **Remédiation attendue** : `testTimeout: 15000` dans la configuration Jest du backend et dans `vitest.config` du frontend. Ne pas monter un délai test par test.
- **Critère d'acceptation** : deux exécutions simultanées des deux suites, sur la même machine chargée, sont vertes.
- Il ne s'agit pas d'une régression d'O19 : la borne temporelle de `mfa-ticket.spec.ts` est restée verte à chaque essai.

### Réponses aux questions du fixeur

1. **Sessions d'impersonation indistinguables dans la liste : accepté en l'état, pas de migration maintenant.** Qu'elles soient visibles et fermées par `revoke-others` est souhaitable : la personne ciblée voit et peut couper l'accès. L'impersonation reste désactivée (`FEATURE_IMPERSONATION_ENABLED=false`) jusqu'à la clôture de S18. L'indicateur est ajouté à S18 (Phase 4, avec S18.1 et S18.3) :
   - colonne `impersonatedBy` sur `RefreshToken` (migration) ;
   - libellé « Session d'assistance d'un administrateur » dans la liste.

   Ce n'est pas une condition de P9-S.
2. **Masquage côté client fondé sur `planner_admin_original_session` : accepté**, c'est de l'ergonomie, et le serveur reste l'autorité (403, BM9 et BM12). Limite connue : dans un nouvel onglet ouvert pendant une impersonation, la clé est absente, donc les boutons s'affichent et le clic se solde par un 403 affiché comme une erreur, ce qui est acceptable. À faire avec S18 : fournir l'information par le serveur (`impersonated: true` sur l'élément `current` de `GET /auth/sessions`, sans migration, à partir de `req.user.impersonatedBy`) et ne plus lire le stockage.
3. **`revokeOwnSession` sur une session expirée non révoquée : accepté**, sans effet de sécurité. La session est inerte et n'est pas atteignable par l'interface, et l'isolation par `userId` est conservée (BM7). Le défaut voisin, le décompte, est traité par P9-S-a.

### Statut des constats

| ID | Statut r32 |
| --- | --- |
| P9-S | **VALIDÉ** |
| P9-S-a | Nouveau, Amélioration, non bloquant |
| O20 | Nouveau, Mineur (outillage de test), non bloquant |
| S18 | Complété : indicateur de session d'impersonation et information fournie par le serveur (Phase 4) |
| P9-R | Ouvert, non commencé |

**Commit** : **feu vert pour le lot P9-S.** Il comprend les 12 fichiers de code et de test listés par `git status`, le rapport et le journal, sans le dossier d'agent local. Changements cassants mineurs : `DELETE /auth/sessions/:sid` répond 400 pour un `sid` non UUID et 409 pour la session courante (auparavant 204). Aucun appelant existant n'est touché. Aucune migration.

**Constats ouverts à la fin de r32, dans l'ordre de traitement** :

1. P9-R, avec le non bloquant r26 « remplacement silencieux » (exigences r29 et r30 : `planner_pending_repo` validé à la lecture, `repoFullName` dans le corps).
2. P9-S-a et O20 (petits, non bloquants), avec P9-R ou avant.
3. Puis :
   - non bloquant r26 : configuration SSO pour `ssoUid` ;
   - non bloquant r30 : jeton d'invitation dans le corps de `check`/`accept` ;
   - S30, actions d'exploitation 1 à 4 ;
   - Phases 4 à 6 : S18 (avec les compléments r32), S19 à S26 (hors volet `mock/login`), A5 à A9, P2, P5, P7, P8, Q-2, O10 à O17.


## Revue r33 — P9-S-a et O20 : VALIDÉ ; P9-R « Connecter un dépôt » : À REPRENDRE, points mineurs (2026-11-09)

Revue de la section « Lot r32 (fixeur) » du journal (working tree, rien de commité). Exigences de référence : P9-R (r4), r29, r30, r31 (segments encodés, valeurs lues validées), non bloquant r26 « remplacement silencieux ». J'ai relu le code (`git diff`), relancé les mesures et joué 29 contre-mutations hors dépôt. Fichier restauré et `md5sum` vérifié après chaque essai, puis `md5sum` de l'ensemble des fichiers modifiés ou ajoutés identiques avant et après. Le dossier d'agent local et les fichiers `.env*` n'ont pas été touchés.

**Verdict** :

- **P9-S-a : VALIDÉ.**
- **O20 : VALIDÉ** (essai sous charge rejoué, voir ci-dessous).
- **P9-R : À REPRENDRE.** La sécurité est conforme (droit, vérification chez GitHub, nom canonique, 409, corps validé, jeton sans fuite). Il reste un défaut de comportement (P9-R-a) et deux trous de test (P9-R-b).

### Mesures (relancées par l'architecte)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` et `cd frontend && pnpm test:run`, **lancés ensemble** | **86/86 suites, 2495/2495** ; **28 fichiers, 195/195** |
| Mêmes deux suites ensemble, **2 essais avec 8 processus de charge** (charge de la machine de 15 à 17 sur 4 cœurs) | **Verts les deux fois** (86/86, 2495/2495 ; 28 fichiers, 195/195). Les essais de r32 échouaient 3 fois sur 3 dans des conditions comparables |
| `nest build` ; `tsc --noEmit -p tests/tsconfig.json` | exit 0 ; exit 0 |
| `cd frontend && tsc --noEmit -p .` ; `pnpm build` | exit 0 ; build OK |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine ; Prettier sur tous les fichiers modifiés ou ajoutés | 0 erreur (53 avertissements préexistants) ; conforme |

### Contre-mutations de l'architecte

Backend : `github-repos.spec.ts`, `identity-linking.spec.ts`, `session-lifecycle.spec.ts`, `impersonation-routes.spec.ts` (181 tests). Frontend : `pending-repo`, `GitHubRepoConnector`, `App.repo-return`, `GovernanceView`, `IntegrationsPanel`, `GitHubLinkConfirm` (54 tests).

| ID | Mutation | Résultat |
| --- | --- | --- |
| B1 | Filtre `expiresAt` retiré (P9-S-a) | **Détectée** (1) |
| B2 ; B3 | `Matches` retiré du DTO ; lookahead `.`/`..` retiré | **Détectées** (8 ; 2) |
| B4 | `assertProject` retiré | **Détectée** (1) |
| B5 | Statut GitHub non vérifié | **Détectée** (4) |
| B6 | Saisie enregistrée au lieu du nom canonique | **Détectée** (1) |
| B7 ; B8 | Erreur réseau non traduite (503) ; signal de délai retiré (`sync`) | **Détectées** (1 ; 1) |
| B9 ; B10 | 409 GitHub retiré ; 409 Firebase retiré | **Détectées** (2 ; 1) |
| B14 | 409 même pour la **même** identité | **Détectée** (1) |
| B11 ; B12 | `@ForbiddenInImpersonation()` retiré de `sync` ; `@Throttle` retiré de `repos` | **Détectées** (2 ; 1) |
| B15 | Nom canonique non validé | **Détectée** (1) |
| B13 | `encodeURIComponent` retiré | **Survit : équivalente** (le format validé ne contient aucun caractère à encoder) |
| B16 | Contrôle du format dans le service retiré (le DTO reste) | **Survit : équivalente** (le service n'est atteint que par la route, déjà validée) |
| F1 ; F2 ; F3 | Format non validé à la lecture ; échéance ignorée ; durée de 24 h | **Détectées** (5 ; 3 ; 1) |
| F4 ; F5 | 401 retiré de la liste des détours ; 500 et 503 ajoutés | **Détectées** (1 ; 1) |
| F6 | `repoFullName` placé dans l'URL | **Détectée** (1) |
| F7 ; F8 | Reprise pour toute finalité ; annulation sans nettoyage | **Détectées** (1 ; 1) |
| F9 | Bouton pour tout non-VIEWER | **Détectée** (1) |
| F10 ; F11 | Ouverture automatique répétée ; ouverture sans le droit | **Détectées** (1 ; 1) |
| **F12** | Dépôt affiché = sélection au lieu de la réponse du serveur | **Survit** (voir P9-R-b) |
| **F13** | `onLinked` ne relit plus les données (`refreshData`) | **Survit** (voir P9-R-b) |

### Verdict par point

| Exigence | Verdict | Preuve |
| --- | --- | --- |
| P9-S-a : `revokeAllForUser` ignore les sessions expirées | **VALIDÉ** | B1 ; test `{ revoked: 1 }` et audit `count: 1`. Aucun effet pour les autres appelants : une session expirée est déjà inerte |
| O20 : `testTimeout: 15000` (Jest, Vitest), pas de délai par test | **VALIDÉ** | `backend/package.json`, `frontend/vite.config.ts` ; 2 essais verts sous charge ci-dessus |
| `GithubSyncDto`, droit `project.manage`, vérification chez GitHub (jeton de l'utilisateur, 5 s, segments encodés, statut 200, nom canonique enregistré, aucune écriture en échec) | **VALIDÉ** | B2 à B8, B15 |
| `@Throttle` 10/min sur `repos` et `sync` | **VALIDÉ** | B12 et test des limites |
| Non bloquant r26 : 409 « Déliez d'abord… » (GitHub `link` et `repos`, et Firebase), avant toute écriture, même identité permise | **VALIDÉ** | B9, B10, B14. Non bloquant r26 « remplacement silencieux » **clos**. Reste ouvert : configuration SSO pour `ssoUid` |
| `planner_pending_repo` : `sessionStorage`, échéance de 15 min, format validé à la lecture, entrée altérée supprimée ; `repoFullName` dans le corps | **VALIDÉ** | F1 à F3, F6 |
| Parcours frontend : détour 400/403, reprise sur le projet en attente, ouverture unique, rappel des dépôts privés | **VALIDÉ** pour l'essentiel | F4 à F11 ; trous F12 et F13 |
| Comportement de `github/repos` quand GitHub répond autre chose que 200 | **À REPRENDRE** | P9-R-a |

### Nouveaux constats r33

#### P9-R-a (Mineur) : tout échec de GitHub devient un 401, donc un détour d'autorisation

- **Fichier** : `backend/src/auth/auth.service.ts`, `getGitHubRepositories` (`if (!response.ok) throw new UnauthorizedException(...)`) et `frontend/src/components/GitHubRepoConnector.tsx` (`[400, 401, 403]`).
- **Cause** : une panne de GitHub (5xx), une limite de débit (403/429) ou un jeton révoqué (401) donnent le même 401. Le composant en déduit un jeton à renouveler et envoie l'utilisateur vers GitHub. Un 401 est en outre indiscernable d'une session Planner-Pro expirée (rotation et rejeu côté `fetch`, puis événement de fin de session).
- **Impact** : parcours trompeur pendant un incident GitHub, redirections inutiles, ambiguïté avec la session. Pas de fuite ni d'écriture.
- **Remédiation attendue** :
  - `getGitHubRepositories` : réponse GitHub 401 -> **403** « Jeton GitHub invalide ou révoqué » ; autre statut non 200 -> **503** (comme le délai réseau). Un 401 de cette route ne signifie plus que « session expirée » ;
  - frontend : détour vers GitHub seulement pour 400 et 403 ; 401 retiré de la liste (il suit le traitement normal de la session) ; 503 : message, aucun détour (déjà couvert par F5).
- **Tests attendus** : backend, GitHub 401 -> 403, 500 et 429 -> 503, jeton absent -> 400 ; frontend, 401 et 503 sans détour, 400 et 403 avec détour.

#### P9-R-b (Mineur, tests) : deux comportements de l'interface sans test

- **F12** : le dépôt affiché après la liaison doit être `githubRepo` renvoyé par le serveur (nom canonique). Le test actuel renvoie la même valeur que la sélection, donc une version qui affiche la sélection passe. **Test attendu** : réponse de `sync` différente de la sélection (par exemple `Acme/Web` pour `acme/web`), et le texte « Dépôt lié : » affiche la réponse.
- **F13** : après une liaison, `refreshData` doit être appelé (sinon le projet affiché garde l'ancien `githubRepo` quand on change de projet et qu'on revient). **Test attendu** : dans `IntegrationsPanel.spec.tsx`, après « Lier … », `refreshData` est appelé une fois.

### Écarts déclarés par le fixeur

1. **Regex excluant `.` et `..` : accepté.** Conforme à la règle de r31 (valeurs validées par format). `encodeURIComponent` ne neutralise pas les points, donc le lookahead est utile ; B3 le prouve.
2. **`@ForbiddenInImpersonation()` sur `github/repos` et `github/sync` : accepté, et c'est la bonne décision.** Ces routes utilisent le jeton GitHub du compte ciblé et exposent ses dépôts privés, comme `link` et `unlink` (S18.2). La liste attendue et le balayage méta sont à jour. Limite côté interface : en impersonation le bouton s'affiche et le 403 déclenche le détour GitHub. C'est traité avec S18 (voir plus bas), sans effet de sécurité.
3. **409 étendu à `firebase/link` : accepté.** Le non bloquant r26 visait les deux identités ; B10 et B14 le couvrent.
4. **503 sur délai ou erreur réseau de GitHub : accepté.** Erreur de service tiers, sans écriture ; cohérent avec le 503 de la MFA sur délai Redis.
5. **Dépendance `AuthService` -> `PolicyService` : acceptée.** `AuthzModule` est `@Global()` et exporte `PolicyService`, il n'importe pas `AuthService` : aucun cycle, `nest build` et les 86 suites sont verts. Elle évite de dupliquer la matrice de droits, ce qui aurait recréé le défaut « droit limité au créateur ».

### Réponses aux questions du fixeur

1. **Qui voit « Connecter un dépôt » : décision produit, recommandation à confirmer par l'utilisateur.** Recommandation : **exposer `myRole` (ou `canManage`) par projet**, calculé par `PolicyService` dans la charge utile des projets, puis lire cette valeur à la place du rôle de workspace. L'heuristique actuelle (OWNER et ADMIN) échoue du bon côté (le serveur reste l'autorité, B4) mais masque la fonction à un MANAGER par `ProjectMembership`. En pratique l'onglet Intégrations est lui-même caché aux VIEWER et ses routes exigent ADMIN : le gain est modeste. **Pas de lot dédié maintenant** : à faire avec les compléments de S18 (même besoin de fournir une information calculée par le serveur) ou avec A5 à A9. Décision à confirmer par l'utilisateur : lot dédié maintenant, ou différé.
2. **401 de GitHub indiscernable d'une session expirée : non acceptable tel quel**, voir P9-R-a (403 dédié pour le jeton GitHub invalide, 503 pour le reste, 401 retiré de la liste des détours).
3. **`encodeURIComponent` sans test : accepté.** B13 est une mutation équivalente tant que le format est validé ; ne pas écrire de test artificiel. Garder l'encodage et le lookahead (règle de r31).
4. **Échéance de `planner_pending_repo` : suffisante.** `sessionStorage` (par onglet), 15 min, format validé à la lecture, supprimée à la consommation ou à l'annulation ; la valeur n'est qu'un identifiant de projet, sans secret. Amélioration facultative, sans lot : la supprimer aussi à la déconnexion.
5. **O20 sous charge : rejoué et validé.** Deux essais, deux suites ensemble, 8 processus de charge : verts. Voir le tableau des mesures. La limite (pas de test sous charge à 18) est levée.

### Statut des constats

| ID | Statut r33 |
| --- | --- |
| P9-S-a | **VALIDÉ** |
| O20 | **VALIDÉ** |
| P9-R | **À REPRENDRE** (P9-R-a, P9-R-b) ; le reste de P9-R est conforme |
| P9-R-a | Nouveau, Mineur |
| P9-R-b | Nouveau, Mineur (tests) |
| Non bloquant r26, remplacement silencieux d'une identité liée | **VALIDÉ, clos** (reste : configuration SSO pour `ssoUid`) |
| S18 | Complété : en impersonation, masquer « Connecter un dépôt » (information `impersonated` fournie par le serveur, comme pour `SessionsSection`) |

### Commit

**Pas de feu vert pour l'instant.** Les corrections P9-R-a et P9-R-b sont petites ; P9-S-a, O20 et P9-R ne peuvent pas être commités séparément, car `AuthService` dépend désormais de `PolicyService` (le fournisseur est ajouté dans 13 fichiers de test, dont `session-lifecycle.spec.ts`). Après revue de la reprise, un seul commit, avec les fichiers suivants (36 entrées de `git status`, sans le dossier d'agent local) :

- Backend source : `backend/package.json`, `src/auth/auth.controller.ts`, `src/auth/auth.service.ts`, `src/auth/dto/github.dto.ts`, `src/auth/session.service.ts`, `src/auth/auth.service.spec.ts`.
- Backend tests : `tests/http/{account-routes,csrf-origin,impersonation-case,mfa-ticket,session-lifecycle}.spec.ts`, `tests/http/github-repos.spec.ts` (nouveau), `tests/unit/auth/{account-lifecycle,enumeration-timing,github-oauth,identity-linking,impersonation-routes,login-policy,mfa-lifecycle,mfa-redis-timeout}.spec.ts`.
- Frontend : `vite.config.ts`, `src/App.tsx`, `src/App.repo-return.spec.tsx`, `src/github-repos.ts`, `src/pending-repo.ts`, `src/pending-repo.spec.ts`, `src/components/{GitHubLinkConfirm,GitHubLinkConfirm.spec,GovernanceView,GovernanceView.spec,IntegrationsPanel,IntegrationsPanel.spec}.tsx`, `src/components/GitHubRepoConnector.tsx` et `.spec.tsx`.
- Documentation : `docs/security/rapport-audit.md` et `docs/security/journal-corrections.md`.

Changements cassants (déjà déclarés, aucun appelant existant) : `sync` rejette un corps non conforme et un dépôt inaccessible (400) ; `repos` et `sync` répondent 403 en impersonation ; `link` répond 409 si une autre identité est déjà liée ; après P9-R-a, `repos` répondra 403 (jeton GitHub invalide) ou 503 au lieu de 401. Aucune migration.

**Constats ouverts à la fin de r33, dans l'ordre de traitement** :

1. **P9-R-a**, puis **P9-R-b** (petits, ensemble, puis une revue courte).
2. Puis, inchangés :
   - non bloquant r26 : configuration SSO pour `ssoUid` ;
   - non bloquant r30 : jeton d'invitation dans le corps de `check` et `accept` ;
   - S30, actions d'exploitation 1 à 4 ;
   - Phases 4 à 6 : S18 (avec les compléments r32 et r33), S19 à S26 (hors volet `mock/login`), A5 à A9, P2, P5, P7, P8, Q-2, O10 à O17. La décision sur `myRole` / `canManage` est à prendre avec S18 ou A5 à A9.

## Revue r34 — P9-R-a, P9-R-b et donc P9-R : VALIDÉ ; feu vert pour le commit unique (2026-11-09)

Revue de la section « Reprise r33 (fixeur) » du journal (working tree, rien de commité). J'ai relu le code (`getGitHubRepositories`, `GitHubRepoConnector.tsx`, `IntegrationsPanel.tsx`), relancé les mesures et joué mes contre-mutations hors dépôt. `md5sum` des 36 entrées de `git status` (sans le dossier d'agent local) identique avant et après ; le dossier d'agent local et les `.env*` n'ont pas été touchés.

### Mesures (relancées par l'architecte)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **86/86 suites, 2503/2503** |
| `cd frontend && pnpm test:run` | **28 fichiers, 197/197** |
| `nest build` ; `tsc --noEmit -p tests/tsconfig.json` ; frontend `tsc --noEmit -p .` ; `pnpm build` | exit 0 partout |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine ; Prettier sur les fichiers de code modifiés ou ajoutés | 0 erreur (53 avertissements préexistants) ; conforme. Les deux fichiers `.md` de `docs/security` sont signalés par Prettier, y compris dans leur version de `HEAD` : préexistant, sans lien avec ce lot |

### Contre-mutations de l'architecte

| ID | Mutation | Résultat |
| --- | --- | --- |
| M1 | GitHub 401 renvoyé en 401 (`UnauthorizedException`) | **Détectée** (1) |
| M2 | Branche 401 retirée (donc 503) | **Détectée** (1) |
| M3 | Statut non 200 ignoré (la réponse est lue) | **Détectée** (5) |
| M4 | Autres échecs renvoyés en 401 | **Détectée** (5) |
| M5 | Frontend : 401 relance le détour | **Détectée** (1) |
| M6 | Frontend : 403 sans détour | **Détectée** (1) |
| M7 | Frontend : 400 sans détour | **Détectée** (2) |
| M8 | Frontend : 503 relance le détour | **Détectée** (1) |
| F12 | Dépôt affiché = sélection au lieu de la réponse du serveur | **Détectée** (1) |
| F13 | `onLinked` ne relit plus les données | **Détectée** (1) |
| F13b | `refreshData` appelé deux fois | **Détectée** (1) |

Incident d'outillage de mon côté (sans effet sur le code) : un premier lot de mutations a laissé un fichier muté un court instant (alias `cp -i` bloquant, processus concurrent). Je l'ai restauré à la main et vérifié : `md5sum` des 36 fichiers identique à la mesure prise avant mes essais, puis rejoué toutes les mutations backend séquentiellement avec les bons numéros de ligne.

### Verdict

| Constat | Verdict | Preuve |
| --- | --- | --- |
| P9-R-a : `github/repos` ne répond plus 401 ; 403 (jeton GitHub invalide), 503 (autre échec) ; détour frontend limité à 400 et 403 | **VALIDÉ** | Code relu, M1 à M8, tests backend (+8) et frontend |
| P9-R-b : tests F12 et F13 | **VALIDÉ** | F12, F13, F13b détectées |
| **P9-R « Connecter un dépôt »** | **VALIDÉ** | Toutes les exigences de la revue r33 sont couvertes |

### Statut des constats

| ID | Statut r34 |
| --- | --- |
| P9-S-a | **VALIDÉ** (r33) |
| O20 | **VALIDÉ** (r33) |
| P9-R, P9-R-a, P9-R-b | **VALIDÉ, clos** |
| Non bloquant r26, remplacement silencieux d'une identité liée | **Clos** (reste : configuration SSO pour `ssoUid`) |

### Commit : feu vert, un seul commit

Les 36 entrées de `git status` (sans le dossier d'agent local, qui reste hors de git) forment un lot indivisible, car `AuthService` dépend de `PolicyService` :

- Backend source (6) : `backend/package.json`, `backend/src/auth/{auth.controller,auth.service,auth.service.spec,session.service}.ts`, `backend/src/auth/dto/github.dto.ts`.
- Backend tests (17) : `backend/tests/http/{account-routes,csrf-origin,impersonation-case,mfa-ticket,session-lifecycle}.spec.ts`, `backend/tests/http/github-repos.spec.ts` (nouveau), `backend/tests/unit/auth/{account-lifecycle,enumeration-timing,github-oauth,identity-linking,impersonation-routes,login-policy,mfa-lifecycle,mfa-redis-timeout}.spec.ts`.
- Frontend (11) : `frontend/vite.config.ts`, `frontend/src/App.tsx`, `frontend/src/App.repo-return.spec.tsx` (nouveau), `frontend/src/github-repos.ts` (nouveau), `frontend/src/pending-repo.ts` et `.spec.ts` (nouveaux), `frontend/src/components/{GitHubLinkConfirm,GitHubLinkConfirm.spec,GovernanceView,GovernanceView.spec,IntegrationsPanel,IntegrationsPanel.spec}.tsx`, `frontend/src/components/GitHubRepoConnector.tsx` et `.spec.tsx` (nouveaux).
- Documentation (2) : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`.

Changements cassants : `sync` rejette un corps non conforme et un dépôt inaccessible (400) ; `repos` et `sync` répondent 403 en impersonation ; `link` (GitHub et Firebase) répond 409 si une autre identité est déjà liée ; `GET /auth/github/repos` répond 403 (jeton GitHub invalide) ou 503 au lieu de 401 (seul le nouveau composant l'appelle). **Migration : aucune.** Le message de commit ne doit mentionner aucun assistant.

### Constats ouverts, dans l'ordre de traitement

1. Non bloquant r26 : configuration SSO pour `ssoUid`.
2. Non bloquant r30 : jeton d'invitation dans le corps de `check` et `accept`.
3. S30, actions d'exploitation 1 à 4.
4. Phases 4 à 6 : S18 (avec les compléments r32 et r33 : masquer « Connecter un dépôt » en impersonation), S19 à S26 (hors volet `mock/login`), A5 à A9, P2, P5, P7, P8, Q-2, O10 à O17. Décision `myRole` / `canManage` à prendre avec S18 ou A5 à A9 (confirmation utilisateur).


## Revue r35 — non bloquants r26 (`ssoUid`) et r30 (S27, jeton dans le corps) : VALIDÉS ; feu vert pour le commit (2026-11-09)

Revue de la section « Lot r34 (fixeur) » du journal (working tree, rien de commité). Code relu (`auth.service.ts` : `hasActiveSso`, `hasOtherLoginMethod`, `unlinkIdentity`, `getIdentities` ; `invitations.controller.ts` ; `invitation-token.dto.ts` ; `AppContext.tsx`), mesures relancées, contre-mutations jouées hors dépôt. `md5sum` des 10 fichiers du working tree (sans le dossier d'agent local) identique avant et après.

Incident d'outillage : trois processus `cp -i` bloqués (alias interactif) et leur shell parent, restes de ma revue précédente, étaient encore en attente (ils auraient pu réécrire `auth.service.ts` avec une ancienne copie). Je les ai tués, vérifié que le fichier n'avait pas été modifié (`md5sum` conforme), et rejoué mes mutations avec `/bin/cp -f` dans un script `bash`. Aucun processus de restauration ne reste en attente à la fin.

### Mesures (relancées par l'architecte)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **87/87 suites, 2522/2522** |
| `cd frontend && pnpm test:run` | **28 fichiers, 197/197** |
| `nest build` ; `tsc --noEmit -p tests/tsconfig.json` ; frontend `tsc --noEmit -p .` ; `pnpm build` | exit 0 partout |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine ; Prettier sur les fichiers de code modifiés | 0 erreur (53 avertissements préexistants) ; conforme |

### Contre-mutations de l'architecte

| ID | Mutation | Résultat |
| --- | --- | --- |
| M1 | `OR` SQL de l'`updateMany` : `ssoUid not null` toujours présent (condition `ssoActive` retirée) | Non détectée, **jugée équivalente** (voir ci-dessous) |
| M2 | `hasActiveSso` : `toLowerCase()` retiré sur l'adresse | Non détectée (mineur, voir ci-dessous) |
| M3 | DTO : `{64}` remplacé par `{60,70}` | **Détectée** (1) |
| M4 | `hasActiveSso` : renvoie vrai quand il n'y a pas de `ssoUid` | Non détectée, équivalente (`hasOtherLoginMethod` exige déjà `Boolean(ssoUid)`) |
| M5 | `check` non public | **Détectée** (8) |
| M6 | Frontend : `check` en `GET` | **Détectée** (la suite frontend échoue, corps et méthode vérifiés) |

Les mutations propres du fixeur (retrait de `enabled`, `domainVerifiedAt`, du filtre de domaine, `ssoActive` forcé dans `getIdentities` / `unlinkIdentity`, DTO, `accept`, client) ont toutes été détectées selon son journal ; M3 et M5 recoupent les siennes.

**Jugement de la mutation M1 : acceptée.** La lecture qui précède renvoie déjà 409 quand `ssoActive` est faux et qu'aucune autre méthode n'existe ; quand une autre méthode existe, le `OR` est vrai sans `ssoUid`. La branche ne joue donc que sur une course (configuration SSO changée entre lecture et écriture), et même dans ce cas le SQL ne peut pas vérifier l'état de `SSOConfiguration` (autre table) : le « miroir » reste partiel par construction. Documenter l'équivalence suffit ; pas de test de concurrence artificiel à exiger.

### Verdict

| Constat | Verdict | Preuve |
| --- | --- | --- |
| Non bloquant r26 : `ssoUid` ne compte que si le SSO du domaine est utilisable (`enabled`, `domainVerifiedAt`, domaine de l'adresse), règle unique pour `unlinkIdentity` et `canUnlink` | **VALIDÉ** | Mêmes critères que `SsoService.findUsableConfig` (ligne 135) ; 4 cas négatifs + 1 positif + cas avec mot de passe ; mutations du fixeur et M3 |
| Non bloquant r30 (S27) : jeton d'invitation dans le corps de `check` (public, 200) et `accept` (authentifié, 200), format `^[a-f0-9]{64}$` côté DTO, anciennes routes 404, plus aucun jeton dans l'URL | **VALIDÉ** | 14 tests HTTP réels, tests frontend, M3, M5, M6 ; seul le frontend du dépôt appelle ces routes (grep) |

### Réponses aux questions du fixeur

1. **Domaine de l'adresse actuelle pour « SSO actif » : accepté.** C'est la règle de connexion SSO (S10-a) : un compte dont l'adresse a changé de domaine ne peut plus se connecter par ce SSO, donc son `ssoUid` n'est plus une méthode utilisable. Le message 409 existant suffit. *Décision produit à confirmer par l'utilisateur* : aucune action requise si l'on retient cette lecture.
2. **`@Throttle` sur `POST invitations/check` : non nécessaire.** Un `AppThrottlerGuard` global (60 requêtes par minute) s'applique déjà à la route publique, et le jeton (256 bits, format fixé par le DTO) n'est pas énumérable. Pas de limite dédiée. À reprendre en P5 seulement pour vérifier que l'adresse IP vue par le garde est bien celle du client derrière le proxy (`trust proxy`) et envisager une limite plus basse sur les routes publiques d'invitation. *Recommandation, décision d'exploitation à confirmer par l'utilisateur.*
3. **Suppression sans alias : confirmée.** Aucun client externe, et un alias `GET check/:token` réintroduirait le jeton dans les journaux. Déployer backend et frontend ensemble ; un onglet ouvert avec l'ancien bundle verra une erreur sur l'écran d'invitation jusqu'au rechargement (les liens `?token=` des courriels restent valides). *Décision d'exploitation à confirmer par l'utilisateur.*

### Constat mineur (non bloquant, à traiter avec le prochain lot touchant `auth.service.ts`)

- **r35-m1** (Amélioration) : ajouter un test où l'adresse du compte est en casse mixte (`Alice@ACME.com`) avec une configuration au domaine en minuscules, pour couvrir `toLowerCase()` de `hasActiveSso` (M2). Aucun risque de sécurité, simple protection contre une régression.

### Statut des constats

| Constat | Statut |
| --- | --- |
| Non bloquant r26, configuration SSO pour `ssoUid` | **VALIDÉ, clos** |
| Non bloquant r30 (S27), jeton d'invitation dans le corps | **VALIDÉ, clos** |
| S27 | **Clos** |
| r35-m1 (test de casse) | Ouvert, mineur |

### Commit : feu vert, un seul commit

Les 10 entrées du working tree (sans le dossier d'agent local, qui reste hors de git) :

- Backend source (3) : `backend/src/auth/auth.service.ts`, `backend/src/projects/invitations.controller.ts`, `backend/src/projects/dto/invitation-token.dto.ts` (nouveau).
- Backend tests (3) : `backend/tests/unit/auth/identity-linking.spec.ts`, `backend/tests/unit/authz/public-routes.spec.ts`, `backend/tests/http/invitation-token-body.spec.ts` (nouveau).
- Frontend (2) : `frontend/src/context/AppContext.tsx`, `frontend/src/context/AppContext.invitation.spec.tsx`.
- Documentation (3) : `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md`, `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`.

Changements cassants : `GET /projects/invitations/check/:token` et `POST /projects/invitations/accept/:token` supprimées (404), remplacées par `POST /projects/invitations/check` et `/accept` avec `{ "token": "<64 hex>" }` (400 si format invalide) ; un compte dont le seul autre moyen est un `ssoUid` sans SSO actif du domaine ne peut plus délier GitHub/Firebase (409). **Migration : aucune.** Le message de commit ne doit mentionner aucun assistant.

### Constats ouverts, dans l'ordre de traitement

1. r35-m1 (mineur, test de casse), à joindre au prochain lot.
2. S30, actions d'exploitation 1 à 4.
3. Phases 4 à 6 : S18 (avec les compléments r32 et r33 : masquer « Connecter un dépôt » en impersonation), S19 à S26 (hors volet `mock/login`), A5 à A9, P2, P5 (dont `trust proxy` et limites des routes publiques), P7, P8, Q-2, O10 à O17. Décision `myRole` / `canManage` à prendre avec S18 ou A5 à A9 (confirmation utilisateur).


## Revue r36 — S18 (indicateur d'impersonation) et r35-m1 : VALIDÉS ; S18 clos côté code ; feu vert pour le commit (2026-11-09)

Revue de la section « Lot r35 (fixeur) » du journal. Le working tree contient 13 entrées (11 fichiers modifiés, la migration et `useImpersonatedSession.ts`), sans le dossier d'agent local. J'ai relu intégralement `git diff` et les fichiers nouveaux, relancé les mesures et rejoué 12 contre-mutations hors dépôt (sauvegardes dans le bac à sable de session, restauration par `/bin/cp -f`). `md5sum` des 13 fichiers identiques avant et après ; aucun stash ; worktree temporaire supprimé.

### Incident de méthode : aucune mutation résiduelle

Chaque ligne du diff est voulue : colonne et schéma, écriture dans `issue()`, lecture et `impersonated` dans `listForUser`, transmission par le contrôleur, type client, libellé et `readOnly` dans `SessionsSection`, hook, garde du panneau, tests. Rien de plus (`auth.service.ts` est identique à HEAD, absent du diff). `git diff --name-only` : 11 fichiers, tous dans `git status`. Les tests ne contiennent aucun `.only`, `.skip` ni assertion affaiblie. Incident accepté ; consigne : toujours sauvegarder dans un tableau quoté (zsh ne découpe pas `$VAR`) et vérifier `md5sum -c` avant de rendre.

### Mesures relancées

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | 87/87 suites, 2529/2529 |
| `nest build` ; `tsc --noEmit -p tests/tsconfig.json` ; `-p tsconfig.build.json` ; frontend `tsc --noEmit` ; `pnpm build` | exit 0 |
| `cd frontend && npx vitest run` | 28 fichiers, 202/202 |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide |
| `pnpm lint` ; Prettier sur les fichiers modifiés | 0 erreur (53 avertissements) ; conforme |
| `prisma validate` | valide |
| `tsc --noEmit -p tsconfig.json` (backend) | erreur `rootDir` TS6059 sur `tracking.gateway.spec.ts` : **préexistante**, reproduite sur HEAD dans un worktree propre |

L'erreur `rootDir` vient du `rootDir: src` du `tsconfig.json` principal, alors que le spec importe `tests/support/session.test-support.ts`. Sans effet : le build utilise `tsconfig.build.json` et les tests leur propre `tsconfig`. Constat **O21** (Amélioration, hygiène) : exclure `src/**/*.spec.ts` de ce `tsconfig` ou déplacer l'import ; avec A9 (CI).

### Migration `20261114000000_s18_refresh_token_impersonated_by`

`ALTER TABLE RefreshToken ADD COLUMN impersonatedBy VARCHAR(191) NULL` : additive, nullable, sans valeur par défaut ni reprise, cohérente avec le schéma (`String? @db.VarChar(191)`, la taille des identifiants), `prisma validate` OK. Sur MySQL/MariaDB l'ajout d'une colonne nullable est léger. Pas de rotation à traiter : une session d'impersonation est une ligne unique de 15 minutes sans secret remis, donc `refresh()` n'a rien à reporter.

### Contre-mutations de l'architecte

| ID | Mutation | Résultat |
| --- | --- | --- |
| M1 | `listForUser` ignore la colonne | Détectée (1) |
| M2 | drapeau du jeton ignoré pour la session courante | Détectée (1) |
| M3 | drapeau du jeton appliqué à toutes les lignes | Détectée (1) |
| M4 | contrôleur ne transmet plus le drapeau | Détectée (1) |
| M5 | `issue()` n'écrit plus la colonne | Détectée (2) |
| M6 | `select` sans `impersonatedBy` | Détectée (erreur de types) |
| M7 | `readOnly` ne regarde plus `current` | Détectée (1) |
| M8 | `readOnly` toujours faux | Détectée (2) |
| M9 | panneau : `impersonated !== true` (visible pendant le chargement) | Détectée (1) |
| M10 | hook : échec de lecture traité comme impersonation | **Non détectée** |
| M11 | hook : `some(impersonated)` au lieu de l'élément `current` | **Non détectée** |
| M12 | `hasActiveSso` : `toLowerCase()` retiré (r35-m1) | Détectée (1) |

M10 et M11 : **r36-m1** (Amélioration, non bloquant). Ajouter deux tests au panneau : (a) `listSessions` rejeté, le bouton s'affiche (le serveur reste l'autorité) ; (b) session courante ordinaire et autre session d'assistance dans la liste, le bouton s'affiche. M11 est un vrai défaut de précision possible : sans le test, un refactoring pourrait masquer le bouton à tort pour toute personne qui a une session d'assistance ouverte ailleurs.

### Verdicts

| Constat | Verdict | Remarque |
| --- | --- | --- |
| S18-a : colonne `impersonatedBy` et migration | **VALIDÉ** | additive, 2 échecs si `issue()` n'écrit plus |
| S18-a : champ `impersonated` dans `GET /auth/sessions` | **VALIDÉ** | identité de l'administrateur jamais exposée (test sur le corps brut) |
| S18-a : `SessionsSection` sans `planner_admin_original_session`, libellé | **VALIDÉ** | nouvel onglet couvert ; clé seule ne désactive rien |
| S18-a : hook et masquage de « Connecter un dépôt » | **VALIDÉ** | M9 détectée ; réserve r36-m1 |
| r35-m1 : test de casse | **VALIDÉ** | M12 détectée |
| **S18 (global)** | **Clos côté code** | reste le drapeau `FEATURE_IMPERSONATION_ENABLED`, éteint, subordonné à A8 |

### Les 3 écarts

1. **Booléen seulement côté client : accepté.** Exposer l'identité de l'administrateur à la personne ciblée n'apporte rien à l'interface et élargit la surface ; l'attribution fine relève de l'`AuditLog` (A8) et du `PlatformAuditLog`. *Décision produit : à confirmer par l'utilisateur* si l'on veut montrer « par qui » à la personne ciblée (déconseillé avant A8).
2. **OU colonne + jeton pour la session courante : accepté.** Le jeton couvre une ligne antérieure à la migration ; la colonne couvre les autres lignes. Les deux tests le verrouillent (M2, M3). Sans risque : les deux sources sont émises par le serveur.
3. **Masquage tant que le serveur n'a pas répondu : accepté.** Sûr par défaut (échec côté prudent), au prix d'un bouton qui apparaît après une requête. Le serveur reste l'autorité (403). *À confirmer par l'utilisateur* si l'attente est jugée gênante (alternative : désactiver le bouton avec un état de chargement).

### Réponses aux questions du fixeur

1. **`AdminConsole` et « Quitter l'impersonation » : ne pas modifier.** La clé `planner_admin_original_session` n'y est pas un indicateur d'état mais le support de la restauration de la session de l'administrateur dans cet onglet ; le serveur ne la fournit pas (et ne doit pas). Un onglet sans clé ne peut pas « quitter » : il faut une nouvelle connexion, ce qui est acceptable pour une fonction désactivée. À revoir seulement à l'ouverture du drapeau (parcours complet, avec A8).
2. **`myRole` / `canManage` : non implémenté, accepté.** S18 n'en dépend pas. Recommandation inchangée (exposer `canManage` par projet, calculé par `PolicyService`), à traiter avec A5 à A9. *Décision à confirmer par l'utilisateur* : lot dédié ou différé.
3. **Attribution `AuditLog` reportée à A8 : acceptée**, condition de r17 maintenue : ne pas ouvrir `FEATURE_IMPERSONATION_ENABLED` avant A8 ; sinon risque accepté et consigné.

### Statut des constats

| Constat | Statut |
| --- | --- |
| S18 (compléments r32 et r33), r35-m1 | **VALIDÉ, clos** |
| r36-m1 (deux tests du panneau) | Ouvert, mineur, à joindre au prochain lot front |
| O21 (`tsconfig.json` backend, `rootDir`) | Ouvert, Amélioration, avec A9 |

### Commit : feu vert, un seul commit

14 entrées après la présente revue (les 13 du fixeur plus `rapport-audit.md`), sans le dossier d'agent local :

- Backend source (4) : `backend/prisma/schema/auth.prisma`, `backend/prisma/migrations/20261114000000_s18_refresh_token_impersonated_by/migration.sql` (nouveau), `backend/src/auth/auth.controller.ts`, `backend/src/auth/session.service.ts`.
- Backend tests (2) : `backend/tests/http/session-lifecycle.spec.ts`, `backend/tests/unit/auth/identity-linking.spec.ts`.
- Frontend (6) : `frontend/src/security-api.ts`, `frontend/src/useImpersonatedSession.ts` (nouveau), `frontend/src/components/SessionsSection.tsx`, `frontend/src/components/SessionsSection.spec.tsx`, `frontend/src/components/IntegrationsPanel.tsx`, `frontend/src/components/IntegrationsPanel.spec.tsx`.
- Documentation (2) : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`.

`git status` affiche 14 entrées, la migration comptant pour une (son dossier). Ajouter les chemins explicitement, jamais `git add -A`.

**Changements cassants** : aucun. `GET /auth/sessions` gagne `impersonated` (additif) ; un ancien frontend continue de fonctionner avec le nouveau backend. Un nouveau frontend avec l'ancien backend ne recevrait pas `impersonated` : le hook y verrait `false` et afficherait le bouton (le serveur refuserait en 403 en impersonation, drapeau éteint). Déployer backend et frontend ensemble.
**Migration** : une, additive, à appliquer avant le démarrage du nouveau backend (`prisma migrate deploy`), sinon le `select` de `impersonatedBy` échoue sur `GET /auth/sessions` et `issue()`. Pas de reprise, pas de retour arrière nécessaire (colonne ignorée par l'ancien code). Le message de commit ne doit mentionner aucun assistant.

### Constats ouverts, dans l'ordre de traitement

1. r36-m1 (mineur, tests du panneau), à joindre au prochain lot front.
2. S30, actions d'exploitation 1 à 4.
3. **Phase 5 (durcissement)**, ordre proposé : S19, S20, S21, S22 (surfaces exposées, en-têtes, CORS, secrets), puis S23 à S25, S26 (hors volet `mock/login`, déjà fait), A5, A6, A7, P5 (dont `trust proxy` et limites des routes publiques), P8, O10 à O17. Chaque constat en lot séparé, revue à chaque lot.
4. **Phase 6** : A8 (`AuditLog` avec attribution de l'acteur réel en impersonation, prérequis de l'ouverture du drapeau), A9 (CI, pnpm 10, O21), P2, P7, Q-2. Décision `myRole` / `canManage` avec A5 à A9 (confirmation utilisateur).


## Revue r37 — lot r36 : S19, S20 et r36-m1 VALIDÉS (réserves non bloquantes) ; feu vert pour le commit (2026-11-09)

### Mesures relancées par l'architecte
`env -u DATABASE_URL npx jest` : 91 suites, 2640/2640. `nest build`, `tsc --noEmit` (tests, build), frontend `tsc --noEmit` et `pnpm build` : exit 0. `vitest run` : 30 fichiers, 221/221. `grep mock/login|Simuler une session` dans `dist/assets` : vide. Lint : 0 erreur (53 avertissements inchangés). Prettier : conforme. `git diff` relu en entier : aucune mutation résiduelle ; md5 du working tree identiques avant et après mes contre-mutations ; aucun processus en attente.

### Revue de `safeFetch` (code critique)
- **Plages** : sondées une à une sur `isForbiddenAddress` (49 adresses). Refusées : 0/8, 10/8, 100.64/10 (bornes exactes 100.64 et 100.127 ; 100.128 admise), 127/8, 169.254/16 (dont .169.254), 172.16/12 (bornes exactes), 192.0.0/24, 198.18/15, 224/4, 240/4, 255.255.255.255 ; IPv6 `::`, `::1`, `::/96` (compatibles), `::ffff:x` (formes pointée et hexadécimale), `64:ff9b::/96`, ULA, link-local, multicast, `2001:db8`, Teredo, 6to4, `100::/64`. Texte non-IP, zone (`%eth0`) : refusés. Adresses publiques (8.8.8.8, 2606:4700::1111) : admises. Deux `BlockList` distinctes : correct.
- **Hôtes** : `URL` normalise les formes décimale, octale et hexadécimale en IPv4 (`2130706433`, `0x7f.1`) ; le test `isIP` puis la liste les refuse. `localhost.` (point final) passe le contrôle du point mais est refusé par l'adresse résolue (`127.0.0.1`/`::1`). Le point final ne contourne pas la liste blanche (`endsWith` strict).
- **Rebinding** : l'adresse validée est celle passée à `httpsRequest({host})` ; aucune seconde résolution. Vérifié.
- **Transport réel** (serveur HTTPS local, hors dépôt, `NODE_EXTRA_CA_CERTS`) : certificat vérifié contre le nom d'hôte et non contre l'IP épinglée (nom différent : échec « altnames ») ; réponse au-delà de `maxBytes` : interrompue ; réponse qui ne se termine jamais : « Délai dépassé » à 1,5 s ; connexion coupée : erreur, pas de blocage. Le délai couvre bien la réponse entière.
- **Redirections** : revalidées à chaque saut (protocole, hôte, liste blanche, adresses), 0 pour les POST, 3 au plus ; rien d'anormal (les en-têtes personnalisés ne portent aucun secret aujourd'hui).

### Contre-mutations de l'architecte (sauvegarde bac à sable, `/bin/cp -f`, une à la fois)
| Mutation | Résultat |
| --- | --- |
| `safe-fetch.ts` : plage IPv6 mappée retirée | détectée |
| `safe-fetch.ts` : `some(isForbiddenAddress)` remplacé par le test de la première adresse seule | détectée |
| `safe-fetch.ts` : `servername` supprimé | **non détectée** |
| `safe-fetch.ts` : contrôle `maxBytes` désactivé | **non détectée** |
| `safe-fetch.ts` : minuteur global (`deadline`) neutralisé | **non détectée** |
| `safe-href.ts` : refus des identifiants retiré | détectée |
| `attachment-url.ts` : ancre `$` de l'expression `data:` retirée | **non détectée** |

Les trois premières non-détections ont une même cause : `defaultTransport` n'est exécuté par aucun test automatisé (tous passent par `transport` simulé) ; le fixeur l'a vérifié à la main, hors CI.

### Verdicts
| Point | Verdict |
| --- | --- |
| S19 (SSRF) | **VALIDÉ**, réserves r37-m1 à r37-m3 et r37-a1 (non bloquantes) |
| S20 (XSS et e-mails) | **VALIDÉ**, réserve r37-m4 (non bloquante) |
| r36-m1 (deux tests du panneau) | **VALIDÉ**, clos |

### Les 5 écarts de S19 et S20
1. Pas d'`ipaddr.js` ni d'`undici` : **accepté**. `BlockList` plus connexion épinglée donnent la garantie demandée, sans dépendance ; sondes ci-dessus.
2. `*.powerplatform.com` pour Teams : **accepté**, à confirmer par l'utilisateur ; resserrage possible vers `*.environment.api.powerplatform.com` si les URL réellement utilisées le permettent.
3. `fetch` à hôtes fixes non migrés (Google, Microsoft, GitHub, SSO) : **accepté** ; seul `calendarId` est variable et il est passé par `encodeURIComponent` dans le chemin. Condition : tout futur `fetch` dont l'hôte dépend d'une donnée utilisateur passe par `safeFetch`.
4. Liste MIME limitée aux URL `data:` et taille maximale de 10 Mio : **accepté**. `fileType` (libre, 127 caractères) n'est pas recoupé avec le type de l'URL `data:` : à traiter avec P5 (stockage objet), sans incidence de sécurité tant que le client déduit l'ouverture de l'URL et non du type.
5. CSP renvoyée à S22 : **accepté** (c'est la défense en profondeur de S20).

Changements cassants (intégrations hors liste blanche, flux ICS en `http` ou de type autre, pièces jointes limitées aux images et PDF) : **acceptés**, avec recensement préalable (voir journal).

### Nouveaux constats (non bloquants)
- **r37-m1 (Mineur) : `defaultTransport` non testé en CI.** Exiger un test (serveur `node:https` local avec certificat de test, `NODE_EXTRA_CA_CERTS` ou `ca` injectable dans la requête épinglée) qui couvre : certificat vérifié contre le nom d'hôte et non l'IP épinglée (échec si nom différent), `maxBytes`, délai global sur réponse qui ne se termine pas, `Host` envoyé. Critère : les mutations `servername` supprimé, `maxBytes` désactivé et minuteur neutralisé sont détectées. Si `defaultTransport` doit être exporté, le faire explicitement.
- **r37-m2 (Mineur) : seule la première adresse est essayée.** `resolvePublicAddress` renvoie `addresses[0]` : un hôte avec un enregistrement AAAA en tête, sur un conteneur sans IPv6 sortant, échoue (ENETUNREACH) là où l'ancien `fetch` basculait. Exiger : essayer les adresses validées à tour de rôle (IPv4 d'abord), toutes déjà validées, et borner aussi la résolution DNS par le délai. Test : première adresse en erreur de connexion, la seconde réussit.
- **r37-m3 (Mineur) : prise en charge de `text/plain` pour les flux ICS** (décision de l'architecte, voir journal) : ajouter `text/plain` à `CALENDAR_FEED_CONTENT_TYPES`, avec un test ; `text/html` et `application/octet-stream` restent refusés.
- **r37-m4 (Mineur) : ancre de fin de l'expression `data:` non testée.** Ajouter aux tests (`attachment-dto.spec.ts`, `safe-href.spec.ts`) une URL `data:image/png;base64,AAAA` suivie de caractères parasites (espace, `"`, saut de ligne) : refusée. Critère : la mutation « ancre `$` retirée » est détectée des deux côtés.
- **r37-a1 (Amélioration) : plages complémentaires.** Ajouter `64:ff9b:1::/48` (NAT64 à usage local), `fec0::/10` (site-local obsolète) et `192.88.99.0/24` (relais 6to4 obsolète). Aucune exploitation connue ; durcissement.

### Réponses aux 7 questions du fixeur
1. **`text/plain` pour les flux ICS : oui** (à confirmer par l'utilisateur). La protection réelle est l'adresse de destination ; le type de contenu n'est qu'un filtre secondaire, et les flux d'agenda privés sont souvent servis en `text/plain`. Garder `text/html` refusé. Voir r37-m3.
2. **`powerplatform.com` : accepté** (à confirmer). Les webhooks Teams récents (Workflows) sont servis par `*.logic.azure.com` ou `*.environment.api.powerplatform.com` ; l'exploitation peut resserrer après recensement.
3. **Recensement des `Integration` et `Attachment` hors règle : oui**, requête en lecture seule demandée à l'exploitation avant la mise en production, sans nettoyage automatique (à confirmer). Les lignes non conformes sont signalées aux propriétaires, pas supprimées.
4. **Types de pièces jointes : images et PDF suffisent jusqu'à P5** (à confirmer par l'utilisateur, car les `.docx`, `.zip` et textes sont désormais refusés). Prévenir les utilisateurs ; P5 (stockage objet) élargira.
5. **S21 : affichage unique du secret de webhook : oui** (décision produit, à confirmer). Le secret est chiffré en base, montré une fois à la liaison du dépôt, avec une action « régénérer » (ancien secret invalidé immédiatement). Pas de réaffichage.
6. **S22 : domaines.** Voir exigences ci-dessous : ce qui se déduit du dépôt et ce qui doit venir de l'utilisateur.
7. **O16 à lier à S22 : oui**, même lot (intercepteur `no-store` backend plus en-têtes nginx), un seul passage de revue.

### Exigences précisées pour S21 (lot suivant)
Reprendre la remédiation du constat d'origine, avec : (1) `rawBody: true` dans `NestFactory.create` et HMAC (`timingSafeEqual`, longueur vérifiée) sur `req.rawBody` ; (2) `Project.githubWebhookSecret` chiffré par `encrypt()`, migration additive nullable, nom daté postérieur à `20261114000000`, secret généré (32 octets) à la liaison P9-R, montré une seule fois, route de régénération réservée au propriétaire du projet, secret jamais renvoyé par les lectures de projet (`select` explicite) ni journalisé ; (3) route `POST /projects/:id/webhooks/github` ; l'ancienne route supprimée (ou 410) et l'exemption CSRF de `origin-guard.ts` ajustée à la nouvelle route seule ; (4) `closeTaskFromWebhook(projectId, taskId)` : tâche du projet **et** `payload.repository.full_name === project.githubRepo` ; (5) `X-GitHub-Delivery` en Redis (`SET NX EX 86400`), second envoi ignoré, et comportement défini si Redis est indisponible (refus, pas d'acceptation silencieuse) ; (6) passe-droit `NODE_ENV === 'test'` supprimé ; réponse 401 uniforme quel que soit le motif (projet inexistant, secret absent, signature fausse) ; (7) tests : signature sur corps brut avec espaces acceptée, signature fausse, projet inconnu, tâche d'un autre projet non fermée, dépôt différent refusé, rejeu ignoré, secret absent de `GET /projects/:id`. Décision produit à confirmer : affichage unique (question 5).

### Exigences précisées pour S22 + O16 (lot suivant, après S21)
- En-têtes avec `always` sur `/` **et** dans le bloc des assets (répétés : nginx n'hérite pas), `scripts/check-headers.sh` vérifiant `/` et un asset `.js` ; O16 : `Cache-Control: no-store` et `Pragma: no-cache` sur `/auth/*` et `/admin/*` (test dans `session-lifecycle.spec.ts`).
- **Déductible du dépôt** : l'API est lue dans `VITE_API_URL` au build (`docker-compose.prod.yml`, `Dockerfile.prod`), donc `connect-src` doit être généré depuis cette variable (substitution au build ou `envsubst` au démarrage), pas codé en dur ; la documentation (`docs/manifeste-synchronisation-firestore.md`) cite `https://planner-pro.boukarou-os.com` (frontend) et `https://api.planner-pro.boukarou-os.com` (API) comme domaines de production. `socket.io-client` utilise la même URL d'API : prévoir `wss://` du même hôte. Le frontend n'utilise que **Firebase Auth** (`firebase/app`, `firebase/auth` dans `firebase-auth.ts` ; pas de client Firestore, la synchronisation Firestore est côté serveur) : donc `https://identitytoolkit.googleapis.com` et `https://securetoken.googleapis.com` dans `connect-src`, et non `*.firebaseio.com` du modèle initial ; selon le mode de connexion (popup ou redirection), `frame-src` et `script-src` pour `https://<projet>.firebaseapp.com` et `https://apis.google.com` : à vérifier en testant la connexion Google réelle avec la CSP en mode `Content-Security-Policy-Report-Only` d'abord. **Point que le modèle initial omet** : `frontend/src/index.css` importe `https://fonts.googleapis.com/...` : `style-src` doit ajouter `https://fonts.googleapis.com` et `font-src https://fonts.gstatic.com` (ou auto-héberger la police, préférable). L'icône `data:` de `index.html` est couverte par `img-src data:`.
- **À fournir par l'utilisateur** : le domaine exact de l'API de production (confirmer `api.planner-pro.boukarou-os.com`), `VITE_FIREBASE_AUTH_DOMAIN` réel, et si la connexion Google passe par popup ou redirection. Déployer la CSP d'abord en `Report-Only`, puis en blocage.

### Statut des constats
| Constat | Statut |
| --- | --- |
| S19, S20, r36-m1 | **VALIDÉ** (code) ; S19 et S20 clos côté code après commit, réserves ci-dessous |
| r37-m1, r37-m2, r37-m3, r37-m4 | Ouverts, Mineur, à traiter dans un petit lot avant S21 |
| r37-a1 | Ouvert, Amélioration |
| S30, O21 | inchangés |

### Commit : feu vert, un seul commit
25 entrées (les 24 du fixeur plus `rapport-audit.md`), sans `.claude/` ; ajouter les chemins explicitement, jamais `git add -A` :
- Backend source (13) : `backend/src/common/safe-fetch.ts`, `backend/src/mail/mail.service.ts`, `backend/src/projects/attachment-url.ts`, `backend/src/projects/calendar-sync.service.ts`, `backend/src/projects/comments.controller.ts`, `backend/src/projects/comments.service.ts`, `backend/src/projects/dto/attachment.dto.ts`, `backend/src/projects/dto/create-comment.dto.ts`, `backend/src/projects/dto/create-integration.dto.ts`, `backend/src/projects/integration-url.ts`, `backend/src/projects/integration.service.ts`, `backend/src/projects/projects.controller.ts`, `backend/src/mail/mail.service.escape.spec.ts`.
- Backend tests (5) : `backend/tests/unit/common/` (dossier, `safe-fetch.spec.ts`), `backend/tests/unit/projects/attachment-dto.spec.ts`, `backend/tests/unit/projects/integration-ssrf.spec.ts`, `backend/tests/unit/projects/calendar-sync.service.spec.ts`, `backend/tests/unit/projects/comments.service.spec.ts`.
- Frontend (5) : `frontend/src/safe-href.ts`, `frontend/src/safe-href.spec.ts`, `frontend/src/components/TaskCommentsPanel.tsx`, `frontend/src/components/TaskCommentsPanel.spec.tsx`, `frontend/src/components/IntegrationsPanel.spec.tsx`.
- Documentation (2) : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`.

(`git status` affiche 25 entrées une fois ce rapport modifié, le dossier `tests/unit/common/` comptant pour une.) Message de commit sans mention d'assistant.

**Changements cassants** : (1) intégrations Slack/Teams hors liste blanche : échec d'envoi journalisé ; (2) flux d'agenda en `http`, ou de type autre que `text/calendar`/`application/json`, ou vers hôte privé : 502 ; (3) pièces jointes hors images et PDF, ou `data:` hors liste, ou `javascript:`/`http:` : 400 ; (4) liens de pièces jointes déjà stockées avec URL dangereuse : masqués.
**Migration** : aucune.
**Consignes de déploiement** : backend et frontend sans ordre imposé (l'ancien frontend recevrait un 400 sur un fichier non accepté). Avant la mise en production : recensement en lecture seule des lignes `Integration` (types SLACK/TEAMS dont `url` n'est pas sur `hooks.slack.com`, `*.webhook.office.com`, `*.logic.azure.com`, `*.powerplatform.com` ; flux d'agenda en `http`) et `Attachment` (`fileUrl` ni `https://` ni `data:` image/PDF). Vérifier que le conteneur backend dispose d'un DNS et d'une sortie directe en 443 : `safeFetch` ignore `HTTP(S)_PROXY`, un proxy sortant obligatoire ferait échouer tous les webhooks et flux. Vérifier, après déploiement, l'envoi d'un webhook Slack de test et la synchronisation d'un flux ICS réel (surveiller l'effet de r37-m2 sur les hôtes dotés d'un AAAA).

### Constats ouverts, dans l'ordre de traitement
1. Petit lot r37-m1, r37-m2, r37-m3, r37-m4 (+ r37-a1), avant S21.
2. **S21** (exigences ci-dessus).
3. **S22 + O16** (exigences ci-dessus).
4. S30, actions d'exploitation 1 à 4 ; recensement S19/S20 avant production.
5. Puis S23 à S25, S26 (hors volet `mock/login`), A5, A6, A7, P5, P8, O10 à O17 (O16 traité avec S22), Phase 6 (A8, A9 avec O21, P2, P7, Q-2).

## Revue r38 — lot r37 : r37-m1, r37-m3, r37-m4, r37-a1 VALIDÉS ; r37-m2 À REPRENDRE (nouveau constat r38-m1) (2026-11-09)

### Mesures relancées par l'architecte
`env -u DATABASE_URL npx jest` : 92 suites, 2670/2670. `nest build`, `tsc --noEmit` (tests, build), frontend `tsc --noEmit`, `pnpm build` : exit 0. `vitest run` : 30 fichiers, 226/226. `grep mock/login|Simuler une session` dans `dist/assets` : vide. Lint : 0 erreur (53 avertissements). Prettier : conforme. `git diff` relu en entier (source, tests, frontend) : aucune mutation résiduelle ; md5 des quatre fichiers source mutés identiques avant/après ; 8 entrées `git status` ; aucun processus jest/vitest en attente.

### Nouveau constat
- **r38-m1 (Majeur faible, fiabilité) : `safe-fetch.ts:187` contient `'EADDRNOTAVAIN'` (faute de frappe) au lieu de `'EADDRNOTAVAIL'`.** Confirmé : `os.constants.errno.EADDRNOTAVAIL` vaut 99, `EADDRNOTAVAIN` n'existe pas (`undefined`). La bascule d'adresse ne se déclenche donc jamais sur cette erreur, typique d'un AAAA sans IPv6 sortant (cas visé par r37-m2, avec ENETUNREACH). Aucune faille de sécurité (la bascule est un confort de disponibilité, toutes les adresses sont validées), mais le correctif r37-m2 est incomplet. Contre-mutation : retirer la ligne `EADDRNOTAVAIN` ou `ETIMEDOUT` : **non détectée** (76/76 verts) ; seule `EHOSTUNREACH` est couverte, et `ECONNREFUSED`/`ENETUNREACH` par les tests existants.
  **Remédiation et critères** : (1) corriger en `'EADDRNOTAVAIL'` ; (2) tester **chaque** code de `RETRYABLE_CODES` par `it.each` (ECONNREFUSED, ENETUNREACH, EHOSTUNREACH, EADDRNOTAVAIL, ETIMEDOUT) : première adresse en erreur, seconde réussit, deux appels ; (3) garde-fou contre les fautes de frappe : exporter `RETRYABLE_CODES` (ou le tester via le comportement) et vérifier que chaque code appartient à `Object.keys(os.constants.errno)` ; (4) critère : retirer n'importe quelle ligne du jeu, ou réintroduire la faute, fait échouer au moins un test.

### Contre-mutations de l'architecte (sauvegarde bac à sable, `/bin/cp -f`, une à la fois, `cmp` après chaque restauration)
| Mutation | Résultat |
| --- | --- |
| `EADDRNOTAVAIN` retiré | **non détectée** (r38-m1) |
| `ETIMEDOUT` retiré | **non détectée** (r38-m1) |
| `EHOSTUNREACH` retiré | détectée (2 échecs) |
| `servername` supprimé | détectée (1 échec, espion : mutant équivalent figé) |
| `ca: req.ca` supprimé | détectée (8 échecs) |
| DNS non borné (`withTimeout` retiré) | détectée (1 échec) |

### Verdicts
| Point | Verdict |
| --- | --- |
| r37-m1 (`defaultTransport` testé, serveur TLS local) | **VALIDÉ** |
| r37-m2 (bascule d'adresses, IPv4 d'abord, DNS borné) | **À REPRENDRE** (r38-m1) |
| r37-m3 (`text/plain` pour ICS) | **VALIDÉ** (décision à confirmer par l'utilisateur) |
| r37-m4 (ancre `data:`) | **VALIDÉ** |
| r37-a1 (3 plages) | **VALIDÉ** |

### Écarts et questions du fixeur
1. **`servername`, mutant équivalent figé par un espion sur `https.request` : accepté.** Le contrat explicite (SNI et certificat indépendants de l'en-tête `Host`) mérite d'être figé ; l'espion fonctionne car `https.request` est appelé via le module. Réserve : le test dépend de ce mode d'appel ; s'il casse après un changement d'import, le remplacer par un test de comportement. Les variantes qui changent réellement le comportement sont couvertes.
2. **`openssl` en CI : acceptable.** `ci.yml` tourne sur `ubuntu-latest` (job backend sur le runner, pas dans une image alpine) où `openssl` est présent. Les certificats sont éphémères et supprimés. Si la suite est un jour lancée dans un conteneur alpine, installer `openssl` ou générer les certificats par `node:crypto` (pas bloquant).
3. **Budget de délai : par adresse accepté.** Cohérent avec le comportement par saut existant, et pas de bascule après « Délai dépassé ». Pire cas : DNS (`timeoutMs`) plus N tentatives de connexion bloquées sur ETIMEDOUT. À durcir seulement si le délai par défaut est élevé : alors plafonner à 3 tentatives (sans test bloquant).
4. **`text/plain` pour ICS : validé côté code ; décision produit à confirmer par l'utilisateur** (inchangé).

### Statut des constats
| Constat | Statut |
| --- | --- |
| r37-m1, r37-m3, r37-m4, r37-a1 | **VALIDÉ** (clos après commit) |
| r37-m2 | ouvert, à reprendre via **r38-m1** |
| S21, S22 + O16, S30, O21 | inchangés |

### Commit : feu vert différé
Tant que r38-m1 n'est pas repris, ne pas committer. Une fois r38-m1 corrigé (une ligne et quelques tests), les 8 fichiers : `backend/src/common/safe-fetch.ts`, `backend/src/projects/integration-url.ts`, `backend/tests/unit/common/safe-fetch.spec.ts`, `backend/tests/unit/common/safe-fetch.transport.spec.ts`, `backend/tests/unit/projects/attachment-dto.spec.ts`, `backend/tests/unit/projects/calendar-sync.service.spec.ts`, `frontend/src/safe-href.spec.ts`, `docs/security/journal-corrections.md` (plus `docs/security/rapport-audit.md`), chemins explicites, sans `.claude/`.

### Constats ouverts, dans l'ordre de traitement
1. **r38-m1** (une ligne plus tests), puis revue courte.
2. **S21**, 3. **S22 + O16**, 4. S30, actions d'exploitation, recensement S19/S20, 5. S23 à S25, S26, A5 à A7, P5, P8, O10 à O17, Phase 6.


## Revue r39 — reprise de r38-m1

### Vérifications
`git diff` de `safe-fetch.ts` et de `safe-fetch.spec.ts` relu : `EADDRNOTAVAIL` correct, `RETRYABLE_CODES` exporté, `it.each` sur les 5 codes (2 appels exactement), test du jeu exact, garde-fou `os.constants.errno`. Aucune mutation résiduelle. Jest backend (`env -u DATABASE_URL`) : 92 suites, 2677/2677. `nest build`, `tsc -p tsconfig.test.json`, `tsc -p tsconfig.build.json` : exit 0. ESLint sur les deux fichiers : 0 erreur. Prettier sur les fichiers `.ts` modifiés : conforme.

### Contre-mutations rejouées (sauvegarde en bac à sable, restauration `/bin/cp -f`, `cmp` identique après chaque)
| Mutation | Résultat |
| --- | --- |
| ligne `EADDRNOTAVAIL` retirée | détectée (4 échecs) |
| ligne `ETIMEDOUT` retirée | détectée (4 échecs) |
| faute `EADDRNOTAVAIN` réintroduite | détectée (5 échecs) |

Aucun processus jest en attente après les mutations.

### Verdicts
| Point | Verdict |
| --- | --- |
| r38-m1 | **VALIDÉ** |
| r37-m2 | **VALIDÉ** |
| r37-m1, r37-m3, r37-m4, r37-a1 | **VALIDÉ** (inchangé) |

Observation mineure (non bloquante) : jest signale « A worker process has failed to exit gracefully » en fin de suite complète. À investiguer avec `--detectOpenHandles` dans un lot d'hygiène (timers sans `unref()`), sans lien avec ce lot.

### Commit : feu vert (un seul commit, lot r37 + reprise r38)
Fichiers, chemins explicites, sans `.claude/` ni `.env*` :
1. `backend/src/common/safe-fetch.ts`
2. `backend/src/projects/integration-url.ts`
3. `backend/tests/unit/common/safe-fetch.spec.ts`
4. `backend/tests/unit/common/safe-fetch.transport.spec.ts` (nouveau)
5. `backend/tests/unit/projects/attachment-dto.spec.ts`
6. `backend/tests/unit/projects/calendar-sync.service.spec.ts`
7. `frontend/src/safe-href.spec.ts`
8. `docs/security/journal-corrections.md`
9. `docs/security/rapport-audit.md`

### Constats ouverts, dans l'ordre
1. **S21** (webhook GitHub), 2. **S22 + O16** (en-têtes frontend, `no-store`), 3. S30, actions d'exploitation, recensement S19/S20, 4. S23 à S25, S26, A5 à A7, P5, P8, O10 à O17, O21, Phase 6.

### Informations à obtenir de l'utilisateur avant de commencer
**S21**
- Affichage unique du secret de webhook (montré une fois, régénération possible, pas de réaffichage) : confirmer oui/non.
- Qui peut régénérer le secret : propriétaire du projet seul (proposition) ou aussi les administrateurs.
- Sort de l'ancienne route : suppression ou réponse 410 ; existe-t-il des webhooks déjà configurés chez des clients à migrer (le secret global actuel est-il déjà déployé quelque part).
- Comportement si Redis est indisponible : refus (proposé) ou acceptation dégradée.

**S22 + O16**
- Domaine exact de l'API de production (confirmer `api.planner-pro.boukarou-os.com`) et du frontend.
- Valeur réelle de `VITE_FIREBASE_AUTH_DOMAIN`.
- Connexion Google par popup ou par redirection (détermine `frame-src` et `script-src`).
- Police : auto-hébergement (préféré) ou autorisation de `fonts.googleapis.com` / `fonts.gstatic.com`.
- Accord sur le déploiement en `Content-Security-Policy-Report-Only` d'abord, puis passage en blocage, et sur qui valide la connexion Google réelle.
- HSTS : confirmer que tous les sous-domaines sont servis en HTTPS avant `includeSubDomains`.


## Revue r40 — S21 (webhook GitHub signé par projet)

**Statut S21 : VALIDÉ** (mesures relancées : jest 96 suites 2765/2765, nest build, tsc, prisma validate, ESLint, Prettier, vitest 232/232, pnpm build sans `mock/login` ni `Simuler une session`). Omission Prisma vérifiée sur MySQL 8 réel (conteneur jetable, supprimé) : `create`, `update`, `upsert`, `findMany/First/Unique`, `include` imbriqués, `$transaction` (tableau et interactive) ne renvoient jamais `githubWebhookSecret` ; il n'est lu qu'avec `omit: { githubWebhookSecret: false }` (ou un `select` explicite).

**Écart à la décision utilisateur, à trancher par l'utilisateur** : la régénération est branchée sur `project.manage` (propriétaire/créateur MEMBER, OWNER/ADMIN, plus les MANAGER désignés par `ProjectMembership`). Recommandation : garder `project.manage`, car ces MANAGER peuvent déjà relier un autre dépôt (`/auth/github/sync`, même action) et obtenir ainsi un nouveau secret ; une action dédiée n'ajouterait pas de protection réelle. Si l'utilisateur veut strictement « propriétaire + OWNER/ADMIN », créer une action dédiée (ex. `project.webhook.regenerate`) et l'appliquer aussi à la liaison. À confirmer par l'utilisateur.

### Nouveaux constats (non bloquants)
- **r40-m1** (Mineur, CVSS 3.1) : `@ForbiddenInImpersonation()` de `POST /projects/:id/webhooks/github/secret` n'est couvert par aucun test (contre-mutation « décorateur retiré » : 1644 tests verts). Remédiation : test HTTP avec session d'impersonation sur la régénération : 403, secret inchangé.
- **r40-m2** (Mineur, CVSS 3.7) : si l'appel Redis `SET NX` dépasse 2 s alors que l'écriture a abouti, la clé reste posée et la livraison rejouée à la main (« Redeliver ») est ignorée comme un rejeu (perte silencieuse). Remédiation : sur erreur/délai du `SET`, tenter un `del` best-effort avant le 503 ; test avec faux Redis « écrit puis muet ».
- **r40-a1** (Amélioration) : (i) test/lint qui interdit `githubWebhookSecret` (et `omit: ... false`) hors `github-webhook.service.ts` et `auth.service.ts` (un `select` explicite contourne `omit`) ; (ii) rattacher à **S22 + O16** `Cache-Control: no-store` sur `POST /auth/github/sync` et `.../webhooks/github/secret` (réponses portant le secret) ; (iii) rattacher à **S23** une limite de corps JSON explicite : la valeur par défaut d'Express (100 ko) rejette en 413 les livraisons GitHub volumineuses (GitHub peut en envoyer jusqu'à 25 Mo) ; prévoir une limite dédiée à cette route ; (iv) rattacher à **S24** le 429 possible sur la route publique (proposer un `@SkipThrottle` dédié ou une limite par `projectId`).
- **Préexistant, hors S21** : le dossier local vide `backend/prisma/migrations/20261026024000_firestore_sync_outbox/` (non suivi par git) fait échouer `prisma migrate deploy` en P3015 sur une base vierge ; le supprimer localement (absent du dépôt, donc sans effet en production).

### Constats ouverts, dans l'ordre
1. r40-m1, r40-m2, r40-a1 (petit lot, peut suivre S22), 2. **S22 + O16** (en-têtes frontend, `no-store`), 3. S30, actions d'exploitation (dont recensement des webhooks clients), recensement S19/S20, 4. S23 à S25, S26, A5 à A7, P5, P8, O10 à O17, O21, Phase 6.

**Décision utilisateur (2026-11-10), S21** : la régénération du secret de webhook reste sur `project.manage` (propriétaire ou créateur au moins MEMBER, OWNER/ADMIN de l'espace de travail, MANAGER désignés par `ProjectMembership`), comme la liaison du dépôt. Recommandation r40 retenue ; pas d'action dédiée.


## Revue r41 — lot r40 (r40-m1, r40-m2, r40-a1 i) : VALIDÉ

**Mesures relancées** : jest backend (`env -u DATABASE_URL`) 97 suites, 2776/2776 ; `nest build`, `tsc` (build et test), ESLint et Prettier sur les 5 fichiers : propres. Aucune mutation résiduelle (`git diff` du code produit : uniquement le `try/catch` + `del` borné).

**Contre-mutations (à moi)** : `del` non borné : 2 échecs ; `del` aussi sur rejeu normal : 1 échec ; commentaire contenant `githubWebhookSecret` dans un autre fichier de `src` : 2 échecs. Fichiers restaurés (`cmp` identique).

- **r40-m1 : VALIDÉ.** **r40-m2 : VALIDÉ.** **r40-a1 (i) : VALIDÉ.**
- Risques déclarés acceptés : latence du 503 jusqu'à 2 délais (4 s) : acceptable (GitHub attend 10 s) ; clé pouvant subsister 24 h si Redis reste muet pendant le `del` : résiduel accepté, non fermable sans transaction.
- Questions du fixeur : (1) volets ii à iv **reportés par mes soins** dans S22, O16, S23, S24 (compléments r41, avec tests attendus) ; (2) `prisma.service.ts` dans la liste : **accepté** ; (3) test textuel strict : **accepté** (voulu).
- Aucun nouveau constat.

### Constats ouverts, dans l'ordre
1. **S22 + O16** (en-têtes frontend, `no-store` dont la route du secret), 2. S30, actions d'exploitation (recensement des webhooks clients), recensement S19/S20, 3. S23 (dont limite de corps des livraisons GitHub), S24 (dont 429 de la route publique), S25, S26, A5 à A7, P5, P8, O10 à O17, O21, Phase 6.

### Informations à obtenir de l'utilisateur avant S22 + O16
- Domaine exact de l'API de production (confirmer `api.planner-pro.boukarou-os.com`) et du frontend.
- Valeur réelle de `VITE_FIREBASE_AUTH_DOMAIN`.
- Connexion Google par popup ou par redirection (`frame-src`, `script-src`).
- Police : auto-hébergement (préféré) ou autorisation de `fonts.googleapis.com` / `fonts.gstatic.com`.
- Accord sur `Content-Security-Policy-Report-Only` d'abord puis blocage, et qui valide la connexion Google réelle.
- HSTS : tous les sous-domaines en HTTPS avant `includeSubDomains`.

### Feu vert de commit
`backend/src/projects/github-webhook.service.ts`, `backend/tests/http/fake-redis.ts`, `backend/tests/http/github-webhook.spec.ts`, `backend/tests/unit/auth/impersonation-routes.spec.ts`, `backend/tests/unit/webhook-secret-confinement.spec.ts` (nouveau), `docs/security/journal-corrections.md`, `docs/security/rapport-audit.md`.

## Revue r42 — lot r41 (S22, O16) : VALIDÉ (code), `CSP_MODE=enforce` non autorisé tant que r42-m1 n'est pas levé

**Statut** : **S22 VALIDÉ** (en-têtes servis, génération au démarrage, validation, héritage nginx) ; **O16 VALIDÉ**. Mesures relancées : jest backend (`env -u DATABASE_URL`) 98 suites, 2798/2798 ; `nest build` et `tsc -p tests` OK ; vitest 31 fichiers, 261/261 ; `pnpm build` OK (aucun `mock/login`, `Simuler une session`, `fonts.googleapis` dans `dist`, deux woff2 émis) ; `pnpm lint` 0 erreur ; Prettier propre sur le code (seul `journal-corrections.md` est signalé). Nginx 1.27 réel (conteneur jetable, supprimé) : `nginx -t` OK, `scripts/check-headers.sh` OK sur `/` et sur l'asset `.js` (28 vérifications), 404 d'asset et route SPA inconnue portent les en-têtes. Contre-mutations (sauvegarde, `/bin/cp -f`, `cmp`) : include retiré de `location /` : 1 échec ; `always` retiré du HSTS : 1 échec ; ancre `(?:\/|$)` de `/auth` retirée : 1 échec ; restaurés. Relecture intégrale de `git diff` : aucune mutation résiduelle, aucune assertion affaiblie. Nouvelle dépendance `@fontsource-variable/outfit` 5.3.0 : version exacte, OFL-1.1, intégrité `sha512` dans le lockfile, +11 lignes, aucune autre dépendance modifiée.

**Écart majeur (connexion Google)** : constat du fixeur **exact pour Firebase** (aucun `GoogleAuthProvider`, `signInWithPopup`, `signInWithRedirect`, `getRedirectResult` ; seul `signInWithEmailAndPassword`, `Login.tsx:278`, `IdentitiesSection.tsx:101`). Nuance : le backend porte un **SSO OIDC Google** (`SSOProvider.OIDC_GOOGLE`, `auth/sso/oidc.ts:35`) lancé par **redirection pleine page** (`sso-oauth.ts:22`, `window.location.href`), sans popup ni iframe : une navigation de premier niveau n'est pas régie par la CSP, donc aucune source à ajouter. **Cela contredit la réponse de l'utilisateur** (« popup »). Question à lui poser : « Voulez-vous AJOUTER un bouton « Se connecter avec Google » via Firebase (popup), ce qui est un nouveau développement (vérification du jeton Firebase, liaison de compte, CSP complétée) ? Ou pensiez-vous au SSO Google Workspace déjà présent, qui fonctionne par redirection ? » En attendant, la CSP dimensionnée sur le code réel est la bonne.

**Écarts du fixeur** : `connect-src` resserré aux deux hôtes Firebase Auth : accepté ; `media-src assets.mixkit.co`, `object-src`/`frame-src 'none'`, `X-Frame-Options: DENY` : acceptés ; `style-src 'unsafe-inline'` (attributs `style={{}}` React) : accepté, `script-src 'self'` seul ; middleware plutôt qu'intercepteur : accepté (couvre 401/403/429).

**Réponses aux 5 questions** (décisions produit/exploitation : à confirmer par l'utilisateur)
1. Connexion Google future : voir ci-dessus ; si ajoutée, nouveau constat et CSP complétée en Report-Only d'abord (`frame-src https://<authDomain>`, `script-src https://apis.google.com`). Recommandation : ne rien ajouter d'avance. À confirmer.
2. `assets.mixkit.co` : accepté pour ce lot ; **recommandé** : héberger le fichier dans `frontend/public` (supprime la dernière source tierce hors Firebase, et la fuite d'IP/Referer vers un tiers), vérifier la licence Mixkit. Voir r42-a1. À confirmer.
3. `check-headers.sh` en CI : **accepté** de différer (le test vitest exécute le script réel) ; à brancher dans le lot CI/Phase 6 (build de l'image, `docker run`, script).
4. `X-Frame-Options: DENY` : **accepté** (nécessaire tant que la CSP est en Report-Only).
5. `report-uri` : **accepté** pour l'instant. Sans collecteur, les violations ne se voient que dans la console du navigateur de qui teste : suffisant pour la phase de recette manuelle ; pour centraliser, prévoir un collecteur tiers ou un point d'entrée public limité en débit (attention à l'abus). Ajouter `report-to`/`Reporting-Endpoints` plus tard. À confirmer.

### Nouveaux constats (ouverts)
- **r42-m1** (Mineur, CVSS 3.1) : `getAuth()` (`firebase-auth.ts:17`) initialise le résolveur popup/redirection ; sur **mobile, Safari et iOS** le SDK charge de lui-même `https://apis.google.com/js/api.js` et l'iframe `https://<authDomain>/__/auth/iframe` (`_shouldInitProactively`, vérifié dans `@firebase/auth` 1.10.8), même sans connexion Google. La CSP actuelle les bloquerait en `enforce` (erreur avalée par le SDK, mais comportement non testé : session inter-onglets, erreurs de connexion). **Remédiation** : (a) avant `enforce`, parcours de connexion sur Safari/iOS et Android avec la console ouverte en Report-Only, rapports consignés ; (b) soit remplacer `getAuth` par `initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })` (sans résolveur, donc sans iframe ni gapi), soit ajouter `frame-src`/`script-src` ciblés avec justification. **Test** : spec de `firebase-auth.ts` vérifiant l'absence de résolveur, ou rapport de recette joint au journal. Bloque `CSP_MODE=enforce`, pas le commit.
- **r42-m2** (Mineur, CVSS 2.0) : `40-security-headers.sh` accepte un `VITE_API_URL` multiligne (`sed` valide ligne par ligne : `https://a.com\nhttps://b.com` donne rc=0 et un `connect-src` tronqué `https` + saut de ligne). Valeur d'opérateur, donc pas d'exploitation distante, mais la validation « stricte » annoncée a un trou. **Remédiation** : refuser tout caractère de contrôle/saut de ligne (`case` sur `*'
'*`), borne de port ≤ 65535. **Test** : valeur multiligne refusée.
- **r42-a1** (Amélioration) : héberger le son de mention localement et retirer `media-src https://assets.mixkit.co` (`AppContext.tsx:722`).
- **r42-a2** (Amélioration, préexistant) : assets servis avec deux `Cache-Control` (`expires 1y` puis `add_header Cache-Control`). Supprimer l'`add_header` redondant ou fusionner.
- **Exploitation** : HSTS `includeSubDomains` 1 an est irréversible côté navigateurs ; vérifier que tous les sous-domaines sont en HTTPS (confirmé par l'utilisateur) et que le reverse proxy ne duplique ni ne supprime les en-têtes.

### Feu vert de commit (un seul commit, message sans mention d'assistant, chemins explicites, jamais `git add -A`)
Backend : `backend/src/common/no-store.middleware.ts`, `backend/src/main.ts`, `backend/tests/unit/common/no-store.middleware.spec.ts`, `backend/tests/http/http-test-app.ts`, `backend/tests/http/session-lifecycle.spec.ts`, `backend/tests/http/github-repos.spec.ts`, `backend/tests/http/github-webhook.spec.ts`, `backend/tests/http/admin-platform-roles.spec.ts`.
Frontend : `frontend/nginx.prod.conf`, `frontend/Dockerfile.prod`, `frontend/docker-entrypoint.d/40-security-headers.sh` (vérifier le bit exécutable ; le `chmod 755` du Dockerfile le garantit de toute façon), `frontend/src/security-headers.spec.ts`, `frontend/src/index.css`, `frontend/src/main.tsx`, `frontend/src/components/GovernanceView.css`, `frontend/package.json`, `pnpm-lock.yaml`.
Exploitation : `docker-compose.prod.yml`, `.env.production.example` (exemple seulement, jamais `.env.production`), `scripts/check-headers.sh`, `docs/deployment-production.md`, `docs/security/en-tetes-frontend.md`.
Documentation : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`. (24 entrées, sans `.claude/`.)
**Changements cassants** : le service `frontend` exige `VITE_API_URL` à l'exécution (le conteneur refuse de démarrer sinon) ; `pnpm install` requis. **Déploiement** : `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build frontend`, puis `scripts/check-headers.sh https://<frontend>` ; CSP en Report-Only ; parcours complet (connexion Firebase, MFA, temps réel, notification) sur desktop **et** mobile/Safari ; `enforce` seulement après r42-m1.

### Ordre des constats ouverts
1. **r42-m1** (avant `CSP_MODE=enforce`), r42-m2 (petit lot avec lui), r42-a1, r42-a2.
2. S30, actions d'exploitation (recensement des webhooks clients), recensement S19/S20.
3. S23 (dont limite de corps des livraisons GitHub), S24 (dont 429 de la route publique), S25, S26, A5 à A7, P5, P8, O10 à O15, O17, O21, Phase 6 (dont `check-headers.sh` en CI).

## Revue r43 — lot r42 (r42-m1, r42-m2, r42-a2) : VALIDÉ ; r42-a1 en attente de décision utilisateur

**Statut** : **r42-m1 VALIDÉ**, **r42-m2 VALIDÉ**, **r42-a2 VALIDÉ**. Mesures relancées : jest backend (`env -u DATABASE_URL`) 98 suites, 2798/2798 ; `tsc -p tests` OK ; vitest 32 fichiers, 285/285 ; `tsc --noEmit` OK ; `pnpm build` OK (aucun `mock/login`, `Simuler une session`, `fonts.googleapis` dans `dist`) ; `pnpm lint` 0 erreur (51 avertissements préexistants) ; Prettier propre. Nginx 1.27-alpine jetable (supprimé) : `nginx -t` OK, `check-headers.sh` OK (asset : un seul `Cache-Control`, valeur attendue), 404 d'asset avec les en-têtes de sécurité et sans `Cache-Control`.

**r42-m1** : `getAuth()` du SDK (`index-35c79a8a.js:11085`) = `initializeAuth` + `popupRedirectResolver` + persistance `[indexedDB, browserLocal, browserSession]` ; le nouvel appel reprend la même liste dans le même ordre, sans le résolveur : mêmes clés `firebase:authUser:*`, sessions conservées. Le seul autre apport de `getAuth` (`authTokenSyncURL`, réglage expérimental) n'est pas utilisé. Aucun `signInWithPopup`, `*Redirect*`, `getRedirectResult` dans `frontend/src` (seul `firebase-auth.ts` importe `firebase/auth` ; un test détecte la réintroduction). L'alias est dans `test.alias` : aucun effet sur `pnpm build` (le build est résolu par la condition `browser`). Fragilité mineure acceptée : le chemin `@firebase/auth/dist/esm2017/index.js` est calculé depuis `firebase/package.json` (à revoir si Firebase change de structure). Le test iPhone prouve l'absence de chargement : contre-mutation `getAuth(app)` = 5 échecs sur 6 (dont le test comportemental iOS) ; contre-mutation persistance réduite à `[browserLocalPersistence]` = 1 échec ; restaurés, `cmp` OK. Limite : l'ordre de persistance n'est vérifié que par regex sur la source, et jsdom ne prouve pas le comportement réel de Safari.
**Écart `https://apis.google.com/js/api.js` dans le bundle** : **accepté**. C'est une constante du chargeur enregistré par le SDK, jamais exécutée sans résolveur (test comportemental) ; la CSP ne l'autorise de toute façon pas. Ne pas utiliser `grep apis.google.com dist` comme critère.
**r42-m2** : sous busybox ash (nginx:1.27-alpine), 18 cas rejoués : multiligne, `\n` final, DEL (0x7f), port 0/65536/0080/20 chiffres/`:70000` IPv6/port vide/`:8x`/`_` dans l'hôte = rc=1 ; ports 1 à 65535 valides = rc=0 ; `CSP_REPORT_URI` multiligne ou `\r` = rc=1. Seul `SCHEME` et `HOSTPORT` (liste blanche) sont repris dans la CSP ; le chemin éventuel (`;`, `"` tolérés par la regex) est jeté, donc aucune injection résiduelle. 
**r42-a2** : pas d'`always` sur `Cache-Control` : correct (pas de cache d'an sur les 404). En-têtes de sécurité inclus dans les deux blocs. Remarque sur `immutable` des images non hachées : `dist` ne contient aujourd'hui que `assets/` (tous hachés) ; restreindre à `/assets/` est facultatif (amélioration, à faire si des fichiers de `public/` apparaissent).

### Décision utilisateur requise : r42-a1 (son Mixkit)
(a) garder `assets.mixkit.co` (état actuel, fuite IP/Referer vers un tiers, dernière source tierce hors Firebase, `media-src` plus large) ; (b) l'utilisateur lit la licence (fenêtre « View License » de mixkit.co) et confirme par écrit que l'embarquement est permis, puis héberge le fichier ; (c) remplacer par un son CC0 ou créé en interne. **Recommandation : (c)** (aucun doute juridique, supprime la source tierce) ; à défaut (a) sans regret, car c'est une Amélioration qui ne bloque ni le commit ni `enforce`. Pas (b) sans écrit de la licence.

### `CSP_MODE=enforce`
Après commit de ce lot, **plus aucun blocage côté code** : aucune ressource tierce non déclarée dans la CSP, plus de gapi ni d'iframe. Reste le **parcours manuel de l'utilisateur** en Report-Only, desktop et mobile/Safari (connexion, MFA, temps réel, notification sonore, déconnexion), console ouverte, zéro violation. Point à vérifier pendant ce parcours : si le projet Firebase active la protection reCAPTCHA (Enterprise) pour l'e-mail/mot de passe, le SDK chargerait un script reCAPTCHA que la CSP bloque ; si une violation apparaît, la traiter comme nouveau constat.

### Feu vert de commit (un seul commit, sans mention d'assistant, chemins explicites, jamais `git add -A`)
`frontend/src/firebase-auth.ts`, `frontend/src/firebase-auth.spec.ts` (nouveau), `frontend/vite.config.ts`, `frontend/docker-entrypoint.d/40-security-headers.sh`, `frontend/nginx.prod.conf`, `frontend/src/security-headers.spec.ts`, `scripts/check-headers.sh`, `docs/security/en-tetes-frontend.md`, `docs/security/journal-corrections.md`, `docs/security/rapport-audit.md`. (10 fichiers, sans `.claude/`.)

### Ordre des constats ouverts
1. r42-a1 (décision utilisateur, non bloquant) ; parcours manuel avant `enforce` (action utilisateur).
2. S30, actions d'exploitation (recensement des webhooks clients), recensement S19/S20.
3. **Prochaine étape probable : S23** (dont limite de corps des livraisons GitHub), **S24** (dont 429 de la route publique), **S25**, puis S26, A5 à A7, P5, P8, O10 à O15, O17, O21, Phase 6 (dont `check-headers.sh` en CI).

## Revue r44 : lot r43 (S23, S24, S25) : S25 VALIDÉ ; S23 et S24 VALIDÉS sauf un volet (r44-m1, Majeur) ; pas de commit de S23/S24 avant sa correction

**Statut** : **S25 VALIDÉ**, **S23 VALIDÉ hors plafond webhook**, **S24 VALIDÉ hors pré-contrôle du webhook** ; le plafond de 10 Mo du webhook est **À REPRENDRE** (r44-m1, régression introduite par le lot). Mesures relancées : jest backend (`env -u DATABASE_URL`) 106 suites, 2934/2934 ; `nest build` OK ; `tsc -p tests` OK ; vitest 285/285 ; `pnpm build` OK (aucun `mock/login`, `Simuler une session`, `fonts.googleapis` dans `dist`) ; lint 0 erreur (51 avertissements) ; Prettier propre sur `backend/src`, `backend/tests`, YAML, JSON, lockfile (les `.md` hors lot échouent depuis avant) ; `pnpm audit --prod --audit-level=high` code 0 (14 avis : 13 moderate, 1 low) ; `pnpm install --frozen-lockfile --lockfile-only` OK ; intégrité `sha512` du lockfile identique au registre pour 13 paquets modifiés (nodemailer 10.4.0, multer 2.5.0, cookie-parser 1.4.7, body-parser 1.20.9, lodash 4.18.1, ws 8.22.0, qs 6.17.0, socket.io-parser, engine.io, mysql2, file-type, valibot, sql-escaper). Aucune dépendance inattendue : seule nouveauté, `sql-escaper@1.5.2` (transitif de `mysql2`). Aucun `.skip`/`.only`/`xit` ajouté ; les 73 `expect` retirés sont des remplacements d'identifiants (`'P1'` vers `id('P1')`) et un seul assouplissement légitime (`redis.store.size` à 0 remplacé par un filtre sur le préfixe `github-webhook:`, car les compteurs de refus vivent désormais dans le même magasin).

**Taille du lot** : trop grand pour une revue exhaustive ligne à ligne (65 chemins, 1 297 lignes ajoutées hors lockfile), mais revue possible parce que S25 est indépendant et que S23/S24 sont couverts par 5 nouvelles suites + les contre-mutations du journal. Je recommande **2 commits** (voir feu vert) ; un découpage S23 / S24 est possible mais exigerait `git add -p` sur `main.ts`, `github-webhook.*`, `http-test-app.ts`, `fake-redis.ts` et `github-webhook.spec.ts` (risque d'incohérence entre commits), pas recommandé.

### r44-m1 (Majeur, CVSS 7.5 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`) : le plafond de 10 Mo du webhook est ouvert à n'importe quel anonyme
- **Fichier** : `backend/src/common/body-parsers.ts` (`isWebhookDelivery`), `backend/src/projects/github-webhook.controller.ts` (`@SkipThrottle()`).
- **Cause** : la condition d'accès au plafond dédié (signature « de forme valide », `X-GitHub-Delivery`, `Content-Type`) ne dépend que d'en-têtes choisis par l'appelant ; la signature est vérifiée **après** la lecture et le `JSON.parse` du corps. De plus, `@SkipThrottle()` retire la limite globale de 60/min/IP, et le compteur de refus n'intervient qu'**après** le parsing. Avant le lot, la route lisait au plus 100 ko et subissait 60/min.
- **Reproduit** (script jetable hors dépôt, Express 4.22 et la même configuration `type`/`limit`) : `POST /projects/<uuid>/webhooks/github` avec `X-Hub-Signature-256: sha256=000...0` (64 zéros), `X-GitHub-Delivery: forged-1234`, `Content-Type: application/json` et 9,9 Mo : le corps est entièrement lu, copié en `rawBody` et parsé (réponse 401 du gestionnaire en 152 ms). Un anonyme peut enchaîner ces requêtes sans limite : mémoire (corps brut + objet, plusieurs fois 10 Mo par requête) et boucle d'événements (parse synchrone).
- **Remédiation attendue** :
  1. **Pré-contrôle avant lecture** : un middleware placé avant `registerBodyParsers` sur la route de réception consulte le compteur `github-webhook-failures:<ip>` (même clé, même repli : Redis indisponible = on laisse passer) et répond **429 sans lire le corps** (`Connection: close`) au-delà de 20 refus/minute. Une livraison valide n'est jamais comptée ; une adresse GitHub déjà « refusée » par un tiers reste donc seulement gênée pour ses propres refus, comme voulu par S24-iv. Mais comme un 429 pré-parsing bloquerait aussi une livraison valide venant de cette adresse, le pré-contrôle ne doit **pas** répondre 429 aux requêtes dont la signature est valide : voir 2.
  2. **Vérifier la signature dans le hook `verify` de `body-parser`** (corps brut en main, avant `JSON.parse`) en cherchant le secret du projet : en cas d'échec, lever 401 (compté) sans parser. Cela supprime le coût CPU du parse et permet de compter le refus tôt. Alternative acceptable : un seuil réduit pour le plafond dédié (voir 3) si la vérification en amont est jugée trop invasive.
  3. **Plafond réduit** : GitHub ne met dans un événement `push` que les 20 derniers commits (à confirmer dans la documentation GitHub) ; 25 Mo est un maximum théorique. Recommandation : **2 Mo** (au plus 5 Mo) au lieu de 10 Mo. Décision produit/exploitation : à confirmer par l'utilisateur.
  4. **Exploitation** : `limit_req` Nginx sur `location ~ ^/projects/[^/]+/webhooks/github$` (par exemple 30 r/min par adresse, burst 10) et `client_max_body_size` égal au plafond retenu ; à documenter dans `docs/deployment-production.md`.
- **Tests attendus** : (a) 21 requêtes à signature bien formée mais fausse de plusieurs Mo : les 20 premières 401, la 21e 429 **et le corps n'est pas lu** (compter les octets reçus ou vérifier que `rawBody`/parseur n'est pas appelé) ; (b) une livraison valide de plusieurs Mo passe encore après ces 429 (S24-iv conservé) ; (c) signature fausse : le corps n'est pas parsé en JSON (espion sur `JSON.parse` ou JSON invalide de 3 Mo qui donne 401 et non 400) ; (d) contre-mutation : retirer le pré-contrôle fait échouer (a).

### r44-m2 (Mineur) : le verrouillage par compte teste puis incrémente (non atomique)
- **Fichier** : `backend/src/auth/account-lockout.ts` (`assertAllowed` puis `recordFailure`), appelé par `AuthService.login` et `verifyMfaChallenge`.
- **Cause** : N requêtes simultanées sur un même compte passent toutes `assertAllowed` avant que la première enregistre son échec (le hachage de mot de passe dure plusieurs dizaines de ms). Seul le plafond par IP (5/min) les borne : un attaquant réparti sur K adresses obtient environ 5K essais simultanés avant tout 429. Même défaut pour le MFA (le compteur de ticket est, lui, incrémenté avant vérification).
- **Remédiation attendue** : incrémenter d'abord (réservation) puis comparer : `assertAllowed` devient « incrémente `minute`, refuse si > 5 », et le succès rembourse (ou `reset`). Test : 30 tentatives simultanées avec un mauvais mot de passe depuis 30 adresses : au plus 5 atteignent la vérification du mot de passe (espion sur `verifyPassword`).

### r44-m3 (Mineur) : `docker-compose.prod.yml` neutralise le caractère obligatoire de `TRUST_PROXY_HOPS`
- `TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-1}` : une valeur silencieuse « 1 » est posée si l'exploitant oublie la variable, ce qui annule la protection « démarrage refusé » du code. Valeur 1 erronée derrière un CDN : tous les clients partagent l'adresse du CDN (un seul compteur global : déni de service par une seule adresse). **Remédiation** : `${TRUST_PROXY_HOPS:?TRUST_PROXY_HOPS requis}` ; doc et `.env.production.example` conservent l'exemple. Vérification après déploiement : `curl -H 'X-Forwarded-For: 1.2.3.4'` via le proxy ne doit jamais faire apparaître `1.2.3.4` comme adresse du client dans les journaux.

### r44-a1 (Amélioration) : exemption SCIM trop large
- L'exemption du pipe UUID couvre tout `ScimController`, y compris les trois routes JWT d'administration `workspaces/:workspaceId/scim/keys[/:keyId]` (`scim.controller.ts:112-129`) qui n'ont aucune raison d'y échapper. **Remédiation** : `UuidPipe` sur ces 3 routes ; l'exemption du test méta se limite aux méthodes `getUser/replaceUser/patchUser/deleteUser` (identifiant SCIM, 404 au format SCIM). Test : `GET /workspaces/abc/scim/keys` renvoie 400.

### r44-a2 (Amélioration) : limiteur Redis, pas de disjoncteur
- `RedisThrottlerStorage` attend 500 ms par requête quand Redis ne répond plus (le garde global s'exécute sur toutes les routes) alors que `AccountLockout` a un disjoncteur de 5 s. **Remédiation** : même mécanisme (ignorer Redis 5 s après une erreur) ; test : 100 requêtes pendant une panne Redis n'ajoutent pas 100 × 500 ms.

### Analyse des points d'attention
- **Stockage Redis du limiteur** : script Lua atomique (`INCR`, `PTTL`, `PEXPIRE` si pas de TTL) correct, y compris la réparation d'une clé sans TTL ; clés `throttle:<sha256>` ; secondes arrondies par excès. Repli mémoire par instance : une saturation volontaire de Redis ne contourne pas la limite (le compteur local la maintient) ; seule la cohérence entre instances est perdue (accepté). Réserve : r44-a2.
- **Verrouillage par compte** : pas d'énumération (comptes inexistants comptés de la même façon, 429 avant tout calcul de hachage pour existant ou non, donc temps constant conservé ; `enumeration-timing` non affecté). Déni de service ciblé : réel, voir réponse Q3. Réinitialisation au succès correcte (le verrou posé n'est pas levé par un succès, c'est voulu car le compte verrouillé refuse même le bon mot de passe). Réserve : r44-m2.
- **`trust proxy`** : entier 0 à 5, jamais `true` ni liste ; avec `hops = 1` et `$proxy_add_x_forwarded_for`, l'adresse forgée à gauche est ignorée (test présent). Réserve : r44-m3.
- **Dépendances** : `nodemailer` 10 : `mail.service.ts` n'utilise que `createTransport({host, port, secure, auth})` et `sendMail({from,to,subject,text,html})` ; Node 20 (image `node:20-alpine`) satisfait `engines >=20`. Je n'ai pas relu le journal des modifications de `nodemailer` 9 et 10 (limite) : essai SMTP en préproduction requis. Surcharges bornées par majeure : compatibles, lockfile cohérent.

### Écarts déclarés : verdicts
| Écart | Verdict |
| --- | --- |
| SCIM exempté du pipe UUID | **Accepté** pour les 4 routes d'identifiant SCIM (Entra) ; **à reprendre** pour les 3 routes d'administration (r44-a1) |
| Test méta au lieu d'ESLint | **Accepté** (admis par le rapport, plus fidèle) |
| Stockage Redis interne | **Accepté** (relu : Lua atomique, repli) ; r44-a2 |
| Compteur webhook par adresse | **Accepté**, à condition du pré-contrôle avant lecture (r44-m1) |
| 10 Mo au lieu de 25 Mo | **Réduire** (r44-m1 point 3) ; à confirmer par l'utilisateur |
| `firebase` non monté en 13 | **Accepté** : `@grpc/grpc-js` corrigé par surcharge bornée (1.13.x) ; avertissement de pair préexistant limité aux tests de règles |
| `nodemailer` 10 | **Accepté** sous réserve d'un envoi réel en préproduction |
| 41 champs sans `MaxLength` | **Accepté pour ce lot** (plafond de 1 Mo) ; lot dédié ouvert (r44-a3) |
| O10 partiel | **Accepté** ; `state` OAuth du calendrier reste ouvert |

### r44-a3 (Amélioration) : bornes des 41 champs texte restants
Lot dédié après S23 : titres et noms 255, descriptions 20 000, tableaux 50 éléments de 100 caractères (valeurs du fixeur, raisonnables). À confirmer par l'utilisateur avant d'imposer (refus de contenus plus longs).

### Feu vert de commit (après correction de r44-m1, r44-m2 et r44-m3 ; r44-a1 et r44-a2 souhaitables)
Sans mention d'assistant, chemins explicites, jamais `git add -A`, sans `.claude/` ni `.env` réel.
- **Commit 1, S25 (peut partir tout de suite)** : `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `backend/package.json`, `backend/tests/unit/dependency-overrides.spec.ts`, `docs/security/audit-exceptions.md`.
- **Commit 2, S23 + S24 (après r44-m1/m2/m3)** : `.env.example`, `.env.production.example`, `docker-compose.prod.yml`, `docs/deployment-production.md`, `docs/security/journal-corrections.md`, `docs/security/rapport-audit.md`, `backend/src/{app.module,main}.ts`, `backend/src/common/{body-parsers,redis-throttler.storage,trust-proxy,uuid.pipe}.ts`, `backend/src/redis/redis.service.ts`, `backend/src/auth/{account-lockout,auth.service}.ts`, `backend/src/auth/dto/{login,register}.dto.ts`, `backend/src/auth/sso/sso.controller.ts`, `backend/src/auth/scim/scim.controller.ts` (si r44-a1), `backend/src/admin/admin.controller.ts`, `backend/src/notes/notes.controller.ts`, `backend/src/notes/dto/note.dto.ts`, `backend/src/notifications/notifications.controller.ts`, `backend/src/projects/{ai,comments,github-webhook,invitations,projects}.controller.ts`, `backend/src/projects/github-webhook.service.ts`, `backend/src/projects/dto/{ai-command,ai-media-fields,list-query,oauth-callback}.dto.ts`, `backend/src/tracking/tracking.controller.ts`, tous les fichiers de tests listés dans le journal (adaptés et nouveaux, sauf `dependency-overrides.spec.ts`).

### Changements cassants et déploiement
`TRUST_PROXY_HOPS` obligatoire en production (valeur à confirmer par l'exploitant : 1 pour un seul Nginx d'hôte, 2 avec CDN) ; Nginx : `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` et `client_max_body_size` aligné sur le plafond retenu pour la route du webhook ; non-UUID en 400 ; verrouillage de compte (429 après 5 échecs/min, verrou 15 min dès 10 échecs/24 h) : prévoir une procédure de déblocage dans le runbook (suppression des clés Redis `lockout:*` du compte) ; `pnpm install --frozen-lockfile`, reconstruire les images ; envoi SMTP réel en préproduction (nodemailer 10).

### Réponses aux 8 questions du fixeur
1. **`TRUST_PROXY_HOPS`** : je ne peux pas le savoir (configuration Nginx de l'hôte hors dépôt). Recommandation : retirer le défaut `:-1` (r44-m3). **À confirmer par l'utilisateur** : nombre de proxys réels.
2. **41 champs** : valeurs proposées acceptées, lot dédié (r44-a3), **à confirmer par l'utilisateur**.
3. **Verrouillage** : seuils acceptés ; déni de service ciblé **accepté à titre provisoire** (coût attaquant : environ 10 requêtes par 15 minutes pour garder un compte verrouillé, le compteur de 24 h repartant ensuite à zéro). Conditions : r44-m2, journaliser (niveau `warn`, hachage de l'identité seulement) chaque pose de verrou, procédure de déblocage documentée. L'alternative (compte + adresse inconnue) est une amélioration ultérieure. **À confirmer par l'utilisateur**.
4. **10 Mo** : trop généreux (r44-m1 point 3) : 2 Mo recommandé. **À confirmer par l'utilisateur**.
5. **nodemailer 10** : acceptable, avec envoi réel en préproduction avant production.
6. **Exemption SCIM** : validée pour les 4 routes SCIM d'identifiant ; refusée pour les 3 routes d'administration (r44-a1).
7. **`invitations/check` à 20/min** : valeur acceptée (jeton de 256 bits non énumérable) ; **à confirmer par l'utilisateur** (décision d'exploitation).
8. **CI `pnpm audit`** : reste A9 / Phase 6 ; non bloquant.

### Ordre des constats ouverts
1. **r44-m1** (Majeur, bloque le commit 2), r44-m2, r44-m3 ; puis r44-a1, r44-a2.
2. r44-a3 (bornes des 41 champs, lot dédié), r42-a1 (décision utilisateur), parcours manuel avant `CSP_MODE=enforce`.
3. S30, actions d'exploitation (recensement des webhooks clients), recensement S19/S20.
4. S26, A5 à A7, P5, P8, O10 à O15, O17, O21, Phase 6 (dont `pnpm audit` et `check-headers.sh` en CI, migration NestJS 11 = A9).

---

## Revue r45 : reprise r44 du fixeur : r44-m2, r44-m3, r44-a1, r44-a2 VALIDÉS ; r44-m1 VALIDÉ (écart accepté) avec un reliquat Mineur (r45-m1) ; feu vert de commit pour S23 + S24

**Statut** : r44-m1 **VALIDÉ** (le Majeur d'origine est levé : plus d'analyse JSON avant la signature, plafond 2 Mo, refus avant lecture) avec un nouveau constat **r45-m1 (Mineur)** sur le contournement du compteur par le changement d'identifiant de projet, non bloquant pour le commit mais **à traiter ou à neutraliser côté Nginx avant le déploiement** de ce lot. r44-m2, r44-m3, r44-a1, r44-a2 **VALIDÉS**.

**Mesures relancées par l'architecte** : jest backend (`env -u DATABASE_URL`) 106 suites, **2949/2949** (message « worker process has failed to exit gracefully » : sans échec, cause non investiguée (minuterie ou connexion restée ouverte) ; à nettoyer avec `--detectOpenHandles`, non bloquant) ; `nest build` OK ; `tsc -p tests` OK ; vitest 285/285 ; `pnpm build` OK, 0 occurrence de `mock/login`, `Simuler une session`, `fonts.googleapis` dans `frontend/dist` ; lint 0 erreur (51 avertissements, inchangé) ; Prettier propre sur `backend/src`, `backend/tests`, `docker-compose.prod.yml`, `.env.example`, `docs/deployment-production.md` ; `pnpm audit --prod --audit-level=high` code 0 (15 avis : 2 low, 13 moderate ; un avis « low » de plus qu'en r44, publié depuis) ; `pnpm-lock.yaml` non modifié. Aucun `.skip`/`.only`/`xit`/`fit` ajouté ; aucun `expect` affaibli (les retraits sont des remplacements d'identifiants par des UUID, le changement de `main-raw-body.spec.ts` déplace l'assertion vers `body-parsers.ts` et ajoute `registerBodyParsers(app)`).

**Contre-mutations (toutes restaurées, `cmp` OK, aucun processus restant)** :
- r44-m1, pré-contrôle neutralisé (`failures >= 1e9`) : 1 échec sur 67 (le test « sans lire le corps ») ; JSON analysé avant la signature : 1 échec (espion `JSON.parse`) ; plafond remis à 10 Mo : 2 échecs (413 et limites documentées).
- r44-m2, `assertAllowed` en lecture puis incrément (non atomique) : 2 échecs (unitaire à 30 appels simultanés ; HTTP à 30 adresses).
- Incident d'outillage : un `cp` interactif (alias du shell) a bloqué une restauration en cours de session ; les trois fichiers touchés (`body-parsers.ts`, `github-webhook.service.ts`, `account-lockout.ts`) ont été restaurés depuis des copies prises avant mutation et vérifiés par `cmp`.

### Verdicts
| Constat | Verdict | Remarque |
|---|---|---|
| r44-m1 | **VALIDÉ** (écart accepté) | voir ci-dessous ; reliquat r45-m1 (Mineur) |
| r44-m2 | **VALIDÉ** | incrément avant comparaison, 30 tentatives simultanées : 5 vérifications de mot de passe ; journalisation par empreinte ; procédure de déblocage documentée et cohérente avec les clés réelles |
| r44-m3 | **VALIDÉ** | `${TRUST_PROXY_HOPS:?...}`, test sans `:-` ; `.env.production` local et VM contiennent déjà `TRUST_PROXY_HOPS=1` |
| r44-a1 | **VALIDÉ** | pipe sur les 3 routes d'administration SCIM ; exemption du test méta réduite à 4 méthodes ; `updateUser` est bien le nom réel |
| r44-a2 | **VALIDÉ** | disjoncteur de 5 s, test de 100 appels en panne |

### Écart du fixeur sur r44-m1 : blocage par couple (adresse, projet) : **ACCEPTÉ**, avec complément
Ma remédiation r44 contenait une contradiction (un 429 avant lecture ne peut pas épargner une livraison valide dont la signature n'est pas encore connue) : le fixeur a raison de la lever. Un blocage par adresse seule ferait perdre, pendant 60 s, les livraisons valides de tous les projets venant d'une adresse GitHub partagée ; le blocage par (adresse, projet) limite l'effet à un projet, et GitHub permet « Redeliver ». Le test (b) adapté (autre projet accepté pendant le blocage, projet bloqué accepté après 61 s) couvre l'intention de S24-iv. **Condition** : compléter par un compteur agrégé par adresse (r45-m1), sinon la clé par projet est contournable.

### r45-m1 (Mineur, CVSS 5.3 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`) : le compteur de refus du webhook est contournable en changeant l'identifiant de projet
- **Fichiers** : `backend/src/common/body-parsers.ts` (`WEBHOOK_PATH`, `webhookFailurePrecheck`), `backend/src/projects/github-webhook.util.ts` (`webhookFailureKey`), `docs/deployment-production.md` (bloc Nginx).
- **Cause (lecture du code, non rejoué par un script)** : la clé est `github-webhook-failures:<ip>:<projectId>`. Un anonyme qui change l'UUID à chaque requête (UUID aléatoire, ou variantes de casse d'un UUID réel : `ParseUUIDPipe` accepte majuscules et minuscules, la clé n'est pas normalisée) obtient 20 refus gratuits par identifiant, donc jamais de 429. Comme `@SkipThrottle()` retire la limite globale de 60/min, **aucune limite de débit applicable à cette route ne subsiste côté application** : chaque requête lit jusqu'à 2 Mo en mémoire (brut, sans analyse JSON : le coût CPU de l'attaque d'origine a disparu). Seul le `limit_req` Nginx (documenté mais pas encore déployé) la borne. Deux contournements de Nginx s'ajoutent : (1) `location ~ ^/projects/[^/]+/webhooks/github$` n'accepte pas l'URL avec `/` final, que l'application accepte (`WEBHOOK_PATH` admet `/?`) : la requête tombe dans le `location` par défaut, sans `limit_req` ; (2) le routage Express est insensible à la casse (`/WEBHOOKS/GITHUB`) alors que `WEBHOOK_PATH` et le `location` y sont sensibles : ces requêtes évitent le pré-contrôle et le plafond dédié, et passent par l'analyseur JSON de 1 Mo (analysé avant la signature, sans limite de débit applicative).
- **Impact** : consommation mémoire et bande passante (déni de service partiel) par une adresse unique, à un débit que seul Nginx borne. Moins grave que r44-m1 d'origine (2 Mo brut au lieu de 10 Mo analysé), d'où Mineur.
- **Remédiation attendue** :
  1. Normaliser l'identifiant en minuscules dans `webhookFailureKey` et dans le pré-contrôle ;
  2. ajouter un **compteur agrégé par adresse** (clé `github-webhook-failures:<ip>`, incrémenté à chaque refus quel que soit le projet), consulté par le pré-contrôle avec un seuil plus haut (proposition : 100 refus/minute) ; une adresse GitHub n'atteint ce seuil que si elle envoie elle-même plus de 100 livraisons refusées par minute vers ce serveur ;
  3. rendre `WEBHOOK_PATH` insensible à la casse (drapeau `i`) et aligner `isWebhookDelivery` ;
  4. Nginx : `location ~* ^/projects/[^/]+/webhooks/github/?$` ; et documenter que `limit_req` + `client_max_body_size 2m` sont **obligatoires** avant la mise en production de ce lot.
- **Tests attendus** : (a) 21 requêtes à 21 UUID différents depuis la même adresse : au moins une 429 avant lecture du corps après le seuil agrégé (avec le seuil abaissé en test) ; (b) un UUID en majuscules et en minuscules partage le même compteur ; (c) `/projects/<uuid>/webhooks/GITHUB` et `/projects/<uuid>/webhooks/github/` sont traités comme la route de réception (pré-contrôle et plafond de 2 Mo) ; (d) contre-mutation : retirer le compteur agrégé fait échouer (a).
- **Gravité et conditions** : ne bloque pas le commit (aucun effet tant que le lot n'est pas déployé). À traiter **avant le déploiement** ; à défaut, le déploiement exige que le bloc Nginx (corrigé en 4) soit en place et vérifié.

### Réponses aux 3 questions du fixeur
1. **Clé (adresse, projet)** : acceptée (voir ci-dessus), à compléter par le compteur agrégé et la normalisation de la casse (r45-m1). Le choix « adresse seule » est refusé : il pénaliserait les autres projets de la même adresse GitHub.
2. **`limit_req` 30 r/min, burst 10** : valeurs acceptables au démarrage (volume d'un petit déploiement), avec `limit_req_status 429` déjà documenté. Elles sont par adresse et non par projet : si des livraisons légitimes reçoivent des 429 Nginx (journal d'erreurs Nginx, « Recent Deliveries » de GitHub), relever à 120 r/min et burst 30 ; le garde-fou applicatif (20 refus/min/projet, puis agrégé) reste la vraie limite des refus. Corriger l'expression du `location` (r45-m1.4).
3. **Test de préproduction** : requis, avec : une livraison réelle GitHub (« Redeliver » comprise) sur un dépôt de test, un `push` de plus de 1 Mo (vérifie `client_max_body_size 2m`), 25 requêtes à signature fausse depuis une adresse de test (401 puis 429 sans lire le corps), la même avec des UUID variés (valide r45-m1), l'URL avec `/` final, un `curl -H 'X-Forwarded-For: 1.2.3.4'` (aucune adresse forgée dans les journaux), un envoi SMTP réel (nodemailer 10), un déblocage de compte par la procédure documentée.

### Contrôle de déploiement (rappel)
Production actuelle : 25760c9 (S18 à S25). Ce lot n'y est pas. Avant le prochain `up` : `TRUST_PROXY_HOPS=1` présent (OK en local et sur la VM), bloc Nginx du webhook en place, `pnpm install --frozen-lockfile` inutile (lockfile inchangé depuis S25), reconstruire les images, procédure de déblocage connue.

### Feu vert de commit : **OUI** pour S23 + S24 et les reprises r44 (r45-m1 suivra dans un commit séparé, avant déploiement)
Sans aucune mention d'assistant, chemins explicites (jamais `git add -A`, sans `.claude/` ni `.env` réel). Le découpage fin S23 / S24 n'est pas recommandé (mêmes fichiers : `main.ts`, `github-webhook.*`, `http-test-app.ts`, `fake-redis.ts`).

**Commit 1** (code, tests, configuration) :
- Fichiers : `.env.example`, `.env.production.example`, `docker-compose.prod.yml`, `docs/deployment-production.md`, `backend/src/` (modifiés : `admin/admin.controller.ts`, `app.module.ts`, `main.ts`, `auth/auth.service.ts`, `auth/dto/{login,register}.dto.ts`, `auth/scim/scim.controller.ts`, `auth/sso/sso.controller.ts`, `notes/notes.controller.ts`, `notifications/notifications.controller.ts`, `projects/{ai,comments,invitations,projects,github-webhook}.controller.ts`, `projects/github-webhook.{service,util}.ts`, `projects/dto/ai-command.dto.ts`, `redis/redis.service.ts`, `tracking/tracking.controller.ts` ; nouveaux : `auth/account-lockout.ts`, `common/{body-parsers,redis-throttler.storage,trust-proxy,uuid.pipe}.ts`, `notes/dto/`, `projects/dto/{ai-media-fields,list-query,oauth-callback}.dto.ts`) et l'ensemble de `backend/tests/` (28 entrées modifiées ou nouvelles, toutes du lot).
- Message :
  ```
  feat(security): validation des entrées, limites de corps, limitation de débit par adresse et verrouillage par compte (S23, S24)

  Identifiants d'URL en UUID (400 sinon), DTO bornés sur les champs sensibles, corps JSON plafonnés
  à 1 Mo. Adresse réelle du client derrière un reverse proxy (TRUST_PROXY_HOPS obligatoire),
  limiteur de débit sur Redis avec disjoncteur, verrouillage progressif par compte (réservation
  atomique, journalisation par empreinte). Webhook GitHub : corps brut de 2 Mo au plus, signature
  vérifiée avant toute analyse JSON, refus comptés par adresse et projet avec réponse 429 avant
  lecture du corps. Procédures Nginx et de déblocage documentées.
  ```
**Commit 2** (documentation d'audit) : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`.
- Message : `docs(security): revues r43 à r45 et journal des corrections des lots S23 et S24`

Avant chaque commit : `git diff --cached --stat` pour vérifier l'absence de `.claude/`, `.env` et de fichiers hors liste.

### Ordre des constats ouverts
1. **r45-m1** (Mineur, à traiter avant le déploiement de ce lot ; sinon Nginx corrigé et vérifié en préproduction).
2. Préproduction du lot S23/S24 (liste Q3), r44-a3 (bornes des 41 champs, lot dédié, à confirmer par l'utilisateur), r42-a1 (décision utilisateur), parcours manuel avant `CSP_MODE=enforce`.
3. S30, actions d'exploitation (recensement des webhooks clients), recensement S19/S20.
4. S26, A5 à A7, P5, P8, O10 à O15, O17, O21, Phase 6 (dont `pnpm audit` et `check-headers.sh` en CI, migration NestJS 11 = A9, avertissement `pnpm.overrides` de package.json « no longer read » selon la version locale de pnpm : à vérifier avec la version épinglée en production).

## Revue r46 : reprise r45 du fixeur : r45-m1 VALIDÉ ; feu vert de commit séparé ; conditions de déploiement du lot S23/S24/r44/r45

**Statut** : r45-m1 **VALIDÉ**. Les points 1 à 4 de la remédiation et les tests (a) à (d) sont couverts. Aucun nouveau constat Mineur ou supérieur. Aucun résidu de mutation.

**Vérification du diff (`git diff HEAD`)** : 6 fichiers, exactement ceux annoncés (`body-parsers.ts`, `github-webhook.service.ts`, `github-webhook.util.ts`, `github-webhook.spec.ts`, `deployment-production.md`, `journal-corrections.md`). Aucune trace de mutation (`1e9`, drapeau `i` ou `toLowerCase()` retirés) ; les trois fichiers sources ont été comparés à leur état attendu, et l'incident de restauration manuelle du fixeur n'a laissé aucun écart. `pnpm-lock.yaml` intact.

**Points vérifiés**
1. Casse : `webhookFailureKey` met l'identifiant en minuscules ; le pré-contrôle et le service utilisent la même fonction.
2. Compteur agrégé `github-webhook-failures:<ip>` : incrémenté dans `registerFailure` (même transaction de délai Redis, `Promise.all`), lu en parallèle dans le pré-contrôle sous le même délai de 300 ms, seuil 100. Redis en panne : inchangé (401, au mieux).
3. `WEBHOOK_PATH` avec le drapeau `i` (`isWebhookDelivery` l'utilise).
4. Nginx : `location ~* ^/projects/[^/]+/webhooks/github/?$`, `limit_req` et `client_max_body_size 2m` déclarés obligatoires.

**Mesures relancées** : jest backend (`env -u DATABASE_URL`) 106 suites, **2959/2959** ; `nest build` OK ; `tsc -p tests` OK ; vitest 285/285 ; `pnpm build` OK, 0 occurrence de `mock/login`, `Simuler une session`, `fonts.googleapis` dans `frontend/dist` ; ESLint backend 0 erreur (15 avertissements `any` préexistants) ; Prettier propre (`backend/src`, `backend/tests`, `docs/deployment-production.md`).

**Contre-mutations (restaurées avec `\cp`, `cmp` identique, aucun processus restant)**
- compteur agrégé neutralisé (service et pré-contrôle) : 2 échecs, les deux tests (a) ;
- `toLowerCase()` retiré : 1 échec, (b) ;
- drapeau `i` retiré : 2 échecs (plafond 2 Mo sur `/webhooks/GITHUB` et `/WEBHOOKS/Github/`). Ma première tentative (sed non appliqué) n'avait rien muté : 77/77, rejouée correctement ensuite.

### Réponses aux 3 questions du fixeur
1. **Les refus d'un projet déjà bloqué prolongent-ils la fenêtre ?** Non, la prémisse est inexacte : `incrementWithTtl` fait `EXPIRE key ttl NX`, le TTL n'est posé qu'à la création de la clé. La fenêtre est fixe (60 s depuis le premier refus) ; un client qui insiste fait grossir le compteur mais ne repousse pas l'expiration. Par ailleurs, un refus rendu par le pré-contrôle n'atteint pas le service et n'incrémente rien. Comportement correct, rien à changer.
2. **Limite de débit uniquement côté Nginx hors refus d'authentification** : acceptable, à condition que `limit_req` soit en place (déjà rendu obligatoire dans la doc) ; une livraison valide a un coût borné (2 Mo, signature vérifiée avant analyse). Condition de déploiement ci-dessous.
3. **Seuil via objet exporté mutable plutôt que variable d'environnement** : accepté. Une variable d'environnement permettrait de désactiver la protection par erreur de configuration ; l'objet n'est modifiable que par du code. Réserve mineure (r46-a1, Amélioration, non bloquante) : la valeur par défaut est testée (`toBe(100)`), ce qui suffit ; ne pas exposer `webhookLimits` hors des tests et de ces deux modules.

### Feu vert de commit : **OUI** (commit 3, séparé des deux précédents)
Chemins explicites, jamais `git add -A`, sans `.claude/` ni `.env` réel ; vérifier avec `git diff --cached --stat`.
- **Commit code** : `backend/src/common/body-parsers.ts`, `backend/src/projects/github-webhook.service.ts`, `backend/src/projects/github-webhook.util.ts`, `backend/tests/http/github-webhook.spec.ts`, `docs/deployment-production.md`.
  ```
  fix(security): compteur de refus du webhook GitHub agrégé par adresse, identifiant normalisé et route insensible à la casse (r45-m1)

  Un second compteur par adresse, tous projets confondus (100 refus par minute), complète celui
  par couple adresse/projet : changer d'identifiant de projet ne contourne plus la limite. Les
  identifiants sont mis en minuscules, la détection de la route de réception ignore la casse.
  Documentation Nginx corrigée (location insensible à la casse, barre finale) et limit_req
  déclaré obligatoire avant la mise en production.
  ```
- **Commit documentation d'audit** (après ma mise à jour) : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, message `docs(security): revues r46 et reprise r45 du webhook GitHub`.

### Conditions de déploiement du lot S23/S24/r44/r45 (production actuelle : 25760c9)
Le lot est commité en local, non poussé. Avant le `up` :
1. **Poussé et construit** : commits S23/S24, r45-m1 poussés ; images reconstruites ; `pnpm install --frozen-lockfile` inutile (lockfile inchangé).
2. **`TRUST_PROXY_HOPS=1`** présent dans `.env.production` sur la VM (obligatoire : `docker-compose.prod.yml` refuse de démarrer sinon) ; vérifié OK en r45, à revérifier le jour du déploiement. Valeur = nombre de proxys réels devant l'API (Nginx seul = 1).
3. **Nginx de l'hôte**, dans `http { }` : `limit_req_zone $binary_remote_addr zone=gh_webhook:10m rate=30r/m;`. Dans le serveur de l'API : `location ~* ^/projects/[^/]+/webhooks/github/?$ { limit_req zone=gh_webhook burst=10 nodelay; limit_req_status 429; client_max_body_size 2m; ... }` avec les mêmes `proxy_pass` et en-têtes que la route générale, **placé avant tout autre `location` regex** pouvant la capter (premier regex qui correspond gagne). `proxy_set_header X-Forwarded-For $remote_addr` (écrase, n'ajoute pas) pour qu'un en-tête forgé n'atteigne pas l'application. `nginx -t` puis rechargement.
4. **Vérifications après rechargement**, depuis une adresse de test :
   - 25 requêtes à signature fausse : 401 puis 429 (sans lire le corps) ; la même avec 120 UUID variés : 429 agrégé ;
   - `/webhooks/GITHUB` et `/webhooks/github/` : mêmes 429 (valide r45-m1 côté Nginx) ;
   - livraison réelle GitHub (« Redeliver ») sur un dépôt de test : 201 ; un `push` de plus de 1 Mo accepté (`client_max_body_size 2m`), plus de 2 Mo en 413 ;
   - `curl -H 'X-Forwarded-For: 1.2.3.4'` : aucune adresse forgée dans les journaux ni dans les clés Redis ;
   - un envoi SMTP réel (nodemailer 10) ; un déblocage de compte par la procédure documentée ; page de connexion et appel authentifié normaux (limiteur Redis).
5. **Redis** joignable par l'API (limiteur, verrouillage, compteurs) ; en panne, le disjoncteur laisse passer (vérifier qu'il ne reste pas ouvert).
6. **Retour arrière** prêt : image 25760c9 conservée ; le retour supprime aussi l'exigence `TRUST_PROXY_HOPS`.
7. Surveillance post-déploiement : 429 Nginx sur le webhook (relever à 120 r/min, burst 30 si légitimes), « Recent Deliveries » GitHub, journaux de verrouillage de compte.

### Ordre des constats ouverts
1. Déploiement du lot S23/S24/r44/r45 : conditions ci-dessus (Nginx, `TRUST_PROXY_HOPS`, préproduction) ; r45-m1 **fermé**.
2. r44-a3 (bornes des 41 champs, lot dédié, à confirmer par l'utilisateur), r42-a1 (décision utilisateur), parcours manuel avant `CSP_MODE=enforce`, avertissement jest « worker process has failed to exit gracefully » (`--detectOpenHandles`, non bloquant).
3. S30, actions d'exploitation (recensement des webhooks clients), recensement S19/S20.
4. S26, A5 à A7, P5, P8, O10 à O15, O17, O21, Phase 6 (dont `pnpm audit` et `check-headers.sh` en CI, migration NestJS 11 = A9, avertissement `pnpm.overrides`).

## Revue r47 : lot Phase 6-1 (A9, CI, pnpm 10, e2e) : A9 VALIDÉ sauf la migration de dérive (À REPRENDRE, bloquante pour le déploiement)

**Statut** : CI, pnpm 10.34.9, O21, infrastructure e2e et `docs/security/ci.md` **VALIDÉS**. Migration `20261116000000_a9_migration_drift` **À REPRENDRE** : appliquée telle quelle sur la base de production, elle échoue (voir r47-m1). Un constat Majeur (déploiement), un Mineur (429 en anglais) et deux Améliorations nouveaux.

### Contexte de production (2026-11-11)
Production déployée sur 93711a8 (S23, S24, r44, r45). Vérifié par l'utilisateur : webhook 401 vingt fois puis 429 ; clés Redis portant l'adresse réelle (jamais un `X-Forwarded-For` forgé) ; Nginx : 429 sur la limite de débit et 413 au-delà de 2 Mo ; connexion 401 cinq fois puis 429. S21, S23 et S24 sont donc **confirmés en production**.

### Nouveaux constats

| ID | Sévérité | Constat | Remédiation et critère d'acceptation |
| --- | --- | --- | --- |
| **r47-m1** | **Majeur** (bloquant le déploiement ; pas de fuite de données, risque de disponibilité et d'état de migration « échouée ») | `backend/prisma/migrations/20261116000000_a9_migration_drift/migration.sql` : `ALTER TABLE User RENAME INDEX ssoUid TO User_ssoUid_key` **n'est pas idempotente**. Lecture seule de la production (MySQL 8.0.46, `information_schema`) : l'unique de `User.ssoUid` s'y appelle **déjà `User_ssoUid_key`** (pas d'index `ssoUid`), et `SSOConfiguration.updatedAt` n'a **déjà aucun DEFAULT** (`datetime(3) NOT NULL ON UPDATE CURRENT_TIMESTAMP(3)`, identique à une base neuve après la migration). La base de production n'a donc pas la dérive que la CI corrige (elle vient de `init_production` et de correctifs manuels antérieurs, ou d'un historique non rejoué). Reproduit sur MySQL 8.0 jetable : `prisma migrate deploy` sur l'état « production » donne `P3018 … Key 'ssoUid' doesn't exist in table 'User'` (code 1176, requête n° 2), puis `P3009` à chaque `migrate deploy` suivant, jusqu'à un `prisma migrate resolve --rolled-back`. MySQL n'a pas de DDL transactionnel : le `DROP DEFAULT` (no-op ici) reste appliqué, la migration est marquée « échouée » et **plus aucune migration ne s'applique**. | Rendre la migration **tolérante aux deux états**. Le `DROP DEFAULT` est déjà idempotent (vérifié : sans effet sur une colonne sans défaut). Pour l'index, garde par `information_schema` : `SET @i := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND INDEX_NAME = 'ssoUid'); SET @s := IF(@i > 0, 'ALTER TABLE \`User\` RENAME INDEX \`ssoUid\` TO \`User_ssoUid_key\`', 'DO 0'); PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;`. **Testé par l'architecte** avec `prisma db execute --file` sur MySQL 8.0 : état « production » (index déjà renommé) : succès sans effet ; état « dérive » (index `ssoUid`, DEFAULT présent) : succès, unicité conservée (`NON_UNIQUE = 0`), `prisma migrate diff --exit-code` renvoie « No difference detected » (code 0). **Ne pas modifier** `20261107140000_enterprise_sso_scim_mfa` (déjà appliquée en production, somme de contrôle). **Test attendu** : étape de CI dans le job `migrations`, après `migrate deploy` : rejouer `prisma db execute --file prisma/migrations/20261116000000_a9_migration_drift/migration.sql` (deuxième passage = état « production »), puis `migrate diff --exit-code` toujours à 0. **Avant le déploiement** : relever en lecture seule la même information sur la production (déjà faite le 2026-11-11, état conforme à la table ci-contre). |
| **r47-m2** | Mineur | Le 429 du limiteur global renvoie le message anglais `ThrottlerException: Too Many Requests` (observé en production), affiché tel quel par le frontend. `app-throttler.guard.ts` : `AppThrottlerGuard` hérite de `ThrottlerGuard` sans surcharger `throwThrottlingException`. | Surcharger `throwThrottlingException` (garde global et `ScimKeyThrottlerGuard` qui lève `new ThrottlerException()` aux lignes 45 et 51) pour lever `new ThrottlerException('Trop de requêtes. Réessayez dans quelques instants.')` ; conserver l'en-tête `Retry-After`. Côté frontend, afficher un message français dédié pour tout statut 429 plutôt que le texte du serveur. **Tests** : requête au-delà de la limite renvoie 429 avec ce message ; vitest sur l'affichage du 429. |
| **r47-a1** | Amélioration | `pnpm/action-setup@f40ffcd9…  # v4` : ce SHA est celui de l'**objet de tag annoté** mobile `v4` (commit pointé : `b906affc…`), pas d'un commit ; l'épinglage est immuable mais le commentaire « v4 » est trompeur et les outils (Dependabot, zizmor) l'acceptent mal. `actions/checkout` (v4.3.1) et `actions/setup-node` (v4.4.0) sont des SHA de commit corrects. | Épingler le SHA de **commit** d'une version précise (`gh api repos/pnpm/action-setup/git/ref/tags/v4.4.0`, puis déréférencer si le tag est annoté) et commenter `# v4.4.0`. Non bloquant. |
| **r47-a2** | Amélioration | `concurrency.cancel-in-progress: true` s'applique aussi aux poussées sur `main` et `security/**` : une poussée rapide annule la CI de la précédente, qui peut être la dernière vérification d'un état déployé. | `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. Non bloquant. |

### Vérifications de l'architecte

| Point | Résultat |
| --- | --- |
| Périmètre du diff | 10 fichiers modifiés et 4 chemins non suivis, exactement ceux annoncés. `pnpm-lock.yaml` inchangé. |
| Production, lecture seule (SELECT, `information_schema`) | MySQL 8.0.46 ; 16 migrations appliquées, toutes terminées ; `User_ssoUid_key` (unique) présent, `ssoUid` absent ; `SSOConfiguration.updatedAt` sans DEFAULT ; 9 utilisateurs, 0 configuration SSO. Aucune écriture, aucun secret affiché (accès par l'utilisateur applicatif). |
| Migration sur base neuve | `migrate deploy` (17 migrations) OK ; index `User_ssoUid_key` ; `updatedAt` sans DEFAULT (la clause `ON UPDATE` subsiste, sans effet pour Prisma) ; identique à la production. |
| Migration sur l'état « production » | **Échec P3018 puis P3009** (r47-m1). Version gardée de l'architecte : succès sur les deux états. |
| e2e sur MySQL 8.0 et Redis 7 (conteneurs jetables, supprimés) | `migrate deploy` puis `jest --config jest-e2e.json --runInBand` : 5/5. |
| Critère « un PR qui réintroduit S3 fait échouer la CI » | Contre-mutation (ticket MFA signé avec `JWT_SECRET` et sans audience, `verifyAccessToken` sans contrôle de `typ`, `mfaPending` ni `sid`, `SessionService.verifyAccess` sans contrôle de session) : **3 échecs sur 5** (Bearer, cookie, jeton sans `typ`), jest en code non nul : la CI échouerait. Fichiers `token.service.ts` et `session.service.ts` restaurés, comparés à `git show HEAD:` avec `cmp` : identiques ; `git status` sans résidu sous `src/`. |
| Incident de procédure | Une copie de sauvegarde par `cp` s'est bloquée sur une invite d'écrasement (alias interactif) puis le script a repris : la mutation a été appliquée, mesurée (3 échecs) puis la restauration a été vérifiée contre `HEAD` (pas contre la sauvegarde périmée). Le lockfile a été reformaté par une commande de lecture de ma part (`--lockfile-only`), puis remis par Prettier : `git diff` vide. |
| pnpm 10.34.9 | `packageManager` et 3 Dockerfiles alignés ; `package.json#pnpm` supprimé ; `pnpm install --frozen-lockfile --lockfile-only` OK ; lockfile régénéré puis formaté par Prettier : **identique à HEAD** ; `pnpm why mariadb -r` : 3.5.4 unique ; `pnpm audit --prod --audit-level=high` : code 0 (2 faibles, 13 modérés, documentés). |
| Scripts d'installation ignorés | `argon2` : `install` = `node-gyp-build`, qui ne fait que résoudre les binaires précompilés (`prebuilds/linux-x64` etc.) : hachage et vérification OK sous Node 20, y compris dans l'image Alpine et en e2e (login réel). `protobufjs`, `@firebase/util` : scripts de confort. `allowBuilds` fonctionne avec 10.34.9 (`prisma generate` et `nest build` réussissent dans l'image). Sans danger. |
| Image backend | Construite avec `backend/Dockerfile` : Node 20.20.2, pnpm 10.34.9, `dist/main.js`, `argon2` OK, Prisma chargé ; image supprimée. (L'image `frontend/Dockerfile.prod` a été construite et servie par le fixeur ; le build frontend de l'architecte est OK.) |
| Actions GitHub | 3 actions, 14 usages, toutes en SHA de 40 caractères (voir r47-a1 pour une nuance). Image gitleaks épinglée par empreinte `sha256`. |
| Permissions et forks | `permissions: contents: read` au niveau du workflow, aucune surcharge par job. Déclencheur `pull_request` (jamais `pull_request_target`) : les PR de forks n'ont ni secret ni jeton en écriture. Aucun `secrets.*` référencé. Les identifiants MySQL du workflow sont des valeurs jetables de CI. Les seules interpolations `${{ }}` dans un `run` sont les SHA de base et de tête de la PR (non contrôlables). Aucune exécution de code de PR avec privilège. |
| jest backend (`env -u DATABASE_URL`) | 106 suites, **2960/2960**. |
| `nest build`, `tsc -p tests`, `tsc -p tsconfig.json` (O21) | OK, 0 erreur. |
| vitest | 32 fichiers, 285/285. |
| `pnpm build` frontend et grep de `dist` | OK ; 0 occurrence de `mock/login`, `Simuler une session`, `fonts.googleapis`. |
| ESLint | 0 erreur, 51 avertissements préexistants. |
| Prettier | propre sur `.github`, `backend/jest-e2e.json`, `backend/tests`, `backend/tsconfig.json`, `package.json`, `pnpm-workspace.yaml`, `docs/security/ci.md`, `audit-exceptions.md`. |
| actionlint (`rhysd/actionlint:latest`) | 0 erreur. |
| Processus et conteneurs | Conteneurs `r47-*` et image supprimés ; aucune écriture en production ; `.env.production` non touché. |

### Verdicts

| Point | Verdict |
| --- | --- |
| Déclencheurs (toutes les PR, `main`, `security/**`), `timeout-minutes`, `--frozen-lockfile`, Node 20 | **VALIDÉ** |
| Jobs `audit`, `e2e`, `frontend-headers`, `secrets-scan`, `build-and-test` | **VALIDÉ** |
| Job `migrations` (`migrate deploy` puis `migrate diff --from-config-datasource --exit-code`) | **VALIDÉ** pour ce qu'il mesure (écart de 1 : la base de production n'est pas une base neuve, voir r47-m1 et son test d'idempotence) |
| Infrastructure e2e (`jest-e2e.json`, `e2e-app.ts` avec garde-fou `_test`/`_e2e`) et `s3-mfa-ticket.e2e-spec.ts` (5 tests) | **VALIDÉ** (critère S3 → CI en échec : démontré) |
| pnpm 10.34.9, suppression de `package.json#pnpm`, test `dependency-overrides.spec.ts` | **VALIDÉ** (critère r3 d'A9 rempli) |
| O21 (`tsconfig.json` sans specs) | **VALIDÉ** |
| `docs/security/ci.md` | **VALIDÉ** |
| Migration `20261116000000_a9_migration_drift` | **À REPRENDRE** (r47-m1) |
| Écart « `--from-config-datasource` au lieu de `--from-migrations` » | **ACCEPTÉ** (équivalent, sans base fantôme) |

### Réponses aux 5 questions du fixeur
1. **Migration de dérive** : le principe (migration plutôt qu'aligner le schéma sur la base) est le bon : le schéma est la référence, le `@updatedAt` doit rester, et les bases neuves (CI, nouveaux environnements) en ont besoin. Mais « telle quelle » est **refusée** : la production n'a pas la dérive, et le renommage non gardé fait échouer le déploiement (r47-m1). Version gardée par `information_schema` + test d'idempotence en CI. Sûreté MySQL 8 : `RENAME INDEX` est une opération de métadonnées en place (pas de reconstruction, verrou de métadonnées bref sur 9 lignes), l'unicité n'est jamais suspendue ; `DROP DEFAULT` sans effet sur les données.
2. **« Ignored build scripts »** : laisser le refus par défaut. Le risque (binaire `argon2` absent après une montée) est couvert par l'e2e (login réel) et par l'image. Ne rien ajouter dans `pnpm-workspace.yaml`.
3. **NestJS 11 en lot A9-b** : oui, lot séparé, **après P7** (la suite e2e de sécurité sert de filet pour Express 5, le routage et le throttler) ; avec `jose` 4 vers 6 dans le même lot ou voisin. Pas bloquant pour A9.
4. **O22 (clients Redis de l'adaptateur Socket.IO)** : oui, correctif d'arrêt propre dans un lot voisin (`OnModuleDestroy`), à livrer avant ou avec P7, puis retirer `forceExit: true` de `jest-e2e.json` et corriger au passage l'avertissement « worker process has failed to exit gracefully ». Amélioration, non bloquant.
5. **Filtrage du job `frontend-headers`** : ne pas filtrer. Un filtre par chemin au niveau du workflow ferait « sauter » aussi les autres jobs, et un filtre par job exigerait une action tierce supplémentaire (à épingler) ; les vérifications requises de GitHub traitent mal un job sauté. 3 à 8 minutes en parallèle des autres jobs sont acceptables. Si le coût devient gênant : cache de couches Docker, pas de filtre.

### Feu vert de commit : **NON, pas encore** (conditionné à la reprise de r47-m1)
Aucun commit tant que la migration n'est pas gardée et testée : le job `migrations` et `e2e` passent sur base neuve, mais la migration casserait le déploiement. Une fois r47-m1 repris et revu, découpage (chemins explicites, jamais `git add -A`, sans `.claude/` ni `.env`) :
1. **Build** : `package.json`, `pnpm-workspace.yaml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/Dockerfile.prod`, `backend/tests/unit/dependency-overrides.spec.ts`, `docs/security/audit-exceptions.md`, `backend/tsconfig.json`. Message : `build: pnpm 10.34.9 épinglé partout, surcharges uniquement dans pnpm-workspace.yaml et tsconfig backend sans les specs (A9, O21)`.
2. **Migration** : `backend/prisma/migrations/20261116000000_a9_migration_drift/migration.sql`. Message : `fix(db): migration de résorption de la dérive entre l'historique et le schéma, tolérante à une base déjà conforme (A9)`.
3. **CI et e2e** : `.github/workflows/ci.yml`, `backend/jest-e2e.json`, `backend/tests/e2e/`, `docs/security/ci.md`. Message : `ci: déclencheurs sur toutes les PR, jobs audit, e2e, migrations et en-têtes, premier test e2e de sécurité (S3) (A9)`.
4. **Documentation d'audit** : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`. Message : `docs(security): revue r47 du lot A9 (CI, pnpm 10, migration de dérive)`.
Ordre : 1, 2, puis 3 (la CI du commit 3 doit être verte), puis 4. Aucune mention d'outil d'assistance ni `Co-Authored-By`.

### Conditions de déploiement (après VALIDÉ de la reprise)
1. **Base** : la seule migration en attente est `20261116000000_a9_migration_drift` (16 appliquées en production). Avec la version gardée, elle ne modifie rien en production (aucun défaut à retirer, index déjà conforme) et s'enregistre dans `_prisma_migrations`. **Sauvegarde préalable** : `mysqldump` complet selon le runbook S28 (précaution habituelle, aucune donnée touchée). Aucun temps d'arrêt attendu.
2. **Avant** : relire en lecture seule l'état de `User_ssoUid_key` et de `SSOConfiguration.updatedAt` (déjà conforme le 2026-11-11). Recommandé : comparer l'ensemble du schéma de production au schéma Prisma (`mysqldump --no-data` vers une base jetable, puis `prisma migrate diff --from-url … --to-schema … --exit-code`) pour détecter d'autres écarts entre l'historique et la production, que la CI sur base neuve ne voit pas.
3. **Images** : reconstruire backend et frontend (`docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`) pour embarquer pnpm 10.34.9 ; mêmes versions résolues, aucun changement d'API ni de format de jeton. Vérifier au démarrage : `node dist/main` OK, connexion (hachage `argon2`) OK.
4. **Si la migration non gardée avait été appliquée** : `prisma migrate resolve --rolled-back 20261116000000_a9_migration_drift` puis `migrate deploy` avec la version corrigée (changement de la somme de contrôle : la migration n'ayant pas été enregistrée comme appliquée, c'est sans conséquence).
5. **GitHub** (hors dépôt) : marquer `audit`, `e2e`, `migrations`, `frontend-headers`, `secrets-scan`, `build-and-test` comme vérifications requises de la branche `main`, sinon la CI n'empêche rien. À confirmer par l'utilisateur ; je n'ai pas vérifié ce réglage.
6. **Limites de cette revue** : le comportement réel des workflows sur GitHub (durée, caches, résolution du SHA de `pnpm/action-setup`) n'a pas été observé, seulement `actionlint` et l'équivalent local de chaque job.

### Ordre des constats ouverts (fin de r47)
1. **r47-m1** (Majeur, bloquant) : reprise de la migration de dérive ; fixeur.
2. **r47-m2** (Mineur) : message français du 429 global et affichage frontend.
3. Améliorations : r47-a1 (SHA de commit de `pnpm/action-setup`), r47-a2 (annulation de la CI sur `main`), O22 (arrêt propre des clients Redis, puis retrait de `forceExit`), Q-2 (borne `< 500` de la matrice, avec P7).
4. **Suite de la Phase 6** : **P7** (suite `backend/tests/e2e/security/` regroupant les tests d'abus, au-dessus de l'infrastructure d'A9), puis **A9-b** (NestJS 11, après P7), puis **A8** (audit transactionnel unifié), puis **P2** (bandeaux d'obsolescence, définition de terminé).
5. Reliquats antérieurs : r44-a3 (bornes des 41 champs, à confirmer par l'utilisateur), r42-a1 (décision utilisateur), parcours manuel avant `CSP_MODE=enforce`, S30 (actions d'exploitation), recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
6. Actions d'exploitation : sauvegarde et vérification en lecture seule avant la migration ; vérifications GitHub requises ; `TRUST_PROXY_HOPS` et Nginx déjà en place en production (vérifiés le 2026-11-11).

## Revue r48 : reprise r47 (migration gardée, 429 en français, épinglages CI) : VALIDÉ, une réserve Mineure sur l'affichage frontend du 429

**Statut** : r47-m1 **VALIDÉ** (rejoué par l'architecte sur deux MySQL 8.0 jetables). r47-a1 et r47-a2 **VALIDÉS**. r47-m2 **VALIDÉ côté backend** ; côté frontend **VALIDÉ avec réserve** : nouveau constat **r48-m1** (Mineur, non bloquant pour la migration ni pour le backend). Aucune faille de sécurité nouvelle.

### Nouveaux constats

| ID | Sévérité | Constat | Remédiation et critère d'acceptation |
| --- | --- | --- | --- |
| **r48-m1** | **Mineur** (UX, régression d'information ; pas de risque de sécurité) | `frontend/src/http-errors.ts` (`apiErrorMessage`, `readApiError`) et `AppContext.tsx` (`reportApiError`) remplacent **tout** 429 par « Patientez quelques instants ». Or le backend a trois 429 qui portent une information utile et déjà en français : `account-lockout.ts:73` « compte temporairement verrouillé, réessayez plus tard », `account-lockout.ts:80` « réessayez dans une minute », et le limiteur global (`THROTTLE_MESSAGE`, r47-m2). Avant ce lot, l'utilisateur verrouillé voyait « compte temporairement verrouillé » ; après, il croit à un simple ralentissement et réessaie, ce qui entretient le verrou. | Pour un 429 : afficher le `message` du serveur s'il est une chaîne non vide (JSON Nest) ; n'utiliser `TOO_MANY_REQUESTS_MESSAGE` qu'en repli (corps absent, non JSON, par exemple la page HTML de Nginx). Même règle dans `reportApiError` (lire le corps avant de trancher). Tests vitest : (a) 429 JSON avec message de verrouillage : message conservé ; (b) 429 HTML ou corps vide : message générique ; (c) tableau de messages joint ; contre-mutation (retour au « toujours générique ») : au moins un échec. |
| **r48-a1** | Amélioration | Les `fetch` non repris (`Login.tsx`, `sso-oauth.ts`, `IntegrationsPanel.tsx`, `CapacityView.tsx`, `AgileView.tsx`, `FinancesView.tsx`, `NotificationInbox.tsx`, `TaskCommentsPanel.tsx`, etc.) affichent le message du serveur. Avec le backend r47-m2 déployé, il est en français : seul un 429 de Nginx (corps HTML) resterait mal rendu. | Lot dédié ultérieur (un client HTTP commun plutôt que `readApiError` appel par appel). Pas dans ce lot. |
| **r48-a2** | Amélioration (environnement du poste, hors dépôt) | `pnpm` global du poste inutilisable dans le dépôt (voir « Environnement »). | Correction côté poste proposée ci-dessous ; aucune modification du dépôt requise. |

### Vérifications de l'architecte (tout rejoué, rien repris de la description)

| Point | Résultat |
| --- | --- |
| r47-m1, état « production » (MySQL 8.0 jetable ; 16 migrations appliquées via une copie du dossier sans A9, puis `User_ssoUid_key` présent, `ssoUid` absent, `updatedAt` sans DEFAULT) | `migrate deploy` réussit (17 migrations), index `User_ssoUid_key` unique, `migrate diff --exit-code` = 0, rejeu du SQL deux fois par `db execute` : succès, diff = 0, `migrate deploy` suivant : « No pending migrations ». |
| r47-m1, état « dérive » (index `ssoUid`, DEFAULT `CURRENT_TIMESTAMP(3)`, vérifié avant) | `migrate deploy` réussit ; index renommé `User_ssoUid_key` (`non_unique = 0`), DEFAULT supprimé ; deux lignes avec le même `ssoUid` : `ERROR 1062 Duplicate entry 'S' for key 'User.User_ssoUid_key'` ; rejeu x2 OK ; diff = 0. |
| Contre-mutation r47-m1 | `ALTER TABLE User RENAME INDEX ssoUid TO User_ssoUid_key` non gardé sur l'état « production » : `ERROR 1176 Key 'ssoUid' doesn't exist in table 'User'` (donc la garde est nécessaire). Le rejeu via `prisma db execute` conserve bien les variables de session (`SET @a9_*`, `PREPARE`, `EXECUTE`) : le job CI `migrations` est réaliste. |
| `20261107140000_enterprise_sso_scim_mfa` | Intacte (`git diff HEAD` vide sur le dossier). Seul le nouveau dossier `20261116000000_a9_migration_drift` est non suivi. |
| r47-m2 backend | `getErrorMessage()` surchargé dans `AppThrottlerGuard`, `ThrottlerException(THROTTLE_MESSAGE)` dans `ScimKeyThrottlerGuard` (2 endroits) ; `Retry-After` conservé ; format d'erreur SCIM conservé. **Contre-mutation** (retrait de la surcharge et des messages) : 2 échecs sur 8 (`Received: "ThrottlerException: Too Many Requests"`) ; restauré par `\cp`, `cmp` identique, 8/8. |
| r47-a1 | `git ls-remote pnpm/action-setup` : `v4` = `f40ffcd9…` (tag annoté) → `v4^{}` = `b906affc…` = `v4.3.0^{}`. Les 4 usages portent ce commit. `v4.4.0^{}` = `fc06bc12…` existe mais n'est pas la cible de `v4`. |
| r47-a2 | `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` ; groupe par workflow et ref. |
| jest backend (`env -u DATABASE_URL`) | 106 suites, **2961/2961**. |
| `nest build`, `tsc -p tests`, `tsc -p tsconfig.json`, `tsc --noEmit` frontend | 0 erreur. |
| vitest | 33 fichiers, **290/290**. |
| `pnpm build` frontend et grep de `dist` | OK ; 0 occurrence de `mock/login`, `Simuler une session`, `fonts.googleapis`. |
| ESLint | 0 erreur, 51 avertissements préexistants. |
| Prettier (tous les fichiers modifiés et non suivis `.ts/.tsx/.json/.yml/.yaml`) | propre. |
| actionlint (`rhysd/actionlint:latest`, fichier passé sur l'entrée standard) | 0 erreur. |
| `pnpm audit --prod --audit-level=high` | code 0. Lockfile inchangé (`git diff HEAD` vide). |
| e2e (MySQL 8.0 et Redis 7 jetables, base `planner_e2e`) | **5/5** ; le garde-fou refuse bien une base sans suffixe `_test`/`_e2e` (essai initial sur `e2e`, refusé). |
| Environnement | Conteneurs `r48-*` supprimés (vérifié) ; aucun processus résiduel ; aucune écriture en production ni sur la VM ; fichiers temporaires de config Prisma supprimés. Les conteneurs préexistants du poste (`planner_*`, `costudia-*`) n'ont pas été touchés. |

### Environnement : `pnpm` global cassé (« This: not found »)
- **Cause établie** : ce n'est pas pnpm 10 en soi, c'est l'**interaction du pnpm 11.5.2 global** (`~/.local/share/pnpm`, shim lié à `global/v11`) avec le champ `packageManager` du dépôt. Pnpm 11 télécharge la version demandée, `@pnpm/exe` 10.34.9, dans `~/.local/share/pnpm/store/v11/links/@pnpm/exe/10.34.9/…`. Le binaire `pnpm` de ce paquet est un **fichier d'attente de 34 octets** (« This file intentionally left blank ») que le script `preinstall: node setup.js` doit remplacer par le vrai binaire. Ce script n'a pas été exécuté (marqueur `.pnpm-needs-build` présent : pnpm 11 bloque les scripts de build par défaut). Le shell exécute donc le fichier texte comme un script `sh` : « This: not found ». Avec 9.15.4, la version était installée sous une autre forme (`.tools/pnpm/9.15.4`, qui fonctionne), d'où l'apparition du problème avec le passage à 10.
- **Preuve que 10.34.9 fonctionne** : avec le `PATH` de nvm en premier (shim `corepack`), `pnpm -v` donne 10.34.9 et toutes les mesures de cette revue (jest, build, e2e, audit, prettier) ont tourné sans problème. Le job CI n'est pas concerné (`pnpm/action-setup` installe pnpm lui-même ; les Dockerfiles font `npm install -g pnpm@10.34.9`, image construite en r47).
- **Gêne pour l'utilisateur** : toute commande `pnpm` lancée dans le dépôt depuis un shell au `PATH` par défaut (celui où `~/.local/share/pnpm` précède nvm) échoue, y compris en dehors de ce dépôt tant qu'un `packageManager` 10.x est lu ; hors dépôt, `pnpm -v` répond 11.3.0/11.5.2.
- **Corrections proposées (non appliquées, je n'ai pas touché à l'installation globale)** :
  1. **Contournement immédiat, sans rien modifier** : lancer `corepack pnpm …` ou placer le répertoire de nvm avant `~/.local/share/pnpm` dans le `PATH` (le shim `pnpm` de corepack, 0.34.6, installe et sert 10.34.9).
  2. **Réparation durable du pnpm global** (à faire par l'utilisateur) : autoriser le script de build de `@pnpm/exe` dans la configuration globale de pnpm 11 (`allowBuilds: '@pnpm/exe': true`, ou `pnpm approve-builds -g`), supprimer l'installation incomplète de `@pnpm/exe` 10.34.9 sous `~/.local/share/pnpm`, puis relancer une commande `pnpm` dans le dépôt pour qu'elle soit retéléchargée. Hypothèse non testée de mon côté (je n'ai pas le droit de modifier l'installation globale) ; si elle échoue, utiliser le contournement 1.
  3. **Non recommandé** : désactiver `manage-package-manager-versions` pour que pnpm 11 travaille directement sur le dépôt : le lockfile, `allowBuilds` et les surcharges sont validés avec 10.34.9, pas avec 11.
  - Reliquat inoffensif : `~/.local/share/pnpm/.tools/pnpm/9.15.4_tmp_168978_0` (installation interrompue de 9.15.4).

### Réponses aux 3 questions du fixeur
1. **Message du serveur pour le 429 de verrouillage** : **oui, il prime**. Les messages serveur des 429 sont déjà en français et informatifs (« compte temporairement verrouillé », « réessayez dans une minute ») ; le générique ne doit servir que de repli quand le corps n'est pas un JSON Nest avec un `message` (page HTML de Nginx, corps vide). C'est r48-m1. L'objectif de r47-m2 (ne plus afficher `ThrottlerException: Too Many Requests`) est déjà atteint par le backend.
2. **v4.3.0 ou v4.4.0** : **rester sur v4.3.0** (`b906affc…`), qui est ce que `v4` désigne aujourd'hui et ce qui a servi aux mesures. Passer à v4.4.0 serait un changement de comportement sans bénéfice pour cette revue ; à traiter par la maintenance habituelle (Dependabot ou revue trimestrielle des SHA), pas dans ce lot.
3. **Autres `fetch` du frontend** : **plus tard**, lot dédié (r48-a1), idéalement avec un client HTTP commun. Raison : avec le backend r47-m2, le message serveur est déjà en français ; ne reste que le 429 de Nginx en HTML. Étendre `readApiError` appel par appel multiplie les modifications pour un gain faible.

### Verdicts

| Point | Verdict |
| --- | --- |
| r47-m1 : migration gardée (`information_schema`, `PREPARE`/`EXECUTE`), étapes CI de rejeu et second diff | **VALIDÉ** |
| r47-m2 backend (`AppThrottlerGuard`, `ScimKeyThrottlerGuard`, tests) | **VALIDÉ** |
| r47-m2 frontend (`http-errors.ts` et branchements) | **VALIDÉ avec réserve** : r48-m1 à reprendre (petit correctif), non bloquant pour la migration ni le backend |
| r47-a1 (commit `b906affc…`, v4.3.0) | **VALIDÉ** |
| r47-a2 (`cancel-in-progress` sur PR seulement) | **VALIDÉ** |

### Feu vert de commit : **OUI** pour l'ensemble, sauf le commit frontend (5) qui attend r48-m1
Chemins explicites, jamais `git add -A` (ni `.claude/`, ni `.env*`). Messages en français, sans mention d'outil d'assistance ni `Co-Authored-By`. Ordre :
1. **Build** : `package.json`, `pnpm-workspace.yaml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/Dockerfile.prod`, `backend/tsconfig.json`, `backend/tests/unit/dependency-overrides.spec.ts`, `docs/security/audit-exceptions.md`. Message : `build: pnpm 10.34.9 épinglé partout, surcharges uniquement dans pnpm-workspace.yaml, tsconfig backend sans les specs (A9, O21)`.
2. **Migration** : `backend/prisma/migrations/20261116000000_a9_migration_drift/migration.sql`. Message : `fix(db): migration de résorption de la dérive entre l'historique et le schéma, gardée et idempotente (A9, r47-m1)`.
3. **CI et e2e** : `.github/workflows/ci.yml`, `backend/jest-e2e.json`, `backend/tests/e2e/`, `docs/security/ci.md`. Message : `ci: déclencheurs sur toutes les PR, jobs audit, e2e, migrations (avec rejeu idempotent) et en-têtes, premier test e2e de sécurité, pnpm/action-setup épinglé sur un commit (A9, r47-a1, r47-a2)`.
4. **429 backend** : `backend/src/common/app-throttler.guard.ts`, `backend/tests/http/scim-throttler.spec.ts`. Message : `fix(security): message du 429 du limiteur global et de SCIM en français, Retry-After conservé (r47-m2)`.
5. **429 frontend** (après r48-m1) : `frontend/src/http-errors.ts`, `frontend/src/http-errors.spec.ts`, `frontend/src/account-api.ts`, `frontend/src/security-api.ts`, `frontend/src/github-oauth.ts`, `frontend/src/github-repos.ts`, `frontend/src/invitation-store.ts`, `frontend/src/context/AppContext.tsx`, `frontend/src/components/AdminConsole.tsx`. Message : `fix(frontend): messages d'erreur HTTP communs, message dédié en repli pour un 429 sans corps exploitable (r47-m2, r48-m1)`.
6. **Documentation d'audit** : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`. Message : `docs(security): revues r47 et r48 du lot A9 et reprise de la migration de dérive`.
La CI du commit 3 doit être verte avant le 4 ; le commit 6 en dernier.

### Conditions de déploiement
1. **Périmètre** : backend (commit 4), migration (2) et images reconstruites (1) peuvent partir sans attendre r48-m1 : le frontend actuellement en production affiche déjà le message du serveur, donc le 429 français du backend s'affiche correctement. Le frontend (5) part avec ou après r48-m1.
2. **Sauvegarde** `mysqldump` complet avant (runbook S28) ; relecture en lecture seule de `User_ssoUid_key` et de `SSOConfiguration.updatedAt` (conformes le 2026-11-11). La migration gardée n'effectue alors aucune modification ; elle s'enregistre dans `_prisma_migrations` (17 migrations). Pas d'arrêt de service.
3. **Recommandé** : comparer l'ensemble du schéma de production au schéma Prisma (`mysqldump --no-data` vers une base jetable, puis `prisma migrate diff --from-url … --to-schema … --exit-code`) : la CI sur base neuve ne voit pas d'autres écarts éventuels entre production et historique.
4. **Images** : `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`. Vérifier le démarrage (`node dist/main`), une connexion (hachage `argon2`), puis un 429 réel : le corps doit être `Trop de requêtes. Réessayez dans quelques instants.` avec `Retry-After`.
5. **Rollback** : retour aux images précédentes ; la migration est sans effet sur une base conforme et n'a pas de retour arrière à jouer.
6. **GitHub** (hors dépôt, à confirmer par l'utilisateur) : vérifications requises sur `main` (`audit`, `e2e`, `migrations`, `frontend-headers`, `secrets-scan`, `build-and-test`).
7. **Limites** : le comportement réel des workflows sur GitHub n'a pas été observé (actionlint et équivalents locaux seulement) ; l'hypothèse de réparation du pnpm global (point 2 de l'environnement) n'est pas testée.

### Ordre des constats ouverts (fin de r48)
1. **r48-m1** (Mineur) : affichage du message serveur pour un 429 côté frontend ; fixeur, avant le commit 5.
2. Améliorations : r48-a1 (autres `fetch`, client HTTP commun, lot ultérieur), r48-a2 (pnpm global du poste, action de l'utilisateur), O22 (arrêt propre des clients Redis puis retrait de `forceExit`), Q-2 (borne `< 500` de la matrice, avec P7).
3. **Suite de la Phase 6** : **P7** (suite `backend/tests/e2e/security/`), puis **A9-b** (NestJS 11, après P7, avec `jose` 4 vers 6), puis **A8**, puis **P2**.
4. Reliquats antérieurs : r44-a3 (à confirmer par l'utilisateur), r42-a1 (décision utilisateur), parcours manuel avant `CSP_MODE=enforce`, S30 (actions d'exploitation), recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
5. Actions d'exploitation : sauvegarde avant migration ; comparaison complète du schéma de production ; vérifications GitHub requises ; `TRUST_PROXY_HOPS` et Nginx déjà en place.
6. Clos par cette revue : r47-m1, r47-m2 (backend), r47-a1, r47-a2.

## Revue r49 : reprise r48-m1 (message du 429 côté frontend) : À REPRENDRE, un défaut Mineur résiduel (r49-m1)

**Statut** : r48-m1 **À REPRENDRE** (un seul chemin ne respecte pas le critère : `invitationErrorFrom`). Partie frontend de r47-m2 : **VALIDÉE** pour tous les autres branchements. Aucune faille de sécurité nouvelle.

### Nouveau constat

| ID | Sévérité | Constat | Remédiation et critère d'acceptation |
| --- | --- | --- | --- |
| **r49-m1** | **Mineur** (UX ; pas de risque de sécurité : React échappe le texte) | `frontend/src/invitation-store.ts`, `invitationErrorFrom` : pour un corps non JSON (page HTML de Nginx), `JSON.parse` lève, `message` reste égal au texte brut, et `apiErrorMessage(429, texteBrut, …)` le renvoie tel quel. **Reproduit** : `invitationErrorFrom(new Response('<html><h1>429 Too Many Requests</h1></html>', {status: 429}), 'repli').message` vaut `<html><h1>429 Too Many Requests</h1></html>` au lieu du message générique. Le test existant ne couvre que le corps vide. | Pour un 429, ne jamais retenir le texte brut : dans le `catch` (ou après), forcer `message = ''` si `res.status === 429` (les autres statuts gardent le « texte brut » voulu). Variante équivalente : extraire via `serverMessageOf` pour le JSON. Tests : 429 HTML donne `TOO_MANY_REQUESTS_MESSAGE` ; 429 JSON de verrouillage conservé ; 403 en texte brut inchangé (non-régression). Contre-mutation : retirer la garde doit faire échouer le test HTML. |

### Vérifications de l'architecte (rejouées)

| Point | Résultat |
| --- | --- |
| vitest | 34 fichiers, **295/295** |
| `tsc --noEmit` frontend | 0 erreur |
| `pnpm build` et grep de `dist` (`mock/login`, `Simuler une session`, `fonts.googleapis`) | OK, 0 occurrence |
| ESLint (10 fichiers touchés) | 0 erreur |
| Prettier (10 fichiers `.ts/.tsx`) | propre |
| Contre-mutation (`if (message && status !== 429)` dans `apiErrorMessage`, soit « 429 toujours générique ») | **6 échecs sur 10** dans `http-errors.spec.ts` et `AppContext.rate-limit.spec.tsx` ; restauré par `\cp`, `cmp` identique |
| Test jetable sur `invitationErrorFrom` (429 HTML) | échec, défaut r49-m1 confirmé ; fichier supprimé |
| Revue de code | `serverMessageOf` / `apiErrorMessage` / `readApiError` conformes (message prioritaire, repli pour HTML, vide, absent, blanc, tableau vide). `account-api`, `security-api`, `github-oauth`, `github-repos` passent par `res.json().catch(() => ({}))` : un HTML donne `{}` donc le repli, correct. `reportApiError` : correct pour 429 (HTML, vide, JSON, tableau) ; autres statuts inchangés. Les 5 appels d'`AppContext` et `AdminConsole` passent par `readApiError` : l'ancien `await res.json()` qui levait sur un corps HTML est corrigé au passage (bénéfice). |
| Environnement | `corepack pnpm` avec nvm en tête du PATH ; aucun processus résiduel lié aux mesures ; aucune écriture en production ni sur la VM ; rien commité ni poussé. |

### Réponse à la question du fixeur : séparateur des tableaux
**Ne pas uniformiser.** Le cas (429 avec `message` en tableau) est théorique : le backend renvoie des chaînes pour tous ses 429. Le `', '` de `reportApiError` est le comportement historique des autres statuts et des tests existants ; l'espace d'`apiErrorMessage` est celui des clients de compte, de sécurité, GitHub et d'invitation. Uniformiser toucherait des statuts hors périmètre sans gain. À noter seulement : si un client HTTP commun voit le jour (r48-a1), il retiendra un seul séparateur à ce moment-là.

### Verdicts

| Point | Verdict |
| --- | --- |
| `http-errors.ts` (`serverMessageOf`, `apiErrorMessage`, `readApiError`) | **VALIDÉ** |
| `reportApiError` (`AppContext.tsx`) | **VALIDÉ** |
| `account-api`, `security-api`, `github-oauth`, `github-repos`, `AdminConsole`, appels d'`AppContext` | **VALIDÉ** |
| `invitation-store.ts` (`invitationErrorFrom`) | **À REPRENDRE** (r49-m1) |
| Tests (`http-errors.spec.ts`, `AppContext.rate-limit.spec.tsx`) | **VALIDÉ**, à compléter par le cas 429 HTML d'invitation |
| r48-m1 dans son ensemble | **À REPRENDRE** (petit correctif, une ligne et un test) |

### Feu vert de commit
- Commits **1 à 4** : déjà faits en local (722df54, 21a8b40, f76e709, a65ceb7), non poussés, inchangés.
- **Commit 5 (frontend) : feu vert conditionné à r49-m1** (le fixeur corrige, l'architecte relit en revue courte ; pas de nouveau cycle complet). Liste exacte, chemins explicites, jamais `git add -A` ni `.claude/` ni `.env*` : `frontend/src/http-errors.ts`, `frontend/src/http-errors.spec.ts`, `frontend/src/context/AppContext.rate-limit.spec.tsx`, `frontend/src/account-api.ts`, `frontend/src/security-api.ts`, `frontend/src/github-oauth.ts`, `frontend/src/github-repos.ts`, `frontend/src/invitation-store.ts`, `frontend/src/context/AppContext.tsx`, `frontend/src/components/AdminConsole.tsx`. Message : `fix(frontend): messages d'erreur HTTP communs, message du serveur prioritaire et repli générique pour un 429 sans corps exploitable (r47-m2, r48-m1)`.
- **Commit 6 (docs)** : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, en dernier, après la revue de clôture de r49-m1. Message : `docs(security): revues r47 à r49 du lot A9, migration de dérive et message du 429 frontend`. Aucune mention d'outil d'assistance ni `Co-Authored-By`.

### Conditions de déploiement de l'ensemble 722df54 à commit 6 (production actuelle : 93711a8)
1. **Ordre et prérequis** : CI verte sur le commit 3 avant le 4 ; rien ne part en production avant r49-m1 clos si le frontend est inclus. Backend (4), migration (2) et images (1) peuvent partir sans le frontend : le frontend en production affiche déjà le message du serveur.
2. **Sauvegarde** `mysqldump` complet avant (runbook S28) ; relecture en lecture seule de `User_ssoUid_key` et `SSOConfiguration.updatedAt`. La migration `20261116000000_a9_migration_drift` est gardée : sur une base conforme elle ne modifie rien et s'enregistre (17 migrations). Pas d'arrêt de service.
3. **Recommandé** : comparaison du schéma complet de production avec le schéma Prisma (`mysqldump --no-data` vers une base jetable, puis `prisma migrate diff --exit-code`).
4. **Images à reconstruire** (backend et frontend : pnpm 10.34.9 dans les Dockerfiles, backend modifié, frontend modifié) : `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`. Vérifier : démarrage (`node dist/main`), connexion (argon2), un 429 réel (corps `Trop de requêtes. Réessayez dans quelques instants.` avec `Retry-After`), un verrouillage de compte affiché tel quel dans l'interface, un 429 Nginx (HTML) affiché en message générique.
5. **Rollback** : images précédentes ; la migration n'a pas de retour arrière à jouer.
6. **Hors dépôt, à confirmer par l'utilisateur** : vérifications requises sur `main` (`audit`, `e2e`, `migrations`, `frontend-headers`, `secrets-scan`, `build-and-test`). Comportement réel des workflows sur GitHub non observé.

### Périmètre du lot P7 (suite `backend/tests/e2e/security/`)
Infrastructure existante : `tests/e2e/support/e2e-app.ts` et `s3-mfa-ticket.e2e-spec.ts`, base `*_e2e`, garde-fou de nom de base. Le lot P7 doit couvrir :
1. **O22 en premier (prérequis)** : `OnModuleDestroy` fermant les clients Redis de l'adaptateur Socket.IO ; `app.close()` propre dans `e2e-app.ts` ; retrait de `forceExit: true` de `backend/jest-e2e.json` ; plus d'avertissement « worker process has failed to exit gracefully ». Critère : `jest --config jest-e2e.json --detectOpenHandles` sans handle ouvert, avec 5/5 existants.
2. **Authentification et session** : verrouillage de compte (le 429 renvoie le message de verrouillage, `Retry-After` présent) ; rotation et réutilisation du refresh token (révocation de la famille) ; cookies (`HttpOnly`, `Secure`, `SameSite`) ; 401 sans cookie ; MFA (ticket déjà couvert, ajouter code TOTP rejoué et épuisement des tentatives).
3. **Autorisation (IDOR/BOLA)** : un utilisateur d'un espace A ne lit ni ne modifie projets, tâches, notes, membres ni dépôts de l'espace B ; rôles de la matrice RBAC (`docs/security/matrice-rbac.md`) par route sensible ; impersonation : interdite ou limitée aux routes prévues.
4. **Limiteurs et abus** : 429 du limiteur global et de SCIM (message français, `Retry-After`, format SCIM conservé) ; limites des routes publiques ; `trust proxy` (`X-Forwarded-For` falsifié sans effet au-delà de `TRUST_PROXY_HOPS`).
5. **Webhook GitHub et SCIM** : signature invalide ou absente rejetée, rejeu, charge utile surdimensionnée ; clé SCIM invalide.
6. **Q-2 rattaché à P7** : la borne `< 500` de la matrice (vérifier que toute réponse d'abus est un 4xx, jamais un 5xx) devient un test paramétré qui parcourt les cas d'abus ci-dessus et échoue sur tout statut `>= 500`.
7. **Critères d'acceptation** : chaque test d'abus a sa contre-mutation documentée (retrait du garde-fou : au moins un échec) ; suite exécutée dans le job CI `e2e` ; aucune dépendance à la production ; durée raisonnable (cible < 5 min).
Hors P7 : r48-a1 (client HTTP commun), A9-b, A8, P2.

### Ordre des constats ouverts (fin de r49)
1. **r49-m1** (Mineur) : `invitationErrorFrom` renvoie le HTML brut pour un 429 ; fixeur, avant le commit 5 (r48-m1 reste ouvert jusqu'à là).
2. Améliorations : r48-a1 (autres `fetch`, client HTTP commun), r48-a2 (pnpm global du poste, action de l'utilisateur), O22 (en tête de P7), Q-2 (avec P7).
3. **Suite de la Phase 6** : **P7**, puis **A9-b** (NestJS 11, après P7, avec `jose` 4 vers 6), puis **A8**, puis **P2**.
4. Reliquats antérieurs : r44-a3 (à confirmer par l'utilisateur), r42-a1 (décision utilisateur), parcours manuel avant `CSP_MODE=enforce`, S30 (actions d'exploitation), recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
5. Actions d'exploitation : sauvegarde avant migration ; comparaison complète du schéma de production ; vérifications GitHub requises.
6. Clos par cette revue : partie frontend de r47-m2 (hors r49-m1).

---

## Revue r50 (architecte) : clôture courte de r49-m1

**Verdict r49-m1 : VALIDÉ.** `invitationErrorFrom` vide le message pour un 429 non JSON (HTML Nginx), donc `apiErrorMessage` renvoie le message générique ; un 429 JSON garde le message du serveur ; les autres statuts gardent le texte brut. Le test couvre les trois cas. r48-m1 est clos, et la partie frontend de r47-m2 aussi.

| Point | Résultat |
| --- | --- |
| vitest | 34 fichiers, **296/296** |
| `tsc --noEmit` frontend | 0 erreur |
| Contre-mutation (retrait de `if (res.status === 429) message = ''`) | 1 échec sur 7 dans `http-errors.spec.ts` (le test d'invitation) ; restauré par `\cp`, `cmp` identique |
| Environnement | `corepack pnpm`, nvm en tête du PATH ; aucun processus résiduel ; rien commité ni poussé |

### Feu vert final de commit (les commits 1 à 4 sont faits : 722df54, 21a8b40, f76e709, a65ceb7)
- **Commit 5 (frontend)**, chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*` : `frontend/src/http-errors.ts`, `frontend/src/http-errors.spec.ts`, `frontend/src/context/AppContext.rate-limit.spec.tsx`, `frontend/src/account-api.ts`, `frontend/src/security-api.ts`, `frontend/src/github-oauth.ts`, `frontend/src/github-repos.ts`, `frontend/src/invitation-store.ts`, `frontend/src/context/AppContext.tsx`, `frontend/src/components/AdminConsole.tsx`.
  Message : `fix(frontend): messages d'erreur HTTP communs, message du serveur prioritaire et repli générique pour un 429 sans corps exploitable (r47-m2, r48-m1)`
- **Commit 6 (docs)**, en dernier : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`.
  Message : `docs(security): revues r47 à r49 du lot A9, migration de dérive et message du 429 frontend`
- Aucune mention d'outil d'assistance ni `Co-Authored-By`. Conditions de déploiement : voir « Revue r49 ».

### Ordre des constats ouverts (fin de r50)
1. Aucun constat Mineur ou supérieur ouvert dans le lot A9 / r47 à r49.
2. **Suite : P7**, périmètre défini en r49 (O22 en tête, authentification et session, IDOR/BOLA, limiteurs, webhook et SCIM, Q-2, critères d'acceptation avec contre-mutations et job CI `e2e`).
3. Ensuite A9-b (NestJS 11, après P7), A8, P2.
4. Améliorations : r48-a1 (client HTTP commun), r48-a2 (pnpm global du poste, action utilisateur), O22 et Q-2 (dans P7).
5. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
6. Actions d'exploitation : sauvegarde avant migration, comparaison complète du schéma de production, vérifications GitHub requises.

---

## Revue r51 (architecte) : lot Phase 6-2 (P7, suite e2e de sécurité) : VALIDÉ, deux réserves de test et un constat de balayage (Mineurs, non bloquants)

**Verdict global : VALIDÉ, feu vert de commit.** Le code livré est correct et sans faille ; la suite e2e est réelle (337 tests, vraies assertions, aucun `.skip` ni `.only`). Je relève trois constats Mineurs, tous des lacunes de couverture ou de balayage, aucun n'est une faille exploitable : r51-m1, r51-m2, r51-m3. Ils partent dans un petit lot « P7-b » avant A9-b.

| Point | Verdict |
| --- | --- |
| O22 (arrêt propre, `forceExit` retiré) | **VALIDÉ** (voir O23 : en production, les crochets d'arrêt ne sont pas activés) |
| Point 2 : authentification et session (20 tests) | **VALIDÉ**, réserve r51-m1 (valeur du `Retry-After` non verrouillée par un test) |
| Point 3 : IDOR/BOLA, RBAC, impersonation (98 tests) | **VALIDÉ**, réserve r51-m2 (garde principale des finances non isolée) |
| Point 4 : limiteurs, `trust proxy` (7 tests) | **VALIDÉ** |
| Point 5 : webhook GitHub et SCIM (12 tests) | **VALIDÉ** |
| Point 6 : Q-2 (192 cas, exceptions vides) | **VALIDÉ**, réserve r51-m3 (le catalogue ne couvre pas tous les DTO) |
| N1 (`Retry-After` sur les 429 par compte) | **VALIDÉ** (code), test à compléter (r51-m1) |
| N2 (`@MaxLength` sur 5 DTO) | **VALIDÉ**, données de production conformes, balayage à faire (r51-m3) |

### Constats

**N1 (code) : régression du verrou, anciennes valeurs, filtre global.**
- Valeur `'1'` d'un ancien verrou : `Number('1')` vaut 1, non supérieur à `Date.now()`, donc repli sur `LOCKOUT_BASE_SECONDS`. Une valeur illisible (NaN) retombe pareil. Le verrou reste posé (`read() !== null`), seul le délai annoncé est approximatif pour un ancien verrou de palier supérieur (sous-estimé, au pire 24 h annoncées 15 min) ; il expire de lui-même. Déploiement en rolling : une ancienne instance qui lit une valeur horodatée ne teste que `!== null`, donc le verrou tient. Aucune migration.
- TTL Redis inchangé (`seconds`), repli mémoire inchangé (la valeur est une chaîne comme avant). `reset` ne touche pas au verrou, comme avant.
- Filtre : `@Catch(TooManyAttemptsException)` uniquement, enregistré en `APP_FILTER`. Il ne capte ni le 429 du `ThrottlerGuard`, ni celui de SCIM, ni aucune autre exception. Corps identique à celui de Nest (`{ statusCode, message }`), statut identique. Aucun autre `useGlobalFilters` dans le code.
- **r51-m1 (Mineur, test)** : la contre-mutation « délai annoncé constant, égal à `LOCKOUT_BASE_SECONDS` (l'instant de fin ignoré) » n'est détectée ni par `retry-after.filter.spec.ts` ni par `auth-session.e2e-spec.ts` (20/20 et 933/933 restent verts), car au premier palier le délai restant vaut déjà 900 s. Le stockage de l'instant de fin, cœur de N1, n'est donc pas verrouillé. Remédiation : test unitaire avec horloge simulée (`jest.spyOn(Date, 'now')`), soit 20 échecs (palier 2, 1 800 s), soit 5 min écoulées après le premier verrou (reste environ 600 s), avec `Retry-After` décroissant. Critère : la mutation ci-dessus échoue.

**N2 (contrat)** : lecture seule en production (utilisateur applicatif, `SELECT MAX(CHAR_LENGTH/LENGTH)`, aucun secret) : `Project.name` max 26 (5 projets), `Project.description` max 96 (0 au-delà de 16 000), `billingType` max 18, `Task.title` max 61 (15 tâches), `Task.description` max 149 (0 au-delà), `Task.labels` max 6, `Sprint` vide. Aucune donnée existante ne dépasse les bornes : aucune mise à jour future d'un enregistrement existant ne sera refusée. Colonnes réelles : `description` et `labels` en TEXT (65 535 octets), pour lesquels 16 000 caractères tiennent même à 3 octets par caractère (48 000) ; `name`/`title` en VARCHAR(191). La borne de 16 000 est **acceptée** (alignée sur `NoteDto`). `@MaxLength` compte des unités UTF-16 : à 191 unités, jamais plus de 191 caractères MySQL.
- **r51-m3 (Mineur)** : le balayage n'est pas fait. Champs `@IsString` sans `@MaxLength` encore présents : `update-sprint.dto.ts` (`name`, même colonne VARCHAR(191) que la création : un PUT de sprint avec un nom de 300 000 caractères donne très probablement un 500, à confirmer par le catalogue), `create-comment`, `create-milestone`, `create-deliverable`, `create-delivery`, `create-resource-allocation`, `create-resource-leave`, `update-resource-profile`, `update-project-finances`, `create-task-dependency`, `ai-command` (1/3), `execute-ai-actions` (0/17), `admin.dto`, `firebase-login`, `invitation-token`, `sso.dto` (5/10), `scim.dto` (11/12), `github.dto`, ainsi que les champs restants de `create-project`/`create-task`/`update-task` (2/4, 3/5, 3/5). Surface : utilisateur authentifié, corps limité à 1 Mo, aucune donnée exposée. Remédiation : (1) borne sur chaque champ texte selon la colonne (VARCHAR(191) → 191, TEXT → 16 000, autre → valeur justifiée) ; (2) **un test unitaire de garde** qui parcourt les métadonnées `class-validator` de tous les DTO et échoue sur tout `@IsString` sans `@MaxLength` (liste d'exceptions justifiées), plutôt qu'un catalogue à compléter à la main ; (3) étendre Q-2 aux routes concernées (au moins `PUT sprint`, commentaire, jalon, livrable).

**Mutation « finances ouvert au MEMBER » non détectée : confirmée masquée, pas de faille.**
- `getWorkspaceFinancialSummary` (`finances.service.ts`) contrôle OWNER/ADMIN, puis appelle `getProjectFinances` pour chaque projet, qui refait le même `assertWorkspaceRoles` (ligne 28) : seconde barrière réelle. Reproduit : suppression du seul contrôle du résumé, `authz` 98/98 reste vert.
- Elle ne couvre pas un espace **sans projet** : `Promise.all([])` renvoie alors un résumé à zéro sans contrôle. Aucun contenu sensible (zéros), mais la garde principale n'est protégée par aucun test, et un futur refactor du résumé (agrégation SQL directe, sans passer par projet) ouvrirait les finances à tout membre sans qu'un test échoue.
- **r51-m2 (Mineur, test)** : ajouter à `authz.e2e-spec.ts` un cas `finances` sur un **espace sans projet** (MEMBER et profils de projet : 403, OWNER/ADMIN : 200) ; critère : la mutation « garde du résumé retirée » échoue. Note : `getProjectFinances` n'est plus routé directement (seulement via le résumé) ; il lève `new Error('Project not found')` (500) si le projet disparaît entre les deux lectures : course théorique, à remplacer par `NotFoundException` au passage.

**Qualité des tests e2e** : assertions précises (statuts exacts, `[nom, résultat]` pour une sortie lisible, absence de marqueur secret, base relue pour prouver « rien ne change »). Tolérances relevées et acceptées : `[403, 404]` sur les lectures croisées (deux issues légitimes), `< 500` sur la suppression de la note d'autrui (accompagnée de « aucune fuite »). Aucun `.skip`, `.only`, `xit`, `fdescribe`. Isolation : un monde par suite (comptes et espaces créés puis nettoyés, adresse `X-Forwarded-For` neuve par requête), les compteurs Redis sont par adresse ou par compte. Durée : 47 s (48 s avec `--detectOpenHandles`).

**O23 (Amélioration, nouveau)** : `main.ts` n'appelle pas `enableShutdownHooks()`. En production, un SIGTERM (`docker stop`) tue donc Node sans passer par `onModuleDestroy` : le correctif O22 profite aux tests, pas à l'exploitation (aucune régression non plus). Si on active les crochets, borner `quit()` (course contre un délai de 2 s, puis `disconnect()`) : avec `maxRetriesPerRequest: null`, un `quit()` envoyé pendant une panne de Redis peut attendre indéfiniment la reconnexion. À traiter avec A8 ou en exploitation, pas bloquant.

**Observations du fixeur, tranchées**
- **O-a** (GET d'une note d'autrui : 200 sans corps) : hygiène d'API, aucune fuite. À corriger en 404 (Amélioration), après vérification que le frontend ne s'appuie pas sur le corps vide ; test e2e à resserrer à 404 une fois fait. Non bloquant.
- **O-b** (listes de rôles en dur) : **ne pas aligner avant A8** ; l'aligner dans A8 (ou la refonte de la politique), où `permissions.ts` devient l'unique source. D'ici là, le comportement est verrouillé par l'oracle de la matrice e2e (écrit dans le test, indépendant de la table) : c'est la bonne protection, à conserver comme filet de sécurité de cette refonte.
- **O-c** : `TRUST_PROXY_HOPS` de production à confirmer par l'exploitation (action ouverte).
- **O-d** (compte suspendu actif jusqu'à 60 s en cas de suspension directe en base) : **accepté** (cache de session documenté, parcours applicatifs et SCIM révoquent). Ajouter au lot P7-b un test e2e des parcours applicatifs (suspension par l'administration, par SCIM : session refusée immédiatement), plus utile que le cas direct en base. Amélioration.
- **O-e** (403 contre 404 pour un projet d'un autre espace) : négligeable (UUID v4), non corrigé.

### Réponses aux questions du fixeur
1. **Borne de 16 000** : acceptée. **Balayage** : oui, en lot dédié P7-b (r51-m3), avec le test de garde sur les métadonnées plutôt que des cas à la main.
2. **`Retry-After` 60 s** : accepté (borne haute valide au sens de la RFC 9110 ; le TTL exact exigerait de changer `LockoutStore` pour un gain nul). Le délai du verrou, lui, est exact (instant de fin).
3. **O-b avant A8** : non, dans A8.
4. **Durée de l'e2e en CI** : la question est dépassée, le job `e2e` a déjà tourné sur GitHub pour d1a1da7 (6 jobs verts). La suite de ce lot passe de 5 tests à 337 ; mesuré ici 47 s, soit environ 2 à 3 min en CI avec l'installation, très en dessous du plafond de 20 min. Risque nouveau : sans `forceExit`, un handle fuyant ferait attendre le job jusqu'au plafond de 20 min au lieu d'échouer vite ; le test O22 le détecte en amont. Acceptable.

### Mesures de la revue (MySQL 8.0 et Redis 7 temporaires, supprimés ensuite)
| Mesure | Résultat |
| --- | --- |
| e2e `--runInBand --detectOpenHandles` | 7 suites, **337/337**, 47 s, aucun handle ouvert |
| jest backend (`env -u DATABASE_URL`) | 107 suites, **2 964/2 964** |
| `nest build`, `tsc -p tests --noEmit` | 0 erreur |
| ESLint (`src` et `tests`) | 0 erreur, 15 avertissements `no-explicit-any` préexistants |
| Prettier (fichiers modifiés et créés) | propre |
| vitest frontend | 34 fichiers, **296/296** |
| Contre-mutations (restauration par `\cp`, `cmp` identique, `git status` inchangé) | O22 passerelle (conservation des clients retirée) : détectée (2 sockets Redis restées ouvertes) ; O22 `$disconnect()` retiré de Prisma : détectée ; N2 `@MaxLength(16_000)` de la description de projet à 1 000 000 : détectée (1/194) ; N2 titre de tâche 191 à 1 000 000 : détectée (1/194) ; N1 repli de l'ancienne valeur `'1'` à 1 s : détectée (unitaire) ; **N1 délai constant au lieu de l'instant de fin : NON détectée (r51-m1)** ; **finances, garde du résumé retirée : NON détectée (r51-m2)** |
| Production (lecture seule) | 7 `SELECT MAX(CHAR_LENGTH)`, aucun enregistrement au-delà des bornes |
| Environnement | conteneurs `r51-mysql` et `r51-redis` supprimés ; aucun processus résiduel ; rien commité ni poussé |

### Feu vert de commit (chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*`) : 5 commits, dans cet ordre
1. `fix(backend): arrêt propre de l'application, clients Redis de l'adaptateur Socket.IO, Prisma et Redis fermés, forceExit retiré (O22)` : `backend/src/tracking/tracking.gateway.ts`, `backend/src/prisma/prisma.service.ts`, `backend/src/redis/redis.service.ts`, `backend/jest-e2e.json`.
2. `fix(security): Retry-After sur les 429 de verrouillage de compte, de login par minute et de MFA (N1)` : `backend/src/auth/account-lockout.ts`, `backend/src/common/retry-after.filter.ts`, `backend/src/app.module.ts`, `backend/tests/unit/common/retry-after.filter.spec.ts`.
3. `fix(security): longueurs maximales sur les champs texte des DTO de projet, de tâche et de sprint (N2)` : `backend/src/projects/dto/create-project.dto.ts`, `create-sprint.dto.ts`, `create-task.dto.ts`, `update-project.dto.ts`, `update-task.dto.ts` (même dossier).
4. `test(e2e): suite e2e de sécurité, authentification, autorisation, limiteurs, webhook, SCIM, abus sans 5xx et arrêt propre (P7, Q-2)` : `backend/tests/e2e/security/abuse-no-5xx.e2e-spec.ts`, `auth-session.e2e-spec.ts`, `authz.e2e-spec.ts`, `o22-shutdown.e2e-spec.ts`, `rate-limits.e2e-spec.ts`, `webhook-scim.e2e-spec.ts`, `backend/tests/e2e/support/e2e-world.ts`, `backend/tests/e2e/support/e2e-app.ts`.
5. `docs(security): revues r50 et r51, lot P7 (O22, N1, N2, suite e2e de sécurité)` : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, en dernier.
Aucune mention d'outil d'assistance ni `Co-Authored-By`. Pousser après les 5 commits et attendre les 6 jobs verts (le job `e2e` exécute pour la première fois la suite complète sur GitHub).

### Conditions de déploiement (production actuelle : 93711a8)
1. Le lot s'ajoute à l'ensemble déjà en attente (722df54 à d1a1da7) : **toutes les conditions de la revue r49 restent valables** (sauvegarde `mysqldump` avant, migration `20261116000000_a9_migration_drift` gardée, comparaison du schéma recommandée, images backend et frontend reconstruites). Ce lot n'ajoute **aucune migration, aucun changement de schéma, de dépendance, de variable d'environnement ni de configuration Nginx**.
2. CI verte (6 jobs) sur le dernier commit poussé avant de déployer.
3. Backend uniquement pour ce lot (le frontend n'est pas modifié). Aucune donnée de production ne dépasse les bornes de N2 (vérifié en lecture seule) : aucun enregistrement existant ne devient non modifiable.
4. Verrous Redis en cours : compatibles (ancien format `'1'` lu avec le délai de base) ; aucune purge à faire. Les verrous posés après la mise à jour portent l'instant de fin.
5. Vérifications après déploiement : démarrage (`node dist/main`) ; un 429 de verrouillage (10 échecs sur une adresse e-mail inexistante créée pour l'occasion) avec corps `Trop de tentatives échouées : compte temporairement verrouillé, réessayez plus tard.` et en-tête `Retry-After` proche de 900 ; un 429 global inchangé ; la création d'une tâche avec un titre de 200 caractères répond 400, un titre normal 201.
6. Rollback : images précédentes (aucun état à défaire ; un verrou horodaté lu par l'ancien code reste un verrou).
7. L'arrêt propre n'a pas d'effet en production tant que `enableShutdownHooks()` n'est pas activé (O23).

### Ordre des constats ouverts (fin de r51)
1. **P7-b (avant A9-b, petit lot, Mineurs)** : **r51-m1** (test du délai décroissant du verrou), **r51-m2** (finances sur un espace sans projet, `NotFoundException` à la place de `Error`), **r51-m3** (balayage des DTO, test de garde sur les métadonnées, extension de Q-2). Ajouter le test e2e de suspension par l'administration et par SCIM (O-d).
2. **Suite de la Phase 6** : **A9-b** (NestJS 11, avec `jose` 4 vers 6), puis **A8** (y inclure O-b : `permissions.ts` source unique), puis **P2**.
3. Améliorations : **O23** (`enableShutdownHooks` avec `quit()` borné), O-a (404 pour une note d'autrui), r48-a1 (client HTTP commun), r48-a2 (pnpm global du poste, action utilisateur).
4. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
5. Actions d'exploitation : sauvegarde avant migration, comparaison complète du schéma de production, vérifications GitHub requises, confirmation de `TRUST_PROXY_HOPS` de production (O-c).
6. Clos par cette revue : O22, P7 (points 2 à 6), Q-2, N1, N2 (avec les réserves ci-dessus).

## Revue r52 (architecte) : lot P7-b (r51-m1, r51-m2, r51-m3, O-d) : VALIDÉ, quatre constats Mineurs et deux Améliorations (non bloquants)

**Verdict global : VALIDÉ, feu vert de commit.** r51-m1, r51-m2, O-d : **VALIDÉS** sans réserve. r51-m3 : **VALIDÉ** (21 DTO bornés, test de garde réel, aucune borne ne casse un usage légitime), avec des réserves sur la **portée du test de garde**, que le compte rendu (« liste d'exceptions vide ») présente comme exhaustive alors qu'elle ne l'est pas : un 500 reste atteignable par SCIM (N3, reproduit) et le garde a trois angles morts (N4). Aucune de ces réserves n'est une régression du lot ni une faille exploitable au-delà d'un 500 authentifié.

| Point | Verdict |
| --- | --- |
| r51-m1 (`Retry-After` exact, horloge simulée) | **VALIDÉ** : 5/5 ; contre-mutation du fixeur relue, cohérente avec le code |
| r51-m2 (`NotFoundException` finances, e2e espace sans projet) | **VALIDÉ** : ma contre-mutation (retour à `new Error`) fait échouer le test unitaire (1 échec) |
| r51-m3 (bornes de 21 DTO, test de garde, Q-2 à 220 cas) | **VALIDÉ**, réserves N3, N4, N5, N6 |
| O-d (retrait d'accès, 4 tests) | **VALIDÉ** : les trois chemins réels sont testés, l'écart signalé (aucune route ne suspend, SCIM retire l'appartenance) est exact |

### Vérifications indépendantes (MySQL 8.0 et Redis 7 jetables `r52-mysql` et `r52-redis`, supprimés)
- e2e `--runInBand --detectOpenHandles` : 8 suites, **371/371**, aucun handle ouvert. jest backend (`env -u DATABASE_URL -u E2E_DATABASE_URL`) : 108 suites, **2 972/2 972**. `nest build` et `tsc -p tests --noEmit` : 0 erreur. ESLint : 0 erreur, 15 avertissements préexistants. Prettier : `backend/src` et `backend/tests` propres (les avertissements sur `docs/` sont préexistants). vitest : 34 fichiers, **296/296**.
- **Contre-mutations (restauration `\cp`, `cmp` identique à chaque fois)** : (1) `@MaxLength(254)` retiré de `DiscoverSsoDto.email` : garde en échec (`DiscoverSsoDto.email : texte sans borne`) ; (2) `@ArrayMaxSize(50)` retiré de `ExecuteAiActionsDto.actions` : garde en échec (`tableau sans @ArrayMaxSize`) ; (3) `@MaxLength(16_000)` retiré de `CreateCommentDto.content` : Q-2 en échec (2 cas sur 220 : création et mise à jour) ; (4) retour à `new Error('Project not found')` : test unitaire des finances en échec ; (5) **contournement** : `domain` borné par `@Matches(/^a|b$/)` à la place de `@MaxLength(191)` : **le garde passe (5/5)**, voir N4.
- **Mesures en production (lecture seule, 2 requêtes `SELECT` d'agrégats avec l'utilisateur applicatif, aucune valeur affichée)** : `SSOConfiguration` : **0 ligne** (tous les `MAX(CHAR_LENGTH)` à NULL : `clientSecret`, `clientId`, `discoveryUrl`, `entryPoint`, `cert`, `issuer`) ; `Comment.content` max 84 ; `Attachment.fileUrl` aucune ligne ; `Project.billingType` max 18 ; `DeliveryChecklistItem` 0 ligne. Aucune donnée existante ne dépasse une borne.
- Le fixeur annonce 20 DTO ; le diff en contient **21** (écart sans conséquence). Je n'ai pas recompté les « 69 violations » ; le test de garde est vert et la mutation le met en échec, ce qui suffit.

### Relecture des bornes (champ par champ : SSO, administration, IA, tableaux)
- **SSO** : `email` 254, `domain`, `clientId`, `discoveryUrl`, `entryPoint`, `issuer` 191 = colonnes VARCHAR(191) (schéma `workspace.prisma` relu) ; `cert` 16 000 pour une colonne TEXT (PEM de 2 Ko, chaîne possible) ; `clientSecret` 66, voir question 1. Cohérent avec les colonnes et avec les usages (URL de découverte Azure AD d'environ 100 caractères, SSO SAML Okta d'environ 100).
- **Administration** : `search` 254 (une adresse au plus). `ImpersonateUserDto.reason` déjà `@Length(10, 500)`. Cohérent.
- **IA (`ResolvedAiActionDto`)** : identifiants 64 (UUID de 36), titres et noms 191 (colonnes), `taskDescription` 16 000 (TEXT), dates 64, libellés 2 000, actions 50. Un parcours normal (aperçu puis exécution) tient largement dans ces bornes ; le seul cas qui les dépasse est une commande de plus de 191 caractères pour un titre, voir N5.
- **Tableaux** : `checklist` (100 × 191), `assigneeIds` (100 × 64), `schemas` SCIM (10 × 256), `actions` (50), `attachments` (10, déjà borné). Frontend : la liste de contrôle est saisie « un élément par ligne » sans plafond côté interface, donc au-delà de 100 lignes l'utilisateur reçoit un 400 ; usage irréaliste, acceptable.
- **Formulaires du frontend** : aucun `maxLength` côté interface (seuls les codes MFA en ont), donc le serveur est la seule barrière ; toutes les bornes de texte reprennent les colonnes ou valent 16 000 pour un TEXT (4 octets par caractère au pire : 64 000 octets, sous 65 535). Les données de production maximales (84 caractères pour un commentaire) sont très en dessous. Aucun usage légitime cassé. Réserve de produit O-f (pièces jointes).

### Constats

**N3 (Mineur, CVSS 4.3 AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L) : un PATCH SCIM renvoie un 500 avec une valeur démesurée.**
- **Fichier** : `backend/src/auth/scim/scim.dto.ts` (`ScimPatchOperationDto.value` : `@Allow()` sans borne, type `any`), `backend/src/auth/scim/scim.service.ts` (`patchUser` : `String(op.value)` écrit tel quel dans `User.name`, VARCHAR(191)).
- **Reproduit** (e2e jetable, supprimé) : espace avec domaine vérifié, utilisateur créé par SCIM, puis `PATCH /scim/v2/Users/:id` avec `{ op: 'replace', path: 'displayName', value: 'x' × 300 000 }` : **500**. La création (`displayName` borné à 200) répond 400 : seul le PATCH est ouvert. Exige une clé SCIM valide (PR:L).
- **Remédiation** : dans `patchUser`, refuser (400 SCIM `invalidValue`) toute valeur `displayName`, `userName` ou e-mail de plus de 191 caractères avant l'écriture (ou `class-validator` personnalisé sur `value`, borné à 1 000 pour une chaîne et profondeur limitée pour un objet) ; **ajouter le cas au catalogue Q-2** (`SCIM : PATCH displayName gigantesque`) et à `webhook-scim.e2e-spec.ts` (provisionnement d'un compte puis PATCH). Critère : 400 au format SCIM, jamais 5xx ; contre-mutation : retrait du contrôle, le cas Q-2 échoue.

**N4 (Mineur) : le test de garde a trois angles morts.** Le test est bon dans son périmètre (fondé sur les métadonnées, tous les fichiers important `class-validator`, aucun DTO à déclarer), mais :
1. **`@IsISO8601` n'est pas dans `TEXT_VALIDATORS`** : 23 champs de date (tâche, projet, sprint, jalon, livrable, allocation, congé, plage de temps, `TimeRangeQueryDto`) acceptent une chaîne de longueur quelconque (l'expression de `validator` admet des décimales de longueur libre : `2024-01-01T00:00:00.` suivi de 300 000 chiffres est valide, et `new Date()` l'accepte). Aucun 5xx (la chaîne devient un `Date`), mais coût d'analyse et de transport sans borne et affirmation « aucun texte sans borne » inexacte. Remédiation : `@MaxLength(64)` sur ces champs et `isISO8601` (et `isDateString`) ajoutés à `TEXT_VALIDATORS`.
2. **`isBoundedPattern` est contournable** : `/^a|b$/` (alternance, deux branches non ancrées ensemble) commence par `^`, finit par `$`, sans `*` ni `+` : jugé « borné » alors qu'il accepte toute chaîne commençant par `a` (mutation 5, le garde passe). Aucun motif de ce type n'existe aujourd'hui. Remédiation : refuser tout motif contenant `|` hors groupe, ou exiger `^(?:…)$`, et ajouter ce cas au test du motif.
3. **Champs sans validateur de type** : `ScimPatchOperationDto.value` (`@Allow()`, c'est N3), et plus généralement tout champ décoré seulement de `@IsOptional`, `@IsNotEmpty` ou `@Allow` n'est jamais examiné. Remédiation : le test échoue pour un champ dont les validateurs ne comptent aucun type reconnu (texte, nombre, booléen, énumération, UUID, date, imbriqué), liste d'exceptions justifiée.
Aussi : `UpdateProjectDto.billingType` est borné à 191 alors que la création et `UpdateProjectFinancesDto` le bornent à 50. Remédiation : valeur fermée `@IsIn(['TIME_AND_MATERIALS', 'FIXED_PRICE'])` aux trois endroits (valeurs de production : 18 caractères, 5 projets) ou, à défaut, 50 partout.

**N5 (Mineur) : l'aperçu IA peut produire une action que l'exécution refuse.** `normalizeResolvedAction` (`ai.service.ts`) filtre les champs mais ne tronque pas les longueurs. Une commande (jusqu'à 4 000 caractères) dont le titre dépasse 191 caractères donne un aperçu valide, que `POST /projects/ai/execute` refuse ensuite par un 400 générique (avant les bornes : 500 en base). Remédiation : borner dans `normalizeResolvedAction` avec les mêmes constantes que le DTO (titre 191, libellés 2 000, etc.), ou marquer l'action `resolved: false` avec un `warning` explicite ; test : toute sortie de `normalizeResolvedAction` valide `ExecuteAiActionsDto`.

**N6 (Mineur, décision de l'architecte) : `clientSecret` SSO, voir la réponse 1.** Passer la colonne en TEXT, borne à 1 024, migration, avant la première configuration SSO réelle. Non bloquant pour le commit.

**O-e (Amélioration) : route d'administration de suspension d'un compte**, voir la réponse 3. À rattacher à A8.

**O-f (Amélioration, produit) : pièces jointes limitées à environ 48 Ko.** Le frontend envoie les fichiers en URL `data:` (`readAsDataURL`), la colonne `Attachment.fileUrl` est TEXT (65 535 octets) et le DTO borne à 65 000 caractères : un fichier de plus de 48 Ko environ est refusé alors que `MAX_ATTACHMENT_SIZE` annonce 10 Mo et que l'interface n'affiche aucune limite. Avant : 500 ; maintenant : 400 (message de `class-validator` en anglais). Sans régression, mais l'attente de l'utilisateur et le plafond réel divergent ; à traiter avec le stockage objet (hors Phase 6) ou, à court terme, un message français et un plafond annoncé dans l'interface.

### Réponses aux questions du fixeur
1. **`clientSecret` SSO : colonne en TEXT et migration, borne remise à 1 024.** Raisons : (a) la borne de 66 dépend d'un détail de chiffrement (`58 + 2 n` caractères) ; (b) `@MaxLength` compte des unités UTF-16 et non des octets : 66 caractères non ASCII font plus de 66 octets et dépasseraient 191 une fois chiffrés, le 500 revient (le test ne couvre que le cas ASCII) ; (c) la table est **vide en production (0 ligne, mesuré)** : la migration est triviale et sans risque, et un lot de migrations part de toute façon avec le déploiement. Secrets réels : Google 35, Azure environ 40, Okta 64 : 66 passe aujourd'hui, donc **le commit de P7-b peut partir tel quel** ; la migration est le constat N6 (`ALTER TABLE SSOConfiguration MODIFY clientSecret TEXT NULL` via `schema/workspace.prisma` `@db.Text`, test de garde remplacé par un test « chiffré, la valeur maximale tient dans 65 535 octets »), à faire avant la première configuration SSO réelle et de préférence avant ce déploiement.
2. **Bornes choisies** : **100** pour `checklist` et `assigneeIds` : acceptée (production : 1 assigné au plus, aucune liste ; l'interface ne plafonne pas la saisie mais l'usage est irréaliste au-delà). **50** pour `billingType` : acceptée comme plafond, **mais préférer une valeur fermée** (`@IsIn`), et corriger l'incohérence avec `UpdateProjectDto` (191) : N4. **2 000** pour les actions IA : acceptée, à condition d'aligner l'aperçu sur le DTO : N5.
3. **Route de suspension** : **oui, en Amélioration O-e, avec A8** (pas dans P7-b). Forme : `POST /admin/users/:id/suspend` et `/unsuspend`, rôle de plateforme SUPER_ADMIN, refus de se suspendre soi-même et de suspendre le dernier SUPER_ADMIN, écriture de `isSuspended` **et** révocation de toutes les sessions avec invalidation du cache (`revokeAllForUser`, fenêtre ramenée de 60 s à zéro), journal d'audit ; e2e : session coupée immédiatement, connexion 403, réactivation rétablit la connexion. **En attendant, procédure d'exploitation** : poser le drapeau en base puis appeler `POST /admin/users/:id/revoke-sessions` (déjà testé : immédiat).

### Feu vert de commit (chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*`) : 5 commits, dans cet ordre
1. `test(security): délai exact du Retry-After d'un verrou de compte, horloge simulée (r51-m1)` : `backend/tests/unit/common/retry-after.filter.spec.ts`.
2. `fix(backend): résumé financier d'un projet disparu répond 404 en français au lieu d'un 500, espace sans projet couvert (r51-m2)` : `backend/src/projects/finances.service.ts`, `backend/tests/unit/projects/finances.service.spec.ts`.
3. `fix(security): longueurs maximales sur tous les champs texte et tableaux des DTO exposés, test de garde sur les métadonnées class-validator (r51-m3)` : les 21 DTO modifiés (`backend/src/admin/dto/admin.dto.ts`, `backend/src/auth/dto/firebase-login.dto.ts`, `backend/src/auth/scim/scim.dto.ts`, `backend/src/auth/sso/sso.dto.ts`, et dans `backend/src/projects/dto/` : `ai-command`, `attachment`, `create-comment`, `create-deliverable`, `create-delivery`, `create-invitation`, `create-milestone`, `create-project`, `create-resource-allocation`, `create-resource-leave`, `create-task-dependency`, `create-task`, `execute-ai-actions`, `update-project-finances`, `update-resource-profile`, `update-sprint`, `update-task`, tous en `.dto.ts`) et `backend/tests/unit/common/dto-length-bounds.spec.ts` (nouveau).
4. `test(e2e): catalogue Q-2 étendu à 220 cas, finances d'un espace sans projet, retrait d'accès d'un compte (r51-m2, r51-m3, O-d)` : `backend/tests/e2e/security/abuse-no-5xx.e2e-spec.ts`, `backend/tests/e2e/security/authz.e2e-spec.ts`, `backend/tests/e2e/security/account-suspension.e2e-spec.ts` (nouveau).
5. `docs(security): revues r52, lot P7-b (r51-m1 à r51-m3, O-d)` : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, en dernier.
Aucune mention d'outil d'assistance ni `Co-Authored-By`. Pousser après les 5 commits et attendre les 6 jobs verts. Les commits 1 à 4 passent chacun isolément (le 4 dépend de 2 et 3).

### Conditions de déploiement de l'ensemble 722df54 à P7-b (production actuelle : 93711a8)
1. **Prérequis** : CI verte sur les 6 jobs du dernier commit poussé ; **toutes les conditions des revues r49 et r51 restent valables** : sauvegarde `mysqldump` complet avant (runbook S28), migration `20261116000000_a9_migration_drift` gardée et idempotente (sur une base conforme elle ne modifie rien et s'enregistre), comparaison du schéma de production avec le schéma Prisma recommandée, images **backend et frontend** reconstruites (`docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`).
2. **P7-b n'ajoute aucune migration, dépendance, variable d'environnement ni configuration Nginx** ; backend seulement (frontend inchangé par ce lot). Si N6 est fait avant, une migration élargissant `SSOConfiguration.clientSecret` (table vide) s'ajoute : même sauvegarde, aucun arrêt.
3. **Données** : aucune valeur de production ne dépasse une borne (25 mesures du fixeur, 2 requêtes de contrôle de cette revue) : aucun enregistrement existant ne devient non modifiable ; SSO : 0 configuration.
4. **Vérifications après déploiement** : démarrage (`node dist/main`) ; connexion ; un 429 de verrouillage avec `Retry-After` proche de 900 (10 échecs sur une adresse inexistante créée pour l'occasion) ; création d'une tâche de titre normal 201 et de 200 caractères 400 ; commentaire normal 201 et de 20 000 caractères 400 ; parcours IA nominal (aperçu puis exécution) ; résumé des finances d'un espace avec projets 200.
5. **Rollback** : images précédentes ; aucun état à défaire (les migrations n'ont pas de retour arrière à jouer).
6. **Connu et accepté** : un 500 reste possible par SCIM (N3, clé SCIM valide requise) tant que N3 n'est pas corrigé ; il est préférable de corriger N3 avant de déployer si l'on active SCIM en production (`FEATURE_SCIM_ENABLED`). Les crochets d'arrêt propre restent inactifs en production (O23).

### Ordre des constats ouverts (fin de r52)
1. **P7-c (petit lot, avant A9-b, Mineurs)** : **N3** (borne et 400 du PATCH SCIM, cas Q-2 et e2e), **N4** (garde : `isISO8601` et `@MaxLength(64)`, motif à alternance, champs sans type, `billingType` en valeur fermée), **N5** (aperçu IA aligné sur le DTO), **N6** (`clientSecret` en TEXT, migration, borne 1 024).
2. **Suite de la Phase 6** : **A9-b** (NestJS 11, avec `jose` 4 vers 6), puis **A8** (y inclure O-b : `permissions.ts` source unique, et **O-e** : routes de suspension et de réactivation), puis **P2**.
3. Améliorations : **O-f** (pièces jointes, plafond réel), **O23** (`enableShutdownHooks` avec `quit()` borné), O-a (404 pour une note d'autrui), r48-a1 (client HTTP commun), r48-a2 (pnpm global du poste, action utilisateur).
4. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
5. Actions d'exploitation : sauvegarde avant migration, comparaison complète du schéma de production, vérifications GitHub requises, confirmation de `TRUST_PROXY_HOPS` de production (O-c).
6. Clos par cette revue : r51-m1, r51-m2, r51-m3 (avec N3 à N6 ouverts), O-d.

## Revue r53 (architecte) : lot P7-c (N3, N4, N5, N6) : VALIDÉ, un constat Mineur et deux Améliorations (non bloquants)

**Verdict global : VALIDÉ, feu vert de commit.** Les quatre constats de r52 sont corrigés, chacun avec un test qui échoue quand on retire le correctif (contre-mutations rejouées ci-dessous). Les écarts du compte rendu sont sans conséquence : 22 champs ISO (et non 23, voir N4), « huit autres » DTO introuvable dans le journal écrit (la liste y compte 12 fichiers, le diff aussi). Un défaut distinct est ouvert (r53-m1, `remove` SCIM).

| Point | Verdict |
| --- | --- |
| N3 (PATCH SCIM borné, 400 `invalidValue`) | **VALIDÉ** : 6 échecs reproduits par le fixeur avant correction (relu), 13/13 e2e SCIM, contre-mutation en échec |
| N4 (`@MaxLength(64)` sur 22 champs ISO, garde étendu, `billingType` fermé) | **VALIDÉ** : 22 est le bon compte ; 4 contre-mutations sur le code réel détectées |
| N5 (aperçu IA aligné sur le DTO) | **VALIDÉ** : 3 contre-mutations détectées ; la politique tronquer/retirer plus avertir est la bonne |
| N6 (`clientSecret` en TEXT, borne 1 024, migration) | **VALIDÉ** : migration appliquée, 0 écart, rejeu idempotent, rejeu depuis VARCHAR(191) OK, 500 reproduit avec l'ancienne colonne |
| Ajout CI (rejeu N6 dans le job `migrations`) | **ACCEPTÉ** (réponse 3) |

### Vérifications indépendantes (MySQL 8.0 et Redis 7 jetables `r53-mysql` et `r53-redis`, supprimés)
- `migrate deploy` : les migrations, dont `20261117000000_n6_sso_client_secret_text`, s'appliquent ; `migrate diff --from-config-datasource --to-schema --exit-code` : « No difference detected ». Rejeu du SQL sur base conforme : succès, 0 écart. Colonne remise en `VARCHAR(191)` à la main puis rejeu du SQL : redevient `text`.
- Jest backend (`env -u DATABASE_URL -u E2E_DATABASE_URL`) : 109 suites, **2 985/2 985**. e2e `--runInBand --detectOpenHandles` : 8 suites, **380/381 puis 381/381** : le seul échec était le test « 300 requêtes par minute et par clé » (webhook-scim), en dépassement du délai de 30 s parce que je lançais jest unitaire en parallèle sur la même machine ; rejoué seul : 13/13. Aucun handle ouvert. Ce test est sensible à la charge (300 requêtes séquentielles sous 30 s) : sans effet en CI où le job e2e tourne seul, mais à garder en tête si le job ralentit. `nest build`, `tsc -p tests --noEmit` : 0 erreur. ESLint : 0 erreur, 15 avertissements préexistants. Prettier (`src`, `tests`, `prisma/schema`) : propre. vitest non rejoué : aucun fichier du frontend modifié.
- **Contre-mutations (restauration `\cp`, `cmp` identique à chaque fois, `git diff --stat` inchangé : 27 fichiers, 714/55)** :
  1. N3 : borne de `scimText` neutralisée : test unitaire en échec (1) et e2e dédié en échec (1) ; le catalogue Q-2 reste vert (il vise d'autres cas), le test dédié est donc celui qui garde.
  2. N4 : `@IsIn(BILLING_TYPES)` de `UpdateProjectDto` remplacé par `@IsString() @MaxLength(191)` : `billing-type.dto.spec` en échec ; `@MaxLength(64)` retiré d'un champ ISO de `create-sprint` et de `list-query` (`TimeRangeQueryDto.start`) : garde en échec ; `@IsString()` retiré de `LoginDto.passwordRaw` : garde en échec (aucun validateur de type).
  3. N5 : troncature supprimée : 3 échecs ; passage à `resolved: false` supprimé : 1 échec ; protection de la paire de substitution supprimée : 1 échec.
  4. N6 : borne ramenée à 66 : test du garde en échec ; `@db.Text` retiré du schéma : test du garde en échec ; **colonne remise en `VARCHAR(191)`** puis e2e `abuse-no-5xx` : 2 échecs (500), TEXT rétablie par la migration : 229/229.
  5. Tentatives de contournement du garde : alternance non ancrée (`/^a|b$/`, `/^a$|^b$/`) : refusée par `isBoundedPattern` (test synthétique relu) ; champ sans type (`@Allow`, `@IsOptional` seul) : refusé ; exception orpheline : refusée. Limite restante : la **valeur** de la borne n'est pas contrôlée (voir r53-a1).
- **Relecture du diff** : 27 fichiers modifiés et 3 nouveaux, tels que décrits. `scimText` s'applique à `displayName`, `userName` et `emails` avant toute écriture ; `patchUser` n'écrit que `User.name`. `normalizeResolvedAction` est le seul chemin vers `ResolvedAiAction` renvoyé au client (`ai.service.ts:498`) ; l'`id` d'une action est toujours `action-temp-N` côté serveur, donc le retrait d'un `id` trop long (cas qui ne peut pas se produire) ne casse pas le frontend, qui s'en sert pour supprimer une carte. La migration est gardée par `information_schema` et ne modifie rien sur une base conforme ; l'élargissement VARCHAR vers TEXT est sans perte. Les cas SSO de Q-2 étaient bien vacants (404, drapeau de fonctionnalité absent) avant le lot : constat annexe exact et utile, ils sont désormais effectifs (229/229).

### Constats

**r53-m1 (Mineur, CVSS 4.3 AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N) : `PATCH` SCIM `{ op: 'remove', path: 'displayName' }` écrit la chaîne « undefined » comme nom du compte.**
- **Fichier** : `backend/src/auth/scim/scim.service.ts` (`patchUser`, branche `displayname`, `scimText` : `String(undefined)`). Comportement historique, conservé par le lot (le commentaire de `scimText` le dit désormais exactement).
- **Impact** : un fournisseur d'identité qui efface l'attribut (Okta et Entra le font en retirant un attribut) renomme l'utilisateur en « undefined » : intégrité d'un champ d'affichage, par une clé SCIM valide. Pas de fuite ni d'escalade.
- **Remédiation** : `User.name` est obligatoire ; une opération `remove` sur `displayName` (par chemin ou sans valeur) est refusée en **400 SCIM `mutability`** (RFC 7644 §3.5.2.2 et §3.12), sans écriture. `remove` sur un autre attribut ignoré reste inchangé. Ne pas ignorer silencieusement : l'IdP doit voir l'échec.
- **Critère d'acceptation** : test unitaire (`remove` de `displayName` par chemin : 400 `mutability`, `prisma.user.update` non appelé ; remplacement valide inchangé) et cas e2e dans `webhook-scim.e2e-spec.ts` (nom inchangé en base) ; contre-mutation : retour à `String(op.value)` fait échouer les deux. À faire avant A9-b, petit lot (P7-d), sans dépendance.

**r53-a1 (Amélioration) : le garde ne contrôle pas la valeur de la borne.** `@MaxLength(1_000_000_000)` passe, tout comme `@IsObject()` ou `@IsArray()` seuls (types reconnus, volume non borné par le garde). Remédiation : dans `inspect`, exiger `maxLength <= 65 535` (ou une constante nommée) et une taille maximale pour `@IsObject` ; test synthétique correspondant. Faible urgence (limite du corps de requête en amont).

**r53-a2 (Amélioration, produit) : l'aperçu IA annonce un blocage qui n'existe pas.** `AiCommandBar.tsx` affiche « Veuillez sélectionner un collaborateur ou modifier le titre pour pouvoir les exécuter », alors que `canExecute` ne dépend pas de `hasWarnings` (voir réponse 2). Remédiation à décider avec le produit : soit aligner le texte (« vérifiez avant d'exécuter »), soit bloquer le bouton tant qu'une action est `resolved: false` (test vitest). Pas de changement serveur.

### Réponses aux questions du fixeur
1. **`remove` de `displayName` écrit « undefined » : oui, correctif séparé**, ouvert en r53-m1 (400 SCIM `mutability`, pas d'ignorance silencieuse). Raison de séparer : changement de comportement visible par les IdP, à tester isolément, et hors du périmètre « borne et 500 » de N3.
2. **Bloquer l'exécution d'une action `resolved: false` : non dans ce lot, et pas côté serveur.** Le champ `resolved` est renvoyé par le client : le serveur ne peut pas s'y fier, et `executeActions` valide déjà chaque action par ses champs (identifiants vérifiés dans l'espace, 404 sinon). Retirer un identifiant ou tronquer un titre est sûr : au pire l'exécution échoue proprement ou crée une tâche au titre tronqué que l'utilisateur a vu signalé. Le sujet est un choix d'interface : ouvert en r53-a2.
3. **CI : garder.** Les deux pas reprennent le schéma du rejeu de la migration de dérive (r47-m1), coûtent quelques secondes et garantissent que la migration reste idempotente et sans écart. Limite : le rejeu part d'une base déjà conforme ; le cas « depuis VARCHAR » est couvert par `migrate deploy` lui-même, qui applique la migration sur la base vide. Question annexe (22 ou 23 champs ISO) : **22 est exact**, mon chiffre de 23 de r52 était un recompte erroné ; N4 est clos sur 22 et le garde (vert, mutations rouges) tranche. L'incohérence « huit autres » contre dix n'apparaît pas dans le journal tel qu'écrit (12 fichiers listés, 22 champs) : sans objet.

### Feu vert de commit (chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*`) : 5 commits, dans cet ordre
Le N6 et le N4 partagent `dto-length-bounds.spec.ts` (le test de la borne 1 024 y remplace celui de 66) : ils sont dans le même commit pour que chacun passe isolément.
1. `fix(security): PATCH SCIM borné à 191 caractères, 400 invalidValue au lieu d'un 500 (N3)` : `backend/src/auth/scim/scim.dto.ts`, `backend/src/auth/scim/scim.service.ts`, `backend/src/auth/scim/scim.service.spec.ts`, `backend/tests/e2e/security/webhook-scim.e2e-spec.ts`.
2. `fix(security): dates ISO bornées à 64 caractères, billingType en valeur fermée, garde étendu ; clientSecret SSO en TEXT, borne 1 024 (N4, N6)` : `backend/src/projects/dto/billing-types.ts`, `backend/src/projects/dto/create-deliverable.dto.ts`, `backend/src/projects/dto/create-milestone.dto.ts`, `backend/src/projects/dto/create-project.dto.ts`, `backend/src/projects/dto/create-resource-allocation.dto.ts`, `backend/src/projects/dto/create-resource-leave.dto.ts`, `backend/src/projects/dto/create-sprint.dto.ts`, `backend/src/projects/dto/create-task.dto.ts`, `backend/src/projects/dto/create-timeblock.dto.ts`, `backend/src/projects/dto/list-query.dto.ts`, `backend/src/projects/dto/update-project.dto.ts`, `backend/src/projects/dto/update-project-finances.dto.ts`, `backend/src/projects/dto/update-sprint.dto.ts`, `backend/src/projects/dto/update-task.dto.ts`, `backend/src/auth/dto/login.dto.ts`, `backend/src/auth/sso/sso.dto.ts`, `backend/prisma/schema/workspace.prisma`, `backend/prisma/migrations/20261117000000_n6_sso_client_secret_text/migration.sql`, `backend/tests/unit/common/dto-length-bounds.spec.ts`, `backend/tests/unit/projects/billing-type.dto.spec.ts`, `.github/workflows/ci.yml`.
3. `fix(backend): aperçu IA aligné sur les bornes du DTO d'exécution, troncature et avertissement par champ (N5)` : `backend/src/projects/dto/execute-ai-actions.dto.ts`, `backend/src/projects/ai.service.ts`, `backend/tests/unit/authz/ai-roundtrip.spec.ts`.
4. `test(e2e): cas SCIM et SSO du catalogue Q-2 rendus effectifs, secret SSO de 1 024 caractères en base (N3, N6)` : `backend/tests/e2e/security/abuse-no-5xx.e2e-spec.ts` (dépend des commits 1 et 2).
5. `docs(security): revues r53, lot P7-c (N3 à N6)` : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, en dernier.
Aucune mention d'outil d'assistance ni `Co-Authored-By`. Pousser après les 5 commits et attendre tous les jobs verts, y compris `migrations` (nouveaux pas).

### Conditions de déploiement (production actuelle : 93711a8 ; l'ensemble couvre aussi P7-b)
1. **Prérequis** : CI verte sur tous les jobs du dernier commit poussé ; conditions des revues r49, r51 et r52 inchangées ; **sauvegarde `mysqldump` complet avant la migration**.
2. **Migration** : `20261117000000_n6_sso_client_secret_text` (gardée, idempotente) ; `ALTER TABLE SSOConfiguration MODIFY clientSecret TEXT NULL`, sans perte ; table vide en production (mesure r52 : 0 ligne, non rejouée ici, lecture seule, rien écrit en production). Verrou de table bref sans conséquence sur une table vide. Aucune dépendance, variable d'environnement, ni configuration Nginx (`ekose-nginx-1` inchangé) ; frontend inchangé.
3. **Vérifications après déploiement** : démarrage ; connexion ; création de projet avec `billingType: 'TIME_AND_MATERIALS'` (201) et `'HOURLY'` (400) ; une date ISO normale acceptée et une chaîne de 5 000 caractères refusée (400) ; si SCIM est actif, un PATCH `displayName` de 192 caractères répond 400 `invalidValue` ; `SHOW COLUMNS FROM SSOConfiguration LIKE 'clientSecret'` : `text`.
4. **Rollback** : images précédentes. Pas de retour arrière de la migration : la colonne TEXT est compatible avec l'ancien code (les secrets chiffrés de plus de 191 caractères ne pourraient pas revenir en VARCHAR(191), mais la table est vide).
5. **Connu et accepté** : r53-m1 (SCIM `remove` de `displayName` renomme en « undefined ») tant que le correctif n'est pas fait : à corriger avant d'activer SCIM en production ; r53-a1 et r53-a2 ; le test des 300 requêtes SCIM est sensible à la charge de la machine.

### Ordre des constats ouverts (fin de r53)
1. **P7-d (petit lot, avant A9-b)** : **r53-m1** (400 `mutability` sur `remove` de `displayName`, test unitaire et e2e).
2. **Suite de la Phase 6** : **A9-b** (NestJS 11, avec `jose` 4 vers 6), puis **A8** (y inclure O-b et **O-e**), puis **P2**.
3. Améliorations : **r53-a1** (valeur de la borne contrôlée par le garde), **r53-a2** (aperçu IA : texte ou blocage, décision produit), O-f, O23, O-a, r48-a1, r48-a2.
4. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
5. Actions d'exploitation : sauvegarde avant migration, comparaison complète du schéma de production, vérifications GitHub requises, confirmation de `TRUST_PROXY_HOPS` de production (O-c).
6. Clos par cette revue : N3, N4, N5, N6.

## Revue r54 (architecte) : lot P7-d (r53-m1) : VALIDÉ, un constat Mineur et une Amélioration (non bloquants)

**Verdict global : VALIDÉ, feu vert de commit.** Le `remove` de `displayName` répond 400 SCIM `mutability` sans écriture, `undefined` n'est plus converti en chaîne, et le refus est global (les écritures ont lieu après la boucle des opérations). Les deux écarts déclarés sont acceptés. Un défaut voisin, non traité et hors du périmètre du lot, est ouvert (r54-m1 : `remove` de `active`).

| Point | Verdict |
| --- | --- |
| r53-m1 (`remove` de `displayName` : 400 `mutability`, `scimText` refuse `undefined`) | **VALIDÉ** : 3 contre-mutations détectées, diff relu, périmètre limité à `patchUser` et `scimText` |
| Test N3 modifié (retrait de « remove sans valeur résolu ») | **ACCEPTÉ** : il figeait le défaut ; le cas valide de 191 caractères est conservé |

### Vérifications indépendantes (MySQL 8.0 et Redis 7 jetables `r54-mysql` et `r54-redis`, supprimés)
- e2e `--runInBand --detectOpenHandles` : 8 suites, **382/382**, aucun handle ouvert. Jest unitaire (`env -u DATABASE_URL -u E2E_DATABASE_URL`) : 109 suites, **2 987/2 987**. `nest build` OK ; `tsc -p tests --noEmit` OK ; ESLint 0 erreur, 15 avertissements préexistants ; Prettier propre ; vitest 34 fichiers, 296/296.
- **Contre-mutations** (restauration `\cp`, `cmp` identique à chaque fois) :
  1. Refus `remove` neutralisé (`if (false)`) : unitaire en échec (1/25) et e2e en échec (1/14).
  2. `scimText` qui retolère `undefined` (`String(raw)`), refus `remove` conservé : unitaire en échec (`replace` de `displayName` sans valeur), e2e vert : le cas `replace` sans valeur n'est gardé que par l'unitaire, suffisant.
  3. Refus limité à `remove` avec chemin (le `remove` sans chemin avec `value.displayName` repasse) : unitaire et e2e en échec.
  4. Tentative de contournement : casse du chemin (`DISPLAYNAME`) et de `op` (`Remove`) : refusées (déjà dans les tests) ; opération valide suivie d'un `remove` : aucune écriture (relu et mesuré).
- **Relecture** : `nameUpdate` n'est écrit qu'après la boucle ; `replace` de `displayName` avec la valeur `''` ne lève rien et n'écrit rien (`nameUpdate` falsy), voir r54-a1. Écart de compte : le journal annonce « e2e SCIM 15/15 », je mesure **14/14** dans `webhook-scim.e2e-spec.ts` (13 avant, plus 1). Sans conséquence, la batterie complète est à 382.

### Constats
**r54-m1 (Mineur, CVSS 3.8 AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:L) : `PATCH` SCIM `remove` du chemin `active` (ou `replace`/`add` sans valeur, ou valeur non booléenne) suspend le compte.**
- **Fichier** : `backend/src/auth/scim/scim.service.ts`, `patchUser`, branche `active` : `activeUpdate = activeVal === true || 'true' || 'True'` donne `false` pour `undefined`, `null`, `'yes'`, `1`, ce qui retire la membership (`applyActiveState`) et révoque les invitations en attente.
- **Impact** : même famille que r53-m1 : une absence de valeur est interprétée comme une décision destructive. Un IdP qui efface l'attribut `active` coupe l'accès d'un utilisateur. Réversible (réactivation par `active: true`), clé SCIM requise.
- **Remédiation** : `remove` de `active` refusé en 400 `mutability` (cohérent avec r53-m1, l'IdP voit l'échec) ; `replace`/`add` sans valeur ou valeur ni booléenne ni `'true'`/`'false'` (casse ignorée) refusés en 400 `invalidValue`. Aucune écriture, refus global.
- **Critère d'acceptation** : unitaire (`remove` de `active`, `replace` sans valeur, `'yes'` : 400, `applyActiveState` non appelé ; `true`, `false`, `'True'`, `'false'` inchangés) et e2e (membership conservée) ; contre-mutation : retour à l'évaluation actuelle fait échouer les deux. Vérifier au préalable le comportement d'Entra ID et d'Okta (ils envoient des booléens ou des chaînes « True »/« False »).

**r54-a1 (Amélioration) : `replace` de `displayName` avec `''` répond 200 sans rien changer.** Le client croit le nom vidé. Répondre 400 `invalidValue` (valeur vide), au même lot que r54-m1.

### Réponses aux questions du fixeur
1. **`remove` de `active` : oui, à ouvrir**, r54-m1. Le comportement n'est défendable pour aucun IdP : la RFC 7644 ne fait pas d'un attribut absent une désactivation, et les IdP désactivent par `active: false`. Séparé de r53-m1 car le périmètre du lot était `displayName` ; petit lot P7-e, sans dépendance, à placer avant l'activation de SCIM en production.
2. **`PUT` sans `displayName` : non concerné, accepté.** Le nom est conservé (`dto.displayName || dto.name?.formatted`), pas d'écriture de « undefined », test existant. La sémantique stricte d'un PUT (remplacement complet) n'est pas poursuivie : pas de changement.
3. Écarts du lot : **acceptés**. Le refus pour `replace`/`add` sans valeur est la bonne extension (même cause) ; une valeur `null` en `invalidValue` est correcte (type, pas mutabilité).

### Feu vert de commit (chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*`) : 2 commits, dans cet ordre
1. `fix(security): PATCH SCIM, remove de displayName refusé en 400 mutability, undefined jamais converti en nom (r53-m1)` : `backend/src/auth/scim/scim.service.ts`, `backend/src/auth/scim/scim.service.spec.ts`, `backend/tests/e2e/security/webhook-scim.e2e-spec.ts` (code et tests ensemble : chaque commit passe isolément).
2. `docs(security): revue r54, lot P7-d (r53-m1)` : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, en dernier.
Aucune mention d'outil d'assistance ni `Co-Authored-By`.

### Conditions de déploiement (production actuelle : 93711a8 ; l'ensemble couvre aussi P7-b et P7-c, voir r53)
1. **Prérequis** : CI verte sur tous les jobs ; conditions de r53 inchangées, dont la **sauvegarde `mysqldump` complet** avant la migration `20261117000000_n6_sso_client_secret_text` (déjà en attente de déploiement).
2. **Migration** : aucune dans ce lot. Aucune dépendance, aucune variable, **aucun changement de proxy** (`ekose-nginx-1` inchangé).
3. **Vérifications après déploiement** : si SCIM est actif, `PATCH /scim/v2/Users/<id>` avec `remove` de `displayName` : 400 `mutability`, nom inchangé ; `replace` valide : 200 ; vérifier dans les journaux d'un IdP réel qu'il n'émet pas de `remove` de `displayName` en routine (il verrait désormais un échec de synchronisation).
4. **Rollback** : image précédente, sans effet de données.
5. **Connu et accepté** : r54-m1 et r54-a1 ; r53-a1, r53-a2. **r53-m1 n'est plus un risque accepté** une fois ce lot déployé. Recommandation : ne pas activer SCIM en production avant r54-m1.

### Ordre des constats ouverts (fin de r54)
1. **P7-e (petit lot, avant A9-b)** : **r54-m1** (`active` : `remove` en 400 `mutability`, valeur absente ou non booléenne en 400 `invalidValue`), avec **r54-a1** (`displayName` vide).
2. **Suite de la Phase 6** : **A9-b** (NestJS 11, avec `jose` 4 vers 6), puis **A8** (y inclure O-b et **O-e**), puis **P2**.
3. Améliorations : **r53-a1**, **r53-a2**, O-f, O23, O-a, r48-a1, r48-a2.
4. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
5. Actions d'exploitation : sauvegarde avant migration, comparaison complète du schéma de production, vérifications GitHub requises, confirmation de `TRUST_PROXY_HOPS` de production (O-c).
6. Clos par cette revue : r53-m1.

## Revue r55 (architecte) : lot P7-e (r54-m1, r54-a1) : VALIDÉ, une Amélioration (non bloquante)

**Verdict global : VALIDÉ, feu vert de commit.** `active` n'est plus jamais déduit d'une absence ou d'une valeur invalide, `remove` de `active` répond 400 `mutability`, un `displayName` vide ou blanc répond 400 `invalidValue`. Le refus est global (les écritures ont lieu après la boucle). Les formats réellement émis par Entra ID (`"True"`/`"False"`) et Okta (`{active:false}` sans chemin) restent acceptés et sont testés en e2e avec la membership vérifiée en base. Aucun écart avec le rapport.

| Point | Verdict |
| --- | --- |
| r54-m1 (`active` : `remove` en 400 `mutability`, absent ou non booléen en 400 `invalidValue`) | **VALIDÉ** : 4 contre-mutations détectées (unitaire et e2e), plus une tentative de contournement |
| r54-a1 (`displayName` vide ou blanc : 400 `invalidValue`) | **VALIDÉ** : contre-mutations `trim` et test de vérité détectées |

### Vérifications indépendantes (MySQL 8.0 et Redis 7 jetables `r55-mysql` et `r55-redis`, supprimés)
- e2e `--runInBand --detectOpenHandles` : 8 suites, **388/388**, aucun handle ouvert. Jest unitaire (`env -u DATABASE_URL -u E2E_DATABASE_URL`) : 109 suites, **2 997/2 997**. `nest build` OK ; `tsc -p tests --noEmit` OK ; ESLint 0 erreur, 15 avertissements préexistants ; Prettier propre ; vitest 34 fichiers, 296/296.
- **Diff complet et cohérent** (point du `cp` interactif) : `scimBoolean`, la branche `remove` de `active`, le test `!== undefined` et le refus `trim() === ''` sont tous présents ; `scim.service.ts` +38/-3, spec +95, e2e SCIM +94, Q-2 +20. Les chiffres du journal correspondent (16 `it` e2e SCIM, 4 cas Q-2, +10 unitaires, 388 e2e).
- **`pnpm` / `npx`** : équivalents. `pnpm exec X` et `npx X` résolvent le même binaire du `node_modules` du dépôt (j'ai utilisé `npx jest`, `npx nest build`, `npx tsc`, `npx eslint`, `npx prettier`, `npx vitest`, `npx prisma`) ; mêmes configurations (`jest-e2e.json`, `tsconfig.test.json`), mêmes résultats que ceux du fixeur. La CI utilise `pnpm` et doit rester la référence.
- **Contre-mutations** (fichier de référence, restauration `\cp`, `cmp` identique à chaque fois ; chaque ligne : unitaire 1 échec/35, e2e SCIM 1 échec/16) :
  1. Refus `remove` de `active` neutralisé (`if (false)`) : détecté (le `scimType` devient `invalidValue`).
  2. `scimBoolean` renvoyant `true` pour toute autre chaîne : détecté.
  3. Refus `trim() === ''` neutralisé : détecté.
  4. Retour de `op.value?.displayName !== undefined` au test de vérité : détecté.
  5. Contournement : refus `remove` limité à `path === 'active'` (le `remove` sans chemin avec `{active:false}` repasse) : détecté.

### Relecture ciblée : `!== undefined` et formats d'IdP
- `{active:false}` / `{displayName:'X'}` / objet multi-attributs sans chemin (forme Entra avec le drapeau `aadOptscim062020`) : inchangés, chaque clé est évaluée indépendamment, les valeurs valides passent.
- `op` est mis en minuscules par le DTO (`scim.dto.ts:145`) : `Replace`, `Remove` d'Entra sont bien couverts.
- Seul changement de comportement pour un objet : `{displayName: null}` (auparavant ignoré, 200) répond maintenant 400 `invalidValue`, ce qui aligne la forme objet sur la forme avec chemin (déjà 400 depuis N3). Voir r55-a1.

### Constats
**r55-a1 (Amélioration) : `{displayName: null}` en forme objet sans chemin répond 400 `invalidValue`, alors qu'il passait en 200 auparavant.** Cohérent et défendable (`User.name` obligatoire), mais un IdP qui enverrait `null` pour un nom vide dans un remplacement multiple verrait toute l'opération refusée (y compris un `active` valide dans la même requête). Aucune source consultée n'indique qu'Entra ou Okta le fasse ; ne rien changer maintenant. Si un IdP réel le fait (journaux de synchronisation après activation), traiter `null` comme `mutability` et envisager de n'ignorer que cette clé. Pas de test requis tant que non observé.

### Réponses aux questions du fixeur
1. **Chaînes autres que `true`/`false` (`"1"`, `"yes"`) : refus confirmé** (400 `invalidValue`). Ni Entra ni Okta n'émettent autre chose que le booléen ou `"True"`/`"False"` ; une tolérance élargie ferait revenir une valeur ambiguë vers une décision destructive. Le drapeau `aadOptscim062020` n'est pas nécessaire côté serveur (les deux formats passent).
2. **`PUT` avec `displayName` vide : conservation du nom, accepté, pas de changement.** Le `PUT` ne crée ni n'écrit de valeur vide ; la sémantique stricte de remplacement complet n'est pas poursuivie (même position que r54).

### Feu vert de commit (chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*`) : 2 commits, dans cet ordre
1. `fix(security): PATCH SCIM, active jamais déduit d'une absence ou d'une valeur invalide, displayName vide refusé (r54-m1, r54-a1)` : `backend/src/auth/scim/scim.service.ts`, `backend/src/auth/scim/scim.service.spec.ts`, `backend/tests/e2e/security/webhook-scim.e2e-spec.ts`, `backend/tests/e2e/security/abuse-no-5xx.e2e-spec.ts` (code et tests ensemble : chaque commit passe isolément).
2. `docs(security): revue r55, lot P7-e (r54-m1, r54-a1)` : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, en dernier.
Aucune mention d'outil d'assistance ni `Co-Authored-By`.

### Conditions de déploiement (production actuelle : 93711a8 ; l'ensemble couvre aussi P7-b, P7-c et P7-d, voir r53 et r54)
1. **Prérequis** : CI verte sur tous les jobs ; conditions de r53 inchangées, dont la **sauvegarde `mysqldump` complet** avant la migration `20261117000000_n6_sso_client_secret_text` (en attente de déploiement).
2. **Migration** : aucune dans ce lot. Aucune dépendance, aucune variable, **aucun changement de proxy** (`ekose-nginx-1` inchangé, `docker restart` et non `reload` si le proxy est touché par ailleurs).
3. **Vérifications après déploiement** (SCIM, sur un espace de test) : `PATCH` `remove` de `active` : 400 `mutability`, membership conservée ; `replace` `active` `"False"` puis `"True"` : 200, suspension puis réactivation ; `replace` `displayName` `"  "` : 400, nom inchangé. Surveiller les journaux de l'IdP réel (échecs de synchronisation sur `active` ou `displayName`, cf. r55-a1).
4. **Rollback** : image précédente, sans effet de données.
5. **Connu et accepté** : r55-a1, r53-a1, r53-a2. r54-m1 et r54-a1 ne sont plus des risques une fois ce lot déployé.
6. **SCIM en production : activable une fois ce lot déployé**, aux conditions suivantes : les commits ci-dessus déployés avec la migration N6 (sauvegarde préalable) ; un domaine SSO vérifié (`verifiedDomain`) et une clé SCIM dédiée par espace ; test de bout en bout avec l'IdP réel sur un espace pilote (création, `active` false/true, changement de nom, suppression) avant généralisation ; `TRUST_PROXY_HOPS` de production confirmé (O-c, limite de 300 requêtes par minute et par clé) ; aucun autre constat bloquant ouvert sur SCIM (r53-m1, r54-m1, r54-a1 clos).

### Ordre des constats ouverts (fin de r55)
1. **Suite de la Phase 6** : **A9-b** (NestJS 11, avec `jose` 4 vers 6), puis **A8** (y inclure O-b et **O-e**), puis **P2**.
2. Améliorations : **r55-a1** (à observer, aucune action), **r53-a1**, **r53-a2**, O-f, O23, O-a, r48-a1, r48-a2.
3. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
4. Actions d'exploitation : sauvegarde avant migration, comparaison complète du schéma de production, vérifications GitHub requises, confirmation de `TRUST_PROXY_HOPS` de production (O-c).
5. Clos par cette revue : r54-m1, r54-a1.

## Spécification A9-b (architecte) : NestJS 11, Express 5, `@nestjs/throttler` 6, `jose` 6 (2026-11-11)

**Nature : spécification pour le `fixeur`, aucun code modifié.** Établie sur le dépôt à `639c5d6` (production déployée avec ce lot, sauf la migration N6, voir r55) et sur des essais faits **uniquement dans des copies temporaires** : résolution de dépendances et `pnpm audit` sur copie des `package.json` et du lockfile, lecture du code source des paquets cibles (`npm pack`), sonde Jest sur `jose` 6. **Non exécuté** : l'application sous NestJS 11 (c'est le rôle du lot), Docker, Node 20.19 (la machine est en Node 24.16).

### 1. Décisions et cadrage

| Décision | Choix | Pourquoi |
| --- | --- | --- |
| Version majeure de NestJS | **11.2.9** (dernière 11.x, publiée le 2026-11-09, étiquette npm `legacy`) | Demandé. NestJS **12** existe (12.0.0 du 2026-08-27, 12.4.2 `latest`) : il impose des paquets ESM, TypeScript 6 pour `@nestjs/schematics`, Jest réellement utilisable seulement sur Node 24.9+, et un ordre des hooks de cycle de vie modifié. Hors périmètre ; à décider **après** A9-b (lot A9-c éventuel). La 11.x reçoit encore des correctifs (11.2.9 date de deux jours). |
| `jose` | **6.2.17** (6.2.x, ESM seul) | Voir §4 : la contrainte « CommonJS » qui avait fait choisir 4.15.9 est levée à l'exécution (Node ≥ 20.19 ou ≥ 22.12, `require(esm)`), **pas sous Jest 29**, qui exige une configuration de transformation. |
| Découpage | **5 sous-lots commitables** (A9-b0 à A9-b4), jamais un lot unique | Un échec doit pointer un seul changement. Le seul point où deux montées sont couplées est évité en passant `@nestjs/throttler` 6, `@nestjs/config` 4 et `@nestjs/jwt` 11 **avant** NestJS 11 : leurs `peerDependencies` acceptent NestJS 10 et 11. |
| Node | **22 LTS minimum en production et en CI** (24 acceptable si toute la batterie y passe) | Node 20 est en fin de vie depuis le 2026-04-30 ; les cibles exigent Node ≥ 20.11 (CLI 11), ≥ 20.19 (`@nestjs/throttler` 6.7, `require(esm)` pour `jose` 6). Aujourd'hui : `FROM node:20-alpine` (backend et frontend), `node-version: 20` (4 occurrences dans `ci.yml`). |
| Ordre | Déployer d'abord le lot déjà validé (P7-b à P7-e et la migration N6, sauvegarde `mysqldump` préalable), l'observer, **puis** A9-b par sous-lots | Ne pas mélanger une migration de schéma et un changement de framework : un incident serait inattribuable. |

### 2. Inventaire réel des versions (état à `639c5d6`)

Sources : `backend/package.json`, `pnpm-lock.yaml` (lockfileVersion 9.0, formaté par Prettier : un `pnpm install` le réécrit en entier, voir §6), `pnpm-workspace.yaml`, `package.json` racine (`packageManager: pnpm@10.34.9`), Dockerfiles, `ci.yml`.

| Paquet | Déclaré (backend) | Résolu (lockfile) | Cible | Remarque |
| --- | --- | --- | --- | --- |
| `@nestjs/common`, `core`, `platform-express`, `platform-socket.io`, `websockets` | 10.4.22 (exact) | 10.4.22 | **11.2.9** (exact, même numéro pour les cinq) | `platform-express` 11.2.9 dépend d'`express` **5.2.1**, `multer` 2.5.0, `path-to-regexp` 8.4.2, `cors` 2.8.6 ; `platform-socket.io` 11.2.9 de `socket.io` 4.8.3 (identique à l'actuel) |
| `@nestjs/testing` | 10.4.15 (devDep., **décalé** de 10.4.22) | 10.4.15 | **11.2.9** | Aligner sur les autres |
| `@nestjs/cli` / `@nestjs/schematics` | 10.0.0 / 10.0.0 (devDep.) | idem | **11.0.24** / **11.1.0** | CLI 11 : Node ≥ 20.11 ; schematics : `typescript >=4.8.2` |
| `@nestjs/throttler` | 5.1.2 | 5.1.2 | **6.7.1** | `peer` : Nest 7 à 12. Node `^20.19 \|\| ^22.12 \|\| >=24` |
| `@nestjs/config` | 3.2.2 | 3.2.2 (tire `uuid@9.0.1`, avis moderate) | **4.0.4** | `peer` : Nest 10 ou 11 ; n'a plus `uuid` ; `dotenv` 17 |
| `@nestjs/jwt` | 10.2.0 | 10.2.0 (`jsonwebtoken` 9) | **11.0.2** | `peer` : Nest 8 à 11 ; `jsonwebtoken` 9.0.3 |
| `@nestjs/schedule` | ^6.1.3 | 6.1.3 | **inchangé** | `peer` : Nest 10 ou 11 |
| `class-validator` / `class-transformer` | ^0.15.1 / ^0.5.1 | 0.15.1 / 0.5.1 | **inchangés** | `peer` de Nest 11 : `>=0.13.2` / `>=0.4.1` |
| `reflect-metadata` / `rxjs` | 0.2.0 / 7.8.1 (exacts) | idem | 0.2.2 / 7.8.2 (facultatif, correctifs) | `peer` de Nest 11 : `^0.1.12 \|\| ^0.2.0`, `^7.1.0` |
| `express` | aucune déclaration directe (types seulement) | **4.22.1** (via `platform-express`) ; 4.22.1 et 5.3.0 aussi via `firebase-tools` (devDep.) | **5.2.1** (via Nest 11) | `firebase-tools` garde Express 4 : voir surcharge `body-parser` §6 |
| `body-parser` | surcharge `>=1.20.9 <2` | 1.20.9 | **2.4.0** pour Express 5 (surcharge à réécrire, §6) | |
| `path-to-regexp` | transitif | 3.3.0 (Nest 10), 0.1.13 (Express 4) | **8.4.2** | origine des ruptures de syntaxe de routes |
| `multer`, `qs`, `cookie`, `cookie-parser`, `helmet` | surcharge 2.5.0 / surcharge 6.17.0 / 0.7.2 / 1.4.7 / ^8.2.0 | idem | inchangés | `helmet` 8 et `cookie-parser` 1.4.7 sont compatibles Express 5 |
| `socket.io` / `socket.io-client` (devDep.) / `@socket.io/redis-adapter` | 4.8.3 / 4.7.5 / 8.3.0 | 4.8.1 et 4.8.3 / idem / idem | inchangés | surcharges `engine.io`, `socket.io-parser`, `ws` conservées |
| `ioredis` / `redis` | 5.4.1 / 4.7.1 | idem | inchangés | indépendants de Nest |
| `@prisma/client` / `prisma` / `@prisma/adapter-mariadb` | 7.8.0 / 7.8.0 / ^7.8.0 | 7.8.0 | inchangés | indépendants de Nest |
| `jose` | 4.15.9 (exact) | 4.15.9 (direct **et** via `jwks-rsa` ← `firebase-admin`) ; 6.2.13 via `firebase-tools` | **6.2.17** pour le backend | la 4.15.9 transitive de `firebase-admin` reste : elle n'est pas la nôtre |
| `@types/express` / `@types/node` / `typescript` | 4.17.17 / 20.3.1 / 5.4.5 | idem | **5.0.6** / 22.x / 5.4.5 d'abord | si `tsc` refuse les types de Nest 11, monter TypeScript d'**un** cran (5.5 à 5.9), dans un commit séparé, **pas** TypeScript 6 |
| `jest` / `ts-jest` / `@types/jest` | 29.7.0 / 29.2.5 / 29.5.14 | idem | inchangés | Jest 29 ne charge pas `jose` 6 sans configuration (§4) |
| Node | Dockerfiles `node:20-alpine`, CI 20, poste 24.16.0 | | **22** | |

**Surcharges actuelles** (`pnpm-workspace.yaml`) : `mariadb`, `multer`, `socket.io-parser`, `engine.io`, `ws`, `body-parser` (`>=1.20.9 <2`), `qs`, `lodash`, `mysql2`, `fast-uri`, `@grpc/grpc-js`, `deepmerge-ts`, `valibot`, `file-type`.

**Baseline `pnpm audit --prod --audit-level=high`** (mesuré le 2026-11-11) : 15 avis (2 low, 13 moderate), **aucun high**. Parmi eux `@nestjs/core` GHSA-36xv-jgw5-4q75 (moderate, corrigé en 11.1.18, exception documentée dans `docs/security/audit-exceptions.md`) et `uuid@9.0.1` via `@nestjs/config`. **Essai sur copie** (cibles du §3, surcharge `body-parser` réécrite) : 14 avis (2 low, 12 moderate), **aucun high**, l'avis `@nestjs/core` a disparu, `@nestjs/config` ne tire plus `uuid` (il reste via `google-gax`), `hono` et `@hono/node-server` (Prisma, outillage) inchangés.

### 3. Versions cibles et sources

| Montée | Source officielle | Contenu retenu |
| --- | --- | --- |
| NestJS 10 vers 11 | Guide de migration : https://docs.nestjs.com/v11/migration-guide (la page `https://docs.nestjs.com/migration-guide` décrit désormais 11 vers 12 : ne pas l'appliquer) | Node ≥ 20 ; Express 5 par défaut ; jokers nommés (`/*splat`, `/{*splat}`), `forRoutes('*')` converti mais déconseillé ; `?` optionnel supprimé (accolades) ; `query parser` « simple » par défaut (`app.set('query parser','extended')` pour revenir) ; hooks de destruction (`OnModuleDestroy`, `BeforeApplicationShutdown`, `OnApplicationShutdown`) dans l'**ordre inverse** de l'initialisation ; modules dynamiques identifiés par référence d'objet (plus de hachage) ; middlewares des modules globaux exécutés avant ceux des modules importés ; `Reflector` (`getAllAndOverride` renvoie `T \| undefined`, `getAllAndMerge` change pour un objet unique) ; `@nestjs/config` 4 (ordre de recherche, `ignoreEnvVars` déprécié) |
| Express 4 vers 5 | https://expressjs.com/en/guide/migrating-5.html | `path-to-regexp` 8 (jokers nommés, `?` retiré, caractères `()[]?+!` réservés, regex interdites) ; `req.body` **`undefined`** si aucun corps analysé (au lieu de `{}`) ; `req.query` en lecture seule, analyseur `simple` ; `req.host` garde le port ; `res.clearCookie` ignore `maxAge` et `expires` ; `res.status` n'accepte que 100 à 999 ; `res.json(body, status)` et `res.send(status)` retirés ; promesses rejetées transmises aux gestionnaires d'erreur ; `express.urlencoded` : `extended` par défaut à `false` (Nest passe `extended: true`) ; Node ≥ 18 |
| `body-parser` 2 | code source 2.2.2 (lu) | `req._body` **n'existe plus** : un analyseur ignore une requête dont le flux est terminé (`onFinished.isFinished`) ; `req.body` vaut `undefined` sans corps |
| `@nestjs/throttler` 5 vers 6 | https://github.com/nestjs/throttler/releases et code source 6.7.1 (lu) | **Interface de stockage changée** : `increment(key, ttl, limit, blockDuration, throttlerName)` et retour `{ totalHits, timeToExpire, isBlocked, timeToBlockExpire }` ; `Retry-After` posé **seulement si `isBlocked`**, avec `timeToBlockExpire` ; clés en SHA-256 (6.2.0, les compteurs Redis existants ne sont pas repris) ; `getTracker(req, context)` (6.3) ; option `setHeaders` (6.5) ; pisteur IPv6 en /64 (6.7, sans effet ici : `getTracker` est surchargé) ; stockage mémoire à fenêtre glissante (6.7) |
| `jose` 4 vers 6 | https://github.com/panva/jose/blob/main/CHANGELOG.md (entrées 5.0.0 et 6.0.0) | 5.0.0 : Node EOL abandonnés, `base64url.decode` renvoie `Uint8Array`, génériques de types de `jwtVerify`. 6.0.0 : Node ≤ 18 abandonné ; **`require` possible seulement si le runtime a `require(esm)`** ; cibles ES2022 ; **`createRemoteJWKSet` utilise `fetch`** (l'option Node `agent` disparaît, options `timeoutDuration`, `cooldownDuration`, `cacheMaxAge`, `headers` conservées) ; `importJWK/importSPKI/...` renvoient des `CryptoKey` ; Ed448, X448, secp256k1, RSA1_5 retirés |
| Avis | https://github.com/advisories/GHSA-36xv-jgw5-4q75 | `@nestjs/core` corrigé à partir de 11.1.18 |

Aucun usage de `jose` par le code applicatif en dehors de `jwtVerify`, `createRemoteJWKSet` et du type `JWTVerifyGetKey` (`src/auth/sso/sso.service.ts:14,419`, `src/auth/sso/oidc.ts:4,63`). Les jetons d'accès, de rafraîchissement et le ticket MFA passent par `@nestjs/jwt` (`jsonwebtoken`), **pas** par `jose` : le rayon d'action de A9-b3 est la connexion SSO OIDC.

### 4. Points de rupture à rechercher dans ce code (revue faite, à confirmer par les tests)

| # | Zone | Constat de l'architecte | Risque | Contrôle exigé |
| --- | --- | --- | --- | --- |
| R1 | Syntaxe des routes Express 5 | **Aucun** décorateur `@Get/@Post/@All/...` de `backend/src` ne contient `*`, `?`, `+`, `(`, `)` ni paramètre optionnel ; aucun `forRoutes`, `exclude` ni `MiddlewareConsumer` (seulement des `app.use` sans chemin) ; pas de `setGlobalPrefix`. Les chemins `scim/v2/Users/:id`, `workspaces/:workspaceId/...` sont des paramètres nommés simples. | Faible | Comparer la **table des routes** avant et après : relever les lignes `Mapped {chemin, MÉTHODE} route` du démarrage (journal Nest actif) sous NestJS 10, puis sous 11 ; `diff` vide exigé. |
| R2 | Route du webhook, casse et barre finale | `body-parsers.ts:23` choisit le plafond de 2 Mo par l'expression `^/projects/([^/]+)/webhooks/github/?$` avec le drapeau **`i`**, sur `req.url` (hors requête). Le routage d'Express 5 reste insensible à la casse et tolère la barre finale par défaut (`caseSensitive` et `strict` faux), mais cette décision est **dupliquée** : si le routage et l'expression divergent, une livraison serait routée sans le corps brut (HMAC faux) ou bornée à 1 Mo. `noStoreMiddleware`, `webhookFailurePrecheck` et `originCheckMiddleware` reposent sur la même hypothèse (`req.path`, `req.url`). Aucun test e2e actuel ne vise `/Projects/<id>/WEBHOOKS/GITHUB/`. | **Majeur** si divergence (HMAC, 413) | Ajouter **en A9-b0, sur la pile actuelle**, un e2e : livraison signée valide sur `/projects/<id>/webhooks/github`, `/projects/<id>/webhooks/github/`, `/Projects/<id>/WEBHOOKS/GitHub/` : même résultat (200) ; corps de 1,5 Mo accepté sur les trois ; 2,5 Mo : 413 sur les trois ; refus répétés : le 429 du pré-contrôle est le même sur les trois formes. Il doit rester vert tel quel après A9-b2. |
| R3 | Throttler et `AppThrottlerGuard` | `RedisThrottlerStorage implements ThrottlerStorage` avec `increment(key, ttl)` et retour `{totalHits, timeToExpire}` : **ne compile plus** et ne bloque plus en 6.x (`isBlocked` absent, donc jamais 429). `ScimKeyThrottlerGuard` (`app-throttler.guard.ts`) appelle le stockage à 2 arguments et décide lui-même `totalHits > SCIM_KEY_LIMIT`. Le repli `new ThrottlerStorageService()` devient la version à fenêtre glissante, avec 5 arguments. `getTracker` est surchargé (`req.ips[0]` puis `req.ip`) : conserve, la valeur de suivi par défaut IPv6 /64 ne s'applique pas. | **Critique si mal adapté** (limiteur muet) | Voir A9-b1. |
| R4 | Filtre `RetryAfterFilter` | `@Catch(TooManyAttemptsException)` (`extends HttpException`), pose `Retry-After` via `response.status().set().json()` : API Express 5 inchangée. Pas de rupture attendue. Le filtre est enregistré par `APP_FILTER`. | Faible | Tests existants `retry-after.filter.spec.ts` et e2e `rate-limits` ; ajouter l'assertion de **valeur** (entier ≥ 1 et ≤ 60) sur chaque 429 (limiteur, verrouillage de compte, SCIM par clé). |
| R5 | `trust proxy` | `app.set('trust proxy', hops === 0 ? false : hops)` (`trust-proxy.ts:38`) : API inchangée en Express 5 (`proxy-addr`). `req.ip`/`req.ips` alimentent le limiteur et le pré-contrôle du webhook. | Faible mais **sensible** (contournement du limiteur) | e2e existants (compteur par `X-Forwarded-For`) + essai manuel : `TRUST_PROXY_HOPS=1`, deux `X-Forwarded-For` forgés en chaîne : l'adresse retenue est celle ajoutée par le proxy de confiance, pas celle du client. |
| R6 | `body-parser`, limites de corps | `app.useBodyParser('raw', {limit:'2mb', type: fn})` puis `('json', {limit:'1mb', type:[json, scim+json]})` (`body-parsers.ts:129-130`). Nest 11 appelle `express.raw/json` (body-parser **2**). Le drapeau interne `req._body` disparaît : le JSON ne ré-analyse pas le corps brut seulement parce que le flux est terminé ; à prouver. La surcharge `body-parser: '>=1.20.9 <2'` **forcerait la 1.x sous Express 5** et casserait `express.json` : **à réécrire** (§6). `urlencoded` : Nest impose `extended: true` (limite par défaut 100 ko, inchangée). `req.body` devient `undefined` sans corps : `ValidationPipe` doit répondre 400, jamais 500, sur les routes à DTO appelées sans corps. | **Majeur** (HMAC du webhook, 413) | e2e : `req.rawBody` reste un `Buffer` sur le webhook (signature valide acceptée, signature d'un corps ré-sérialisé refusée) ; 413 au-delà de 1 Mo en JSON et de 2 Mo sur le webhook ; JSON mal formé : 400 ; POST sans corps sur une route à DTO : 400 ; `application/scim+json` accepté. |
| R7 | Adaptateur Socket.IO et Redis | `@WebSocketGateway({cors})`, `afterInit(server)` pose `server.adapter(createAdapter(pub, sub))` avec `redis` 4.7.1 (`tracking.gateway.ts:78-87`). Pas d'`IoAdapter` personnalisé. `platform-socket.io` 11.2.9 embarque le même `socket.io` 4.8.3. Pas de rupture attendue ; le risque est l'**ordre inverse des hooks de destruction** (Nest 11) : le gateway ferme ses clients Redis (`onModuleDestroy`), `RedisService` et `PrismaService` aussi. | Moyen (arrêt, fuites de handles) | e2e `o22-shutdown` (aucun handle ouvert) ; `tests/integration/realtime/task-room-revocation.spec.ts` ; essai manuel à **deux instances** : un événement émis sur A reçu par un client connecté à B ; `app.close()` sans erreur. |
| R8 | `ValidationPipe` et pipe maison | `AppValidationPipe extends ValidationPipe` surcharge `transform(value, metadata)` et délègue à un second `ValidationPipe` pour les DTO `@lenient()` (`Reflect.getOwnMetadata`). La signature 11 est identique (la contrainte plus stricte est propre à NestJS 12). `reflect-metadata` 0.2.0 reste accepté. Les `UuidPipe` s'appuient sur `ParseUUIDPipe`. Risque : message d'erreur de validation ou statut sur corps absent. | Faible | Tests existants (`input-validation`, `abuse-no-5xx`) verts sans modification ; 388 e2e. |
| R9 | `req.query` et analyseur « simple » | Les DTO de requête (`AuditLogQueryDto`, `TimeRangeQueryDto`, `AdminPaginationQueryDto`, `ScimListQueryDto`, `SsoAuthorizeQueryDto`, `GithubAuthorizeQueryDto`) ne portent aucun paramètre imbriqué. Avec `whitelist` et `forbidNonWhitelisted`, une clé `a[b]=1` reste refusée (400). Ne **pas** activer `extended` par réflexe : l'analyseur « simple » réduit la surface (pas d'objets imbriqués, pas de pollution par `qs`). | Faible | Confirmer par recherche dans `frontend/src` qu'aucun appel n'envoie `x[y]=` ni `x[]=` ; test : `?a[b]=1` sur une route à DTO : 400 avant et après. |
| R10 | Cookies et `res.clearCookie` | `session-cookies.ts` : `clearCookie(name, {httpOnly, secure, sameSite, path})`, sans `maxAge` ni `expires` : pas d'effet. `res.cookie(..., {maxAge})` inchangé. `cookie` 0.7.2. | Faible | e2e `auth-session` ; vérifier dans les en-têtes bruts que `Set-Cookie` de déconnexion garde `Path`, `Secure`, `SameSite=Strict`, `HttpOnly`. |
| R11 | En-têtes (Helmet, CORS, no-store) | **La suite e2e n'installe ni Helmet ni CORS** (`e2e-app.ts:36`) : aucune des 388 vérifications ne couvre les en-têtes de l'API. Express 5 pose toujours `X-Powered-By` (Helmet le retire). Le pré-contrôle du webhook répond avant Helmet (déjà le cas aujourd'hui). | **Majeur** (régression silencieuse) | Test de caractérisation en A9-b0 : démarrer le **vrai** `main.ts` (voir §5, instantané) et figer les en-têtes ; comparer après chaque sous-lot. |
| R12 | Cycle de vie et injection | Aucun `configure(consumer)`, `enableShutdownHooks` absent. `FeatureFlagGuard` et `JwtAuthGuard` utilisent `Reflector.getAllAndOverride` (retour `T \| undefined` en 11) : le code lit déjà `?` ; `tsc` signalera tout usage non protégé. Modules dynamiques : `ConfigModule.forRoot()` dans `AuthModule`, `ThrottlerModule.forRootAsync` dans `AppModule`, chacun importé **une fois** : pas d'effet de dédoublonnage. Tests : `Test.createTestingModule` peut recevoir plusieurs instances d'un module dynamique réimporté. | Faible | Si un test `overrideProvider` cesse de s'appliquer : dédupliquer le module dynamique ; en dernier recours seulement, `moduleIdGeneratorAlgorithm: 'deep-hash'` dans les tests (jamais en production). |
| R13 | `@nestjs/config` 4 | `ConfigModule.forRoot()` sans option et aucun `ConfigService` dans le code : l'inversion d'ordre de recherche (configuration interne avant `process.env`) est sans objet. `dotenv` 17 affiche une bannière d'information au chargement d'un `.env` : à surveiller dans les journaux (aucun secret affiché), ne pas lire ni modifier de `.env*`. | Faible | Démarrage propre ; `NODE_ENV=production` sans `JWT_SECRET` échoue toujours (fail-fast existant). |
| R14 | API de `jose` 6 (SSO OIDC) | `jwtVerify(token, getKey, {issuer, audience, algorithms:['RS256'], clockTolerance: 60})` : mêmes options en 6. `createRemoteJWKSet(new URL(uri), {timeoutDuration: 5000})` : option conservée ; **transport changé** (`fetch`, `redirect: 'manual'` dans la source 6.2.17, donc une redirection du JWKS est refusée, ce qui est plus strict qu'avant) ; `JWTVerifyGetKey` toujours exporté. `OidcKeySource.getKeys` met en cache un `getKey` par URI (le cache interne de `jose` 6 : 10 min, délai de repos 30 s). Les URI de JWKS proviennent de la configuration SSO validée (S10), pas du client. | Moyen (connexion SSO) | Voir A9-b3 (tests avec JWKS local, `alg: none`, `HS256`, mauvais `aud`, `iss`, `exp`, `nonce`) et essai réel sur un IdP de test. |
| R15 | Jest 29 et `jose` 6 | **Constaté par sonde** : `require('jose')` fonctionne dans Node, mais **échoue sous Jest 29** (« Jest encountered an unexpected token », module ESM, aucune condition `require` dans `exports`). Impacté : `tests/unit/auth/sso-oidc.spec.ts` et toute suite important `sso.service.ts` ou `oidc.ts` (dont les e2e/HTTP SSO). Une configuration `transformIgnorePatterns` + `ts-jest` avec `allowJs` fait passer la sonde. En disposition pnpm, le chemin réel est `node_modules/.pnpm/jose@6.x/node_modules/jose/...` : le motif doit viser ce chemin, pas seulement `node_modules/jose`. | **Majeur** (suites SSO rouges, ou pire désactivées par `jest.mock`) | Voir A9-b3. Interdit : `jest.mock('jose')` pour contourner. |
| R16 | Types | `@types/express` 5 : `req.params` valeurs `string`, gestionnaires `void`, `req.ip` `string \| undefined`. Les doublures de requêtes des tests (`tests/http`, `fake-*`) et les `Request`/`Response` typés (`login-response.ts`, `scim-http.ts`, middlewares) peuvent échouer à la compilation. | Moyen (travail, pas de risque) | `nest build` et `tsc -p tests --noEmit` verts ; corriger les types, jamais par `any` généralisé. |
| R17 | Outillage et CI | `nest build` (CLI 11) ; `prebuild: prisma generate` ; `pnpm audit` ; `Dockerfile` backend (pnpm 10.34.9). Prettier réécrit-il le lockfile ? Le lockfile actuel est formaté (blocs `resolution: {` sur plusieurs lignes) : un `pnpm install` produira un diff massif si on ne le reformate pas. | Faible | §6. |

### 5. Sous-lots, étapes et critères d'acceptation

Règles communes à tous les sous-lots : un commit par sous-lot (code, tests et lockfile ensemble ; documentation en dernier) ; **aucune assertion existante affaiblie ni supprimée** (une assertion modifiée est listée dans le journal avec sa raison) ; jamais `git add -A`, ni `.claude/`, ni `.env*` ; aucune trace d'outil d'assistance ; bases MySQL 8.0 et Redis 7 jetables pour les essais (`docker run`, supprimées à la fin).

**Batterie complète de référence** (à rejouer, et à consigner avec les chiffres, à la fin de chaque sous-lot) : e2e `--runInBand --detectOpenHandles` ; jest unitaire (`env -u DATABASE_URL -u E2E_DATABASE_URL`) ; `nest build` ; `tsc -p tests --noEmit` ; ESLint ; Prettier ; vitest frontend ; `pnpm install --frozen-lockfile` ; `pnpm audit --prod --audit-level=high` ; `pnpm why` ciblés. Baseline à `639c5d6` : e2e **8 suites, 388/388** ; jest **109 suites, 2 997/2 997** ; vitest **34 fichiers, 296/296** ; ESLint 0 erreur, 15 avertissements ; audit **0 high** (15 avis moderate/low).

**Instantané comportemental (A9-b0, puis après chaque sous-lot).** Démarrer le vrai point d'entrée (`node dist/main` ou `nest start`) avec `NODE_ENV=production`-équivalent de test (`TRUST_PROXY_HOPS=1`, `CORS_ORIGINS=http://localhost:3000`, base et Redis jetables) et enregistrer, hors dépôt, la sortie de `curl -si` pour : `GET /features` ; une route protégée sans jeton (401) ; une route inconnue (404) ; `POST /auth/login` avec mauvais identifiants répété jusqu'au 429 (statut, corps, `Retry-After`, `X-RateLimit-*`) ; une requête SCIM sans clé (401) ; `OPTIONS` avec `Origin` autorisé puis non autorisé ; `GET /auth/...` (no-store) ; une livraison de webhook non signée (401) puis signée ; un JSON de 1,2 Mo (413) ; un JSON mal formé (400). Normaliser `Date`, `ETag`, valeurs d'`X-RateLimit-Reset`. **Avant/après : différences expliquées une par une** (attendues : aucune, hors changement d'ordre des en-têtes). Les en-têtes Helmet 8 par défaut à retrouver : `Content-Security-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Origin-Agent-Cluster`, `Referrer-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Frame-Options`, `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection: 0`, et **pas** de `X-Powered-By`. Les réponses d'erreur portent `Cache-Control: no-store` sur `/auth`, `/admin` et la régénération du secret de webhook.

#### A9-b0 : filet complémentaire et plancher Node (sur la pile actuelle, NestJS 10)

1. Tests de caractérisation, **verts sur NestJS 10 avant tout changement de version** : R2 (webhook : trois formes de chemin, corps 1,5 Mo et 2,5 Mo, signature, pré-contrôle 429), R6 (413 JSON, JSON mal formé 400, POST sans corps 400, `scim+json`, `rawBody` Buffer), R9 (`?a[b]=1` : 400), R4 (valeur numérique de `Retry-After` sur chaque famille de 429), R11 (test des en-têtes de l'API : monter un `NestExpressApplication` avec **le même câblage que `main.ts`**, Helmet inclus ; idéalement extraire le câblage de `main.ts` dans une fonction partagée par `main.ts` et `e2e-app.ts`, pour que le test couvre le vrai code ; `main-hardening.spec.ts` lit `main.ts` comme du texte et ne prouve rien du comportement).
2. Script ou test qui produit la **table des routes** (R1) ; consigner la sortie de référence dans le journal.
3. Node 22 : `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/Dockerfile.prod` (`FROM node:22-alpine`), les quatre `node-version` de `ci.yml`, `docs/security/ci.md` ; `"engines": {"node": ">=22.12"}` dans les `package.json` racine et backend ; `@types/node` 22.x si `tsc` passe (sinon en A9-b2). Vérifier `argon2`, Prisma 7.8 et `prisma generate` sous Node 22 Alpine.
4. Critères : batterie complète verte ; e2e = 388 + nouveaux tests (nombre exact consigné), aucun test supprimé ; `docker build` des trois images OK, et le backend démarre dans l'image Node 22.
5. Contre-mutations : (a) expression `WEBHOOK_PATH` rendue sensible à la casse : l'e2e R2 échoue ; (b) limite JSON portée à 100 ko ou 10 Mo : l'e2e 413 échoue ; (c) `helmet()` retiré du câblage : le test d'en-têtes échoue ; (d) `Retry-After` retiré du filtre : le test de valeur échoue.

#### A9-b1 : `@nestjs/throttler` 6.7.1, `@nestjs/config` 4.0.4, `@nestjs/jwt` 11.0.2, **sur NestJS 10**

1. `RedisThrottlerStorage` : signature `increment(key, ttl, limit, blockDuration, throttlerName)` ; retour `{ totalHits, timeToExpire, isBlocked: totalHits > limit, timeToBlockExpire: isBlocked ? timeToExpire : 0 }`. Conserver la **fenêtre fixe** et le `Retry-After` égal au temps restant de la fenêtre (comportement actuel) : ne pas laisser `blockDuration` rallonger le blocage. Transmettre les cinq arguments au repli `ThrottlerStorageService`, dont la sémantique glissante est nouvelle : documenter l'écart (panne Redis uniquement).
2. `ScimKeyThrottlerGuard` : utiliser le stockage avec les cinq arguments (nom de limiteur dédié, par exemple `scim-key`), décider sur `isBlocked`, poser `Retry-After` avec `timeToBlockExpire` (secondes, entier ≥ 1), lever `ThrottlerException(THROTTLE_MESSAGE)`. Le refus sans `scimApiKeyId` reste inchangé.
3. `AppThrottlerGuard` : `getTracker` et `getErrorMessage` conservés (vérifier la signature `getTracker(req, context)`). `ThrottlerModule.forRootAsync` : même forme `{ throttlers, storage }`. `@Throttle`, `@SkipThrottle` (webhook, gateway) inchangés.
4. Mettre à jour `redis-throttler.storage.spec.ts`, `scim-throttler.spec.ts`, `throttling-proxy.spec.ts` pour la nouvelle signature **sans retirer de cas** ; ajouter : au `limit`-ième appel `isBlocked` est faux, au `limit+1`-ième vrai ; `timeToBlockExpire` en secondes ≥ 1.
5. Critères : e2e `rate-limits` et SCIM inchangés et verts ; **429 identiques** (statut, corps `{statusCode:429, message}` en français, `Retry-After` entier en secondes dans [1, 60], mêmes seuils par route : 3, 5, 10, 15, 20, 30 par minute, 60 global, 300 par clé SCIM, 3 000 par IP SCIM) ; comparaison de l'instantané ; `pnpm why uuid` : plus de `uuid` via `@nestjs/config` ; audit sans nouvel avis élevé.
6. Contre-mutations : (a) `isBlocked` toujours faux : e2e `rate-limits` échoue ; (b) `timeToBlockExpire` à 0 : l'assertion de `Retry-After` échoue ; (c) `ScimKeyThrottlerGuard` sans test de `isBlocked` : test SCIM par clé échoue ; (d) tentative de contournement : conserver `totalHits > limit` dans le garde SCIM mais ignorer `isBlocked` dans le stockage : le test unitaire du stockage doit l'attraper.

#### A9-b2 : NestJS 11.2.9, Express 5

1. `backend/package.json` : les six paquets `@nestjs/*` 11.2.9 (common, core, platform-express, platform-socket.io, websockets, testing), `@nestjs/cli` 11.0.24, `@nestjs/schematics` 11.1.0, `@types/express` 5.0.6, `@types/node` 22.x, `reflect-metadata` 0.2.2 et `rxjs` 7.8.2 (facultatif, même commit si le lockfile le permet). Garder les épinglages exacts.
2. `pnpm-workspace.yaml` : réécrire la surcharge `body-parser` pour qu'elle ne touche que ce qui demande la 1.x et laisse Express 5 prendre la 2.x, par exemple `'body-parser@<2': '>=1.20.9 <2'` et `'body-parser@>=2': '>=2.2.1 <3'`. **Vérifier** avec `pnpm why body-parser -r` : Express 5 (Nest) en 2.x, `firebase-tools` (Express 4, dev) en 1.20.9. Adapter `tests/unit/dependency-overrides.spec.ts` (clés de surcharge avec sélecteur ; règle « bornées par une version majeure » ; cohérence lockfile) **sans l'affaiblir**. Chaque surcharge vérifiée par `pnpm install --frozen-lockfile` sans avertissement.
3. Code : corriger les erreurs de compilation (R16). Ne **pas** ajouter `app.set('query parser','extended')`. Ne pas convertir de route : aucune n'est concernée (R1). Si une route `*` ou `?` apparaissait entre-temps, utiliser `{*splat}` ou des accolades et l'ajouter au test de table.
4. Lockfile : `pnpm install` puis reformater le lockfile comme aujourd'hui (Prettier) pour garder un diff lisible ; `pnpm install --frozen-lockfile` doit passer ; `allowBuilds` inchangé.
5. Critères : batterie complète ; **e2e = 388 + nouveaux de A9-b0, tous verts** ; jest et vitest sans test retiré ; `nest build`, `tsc -p tests --noEmit`, ESLint, Prettier propres ; table des routes **identique** à celle de A9-b0 ; instantané identique (en-têtes, 401, 404, 429 et `Retry-After`, 413, 400, no-store, CORS) ; `pnpm audit --prod --audit-level=high` : 0 high, **plus d'avis `@nestjs/core`**, aucun nouvel avis (14 attendus d'après l'essai) ; mettre à jour `audit-exceptions.md` ; `pnpm why express -r` : 5.2.1 pour Nest.
6. Essais manuels obligatoires (§7) : démarrage réel, arrêt propre (SIGTERM, aucun handle), WebSocket à deux instances, webhook GitHub réel (« Redeliver »), SCIM avec un client de test.
7. Contre-mutations : (a) surcharge `body-parser` remise à `>=1.20.9 <2` globale : `dependency-overrides.spec.ts` et le démarrage échouent ; (b) `useBodyParser('raw', ...)` retiré : le test `rawBody` du webhook échoue ; (c) `app.set('trust proxy', ...)` retiré : les e2e de limitation par `X-Forwarded-For` échouent ; (d) `app.set('query parser','extended')` ajouté : le test R9 doit rester vert, donc ne détecte pas : **ajouter** un test qui prouve que `req.query` n'est pas imbriqué, puis refaire la mutation ; (e) ordre `registerBodyParsers` après `app.use(helmet())` ou le JSON avant le brut : e2e webhook échoue.

#### A9-b3 : `jose` 6.2.17

1. `backend/package.json` : `jose` **6.2.17** (exact). `sso.service.ts` et `oidc.ts` : aucun changement d'import attendu ; `createRemoteJWKSet` garde `timeoutDuration: 5000`. Si `tsc` se plaint des types (`JWTVerifyGetKey`, génériques), corriger sans `any`.
2. Jest (unitaire **et** `jest-e2e.json`, qui charge l'application complète) : transformer `jose` : `transformIgnorePatterns` qui exclut de l'ignorance le chemin réel pnpm (`.../.pnpm/jose@<version>/node_modules/jose/`), `ts-jest` avec `allowJs` pour ce paquet seulement (tsconfig de test dédié si besoin, sans élargir `include`). Sonde validée sur copie avec le motif `/node_modules/(?!(\.pnpm/)?jose/)` pour `node_modules/jose` direct ; **à ajuster pour la disposition pnpm** et à prouver : `tests/unit/auth/sso-oidc.spec.ts` doit passer **sans** `jest.mock('jose')`. Un `moduleNameMapper` vers un adaptateur de test qui réexporte `jose` n'est **pas** acceptable (il masquerait le vrai paquet) ; si la transformation s'avère fragile, s'arrêter et consulter l'architecte.
3. Node : le `require('jose')` émis par `tsc` (module `commonjs`) exige `require(esm)` : Node ≥ 20.19 ou ≥ 22.12 (acquis par A9-b0). Contrôle en image de production : `docker run --rm <image-backend> node -e "const j=require('jose'); console.log(typeof j.jwtVerify, typeof j.createRemoteJWKSet)"` doit afficher `function function`, **sans avertissement bloquant** (un `ExperimentalWarning` éventuel est consigné). L'application ne passe pas en ESM : hors périmètre.
4. Tests SSO OIDC (JWKS local, clé injectée par `OidcKeySource`) : jeton valide accepté ; refusés : `alg: none`, `HS256` signé avec la clé publique, mauvais `iss`, mauvais `aud`, `exp` passé au-delà de 60 s, `iat` manquant, `nonce` absent ou différent, clé inconnue (`kid`), JWKS injoignable (délai 5 s : 401 générique et non 500). Test spécifique 6.x : une **redirection** du JWKS est refusée.
5. Critères : batterie complète ; suites SSO vertes **sans** `jest.mock('jose')` ; `pnpm audit` sans nouvel avis ; connexion SSO OIDC de bout en bout sur un IdP de test ou un espace pilote (Google ou Azure AD, tenant GUID) : succès, puis échecs attendus (nonce rejoué, mauvais tenant). Les sessions déjà ouvertes ne sont pas touchées (jetons `@nestjs/jwt`).
6. Contre-mutations : (a) retirer `algorithms: ['RS256']` : le test `HS256`/`none` échoue ; (b) retirer `audience` ou `issuer` : le test correspondant échoue ; (c) retirer la vérification `nonce` : échoue ; (d) tentative de contournement : supprimer la transformation Jest de `jose` : les suites SSO doivent **échouer** (et non être ignorées) ; (e) `clockTolerance` à 3 600 : le test d'expiration échoue.

#### A9-b4 : documentation et clôture

`docs/security/audit-exceptions.md` (retirer `@nestjs/core`, réévaluer `uuid`, date de revue), `docs/security/ci.md` (Node 22), `docs/security/journal-corrections.md` (section `## Lot A9-b (fixeur)` avec les chiffres et les instantanés), mention de la décision Node et de l'écart `uuid`. Le rapport est mis à jour par l'architecte à la revue.

### 6. Pièges connus de l'outillage

- **Lockfile formaté** : le `pnpm install --lockfile-only` d'essai a réécrit le fichier avec le formatage natif de pnpm, alors que le lockfile du dépôt a des blocs `resolution: {` répartis sur plusieurs lignes. Après chaque `pnpm install`, rejouer Prettier sur `pnpm-lock.yaml` si le dépôt le fait pour ce fichier (vérifier `.prettierignore` et `git diff --stat` : un diff de milliers de lignes de formatage est à écarter) ; `--frozen-lockfile` valide dans les deux cas.
- **Surcharge `body-parser`** : voir A9-b2, point 2. C'est le piège principal : la surcharge globale `<2` serait appliquée à Express 5.
- **`firebase-tools`** (devDep.) garde Express 4.22.1 et une `jose` 6 : sans effet en production ; `pnpm audit --prod` ne les couvre pas.
- **`peerDependencies`** : `@firebase/rules-unit-testing` 6.0.0 attend `firebase@^13` (avertissement déjà présent, hors sujet).
- **Prisma, ioredis, redis, socket.io-client** : ne pas les monter dans ce lot.

### 7. Contre-vérifications obligatoires (en plus des contre-mutations par sous-lot)

1. **Table des routes** identique avant et après (R1, R2).
2. **Instantané comportemental** identique avant et après (§5).
3. **Arrêt propre** : `SIGTERM` sur l'application réelle, journaux sans erreur, processus terminé ; e2e `o22-shutdown` avec `--detectOpenHandles` (R7).
4. **WebSocket** : connexion avec `socket.io-client` 4.7.5 (version du frontend), jeton refusé sans authentification, diffusion de salle à travers **deux instances** reliées au même Redis.
5. **Webhook GitHub réel** sur un projet de test : livraison signée acceptée, « Redeliver » depuis GitHub, signature altérée 401, trois formes de chemin (R2).
6. **SCIM** : un client de test (ou l'IdP de pilote) : création, `PATCH active`, suppression, 429 par clé avec `Retry-After`.
7. **429** : pour chaque famille (global, par route, verrouillage de compte, SCIM par clé, pré-contrôle du webhook) : statut, corps, `Retry-After` entier, identiques à l'instantané de référence.
8. **Proxy** : `TRUST_PROXY_HOPS` de production inchangé ; deux `X-Forwarded-For` forgés ne changent pas l'adresse retenue (R5).
9. **Audit** : `pnpm audit --prod --audit-level=high` sans avis high ; liste complète des avis comparée à la baseline (§2) : seuls disparaissent `@nestjs/core` et le `uuid` de `@nestjs/config`.
10. **Lockfile** : `pnpm install --frozen-lockfile` sur un clone propre ; `pnpm why express body-parser jose path-to-regexp -r` joint au journal.

### 8. Risques de déploiement, retour arrière

| Risque | Gravité | Parade |
| --- | --- | --- |
| Limiteur muet (stockage non adapté, R3) : plus aucun 429 | Critique | Test `isBlocked` et e2e `rate-limits` ; contrôle manuel du 429 après déploiement ; A9-b1 déployé **seul** d'abord |
| Webhook GitHub en échec (corps brut, plafond, casse) | Majeur | Tests R2 et R6 ; vérifier « Recent Deliveries » après déploiement |
| Compteurs de limitation remis à zéro au déploiement (clés SHA-256 en 6.2.0) | Faible | Accepté : une minute d'allocation neuve, éviter de déployer pendant un incident d'abus |
| Connexion SSO OIDC cassée (`jose` 6, `fetch`, redirection JWKS refusée) | Majeur pour les clients SSO | A9-b3 déployé seul, essai IdP réel avant, retour arrière limité à ce sous-lot |
| Arrêt avec connexions Redis ou Prisma non fermées (ordre inverse des hooks) | Moyen | `o22-shutdown`, SIGTERM réel |
| Node 22 : binaire natif (`argon2`, Prisma) incompatible sur Alpine | Moyen | Construire et lancer l'image en A9-b0 avant tout autre changement |
| Régression d'en-têtes de sécurité non vue (R11) | Majeur | Test d'en-têtes A9-b0 et instantané |
| Dépendance : avis nouveau sur Express 5.2.1, `body-parser` 2.4.0, `path-to-regexp` 8.4.2 | À mesurer | `pnpm audit` avant chaque déploiement ; lancer aussi l'audit complet (pas seulement `--prod`) |

**Conditions de déploiement.** (1) Prérequis : CI verte sur **tous** les jobs ; le lot P7-b à P7-e et la migration `20261117000000_n6_sso_client_secret_text` déjà en production et observés (sauvegarde `mysqldump` complète avant cette migration). (2) Aucune migration Prisma dans A9-b, aucune variable nouvelle, **aucun changement de proxy** (`ekose-nginx-1` inchangé ; en cas d'intervention sur lui, `docker restart` et non `reload`). (3) Déployer **un sous-lot à la fois** (A9-b0 avec A9-b1 acceptable ensemble ; A9-b2 seul ; A9-b3 seul), chacun observé au moins 24 h : taux de 5xx, taux de 429, livraisons de webhook, connexions SSO, journaux de démarrage et d'arrêt. (4) Avant chaque déploiement : étiqueter l'image de production en cours (par exemple `planner-backend:pre-a9b-N`) pour un retour immédiat. (5) Après déploiement : `GET /features` 200 ; en-têtes de l'API (Helmet) présents ; `POST /auth/login` en échec répété : 429 avec `Retry-After` ; une livraison de webhook de test ; une connexion SSO de test (A9-b3) ; un client WebSocket.

**Retour arrière.** Image précédente (étiquette ci-dessus) : aucune donnée n'est migrée par A9-b, donc retour **sans effet de données**. Redis : les clés de limitation changent de forme (6.2.0) ; au retour les anciennes clés réapparaissent, sans conséquence au-delà d'une fenêtre de 60 s. Les sessions (jetons `@nestjs/jwt`, cookies) restent valables dans les deux sens ; les WebSocket se reconnectent. Un retour partiel est possible par sous-lot (b3 seul, puis b2, puis b1) parce que chaque commit passe isolément. **Ne jamais** revenir sur le lockfile à la main : réutiliser le commit précédent.

**Connu et accepté après A9-b** : NestJS 11 est en maintenance (étiquette `legacy`), NestJS 12 est la ligne courante : prévoir un lot A9-c (ESM, TypeScript 6, Jest 30 ou Vitest, ordre des hooks) à planifier, sans urgence ; Jest 29 reste, avec la transformation de `jose` ; `uuid@9.0.1` transitif (`google-gax`) et l'outillage Prisma (`hono`) restent en exception.

### 9. Ordre d'exécution pour le `fixeur`

1. **A9-b0** (tests de caractérisation, table des routes, Node 22, images) : doit être vert sur la pile actuelle.
2. **A9-b1** (`throttler` 6, `config` 4, `jwt` 11 sur NestJS 10).
3. **A9-b2** (NestJS 11, Express 5, surcharge `body-parser`, types).
4. **A9-b3** (`jose` 6, transformation Jest).
5. **A9-b4** (documentation).
6. Journal `## Lot A9-b (fixeur)`, statut `CORRIGÉ – À REVOIR` par sous-lot ; l'architecte revoit sous-lot par sous-lot (une revue par commit).
Les constats ouverts précédents (r55-a1, A8 avec O-b et O-e, P2, reliquats) ne sont pas modifiés par cette spécification.

## Revue r56 (architecte) : sous-lot A9-b0 (tests de caractérisation, table des routes, Node 22) : VALIDÉ, un Mineur, une reclassification (O23) et deux Améliorations (non bloquants)

**Verdict global : VALIDÉ, feu vert de commit.** Le câblage partagé est strictement équivalent à l'ancien `main.ts` (même ordre, même contenu), les 388 e2e existants passent avec Helmet et CORS, les 16 nouveaux tests sont de vraies caractérisations (statuts, en-têtes, corps, limites, signature HMAC sur les octets reçus), l'instantané de référence est relu, la table des routes est identique à celle de l'image Node 22. Le sous-lot est un préalable sûr à A9-b1 et A9-b2. Je relève un trou de couverture (r56-m1 : l'anti-CSRF `originCheckMiddleware` n'est protégé par aucun test de comportement) et je **reclasse O23 en Mineur** (SIGTERM ignoré, voir les réponses). Les deux sont à traiter dans un petit sous-lot **A9-b0b avant A9-b2**, sans bloquer le commit de A9-b0.

| Point | Verdict |
| --- | --- |
| A9-b0-1 (câblage partagé, 14 tests de caractérisation, `expectRetryAfter`) | **VALIDÉ** : 8 contre-mutations propres détectées ; une mutation **non détectée** (r56-m1) |
| A9-b0-2 (table des routes, 148 routes) | **VALIDÉ** : table figée par test, contrôle de la syntaxe Express 5 (`* ? + ( ) [ ]`) |
| A9-b0-3 (Node 22, engines, `@types/node` 22) | **VALIDÉ** : voir les conditions de déploiement ; deux reliquats de documentation (r56-a1) |

### Vérifications indépendantes (MySQL 8.0 et Redis 7 jetables `r56-mysql` et `r56-redis`, supprimés ; Node 24.16 local)
- e2e `--runInBand --detectOpenHandles` : 10 suites, **404/404** (388 + 14 + 2), aucun handle ouvert, avec un `.env` local présent (les variables épinglées de l'instantané jouent leur rôle). Jest unitaire (`env -u DATABASE_URL -u E2E_DATABASE_URL`) : 109 suites, **2 997/2 997**. `nest build` OK ; `tsc -p tests --noEmit` OK ; ESLint 0 erreur, 15 avertissements préexistants ; Prettier propre (`src`, `tests`, `.github`, `package.json`) ; vitest 34 fichiers, **296/296**. Chiffres du journal confirmés.
- **Relecture du diff** : `main.ts` ne fait plus qu'appeler `configureHttpApp(app)` et garde `rawBody: true` ; `configure-http-app.ts` reprend l'ancien bloc à l'identique (proxy de confiance, analyseurs, Helmet, no-store, pipe, cookies, anti-CSRF, CORS, garde `CORS_ORIGINS` en production) ; `e2e-app.ts` l'appelle avec `{...process.env, TRUST_PROXY_HOPS}` (la valeur par défaut `process.env` de `main.ts` est équivalente). `package.json` racine et backend : `engines >=22.12` ; lockfile : renommage `@types/node` 20.3.1 vers 22.20.5 et lignes dérivées seulement (un `deprecated:` ajouté par pnpm sur un paquet polyfill transitif, sans effet).
- **Contre-mutations** (sauvegarde, restauration par `\cp -f`, `cmp` identique à chaque fois) :
  1. `WEBHOOK_PATH` sans drapeau `i` : détectée (2 échecs sur 30 : caractérisation et webhook-scim).
  2. Plafond du webhook `2mb` ramené à `1mb` : détectée (1 échec : corps de 1,5 Mo).
  3. `app.use(helmet())` retiré : détectée (2 échecs sur 14 : en-têtes et instantané).
  4. `app.use(noStoreMiddleware())` retiré : détectée (2 échecs sur 14).
  5. `Retry-After` multiplié par 1000 dans le filtre : détectée (3 échecs sur 20, par la borne de `expectRetryAfter`).
  6. CORS `origin: true` (toute origine reflétée) : détectée (2 échecs sur 14).
  7. **`app.use(originCheckMiddleware())` retiré : NON détectée** (404/404 e2e verts ; seul le test de texte `main-hardening.spec.ts` l'attraperait, il ne prouve rien du comportement) : r56-m1.
  8. Contournement des tests de garde : `// app.use(noStoreMiddleware());` en commentaire dans `configure-http-app.ts` : les trois tests de texte restent **verts** (22/22), mais l'e2e no-store échoue (mutation 4). Les tests de texte sont donc un complément d'ordre, pas une garde ; le vrai filet est l'e2e sur le câblage réel. `main.ts` sans l'appel `configureHttpApp(app);` : détectée (3 échecs unitaires).
- **Incident de ma revue, sans effet sur le dépôt** : une première série de contre-mutations a écrasé par erreur `configure-http-app.ts` (fichier non suivi) et `retry-after.filter.ts` avec le contenu d'une sauvegarde périmée (alias `cp -i` interactif). `retry-after.filter.ts` a été restauré par `git checkout` (aucune modification préexistante). `configure-http-app.ts` a été **réécrit à l'identique à partir de ma lecture intégrale** faite avant l'incident, et contrôlé : `tsc` du build vers un répertoire temporaire, **tous les `.js` produits ont la même empreinte MD5 que `dist/` compilé avant l'incident** ; Prettier propre ; 404/404 rejoués après restauration pour les mutations suivantes. Le fixeur peut vérifier `git status` : le fichier reste non suivi, contenu logiquement inchangé.
- **Limite** : je n'ai **pas** rejoué les e2e sous Node 22 (le tirage de l'image `node:22` Debian a dépassé mon délai ; Node 22 testé uniquement par `node:22-alpine` pour l'observation SIGTERM, ci-dessous). La preuve Node 22 repose sur le journal du fixeur (image construite, `dist/main` démarré, 148 routes identiques, `argon2` et Prisma chargés) et sur le job CI `e2e` (Node 22), **qui doit être vert avant déploiement**. `pnpm audit` non rejoué (réseau) ; la valeur du journal est cohérente avec ma spécification (aucun lien avec ce sous-lot, seul `@types/node` bouge).

### Relecture ciblée
- **Caractérisation fidèle** : le test « corps brut conservé » signe le corps formaté (4 espaces) et refuse la signature du corps compact : c'est la bonne preuve de `rawBody` (et non du JSON ré-sérialisé). Les trois formes de chemin (`/projects/<id>/webhooks/github`, avec barre finale, `/Projects/<id>/WEBHOOKS/GitHub/`) sont couvertes pour 201, 1,5 Mo, 413 à 2,5 Mo, 401 et 429 du pré-contrôle : R2 est réellement prouvé. Le 413 à 2,5 Mo n'échoue pas par hasard de signature (corps non JSON brut, signé).
- **Instantané** : 14 réponses, `Date`/`ETag`/`Retry-After`/`X-RateLimit-Reset` normalisés, variables d'environnement épinglées. Dépendances de plateforme : `connection: keep-alive` et `keep-alive: timeout=5` figés ; identiques sous Node 22 et 24 (valeurs par défaut du serveur HTTP) ; si le job CI `e2e` (Node 22) échouait sur l'instantané, regarder ces deux lignes en premier. Les `X-RateLimit-*` (noms et valeurs) **changeront volontairement** en A9-b1 (throttler 6) : régénérer par `A9B0_WRITE_SNAPSHOT=1` **et relire le diff ligne à ligne**, jamais en aveugle.
- **R4** : quatre familles de 429 portent une valeur de `Retry-After` assertionnée (limiteur global, route publique, verrouillage de compte, SCIM par clé) ; le helper n'affaiblit aucune assertion (avant : `> 0` ou `toBeTruthy`).
- **Défaut de conception sans gravité relevé en lisant `origin-guard.ts:20`** : `EXEMPT_PATHS` est sensible à la casse alors que le routage ne l'est pas (`/Projects/<id>/WEBHOOKS/GitHub/` n'est pas exempté). Sans conséquence (échec fermé, et GitHub n'envoie pas de cookie) ; à figer dans le test de r56-m1 pour qu'A9-b2 ne le change pas sans le savoir.

### Constats
**r56-m1 (Mineur) : l'anti-CSRF par `Origin` (S29, `originCheckMiddleware`) n'est couvert par aucun test de comportement sur l'application câblée.** Contre-mutation 7 : retirer `app.use(originCheckMiddleware())` de `configure-http-app.ts` laisse 404/404 e2e verts. Avant A9-b0 c'était vrai aussi (l'e2e le branchait, sans le tester) ; maintenant que le câblage réel est monté, l'ajout coûte peu et A9-b2 touche précisément ce terrain (middlewares Express 5, `req.path`, ordre des analyseurs). Remédiation (dans `a9b0-http-characterization.e2e-spec.ts` ou une suite voisine) : avec un en-tête `Cookie` portant un nom de `SESSION_COOKIE_NAMES` (valeur quelconque) sur une route à effet non exemptée (par exemple `POST /auth/logout` ou `POST /auth/refresh`) : sans `Origin` ni `Referer` : **403** `Origine de la requête non autorisée.` ; `Origin` inconnue : 403 ; `Origin` autorisée : pas 403 (401 attendu, cookie invalide) ; `Referer` autorisé sans `Origin` : pas 403 ; `GET` avec cookie sans `Origin` : pas 403 ; chemin exempté (`/projects/<id>/webhooks/github`, `/scim/v2/Users`) avec cookie sans `Origin` : pas 403 ; figer le comportement actuel de `/Projects/<id>/WEBHOOKS/GitHub/` avec cookie et sans `Origin` (403, exemption sensible à la casse). Contre-mutations : retrait de la ligne `app.use(originCheckMiddleware())` ; `candidate && ...` remplacé par `true`. CVSS : non applicable (aucune faille, lacune de filet) ; sévérité Mineur.

**O23 reclassé en Mineur (Amélioration auparavant) : SIGTERM ignoré en production, `docker stop` finit en SIGKILL (code 137).** Voir la réponse « arrêt propre » ci-dessous ; à traiter **avant A9-b2**, dans A9-b0b.

**r56-a1 (Amélioration) : reliquats Node 20 et `@types/node` du frontend.** (1) Commentaire `.github/workflows/ci.yml:219` (« image construite avec pnpm 10 et Node 20 ») périmé ; `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md:110` (« Node.js 20 LTS ») et `:740` (« Image Node.js 20 Alpine ») : à corriger en Node 22 (dans A9-b4, documentation). (2) `frontend/package.json` garde `@types/node` 20.19.41 alors que l'image de build du frontend est en Node 22 : aligner sur 22.x (types seulement) quand le frontend est touché, avec `tsc`/`vite build`/vitest verts ; non bloquant.

**r56-a2 (Amélioration) : borne du `Retry-After` de verrouillage resserrable.** La borne de 24 h est acceptée (réponse 2), mais le premier verrouillage (10 échecs) vaut **exactement 900 s** (`LOCKOUT_BASE_SECONDS`) : `expectRetryAfter(locked, 900)` détecterait aussi une dérive de unité (secondes en minutes : 15 passerait la borne 24 h). À faire en passant, avec une contre-mutation `retryAfterSeconds / 60`.

### Réponses aux questions du fixeur
1. **Déplacement du câblage et modification des trois tests de garde : accepté.** C'est la remédiation que j'avais indiquée (« idéalement extraire le câblage dans une fonction partagée »). Les assertions de fond sont conservées (ordre `trust proxy` puis analyseurs puis origine, `rawBody`, no-store) et `main.ts` est vérifié appeler `configureHttpApp(app)` (la mutation « appel retiré » est détectée). Limite à connaître : ces tests lisent du texte et un commentaire les trompe (contre-mutation 8) ; le filet réel est l'e2e sur le câblage réel. Ne pas en ajouter d'autres du même type.
2. **Borne de 24 h pour le verrouillage : acceptée**, avec resserrage en r56-a2 (900 s pour le premier palier). Mon texte « [1, 60] pour tous » ignorait `LOCKOUT_MAX_SECONDS` : l'écart est justifié, la spécification est amendée en ce sens (60 pour les limiteurs, 24 h au plus pour le verrouillage).
3. **`@types/node` du frontend sur 22 : oui, en Amélioration non bloquante** (r56-a1), hors A9-b0 : types seulement, à vérifier par `tsc` et `vite build`. Pas de lot dédié.
4. **Journal non formaté par Prettier : sans objet.** Prettier n'est pas appliqué aux `docs/` (la version commitée du journal ne passe pas non plus `--check`, et la CI ne vérifie que le code et les fichiers de configuration). Ne pas reformater : le diff du journal deviendrait illisible.
5. **Écarts déclarés** : (1) 201 pour la livraison valide : correct, c'est le statut réel de `@Post` ; accepté. (3) Texte de `?a[b]=1` non assertionné : accepté, le test qui distingue `extended` de `simple` reste dû en A9-b2 (contre-mutation d de ma spécification). (4) `Access-Control-Allow-Credentials: true` sur un CORS refusé : comportement de `cors` 2.8, sans effet sans `Allow-Origin` ; figé par l'instantané, accepté ; à relire dans le diff d'instantané d'A9-b2 (Express 5 / `cors` à jour). (5) 429 du pré-contrôle du webhook sans `Retry-After` : **accepté, ne pas modifier** (réponse volontairement minimale, connexion fermée, sans lecture du corps ; GitHub ne rejoue pas ; RFC 6585 n'exige pas l'en-tête) ; la famille est couverte par l'égalité des trois formes. (6) Instantané en test e2e plutôt qu'en `curl` hors dépôt : **mieux que prévu** (exécuté à chaque batterie, normalisé), accepté. (7) Trois tests de garde : voir 1. (8) Variables épinglées : bonne pratique (ConfigModule charge un `.env` local) ; accepté.
6. **Observation `docker stop` (137) : à traiter avant A9-b2, pas maintenant dans A9-b0, pas en A9-b2.**
   - **Cause confirmée, plus précise que « l'application ignore SIGTERM »** : la commande est `CMD ["node", "dist/main"]`, donc Node est le **processus 1 du conteneur**. Le noyau n'applique pas l'action par défaut des signaux au PID 1 : sans gestionnaire installé, SIGTERM est ignoré. Mesure indépendante sur `node:22-alpine` : un Node nu en PID 1 est tué en SIGKILL (exit 137) après le délai d'arrêt ; avec un simple `process.on('SIGTERM', ...)` il sort en 0 immédiatement. NestJS n'installe de gestionnaire que via `enableShutdownHooks()`. Comportement **préexistant** (Node 20 identique), sans lien avec Node 22 ni avec A9-b0.
   - **C'est O23 de la revue r51**, que j'avais classé Amélioration « à traiter avec A8 ou en exploitation ». Je le **reclasse en Mineur** : à chaque déploiement, le conteneur est tué après le délai d'arrêt (10 s par défaut ; le journal mesure 15 s, la valeur de production n'est pas vérifiée), les requêtes en vol sont coupées (livraisons de webhook, écritures), `onModuleDestroy` (O22 : Prisma, Redis, clients de l'adaptateur Socket.IO) ne s'exécute jamais en production, et A9-b prévoit trois à quatre déploiements espacés de 24 h.
   - **Pourquoi pas dans A9-b0** : le sous-lot est volontairement sans changement de comportement ; ajouter `enableShutdownHooks` y mélangerait un changement d'exploitation à la caractérisation et à Node 22. **Pourquoi pas en A9-b2** : Nest 11 inverse l'ordre des hooks de destruction (R7) ; activer les crochets en même temps rendrait un échec d'arrêt non attribuable. Il faut une **référence d'arrêt propre sur NestJS 10** avant la montée : c'est A9-b0b, qui peut être déployé avec A9-b0 ou A9-b1.
   - **Contenu d'A9-b0b (O23)** : `app.enableShutdownHooks()` dans `main.ts` (pas dans `configureHttpApp`, pour ne pas empiler des écouteurs de signaux à chaque application e2e) ; **borner `quit()`** des clients Redis (`RedisService` et clients pub/sub du gateway) par une course contre 2 s puis `disconnect()` (avec `maxRetriesPerRequest: null`, un `quit()` pendant une panne de Redis peut attendre indéfiniment) ; critères : test qui lance le vrai point d'entrée compilé (`node dist/main`, base et Redis jetables), envoie SIGTERM et exige **code de sortie 0** (pas une mort par signal) en moins de 5 s, y compris avec Redis arrêté ; mesure manuelle sur l'image : `docker stop` en moins de 5 s et code 0, consignée au journal ; contre-mutation : `enableShutdownHooks` retiré, le test échoue (mort par signal ou délai dépassé). Option complémentaire côté exploitation (dépôt ekose) : `init: true` sur le service, indépendant du code. Si le job `e2e` doit construire `dist`, ajouter l'étape `pnpm --filter backend build`.

### Feu vert de commit (chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*`) : 4 commits, dans cet ordre
1. `refactor(backend): câblage HTTP partagé entre main.ts et le banc e2e, Helmet et CORS dans les e2e (A9-b0)` : `backend/src/common/configure-http-app.ts`, `backend/src/main.ts`, `backend/tests/e2e/support/e2e-app.ts`, `backend/tests/e2e/support/e2e-world.ts`, `backend/tests/unit/main-hardening.spec.ts`, `backend/tests/unit/main-raw-body.spec.ts`, `backend/tests/unit/common/no-store.middleware.spec.ts`.
2. `test(security): caractérisation HTTP, table des routes et valeur de Retry-After avant NestJS 11 (A9-b0, R1, R2, R4, R6, R9, R11)` : `backend/tests/e2e/security/a9b0-http-characterization.e2e-spec.ts`, `backend/tests/e2e/security/a9b0-http-snapshot.reference.json`, `backend/tests/e2e/security/a9b0-routes.e2e-spec.ts`, `backend/tests/e2e/security/a9b0-routes.reference.txt`, `backend/tests/e2e/security/auth-session.e2e-spec.ts`, `backend/tests/e2e/security/rate-limits.e2e-spec.ts`, `backend/tests/e2e/security/webhook-scim.e2e-spec.ts`.
3. `build: Node 22 (images, CI, engines, @types/node 22) (A9-b0)` : `.github/workflows/ci.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/Dockerfile.prod`, `package.json`, `backend/package.json`, `pnpm-lock.yaml`.
4. `docs(security): spécification A9-b et revue r56, sous-lot A9-b0 (O23, r56-m1)` : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, `docs/security/ci.md`, en dernier.
Chaque commit passe isolément (le 1 ne dépend que du code existant ; l'instantané du 2 est calculé sur le câblage du 1 ; le 3 ne change que l'outillage). Le commit 3 doit être poussé avec une CI observée verte sur **tous** les jobs, y compris `e2e` et `frontend-headers` en Node 22. Aucune mention d'outil d'assistance ni `Co-Authored-By`.

### Conditions de déploiement du passage à Node 22 (production : 639c5d6 ; la prochaine image de production change de version de Node)
1. **Prérequis** : CI verte sur tous les jobs **sous Node 22** (c'est la première preuve complète des 404 e2e et de l'instantané en Node 22 ; je ne l'ai pas rejouée) ; migration `20261117000000_n6_sso_client_secret_text` et P7-b à P7-e déjà en production et observés (sauvegarde `mysqldump` complète avant la migration N6, conditions de r53 inchangées). Node 20 est en fin de vie (avril 2026) : le passage est justifié ; Node 22 est en maintenance LTS (fin prévue avril 2027, à confirmer) : prévoir Node 24 dans le lot A9-c.
2. **Avant déploiement** : étiqueter l'image backend en cours (par exemple `planner-backend:pre-a9b-0`) et l'image frontend ; reconstruire **sans cache de couches** (`--no-cache`) pour que `node:22-alpine` soit réellement tiré et que `argon2` et le client Prisma soient reconstruits sous Node 22 (le tag `22-alpine` est flottant ; épingler par empreinte est une option, non requise).
3. **Migration** : aucune. **Aucune** variable nouvelle, **aucun changement de proxy** (`ekose-nginx-1` inchangé ; en cas d'intervention, `docker restart` et non `reload`). Dépendances : `@types/node` seulement (types, sans effet à l'exécution).
4. **Vérifications après déploiement** : `docker exec <backend> node -v` affiche v22.x ; journaux de démarrage sans erreur ni avertissement inattendu (table de 148 routes) ; `GET /features` 200 avec les en-têtes Helmet ; **une connexion réelle avec un compte existant** (le journal prouve que `require('argon2')` charge, pas que la vérification d'un hash existant fonctionne sous Node 22 Alpine : c'est le vrai test du binaire natif) ; `POST /auth/login` en échec répété : 429 avec `Retry-After` ; une livraison de webhook de test (201) ; un client WebSocket ; page frontend et en-têtes (job `frontend-headers`) ; taux de 5xx et de 429 comparés à l'avant, observés au moins 24 h.
5. **Rollback** : remettre l'image précédente (étiquette ci-dessus), sans effet de données (aucune migration, aucun format de session modifié).
6. **Connu et accepté** : `docker stop` finit en 137 tant qu'A9-b0b n'est pas déployé (O23) : le déploiement coupera les requêtes en vol et durera le délai d'arrêt ; à faire hors pointe. r56-m1, r56-a1, r56-a2 ouverts, sans risque d'exploitation.

### Ordre des constats ouverts (fin de r56)
1. **A9-b0b (avant A9-b2)** : **r56-m1** (test de comportement de l'anti-CSRF) et **O23** (reclassé Mineur : `enableShutdownHooks`, `quit()` borné, test de sortie propre sur SIGTERM, mesure `docker stop`). Peut être commité et déployé avec A9-b0 ou A9-b1.
2. **A9-b1** (throttler 6, config 4, jwt 11 sur NestJS 10), **A9-b2** (NestJS 11, Express 5), **A9-b3** (`jose` 6), **A9-b4** (documentation, y compris **r56-a1**), puis **A8** (y inclure O-b et O-e), puis **P2**. Spécification A9-b : amendement de la borne `Retry-After` (24 h pour le verrouillage), seule modification.
3. Améliorations : **r56-a1**, **r56-a2**, r55-a1, r53-a1, r53-a2, O-f, O-a, r48-a1, r48-a2.
4. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
5. Actions d'exploitation : sauvegarde avant migration, comparaison complète du schéma de production, vérifications GitHub requises, confirmation de `TRUST_PROXY_HOPS` de production (O-c), valeur du délai d'arrêt du conteneur backend (O23).
6. Clos par cette revue : A9-b0-1, A9-b0-2, A9-b0-3 (VALIDÉS).


---

## Revue r57 (architecte) : sous-lot A9-b0b (arrêt propre sur SIGTERM, test anti-CSRF par Origin) : VALIDÉ, un Mineur et deux Améliorations (non bloquants)

**Verdict global : VALIDÉ, feu vert de commit.** O23 est réellement corrigé (le processus réel `dist/main` sort en code 0 sur SIGTERM en 0,1 à 0,2 s, WebSocket et adaptateur Redis fermés, Redis coupé borné à 2 s) et r56-m1 est couvert par un vrai test de comportement. Les gardes du test O23 laissent toutefois survivre quatre mutations (double signal, délai de 8 s, sortie explicite, branchement de `RedisService`) : r57-m1, à solder avant A9-b2.

| Point | Verdict |
| --- | --- |
| O23 (`installShutdownSignals`, `quitWithin`, test `o23-sigterm`, build dans le job e2e) | **VALIDÉ** : écart de moyen accepté (réponse 1) ; garde incomplète, voir r57-m1 |
| r56-m1 (`origin-csrf.e2e-spec.ts`, 15 tests) | **VALIDÉ** : 7 contre-mutations propres sur 7 détectées |

### Vérifications indépendantes (MySQL 8.0 et Redis 7 jetables `r57-mysql` et `r57-redis`, supprimés ; Node 24.16 local)
- e2e `--runInBand --detectOpenHandles` : 12 suites, **421/421**. Jest unitaire (`env -u DATABASE_URL -u E2E_DATABASE_URL`) : 110 suites, **3 001/3 001**. `nest build` OK, `tsc -p tests --noEmit` OK, ESLint 0 erreur (15 avertissements préexistants), Prettier propre (`src`, `tests`, `ci.yml`), vitest 34 fichiers, **296/296**. Conforme aux chiffres annoncés.
- **Comportement du processus réel** (`node dist/main.js`, sondes jetables hors dépôt) : SIGTERM nu : sortie 0 en 217 ms ; **SIGTERM, SIGINT puis SIGTERM à 50 et 100 ms : un seul message « arrêt en cours », un seul `close()`, sortie 0 en 188 ms** ; connexion HTTP keep-alive inactive : sortie 0 en 66 ms ; **client Socket.IO connecté : déconnecté puis sortie 0 en 78 ms** ; **requête en vol jamais terminée (corps incomplet) : `close()` attend, puis sortie en code 1 à 8,06 s** (filet), jamais de SIGKILL tant que le délai d'arrêt du conteneur dépasse 8 s. Le serveur Socket.IO ne envoie pas de paquet de déconnexion à l'arrêt (`io.close()` ferme les transports) : le client voit une coupure de transport et se reconnecte, donc pas de régression de reconnexion côté navigateur (la déconnexion « io server disconnect » observée avec mon client sans cookie vient du refus d'authentification du passerelle, identique avec SIGKILL).
- **Contre-mutations O23** (sauvegarde, `\cp`, `cmp` identique, reconstruction à chaque fois) :
  1. `installShutdownSignals(app)` remplacé par `app.enableShutdownHooks()` : détectée (2 échecs sur 2, signal au lieu du code 0).
  2. `quit()` du gateway sans borne : détectée (cas Redis injoignable, 10,7 s).
  3. Borne de `quitWithin` portée à 600 000 ms : détectée (1 échec sur 2).
  4. `process.exit(0)` retiré : **NON détectée** (le processus sort seul une fois tout fermé).
  5. `quit()` de `RedisService` sans borne : **NON détectée** (e2e vert ; la reconnexion d'ioredis fait échouer `quit()` assez vite dans ce scénario).
  6. Garde du double signal (`if (closing) return`) retirée : **NON détectée**.
  7. Filet de 8 s retiré : **NON détectée**.
- **Contre-mutations r56-m1** : retrait de `app.use(originCheckMiddleware())` (confirmé par le fixeur : 10 échecs sur 15) ; `PATCH` retiré de la liste des méthodes : 1 échec ; le `Referer` prime sur l'`Origin` : 1 échec ; origine vide acceptée : 9 échecs ; `__Host-accessToken` retiré des noms de cookies : échecs ; `__Secure-refreshToken` retiré : échecs ; exemptions webhook/SCIM élargies (journal du fixeur, relues dans le test) : détectées. Aucune mutation survivante. Restauration vérifiée par `cmp` pour chaque fichier.
- Non rejoué : `docker stop` sur l'image Node 22 (mesures du fixeur : 0,3 s, et 2,3 s avec Redis arrêté, code 0, crédibles au vu de mes mesures du processus réel) ; le job CI `e2e` (Node 22) doit le confirmer.

### Relecture ciblée
- `shutdown-signals.ts` : `closing` empêche le double `close()` ; `process.exit(0)` seulement après `app.close()` (donc après `onModuleDestroy` : Prisma, Redis, adaptateur) ; échec du `close()` ou 8 s : code 1 ; le minuteur est `unref()`. Correct. Pas de `enableShutdownHooks()` en parallèle : ne **jamais** le rajouter à côté (NestJS se renverrait le signal, 143, et un second `close()` s'ajouterait).
- `quitWithin` : course `quit()` contre 2 s puis `disconnect()`, ne lève jamais, minuteur nettoyé. Correct. Le plafond total de l'arrêt reste 8 s (deux clients de l'adaptateur et le client Redis se ferment en parallèle ou en série, au plus 2 s chacun).
- Requêtes en vol : `app.close()` arrête d'accepter les connexions, ferme les connexions inactives et **attend la fin des requêtes actives** (jusqu'à 8 s) ; au-delà, sortie en code 1 et la requête est coupée. C'est le bon comportement, il n'était pas documenté : r57-a1.
- Redémarrage : `docker-compose.prod.yml` utilise `restart: unless-stopped` et `docker-compose.yml` `always` ; ces deux politiques redémarrent après toute sortie, code 0 compris, sauf arrêt demandé par `docker stop`, ce qui est voulu. Avec `on-failure`, un code 0 ne redémarrerait pas : ne pas changer de politique sans le savoir.
- Nest 11 (A9-b2) : `app.close()` exécute les mêmes crochets, dans l'ordre inverse. Notre gestionnaire ne dépend pas de `enableShutdownHooks()`, donc l'inversion ne change que l'ordre de destruction (Redis, passerelle, Prisma) ; `o22-shutdown` et `o23-sigterm` sont les références à rejouer à ce moment.

### Constats
**r57-m1 (Mineur) : les gardes de l'arrêt laissent survivre quatre mutations.** Voir contre-mutations 4 à 7. Remédiation attendue, avant A9-b2 (qui inverse l'ordre des hooks) :
1. Test e2e (ou unitaire de `installShutdownSignals` avec une fausse application et un `process.exit` espionné) : **SIGTERM puis SIGINT rapprochés ne provoquent qu'un seul `close()`** ; contre-mutation : retirer `if (closing) return`.
2. Test du **filet de 8 s** : une connexion HTTP au corps incomplet maintenue ouverte ; attendre une sortie en code 1 entre 7 et 10 s (ou, en unitaire, `jest.useFakeTimers` sur `SHUTDOWN_DEADLINE_MS`) ; contre-mutation : retirer le minuteur, ou le porter à 600 000 ms. 
3. `process.exit(0)` explicite : espion unitaire (`exit` appelé avec 0 après `close()` résolu, avec 1 après rejet) ; contre-mutation : `() => undefined`.
4. Branchement de `RedisService.onModuleDestroy` sur `quitWithin` : test unitaire avec un faux client dont `quit()` ne se résout jamais (fausses minuteries) : `disconnect()` est appelé après 2 s ; contre-mutation : `await client.quit()` direct.

**r57-a1 (Amélioration) : documenter le comportement d'arrêt.** Dans `docs/security/ci.md` ou la documentation d'exploitation : SIGTERM/SIGINT, `close()` attend les requêtes en vol jusqu'à 8 s puis code 1, `quit()` Redis borné à 2 s, WebSocket coupés (les clients se reconnectent), exigence **`stop_grace_period` du conteneur backend > 8 s** (défaut 10 s ; ne pas le réduire), pas de `enableShutdownHooks()` à côté, `init: true` non nécessaire.

**r57-a2 (Amélioration) : le test O23 lance `dist/main.js` sans vérifier sa fraîcheur.** En local, un `dist` périmé donne un résultat trompeur (la CI le reconstruit, donc sans risque en CI). Option : comparer `mtime` de `dist/main.js` à `src/main.ts` et `src/common/shutdown-signals.ts`, ou documenter « `pnpm build` avant `jest-e2e` » dans `docs/security/ci.md` (ligne 24).

### Réponses aux questions du fixeur
1. **`installShutdownSignals` à la place de `enableShutdownHooks()` : accepté.** Sous NestJS 10, `enableShutdownHooks()` se renvoie le signal (code 143) ; mon critère était le code 0, que la remédiation d'origine ne tenait pas : l'écart est justifié et la remédiation de O23 est amendée en ce sens. Nest 11 : sans effet sur ce choix (voir relecture) ; l'ordre inversé des crochets se vérifie avec `o22` et `o23`. 
2. **Build dans le job e2e : accepté.** L'étape précède les tests ; le coût est de quelques secondes. Ne pas la déplacer après les tests.
3. **`init: true` : non nécessaire, d'accord.** Node installe lui-même le gestionnaire ; `init` ne ferait qu'ajouter la récolte des zombies, sans objet ici.
4. **Écart sur logout (204 public)** : accepté, `refresh` couvre le passage ; aucun changement de remédiation.

### Feu vert de commit (chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*`) : 4 commits, dans cet ordre
1. `feat(backend): arrêt propre sur SIGTERM et SIGINT, fermeture bornée des clients Redis (O23)` : `backend/src/common/shutdown-signals.ts`, `backend/src/common/bounded-quit.ts`, `backend/src/main.ts`, `backend/src/redis/redis.service.ts`, `backend/src/tracking/tracking.gateway.ts`, `backend/tests/unit/common/bounded-quit.spec.ts`.
2. `test(security): sortie en code 0 du processus réel sur SIGTERM, build dans le job e2e (O23)` : `backend/tests/e2e/security/o23-sigterm.e2e-spec.ts`, `.github/workflows/ci.yml`.
3. `test(security): anti-CSRF par Origin sur l'application câblée (r56-m1)` : `backend/tests/e2e/security/origin-csrf.e2e-spec.ts`.
4. `docs(security): revue r57, sous-lot A9-b0b (O23, r56-m1)` : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, en dernier.
Chaque commit passe isolément (le 2 suppose le 1 et exige `dist` construit, ce que fait la CI ; le 3 ne dépend que du code existant). Aucune mention d'outil d'assistance ni `Co-Authored-By`. Le commit `.github/workflows/ci.yml` d'A9-b0 (Node 22) est déjà en historique : le fichier ne porte ici que l'étape de build.

### Conditions de déploiement : A9-b0 (Node 22) et A9-b0b (arrêt propre) ensemble
1. **Prérequis** : CI verte sur **tous** les jobs sous Node 22, y compris `e2e` (qui construit désormais `dist` et lance `o23-sigterm`) et `frontend-headers` ; c'est la première exécution complète en Node 22 (je n'ai pas rejoué sous Node 22). Commits 1 à 4 de r56 et de r57 poussés ; migration N6 et P7-b à P7-e déjà en production ; **`mysqldump` complet avant** (conditions de r53 inchangées, A9-b0/b0b n'ajoutent aucune migration).
2. **Avant** : étiqueter les images backend et frontend en cours (`planner-backend:pre-a9b-0`) ; reconstruire **sans cache de couches** (`--no-cache`) pour tirer `node:22-alpine` et reconstruire `argon2` et Prisma sous Node 22. Contrôler le `stop_grace_period` du service backend : doit être **absent (10 s) ou > 8 s**. Aucune variable nouvelle, aucune dépendance runtime nouvelle, aucun changement de proxy (`ekose-nginx-1` inchangé ; en cas d'intervention, `docker restart` et non `reload`). Politique de redémarrage : garder `unless-stopped` (prod) / `always`.
3. **Déploiement** : hors pointe. **Le déploiement qui remplace l'ancienne image dure encore le délai d'arrêt et finit en 137** (l'ancien processus ignore SIGTERM) et coupe les requêtes en vol ; l'arrêt propre ne joue qu'à partir du déploiement suivant. Les clients WebSocket sont coupés et se reconnectent.
4. **Vérifications après déploiement** : `docker exec <backend> node -v` affiche v22.x ; journaux de démarrage sans erreur (table de 148 routes) ; `GET /features` 200 avec les en-têtes Helmet ; **une connexion réelle avec un compte existant** (vérification d'un hash argon2 existant sous Node 22 Alpine) ; WebSocket opérationnel. Sur la préproduction, ou à la prochaine redéploiement : `docker stop` (ou `docker compose stop backend`) dure **moins de 3 s** et `docker inspect -f '{{.State.ExitCode}}' <backend>` renvoie **0** ; les journaux montrent « SIGTERM reçu : arrêt en cours. » ; le conteneur est redémarré par la politique au `up`. Une sortie en 137 ou en code 1 est un signal d'alarme (requête en vol bloquante, ou Redis).
5. **Rollback** : remettre l'image étiquetée `pre-a9b-0` ; aucune donnée ni format de session modifié, aucune migration.
6. **Connu et accepté** : r57-m1 (gardes à compléter avant A9-b2), r57-a1, r57-a2 ouverts, sans risque d'exploitation ; une requête en vol de plus de 8 s est coupée à l'arrêt (code 1, redémarrage automatique) ; O23 est soldé côté code, sa preuve en exploitation viendra au deuxième déploiement ; la valeur du `stop_grace_period` de production n'est pas vérifiée.

### Ordre des constats ouverts (fin de r57)
1. **r57-m1** (tests de garde de l'arrêt) : avant A9-b2, peut être traité dans A9-b1 ; r57-a1, r57-a2 en passant.
2. **A9-b1** (throttler 6, config 4, jwt 11 sur NestJS 10), **A9-b2** (NestJS 11, Express 5 ; rejouer `o22` et `o23`), **A9-b3** (`jose` 6), **A9-b4** (documentation, y compris r56-a1), puis **A8** (y inclure O-b et O-e), puis **P2**.
3. Améliorations : r57-a1, r57-a2, r56-a1, r56-a2, r55-a1, r53-a1, r53-a2, O-f, O-a, r48-a1, r48-a2.
4. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
5. Actions d'exploitation : sauvegarde avant migration, comparaison complète du schéma de production, vérifications GitHub requises, confirmation de `TRUST_PROXY_HOPS` de production (O-c), valeur du `stop_grace_period` du conteneur backend (O23, doit rester > 8 s).
6. Clos par cette revue : O23 et r56-m1 (VALIDÉS).

## Revue r58 (architecte) : sous-lot A9-b1 (`@nestjs/throttler` 6.7.1, `@nestjs/config` 4.0.4, `@nestjs/jwt` 11.0.2 ; r57-m1, r57-a1, r57-a2) : VALIDÉ, un Mineur et une Amélioration (non bloquants)

**Verdict global : VALIDÉ, feu vert de commit.** Le piège de Throttler 6 (le garde lit `isBlocked` et ne compare plus `totalHits`) est correctement traité : le stockage Redis décide du blocage, le garde SCIM aussi, et le limiteur bloque réellement sous charge concurrente, Redis en marche comme Redis coupé. Les gardes de l'arrêt (r57-m1) détectent désormais les quatre mutations qui survivaient. Un seul défaut de forme : le fichier `audit-exceptions.md` n'est pas conforme à Prettier alors que le journal annonce le contraire.

| Constat | Verdict |
| --- | --- |
| r57-m1 (`shutdown-signals.spec.ts` 5 tests, `redis.service.spec.ts` 3 tests) | **VALIDÉ** : 2 contre-mutations propres rejouées, détectées |
| r57-a1 (section « Arrêt propre du backend ») | **VALIDÉ** (exacte au code relu ; voir r58-a1 sur la marge de 2 s) |
| r57-a2 (garde de fraîcheur de `dist`) | **VALIDÉ** : le test passe `dist` fraîche (12 suites, 421/421 après `nest build`) |
| A9-b1 (stockage à 5 arguments, garde SCIM, dépendances) | **VALIDÉ** : 5 contre-mutations unitaires + 1 e2e détectées, charge réelle conforme |

### Vérifications indépendantes (MySQL 8.0 et Redis 7 jetables `r58-mysql` et `r58-redis`, supprimés ; Node 24.16 local)
- e2e `--runInBand --detectOpenHandles` : 12 suites, **421/421**, aucun handle ouvert. Jest unitaire (`env -u DATABASE_URL -u E2E_DATABASE_URL`) : 113 suites, **3 019/3 019**. `nest build` OK, `tsc -p tests --noEmit` OK, ESLint 0 erreur (15 avertissements préexistants). Prettier : propre sur `src` et `tests` ; **`docs/security/audit-exceptions.md` non conforme** (propre à HEAD, cassé par la modification de la ligne `uuid` : la colonne « Origine » a été élargie) ; `journal-corrections.md` était déjà non conforme à HEAD (préexistant, sans objet). Vitest non rejoué (aucun changement frontend ; le lot ne touche pas `frontend/`).
- **Lecture de la bibliothèque 6.7.1** (`dist/throttler.guard.js`, `throttler.service.js`) : `handleRequest` appelle `increment(key, ttl, limit, blockDuration, name)`, la clé est `sha256(Classe-méthode-nom-adresse)`, `Retry-After` reçoit `timeToBlockExpire`, les `X-RateLimit-*` sont posés seulement hors blocage avec `Remaining = max(0, limit - totalHits)` : avec la fenêtre fixe et un seul limiteur `default`, l'instantané est donc bien identique (réponse 1).
- **Charge concurrente réelle** (application câblée, sonde jetable supprimée ensuite, rafales en `Promise.all`, une adresse par route) : `POST /auth/login` 100 requêtes : **5 x 401 puis 95 x 429** ; `POST /auth/mfa/challenge` 100 : **5 et 95** ; limiteur global `GET /projects/workspaces` 200 : **60 et 140** ; SCIM par clé 400 requêtes depuis 200 adresses : **300 x 200 et 100 x 429**, `Retry-After` 57 à 58 s. Aucune fuite au-delà de la limite malgré la concurrence (le script Lua `incrementWindow` est atomique).
- **Repli mémoire, Redis arrêté en cours d'exécution** (`docker stop r58-redis`, mêmes rafales) : mêmes comptes exacts (5/95, 5/95, 60/140, 300/100), pas de 500, délai de la première requête borné (disjoncteur 500 ms puis 5 s). Le limiteur reste appliqué par instance. Les compteurs d'une première passe survivent bien dans Redis (une seconde passe sur les mêmes adresses : 100 % de 429), preuve que la persistance entre redémarrages est intacte.
- **Contre-mutations** (sauvegarde, `\cp`, `cmp` identique à chaque fois) :
  1. Stockage `hits >= limit` (écart d'un) : **3 échecs**.
  2. Repli appelé avec `limit + 1000` : **1 échec**.
  3. `Retry-After` du garde SCIM sans `max(1, ...)` : **1 échec**.
  4. Garde SCIM transmettant `SCIM_KEY_LIMIT + 1` au stockage : **1 échec**.
  5. `timeToBlockExpire` à 5 hors blocage : **2 échecs**.
  6. Garde SCIM qui ignore `isBlocked` : unité 3 échecs (journal) et, **contrairement à ce que dit le journal, l'e2e `webhook-scim` le détecte aussi** (1 échec, test des 300 requêtes par clé) ; seul `rate-limits` n'y couvre pas SCIM.
  7. `SHUTDOWN_DEADLINE_MS * 2` : **1 échec** ; `RedisService` avec `client.quit()` direct : **1 échec**.
  Tentative de contournement du test de garde (SCIM ignorant `isBlocked` tout en renvoyant `totalHits` fort) : le test « `isBlocked` faux fait foi même avec `totalHits` 1 300 » échoue bien, donc un retour à la comparaison de `totalHits` est détecté.

### Relecture ciblée
- Le repli `ThrottlerStorageService` de la bibliothèque (fenêtre glissante, blocage de `blockDuration` à partir du dépassement) diffère du chemin Redis (fenêtre fixe) : écart **accepté**, il ne joue qu'en panne de Redis, il est documenté dans le commentaire de classe, et mesuré ici : les seuils sont respectés à l'unité près. Pas de test ajouté exigé.
- `@nestjs/config` 4 : `ConfigModule.forRoot()` n'est utilisé que dans `auth.module.ts`, `ConfigService` n'est utilisé nulle part (le code lit `process.env`), donc le changement d'ordre de résolution de la version 4 est sans effet ; `uuid` n'en dépend plus. `@nestjs/jwt` 11 : compilation et suites JWT/MFA/refresh inchangées.
- Clés hachées : les compteurs `throttle:<ancienne clé>` ne sont plus lus et expirent seuls en 60 s au plus.

### Constats
**r58-m1 (Mineur) : `docs/security/audit-exceptions.md` n'est plus conforme à Prettier.** Cause : la ligne `uuid` a élargi une cellule sans reformater le tableau ; le journal annonce « Prettier propre (docs modifiées) ». Impact : un contrôle `prettier --check` sur les docs échouerait ; aucun risque d'exploitation. Remédiation : `pnpm exec prettier --write docs/security/audit-exceptions.md` avant le commit docs ; critère : `prettier --check` sans avertissement sur ce fichier. Corriger aussi la phrase du journal sur la contre-mutation (c) (l'e2e `webhook-scim` la détecte).

**r58-a1 (Amélioration) : marge de 2 s entre le filet applicatif (8 s) et l'arrêt Docker (10 s par défaut).** Suffisante en pratique (la sortie suit le minuteur à la milliseconde, la fermeture Redis de 2 s est comprise dans les 8 s), mais elle dépend d'un défaut implicite. Suggestion : déclarer `stop_grace_period: 15s` pour le service backend dans `docker-compose.prod.yml` (valeur explicite, > 8 s avec de la marge) et le vérifier dans la procédure de déploiement. Non bloquant, à grouper avec A9-b2.

### Réponses aux questions du fixeur
1. **Instantané identique : correct.** Ce n'est pas un manque de couverture : ma spécification prévoyait un changement par prudence (suffixes `-<nom>` des en-têtes pour les limiteurs nommés). Avec un limiteur unique nommé `default`, le suffixe est vide et `Limit`/`Remaining`/`Reset` gardent leur forme ; le `Retry-After` du 429 est vérifié de bout en bout (`rate-limits`, 7/7). Je retire cette attente de la spécification A9-b1. Le limiteur SCIM, lui, n'émet aucun `X-RateLimit-*` (comportement antérieur conservé).
2. **Remise à zéro des compteurs : acceptée.** Effet réel : au déploiement, un client déjà limité repart à zéro une fois ; au pire 5 tentatives de connexion supplémentaires par adresse. Aucune action.
3. Écarts déclarés : `ThrottlerStorageRecord` non exporté (type local `Awaited<ReturnType<...>>`, bon choix) ; repli glissant (accepté, ci-dessus) ; installation sous Node 20 (accepté, le lockfile ne dépend pas de la version de Node ; la CI Node 22 le confirmera avec `--frozen-lockfile`) ; `stop_grace_period` absent : voir r58-a1.

### Feu vert de commit (chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*`) : 4 commits, dans cet ordre
1. `test(security): gardes de l'arrêt propre, signaux et fermeture bornée de Redis (r57-m1)` : `backend/tests/unit/common/shutdown-signals.spec.ts`, `backend/tests/unit/redis/redis.service.spec.ts`.
2. `test(security): fraîcheur de dist dans le test de sortie sur SIGTERM (r57-a2)` : `backend/tests/e2e/security/o23-sigterm.e2e-spec.ts`.
3. `feat(backend): montée de @nestjs/throttler 6, @nestjs/config 4 et @nestjs/jwt 11, blocage décidé par le stockage (A9-b1)` : `backend/package.json`, `pnpm-lock.yaml`, `backend/src/common/app-throttler.guard.ts`, `backend/src/common/redis-throttler.storage.ts`, `backend/tests/unit/common/redis-throttler.storage.spec.ts`, `backend/tests/unit/common/scim-key-throttler.guard.spec.ts`. Commit atomique : code, tests et dépendances vont ensemble (le code à 5 arguments échoue avec l'ancienne version et inversement).
4. `docs(security): arrêt propre, exceptions d'audit, revue r58 du sous-lot A9-b1 (r57-a1, r58-m1)` : `docs/deployment-production.md`, `docs/security/ci.md`, `docs/security/audit-exceptions.md` (après `prettier --write`), `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, en dernier.
Chaque commit passe isolément (le 2 suppose le 1 pour la cohérence des tests d'arrêt et `dist` construit, comme en CI ; le 3 est autonome). Aucune mention d'outil d'assistance ni `Co-Authored-By`.

### Conditions de déploiement : A9-b1 peut partir **dans le même déploiement** qu'A9-b0 (Node 22) et A9-b0b (arrêt propre)
Justification : une seule image backend, aucune migration, aucune variable, aucun changement de proxy ni de schéma ; un seul rollback (étiquette d'image) ramène l'état complet ; chaque sous-lot est validé isolément par la même suite e2e. Les compteurs Redis changent de clé mais restent compatibles (remise à zéro unique). Séparer n'apporterait qu'un déploiement de plus ; je ne séparerais que si la CI Node 22 échoue ou si l'on veut isoler un incident Node 22 (argon2, Prisma), auquel cas le rollback d'image couvre tout de même les trois.
1. **Prérequis** : CI verte sur **tous** les jobs sous Node 22, y compris `pnpm install --frozen-lockfile` (le lockfile a été produit sous Node 20), `e2e` (build puis `o23-sigterm`, `rate-limits`, `webhook-scim`) et `frontend-headers` ; commits de r56, r57 et r58 poussés ; **`mysqldump` complet avant** (aucune migration dans ces trois sous-lots).
2. **Avant** : étiqueter les images en cours (`planner-backend:pre-a9b`) ; reconstruire le backend `--no-cache` (Node 22, `argon2` et Prisma recompilés, nouveaux paquets `jsonwebtoken`, `dotenv`). Aucun changement de `ekose-nginx-1` (en cas d'intervention : `docker restart`, pas `reload`).
3. **Déploiement** hors pointe. Comme pour r57 : l'ancien processus ignore SIGTERM, donc ce déploiement finit en 137 après le délai d'arrêt ; l'arrêt propre ne joue qu'au suivant.
4. **Vérifications après déploiement** (celles de r57 : `node -v` en v22, 148 routes au démarrage, `GET /features` avec Helmet, connexion réelle d'un compte existant, WebSocket) **plus** : (a) cinq connexions erronées successives depuis une adresse de test puis une sixième : **429** avec message français et `Retry-After` ≤ 60 (le limiteur n'est pas muet) ; (b) un jeton d'accès, un rafraîchissement et un ticket MFA fonctionnent (JWT 11) ; (c) si SCIM est activé, une requête avec une clé valide répond 200 ; (d) journaux sans « dotenv » inattendu ni avertissement Redis de limiteur.
5. **Rollback** : remettre l'image `pre-a9b` ; aucune donnée ni format modifiés ; les compteurs `throttle:*` se réinitialisent seuls en 60 s.
6. **Connu et accepté** : repli mémoire à fenêtre glissante lors d'une panne de Redis ; remise à zéro unique des compteurs ; ce déploiement-ci finit en 137 ; `stop_grace_period` de production non vérifié (r58-a1) ; r58-m1 corrigé dans le commit docs.

### Ordre des constats ouverts (fin de r58)
1. **r58-m1** (Prettier de `audit-exceptions.md`) : à corriger avant le commit 4, trivial.
2. **A9-b2** (NestJS 11, Express 5 ; rejouer `o22`, `o23`, `rate-limits`, SCIM), **A9-b3** (`jose` 6), **A9-b4** (documentation, y compris r56-a1), puis **A8**, puis **P2**.
3. Améliorations : r58-a1 (avec A9-b2), r56-a1, r56-a2, r55-a1, r53-a1, r53-a2, O-f, O-a, r48-a1, r48-a2.
4. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
5. Actions d'exploitation : sauvegarde avant migration, comparaison complète du schéma de production, vérifications GitHub requises, confirmation de `TRUST_PROXY_HOPS` (O-c), valeur du `stop_grace_period` du conteneur backend (> 8 s).
6. Clos par cette revue : r57-m1, r57-a1, r57-a2, A9-b1 (VALIDÉS).

## Revue r59 (architecte) : sous-lot A9-b2 (NestJS 11.2.9, Express 5.2.1, surcharge `body-parser` par majeure ; r58-a1) : VALIDÉ, aucun nouveau constat

| Constat | Verdict |
| --- | --- |
| A9-b2 (NestJS 11, Express 5, `body-parser` 2.4.0 pour Nest, Express 4 pour `firebase-tools`) | **VALIDÉ** : pile réellement chargée, 4 contre-mutations détectées |
| r58-a1 (`stop_grace_period: 15s`) | **VALIDÉ** : suppression et valeur altérée détectées |

### Vérifications indépendantes (MySQL 8.0 et Redis 7 jetables `r59-mysql` et `r59-redis`, supprimés ; Node 22.22.2)
- e2e `--runInBand --detectOpenHandles` : 13 suites, **424/424**, aucun handle ouvert. Jest unitaire (`env -u DATABASE_URL -u E2E_DATABASE_URL`) : 113 suites, **3 023/3 023**. `nest build` OK, `tsc -p tests --noEmit` OK, ESLint 0 erreur (15 avertissements préexistants), Prettier propre sur `src`, `tests`, lockfile, workspace, compose et les deux docs modifiées, `pnpm install --frozen-lockfile --offline` OK, vitest 34 fichiers **296/296**, `pnpm audit --prod --audit-level=high` : 0 high, 14 avis (2 low, 12 moderate), plus d'avis `@nestjs/core`. Les comptes du journal sont exacts.
- **Identité de la table des routes et de l'instantané : valide, pas une référence qui se recopie.** Les fichiers `a9b0-routes.reference.txt` et `a9b0-http-snapshot.reference.json` sont ceux de `HEAD` (absents de `git status`), le test ne les écrit que sous `A9B0_WRITE_ROUTES=1` ou le drapeau équivalent, et compare à la table produite en direct par `E2eWorld.start` (lignes `Mapped {...}` du journal Nest). Résolution vérifiée depuis `backend/` : `@nestjs/core` 11.2.9, `@nestjs/platform-express` 11.2.9 avec `express` 5.2.1 ; le test unitaire lit aussi le lockfile. Le contre-test (query parser) montre de surcroît que le banc voit bien la sémantique Express 5. L'identité est attendue : aucune route n'a de joker ni de segment optionnel (test R1 vert, recherche dans `src` : aucun `@Get('*')`, `forRoutes`, `exclude`), et les en-têtes ne dépendent pas de la majeure.
- **Contre-mutations propres** (sauvegarde, `\cp`, `cmp` identique à chaque fois) :
  1. Surcharge `body-parser` remise globale `>=1.20.9 <2` : `dependency-overrides` **2 échecs** (aucune surcharge globale ; lockfile sans les mêmes surcharges).
  2. Contournement : `@nestjs/platform-express` remis à 10.4.22 dans `package.json` seul : **1 échec** (test « NestJS 11 sur Express 5 »).
  3. `stop_grace_period` supprimé du compose : **1 échec** ; contournement `15s` changé en `5s` : **1 échec**.
  4. `app.set('query parser', 'extended')` : le nouveau test R9 **échoue** (1 échec) ; contournement par une fonction `qs.parse` : **échoue aussi** (le test ne dépend pas de la chaîne `'extended'`).
  5. Adaptateur Redis retiré de `tracking.gateway.ts` : le test deux instances **échoue** (1 échec, 10 s d'attente bornée), l'autre reste vert.

### Relecture ciblée
- **Query parser « simple »** : tous les `@Query()` du backend sont des DTO à champs scalaires (`AuditLogQueryDto`, `TimeRangeQueryDto`, `AdminPaginationQueryDto`, `ScimListQueryDto`, `GithubAuthorizeQueryDto`, `SsoAuthorizeQueryDto`, `ListQueryDto`) ou des UUID simples (`workspaceId`) ; aucun `IsArray`, `ValidateNested` ni `each` sur une query (ceux de `scim.dto.ts` visent des corps JSON). Côté frontend, tous les appels construisent des paramètres scalaires (`?workspaceId=`, `?limit=`, `?domain=`, `?purpose=`, `URLSearchParams` d'`AdminConsole`), aucun `a[]=` ni `a[b]=`. Aucune régression de contrat ; le changement est un durcissement (surface de pollution de paramètres réduite) et il est figé par un test.
- **Joker et chemins optionnels** : aucun dans `src` (voir ci-dessus) ; `path-to-regexp` 8.4.2 n'a donc rien à réinterpréter. Le webhook en trois formes de chemin et le 404 de l'instantané restent verts.
- **Ordre inversé des crochets de destruction (Nest 11)** : les `onModuleDestroy` du dépôt (`PrismaService`, `RedisService`, `TrackingGateway`, `FirestoreSyncService`) sont indépendants les uns des autres (chacun ne ferme que ses propres ressources : aucun ne lit Prisma ou Redis pendant sa destruction). `o22` (aucune connexion MySQL ni Redis ouverte après `app.close()`) et `o23` (processus réel `dist/main`, SIGTERM, code 0) passent sur la pile Nest 11 et Node 22. Résiduel connu, déjà présent avant : une tâche `@Cron` en vol (`FirestoreSyncService.processPendingEvents`, activée seulement avec Firestore) peut échouer si Prisma se déconnecte pendant `close()` ; l'erreur est journalisée et l'outbox reprend au démarrage suivant. Non bloquant.
- Express 5 : `req.body` est `undefined` sans corps analysé ; couvert par les e2e (400/401/201 inchangés). `cookie-parser`, `helmet`, `cors` et `multer` 2.5.0 compilent et passent les suites existantes.

### Constats
Aucun nouveau constat. Remarque de forme sans ouverture de constat : `journal-corrections.md` n'est pas conforme à Prettier dans son ensemble (préexistant, sans objet) ; le fixeur ne formate que sa section, ce qui est le bon comportement.

### Réponses aux questions du fixeur
1. **Identité de la table des routes et de l'instantané : attendue et correcte** (voir ci-dessus). Une différence aurait été le signal inquiétant.
2. **`fast-xml-parser` en exception : accepté.** Avis low, transitif de `@google-cloud/storage` via `firebase-admin`, importé nulle part dans `backend/src`, aucun XML externe analysé. Le journal reconnaît à raison qu'il était déjà là et non listé. Réévaluer à la prochaine montée de `firebase-admin`.
3. **Redeliver GitHub et IdP SCIM réel : à faire au déploiement**, pas avant (aucun accès depuis ce poste). Ils sont ajoutés aux vérifications après déploiement ci-dessous. Les écarts déclarés (démarrage avec la surcharge fautive, XFF en chaîne non testés à la main) sont acceptés : la surcharge est gardée par le test unitaire, `--frozen-lockfile` (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`) et le test d'Express 5 au lockfile ; le XFF en chaîne est couvert par `throttling-proxy.spec.ts`.

### Feu vert de commit (chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*`) : 3 commits, dans cet ordre
1. `feat(backend): montée à NestJS 11.2.9 et Express 5.2.1, surcharge body-parser par majeure, requête « simple » figée (A9-b2)` : `backend/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `backend/tests/unit/dependency-overrides.spec.ts`, `backend/tests/e2e/security/a9b0-http-characterization.e2e-spec.ts`, `backend/tests/e2e/security/a9b2-realtime-two-instances.e2e-spec.ts`. Commit atomique : dépendances, surcharges et leurs gardes vont ensemble (la garde « Express 5 » échoue sur l'ancien lockfile, et inversement).
2. `feat(ops): stop_grace_period explicite de 15 s pour le backend (r58-a1)` : `docker-compose.prod.yml`, `backend/tests/unit/main-hardening.spec.ts`.
3. `docs(security): exceptions d'audit, procédure de déploiement, revue r59 du sous-lot A9-b2 (r58-a1)` : `docs/deployment-production.md`, `docs/security/audit-exceptions.md`, `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, en dernier.
Chaque commit passe isolément. Aucune mention d'outil d'assistance ni `Co-Authored-By`.

### Conditions de déploiement : A9-b2 se déploie **séparément**, après A9-b0, A9-b0b et A9-b1 déployés ensemble et observés 24 h
Justification : c'est la seule montée majeure du framework HTTP et du serveur WebSocket (Express 4 vers 5, Nest 10 vers 11). Les e2e ne prouvent ni le Redeliver GitHub, ni un IdP SCIM réel, ni le comportement derrière `ekose-nginx-1`. Un lot b0 à b1 observé donne une ligne de base de 5xx/429 et de livraisons de webhook : un écart après A9-b2 est alors imputable sans ambiguïté, et le rollback ne perd pas l'arrêt propre ni le limiteur. Le coût (un déploiement de plus) est faible. Contrairement au lot b0 à b1 (qui finit en 137 car l'ancien processus ignore SIGTERM), l'arrêt de l'ancienne version se fera proprement.
1. **Prérequis** : A9-b0 à A9-b1 en production et stables 24 h ; CI verte sur **tous** les jobs sous Node 22 (dont `pnpm install --frozen-lockfile`, `e2e`, `frontend-headers`, audit) ; commits de r59 poussés ; aucune migration (sauvegarde `mysqldump` par précaution seulement).
2. **Avant** : étiqueter l'image backend en cours (`planner-backend:pre-a9b2`) ; reconstruire `--no-cache`. Aucune variable nouvelle, aucun changement de `ekose-nginx-1` (si intervention : `docker restart`, pas `reload`). `docker-compose.prod.yml` change : recréer le conteneur backend avec `docker compose up -d` (le `stop_grace_period` ne s'applique qu'à un conteneur recréé).
3. **Vérifications après déploiement** : `docker inspect -f '{{.Config.StopTimeout}}' <backend>` renvoie `15` ; 148 routes au démarrage, sans avertissement ; `GET /features` 200 avec Helmet ; connexion réelle d'un compte existant ; cinq connexions erronées puis une sixième : 429 avec `Retry-After` ; **une livraison GitHub « Redeliver » (201, signature acceptée, corps volumineux refusé en 413 au plafond)** ; **une synchronisation SCIM réelle (liste d'utilisateurs avec `filter`, création, désactivation) si SCIM est activé** ; connexion SSO ; **un client WebSocket (`active-timer-state`) et, si plusieurs instances, un événement inter-instances** ; téléversement de fichier (multer) ; `X-Forwarded-For` depuis une adresse forgée ignorée ; un redéploiement suivant s'arrête en moins de 15 s avec le code 0 et le journal « SIGTERM reçu : arrêt en cours. ». Observer 24 h : 5xx, 429, livraisons de webhook, connexions SSO, journaux de démarrage et d'arrêt.
4. **Rollback** : remettre l'image `pre-a9b2` (aucune donnée ni format modifiés) ; `package.json` et lockfile reviennent par `git revert` du commit 1 si besoin.
5. **Connu et accepté** : requêtes en « simple » (durcissement, aucun appel ne l'utilise en profondeur) ; 14 avis modérés/faibles listés dans `audit-exceptions.md` ; tâche `@Cron` en vol possible à l'arrêt (voir relecture) ; Redeliver et IdP SCIM vérifiés seulement en production.

### Ordre des constats ouverts (fin de r59)
1. **A9-b3** (`jose` 6 ; SSO à rejouer, déploiement seul), puis **A9-b4** (documentation, y compris r56-a1), puis **A8** (y inclure O-b et O-e), puis **P2**.
2. Améliorations : r56-a1, r56-a2, r55-a1, r53-a1, r53-a2, O-f, O-a, r48-a1, r48-a2.
3. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
4. Actions d'exploitation : `mysqldump` avant migration, comparaison du schéma de production, vérifications GitHub requises, `TRUST_PROXY_HOPS` (O-c), Redeliver et IdP SCIM réels après A9-b2.
5. Clos par cette revue : A9-b2, r58-a1 (VALIDÉS).

## Revue r60 (architecte) : sous-lot A9-b3 (`jose` 6.2.17, transformateur Jest dédié) : VALIDÉ, aucun nouveau constat

| Constat | Verdict |
| --- | --- |
| A9-b3 (`jose` 4.15.9 vers 6.2.17, SSO OIDC seul) | **VALIDÉ** : code applicatif inchangé, `dist/` chargé en CommonJS sous Node 22 sans Jest, 6 contre-mutations détectées |

### Vérifications indépendantes (MySQL 8.0, Redis 7 et Node 22.23.5 jetables `r60-mysql`, `r60-redis`, `r60-node`, supprimés ; copie du working tree, `pnpm install --frozen-lockfile` OK)
- e2e `--runInBand --detectOpenHandles` : 13 suites, **424/424**. Jest unitaire (`env -u DATABASE_URL -u E2E_DATABASE_URL`) : 114 suites, **3 039/3 039**. `nest build` OK, `tsc -p tests --noEmit` OK, ESLint 0 erreur, Prettier propre (transformateur, `package.json`, `jest-e2e.json`, tests SSO), `pnpm audit --prod --audit-level=high` : code 0, 0 high (2 low, 12 moderate). Le lockfile ne contient plus `jose@6.2.13` ; `jose@4.15.9` reste (`jwks-rsa`), `jose@6.2.17` est celui du backend. Les comptes du journal sont exacts. Vitest non rejoué (frontend non touché).
- **Production réelle sans Jest** (point de vigilance principal) : `dist/` compilé, `node --throw-deprecation` : `require('jose')` charge 6.2.17 (`require(esm)` natif de Node 22), `require('dist/auth/sso/oidc')` et `sso.service` se chargent, aucun avertissement. `engines` exige déjà `>=22.12` (racine et backend), et les deux Dockerfile sont en `node:22-alpine` : la contrainte est portée. Le transformateur ne masque donc rien : il ne sert qu'à Jest 29 (CommonJS).
- **Banc `OidcKeySource` de `dist/` contre un JWKS HTTP local** (script jetable hors dépôt) : jeton valide accepté ; deuxième vérification servie par le cache (1 seule requête) ; **rotation de clé : `kid` nouveau refusé (`ERR_JWKS_NO_MATCHING_KEY`) dans les 30 s qui suivent la première récupération, accepté après 31 s** (2e requête) ; `kid` inconnu refusé sans nouvelle requête pendant le délai de réarmement ; **redirection 302 refusée** (`ERR_JOSE_GENERIC`). Comportement de cache et de rotation identique à `jose` 4 (délai de réarmement de 30 s), aucun risque nouveau.
- **Mapping d'erreur** : `sso.service.ts:430` capture toute exception de `jwtVerify` et renvoie `UnauthorizedException("Jeton d'identité invalide.")` ; les codes `jose` 6 (`ERR_JWKS_NO_MATCHING_KEY`, `ERR_JOSE_GENERIC`, `ERR_JWT_EXPIRED`, etc.) ne sont ni lus ni exposés : aucune dépendance au code d'erreur, aucun 500, aucun message de bibliothèque vers le client.
- **Portée du transformateur** : l'expression de `transformIgnorePatterns` testée sur cinq chemins : `jose@6.*` transformé, `jose@4.15.9`, `zod` et un autre paquet sous `jose@6` ignorés. Seul `jose` 6 est donc traduit ; aucune doublure, aucun `jest.mock('jose')`. Le chemin `.pnpm/jose@6.x/node_modules/` est celui de la CI (même disposition pnpm, `pnpm install --frozen-lockfile` dans les jobs `build` et `e2e`, qui exécutent la même configuration Jest ; le job `build` lance `pnpm --filter backend test`).
- **Contre-mutations propres** (sauvegarde, `\cp`, `cmp` identique à chaque fois ; 94 tests des deux suites SSO, 94/94 au départ) :
  1. Retrait de `algorithms: ['RS256']` : **1 échec** (test PS256 sans `alg` dans le JWKS).
  2. `algorithms: ['RS256','PS256']` : **1 échec**.
  3. `timeoutDuration: 20000` : **1 échec** (serveur muet).
  4. Vérification du `nonce` retirée (`safeEqual` supprimé) : **1 échec**.
  5. `clockTolerance: 3600` : **échec** du test « expiré depuis 10 min ». Retrait d'`audience` : **2 échecs**.
  6. Contournement de la garde : `transformIgnorePatterns: ["/node_modules/"]` (transformation de `jose` retirée) : `oidc-key-source.spec.ts` **échoue** (« Cannot use import statement outside a module », 0 test exécuté) : la garde de configuration est bien vivante, un retrait n'est jamais silencieux.

### Relecture ciblée
- **`algorithms: ['RS256']` est le seul garde contre une confusion d'algorithme** quand le JWKS n'annonce pas `alg` : le fixeur a vu juste en le prouvant par un test (PS256 signé avec une clé sans `alg`), et sa remarque est confirmée par ma mutation 1 : sans ce test, le retrait de la liste blanche passait inaperçu. Bon test.
- **Transformateur** : `transpileModule` avec diagnostics en erreur, clé de cache sur le fichier lui-même, la version de TypeScript, le nom et la source. Placé dans `backend/` car `.gitignore` ignore `backend/tests/**/*.js` : acceptable. Une future `jose` 7 ne serait pas transformée par le motif `6\.` : l'échec serait bruyant (même erreur d'import), pas silencieux.
- `http://` accepté par `jose` 6 : les points d'accès JWKS sont fixés dans `oidcEndpoints`, jamais fournis par le client ou par un administrateur de workspace. Sans objet.

### Constats
Aucun nouveau constat.

### Réponses aux questions du fixeur
1. **Transformateur dédié : accepté.** Les deux motifs de l'écart (aucune émission des `.js` de `node_modules` par le service de langage de `ts-jest`, configuration `ts-jest` partagée entre entrées) sont plausibles, la solution est plus petite que la spécification, sans doublure, et gardée par un test qui échoue si elle disparaît (mutation 6). L'écart à la spécification (point 2) est accepté ; la remédiation est considérée comme satisfaite.
2. **`jose@4.15.9` via `jwks-rsa` (`firebase-admin`) : sans action.** Le chemin SSO n'utilise pas ce paquet, il est ignoré par le motif Jest, et aucun avis `high` n'est ouvert. Réévaluer à la prochaine montée de `firebase-admin`.
3. **SSO de bout en bout sur un IdP réel : condition de déploiement**, pas de commit (voir ci-dessous).

### Feu vert de commit (chemins explicites, jamais `git add -A`, ni `.claude/`, ni `.env*`) : 2 commits, dans cet ordre
1. `feat(backend): montée de jose à 6.2.17 pour le SSO OIDC, transformateur Jest dédié, tests de la liste blanche d'algorithmes et du JWKS (A9-b3)` : `backend/package.json`, `pnpm-lock.yaml`, `backend/jest-e2e.json`, `backend/jest-esm-transform.js`, `backend/tests/unit/auth/sso-oidc.spec.ts`, `backend/tests/unit/auth/oidc-key-source.spec.ts`. Commit atomique : sans le transformateur et la configuration Jest, la montée casse toute la batterie, et inversement.
2. `docs(security): revue r60 du sous-lot A9-b3` : `docs/security/rapport-audit.md`, `docs/security/journal-corrections.md`, en dernier.
Chaque commit passe isolément. Aucune mention d'outil d'assistance ni `Co-Authored-By`.

### Conditions de déploiement : A9-b3 se déploie **seul, après A9-b2** (donc après A9-b0, A9-b0b, A9-b1 puis A9-b2, chacun observé 24 h)
Ordre : A9-b0 à A9-b1 ensemble, 24 h ; A9-b2 seul, 24 h ; A9-b3 seul. Justification : A9-b3 touche l'authentification SSO, qu'aucun test automatique ne valide face à un IdP réel ; l'isoler rend toute régression de connexion SSO imputable sans ambiguïté, et son rollback n'embarque ni Nest 11 ni l'arrêt propre.
1. **Prérequis** : A9-b2 en production et stable 24 h ; CI verte sur **tous** les jobs sous Node 22 (en particulier `build` et `e2e`, qui exécutent le transformateur avec les chemins pnpm de la CI, et `pnpm audit`) ; commits de r60 poussés ; aucune migration (sauvegarde `mysqldump` par précaution seulement).
2. **Avant** : étiqueter l'image backend en cours (`planner-backend:pre-a9b3`) ; reconstruire `--no-cache`. Aucune variable, aucun changement de `ekose-nginx-1`, `docker-compose.prod.yml` inchangé.
3. **Vérifications après déploiement** : journal de démarrage sans avertissement `ExperimentalWarning` ni erreur d'import ; `GET /features` 200 ; **SSO sur un IdP réel (Google ou Azure) : connexion réussie, nonce rejoué refusé en 401, jeton d'un autre tenant refusé** ; compte existant ; arrêt propre (`docker stop` en code 0). Surveiller les 401 « Jeton d'identité invalide. » sur 24 h.
4. **Rollback** : remettre l'image `pre-a9b3` (aucune donnée ni format modifié) ; `git revert` du commit 1 si besoin.
5. **Connu et accepté** : après la première récupération du JWKS d'un IdP, une clé nouvellement publiée n'est reconnue qu'après 30 s (délai de réarmement de `jose`, identique à `jose` 4) ; `jose@4.15.9` conservé pour `jwks-rsa` ; vérification de l'IdP réel faite seulement en production.

### Ordre des constats ouverts (fin de r60)
1. **A9-b4** (documentation, y compris r56-a1, plus la mention du transformateur Jest et de `jose` 6), puis **A8** (y inclure O-b et O-e), puis **P2**.
2. Améliorations : r56-a1, r56-a2, r55-a1, r53-a1, r53-a2, O-f, O-a, r48-a1, r48-a2.
3. Reliquats antérieurs : r44-a3, r42-a1, parcours manuel avant `CSP_MODE=enforce`, S30, recensement S19/S20, S26, A5 à A7, P5, P8, O10 à O15, O17.
4. Actions d'exploitation : `mysqldump` avant migration, comparaison du schéma de production, vérifications GitHub requises, `TRUST_PROXY_HOPS` (O-c), Redeliver et IdP SCIM réels après A9-b2, SSO réel après A9-b3.
5. Clos par cette revue : A9-b3 (VALIDÉ).
