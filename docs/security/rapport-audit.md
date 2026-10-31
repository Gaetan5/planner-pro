# Rapport d'audit de sécurité, d'architecture et de produit : Planner-Pro

| Champ | Valeur |
| --- | --- |
| Auteur | senior-security-architect |
| Date | 2026-10-29 |
| Branche auditée | `security/phase-0` (HEAD `9c0d9bd`) |
| Périmètre | `backend/` (NestJS 10, Prisma 7 / adaptateur MariaDB, MySQL 8, Socket.IO, Redis), `frontend/` (React 18 / Vite), `docker-compose*.yml`, `.github/workflows/ci.yml`, `firestore.rules` |
| Méthode | Revue de code manuelle ligne par ligne, `pnpm audit --prod`, exécution de la suite Jest backend (32 suites, 185 tests, tous verts : **aucun ne couvre les scénarios d'attaque ci-dessous**) |
| Statut | **Source de vérité** pour l'agent `fixeur`. Les identifiants sont stables : ne jamais renuméroter, ajouter les nouveaux constats à la suite. |
| Révision | r3 (2026-10-30) : **Phase 0 VALIDÉE côté code** (S1, S2, S3, S4, S5, S28, P1, P3, S14 étape 1, S18 étape 0). Actions d'exploitation en attente : voir section 8 |

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

#### S23 : corps de requête non validés (types inline et interfaces contournant le ValidationPipe)

- **Phase** : 5. **Sévérité** : Mineur. **CVSS 5.3** `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L`
- **Localisation** (liste exhaustive vérifiée) : `auth.controller.ts:34,75,95,104,154` ; `scim.controller.ts:71,82,93,120` ; `projects.controller.ts:110,546` (`IntegrationDto`), `611` (`{provider, code}`), `671` (`{taskIds}`) ; `comments.controller.ts:131` ; `notes.controller.ts` (`{title, content}` sur `POST` et `PUT`) ; `ai.controller.ts:61-64,82-88,129-132` ; paramètre `projects.controller.ts:302-306` (`status` de `DeliverableStatus` non validé) ; paramètres de requête `limit`, `start`, `end` (`parseInt`/`new Date` sans borne).
- **Cause** : `ValidationPipe` ne valide que les classes décorées.
- **Remédiation attendue** : un DTO classe par corps, avec bornes de taille (`@MaxLength`, `@ArrayMaxSize`) ; `ParseUUIDPipe` sur tous les `:id` ; `ParseEnumPipe` pour `:status` ; `ParseIntPipe` + `@Max` pour `limit` ; `json` limité (par exemple `app.useBodyParser('json', { limit: '1mb' })`). Ajouter une règle ESLint (ou un test) qui interdit `@Body()` sur un type non classe.
- **Test attendu** : test « méta » qui parcourt les métadonnées Nest (`Reflect.getMetadata('design:paramtypes', ...)`) de tous les contrôleurs et échoue si un `@Body()` a pour type `Object` ou une interface. Plus des tests 400 ciblés sur les routes sensibles.

#### S24 : limitation de débit inefficace (proxy, mémoire locale, routes non couvertes)

- **Phase** : 5. **Sévérité** : Mineur. **CVSS 5.3** `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`
- **Localisation** : `src/main.ts` (pas de `app.set('trust proxy', ...)` alors que le backend est derrière un reverse proxy : `docker-compose.prod.yml` lie `127.0.0.1:3003`, donc tous les clients partagent l'IP du proxy, d'où un déni de service global des routes `@Throttle(5/min)` ou, inversement, une protection nulle) ; `app.module.ts:21-26` (stockage en mémoire, inefficace en multi-instance) ; `auth.controller.ts:133-136` (`mock/login` sans `@Throttle` spécifique, voir S26) ; brute-force du code MFA limité par IP mais pas par compte ni par ticket (S3) ; gateways en `@SkipThrottle()`.
- **Remédiation attendue** : `app.getHttpAdapter().getInstance().set('trust proxy', 1)` (nombre de sauts paramétrable par `TRUST_PROXY_HOPS`) ; stockage Redis du throttler (`@nest-lab/throttler-storage-redis` ou équivalent) ; limites **par compte** (clé `email`) sur login et MFA en plus de l'IP ; verrouillage progressif après 10 échecs ; limitation de débit WS (S16).
- **Tests attendus** : e2e avec `X-Forwarded-For` différents : deux IP distinctes ont des compteurs distincts ; six tentatives de login sur le même e-mail depuis six IP : la sixième renvoie 429.

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
