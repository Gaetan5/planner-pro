# Rapport d'audit de sécurité, d'architecture et de produit : Planner-Pro

| Champ | Valeur |
| --- | --- |
| Auteur | senior-security-architect |
| Date | 2026-10-29 |
| Branche auditée | `security/phase-0` (HEAD `9c0d9bd`) |
| Périmètre | `backend/` (NestJS 10, Prisma 7 / adaptateur MariaDB, MySQL 8, Socket.IO, Redis), `frontend/` (React 18 / Vite), `docker-compose*.yml`, `.github/workflows/ci.yml`, `firestore.rules` |
| Méthode | Revue de code manuelle ligne par ligne, `pnpm audit --prod`, exécution de la suite Jest backend (32 suites, 185 tests, tous verts : **aucun ne couvre les scénarios d'attaque ci-dessous**) |
| Statut | **Source de vérité** pour l'agent `fixeur`. Les identifiants sont stables : ne jamais renuméroter, ajouter les nouveaux constats à la suite. |
| Révision | r11 (2026-11-02) : Phases 0, 1 et 2 VALIDÉES (Phase 2 commitée `aaf696d`) ; **Phase 3 NON VALIDÉE** (revue r11 : 5 points bloquants S12-a, S12-b, S12-c, S12-d, S16-a ; décisions produit P4, timelog, O4, DTO IA en attente de l'utilisateur). Consigne pour fixeur : section « Revue r11 — Phase 3 », § « Plan d'action r11 pour fixeur ». |

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
