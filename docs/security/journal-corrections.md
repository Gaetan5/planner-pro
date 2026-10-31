# Journal de correction : Planner-Pro

| Champ | Valeur |
| --- | --- |
| Auteur | senior-fixer |
| Référence | `docs/security/rapport-audit.md` (rapport de `conrado`, 44 constats) |
| Branche | `security/phase-0` (aucun commit : modifications laissées dans l'arbre de travail, à la demande de l'utilisateur) |
| Base de départ | backend : 32 suites / 185 tests verts ; frontend : 8 fichiers / 18 tests verts |

---

## Plan de correction : Phase 0

Ordre imposé par la section 6 du rapport : **P3 → S3 → S2 → S1 → S4 → S5 → P1**. Chaque constat suit la séquence : test d'abus qui échoue, correctif minimal, test vert, suite complète, build.

| Ordre | ID | Fichiers touchés (prévision) | Tests d'abus prévus | Migration |
| --- | --- | --- | --- | --- |
| 0.1 | P3 | `backend/src/config/features.ts` (nouveau), `backend/src/config/feature-flag.guard.ts` (nouveau), `sso.controller.ts`, `scim.controller.ts`, `app.controller.ts` (`GET /features`), `frontend/src/components/Login.tsx`, `.env.example` | Tests HTTP (application Nest réelle + `fetch`) : drapeaux absents, alors `POST /auth/sso/callback`, `GET /scim/v2/Users`, `POST /workspaces/:id/scim/keys` renvoient 404 et le service n'est jamais appelé ; drapeau à `true` : la route répond de nouveau ; onglet SSO masqué côté UI | Aucune |
| 0.2 | S3 | `backend/src/auth/token.service.ts` + `token.module.ts` (nouveaux), `jwt.guard.ts`, `auth.service.ts`, `auth.module.ts`, `sso.service.ts`, `admin.service.ts`, `tracking.gateway.ts`, `notifications.gateway.ts`, `redis.service.ts` | Ticket MFA en `Bearer` sur une route gardée : 401 ; jeton signé sans `typ` : 401 ; handshake WS avec le ticket : `disconnect(true)` (deux gateways) ; ticket réutilisé après succès : 401 ; 6e essai avec un code valide après 5 échecs : 401 | Aucune |
| 0.3 | S2 | `sso.service.ts`, `sso.dto.ts`, script SQL de désactivation | Config `SAML2`/`OIDC_GENERIC` activée + code arbitraire : 501, `user.findFirst`/`user.create`/émission de jeton jamais appelés ; DTO `provider: 'SAML2'` : erreur de validation ; `getAuthorizationUrl` SAML : plus de redirection `entryPoint` | Migration de données SQL (désactivation des configs SAML2/OIDC_GENERIC) |
| 0.4 | S1 | `scim.service.ts`, `scim.controller.ts` (inchangé sauf besoin), `prisma/schema/auth.prisma`, `workspace.prisma`, nouvelle migration | `PUT` avec nouvel `userName` : `User.email` inchangé ; `PATCH active=false` : `User.isSuspended` jamais écrit, seule la membership du workspace est retirée ; `POST` e-mail existant : 409 sans membership ; `DELETE` clé d'un autre workspace : 404 ; nom modifiable seulement si l'utilisateur a été provisionné par ce workspace | `User.provisionedByWorkspaceId` (nullable, FK `SetNull`) |
| 0.5 | S4 | `package.json` racine (`pnpm.overrides`), `backend/package.json`, `pnpm-lock.yaml`, `prisma.service.ts`, `wait-for-db.js`, `.env.example` | `prisma.service.spec.ts` : production sans `DATABASE_URL` : erreur ; production : `allowPublicKeyRetrieval === false` ; `DATABASE_SSL=true` : `ssl.rejectUnauthorized === true` ; `pnpm why mariadb` / `pnpm audit` | Aucune |
| 0.6 | S5 | `calendar-sync.service.ts`, `projects.controller.ts`, spec existante, `backend/scripts/cleanup-simulated-calendar.ts` (nouveau, **non exécuté**), fixture déplacée dans `backend/tests/fixtures/` | Intégration sans source : `syncCalendarEvents` renvoie 0 + `skipped NOT_CONFIGURED`, aucun `timeBlock.create` ; identifiants absents et `NODE_ENV=staging` : `handleOAuthCallback` lève une erreur, pas d'`upsert` ; tâche créée avec `userId === appelant` ; VIEWER sur sync/export : 403 ; `GET /projects/mock-calendar` : 404 | Nettoyage de données par script manuel |
| 0.7 | P1 | `integration.service.ts` (`getIntegrationsStatus`), `IntegrationsPanel.tsx`, `docs/audit_roadmap_phases.md` | `getIntegrationsStatus` : statut `NOT_CONFIGURED` au lieu de `DEMO`/`CONNECTED` sans source réelle ; test vitest de l'affichage « Non configuré » | Aucune |

### Décisions produit / techniques prises (option recommandée, à confirmer)

1. **P3 : source des drapeaux.** Lecture de `process.env.FEATURE_*_ENABLED === 'true'` à chaque requête (défaut : désactivé). Le module de configuration validée (A7) arrive en Phase 5 ; le helper sera alors branché dessus. Le frontend apprend l'état des drapeaux par une route publique `GET /features` (source unique côté serveur, pas de variable Vite à garder synchrone).
2. **S3 : clé du ticket MFA.** Dérivation HKDF-SHA256 de `JWT_SECRET` avec un label dédié (option prévue par le rapport) plutôt qu'une nouvelle variable obligatoire `MFA_TICKET_SECRET` : aucun changement de déploiement requis. Le suivi à usage unique et le compteur d'essais sont dans Redis : **si Redis est indisponible, le challenge MFA échoue (fail-closed)**.
3. **S1 : sémantique de `active=false`.** Retrait de la `Membership` du workspace (option « supprimer la Membership » du rapport) plutôt qu'un `Membership.suspendedAt` : un nouveau champ devrait être vérifié par la dizaine de contrôles d'appartenance existants (A2), sinon la suspension serait illusoire. Voir l'entrée S1 pour la réactivation.
4. **S5 : droits.** `sync` et `export` réservés à OWNER/ADMIN (rapport) ; la lecture des conflits reste ouverte aux membres (non demandé par le rapport, sera revue en S12/S14).
5. **Emplacement des tests HTTP.** Il n'existe ni `supertest` ni configuration e2e (`jest-e2e.json`) : les tests de routes sont écrits dans `backend/tests/http/*.spec.ts` (application Nest réelle, `listen(0)` puis `fetch` natif de Node), sans base de données. La suite e2e sur une vraie base relève de A9/P7 (Phase 6). Aucune dépendance ajoutée.

---

## Entrées par constat

### P3 — Interrupteurs FEATURE_SSO_ENABLED / FEATURE_SCIM_ENABLED

- **Statut** : `CORRIGÉ – À REVOIR` (reprise r2 du 2026-10-30, voir « Reprise fixeur » plus bas ; statut initial remplacé)
- **Cause confirmée** : aucune condition d'activation ; `SsoController` et `ScimController` sont enregistrés sans condition dans `AuthModule` (`backend/src/auth/auth.module.ts`), donc tout utilisateur peut configurer le SSO et créer des clés SCIM.
- **Changement** :
  - `backend/src/config/features.ts` (nouveau) : `isFeatureEnabled('SSO' | 'SCIM')`, actif seulement si la variable vaut exactement `'true'` ; `getFeatureFlags()`.
  - `backend/src/config/feature-flag.guard.ts` (nouveau) : décorateur `@RequireFeature(flag)` + `FeatureFlagGuard`, qui lève `NotFoundException` (404 sans message spécifique).
  - `backend/src/auth/sso/sso.controller.ts` et `backend/src/auth/scim/scim.controller.ts` : `@RequireFeature(...)` + `@UseGuards(FeatureFlagGuard)` **au niveau de la classe**. Nest exécute les guards de classe avant ceux de méthode : le 404 précède `JwtAuthGuard`/`ScimAuthGuard` (aucune requête Prisma, aucun 401 révélateur) et précède aussi le `ValidationPipe`.
  - `backend/src/app.controller.ts` : `GET /features` public → `{ sso, scim }`.
  - `frontend/src/components/Login.tsx` : l'onglet « SSO Entreprise » n'est affiché que si `GET /features` renvoie `sso: true` (masqué par défaut et en cas d'erreur réseau). Il n'existe pas d'écran SCIM ni d'écran de configuration SSO dans le frontend.
  - `.env.example`, `.env.production.example` : `FEATURE_SSO_ENABLED=false`, `FEATURE_SCIM_ENABLED=false` documentés.
- **Tests** :
  - `backend/tests/http/feature-flags.spec.ts` (12 tests, application Nest réelle + `fetch`) : `POST /auth/sso/callback`, `/auth/sso/discover`, `GET /auth/sso/authorize`, `GET /workspaces/:id/sso`, `GET /scim/v2/Users`, `GET /scim/v2/ServiceProviderConfig`, `POST|GET|DELETE /workspaces/:id/scim/keys` → 404 sans appel de service ni de Prisma ; valeurs `'1'`/`'yes'` → toujours 404 ; drapeaux à `true` → routes servies (et la gestion des clés renvoie 401 sans jeton) ; `GET /features`. **Avant correctif : 11 échecs sur 12** (routes servies) ; après : 12/12.
  - `frontend/src/components/Login.spec.tsx` (3 tests) : onglet masqué si `sso:false` ou serveur injoignable, affiché si `sso:true`. Contre le `Login.tsx` d'origine : 2 échecs ; après : 3/3.
  - Suite backend 34/34 suites, 208/208 tests ; `pnpm build` OK. Frontend 9/9 fichiers, 21/21 tests ; `pnpm build` OK.
- **Écart par rapport au rapport** :
  - Le drapeau n'est pas encore lu par une « config validée » (A7, Phase 5) : lecture directe de `process.env` à chaque requête, centralisée dans `features.ts`, à brancher sur A7.
  - Pas d'activation par workspace (`Workspace.plan = ENTERPRISE`) : prévue par le rapport « après la Phase 2 ».
  - La console admin et l'impersonation (mentionnées dans P3) ne sont **pas** placées derrière un drapeau : le critère d'acceptation ne porte que sur SSO et SCIM, et elles sont réservées aux `platformRole` (S18 en Phase 4).
  - Tests dans `backend/tests/http/` et non `tests/e2e/*.e2e-spec.ts` (voir décision 5 du plan).
- **Questions pour l'architecte** : faut-il aussi placer `/admin/impersonate` derrière un drapeau en attendant S18 ?

#### Revue architecte

- **Verdict : À REPRENDRE** (mineur : le fond est validé, reste uniquement la régression de lint décrite plus bas ; pas de nouvelle revue de fond nécessaire)
- **Vérifications (2026-10-29)** : code relu (`config/features.ts`, `config/feature-flag.guard.ts`, `sso.controller.ts`, `scim.controller.ts`, `app.controller.ts`, `Login.tsx`). Le guard est posé au niveau de la classe ; Nest exécute les guards de classe avant ceux de méthode, donc le 404 précède `JwtAuthGuard` et `ScimAuthGuard`. Aucun autre point d'entrée n'appelle `SsoService`/`ScimService` hors de ces contrôleurs (`grep` effectué). Suites relancées : backend 36/36 suites, 269/269 tests ; frontend 10/10 fichiers, 24/24 tests ; `pnpm build` backend et frontend OK.
- **Écarts acceptés** : lecture directe de `process.env` centralisée dans `features.ts` (à brancher sur A7) ; tests HTTP dans `backend/tests/http/` (pas de supertest : acceptable jusqu'à A9/P7) ; activation par workspace reportée à l'après Phase 2.
- **Réponse à la question (impersonation)** : **oui**. Aujourd'hui, un PLATFORM_ADMIN peut impersonner un SUPER_ADMIN et obtient un jeton complet de 7 jours (S18). Mesure transitoire à livrer **maintenant**, enregistrée au rapport comme étape 0 de S18 :
  - drapeau `FEATURE_IMPERSONATION_ENABLED`, désactivé par défaut ;
  - `POST /admin/users/:id/impersonate` renvoie 404 quand le drapeau est faux ;
  - bouton masqué dans `AdminConsole.tsx` via `GET /features` (ajouter `impersonation`).
  
  Tests attendus : route en 404 drapeau absent, servie drapeau à `true` ; test vitest du bouton masqué.
- **Régression à corriger** : `npx eslint backend/tests/http/feature-flags.spec.ts` donne `78:16 error Delete ⏎····· prettier/prettier`. Le job CI `pnpm lint` échouerait. Lancer `npx eslint --fix` sur ce fichier.

#### Reprise fixeur (r2, 2026-10-30)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Lint** : `npx eslint --fix backend/tests/http/feature-flags.spec.ts` (ligne 78). Le test `GET /features` attend désormais aussi `impersonation: false`, puisque la mesure transitoire S18 étape 0 ajoute ce drapeau (voir l'entrée dédiée).
- **Tests** : `feature-flags.spec.ts` 12/12.

#### Revue architecte (r2, 2026-10-30)

- **Verdict : VALIDÉ**
- **Vérifications** :
  - ESLint sur `feature-flags.spec.ts` : 0 erreur ;
  - le test `GET /features` couvre `impersonation` ;
  - suites relancées : vertes.

### S3 — Le ticket MFA est accepté comme jeton d'accès

- **Statut** : `CORRIGÉ – À REVOIR` (reprise r2 du 2026-10-30, voir « Reprise fixeur » plus bas ; statut initial remplacé)
- **Cause confirmée** : `auth.service.ts` (avant correctif, l.425-429) signe `{sub, mfaPending:true}` avec `JWT_SECRET` ; `jwt.guard.ts:33-38` et `tracking.gateway.ts:72` / `notifications.gateway.ts:66` ne vérifiaient que la signature. Démontré par le test HTTP : `GET` protégé avec `Bearer <mfaTicket>` → **200** avant correctif.
- **Changement** :
  - `backend/src/auth/token.service.ts` (nouveau) : `signAccessToken` (ajoute `typ:'access'`), `verifyAccessToken` (HS256 imposé ; rejette tout jeton sans `typ:'access'`, contenant `mfaPending` ou sans `sub`), `signMfaTicket` (`typ:'mfa_ticket'`, `aud:'mfa-challenge'`, `jti` UUID, 300 s, **clé dérivée par HKDF-SHA256 de `JWT_SECRET`**, label `planner-pro:mfa-ticket:v1`), `verifyMfaTicket` (clé dédiée, audience, `typ`, `jti`).
  - `backend/src/auth/token.module.ts` (nouveau, `@Global`), importé par `AuthModule` (avec `RedisModule`).
  - `backend/src/auth/jwt.guard.ts` : délègue à `TokenService.verifyAccessToken`.
  - `backend/src/tracking/tracking.gateway.ts`, `backend/src/notifications/notifications.gateway.ts` : idem au handshake (le `catch` existant déconnecte).
  - `backend/src/auth/auth.service.ts` : toutes les émissions passent par `signAccessToken` ; `login` émet le ticket via `signMfaTicket` et enregistre `mfa_ticket:<jti>` dans Redis (TTL 300 s) ; `verifyMfaChallenge` : vérification du ticket → présence dans Redis (sinon 401) → compteur `mfa_ticket:<jti>:attempts` (au-delà de 5, ticket supprimé, 401) → code TOTP (au 5e échec, ticket supprimé) → **consommation atomique** par `DEL` (=1 exigé, protège contre deux requêtes concurrentes) → émission du jeton d'accès.
  - `backend/src/auth/sso/sso.service.ts`, `backend/src/admin/admin.service.ts` : émission via `signAccessToken` (sinon leurs jetons seraient rejetés).
  - `backend/src/redis/redis.service.ts` : `del` renvoie le nombre de clés supprimées ; nouveau `incrementWithTtl` (`MULTI INCR + EXPIRE NX`, Redis ≥ 7 : image `redis:7-alpine` dans les deux compose).
- **Tests** :
  - `backend/tests/http/mfa-ticket.spec.ts` (6 tests, `AuthController` + `AuthService` réels, Prisma simulé, Redis en mémoire `tests/http/fake-redis.ts`) : ticket en `Bearer` → 401 ; ticket en cookie `accessToken` → 401 ; jeton signé sans `typ` → 401 ; ticket au format historique `{sub, mfaPending}` → 401 au challenge ; challenge réussi → le jeton d'accès donne 200, puis le rejeu du ticket → 401 ; 5 codes faux, puis code valide au 6e essai → 401. **Avant correctif : 6/6 en échec** (200/201 reçus) ; après : 6/6.
  - `notifications.gateway.spec.ts` : handshake avec ticket MFA, jeton sans `typ` et jeton historique `mfaPending` → `disconnect(true)`, aucune room rejointe, aucune requête `membership`. `tracking.gateway.spec.ts` : ticket MFA et jeton sans `typ` → `disconnect(true)`. Les deux specs utilisent désormais un vrai `JwtService` + `TokenService` (le test existant de la gateway notifications signe un vrai jeton d'accès au lieu de simuler `verifyAsync`).
  - Specs adaptées sans changement d'assertion : `auth.service.spec.ts`, `sso.service.spec.ts`, `admin.service.spec.ts`.
  - Vérification ponctuelle (spec temporaire supprimée) : `Test.createTestingModule({ imports: [AppModule] }).compile()` résout tout le graphe d'injection.
  - Suite backend 34/34 suites, 208/208 tests ; `pnpm build` OK.
- **Changements cassants** : tous les jetons émis avant ce correctif (sans `typ`) sont rejetés, ce qui **force une reconnexion de tous les utilisateurs** (sessions HTTP et WebSocket). À mentionner au changelog, comme le prévoit le rapport. Aucun changement frontend nécessaire : le ticket n'est envoyé que dans le corps de `POST /auth/mfa/challenge`.
- **Écart par rapport au rapport** :
  - Clé du ticket dérivée par HKDF plutôt que `MFA_TICKET_SECRET` obligatoire (le rapport autorise les deux). Conséquence : une fuite de `JWT_SECRET` compromet aussi la clé du ticket. Acceptable, car `JWT_SECRET` permet déjà de forger des jetons d'accès.
  - L'émission n'est centralisée que pour le claim `typ` (`signAccessToken`) ; durée, `jti`/`sid` et cookies restent pour A3/S7 (Phase 1). L'impersonation conserve son claim `impersonatedBy` (S18).
  - **Fail-closed** : si Redis est indisponible, `login` (comptes MFA) et `mfa/challenge` échouent en 500. Les comptes sans MFA ne sont pas affectés.
- **Questions pour l'architecte** : le fail-closed sur Redis est-il acceptable, ou faut-il une réponse 503 explicite ?

#### Revue architecte

- **Verdict : À REPRENDRE** (le correctif de sécurité est bon ; il reste une seule reprise, de disponibilité)
- **Vérifications** : `token.service.ts` relu. Les points suivants sont conformes :
  - HS256 imposé ;
  - `typ:'access'` exigé et `mfaPending` rejeté ;
  - ticket signé avec une clé HKDF distincte, plus `aud` et `jti` ;
  - consommation atomique par `DEL === 1` ;
  - compteur d'essais : 5 échecs, puis ticket supprimé.
  
  `grep -rn "jwtService.sign\|verifyAsync" backend/src` : seules occurrences dans `token.service.ts`, il ne reste donc aucun chemin d'émission ou de vérification parallèle. Les deux gateways passent par `verifyAccessToken`. HKDF dérivé de `JWT_SECRET` : accepté (le rapport l'autorisait). Invalidation de tous les jetons existants : acceptée, à annoncer au changelog et aux utilisateurs.
- **Réponse à la question (Redis indisponible)** : le fail-closed est le bon principe, mais il **n'est pas un 500 aujourd'hui, c'est un blocage**. `RedisService` crée le client avec `maxRetriesPerRequest: null` (`redis.service.ts:15`), donc ioredis met les commandes en file **indéfiniment** pendant la reconnexion. `login` (comptes MFA) et `mfa/challenge` restent alors suspendus jusqu'au timeout du proxy (504), ce qui mobilise des sockets et donne un diagnostic trompeur. Décision : **503 explicite et borné dans le temps**.
  1. Dans `AuthService`, envelopper chaque appel Redis du parcours MFA (`set` du ticket au login, `get`, `incrementWithTtl`, `del` au challenge) dans un helper `withRedisTimeout(promise, 2000)`. Sur erreur ou dépassement : `ServiceUnavailableException('Validation MFA momentanément indisponible, réessayez.')`. Ne jamais émettre de jeton ni de ticket dans ce cas.
  2. Ne pas modifier `maxRetriesPerRequest` globalement en Phase 0 : le cache des notes en dépend ; ce point sera traité en A7.
  3. Comptes sans MFA : comportement inchangé.
- **Tests attendus** : `mfa-ticket.spec.ts` avec un faux Redis dont `set` puis `get` (a) rejette, (b) ne se résout jamais (timers factices) : `POST /auth/login` (compte MFA) et `POST /auth/mfa/challenge` renvoient 503 en moins de 2,5 s, sans `accessToken` ni `mfaTicket` dans la réponse.

#### Reprise fixeur (r2, 2026-10-30)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `backend/src/auth/auth.service.ts` : constante `MFA_REDIS_TIMEOUT_MS = 2000` et helper privé `withRedisTimeout()` (`Promise.race` avec un délai, `clearTimeout` dans `finally`). Sur erreur **ou** dépassement : `ServiceUnavailableException('Validation MFA momentanément indisponible, réessayez.')`. Les six appels Redis du parcours MFA sont enveloppés : `set` du ticket au login ; `get`, `incrementWithTtl` et les trois `del` au challenge. Le `set` précède le `return` du login, donc aucun ticket n'est remis si Redis échoue ; au challenge, le jeton n'est émis qu'après le `del` atomique. `maxRetriesPerRequest` n'est **pas** modifié (il reste à traiter en A7). Comptes sans MFA : aucun appel Redis, comportement inchangé.
- **Tests** : `backend/tests/http/fake-redis.ts` reçoit un `mode` (`ok` / `reject` / `hang`) ; `mfa-ticket.spec.ts` gagne 4 tests : `POST /auth/login` (compte MFA) et `POST /auth/mfa/challenge` avec Redis qui rejette ou ne répond jamais renvoient **503 en moins de 2,5 s**, sans `mfaTicket`, sans `accessToken` et sans `Set-Cookie`. Mesures réelles : environ 370 ms et 2 241 ms (login), 201 ms et 2 190 ms (challenge). **Avant correctif** : `reject` donnait 500, et `hang` laissait la requête suspendue jusqu'au délai du test (4 échecs). Après : 10/10. Timers réels plutôt que factices, car la requête traverse un vrai serveur HTTP ; le coût est d'environ 4,4 s.

#### Revue architecte (r2, 2026-10-30)

- **Verdict : VALIDÉ**
- **Vérifications** :
  - `withRedisTimeout` (`auth.service.ts:534-548`) : `Promise.race` avec un délai de 2 s, `clearTimeout` dans `finally`, et 503 sur erreur comme sur dépassement ;
  - les six appels Redis du parcours MFA passent par ce helper (l.436, 566, 574, 578, 596, 602) ;
  - le `set` précède le `return` du ticket, et le jeton n'est émis qu'après un `del === 1` ;
  - tests `reject`/`hang` en 503 en moins de 2,5 s, présents et verts dans la suite.
- **Note** : si le délai expire alors que le `del` final finit par aboutir, le ticket est consommé et l'utilisateur doit se reconnecter. C'est acceptable (fail-closed). `maxRetriesPerRequest: null` reste à traiter en A7.

### S2 — SSO : authentification sans vérification via le repli « générique » (SAML2 / OIDC_GENERIC)

- **Statut** : `CORRIGÉ – À REVOIR` (reprise r2 du 2026-10-30, voir « Reprise fixeur » plus bas ; statut initial remplacé)
- **Cause confirmée** : `backend/src/auth/sso/sso.service.ts` (avant correctif, l.201-206) : la branche `else` fixait `email = user@<domaine>` et `ssoUid = generic:<domaine>:<code>` sans aucun appel à un IdP ; `getAuthorizationUrl` redirigeait vers `entryPoint` (l.110-116) ; `ConfigureSsoDto.provider` acceptait tout `SSOProvider` (`@IsEnum`).
- **Changement** :
  - `sso.service.ts` : `IMPLEMENTED_SSO_PROVIDERS = [OIDC_AZURE_AD, OIDC_GOOGLE]` et `assertProviderImplemented()` (`NotImplementedException`, 501), appelé dans `handleCallback` juste après le contrôle `enabled`, **avant** tout `fetch`, toute recherche ou création d'utilisateur et toute émission de jeton, ainsi que dans `getAuthorizationUrl`. Branche de repli supprimée (remplacée par un 501 défensif) ; redirection `entryPoint` supprimée.
  - `sso.dto.ts` : `@IsIn([OIDC_AZURE_AD, OIDC_GOOGLE])` sur `provider`.
  - Migration de données `backend/prisma/migrations/20261108000000_s2_disable_unimplemented_sso_providers/migration.sql` : `UPDATE SSOConfiguration SET enabled = FALSE WHERE provider IN ('SAML2','OIDC_GENERIC') AND enabled = TRUE`. Le nom est horodaté après la dernière migration existante (`20261107140000_…`) pour respecter l'ordre d'application de Prisma.
- **Tests** (`backend/src/auth/sso/sso.service.spec.ts`, 7 tests ajoutés) : `handleCallback` en `SAML2` et en `OIDC_GENERIC` avec un code arbitraire et `defaultRole: OWNER` → `NotImplementedException`, et `user.findFirst`/`create`/`update`, `membership.create`, `jwtService.sign`, `fetch` jamais appelés ; `getAuthorizationUrl` SAML2 avec `entryPoint` → 501 ; DTO `SAML2`/`OIDC_GENERIC` → erreur sur `provider`, `OIDC_AZURE_AD`/`OIDC_GOOGLE` → valide. **Avant correctif : 5 échecs** ; après : 12/12. Suite backend 34/34 suites, 215/215 tests ; build OK.
- **Écart par rapport au rapport** : aucun. Le point 5 (drapeau `FEATURE_SSO_ENABLED`) est couvert par P3.
- **Reprise des données (à faire par l'exploitant)** : des comptes ou memberships ont pu être créés par le repli. Requête de revue, lecture seule, **non exécutée** :

  ```sql
  SELECT u.id, u.email, u.createdAt, m.workspaceId, m.role
  FROM `User` u LEFT JOIN `Membership` m ON m.userId = u.id
  WHERE u.ssoUid LIKE 'generic:%';
  ```

  Les sessions déjà émises par ce chemin sont invalidées par S3 (jetons sans `typ` rejetés).
- **Questions pour l'architecte** : faut-il supprimer automatiquement les memberships créées par le repli (`ssoUid LIKE 'generic:%'`) ou laisser la décision à l'exploitant (choix actuel) ?

#### Revue architecte

- **Verdict : À REPRENDRE** (mineur : le code est validé sur le fond, reste uniquement la régression de lint décrite plus bas). La reprise des données est suivie séparément dans un nouveau constat **S28**.
- **Vérifications** : `assertProviderImplemented` est appelé avant tout `fetch`, toute recherche ou création d'utilisateur et toute émission de jeton. La branche de repli est supprimée, tout comme la redirection `entryPoint`. Le DTO utilise `@IsIn` sur les deux fournisseurs implémentés. `configureWorkspaceSSO` ne peut plus réécrire un fournisseur SAML2, puisque l'upsert prend le fournisseur du DTO. Migration SQL relue : idempotente, sans changement de schéma, ordre correct. `prisma validate` OK.
- **Réponse à la question (memberships `generic:%`)** : **pas de suppression dans une migration** (irréversible et non relue), mais pas non plus une décision laissée à l'appréciation de l'exploitant. Toute membership issue du repli a été obtenue **sans authentification** et doit donc être retirée. Le risque n'est pas théorique : un compte `user@domaine` créé par le repli peut ensuite être « récupéré » par une connexion Firebase avec le même e-mail (liaison automatique, S8) et hériter de cette membership. À livrer par un script, au titre de **S28** (voir rapport) :
  - `backend/scripts/cleanup-generic-sso.ts`, en mode rapport par défaut, suppression seulement avec `--apply`, le tout dans une transaction ;
  - pour chaque `User` dont `ssoUid LIKE 'generic:%'` :
    1. supprimer ses `Membership` dans les workspaces dont la `SSOConfiguration.provider` vaut `SAML2` ou `OIDC_GENERIC`. Si la membership est `OWNER`, la signaler sans la supprimer ;
    2. mettre `ssoUid = NULL` ;
    3. si le compte n'a aucun autre moyen d'authentification (`passwordHash`, `firebaseUid` et `githubId` tous nuls) et plus aucune membership, passer `isSuspended = true` ;
  - sortie : CSV des comptes et memberships traités.
- **Régression à corriger** : `backend/src/auth/sso/sso.dto.ts:1:9 error prettier/prettier` (import sur une seule ligne trop longue). Lancer `npx eslint --fix`.

#### Reprise fixeur (r2, 2026-10-30)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Lint** : `npx eslint --fix backend/src/auth/sso/sso.dto.ts` (import découpé sur plusieurs lignes).
- **Données** : nettoyage des memberships `generic:%` livré dans **S28** (script `backend/scripts/cleanup-generic-sso.ts`).

#### Revue architecte (r2, 2026-10-30)

- **Verdict : VALIDÉ**
- **Vérifications** :
  - ESLint sur `sso.dto.ts` : 0 erreur ;
  - nettoyage des données livré dans S28 (revu dans l'entrée S28).

### S1 — SCIM : modification et suspension globale de comptes d'autres tenants, révocation de clés inter-workspace

- **Statut** : `À VALIDER PAR L'ARCHITECTE` (correctif complet et testé ; écarts 1 à 3 ci-dessous à arbitrer)
- **Cause confirmée** (`backend/src/auth/scim/scim.service.ts`, avant correctif) : `createUser` (l.114-171) rattachait tout utilisateur existant par e-mail et écrivait `User.isSuspended` ; `updateUser` (l.174-197) écrivait `User.email`, `User.name` et `User.isSuspended` ; `patchUser` (l.200-232) écrivait `User.isSuspended` et `User.name` ; `revokeApiKey` (l.315-322) faisait `update({ where: { id: keyId } })` sans `workspaceId`. Le test existant « suspend un utilisateur lors d'un patch active: false » **validait le comportement vulnérable** (écriture globale `isSuspended: true`) : il a été remplacé.
- **Changement** :
  - Schéma : `User.provisionedByWorkspaceId String?` (FK vers `Workspace`, `onDelete: SetNull`, index) dans `backend/prisma/schema/auth.prisma` ; relation inverse `Workspace.scimProvisionedUsers` dans `workspace.prisma`. Migration `backend/prisma/migrations/20261108000100_s1_scim_provisioned_by_workspace/migration.sql`, SQL généré par `prisma migrate diff` (schéma avant / après), donc conforme au schéma.
  - `scim.service.ts` :
    - **Visibilité** (`resolveScimUser`) : un utilisateur est visible par le workspace W s'il est membre de W **ou** s'il a été créé par la clé SCIM de W (`provisionedByWorkspaceId = W`). Sinon 404.
    - **`active`** = appartenance au workspace, jamais `User.isSuspended` (`applyActiveState`) : `false` supprime la membership de W, `true` la recrée en `MEMBER` (cas possible seulement pour un compte provisionné par W). **`User.isSuspended` n'est plus écrit nulle part par SCIM.**
    - `createUser` : e-mail existant → **409** au format SCIM (`scimType: uniqueness`), sans aucune écriture. Nouvel utilisateur : `provisionedByWorkspaceId = W` ; membership créée seulement si `active !== false`.
    - `updateUser` / `patchUser` : un changement d'e-mail (`userName`, `emails`) → **400** (`scimType: mutability`), `User.email` jamais écrit ; nom modifié seulement si `provisionedByWorkspaceId = W` (sinon ignoré).
    - Une membership `OWNER` ne peut pas être retirée par SCIM (400 `mutability`).
    - `deleteUser` : retire la membership et, pour un compte créé par W, remet `provisionedByWorkspaceId` à `null` (`updateMany` conditionnel).
    - `revokeApiKey` : `updateMany({ where: { id, workspaceId, revokedAt: null } })`, **404 si `count === 0`** ; renvoie `{ id, revokedAt }` (et non plus l'enregistrement complet).
- **Tests** (`backend/src/auth/scim/scim.service.spec.ts`, 11 tests ajoutés, 1 test vulnérable remplacé) : POST e-mail existant → 409, aucune création ni mise à jour ; POST nouveau compte → `provisionedByWorkspaceId` renseigné, jamais `isSuspended: true` ; PUT avec un nouvel `userName` → aucune écriture de `email` ni de `isSuspended` ; PUT du nom d'un compte non provisionné → aucune écriture ; PUT du nom d'un compte provisionné par W → écrit ; PATCH `active=false` → aucune écriture `isSuspended`, une seule suppression de membership, ciblée sur W ; PATCH `active=true` d'un compte provisionné → membership MEMBER recréée ; cible ni membre ni provisionnée → 404 ; OWNER → 400 ; révocation d'une clé de B par un OWNER de A → 404, `update` jamais appelé, `where` contenant `workspaceId: A` ; révocation de sa propre clé → OK. Les deux tests PUT simulent aussi le chemin historique (`membership.findUnique` renvoie la victime), pour qu'ils échouent réellement avant correctif. **Avant correctif : 10 échecs sur 13** (les 3 tests restants sont des invariants déjà respectés) ; après : 13/13. Suite backend 34/34 suites, 225/225 tests ; build OK.
- **Écart par rapport au rapport** (le reste est conforme) :
  1. **Réactivation** : le rapport impose « toujours 409 pour un utilisateur existant » d'ici la Phase 2. Je le respecte. Mais un IdP qui désactive puis réactive un utilisateur ne pourrait plus jamais le rattacher. J'ai donc rendu les comptes **créés par W** visibles de W même sans membership, pour que `PATCH active=true` les réactive. Cela n'ouvre pas de chemin vers un compte que W n'a pas créé. Les comptes non provisionnés par W (arrivés par invitation, par exemple) disparaissent de la vue SCIM de W après `active=false` ; leur réactivation passe par une nouvelle invitation.
  2. **E-mail** : un changement d'e-mail est **refusé en 400** (`mutability`) plutôt qu'ignoré silencieusement, pour ne pas laisser l'IdP croire que la modification a été appliquée.
  3. **Protection de l'OWNER** (ajout non demandé) : sans elle, une clé SCIM pouvait retirer le propriétaire de son propre workspace.
  4. Point 5 (audit des opérations SCIM) : non traité, relève de A8 (Phase 6).
- **Migration et reprise des données** : colonne nullable, aucun backfill. Les comptes déjà créés par SCIM avant la migration ont `provisionedByWorkspaceId = NULL` : leur nom n'est plus modifiable par SCIM et ils ne sont pas réactivables après désactivation. **Comptes suspendus globalement par SCIM avant le correctif** (potentiellement par un attaquant, y compris des SUPER_ADMIN) : impossible de les distinguer d'une suspension admin, faute d'audit SCIM. Requête de revue, lecture seule, **non exécutée** :

  ```sql
  SELECT u.id, u.email, u.platformRole, u.createdAt,
         (SELECT COUNT(*) FROM `PlatformAuditLog` l WHERE l.targetId = u.id) AS adminActions
  FROM `User` u WHERE u.isSuspended = TRUE;
  ```

  De même, les e-mails modifiés par `PUT` avant le correctif ne sont pas détectables (pas d'historique).
- **Risque résiduel** : la **pré-occupation de compte** reste possible. Une clé SCIM peut créer `victime@corp.com` avant l'inscription de la victime. La liaison Firebase par e-mail (`auth.service.ts`, S8) rattachera ensuite la victime à ce compte créé par le workspace de l'attaquant. Celui-ci ne peut plus changer l'e-mail, mais conserve le droit de modifier le nom et de réactiver la membership. À traiter avec S8 (liaison jamais automatique) et S10 (domaine vérifié). SCIM reste désactivé par défaut (P3).
- **Questions pour l'architecte** : (a) la visibilité « membre ou provisionné par W » est-elle acceptée ? (b) 400 ou ignorance silencieuse pour un changement d'e-mail ? (c) faut-il exiger un domaine vérifié pour `createUser` dès la réactivation du drapeau (Phase 2) ?

#### Revue architecte

- **Verdict : VALIDÉ** (écarts 1 à 3 acceptés ; la remédiation S1 du rapport est mise à jour en conséquence)
- **Vérifications** : `scim.service.ts` relu en entier.
  - Aucune écriture de `User.email` ni de `User.isSuspended`.
  - `active` agit uniquement sur la `Membership` du workspace de la clé.
  - Le 409 sur un e-mail existant intervient avant toute écriture.
  - Le nom n'est modifiable que si `provisionedByWorkspaceId = W`.
  - `revokeApiKey` passe par `updateMany` filtré sur `workspaceId`, avec 404 si `count = 0`.
  - La migration est générée par `migrate diff` (FK `SET NULL`, index) ; `prisma validate` OK.
  
  Tests relancés : verts.
- **Réponses** :
  - (a) **Accepté.** La visibilité « membre de W ou créé par W » est le minimum nécessaire au cycle désactivation/réactivation des IdP et n'ouvre aucun compte que W n'a pas créé. Les comptes arrivés par invitation reviennent par une nouvelle invitation : comportement correct.
  - (b) **400 (`mutability`) retenu**, car l'IdP doit savoir que la modification n'est pas appliquée. **Remarque non bloquante** : un `PATCH` sur un chemin `emails[...]` dont la valeur est une chaîne ou un tableau est aujourd'hui **ignoré silencieusement** (`op.value?.userName` est `undefined`), et non refusé en 400. Ce n'est pas exploitable (l'e-mail n'est jamais écrit), mais c'est incohérent. Correction rattachée à **S11** (Phase 2), avec un test : `PATCH {op:'replace', path:'emails[type eq "work"].value', value:'x@y.com'}` donne 400.
  - (c) **Oui.** À la réactivation de `FEATURE_SCIM_ENABLED` (fin de Phase 2), `createUser` exige que le domaine de l'e-mail soit égal au domaine **vérifié** (DNS, S10) de la `SSOConfiguration` du workspace, sinon 403 (`scimType: invalidValue`). Ajouté à la remédiation de **S11** et aux conditions de réactivation de P3.
- **Écart 3 (protection de l'OWNER)** : accepté, c'est une bonne initiative.
- **Risque résiduel (pré-occupation de compte)** : confirmé. Rattaché à **S8** (la liaison Firebase/GitHub/SSO ne se fait jamais automatiquement vers un compte existant, a fortiori un compte avec `provisionedByWorkspaceId` non nul) et à **S11** (domaine vérifié). Il reste contenu tant que SCIM est désactivé (P3).
- **Reprise des données** (comptes suspendus ou e-mails modifiés par SCIM avant le correctif) : rattachée à **S28** (procédure de revue avec l'exploitant).

### S4 — Connecteur MariaDB vulnérable, échange d'identifiants non sécurisé, DSN root par défaut

- **Statut** : `CORRIGÉ – À REVOIR` (reprise r2 du 2026-10-30, voir « Reprise fixeur » plus bas ; statut initial remplacé)
- **Cause confirmée** : `pnpm why mariadb` montrait `@prisma/adapter-mariadb 7.8.0 → mariadb 3.4.5` (version chargée par Prisma) et la dépendance directe `mariadb 3.5.3` ; `backend/src/prisma/prisma.service.ts:9-10` (avant correctif) repliait sur `mysql://root:root_password@localhost…` quel que soit `NODE_ENV` ; l.18 : `allowPublicKeyRetrieval: true` sans TLS ; `backend/wait-for-db.js` : idem.
- **Changement** :
  - `package.json` racine : `"pnpm": { "overrides": { "mariadb": ">=3.5.4 <4" } }` ; `backend/package.json` : `mariadb ^3.5.4`. `pnpm-lock.yaml` régénéré par `pnpm install`, puis reformaté avec Prettier comme l'original : le diff réel se limite à 10 ajouts et 51 suppressions (suppression de `mariadb@3.4.5`/`3.5.3` et de leurs dépendances orphelines, ajout de `mariadb@3.5.4`).
  - `prisma.service.ts` : fonction exportée `buildMariaDbOptions(env)`. Sans `DATABASE_URL` et avec `NODE_ENV` hors liste blanche `{development, test}` (production, staging, absent) → **erreur au démarrage**. `DATABASE_SSL=true` → `ssl: { rejectUnauthorized: true, ca? }` (`DATABASE_SSL_CA` = chemin d'un fichier PEM). `DATABASE_RSA_PUBLIC_KEY` (chemin) → `cachingRsaPublicKey` (clé épinglée). `allowPublicKeyRetrieval` vaut `true` **uniquement** en development/test sans TLS ni clé épinglée.
  - `backend/wait-for-db.js` : mêmes règles.
  - `docker-compose.yml` (développement) : `NODE_ENV: development` ajouté au service backend. Sans cet ajout, le compose de développement (mysql:8.0, `NODE_ENV` absent) perdait `allowPublicKeyRetrieval`. Vérifié : tous les autres tests de `NODE_ENV` du backend portent sur `production` ou `test`, donc `development` ne change aucun autre comportement.
  - `.env.example`, `.env.production.example` : `NODE_ENV`, `DATABASE_SSL`, `DATABASE_SSL_CA`, `DATABASE_RSA_PUBLIC_KEY` documentés.
- **Tests** : `backend/src/prisma/prisma.service.spec.ts` (14 tests) : production sans `DATABASE_URL` → `new PrismaService()` lève une erreur ; `NODE_ENV` absent, `staging` ou `prod` sans `DATABASE_URL` → erreur ; development/test → repli local ; analyse et décodage du DSN ; production, absent ou staging → `allowPublicKeyRetrieval === false` ; `DATABASE_SSL=true` → `rejectUnauthorized: true` et pas de récupération de clé ; `DATABASE_SSL_CA` chargé ; développement sans TLS → `true` ; clé épinglée → `cachingRsaPublicKey`, pas de récupération. **Avant correctif** : échec de compilation (`buildMariaDbOptions` absente) ; sur le code d'origine, `new PrismaService()` ne levait rien en production (repli root). Après : 14/14. Vérifications : `pnpm why mariadb -r` → uniquement `3.5.4` (adaptateur Prisma et dépendance directe) ; `pnpm audit --prod` → **0 avis `mariadb`** (71 avis restants, hors périmètre : S25) ; `pnpm install --frozen-lockfile` OK. Suite backend 35/35 suites, 239/239 tests ; build OK.
- **IMPACT DE DÉPLOIEMENT (bloquant)** : `docker-compose.prod.yml` joint `mysql:8.0` **en clair** (`NODE_ENV: production`, sans TLS). L'authentification par défaut de MySQL 8 (`caching_sha2_password`) exige, quand le cache du serveur est vide (premier démarrage, redémarrage de MySQL), soit TLS, soit la clé RSA du serveur. Avec `allowPublicKeyRetrieval=false` imposé par le rapport, **`wait-for-db.js` puis le backend échoueront à se connecter en production** tant que l'exploitant n'a pas choisi l'une des options suivantes :
  1. (recommandé) TLS : MySQL 8 génère ses certificats au premier démarrage. Copier le `ca.pem` du serveur vers un secret monté en lecture seule dans le backend, puis `DATABASE_SSL=true` et `DATABASE_SSL_CA=<chemin>` (variables à ajouter au bloc `environment` de `docker-compose.prod.yml`, qui n'utilise pas d'`env_file`).
  2. Clé épinglée : copier `public_key.pem` du datadir MySQL, puis `DATABASE_RSA_PUBLIC_KEY=<chemin>` (option ajoutée par rapport au rapport : même objectif, aucune clé acceptée depuis le réseau).
  Je n'ai **pas** modifié `docker-compose.prod.yml` : la gestion des secrets et des volumes est une décision d'exploitation.
- **Écart par rapport au rapport** : (1) borne `<4` sur l'override, pour éviter une montée de version majeure non testée ; (2) option `DATABASE_RSA_PUBLIC_KEY` ajoutée ; (3) `prisma.config.ts:7` (CLI Prisma : `migrate deploy`) garde son repli `root` : hors du périmètre cité par le rapport, signalé comme risque résiduel (une migration lancée sans `DATABASE_URL` viserait `localhost`) ; (4) étape CI `pnpm audit` : A9 (Phase 6).
- **Questions pour l'architecte** : (a) quelle option retenir pour la production (TLS ou clé épinglée), et faut-il que je modifie `docker-compose.prod.yml` en conséquence ? (b) faut-il corriger aussi le repli de `prisma.config.ts` dès maintenant ?

#### Revue architecte

- **Verdict : À REPRENDRE** (le code applicatif est conforme ; le correctif n'est pas encore déployable)
- **Vérifications** :
  - `pnpm why mariadb -r` : uniquement `mariadb 3.5.4`, chargé à la fois par `@prisma/adapter-mariadb` et par la dépendance directe.
  - `pnpm audit --prod` : plus aucun avis `mariadb` (72 avis restants : S25).
  - `buildMariaDbOptions` relu : arrêt au démarrage hors `development`/`test`, `allowPublicKeyRetrieval` seulement en local sans TLS ni clé épinglée, `ssl.rejectUnauthorized: true`.
  - L'option `cachingRsaPublicKey` existe bien dans `mariadb@3.5.4` (`types/share.d.ts:852`, `lib/cmd/handshake/auth/caching-sha2-password-auth.js:81`).
  - `wait-for-db.js` est aligné sur ces règles ; `NODE_ENV: development` est ajouté au compose de développement.
  - Écarts acceptés : borne `<4` sur l'override, option de clé épinglée.
- **Réponses** :
  - (a) **TLS en production, et oui, fixeur modifie `docker-compose.prod.yml`** : l'infrastructure est versionnée et livrer un correctif qui casse la production n'est pas acceptable. La clé RSA épinglée reste autorisée en développement et en staging seulement, car elle protège le mot de passe mais ne chiffre pas le trafic.
    1. `ops/mysql-tls/generate-certs.sh` : génère une AC privée et un certificat serveur dont le SAN vaut `db` (nom de service du compose), dans `secrets/mysql/` (à ajouter au `.gitignore`, droits `600` sur les clés).
    2. Service `db` : monter `secrets/mysql/{ca.pem,server-cert.pem,server-key.pem}` en lecture seule, ajouter `command: ['--require-secure-transport=ON', '--ssl-ca=...', '--ssl-cert=...', '--ssl-key=...']`.
    3. Service `backend` : monter `secrets/mysql/ca.pem` en lecture seule (par exemple `/run/secrets/mysql-ca.pem`) ; `DATABASE_SSL: 'true'`, `DATABASE_SSL_CA: /run/secrets/mysql-ca.pem`.
    4. CLI Prisma (`migrate deploy` dans la commande de démarrage) : elle n'utilise pas l'adaptateur. Ajouter au DSN les paramètres TLS supportés par Prisma pour MySQL (`sslaccept=strict`, `sslcert=<chemin AC>`), ou un `DATABASE_MIGRATION_URL` dédié, et vérifier que la migration passe avec `require_secure_transport=ON`.
    5. Mettre à jour `docs/deployment-production.md` (génération et rotation des certificats) et `.env.production.example`.
  - **Remarque (override pnpm)** : le pnpm installé globalement sur le poste (version ≥ 10, qui délègue à 9.15.4 via `packageManager`) affiche `The "pnpm" field in package.json is no longer read by pnpm ... "pnpm.overrides" ignored`. Le lockfile contient bien `overrides: mariadb: '>=3.5.4 <4'` et la version 9.15.4 le respecte, mais un poste ou une CI avec un pnpm ≥ 10 sans Corepack ignorerait l'override. Dupliquer `overrides:` dans `pnpm-workspace.yaml` (emplacement lu par pnpm ≥ 10), en conservant `package.json` pour pnpm 9. **Critère** : `pnpm install --frozen-lockfile` sans avertissement d'override ignoré ; `pnpm why mariadb -r` toujours en 3.5.4.
  - (b) **Oui, maintenant** (rattaché à S4). `prisma.config.ts` ne doit plus replier vers `root:root_password@localhost` hors `development`/`test`. Contrainte : `prisma generate` (lancé par `prebuild` dans le Dockerfile, sans `DATABASE_URL`) doit continuer à fonctionner. N'exiger l'URL que pour les commandes qui se connectent (`migrate`, `db`), ou laisser l'URL indéfinie au lieu d'un DSN root, si Prisma 7 l'accepte pour `generate`.
- **Critères d'acceptation** :
  - `docker compose -f docker-compose.prod.yml up` : le backend démarre, `migrate deploy` passe.
  - Depuis le backend, `SHOW SESSION STATUS LIKE 'Ssl_cipher'` renvoie une valeur non vide.
  - Une connexion sans TLS est refusée par le serveur.
  - `NODE_ENV=production npx prisma migrate deploy` sans `DATABASE_URL` échoue explicitement et ne vise jamais `localhost`.
  - `pnpm --filter backend build` sans `DATABASE_URL` réussit.
- **Tests attendus** : test unitaire (ou script) du chargement de `prisma.config.ts` : production sans `DATABASE_URL` : pas de DSN root. Vérification manuelle du compose de production, documentée dans l'entrée avec les sorties de commande.

#### Reprise fixeur (r2, 2026-10-30)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** :
  1. **TLS obligatoire en production** :
     - `backend/src/prisma/prisma.service.ts` (`buildMariaDbOptions`) et `backend/wait-for-db.js` refusent de démarrer avec `NODE_ENV=production` sans `DATABASE_SSL=true`. La clé RSA épinglée n'est donc plus acceptée qu'en développement et en staging.
     - `ops/mysql-tls/generate-certs.sh` (nouveau) génère une AC privée RSA 4096 (réutilisée, sauf `ROTATE_CA=1`) et un certificat serveur RSA 2048 avec `SAN DNS:db`, `serverAuth`, 825 jours, vérifié par `openssl verify`. Il écrit dans `secrets/mysql/` : clés en `600`, certificats en `644`, installation par `mv` atomique. Comme `mysqld` tourne sous l'utilisateur `mysql`, la clé serveur lui est attribuée par un conteneur jetable de la même image (`docker run --entrypoint chown mysql:8.0`), sans `sudo`.
     - `.gitignore` : `secrets/`.
     - `docker-compose.prod.yml` : service `db` avec `--require-secure-transport=ON` et `--ssl-ca`, `--ssl-cert`, `--ssl-key`, plus les trois fichiers montés en lecture seule. Service `backend` avec `DATABASE_SSL: 'true'`, `DATABASE_SSL_CA: /run/secrets/mysql-ca.pem`, et uniquement `ca.pem` monté en lecture seule (aucune clé privée).
  2. **CLI Prisma** :
     - nouveau `backend/src/prisma/database-url.ts`, fonctions pures partagées : `isLocalEnvironment` et `resolveCliDatasourceUrl` ;
     - `backend/prisma.config.ts` l'utilise : plus aucun repli `root` hors development/test (URL indéfinie, donc `prisma generate` reste possible), et avec `DATABASE_SSL=true` les paramètres `sslaccept=strict` et `sslcert=<AC>` sont ajoutés au DSN de la CLI ;
     - aucun `DATABASE_MIGRATION_URL` séparé : une seule source de configuration TLS.
  3. **Override pnpm** : dupliqué dans `pnpm-workspace.yaml` (lu par pnpm ≥ 10) et conservé dans `package.json` (lu par pnpm 9.15.4).
  4. **Documentation** : `docs/deployment-production.md`, nouvelle section « TLS MySQL (obligatoire) » (première installation, vérification, rotation) ; `.env.production.example` et `.env.example` mis à jour.
- **Tests automatisés** :
  - `src/prisma/prisma.service.spec.ts`, 3 cas ajoutés : production sans TLS, production avec seulement une clé épinglée, `DATABASE_SSL=false` → arrêt au démarrage. Avant correctif : 3 échecs ; après : 17/17.
  - `src/prisma/database-url.spec.ts` (8 tests) : production, staging ou `NODE_ENV` absent sans URL → `undefined` (pas de DSN root) ; development/test → repli local ; TLS → `sslaccept=strict` et `sslcert` ; un `sslaccept` plus faible présent dans le DSN est remplacé. Avant : module absent ; après : 8/8.
- **Vérifications manuelles réelles** (MySQL 8.0.46 jetable sur un réseau Docker isolé, identifiants factices, **aucune donnée réelle**, tout a été supprimé après la vérification) :

  | Critère de la revue | Commande | Résultat obtenu |
  | --- | --- | --- |
  | Certificats générés | `ops/mysql-tls/generate-certs.sh <dir>` | `SAN: DNS:db` ; clés `-rw-------`, clé serveur attribuée à l'UID 999 (`mysql`) |
  | MySQL en TLS obligatoire | `SHOW VARIABLES` | `require_secure_transport ON`, `have_ssl YES` |
  | `Ssl_cipher` non vide depuis l'application | `buildMariaDbOptions` (production, TLS) + `SHOW SESSION STATUS` | `TLS_AES_256_GCM_SHA384`, `TLSv1.3` |
  | Connexion en clair refusée par le serveur | client sans `ssl` | `3159 ER_SECURE_TRANSPORT_REQUIRED` |
  | Certificat vérifié | client TLS sans l'AC | `SELF_SIGNED_CERT_IN_CHAIN` (refus) |
  | Build sans `DATABASE_URL` | `docker build -f backend/Dockerfile` (`prisma generate` + `nest build`) ; `env -u DATABASE_URL pnpm --filter backend build` | OK dans les deux cas |
  | CLI Prisma en TLS (image de production) | `pnpm exec prisma migrate status` avec `DATABASE_SSL=true` | connexion OK, 8 migrations listées comme non appliquées |
  | CLI Prisma sans TLS | idem, sans `DATABASE_SSL` | `Connections using insecure transport are prohibited while --require_secure_transport=ON` |
  | `migrate` en production sans `DATABASE_URL` | `NODE_ENV=production prisma migrate status` | `The datasource.url property is required…`, jamais `localhost` |
  | `wait-for-db.js` | dans l'image, TLS | `MySQL est prêt et accepte les connexions !` ; en production sans TLS : `DATABASE_SSL=true est obligatoire…`, code de sortie 1 |
  | Rotation | seconde exécution du script, puis `docker restart` | AC réutilisée (même empreinte), nouveau certificat vérifié et servi |
  | pnpm | `pnpm@9.15.4` et `pnpm@10` en `install --frozen-lockfile --lockfile-only` | les deux OK ; pnpm 10 sans avertissement « overrides ignored » ; `pnpm why mariadb -r` → 3.5.4 uniquement |

- **Écarts (à valider)** :
  - **`migrate deploy` lui-même n'a pas été exécuté**, conformément à la consigne « aucune migration exécutée », même sur une base jetable. La connexion TLS de la CLI est prouvée par `migrate status`, qui utilise le même moteur de schéma et le même DSN. À confirmer par l'architecte ou l'exploitant lors du premier `docker compose up` de production.
  - L'avertissement `The "pnpm" field in package.json is no longer read` persiste avec le **lanceur global** pnpm ≥ 10 du poste, qui délègue ensuite à 9.15.4. Vérifié : pnpm 9.15.4 ne lit **pas** les overrides de `pnpm-workspace.yaml` (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` si l'on retire le champ de `package.json`). Le champ doit donc rester tant que `packageManager` vaut 9.15.4. La disparition de l'avertissement passe par une montée vers pnpm 10 (Dockerfile et `packageManager`), hors périmètre.
  - En développement local, la CLI Prisma (`migrate dev`) n'a plus de repli implicite : il faut exporter `NODE_ENV=development` ou `DATABASE_URL`, car `prisma.config.ts` ne charge pas `.env`. Documenté ici ; aucun script de développement ne l'utilisait sans variable.

#### Revue architecte (r2, 2026-10-30)

- **Verdict : VALIDÉ**, avec une vérification d'exploitation à consigner au premier déploiement (voir plus bas).
- **Vérifications de l'architecte** :
  - `prisma.service.ts:44` : arrêt au démarrage en production sans `DATABASE_SSL=true` ; `wait-for-db.js` aligné ;
  - `database-url.ts` relu : aucun DSN root hors `development`/`test` ; `sslaccept=strict` et `sslcert` imposés avec TLS ; un `sslaccept` plus faible est écrasé ;
  - `env -u DATABASE_URL NODE_ENV=production npx prisma generate` : OK. `prisma migrate status` dans les mêmes conditions : `The datasource.url property is required…`, sans jamais viser `localhost` ;
  - `docker-compose.prod.yml` relu : `--require-secure-transport=ON`, trois fichiers TLS en lecture seule dans `db`, `ca.pem` seul dans `backend` ;
  - `generate-certs.sh` relu : `set -euo pipefail`, `umask 077`, SAN `DNS:db`, `serverAuth`, `openssl verify`, `mv` atomique ;
  - compatibilité des opérations existantes : la sauvegarde (`scripts/backup-production.sh`) appelle `mysqldump` dans le conteneur sans `-h`, donc par socket Unix, ce que `require_secure_transport` autorise. Le healthcheck `mysqladmin -h 127.0.0.1` négocie TLS par défaut (`ssl-mode=PREFERRED`) ;
  - `.gitignore` : `secrets/` ; override présent dans `pnpm-workspace.yaml` et `package.json`.
- **Réponse (1) : `migrate status` comme preuve.** **Accepté pour la validation du code.** `migrate status` emprunte le même moteur de schéma, la même résolution de configuration (`prisma.config.ts`) et la même négociation TLS que `migrate deploy`. La preuve de connexion TLS de la CLI est donc acquise. **Vérification d'exploitation obligatoire** (pas un travail de fixeur) : au premier `docker compose -f docker-compose.prod.yml up`, conserver dans le ticket de déploiement la sortie de `migrate deploy` (migrations appliquées) et `SHOW SESSION STATUS LIKE 'Ssl_cipher'` exécuté depuis le backend. Si `migrate deploy` échoue en TLS, rouvrir S4. Ce point est ajouté au runbook S28, étape « migrations ».
- **Réponse (2) : montée vers pnpm 10.** À **planifier en Phase 6, au titre de A9** (CI), et non en Phase 0. Contenu, ajouté à A9 dans le rapport :
  - `packageManager: pnpm@10.x` ;
  - `npm install -g pnpm@10` dans les deux Dockerfiles ;
  - `pnpm/action-setup` en v10 dans la CI ;
  - `--frozen-lockfile` partout ;
  - régénération du lockfile ;
  - **puis** suppression de `package.json#pnpm.overrides` (seule source : `pnpm-workspace.yaml`).
  
  **Critère** : `pnpm install --frozen-lockfile` sans avertissement, et `pnpm why mariadb -r` toujours en 3.5.4. D'ici là, conserver les deux emplacements **identiques** (le commentaire de `pnpm-workspace.yaml` le rappelle).
- **Remarque (non bloquante)** : `generate-certs.sh` laisse `ca-key.pem` dans `secrets/mysql/` sur l'hôte de production, et ne la retrouve ensuite que pour une rotation. La documentation (`deployment-production.md:198-199`) demande bien de la sauvegarder hors ligne et de la retirer de l'hôte. Pour que ce soit suivi, ajouter cette étape à la check-list du runbook. Rattaché à S28 (documentation), sans nouvel identifiant.

### S5 — Calendrier simulé actif hors test : fausses données en base, faux jetons OAuth, endpoint de démo public

- **Statut** : `CORRIGÉ – À REVOIR` (reprise r2 du 2026-10-30, voir « Reprise fixeur » plus bas ; statut initial remplacé)
- **Cause confirmée** (`backend/src/projects/calendar-sync.service.ts`, avant correctif) : `syncCalendarEvents` importait les événements de `getSimulatedEvents('alice@test.com')` sans source réelle (l.830/834) et créait la tâche « Synchronisation Calendrier » avec `prisma.user.findFirst()` (l.850-852) ; `detectCalendarConflicts` renvoyait de faux conflits avec le repli `alice@test.com` (l.204, 241, 246) ; `handleOAuthCallback`/`refreshAccessToken` persistaient `mock-access-token-<random>` hors production (l.577-578, 700) ; `generateAuthUrl` utilisait `mock-google-client-id` (l.548, 555) ; `exportToCalendar` annonçait `exportedCount = nombre de créneaux` sans rien exporter ; `projects.controller.ts:457-509` : `GET /projects/mock-calendar` public reflétant `email` sans échappement ; sync et export ouverts à VIEWER (l.578-586, 623-627).
- **Changement** :
  - `calendar-sync.service.ts` : `getSimulatedEvents` supprimé ; plus aucun repli `alice@test.com` (l'attribution se fait seulement si `calendarId` est une adresse e-mail ; un événement sans e-mail ni nom n'est attribué à personne) ; plus aucune dérogation `NODE_ENV !== 'test'`. Nouveaux helpers `getOAuthCredentials`/`hasOAuthCredentials`/`requireOAuthCredentials` (`ServiceUnavailableException` quel que soit `NODE_ENV`), `requireClientId`, `requestTokens` (tout échec réseau, HTTP non 2xx ou réponse sans `access_token` → `BadGatewayException`, sans jeton de repli). `handleOAuthCallback` et `refreshAccessToken` n'écrivent que des jetons réellement obtenus (refresh token absent : conservé ou `null`, jamais inventé). `exportToCalendar` : 400 si l'intégration n'a pas de jeton OAuth ou si le serveur n'a pas d'identifiants ; `exportedCount` = exports réellement acceptés. `syncCalendarEvents(workspaceId, userId)` → `{ importedCount, skipped: [{ integrationId, reason: 'NOT_CONFIGURED' }] }`, tâche créée avec `userId` = appelant.
  - `projects.controller.ts` : route `GET /projects/mock-calendar` supprimée ; `POST .../calendar/sync` et `POST .../integrations/:id/export` réservés à OWNER/ADMIN ; l'appelant est transmis à `syncCalendarEvents`.
  - Fixture déplacée : `backend/tests/fixtures/calendar/sample-feed.ics` (contenu statique, utilisé par les tests d'import réel).
  - Script de nettoyage **non exécuté** : `backend/scripts/cleanup-simulated-calendar.ts`. Il fonctionne à blanc par défaut (rapport seul) et ne supprime qu'avec `--apply`, dans une transaction. Il supprime les intégrations dont le jeton déchiffré commence par `mock-` et les créneaux des tâches « Synchronisation Calendrier » correspondant aux motifs simulés (10-12 h ou 14-16 h UTC, durée exacte de 2 h). Il **signale sans les modifier** les tâches de synchronisation dont le propriétaire n'est pas membre du workspace. Usage : `cd backend && npx tsx --env-file=.env scripts/cleanup-simulated-calendar.ts [--apply]`. Vérifié par `tsc --noEmit --strict` uniquement.
- **Tests** :
  - `backend/tests/unit/projects/calendar-sync.service.spec.ts` (14 tests ajoutés ou réécrits) : export d'une intégration non connectée → 400 sans `fetch` ; export réel → appel Google avec le vrai jeton, `exportedCount = exportedRealCount = 2` ; intégration sans source (avec ou sans jeton, sans identifiants) → aucun conflit, aucun `fetch` ; conflit réel à partir de la fixture ICS attribuée par e-mail ; flux sans adresse cible → attribué à personne ; `generateAuthUrl` sans identifiant client → 503 ; `handleOAuthCallback` stocke les jetons réels chiffrés (vérifiés par `decrypt`) ; identifiants absents avec `NODE_ENV` = staging, development, test ou absent → 503, sans `upsert` ni `fetch` ; échange refusé en staging → 502, sans `upsert` ; `refreshAccessToken` en staging sans identifiants → 503, sans `update` ; sync sans source → `importedCount 0`, `skipped NOT_CONFIGURED`, sans `timeBlock.create` ni `task.create` ; sync d'un flux réel → 2 imports, tâche créée avec `userId: 'user-appelant'`, `user.findFirst` jamais appelé. **Avant correctif : 14 échecs sur 25** (exécution sans diagnostics TypeScript, à cause du changement de signature) ; après : 25/25. Deux tests d'origine qui validaient la simulation (« conflit avec le rendez-vous dentiste simulé », « nombre de créneaux exportés » sans jeton) ont été remplacés.
  - `backend/tests/http/calendar-routes.spec.ts` (8 tests) : `GET /projects/mock-calendar` sans jeton → 401 sans contenu `VCALENDAR` ; avec jeton → traité comme `getProject('mock-calendar')` → 404 ; VIEWER et MEMBER sur sync et export → 403 sans appel du service ; ADMIN sur sync → service appelé avec `('ws-1', 'user-1')` ; OWNER sur export → OK. **Avant correctif : 6 échecs sur 7** (version initiale du fichier).
  - Critère `grep -rn "mock-\|getSimulatedEvents\|alice@test.com\|mock-calendar" backend/src` (hors spec) : seul résultat restant `auth.service.ts:263` (`mock-github-id-` dans `mockLogin`), qui relève de **S26** (Phase 5) et non du calendrier.
  - Suite backend 36/36 suites, 269/269 tests ; build OK.
- **Changements cassants (contrat d'API)** : `POST /projects/workspaces/:id/calendar/sync` renvoie désormais `skipped` et répond 403 aux MEMBER et VIEWER ; `POST .../export` répond 403 aux MEMBER/VIEWER, et 400 pour une intégration non connectée (le frontend affiche déjà le message d'erreur) ; `GET .../calendar/oauth/*/auth-url` et `POST .../calendar/oauth/callback` répondent 503 sans identifiants OAuth, et 502 en cas d'échec de l'échange (au lieu d'enregistrer de faux jetons) ; `GET /projects/mock-calendar` n'existe plus.
- **Écart par rapport au rapport** (mineurs, `CORRIGÉ – À REVOIR`) :
  1. `GET /projects/mock-calendar` répond **401 sans jeton (404 avec jeton)** et non 404 dans tous les cas : le chemin est capté par la route authentifiée existante `GET /projects/:id`. L'objectif (plus de surface publique, plus de reflet du paramètre `email`) est atteint.
  2. MEMBER est aussi exclu de sync et export : le rapport demande « réservés à OWNER/ADMIN ».
  3. `exportToCalendar` charge toujours l'intégration par `id` sans filtrer sur `workspaceId` : c'est **S14** (Phase 3). Le risque est réduit, mais pas supprimé, par la restriction OWNER/ADMIN : un OWNER de son propre espace peut encore cibler l'identifiant d'une intégration étrangère.
- **Reprise des données** : exécuter le script en mode rapport, relire la liste (un import réel peut coïncider avec les motifs horaires simulés), puis `--apply` après sauvegarde. Les tâches de synchronisation rattachées à un utilisateur étranger sont à réattribuer manuellement : le script les liste sans les modifier.
- **Questions pour l'architecte** : faut-il que le script réattribue automatiquement ces tâches au propriétaire du workspace ?

#### Revue architecte

- **Verdict : À REPRENDRE** (mineur : le fond est validé, reste uniquement la régression de lint du script décrite plus bas ; réattribution suivie dans S28)
- **Vérifications** :
  - `grep -n "mock\|alice\|Simul\|findFirst()" calendar-sync.service.ts` : plus aucun résidu (seul reste `mock-github-id-` dans `auth.service.ts`, qui relève de S26).
  - Les jetons ne sont écrits qu'après un échange OAuth réel ; sans identifiants : 503, quel que soit `NODE_ENV`.
  - `syncCalendarEvents(workspaceId, userId)` crée la tâche au nom de l'appelant.
  - Sync et export sont réservés à OWNER/ADMIN.
  - La route `mock-calendar` est supprimée et le frontend n'y fait plus référence.
  - Le script de nettoyage fonctionne en mode rapport par défaut et en transaction avec `--apply`.
  
  Tests et builds relancés : verts.
- **Écarts acceptés** : 401/404 au lieu de 404 sur `/projects/mock-calendar` (aucune surface publique, aucun reflet) ; MEMBER exclu de sync et export (conforme au rapport).
- **Réponse à la question (réattribution)** : **oui, automatiquement avec `--apply`**. Une tâche de synchronisation possédée par un utilisateur **qui n'est pas membre du workspace** n'est jamais légitime (elle provient de `user.findFirst()`). Le script la réattribue à `Workspace.ownerId` du workspace du projet, dans la même transaction, et l'ajoute à la sortie (CSV : `taskId`, `workspaceId`, ancien `userId`, nouveau `userId`). Les tâches dont le propriétaire est membre ne sont pas modifiées. Suivi dans **S28**.
- **Point d'attention (S14)** : comme fixeur le signale, la restriction OWNER/ADMIN réduit peu le risque, puisque tout utilisateur est OWNER de son espace d'onboarding. La liaison `integrationId` ↔ `workspaceId` (étape 1 de S14) coûte une ligne et touche des jetons OAuth tiers : elle est **avancée en complément de Phase 0** (voir rapport, plan d'action).
- **Régression à corriger** : `backend/scripts/cleanup-simulated-calendar.ts` donne `Parsing error: "parserOptions.project" ... The file was not found in any of the provided project(s)`. Inclure `scripts/**/*.ts` dans un tsconfig référencé par ESLint (par exemple `backend/tsconfig.json`, ou un `backend/tsconfig.scripts.json` ajouté à `parserOptions.project`), sans ignorer le fichier. **Critère** : `npx eslint <fichiers modifiés de la Phase 0>` sans erreur.

#### Reprise fixeur (r2, 2026-10-30)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Lint** : `backend/scripts/**/*.ts` ajouté à `tsconfig.eslint.json` (déjà référencé par `parserOptions.project`), sans ignorer le fichier. Le script est maintenant analysé et typé par ESLint.
- **Réattribution automatique** : livrée dans **S28** (`cleanup-simulated-calendar.ts --apply`).
- **S14 étape 1** : voir l'entrée dédiée.

#### Revue architecte (r2, 2026-10-30)

- **Verdict : VALIDÉ**
- **Vérifications** :
  - `backend/scripts/**/*.ts` est inclus dans `tsconfig.eslint.json` ; ESLint : 0 erreur sur les scripts ;
  - réattribution revue dans l'entrée S28.

### P1 — Affichage réel de l'état des intégrations

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `backend/src/projects/integration.service.ts` (`getIntegrationsStatus`, avant correctif) : statut `CONNECTED` par défaut, `DEMO` hors production sans identifiants, sans jamais vérifier l'existence d'une source ; `frontend/src/components/IntegrationsPanel.tsx` : badges « Démonstration » et « Actif », placeholder pointant vers `mock-calendar` (« ou Simulateur ») ; `docs/audit_roadmap_phases.md` : « Synchronisation Réelle… avec simulateur dynamique », maturité 75 %.
- **Changement** :
  - `integration.service.ts` : statut `NOT_CONFIGURED` pour un calendrier sans URL ni (jeton OAuth + identifiants serveur), ou pour un webhook Slack/Teams sans URL ; `EXPIRED` seulement pour une source OAuth dont le jeton a expiré ; plus de statut `DEMO`, et plus de dépendance à `NODE_ENV`.
  - `IntegrationsPanel.tsx` / `.css` : badge « Non configuré » (classe `not-configured`) à la place de « Démonstration » et du libellé générique « Actif » ; libellé et placeholder sans simulateur.
  - `docs/audit_roadmap_phases.md` : ligne Phase 7 et section « Synchronisation Réelle » corrigées (simulateur supprimé, maturité « à réévaluer » au lieu de 75 %, OAuth conditionné aux identifiants, renvois vers S14/S19). Pas de nouveau pourcentage inventé. Le bandeau d'obsolescence global relève de P2 (Phase 6).
- **Tests** :
  - `backend/tests/unit/projects/integration.service.spec.ts` (10 tests ajoutés) : calendrier sans source → `NOT_CONFIGURED` quel que soit `NODE_ENV` (development, staging, production, absent) ; jeton sans identifiants serveur → `NOT_CONFIGURED` ; OAuth avec identifiants → `CONNECTED`, ou `EXPIRED` si le jeton a expiré ; flux URL → `CONNECTED` ; Slack sans ou avec URL ; `DISABLED` ; la réponse ne contient ni `accessToken`, ni `refreshToken`, ni `url`. **Avant correctif : 7 échecs sur 16** ; après : 16/16.
  - `frontend/src/components/IntegrationsPanel.spec.tsx` (3 tests) : « Non configuré » affiché sans « Connecté », « Actif » ni « Démonstration » ; « Connecté » seulement si le serveur le confirme ; formulaire calendrier sans mention du simulateur. **Avant correctif : 2 échecs** ; après : 3/3.
  - Suite backend 36/36 suites, 269/269 tests ; build OK. Frontend 10/10 fichiers, 24/24 tests ; `pnpm build` OK.
- **Écart par rapport au rapport** : aucun sur le fond. « Aucun événement simulé visible en production » repose sur S5 et sur le script de nettoyage pour les données existantes : tant que celui-ci n'a pas été exécuté, d'anciens créneaux simulés restent visibles dans les plannings.
- **Questions pour l'architecte** : aucune.

#### Revue architecte

- **Verdict : VALIDÉ**
- **Vérifications** :
  - `getIntegrationsStatus` ne dépend plus de `NODE_ENV` et ne renvoie plus `DEMO`.
  - `NOT_CONFIGURED` est renvoyé sans source réelle.
  - Projection sans `accessToken`, `refreshToken` ni `url`.
  - Badge « Non configuré » côté frontend.
  - La correction de `docs/audit_roadmap_phases.md` est factuelle et n'invente aucun pourcentage.
  
  Tests vitest et backend verts.
- **Remarque** : le critère « aucun événement simulé visible en production » ne sera pleinement atteint qu'après exécution du script de nettoyage S5 (suivi dans S28). `listIntegrations` renvoie toujours les jetons chiffrés : c'est S14, et non P1.

---

## Bilan Phase 0 (fin de session)

- Constats traités : P3, S3, S2, S1, S4, S5, P1 (tous dans l'ordre du rapport).
- Backend : 36 suites / 269 tests verts (base : 32 / 185) ; `pnpm build` OK. Frontend : 10 fichiers / 24 tests verts (base : 8 / 18) ; `pnpm build` OK.
- Migrations ajoutées (non appliquées) : `20261108000000_s2_disable_unimplemented_sso_providers` (données), `20261108000100_s1_scim_provisioned_by_workspace` (schéma).
- Scripts à exécuter manuellement : `backend/scripts/cleanup-simulated-calendar.ts` (S5) ; requêtes de revue en lecture seule dans les entrées S1 et S2.
- Aucun commit, aucune branche (consigne de l'utilisateur).
- Fichier `backend/.env` (autorisation relayée par la session principale, ajouts uniquement, aucune valeur existante lue ni modifiée) : `NODE_ENV=development`, `FEATURE_SSO_ENABLED=false`, `FEATURE_SCIM_ENABLED=false`.
- Hors de mon périmètre : `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` apparaît modifié dans l'arbre de travail, mais je ne l'ai pas touché (modification apparue pendant la session).

---

## Revue architecte : bilan de la Phase 0 (2026-10-29)

**Vérifications effectuées par l'architecte** (sans se fier aux descriptions) :

| Vérification | Résultat |
| --- | --- |
| `cd backend && pnpm test` | 36/36 suites, 269/269 tests |
| `cd frontend && pnpm test:run` | 10/10 fichiers, 24/24 tests |
| `pnpm build` (backend et frontend) | OK |
| `npx prisma validate` | OK |
| `pnpm audit --prod` | 72 avis, plus aucun sur `mariadb` |
| `pnpm why mariadb -r` | 3.5.4 uniquement |
| `npx eslint` sur les fichiers modifiés ou créés | **3 erreurs, 1 avertissement : régression** |

L'avertissement (`any` dans `tracking.gateway.spec.ts:62`) n'est pas bloquant.

| ID | Verdict | Reste à faire |
| --- | --- | --- |
| P3 | À REPRENDRE (mineur) | Lint `feature-flags.spec.ts` ; mesure transitoire d'impersonation : voir S18, étape 0 |
| S3 | À REPRENDRE | 503 explicite et borné (2 s) si Redis est indisponible dans le parcours MFA |
| S2 | À REPRENDRE (mineur) | Lint `sso.dto.ts` ; nettoyage des memberships `generic:%` : voir S28 |
| S1 | VALIDÉ | Remarques rattachées à S11 (PATCH `emails`, domaine vérifié) et à S8 (pré-occupation) |
| S4 | À REPRENDRE | TLS MySQL dans `docker-compose.prod.yml` ; repli root de `prisma.config.ts` ; override dupliqué dans `pnpm-workspace.yaml` |
| S5 | À REPRENDRE (mineur) | Lint du script (tsconfig) ; réattribution automatique : voir S28 |
| P1 | VALIDÉ | Aucun |

**Nouveaux constats ajoutés au rapport** :

- **S28** (reprise des données compromises de la Phase 0).

**Constats existants mis à jour** :

- S1 (écarts acceptés) ;
- S4 (`prisma.config.ts`, TLS en production, override) ;
- S8 (pré-occupation SCIM) ;
- S11 (PATCH `emails`, domaine vérifié pour `createUser`) ;
- S14 (étape 1 avancée en complément de Phase 0) ;
- S18 (étape 0 : drapeau d'impersonation).

**Hors périmètre fixeur** : `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` est modifié dans l'arbre de travail (+24 lignes) par une autre source. À faire confirmer par l'utilisateur avant tout commit.

**Constats encore ouverts pour fixeur, dans cet ordre (complément de Phase 0)** :

1. Lint : P3, S2, S5.
2. S3 : 503 sur indisponibilité de Redis.
3. S4 : TLS en production et `prisma.config.ts`.
4. S18, étape 0 : drapeau d'impersonation.
5. S14, étape 1 : liaison `integrationId` ↔ `workspaceId` et projection sans jetons.
6. S28 : scripts de reprise (`generic:%`, réattribution des tâches de synchronisation) et runbook.

Ensuite, la Phase 1 : A3, S7, S8, S6, S9, P6, S27.

---

## Compléments de Phase 0 (reprise r2, 2026-10-30)

### S18 (étape 0) — Impersonation derrière FEATURE_IMPERSONATION_ENABLED

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `backend/src/admin/admin.controller.ts:59-62` servait `POST /admin/users/:id/impersonate` sans condition à tout `platformRole`, et `AdminConsole.tsx` affichait le bouton « Impersonate » sur chaque ligne.
- **Changement** :
  - `backend/src/config/features.ts` : drapeau `IMPERSONATION` (`FEATURE_IMPERSONATION_ENABLED`, actif seulement s'il vaut exactement `'true'`) ; `GET /features` expose `impersonation`.
  - `admin.controller.ts` : `@RequireFeature('IMPERSONATION')` sur la route, et `FeatureFlagGuard` placé **en tête** des guards de classe (`FeatureFlagGuard, JwtAuthGuard, PlatformAdminGuard`). Une route désactivée répond donc 404 avant toute authentification ou requête Prisma ; les autres routes admin, sans métadonnée de drapeau, ne sont pas affectées.
  - `frontend/src/components/AdminConsole.tsx` : bouton rendu seulement si `GET /features` renvoie `impersonation: true`. Le drapeau est chargé à la première ouverture de l'onglet Utilisateurs, et le bouton reste masqué en cas d'erreur. Ce choix évite un appel supplémentaire au montage, qui aurait décalé les réponses simulées des tests existants.
  - `backend/.env` (ajout seul) et `.env.example` / `.env.production.example` : `FEATURE_IMPERSONATION_ENABLED=false`.
- **Tests** :
  - `backend/tests/http/impersonation-flag.spec.ts` (5 tests, application Nest réelle) : drapeau absent → 404 pour un SUPER_ADMIN authentifié, sans appel à `impersonateUser` ; 404 sans jeton, sans requête Prisma ; drapeau `'true'` → 401 sans jeton, 201 avec jeton admin ; `/admin/overview` indépendant du drapeau ; `GET /features` expose `impersonation`. **Avant correctif : 3 échecs sur 5** ; après : 5/5.
  - `frontend/src/components/AdminConsole.spec.tsx` (2 tests ajoutés, réponses routées par URL) : bouton absent si `impersonation: false`, présent si `true`. Avant : 1 échec (bouton toujours affiché) ; après : 4/4. Les 2 tests existants sont inchangés.
- **Écart par rapport au rapport** : aucun. Le reste de S18 (`@PlatformRoles`, jeton court `act`, MFA admin) reste en Phase 4.

#### Revue architecte (r2, 2026-10-30)

- **Verdict : VALIDÉ**
- **Vérifications** :
  - `FeatureFlagGuard` placé en tête des guards de classe de `AdminController` : une route désactivée renvoie 404 avant `JwtAuthGuard`. Les autres routes admin n'ont pas de métadonnée de drapeau et ne sont pas affectées ;
  - `GET /features` expose `impersonation` ;
  - bouton conditionné dans `AdminConsole.tsx` ;
  - tests HTTP (5) et vitest verts.
- Le reste de S18 demeure en Phase 4.

### S14 (étape 1) — Intégration liée à son workspace, réponses sans jetons

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `calendar-sync.service.ts` chargeait l'intégration par `findUnique({ where: { id } })` dans `exportToCalendar` et `refreshAccessToken`, sans `workspaceId`. Tout OWNER de son espace d'onboarding pouvait donc écrire dans l'agenda d'un autre client avec ses jetons OAuth. `integration.service.ts` : `listIntegrations` renvoyait la ligne complète, y compris `accessToken` et `refreshToken` chiffrés, et `createIntegration` et `toggleIntegration` aussi.
- **Changement** :
  - `calendar-sync.service.ts` : `exportToCalendar` utilise `findFirst({ where: { id, workspaceId } })`, avec 404 sinon et **avant** tout rafraîchissement ou appel sortant. `refreshAccessToken(workspaceId, integrationId)` applique le même filtre ; ses trois appelants (export, conflits, synchronisation) transmettent le workspace. `syncCalendarEvents` charge déjà les intégrations par `workspaceId`.
  - `integration.service.ts` : constante `INTEGRATION_PUBLIC_SELECT` (sans jetons) appliquée à `listIntegrations`, `createIntegration` et `toggleIntegration`.
- **Tests** :
  - `calendar-sync.service.spec.ts` : magasin d'intégrations simulé (`findFirst` applique réellement `where` ; `findUnique` ne regarde que l'`id`, comme le code vulnérable). `exportToCalendar('ws-A', 'int-B')` → 404, sans `refreshAccessToken`, sans `fetch`, sans `update`. `refreshAccessToken('ws-A', 'int-B')` → 404, sans `fetch` ni `update`.
  - `integration.service.spec.ts` : la requête `listIntegrations` a un `select` sans `accessToken`/`refreshToken`, et la réponse n'en contient pas (simulation de la projection Prisma). `createIntegration` et `toggleIntegration` passent un `select` sans jetons.
  - **Avant correctif** (exécution sans diagnostics TypeScript, la signature ayant changé) : export inter-workspace et `listIntegrations` en échec. Le test `refreshAccessToken(wsA, intB)` passait pour une mauvaise raison (ancienne signature à un argument) ; il n'est significatif qu'après correctif.
  - Deux tests existants qui comparaient les arguments Prisma exacts passent à `objectContaining`, avec les mêmes assertions métier.
  - Après correctif : 56/56 sur les suites concernées.
- **Écart par rapport au rapport** : `createIntegration` et `toggleIntegration` sont aussi projetés (non demandé explicitement, mais ils renvoyaient les jetons). Restent en Phase 3 : branches mortes `toggle`/`delete` du contrôleur, `toggle`/`delete` par `(workspaceId, id)`, URL masquée dans `getIntegrationsStatus`.

#### Revue architecte (r2, 2026-10-30)

- **Verdict : VALIDÉ**
- **Vérifications** :
  - `exportToCalendar` (`calendar-sync.service.ts:78`) et `refreshAccessToken(workspaceId, integrationId)` (l.639-641) passent par `findFirst({ id, workspaceId })`, avant tout rafraîchissement ou `fetch` ;
  - les trois appelants transmettent le workspace (l.109, 250, 724) ;
  - `INTEGRATION_PUBLIC_SELECT` exclut `accessToken`/`refreshToken`, sur `list`, `create` et `toggle`.
- **Écart accepté** : la projection de `create`/`toggle` va au-delà de la demande, c'est bienvenu.
- Restent en Phase 3 : branches mortes du contrôleur, `toggle`/`delete` par `(workspaceId, id)`, `url` en clair dans les réponses `create`/`toggle` (réservées à OWNER/ADMIN, à masquer à cette occasion).

### S28 — Reprise des données compromises de la Phase 0

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** (aucun script exécuté contre une base) :
  - `backend/scripts/cleanup-generic-sso.ts` (nouveau) : `planGenericSsoCleanup` (fonction pure) et `runGenericSsoCleanup(prisma, { apply })`. Pour chaque `ssoUid` commençant par `generic:` :
    - suppression des memberships dans les workspaces SAML2/OIDC_GENERIC, avec un `deleteMany` filtré `role: { not: 'OWNER' }` en garde-fou ;
    - OWNER signalé (`MEMBERSHIP_OWNER_CONSERVÉE_À_REVOIR`) ;
    - `ssoUid = NULL` ;
    - `isSuspended = true` s'il n'y a ni mot de passe, ni Firebase, ni GitHub, ni membership restante.

    Tout s'exécute dans une seule transaction, avec un `updateMany` conditionnel sur `ssoUid startsWith 'generic:'` (idempotent).
  - `backend/scripts/cleanup-simulated-calendar.ts` : restructuré (`planSyncTaskReassignments` pure, `runSimulatedCalendarCleanup`). Avec `--apply`, il réattribue au `Workspace.ownerId` les tâches de synchronisation dont le propriétaire n'est pas membre (`updateMany` conditionnel sur l'ancien `userId`), en plus des suppressions S5 existantes, dans la même transaction.
  - `backend/scripts/lib/csv.ts` (nouveau) : CSV avec cellules entre guillemets, neutralisation des formules (`= + - @`, car les e-mails peuvent être choisis par l'attaquant), fichier en `600` dans `reprise-phase0/` (ajouté au `.gitignore`), option `--csv=<chemin>`.
  - `docs/security/runbook-reprise-phase0.md` (nouveau) : ordre d'exécution, requêtes de revue en lecture seule (comptes suspendus, e-mails potentiellement remplacés, memberships du repli), procédure de contact par un canal indépendant, clôture.
  - Constat vérifié dans `HEAD`, utilisé par le runbook : seul SCIM écrivait `User.isSuspended`. La console admin n'a pas d'action de suspension (`PlatformAuditLog` : `USER_ROLE_UPDATED`, `USER_SESSIONS_REVOKED`, `USER_IMPERSONATED`). Tout compte suspendu avant la reprise vient donc de SCIM ou d'une modification SQL, et la liste doit être exportée **avant** le `--apply` du script SSO, qui ajoute ses propres suspensions.
- **Tests** : `backend/tests/unit/scripts/reprise-phase0.spec.ts` (14 tests, Prisma simulé) :
  - le compte `generic:` sans autre accès est suspendu, avec sa membership retirée ;
  - une membership OWNER n'est jamais supprimée et le compte n'est pas suspendu ;
  - une membership hors SSO générique est conservée ;
  - un compte avec mot de passe, Firebase ou GitHub n'est pas suspendu ;
  - en mode rapport, aucune transaction ni écriture ;
  - avec `--apply`, `deleteMany` et `updateMany` portent exactement les filtres attendus ;
  - idempotence : sans compte `generic:%`, aucune écriture ;
  - réattribution d'une tâche d'un non-membre, aucune réattribution pour un membre ou pour le propriétaire du workspace ;
  - mode rapport du calendrier sans écriture, `--apply` conditionnel ;
  - échappement CSV et neutralisation des formules.
  
  Avant correctif : modules absents. Après : 14/14. ESLint et `tsc` OK sur les scripts.
- **Écart par rapport au rapport** : les scripts s'exécutent dans le conteneur `backend`, dont l'image contient `tsx` (dépendances de développement installées par le Dockerfile), ou depuis un poste d'administration. Les CSV sont écrits aussi en mode rapport, pour la relecture à deux.
- **Questions pour l'architecte** : faut-il aussi un mode `--restore` qui rejoue le CSV à l'envers (réattribution, ssoUid) en cas d'erreur ? Aujourd'hui, la seule voie de retour est la sauvegarde de l'étape 1 du runbook.

#### Revue architecte (r2, 2026-10-30)

- **Verdict : VALIDÉ**
- **Vérifications** :
  - `cleanup-generic-sso.ts` relu :
    - plan pur, puis transaction unique ;
    - `deleteMany` filtré `role: { not: 'OWNER' }` en garde-fou ;
    - `updateMany` conditionnel sur `ssoUid startsWith 'generic:'`, donc idempotent ;
    - suspension seulement sans aucun identifiant et sans membership restante ;
    - aucune écriture en mode rapport ;
  - `cleanup-simulated-calendar.ts` : réattribution au `Workspace.ownerId`, conditionnelle sur l'ancien `userId` ;
  - `lib/csv.ts` : guillemets systématiques, neutralisation des formules (`= + - @ \t \r`), fichier en `600`, dossier ignoré par git ;
  - le runbook impose sauvegarde et restauration testée avant `--apply`, et l'export des comptes suspendus **avant** le script SSO ;
  - tests (14) verts ; ESLint 0 erreur.
- **Réponse : faut-il un mode `--restore` ?** **Non.** Un « rejeu à l'envers » réintroduirait précisément des memberships obtenues sans authentification, et il serait lui-même un script à forte capacité d'écriture à sécuriser et à tester. La voie de retour retenue :
  1. la sauvegarde complète **dont la restauration a été testée** (étape 1 du runbook, déjà exigée) ;
  2. pour un faux positif isolé, une correction ciblée à partir du CSV `--apply` (re-création d'une membership, réattribution d'une tâche) via les parcours normaux : invitation, ou réaffectation par un OWNER.
  
  À ajouter au runbook (documentation seulement) : conserver le CSV `--apply` avec le ticket d'incident pendant la durée de rétention des sauvegardes ; ajouter à la check-list l'étape « sortir `ca-key.pem` de l'hôte » (remarque S4) et la vérification d'exploitation `migrate deploy` en TLS (réponse S4-1). Ces trois ajouts au runbook ne bloquent pas la validation.

## Bilan de la reprise r2 (2026-10-30)

| ID | Statut après reprise | Résumé |
| --- | --- | --- |
| P3 | `CORRIGÉ – À REVOIR` | Lint corrigé |
| S3 | `CORRIGÉ – À REVOIR` | 503 borné à 2 s sur indisponibilité de Redis (login MFA et challenge) |
| S2 | `CORRIGÉ – À REVOIR` | Lint corrigé ; données : S28 |
| S4 | `CORRIGÉ – À REVOIR` | TLS MySQL obligatoire en production (compose, script de certificats, CLI Prisma), `prisma.config.ts` sans repli root, override dans `pnpm-workspace.yaml`, vérifié sur un MySQL jetable |
| S5 | `CORRIGÉ – À REVOIR` | Lint du script (`tsconfig.eslint.json`) ; réattribution : S28 |
| S18 (étape 0) | `CORRIGÉ – À REVOIR` | Drapeau d'impersonation, route en 404 et bouton masqué |
| S14 (étape 1) | `CORRIGÉ – À REVOIR` | Intégration filtrée par workspace, réponses sans jetons |
| S28 | `CORRIGÉ – À REVOIR` | Deux scripts de reprise (rapport par défaut, `--apply`, CSV) et runbook |

- **Vérifications exécutées** : backend 39/39 suites, 307/307 tests ; `pnpm build` backend OK (aussi sans `DATABASE_URL`) ; frontend 10/10 fichiers, 26/26 tests, `pnpm build` OK ; `npx eslint` sur tous les fichiers modifiés ou créés : **0 erreur**, 1 avertissement antérieur (`tracking.gateway.spec.ts:62`, `any`) ; Prettier OK.
- **Correction ESLint hors des trois fichiers signalés** : `backend/wait-for-db.js:34` (`catch (e)` inutilisé, erreur antérieure révélée parce que le fichier fait partie de ceux que j'ai touchés).
- **Variable ajoutée à `backend/.env`** (ajout seul, aucune valeur existante lue ni modifiée) : `FEATURE_IMPERSONATION_ENABLED=false`.
- **Non touchés** : `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` et `docs/Planner_Pro_Architecture_et_Fonctionnement.pdf` (modifiés par la session principale), `.claude/`. Aucun commit ni branche ; aucun script de données ni migration exécuté contre une base réelle.

---

## Revue architecte : bilan de la reprise r2 (2026-10-30)

**Vérifications refaites par l'architecte** (sans se fier au journal) :

| Vérification | Résultat |
| --- | --- |
| `cd backend && pnpm test` | 39/39 suites, 307/307 tests |
| `cd frontend && pnpm test:run` | 10/10 fichiers, 26/26 tests |
| `pnpm build` backend | OK |
| `pnpm build` frontend | OK |
| `npx eslint` sur tous les fichiers `.ts/.tsx/.js/.cjs` modifiés ou créés | 0 erreur, 1 avertissement antérieur (`tracking.gateway.spec.ts:62`) |
| `env -u DATABASE_URL NODE_ENV=production npx prisma generate` | OK |
| `env -u DATABASE_URL NODE_ENV=production npx prisma migrate status` | erreur explicite `datasource.url … required`, jamais `localhost` |

| ID | Verdict r2 |
| --- | --- |
| P3 | VALIDÉ |
| S3 | VALIDÉ |
| S2 | VALIDÉ |
| S1 | VALIDÉ (r1) |
| S4 | VALIDÉ, avec une vérification d'exploitation au premier déploiement |
| S5 | VALIDÉ |
| P1 | VALIDÉ (r1) |
| S18 (étape 0) | VALIDÉ |
| S14 (étape 1) | VALIDÉ |
| S28 | VALIDÉ |

**Phase 0 : entièrement VALIDÉE côté code.** Aucune régression ni nouvelle faille introduite par les correctifs de la r2.

Il reste trois actions d'**exploitation**. Elles ne relèvent pas de fixeur et demandent une décision de l'utilisateur :

1. Appliquer les deux migrations.
2. Générer les certificats MySQL, déployer, puis consigner la sortie de `migrate deploy` et la valeur de `Ssl_cipher` (S4).
3. Exécuter les scripts S28 selon le runbook : sauvegarde avec restauration testée, mode rapport, revue, puis `--apply`.

S'y ajoutent trois ajouts **documentaires** au runbook, non bloquants, que fixeur peut faire en tête de la Phase 1 :

- conservation du CSV `--apply` avec le ticket d'incident ;
- retrait de `ca-key.pem` de l'hôte de production ;
- vérification de `migrate deploy` en TLS au premier déploiement.

**Documents de la session principale** (signalés, non modifiés) :

- `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` :
  - §14.3 : « mise en conformité de `docker-compose.prod.yml` en cours ». C'est désormais fait.
  - §14.4 : `DATABASE_SSL` a pour défaut `false`, mais il est **obligatoire (`true`) en production**, sinon le démarrage est refusé. `FEATURE_IMPERSONATION_ENABLED` est encore marqué « en cours d'implémentation », alors qu'il est livré.
  - §15.1 : l'état de la Phase 0 doit passer à « validée (code) ; actions d'exploitation en attente ».
  - §15.2 règle 4 : « migrations de données **réversibles** » est inexact. Les scripts ne sont pas réversibles (pas de `--restore`, par décision). Formulation proposée : « tracées (CSV), en mode rapport par défaut, avec retour arrière par sauvegarde dont la restauration a été testée ».
  - §14.2 (antérieur au programme) : il affirme que tous les conteneurs ont un `HEALTHCHECK` sur `/admin/health` toutes les 30 s. C'est faux : seuls `db` (`mysqladmin ping`) et `cache` (`redis-cli ping`) ont un healthcheck, à 10 s, et `/admin/health` exige un jeton d'administrateur de plateforme.
- `GEMINI.md` :
  - la section « État au 30/10/2026 » est périmée par cette revue (Phase 0 validée côté code) ;
  - la liste « Ce qui a changé » omet `FEATURE_IMPERSONATION_ENABLED` (route en 404), la liaison des intégrations au workspace (S14, étape 1) et l'obligation de TLS MySQL en production (`DATABASE_SSL=true`, démarrage refusé sinon) ;
  - le reste est exact.

**Constats encore ouverts pour fixeur** : la Phase 1, dans l'ordre A3, S7, S8, S6, S9, P6, S27, précédée des trois ajouts documentaires au runbook. Tous les autres constats des Phases 1 à 6 restent ouverts (voir la section 6 du rapport). Constats clos : S1, S2, S3, S4, S5, S28, P1, P3. S14 et S18 sont partiellement traités : seules les étapes avancées en Phase 0 sont closes.

---

## Plan de correction : Phase 1 (r3, 2026-10-30)

Ordre du rapport r3 : **A3 → S7 → S8 → S6 → S9 → P6 → S27**. Méthode inchangée : test d'abus qui échoue d'abord, correctif minimal, suites complètes, builds et ESLint sur les fichiers touchés. Les runbooks restent des documents : aucune migration ni aucun script de données n'est exécuté contre une base réelle. Les trois ajouts documentaires au runbook de la Phase 0 (CSV `--apply` conservé, `ca-key.pem` sorti de l'hôte, `migrate deploy` en TLS consigné) sont faits (`docs/security/runbook-reprise-phase0.md`, sections 5 et 6).

### Architecture retenue

| Élément | Choix | Constats |
| --- | --- | --- |
| Session | `SessionService` (`backend/src/auth/session.service.ts`) : `issue`, `refresh`, `revoke`, `revokeAllForUser`, `verifyAccess`, `listForUser`. Seul appelant de `TokenService.signAccessToken`. Une session = une **famille** de jetons de rafraîchissement (`sid` = `familyId`) dans la table `RefreshToken` existante. | A3, S7 |
| Jetons | Accès : JWT `typ:'access'`, **15 min**, claims `sid` et `jti` obligatoires (les jetons sans `sid` sont rejetés : reconnexion générale, à annoncer). Rafraîchissement : 256 bits opaques, stockés **hachés** (SHA-256), rotation à chaque usage, réutilisation d'un jeton déjà tourné = révocation de la famille (avec une tolérance de 10 s pour deux onglets simultanés). Durée **7 jours glissants, plafond absolu de 30 jours** (option recommandée, à confirmer par le produit). | S7 |
| Cookies | `accessToken` (`Path=/`, 15 min) et `refreshToken` (`Path=/auth`, 7 j), tous deux `httpOnly; SameSite=Strict`, `Secure` en production. Plus aucun jeton dans le corps des réponses ni dans `localStorage`. | S7 |
| Révocation | Contrôle à chaque requête HTTP et à la connexion WebSocket : session active **et** `isSuspended = false`, avec cache Redis de 60 s maximum (repli sur la base si Redis est indisponible). Les sockets sont revalidées toutes les 60 s. | S7 |
| Connexion | `AuthService.completeLogin(user, { method })` : seul point d'émission de session ; applique dans l'ordre suspension (403), `enforceSSO`, MFA (ticket), puis `SessionService.issue`. | A3, S8 |
| Frontend | Pas de jeton lisible par le JavaScript. Un wrapper `fetch` unique (`frontend/src/api-session.ts`, installé dans `main.tsx`) ajoute `credentials: 'include'` pour les appels vers l'API et rafraîchit la session une fois sur un 401 (mono-vol). Socket.IO en `withCredentials`. | S7 |

### Décisions produit (option recommandée appliquée, à confirmer)

1. **Durée des sessions** : accès 15 min, rafraîchissement 7 jours glissants, plafond 30 jours.
2. **Inscription (S27, P6)** : réponse générique 202 et **vérification d'e-mail obligatoire pour les nouvelles inscriptions** (le compte n'ouvre pas de session avant vérification). Les comptes existants sont considérés comme vérifiés (migration de données : `emailVerifiedAt = createdAt`), faute de quoi tous les comptes existants seraient bloqués au déploiement. Sans SMTP configuré, le lien est journalisé par `MailService` (mode simulé existant, développement seulement).
3. **Liaison d'identité externe** (S8, S9) : jamais automatique. Un e-mail déjà connu sans l'identifiant correspondant donne 409 « connectez-vous puis liez » ; la liaison se fait depuis une session (`/auth/firebase/link` existant, `/auth/github/link` ajouté).
4. **Réauthentification** (S6) : mot de passe pour les comptes qui en ont un ; sinon connexion de moins de 5 minutes (`authenticatedAt` de la session).
5. **Impersonation** : la session d'impersonation est émise par `SessionService` (15 min, sans jeton de rafraîchissement) ; « quitter l'impersonation » = déconnexion puis reconnexion de l'administrateur (plus de sauvegarde de session en `sessionStorage`). Elle reste désactivée par défaut (S18 étape 0).
6. **`enforceSSO`** : n'est appliqué que si `FEATURE_SSO_ENABLED=true`. Tant que le domaine n'est pas prouvé (S10, Phase 2), un `enforceSSO` posé sur un domaine non vérifié permettrait de verrouiller les comptes d'une organisation tierce : à ne pas réactiver sans S10.

### Fichiers touchés et tests d'abus prévus

| ID | Fichiers principaux (prévision) | Tests d'abus prévus | Migration |
| --- | --- | --- | --- |
| A3 | `session.service.ts`, `session-cookies.ts`, `token.service.ts`, `auth.module.ts`, `auth.service.ts`, `sso.service.ts`, `admin.service.ts` | `grep` : `signAccessToken` appelé par `session.service.ts` seul ; une seule durée de cookie sur tous les chemins ; jeton sans `sid` : 401 | `RefreshToken` : `familyId`, `authenticatedAt`, `rotatedAt`, `userAgent` |
| S7 | `jwt.guard.ts`, `auth.controller.ts`, `sso.controller.ts`, gateways, `admin.service.ts`, `frontend/src/api-session.ts`, `AppContext.tsx` et les composants qui lisaient `user.token` | login puis logout puis ancien cookie : 401 ; suspension puis requête : 401 ; révocation admin : ancien jeton rejeté ; rejeu d'un refresh tourné : famille révoquée ; handshake WS après logout : refusé ; aucun jeton dans le corps ni dans `localStorage` | (A3) |
| S8 | `auth.service.ts` (`completeLogin`), `auth.controller.ts`, `sso.service.ts`, `admin.service.ts`, `Login.tsx` | matrice {mot de passe, GitHub, Firebase, SSO} × {suspendu, MFA, enforceSSO} ; Firebase vérifié sur compte existant non lié : 409 sans `update` ; compte provisionné par SCIM : 409 | Aucune |
| S6 | `auth.service.ts`, `totp.util.ts`, `auth.controller.ts`, DTO MFA, `auth.prisma`, script `encrypt-mfa-secrets.ts`, UI MFA si elle existe | `setupMfa` si actif : 409 ; `disableMfa` sans mot de passe : refus ; même code TOTP deux fois : refus ; secret persisté chiffré ; code de secours à usage unique | `User` : `mfaPendingSecret`, `mfaLastUsedStep` ; table `MfaRecoveryCode` |
| S9 | `auth.service.ts`, `auth.controller.ts`, `Login.tsx`, `InvitationAcceptance.tsx`, DTO GitHub | `state` absent ou différent : 401 ; e-mail non vérifié : 401 ; compte existant sans `githubId` : 409 sans `update` ; `res.ok` faux : 401 ; portée `read:user user:email` | Aucune |
| P6 | `auth.service.ts`, `mail.service.ts`, `auth.controller.ts`, `auth.prisma`, `Login.tsx` | jeton de vérification/réinitialisation haché, usage unique, expiré refusé ; réinitialisation = sessions révoquées ; connexion refusée avant vérification | `User.emailVerifiedAt` ; table `AuthToken` |
| S27 | `auth.service.ts`, `encryption.util.ts`, `invitations.service.ts`, `sso.service.ts` | `argon2.verify` appelé même si l'utilisateur est absent ; `timingSafeEqual` PBKDF2 ; e-mail d'invitation masqué ; `discover` sans `workspaceName` | Aucune |

Changements cassants annoncés : toutes les sessions existantes sont invalidées (jetons sans `sid`) ; le contrat des routes de connexion change (plus de `accessToken` dans le corps ; cookies) ; `register` devient asynchrone (202) ; frontend adapté dans la même livraison.

### Déroulé

Les entrées par constat sont ajoutées à la suite, en fin de journal, au fur et à mesure.

## Entrées de la Phase 1

### A3 — Identité fragmentée : un seul point d'émission de session

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : 6 chemins d'émission dans `AuthService` plus `SsoService` et `AdminService`, avec des durées de cookie divergentes (1 h contre 7 j).
- **Changement** :
  - `backend/src/auth/session.service.ts` (nouveau) : `SessionService`, avec `issue`, `refresh`, `revoke`, `revokeAllForUser`, `verifyAccess`, `isSessionActive`, `listForUser`, `revokeOwnSession`. C'est le seul appelant de `TokenService.signAccessToken` (voir écart ci-dessous). `session.module.ts` le rend global.
  - `AuthService.completeLogin(user, ctx)` : seul point d'entrée de session. `login`, `verifyMfaChallenge`, `loginWithGitHub`, `loginWithFirebase`, `register`, `mockLogin`, `SsoService.handleCallback` et `AdminService.impersonateUser` y aboutissent. Il renvoie `{ user, session }` ; le contrôleur pose les cookies (`login-response.ts`, `respondWithLogin`).
  - `session-cookies.ts` : une seule définition des cookies (nom, `Path`, durée, `httpOnly`, `SameSite=Strict`, `Secure` en production), utilisée par tous les chemins.
  - `TokenService.signAccessToken` exige désormais `sid`, signe en 15 min et ajoute un `jti`. `verifyAccessToken` rejette un jeton sans `sid`.
  - Migration `20261109000000_a3_s7_session_families` : `RefreshToken` reçoit `familyId`, `authenticatedAt`, `rotatedAt`, `userAgent` (SQL généré par `prisma migrate diff`). La table n'était alimentée par aucun code : pas de backfill.
- **Tests** : `grep -rn "signAccessToken" backend/src` hors specs ne renvoie que `session.service.ts` (définition dans `token.service.ts`). Les suites existantes sont adaptées (`auth.service.spec`, `sso.service.spec`, `admin.service.spec`). Le comportement par chemin est couvert par les tests de S7 et de S8.
- **Écart par rapport au rapport** : le critère « `grep -rn "jwtService.sign" backend/src` ne renvoie que `session.service.ts` » devient « `jwtService.sign` n'apparaît que dans `token.service.ts` (signature bas niveau, déjà introduite par S3) et `signAccessToken` n'est appelé que par `session.service.ts` ». Scinder la signature en deux couches évite de dupliquer le code de S3 déjà validé.

### S7 — Sessions non révocables, jeton exposé au JavaScript, pas de déconnexion serveur

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : JWT de 7 jours sans `jti` ni session ; cookie de 1 h (auth) contre 7 j (SSO) ; `JwtAuthGuard` sans contrôle de suspension ni de révocation ; `revokeUserSessions` supprimait des lignes d'une table jamais alimentée ; aucun `logout` serveur ; jeton dans le corps et dans `localStorage`.
- **Changement (backend)** :
  - Jeton d'accès 15 min (`sid`, `jti`). Jeton de rafraîchissement opaque (256 bits, base64url), **stocké haché (SHA-256)**, rotation à chaque usage (consommation atomique `updateMany`), détection de réutilisation : un jeton déjà tourné présenté après 10 s révoque toute la famille ; avant 10 s (deux onglets), réponse 409 sans révocation. Durée 7 jours glissants, plafond absolu de 30 jours (`authenticatedAt`).
  - `JwtAuthGuard` et les deux gateways passent par `SessionService.verifyAccess` : signature et `typ` (S3), puis session active et `isSuspended = false`. Statut mis en cache Redis **60 s au plus** (TTL vérifié par test) ; invalidation immédiate à la révocation ; en cas d'indisponibilité de Redis (500 ms), repli sur la base (pas d'indisponibilité du service).
  - Cookies `accessToken` (`Path=/`, 15 min) et `refreshToken` (`Path=/auth`, 7 j), `httpOnly`, `SameSite=Strict`, `Secure` en production. **Plus aucun jeton dans le corps des réponses.**
  - Routes : `POST /auth/refresh` (public, 30/min), `POST /auth/logout` (public, idempotent : révoque via le jeton d'accès ou, s'il est expiré, via le cookie de rafraîchissement ; efface les deux cookies), `GET /auth/sessions` et `DELETE /auth/sessions/:sid` (jamais la session d'un autre : 404).
  - `AdminService.revokeUserSessions` révoque réellement (compte de sessions réel dans l'audit). Impersonation : session de 15 min sans jeton de rafraîchissement, portant `impersonatedBy`.
  - WebSocket : `auth/ws-auth.ts` (`authenticateSocket`) lit `auth.token`, l'en-tête ou le **cookie `accessToken`** du handshake, vérifie comme le guard HTTP, puis revalide la **session** toutes les 60 s (la socket survit au renouvellement du jeton mais tombe dès la révocation).
- **Changement (frontend)** :
  - `frontend/src/api-session.ts` (nouveau, installé dans `main.tsx`) : `credentials: 'include'` sur tous les appels vers l'API, rotation unique (mono-vol) sur un 401 puis rejeu, événement de fin de session. Les routes de connexion ne déclenchent jamais de rotation.
  - `AppContext.tsx` : plus de `token` dans l'état ni dans `localStorage` (un ancien profil contenant un jeton est purgé au démarrage) ; `getHeaders` sans `Authorization` ; Socket.IO en `withCredentials` avec reconnexion après rotation ; déconnexion par `POST /auth/logout`. Composants adaptés : `AdminConsole`, `AgileView`, `CapacityView`, `FinancesView`, `IntegrationsPanel`, `NotificationInbox`.
  - Console admin : « quitter l'impersonation » révoque la session d'impersonation puis ramène à la connexion (plus de sauvegarde de session en `sessionStorage`).
- **Tests** :
  - `backend/tests/http/session-lifecycle.spec.ts` (11, application Nest réelle, faux Prisma et faux Redis) : corps sans jeton et cookies `HttpOnly`/`SameSite=Strict`/`Max-Age=900`/`Path=/auth` ; `exp - iat <= 900` avec `sid` et `jti` ; jeton sans `sid` : 401 ; **login, logout, ancien cookie : 401**, refresh révoqué ; **suspension en base : coupée en moins de 60 s** (TTL Redis tous <= 60) ; compte suspendu ne rafraîchit plus ; rotation puis rejeu hors tolérance : **famille révoquée** (le nouvel accès et le nouveau refresh meurent) ; deux onglets sous 10 s : 409 sans révocation ; plafond de 30 jours ; refresh sans cookie : 401 ; refresh jamais stocké en clair ; **révocation administrative immédiate** ; impersonation sans refresh et `impersonatedBy` ; liste des sessions ; `DELETE` d'une session d'autrui : 404 ; Redis indisponible : 200 (repli base). **Avant correctif : 10 échecs sur 11** (le onzième passait trivialement par un 404).
  - `notifications.gateway.spec.ts` : handshake par cookie ; socket coupée dans la minute après révocation (timers factices) ; handshake sans jeton refusé. `admin.service.spec.ts` : révocation par `SessionService`, aucun `deleteMany`.
  - Frontend : `api-session.spec.ts` (9 : cookies, rotation unique, mono-vol, fin de session, routes exclues, 409), `AppContext.session.spec.tsx` (3 : **aucun jeton dans `localStorage`**, aucun `Authorization`, purge d'un ancien jeton, logout serveur), `AdminConsole.spec.tsx` adapté. Ces tests frontend n'ont pas été exécutés sur l'ancien code (l'architecture a changé en profondeur) ; le défaut d'origine est établi par lecture (`token: data.accessToken` puis `localStorage.setItem`).
  - Suites : backend 40 suites / 328 tests, `pnpm build` OK (aussi sans `DATABASE_URL`) ; frontend 12 fichiers / 38 tests, `pnpm build` OK ; ESLint 0 erreur.
- **Changements cassants** : **toutes les sessions existantes sont invalidées** (jetons sans `sid`) ; les routes de connexion ne renvoient plus `accessToken` (cookies) ; le jeton d'accès vit 15 min ; les clients non navigateur peuvent encore présenter un `Bearer`, mais n'en reçoivent plus (à documenter pour les scripts).
- **Écarts par rapport au rapport** (mineurs, à valider) :
  1. `Path=/auth` pour le cookie de rafraîchissement, au lieu de `/auth/refresh` : `logout` doit aussi le recevoir pour révoquer une session dont le jeton d'accès a expiré. Il reste limité aux routes `/auth/*`.
  2. Les gateways surveillent la **session** toutes les 60 s, pas le jeton, pour ne pas couper une socket à l'expiration des 15 minutes.
  3. CSRF : `SameSite=Strict` plus CORS restreint aux origines autorisées. Le frontend et l'API doivent rester du même site (`planner-pro.boukarou-os.com` et `api.planner-pro.boukarou-os.com` le sont).
- **Alerte (test)** : dans `localhost`, une base MySQL de développement écoute sur le port 3306. Un premier essai de test importait `PrismaModule` et a donc instancié le vrai `PrismaService` (une lecture a échoué, **aucune écriture**). Garde-fou ajouté dans `tests/http/http-test-app.ts` : un test HTTP échoue si un vrai `PrismaService` est instancié. Recommandation pour A7/A9 : exiger `DATABASE_URL` explicite en `NODE_ENV=test` (aujourd'hui `buildMariaDbOptions` retombe sur `root@localhost` dans cet environnement).
- **Questions pour l'architecte** : durée de 7 jours glissants et plafond de 30 jours acceptés ? Le `Bearer` est-il à retirer complètement quand les scripts d'exploitation n'en dépendent plus ?

### S8 — Contrôles non uniformes à la connexion (MFA et suspension contournés par GitHub, Firebase et SSO)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : seul `login()` vérifiait `isSuspended` et le MFA ; `loginWithGitHub`, `loginWithFirebase` et `SsoService.handleCallback` émettaient leur propre JWT sans contrôle ; `loginWithFirebase` liait automatiquement par e-mail un compte existant à l'identité Firebase.
- **Changement** :
  - `AuthService.completeLogin(user, { method, … })` applique, pour **toutes** les méthodes : suspension (403), `enforceSSO` du domaine (403 pour mot de passe, GitHub et Firebase), MFA (ticket à usage unique à la place de la session), puis émission. `login`, `verifyMfaChallenge`, `loginWithGitHub`, `loginWithFirebase`, `register`, `mockLogin`, `SsoService.handleCallback` et l'impersonation y aboutissent. L'impersonation n'est soumise ni à `enforceSSO` ni au MFA du compte cible, mais reste refusée pour un compte suspendu.
  - Le ticket MFA conserve la **méthode d'origine** (`<userId>|<méthode>` dans Redis) : un challenge issu d'une connexion SSO n'est pas refusé par `enforceSSO`.
  - Liaison d'identité : plus aucune liaison automatique. Firebase vérifié sur un compte existant (mot de passe, GitHub, ou **provisionné par SCIM**) : 409 « connectez-vous puis liez » ; `firebase/link` (session authentifiée) reste le seul chemin.
  - Frontend : GitHub, SSO et Firebase gèrent désormais le ticket MFA (`MfaChallenge`) ; `Login` accepte un `initialMfaTicket` issu d'un retour OAuth.
- **Tests** : `backend/tests/unit/auth/login-policy.spec.ts` (24, vrais `AuthService` et `SessionService`, faux Prisma) : pour chacune des 4 méthodes, compte suspendu (403, aucune session), MFA actif (`mfaRequired` + ticket, **aucun `accessToken`**), compte normal (session) ; `enforceSSO` avec la fonctionnalité active (3 méthodes refusées, SSO autorisé) et désactivée (personne n'est enfermé dehors) ; challenge issu du SSO malgré `enforceSSO` ; suspension entre le ticket et le challenge ; impersonation d'un compte suspendu refusée, sans refresh pour un compte MFA ; **Firebase sur compte existant : 409 sans `update`, `firebaseUid` inchangé** ; **compte provisionné par SCIM : 409, jamais réclamé** ; création pour un e-mail inconnu. **Avant correctif : 14 échecs sur 24**. Test vitest du retour OAuth avec ticket MFA. L'ancien test `auth.service.spec` qui **validait** la liaison automatique est remplacé par un test 409.
- **Écarts par rapport au rapport** :
  1. Ordre : suspension, **`enforceSSO`**, MFA (le rapport met le MFA avant `enforceSSO`) : on n'émet pas de ticket pour une méthode de toute façon interdite.
  2. `enforceSSO` n'est appliqué que si `FEATURE_SSO_ENABLED=true` : tant que la propriété du domaine n'est pas prouvée (S10), un `enforceSSO` posé sur un domaine tiers permettrait de verrouiller les comptes d'une autre organisation. **À ne pas réactiver sans S10.**
  3. Équivalent GitHub de `firebase/link` : voir S9 (`/auth/github/link`). L'équivalent SSO relève de la Phase 2.
  4. Point 4 (pré-occupation SCIM) : couvert par la règle générale « compte existant sans l'identifiant correspondant : 409 ». Le premier rattachement d'un compte provisionné passe par la réinitialisation de mot de passe par e-mail (P6).
- **Question pour l'architecte** : l'ordre `enforceSSO` avant MFA est-il accepté ?

### S6 — Cycle de vie du MFA faible

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `setupMfa` écrasait `mfaSecret` même avec le MFA actif, sans réauthentification ; `disableMfa` n'exigeait qu'un code ; secret en clair en base ; un même code valable ~90 s ; aucun code de récupération ; corps sans DTO.
- **Changement** :
  - `setupMfa` : 409 si le MFA est actif ; le secret est stocké **chiffré** dans `mfaPendingSecret` ; `confirmMfa` le promeut dans `mfaSecret` (chiffré, format `iv:tag:data`), active le MFA, consomme le pas de temps et livre **10 codes de récupération** (Argon2id, affichés une seule fois, `RECOVERY_ALPHABET` sans caractères ambigus).
  - `disableMfa` et `POST /auth/mfa/recovery-codes` (régénération) exigent le facteur actuel **et** le mot de passe ; pour un compte sans mot de passe, une connexion de moins de 5 minutes (`authenticatedAt` de la session). La désactivation efface secrets et codes et **révoque les autres sessions**.
  - Anti-rejeu : `User.mfaLastUsedStep`, mise à jour conditionnelle (`lt`) donc sûre en concurrence ; un code TOTP ne passe qu'une fois, aussi entre deux tickets.
  - Challenge : `MfaChallengeDto` (code `/^\d{6}$/` ou `recoveryCode`), code de secours à usage unique (`updateMany` conditionnel sur `usedAt: null`). DTO `MfaCodeDto`, `DisableMfaDto`, `RegenerateRecoveryCodesDto`.
  - Lecture tolérante : un secret encore en clair (avant le script) reste valide ; écriture toujours chiffrée.
  - Migration `20261109000100_s6_mfa_lifecycle` (`mfaPendingSecret`, `mfaLastUsedStep`, table `MfaRecoveryCode`). Script `backend/scripts/encrypt-mfa-secrets.ts` (rapport par défaut, `--apply`, CSV sans secret, conditionnel donc idempotent), **non exécuté**.
  - Frontend : le challenge propose « Utiliser un code de récupération ». Il n'existe pas d'écran d'activation du MFA dans le frontend (constat de lecture) : les routes sont prêtes, l'écran reste à produire.
- **Tests** : `backend/tests/unit/auth/mfa-lifecycle.spec.ts` (15) : `setupMfa` actif : 409 sans écriture ; secret en attente chiffré (`/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/`), `mfaSecret` intact ; confirmation (secret chiffré, 10 codes hachés, aucun en clair) ; mauvais code et MFA déjà actif ; `disableMfa` sans mot de passe, avec mauvais mot de passe, avec mauvais code : refusé ; avec code et mot de passe : secrets effacés, **autres sessions révoquées** ; compte sans mot de passe : réauthentification de 5 minutes ; régénération ; **même code TOTP deux fois : le second refusé** ; code de secours une seule fois ; 400 sans code ; secret en clair toujours valide. `tests/http/mfa-ticket.spec.ts` : 4 cas de DTO invalides en 400. `tests/unit/scripts/encrypt-mfa-secrets.spec.ts` (4). **Avant correctif : 14 échecs sur 15**.
- **Ajustement de test** : les bornes de durée du test S3 « Redis indisponible » passent de 2,5 s à 3 s (le délai Redis reste de 2 s) : l'exécution en parallèle avec les tests Argon2 dépassait 2,5 s de façon intermittente.
- **Écarts** : `Path=/auth` etc. non concernés. Un code de secours est accepté pour désactiver le MFA (utile quand l'appareil est perdu) mais pas pour régénérer les codes.
- **Question pour l'architecte** : accepter qu'un code de secours serve à désactiver le MFA (avec le mot de passe) ?

### S9 — OAuth GitHub : pas de `state`, liaison par e-mail non vérifié, portée excessive

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : le frontend construisait l'URL GitHub lui-même (pas de `state`, `scope=user,repo`) ; `loginWithGitHub` ne contrôlait pas `res.ok`, utilisait l'e-mail public du profil, un e-mail `primary` sans `verified`, fabriquait `<login>@github.planner.pro`, et faisait un `upsert` par **e-mail** qui rattachait et écrasait tout compte existant ; corps sans DTO.
- **Changement** :
  - `GET /auth/github/authorize?purpose=login|link|repos` (public, 20/min) : `state` de 32 octets aléatoires, cookie `github_oauth_state` signé (`<state>.<HMAC-SHA256>`, clé dérivée par HKDF de `JWT_SECRET`), `httpOnly`, `SameSite=Lax`, `Path=/auth/github`, 10 min ; renvoie l'URL d'autorisation. `redirect_uri` fixé côté serveur (origine de `FRONTEND_URL`) ; portée **`read:user user:email`** ; `repo` seulement pour `purpose=repos`.
  - `POST /auth/github/login` (`GithubLoginDto { code, state }`) : égalité du `state` et du cookie en **temps constant** (`timingSafeEqual`, signature vérifiée d'abord), cookie effacé après usage, 401 sinon et **avant tout appel à GitHub**.
  - Identité par **`githubId`** : compte trouvé par `githubId` ; sinon uniquement l'e-mail **vérifié** (`verified === true`, primaire de préférence) de `/user/emails` ; **e-mail déjà connu sans `githubId` : 409**, aucun `update`/`upsert` ; aucun e-mail vérifié : 401 (plus d'e-mail fabriqué) ; l'e-mail public du profil n'est jamais utilisé. `res.ok` contrôlé sur les trois appels.
  - `POST /auth/github/link` (session authentifiée) : seule voie de liaison d'un compte existant ; 409 si ce GitHub appartient à un autre compte ; sert aussi à obtenir la portée `repo`.
  - Frontend : `frontend/src/github-oauth.ts` (`startGitHubAuthorization`) remplace les deux URLs construites à la main (`Login.tsx`, `InvitationAcceptance.tsx`) ; `App.tsx` transmet le `state` renvoyé par GitHub.
  - `VITE_GITHUB_CLIENT_ID` n'est plus lu par le frontend (commentaire d'obsolescence dans les `.env*.example`).
- **Tests** : `backend/tests/unit/auth/github-oauth.spec.ts` (19, `fetch` simulé) : `state` absent, sans cookie, différent : 401 sans appel GitHub ni compte ; cookie falsifié rejeté ; `state` d'au moins 32 octets ; `res.ok` faux sur le jeton, `/user`, `/user/emails` : 401 ; **e-mail primaire non vérifié : 401** ; aucun e-mail : 401 sans e-mail fabriqué ; **e-mail public du profil non cru** ; **compte existant sans `githubId` : 409, aucun update, `githubId` inchangé** ; compte déjà lié connecté même si son e-mail GitHub a changé (jeton chiffré) ; création avec e-mail vérifié ; liaison (succès, GitHub déjà lié : 409, `state` obligatoire) ; portée `read:user user:email` sans `repo`, `repo` seulement pour `repos`. **Avant correctif : 15 échecs sur 19**. Frontend : `github-oauth.spec.ts` (3). Le test S8 de la matrice a été adapté à la nouvelle signature.
- **Écarts par rapport au rapport** : l'endpoint `authorize` renvoie un JSON `{ url }` (appelé en `fetch` avec cookies, puis navigation) plutôt qu'une redirection 302, pour garder l'erreur affichable dans l'application ; le cookie est de ce fait posé par une requête XHR de même site. Un nouveau compte GitHub n'a toujours pas de données d'onboarding (comportement antérieur conservé, hors périmètre).
- **Action d'exploitation** : les applications GitHub OAuth existantes doivent avoir l'URL de rappel égale à l'origine de `FRONTEND_URL` (comme avant) ; les jetons GitHub déjà stockés ont l'ancienne portée `repo` : ils restent valides jusqu'à révocation côté GitHub (à faire pour réduire l'exposition).

### P6 — Parcours de compte : vérification d'e-mail et réinitialisation de mot de passe

- **Statut** : `CORRIGÉ – À REVOIR` (périmètre : vérification d'e-mail et réinitialisation ; les codes de récupération MFA sont livrés avec S6 ; voir « Écarts » pour la liste des sessions)
- **Cause confirmée** : `register` créait le compte avec n'importe quelle adresse et ouvrait aussitôt une session (aucune preuve de propriété de l'adresse : pré-occupation d'un compte avant la liaison GitHub ou Firebase d'un tiers) ; aucune route de réinitialisation (compte verrouillé = support) ; un compte provisionné par SCIM n'avait aucun moyen d'obtenir un premier accès (S8).
- **Changement** :
  - Schéma et migration `20261109000200_p6_email_verification_and_auth_tokens` : `User.emailVerifiedAt` ; table `AuthToken` (`EMAIL_VERIFICATION` / `PASSWORD_RESET`, `tokenHash` unique, `expiresAt`, `usedAt`, suppression en cascade). **Reprise de données** dans la même migration : `UPDATE User SET emailVerifiedAt = createdAt` (comptes existants considérés comme vérifiés, décision produit). Non exécutée.
  - `AuthService` (`auth.service.ts`) : `issueAuthToken` (256 bits `base64url`, stocké en SHA-256, invalide les jetons précédents du même type) et `consumeAuthToken` (type, expiration, **usage unique atomique** par `updateMany` sur `usedAt: null`). `register` : réponse générique, compte sans session et sans `emailVerifiedAt`, e-mail de vérification (24 h) ; `verifyEmail`, `resendVerification` (silencieux si inconnu ou déjà vérifié), `requestPasswordReset` (30 min, réponse identique), `resetPassword` (mot de passe changé, adresse considérée vérifiée, **toutes les sessions révoquées** par `SessionService.revokeAllForUser`, MFA conservé). `login` refuse (403) un compte non vérifié **après** contrôle du mot de passe (un inconnu ou un mauvais mot de passe donne toujours 401). GitHub et Firebase marquent `emailVerifiedAt` à la création (adresse attestée vérifiée par le fournisseur).
  - `auth.controller.ts` : `POST /auth/register` (202), `/auth/email/verify`, `/auth/email/resend` (202, 3/min), `/auth/password/forgot` (202, 3/min), `/auth/password/reset` (5/min). `dto/password-reset.dto.ts` ; la politique de mot de passe (10 caractères, majuscule, minuscule, chiffre ou spécial) est factorisée dans `register.dto.ts` et appliquée à la réinitialisation.
  - `mail.service.ts` : `sendEmailVerificationEmail`, `sendPasswordResetEmail`, `sendAccountExistsEmail` (notifie le titulaire d'une tentative d'inscription sur son adresse), valeurs interpolées échappées. Sans SMTP, le lien est journalisé (mode simulé existant).
  - Frontend : `account-api.ts` (appels en POST, jeton jamais dans l'URL d'un appel d'API ; `readAccountLink` lit `?verify=` / `?reset=` et **retire le jeton de l'URL**), `AccountLinkPage.tsx` (action déclenchée **par un clic**, pas à l'ouverture : un scanner de liens ne consomme pas le jeton), `App.tsx`, `Login.tsx` (inscription : message générique, plus de connexion automatique, minimum 10 caractères aligné sur le backend, « Mot de passe oublié ? », « Renvoyer l'e-mail de confirmation » sur un 403 « non vérifiée »), `AppContext.classicRegister` renvoie le message.
- **Tests** :
  - `backend/tests/unit/auth/account-lifecycle.spec.ts` (19, vrais `AuthService` et `SessionService`, faux Prisma) : inscription (aucune session, jeton haché, TTL 24 h, adresse existante : même réponse, aucune écriture, notification), connexion refusée avant vérification (403) et 401 indiscernable pour un mauvais mot de passe, lien valide / réutilisé / expiré / inconnu, **confusion de type** (jeton de réinitialisation refusé pour vérifier, et inversement), renvoi, réinitialisation (réponse identique pour inconnu, TTL 30 min, nouveau lien invalidant l'ancien, **sessions révoquées**, ancien mot de passe refusé, compte SCIM sans mot de passe rendu accessible, MFA conservé, politique de mot de passe).
  - `backend/tests/http/account-routes.spec.ts` (5, application Nest réelle) : register 202 sans cookie ni jeton, réponse identique pour un doublon, 403 puis 201 après vérification, forgot 202, DTO faible 400.
  - Frontend : `Login.spec.tsx` (+4 : message générique, 10 caractères, mot de passe oublié, renvoi), `AccountLinkPage.spec.tsx` (6 : pas d'appel à l'ouverture, jeton dans le corps, lien expiré, validations, nettoyage de l'URL).
  - **Avant correctif** : la session précédente a été interrompue après l'écriture conjointe du code et de `account-lifecycle.spec.ts`; je n'ai donc pas de mesure fiable « avant » (l'ancien `register` renvoyait un jeton et n'avait aucune de ces routes : les 18 tests décrivent un comportement absent de `HEAD`). Je ne la fabrique pas.
  - Reprise de l'état : trois suites (`login-policy`, `mfa-lifecycle`, `github-oauth`) échouaient (59 tests) faute du fournisseur `MailService` dans leur module de test, ajouté ; `admin.service.spec` attendait un contexte sans `method: 'impersonation'` (reliquat de S8), aligné ; ESLint `no-useless-assignment` (S6, `verifyCurrentFactor`) corrigé (`let valid: boolean`).
- **Écarts par rapport au rapport** :
  1. **Codes de récupération MFA** : livrés avec S6. **Page « Sessions actives »** : les routes `GET /auth/sessions` et `DELETE /auth/sessions/:sid` existent depuis S7, mais **aucun écran frontend** n'est produit ici (il n'existe pas non plus d'écran d'activation du MFA : ces deux écrans relèvent d'une page « Sécurité du compte » à décider côté produit). À valider.
  2. Les comptes Firebase ne passent pas par ce parcours (la vérification d'adresse est faite par Firebase, `emailVerified` exigé côté serveur).
  3. Pas de limitation par adresse, seulement par IP (`Throttle`) : une file d'envoi par adresse relève de A7 (rate limiting avec Redis).
- **Compatibilité** : `POST /auth/register` renvoie 202 `{ message }` (plus de session ni d'utilisateur) ; les liens d'e-mail pointent vers `FRONTEND_URL/?verify=` et `/?reset=`. Un utilisateur qui s'inscrit doit ouvrir son e-mail avant sa première connexion.
- **Questions pour l'architecte** : (a) la page « Sessions actives » et l'écran MFA peuvent-ils être reportés à une tâche produit distincte ? (b) la réinitialisation prouve la propriété de l'adresse et marque le compte vérifié : acceptable pour les comptes SCIM ? (c) `sendAccountExistsEmail` est un courriel non sollicité possible vers un tiers (limité à 5/min/IP) : l'accepter ou le retirer ?

### S27 — Énumération des comptes et comparaisons non constantes

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `login` répondait sans hachage pour un utilisateur absent (oracle temporel : environ 0 contre plusieurs dizaines de ms d'Argon2) ; `verifyPassword` comparait le PBKDF2 legacy par `===` ; `checkInvitation` (route publique) renvoyait l'e-mail invité et, à défaut de nom, l'e-mail de l'invitant ; `discover` (public) renvoyait le nom du workspace d'un domaine. `register` (« Cet e-mail est déjà utilisé ») est traité avec P6 (202 générique).
- **Changement** :
  - `auth.service.ts` : `login` vérifie un hachage Argon2id factice (mêmes paramètres, calculé une fois) quand le compte est absent **ou sans mot de passe** ; même message 401. `register` hache dans les deux branches.
  - `encryption.util.ts` : `crypto.timingSafeEqual` sur des tampons de même longueur (hachage mal formé : refus sans exception).
  - `projects/mask-email.ts` (nouveau) et `invitations.service.ts` : `email` masqué (`j***@e***.com`), plus d'e-mail d'invitant.
  - `sso.service.ts` : `discover` ne lit plus le workspace et ne renvoie plus `workspaceName`. Frontend : `Login.tsx` n'affiche plus que « Connexion unique (<fournisseur>) ».
- **Tests** : `backend/tests/unit/auth/enumeration-timing.spec.ts` (10) et `sso.service.spec.ts` (assertion inversée) : `argon2.verify` appelé pour un inconnu, un compte sans mot de passe et un compte existant (mêmes réponses d'erreur), `timingSafeEqual` appelé pour PBKDF2 (valide, invalide) et hachages mal formés refusés, `maskEmail`, `checkInvitation` sans adresse en clair, `discover` sans `workspaceName`. **Avant correctif : 7 échecs sur 19** (tests S27 et `sso.service.spec`, avec un `maskEmail` neutre en attendant).
- **Écart par rapport au rapport** : le critère « temps de réponse comparable » est vérifié par l'appel d'`argon2.verify` (comme le rapport le propose), pas par une mesure de durée (instable en CI). Le nom du workspace reste renvoyé par `checkInvitation` : il faut posséder le jeton d'invitation (secret de 256 bits).
- **Question pour l'architecte** : l'invité voit son adresse masquée ; si le produit veut la pré-remplir à l'inscription, il faudra un autre mécanisme (le jeton seul suffit à l'accepter).

### Résultats de la reprise (P6, S27)

Backend : 47 suites, 428 tests passés ; `pnpm build` OK ; ESLint sans erreur sur les fichiers touchés (1 avertissement préexistant, `tracking.gateway.spec.ts`). Frontend : 14 fichiers, 53 tests passés ; `pnpm build` OK ; ESLint 0 erreur (6 avertissements `any` préexistants). Aucune migration ni script exécuté, aucune connexion à la base de développement.

## Actions de la revue r4 (Phase 1) et de la revue r5 (P6)

Statuts : toutes les entrées ci-dessous passent à `CORRIGÉ – À REVOIR` (sauf mention contraire). Rien n'a été exécuté contre une base réelle (`DATABASE_URL` est désormais forcée sur `127.0.0.1:1` sous Jest, voir A7), aucun commit.

### S6-a — Erreur ESLint `no-useless-assignment` (`verifyCurrentFactor`)

- **Statut** : `CORRIGÉ – À REVOIR` (confirmation).
- **Changement** : `auth.service.ts` (`verifyCurrentFactor`) : `let valid: boolean;`. Corrigé lors de la reprise précédente (voir « Reprise de l'état » dans l'entrée P6). `npx eslint` sur les fichiers touchés : 0 erreur.

### S7-a — La revalidation des sockets lisait le cache de 60 s

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `ws-auth.ts` appelait `isSessionActive`, qui consulte d'abord Redis ; une suspension posée en base sans `revoke`, avec un cache rempli juste avant, laissait la socket vivre jusqu'à environ 120 s.
- **Changement** : `SessionService.isSessionActive(sid, userId, { bypassCache })` : en mode `bypassCache`, lecture directe en base, cache rafraîchi si actif et **supprimé** si inactif. `ws-auth.ts` l'utilise pour le tick de 60 s.
- **Tests** : `tests/unit/auth/ws-revalidation.spec.ts` (2, vrais `SessionService` et `authenticateSocket`, timers factices) : cache rempli à t+1 s, suspension en base sans `revoke`, socket coupée au premier tick ; session saine conservée. **Avant correctif : 1 échec sur 2.**

### S29 — CSRF et détournement de WebSocket depuis un sous-domaine du même site ; préfixes de cookies

- **Statut** : `CORRIGÉ – À REVOIR` (S7-b clos avec lui)
- **Changement** :
  - `auth/origin-guard.ts` (nouveau) : `originCheckMiddleware()`, posé dans `main.ts` après `cookieParser`. Pour `POST/PUT/PATCH/DELETE` portant un cookie de session (avec ou sans préfixe), exige `Origin` (à défaut l'origine du `Referer`) dans `CORS_ORIGINS` (repli `http://localhost:3000`, comme le CORS de `main.ts`), sinon 403. `Origin: null` : 403. Exemptions listées dans le fichier : `/(projects/)webhooks/github` et `/scim/v2/*`. Les requêtes sans cookie de session (Bearer, routes publiques) ne sont pas contrôlées. `tests/http/http-test-app.ts` installe le même middleware.
  - `ws-auth.ts` : si le jeton vient du **cookie**, l'`Origin` du handshake doit être autorisée, sinon 401 ; `auth.token` et `Authorization: Bearer` restent acceptés sans `Origin`.
  - `session-cookies.ts` : en production, `__Host-accessToken` (Secure, `Path=/`, sans `Domain`) et `__Secure-refreshToken` (`Path=/auth`, `__Host-` étant incompatible) ; lecture sur l'en-tête brut, une **valeur en double** pour un même nom est ignorée (cookie déposé par un voisin) ; en production, le cookie sans préfixe n'est pas lu.
- **Tests** : `tests/http/csrf-origin.spec.ts` (10, application Nest réelle) : cookie + `Origin` voisine, formulaire `urlencoded`, absence d'`Origin`, `logout` cross-origin (403 et session intacte), `Origin` autorisée (2 origines), `Referer` autorisé et étranger, `Origin: null`, GET libre, exemptions webhook et SCIM avec ou sans cookie ; `tests/unit/auth/ws-origin-cookies.spec.ts` (8) : handshake refusé/accepté, noms et attributs des cookies en production, doublons. `session-lifecycle.spec.ts` et `notifications.gateway.spec.ts` envoient désormais l'`Origin` du frontend, comme un navigateur. **Avant correctif : 8 échecs sur 10** (`csrf-origin`).
- **Écarts / remarques** : un client navigateur de même origine envoie déjà `Origin` sur les `POST` ; un script non navigateur qui utiliserait un cookie doit envoyer `Origin` (ou utiliser le `Bearer`) : consigné au runbook (section 6). Anciens cookies sans préfixe : ignorés en production, ce qui revient à une reconnexion (déjà annoncée).
- **Question** : `Referer` accepté à défaut d'`Origin` (navigateurs qui l'omettent sur certaines requêtes) : le rapport le prévoit, confirmer.

### S6-b — `setupMfa` sans réauthentification

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `SetupMfaDto { password? }` ; `setupMfa(userId, dto, sid)` appelle `assertReauthenticated` (mot de passe, sinon connexion de moins de 5 min) avant toute écriture ; route `POST /auth/mfa/setup` limitée à 5/min. Aucun appelant frontend n'existe (P9).
- **Tests** (`mfa-lifecycle.spec.ts`, 17) : sans mot de passe ou avec un mauvais : 403 sans `update` ; compte sans mot de passe, connexion de plus de 5 min : 403, récente : accepté. **Avant correctif** : la suite ne compilait pas avec la nouvelle signature (pas de comptage fiable).

### S9-a — La connexion GitHub écrasait `githubAccessToken`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `loginWithGitHub` ne persiste plus jamais le jeton (ni à la création) ; `githubUsername` n'est mis à jour qu'**après** `completeLogin` (suspension, `enforceSSO`, MFA). `linkGitHubAccount` ne stocke le jeton (chiffré) que pour la finalité `repos` **et** si le champ `scope` de GitHub contient `repo` ; réponse enrichie de `repoAccess`. Le message 409 mentionne « Mot de passe oublié » (P6-c) pour GitHub et Firebase.
- **Tests** (`github-oauth.spec.ts`, 28) : jeton stocké `X` inchangé après connexion ; nouveau compte sans jeton ; compte suspendu : 403, **aucun `update`** ; `link` sans jeton ; `repos` avec `repo` : jeton chiffré ; `repos` sans `repo` : pas de jeton.

### S9-b — Finalité du flux GitHub non liée au `state`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : cookie `<state>.<finalité>.<HMAC>` (la finalité est signée) ; `verifyGithubOAuthState(cookie, state, finalitésAcceptées)` : `/auth/github/login` n'accepte que `login`, `/auth/github/link` que `link` et `repos`. `GET /auth/github/pending` (public, 30/min) renvoie la finalité du cookie signé (401 sinon). Frontend : `fetchGitHubPurpose` et `linkGitHub` (`github-oauth.ts`) ; `App.tsx` appelle `/pending`, puis `login` ou `link` selon la finalité (message « Compte GitHub associé. »).
- **Tests** : backend (5 dans `github-oauth.spec.ts`) : state `link`/`repos` présenté à la connexion : 401 sans appel GitHub ; state `login` présenté à la liaison : 401 ; finalité modifiée : cookie invalide ; `readGithubOAuthPurpose`. Frontend : `github-oauth.spec.ts` (+3). Aucun écran n'appelle encore `startGitHubAuthorization('link'|'repos')` (P9).

### S7-c / S6-c — Runbook de la Phase 1

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `docs/security/runbook-phase1.md` (nouveau) : ordre de déploiement et variables (SMTP obligatoire en production, `CORS_ORIGINS`), déconnexion générale, **les trois migrations** (`20261109000000`, `…0100`, `…0200`) avec leurs contrôles, y compris la **reprise P6** (`emailVerifiedAt = createdAt`, comptes SCIM), `encrypt-mfa-secrets.ts` (rapport, relecture, sauvegarde, `--apply`, seconde exécution, CSV conservé), révocation des jetons GitHub `repo`, contrat des cookies et scripts, vérifications, retour arrière (dont le piège des secrets MFA chiffrés), purge planifiée.

### A7 (avancé) — Aucun repli de DSN en `NODE_ENV=test`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `database-url.ts` : `allowsLocalDsnFallback` (seulement `development`) utilisé par `buildMariaDbOptions` et `resolveCliDatasourceUrl` ; `tests/support/jest-env.ts` (via `setupFiles` de Jest) force `DATABASE_URL=mysql://test:test@127.0.0.1:1/planner_pro_test` (seule `E2E_DATABASE_URL` explicite la remplace). Le garde-fou reste en plus dans `http-test-app.ts`.
- **Tests** : `prisma.service.spec.ts` (test sans `DATABASE_URL` : erreur ; sous Jest l'URL vise `127.0.0.1:1`), `database-url.spec.ts`. **Avant correctif : 3 échecs.**
- **Remarque** : `allowPublicKeyRetrieval` reste permis en `test`/`development` sans TLS (inchangé).

### A3 — Deux actions non bloquantes

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : (1) `session.test-support.ts` déplacé sous `backend/tests/support/` (imports adaptés) ; comme des `*.spec.ts` de `src/` l'importent, ajout de `backend/tsconfig.build.json` (exclut `**/*.spec.ts` et `tests/`) : `nest build` n'émet plus aucun spec ni support de test dans `dist/` (**critère** : `find dist -name "*test-support*"` vide, vérifié). (2) Migration `20261109000000` : `DELETE FROM RefreshToken;` avant l'`ALTER`.
- **Écart** : `tsconfig.build.json` est un ajout (le rapport ne le prévoyait que pour la sortie `dist`).

### S18.2 — Routes interdites en session d'impersonation

- **Statut** : `CORRIGÉ – À REVOIR` pour la liste de routes ; **EN SUSPENS** pour la révocation de la session de l'administrateur à l'impersonation (hors de ce qui reste simple : elle suppose de transmettre `sid` de l'acteur au service et de ne pas casser le contrat du contrôleur ; à traiter avec S18.3 en Phase 4). Le drapeau `FEATURE_IMPERSONATION_ENABLED` doit donc **rester désactivé**.
- **Changement** : `JwtAuthGuard` : 403 si `impersonatedBy` est présent et que la route est `/auth/mfa/*`, `/auth/github/link`, `/auth/firebase/link`, `DELETE /auth/sessions/*`, `/auth/password/*` ou `/admin/*`.
- **Tests** : `tests/unit/auth/impersonation-routes.spec.ts` (23, paramétré) : chaque route interdite refusée en impersonation et autorisée sinon ; `/projects`, `logout`, `GET /auth/sessions` restent utilisables. **Avant correctif (règle neutralisée) : 10 échecs sur 23.**

### P6-a — Des liens secrets écrits dans les journaux

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `MailService.sendMail` basculait en mode simulé sans SMTP **et** après tout échec d'envoi, en journalisant le texte complet (liens de vérification, de réinitialisation, d'invitation).
- **Changement** (`mail.service.ts`) : hors `development`/`test`, le corps n'est jamais journalisé (destinataire masqué par `maskEmail`, sujet, message d'erreur seulement, jamais l'objet d'erreur complet) ; le repli simulé après échec n'existe qu'en développement/test ; en production, **refus de démarrer sans `SMTP_HOST` et `SMTP_PORT`** (et sans transporteur créable) ; hors production sans SMTP (staging), rien n'est envoyé et le corps n'est pas journalisé (retour `false`). Le même mécanisme protège les e-mails d'invitation.
- **Tests** : `mail.service.security.spec.ts` (7, espion sur `log`, `warn`, `error`, `debug`, `verbose`, `fatal`) : production avec SMTP en échec : le jeton ne figure dans **aucun** appel au Logger, ni l'adresse en clair, pas de repli simulé ; envoi réussi ; production sans SMTP : erreur ; staging sans SMTP ; développement : simulé conservé. Je n'ai pas mesuré l'état « avant » (la suite a été écrite avec le correctif) ; l'ancien code journalisait le corps dans les deux cas par lecture directe de `sendMail`.
- **Question** : un échec SMTP en production renvoie `false` et la demande est silencieusement perdue côté utilisateur (réponse générique) : acceptable ? Une file d'envoi avec reprise relève d'un chantier ultérieur.

### P6-b — Oracle temporel par l'attente de l'envoi d'e-mail

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `AuthService.sendDetached` (envoi non attendu, erreur journalisée) remplace `await safeMail` pour `register` (nouvelle adresse et notification « compte existant »), `resendVerification` et `requestPasswordReset`. Les écritures en base restent dans la requête.
- **Tests** (`account-lifecycle.spec.ts`) : avec des `MailService` dont la promesse ne se résout **jamais**, les six appels (register nouvelle/existante, forgot connue/inconnue, resend connue/inconnue) se résolvent avec les mêmes messages (délai de garde de 3 s) ; un envoi qui échoue ne casse pas la réponse. **Avant correctif : échec** (attente de 3 s dépassée).
- **Résidu connu** : `register` d'une adresse nouvelle écrit en base (compte, onboarding, jeton) alors que l'adresse existante ne fait qu'une lecture ; la différence de durée est de l'ordre de quelques millisecondes à dizaines de millisecondes. Un `register` à durée constante demanderait de différer aussi ces écritures (file de traitement) : à décider avec S24.

### P6-c — Inscriptions jamais vérifiées

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `unverified-account-purge.service.ts` (tâche `@Cron('30 3 * * *')`, enregistrée dans `AuthModule`) : supprime, par lots de 200 et par transaction, les comptes `emailVerifiedAt = null` de plus de 7 jours, avec mot de passe et **sans** autre identité (Firebase, GitHub, SSO, SCIM), avec leur espace d'onboarding possédé ; un compte membre d'un autre espace, ou dont l'espace a d'autres membres, est conservé ; toute contrainte inattendue laisse le compte intact (avertissement). Messages 409 Firebase et GitHub : « ou Mot de passe oublié si vous n'avez pas finalisé votre inscription ».
- **Tests** : `tests/unit/auth/unverified-purge.spec.ts` (4, faux Prisma) : critère de sélection, suppression de l'espace puis du compte, conservation des cas partagés, tolérance aux erreurs. **La suppression en cascade n'a pas été éprouvée contre une vraie base** (aucune base utilisée) : la première exécution en production doit être surveillée (journal d'avertissements).

### P6-d — Nom saisi dans l'e-mail de vérification

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `sendEmailVerificationEmail(to, rawToken)` : « Bonjour, » sans nom (le paramètre disparaît ; le texte libre du demandeur n'apparaît plus).

### P6 — Transaction dans `resetPassword`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : la mise à jour du mot de passe et le marquage « vérifié » sont regroupés dans un `$transaction` ; la révocation des sessions suit.
- **Tests** : `account-lifecycle.spec.ts` : `$transaction` appelé une fois. **Avant correctif : échec.** (Le faux Prisma ne rejoue pas de `ROLLBACK` : le test vérifie l'usage de la transaction, pas l'atomicité.)

### Résultats (r4 et r5)

Backend : 53 suites, 497 tests passés ; `pnpm build` OK (`DATABASE_URL` absente, `dist/` sans spec ni support de test) ; ESLint 0 erreur (1 avertissement préexistant, `tracking.gateway.spec.ts`). Frontend : 14 fichiers, 56 tests passés ; `pnpm build` OK ; ESLint 0 erreur (6 avertissements préexistants). Hors périmètre ici, comme demandé : P9 (écran « Sécurité du compte », décision produit) et l'inscription par invitation sans e-mail (reportée à S17).

## Actions de la revue r6

### A3-c — Artefacts compilés dans `backend/tests/support/`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : suppression de `session.test-support.js`, `.d.ts` et `.js.map` (artefacts compilés à côté de la source, non suivis par git) ; `.gitignore` : `backend/tests/**/*.js`, `*.d.ts`, `*.js.map` ; `moduleFileExtensions` de Jest : `["ts", "js", "json"]` (le `.ts` est désormais résolu avant un éventuel `.js`).
- **Vérification** : `find backend/src backend/tests -name "*.js" -o -name "*.d.ts"` vide ; `npx eslint src tests` : 0 erreur (17 avertissements préexistants).

### S18.2 — Blocage par décorateur au lieu de comparer le chemin

- **Statut** : `CORRIGÉ – À REVOIR` (reste en suspens : révocation de la session de l'administrateur à l'impersonation, avec S18.3 ; `FEATURE_IMPERSONATION_ENABLED` reste désactivé)
- **Cause confirmée** : le blocage comparait `request.path` à des expressions sensibles à la casse, alors que le routage Express ne l'est pas (`POST /Auth/GitHub/Link` passait).
- **Changement** : `auth/forbidden-in-impersonation.decorator.ts` (`@ForbiddenInImpersonation()`, métadonnée lue par `JwtAuthGuard` via `Reflector` sur le gestionnaire puis la classe). Les expressions de chemin sont supprimées du garde. Décorateur posé sur `github/link`, `firebase/link`, `DELETE sessions/:sid`, `mfa/setup`, `mfa/confirm`, `mfa/disable`, `mfa/recovery-codes` (`auth.controller.ts`) et sur la **classe** `AdminController`.
- **Tests** : `tests/unit/auth/impersonation-routes.spec.ts` (36) : 9 gestionnaires réels refusés en impersonation avec un chemin de requête en casse mixte, autorisés sinon, `listSessions` et `logout` utilisables ; **test méta** qui balaie les contrôleurs (`AuthController`, `AdminController`, `SsoController`) et exige le décorateur sur toute route protégée par `JwtAuthGuard` correspondant à MFA, `link`, `DELETE sessions` ou `/admin` (il vérifie aussi que le balayage trouve les 8 routes attendues). `tests/http/impersonation-case.spec.ts` (7, HTTP réel) : `/Auth/GitHub/Link`, `/AUTH/MFA/setup`, `/auth/MFA/disable`, `DELETE /Auth/Sessions/abc`, `/AUTH/FIREBASE/LINK` : 403 ; la même route hors impersonation passe le garde. **Avant correctif (garde neutralisé) : 9 échecs sur 36.**
- **Écart** : les routes publiques ou sans `JwtAuthGuard` (`/auth/mfa/challenge`, `/auth/password/*`) ne lisent pas la session : elles sont hors du décorateur et du test méta (les jetons de réinitialisation passent par e-mail).

### P6-c (complément) — Tri et curseur de la purge

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `unverified-account-purge.service.ts` : `orderBy [createdAt, id]` et curseur par clé (`createdAt`/`id` supérieurs au dernier examiné, robuste à la suppression de la dernière ligne d'un lot) ; lots de 200, au plus 50 lots par exécution. Les comptes conservés (espace partagé, erreur) ne monopolisent plus le lot.
- **Tests** : `unverified-purge.spec.ts` (5) : ordre, lot plein suivi d'un second lot avec le bon curseur (201 comptes examinés). Pas d'état « avant » mesuré.

### Runbook Phase 1, § 7 — Alerte sur les échecs SMTP

- **Statut** : `CORRIGÉ – À REVOIR` : point 7 ajouté (lignes `Échec de l'envoi de l'email à` et `Échec de l'envoi d'un e-mail de compte`, seuils proposés).

### Mention pour S10

- La création d'un compte GitHub sur un domaine `enforceSSO` (créé puis refusé en 403 par `completeLogin`) est laissée telle quelle : à conditionner au contrôle `enforceSSO` avec S10.

### Résultats (r6)

Backend : 54 suites, 518 tests passés ; `pnpm build` OK (`dist/` sans spec ni support de test) ; `npx eslint src tests` : 0 erreur. Frontend inchangé (14 fichiers, 56 tests, build OK au dernier passage). Rien contre une base réelle, aucun commit.
