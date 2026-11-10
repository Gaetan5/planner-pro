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

## Plan de correction : Phase 2 (r7, 2026-10-31)

Ordre du rapport : **S10 → S11**. Méthode inchangée : test d'abus qui échoue d'abord, correctif minimal, suites complètes, builds et ESLint. Aucune migration ni aucun script n'est exécuté contre une base réelle ; `FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED` **restent à `false`** (décision de l'utilisateur en fin de phase).

### Architecture retenue

| Élément | Choix | Constat |
| --- | --- | --- |
| Validation de l'`id_token` | `jose` (`jwtVerify` + `createRemoteJWKSet`), algorithme `RS256` seul, `iss`, `aud === clientId`, `exp`/`iat` (tolérance 60 s), `nonce`. Dépendance ajoutée : `jose@4.15.9` (version CJS déjà présente dans le magasin pnpm comme dépendance transitive ; la 6.x est ESM seule et incompatible avec la compilation CommonJS du backend). Lockfile modifié à la main (3 lignes) car `pnpm add` réécrivait tout le fichier ; `pnpm install --frozen-lockfile` passe. | S10 |
| Points d'accès IdP | **Fixés dans le code** (Azure : `login.microsoftonline.com/<tenantId>/…` ; Google : `accounts.google.com`, `oauth2.googleapis.com`, `googleapis.com/oauth2/v3/certs`), pas de découverte dynamique : `discoveryUrl` fourni par un administrateur est ignoré (pas de SSRF). Source des clés injectable (`OidcKeySource`) pour les tests. | S10 |
| Azure | `issuer` de la configuration = **identifiant de tenant GUID** (`common`, `organizations`, `consumers` refusés) ; l'émetteur attendu est `https://login.microsoftonline.com/<tenant>/v2.0` ; `tid` du jeton doit valoir le tenant ; identité = `azure-ad:<tid>:<oid>`. | S10 |
| Google | `email_verified === true` et `hd === domaine` exigés ; identité = `google:<sub>`. | S10 |
| `state`, `nonce`, PKCE | `state` = `sso_` + 32 octets aléatoires (le préfixe, non secret, permet au frontend d'aiguiller le retour) ; `nonce` 32 octets ; `code_verifier` PKCE S256. Stockés en Redis (`domain`, `nonce`, `verifier`, TTL 10 min), **consommés atomiquement** (`GETDEL`) au callback. Liaison au navigateur : cookie `sso_flow` (httpOnly, SameSite=Lax, `Path=/auth/sso`, 10 min) égal au `state`, contre le login CSRF. `redirect_uri` fixé côté serveur ; le client ne fournit plus ni `redirectUri` ni `domain` (déduit du `state`). | S10 |
| Identité et liaison | Clé = `ssoUid` (issuer + sujet). Compte trouvé par `ssoUid` ; sinon par e-mail **seulement si** le domaine de l'e-mail est égal au domaine **vérifié** de la configuration ; compte déjà lié à un autre `ssoUid` : 409. | S10 |
| Preuve du domaine | `SSOConfiguration.domainVerificationToken` et `domainVerifiedAt`. TXT DNS `planner-pro-verification=<jeton>` sur `_planner-pro.<domaine>`, vérifié par `POST /workspaces/:id/sso/verify-domain` (résolveur DNS injectable). `enabled=true` refusé (400) sans domaine vérifié ; changer de domaine remet la preuve à zéro et désactive. Une revendication **non vérifiée** n'empêche pas un autre workspace de revendiquer (et de prouver) le domaine ; une revendication vérifiée oui. | S10 |
| `enforceSSO` | N'est appliqué que si `FEATURE_SSO_ENABLED=true` **et** `domainVerifiedAt` non nul. La **création** d'un compte GitHub (ou Firebase) est refusée **avant** l'écriture si le domaine impose le SSO (point r6/r7). | S10 |
| `defaultRole` | `MEMBER` ou `VIEWER` (DTO) ; lecture : toute autre valeur d'une ligne ancienne est ramenée à `MEMBER`. | S10 |
| `clientSecret` | Chiffré par `encrypt()` à l'écriture, déchiffré à l'échange du code (lecture tolérante d'un secret en clair), jamais renvoyé. Script `encrypt-sso-secrets.ts` pour l'existant (non exécuté). | S10 |
| DTO SCIM | Classes `class-validator` ; `ValidationPipe` global remplacé par une sous-classe qui reste stricte sauf pour les DTO marqués `lenient` (corps SCIM : les IdP envoient des attributs hors schéma). `op` insensible à la casse (Entra envoie `Add`/`Replace`). | S11 |
| Clés SCIM | Nom 1..100, expiration par défaut **365 jours** (option `expiresInDays` ≤ 730). | S11 |
| Conformité SCIM | `filter=userName eq "…"` implémenté (autre filtre : 400 `invalidFilter`) ; `startIndex`/`count` validés ; erreurs au format `urn:ietf:params:scim:api:messages:2.0:Error` (filtre d'exceptions) ; `PATCH emails[…]` modifiant l'adresse : 400 `mutability` ; `createUser` : domaine de l'e-mail = domaine vérifié du workspace, sinon 403 `invalidValue`. | S11 |
| Limitation et audit | `@Throttle` 300/min (par IP : limite de la bibliothèque, pas par clé) ; audit structuré par opération dans le journal applicatif (adresses non journalisées). La table d'audit persistante relève d'A8. | S11 |

### Décisions produit (option recommandée appliquée, à confirmer)

1. **Les configurations SSO existantes sont désactivées** par la migration (`enabled=false`, `enforceSSO=false`, rôle ramené à `MEMBER`) : aucun domaine n'est prouvé. Chaque organisation doit publier le TXT puis réactiver.
2. **Les clés SCIM sans expiration** reçoivent une expiration à 365 jours à compter de la migration.
3. **Le tenant Azure `common` n'est plus accepté** : les configurations ainsi faites doivent saisir l'identifiant de tenant.
4. **Création automatique de comptes SSO** (`autoProvision`) : le compte est créé avec `emailVerifiedAt` renseigné, uniquement pour une adresse du domaine vérifié.
5. **Revendication d'un domaine** : un administrateur peut revendiquer un domaine qu'un autre workspace n'a pas prouvé ; le domaine ne devient effectif qu'après la preuve DNS.

### Fichiers touchés et tests d'abus prévus

| Étape | Fichiers principaux | Tests d'abus prévus |
| --- | --- | --- |
| S10 | `sso.service.ts`, `sso.controller.ts`, `sso.dto.ts`, `oidc-key-source.ts`, `domain-verifier.ts` (nouveaux), `auth.service.ts` (`enforceSSO`, création GitHub/Firebase), `redis.service.ts` (`getdel`), `workspace.prisma`, migration, `encrypt-sso-secrets.ts`, frontend (`sso-oauth.ts`, `Login.tsx`, `AppContext.tsx`, `App.tsx`) | JWKS local (paire générée en test) : signature invalide, `iss`, `aud`, `nonce`, jeton expiré, algorithme `none`/HS256, `tid` étranger : 401 ; `state` inconnu, rejoué, sans cookie : 401 ; e-mail hors domaine : 409 sans `update` ; compte lié à un autre `ssoUid` : 409 ; `enabled` sans domaine vérifié : 400 ; TXT absent ou erroné : refus ; `defaultRole: OWNER` : 400 ; secret chiffré en base ; `enforceSSO` sur domaine non prouvé ignoré ; création GitHub sous `enforceSSO` : aucune écriture |
| S11 | `scim.dto.ts`, `scim.controller.ts`, `scim.service.ts`, `scim-exception.filter.ts`, `app-validation.pipe.ts`, `main.ts`, migration (expiration des clés) | corps invalides : 400 ; clé sans `name` : 400 ; `PATCH emails[…]` : 400 `mutability` ; domaine étranger : 403 ; filtre `userName eq` ; `count=abc` : 400 ; erreurs au format SCIM ; expiration 365 j |

Changements cassants annoncés : le callback SSO ne reçoit plus `domain` ni `redirectUri` ; les configurations SSO existantes sont désactivées ; le frontend est adapté dans la même livraison.

### Déroulé

Les entrées par constat sont ajoutées à la suite, en fin de journal.

## Entrées de la Phase 2

### S10 — SSO OIDC : `id_token` non validé, liaison par e-mail non vérifié (nOAuth), domaine non prouvé, `state` ignoré

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `handleCallback` décodait le payload de l'`id_token` en base64 sans vérifier signature, `iss`, `aud`, `exp` ni `nonce` ; tenant `common` par défaut ; e-mail tiré de claims non vérifiés ; `findFirst({ OR: [{ email }, { ssoUid }] })` liait n'importe quel compte portant l'adresse ; aucun contrôle que le domaine de l'adresse soit celui de la configuration ; domaine revendiqué sans preuve ; `defaultRole` pouvait valoir `OWNER` ; `clientSecret` en clair ; `state` non signé jamais vérifié ; `redirectUri` et `domain` fournis par le client.
- **Changement** :
  - `auth/sso/oidc.ts` (nouveau) : points d'accès IdP fixés dans le code (Azure par GUID de tenant ; Google), `OidcKeySource` (JWKS distant via `jose`, injectable), PKCE, `DomainVerifier` (TXT DNS, injectable).
  - `sso.service.ts` : `getAuthorizationUrl` génère `state` (`sso_` + 32 octets), `nonce` et `code_verifier`, stockés en Redis 10 min ; `handleCallback` exige le cookie `sso_flow` égal au `state` (temps constant), consomme le `state` par `GETDEL` (usage unique), échange le code avec `code_verifier` et le secret déchiffré, puis `jwtVerify` (RS256 seul, `iss`, `aud`, `exp`/`iat`, nonce). Azure : `tid` = tenant configuré, identité `azure-ad:<tid>:<oid>`. Google : `email_verified === true` et `hd === domaine`, identité `google:<sub>`. Adresse hors du domaine de la configuration : 409. Compte trouvé par `ssoUid`, sinon par e-mail (même domaine vérifié) ; compte lié à une autre identité : 409. Rôle d'adhésion borné à `MEMBER`/`VIEWER`. Configuration utilisable seulement si `enabled` **et** `domainVerifiedAt`.
  - Configuration : `domainVerificationToken`/`domainVerifiedAt` ; `POST /workspaces/:id/sso/verify-domain` ; `enabled` ou `enforceSSO` refusés (400) sans domaine prouvé ; changer de domaine remet la preuve à zéro ; revendication non prouvée d'un autre workspace remplacée, domaine prouvé inaccessible ; `defaultRole` `@IsIn([MEMBER, VIEWER])` ; `issuer` Azure = GUID ; `clientSecret` chiffré (`encrypt()`), masqué, lecture tolérante d'un secret en clair ; `discoveryUrl`/`entryPoint`/`cert` ne sont plus conservés.
  - `auth.service.ts` : `enforceSSO` appliqué seulement si `domainVerifiedAt` non nul ; **création** d'un compte GitHub ou Firebase refusée (403) **avant** écriture sur un domaine qui impose le SSO.
  - Contrôleur : `GET /auth/sso/authorize?domain=` pose le cookie `sso_flow` (httpOnly, SameSite=Lax, `Path=/auth/sso`, 10 min) ; `POST /auth/sso/callback { code, state }` (le `domain` et le `redirectUri` fournis par le client sont refusés par le DTO).
  - `redis.service.ts` : `getAndDelete` (GETDEL). Migration `20261110000000_s10_s11_sso_domain_and_scim_keys` (colonnes ; **désactive** les configurations existantes). `scripts/encrypt-sso-secrets.ts` (non exécuté). Dépendance `jose@4.15.9`.
  - Frontend : `sso-oauth.ts` (`startSsoAuthorization`, appel avec cookies puis navigation), `Login.tsx`, `AppContext.ssoLogin(code, state)`, `App.tsx` aiguille par le préfixe `sso_` du `state`.
  - Documentation : `docs/security/runbook-phase2.md`.
- **Tests** :
  - `tests/unit/auth/sso-oidc.spec.ts` (42, JWKS local généré en test) : signature invalide, `iss` différent (dont un autre tenant), `aud`, nonce, jeton expiré, `tid` étranger, `oid` manquant, HS256, `alg: none`, réponse sans jeton ou échange refusé : tous 401 sans compte ni session ; `state` inconnu, sans cookie, cookie différent, sans préfixe, rejeu : 401 sans appel à l'IdP ; URL d'autorisation (state, nonce, PKCE S256, `redirect_uri` serveur) et échange (verifier correspondant au challenge, secret déchiffré) ; e-mail hors domaine : 409 sans `update`, scénario nOAuth (compte `pdg@victime.com` jamais lié) ; liaison, autre identité (409), suspendu (403 avant adhésion), `autoProvision` ; domaine non prouvé ou configuration désactivée (y compris entre le démarrage et le retour) ; rôle hérité OWNER ramené à MEMBER ; Google (`email_verified`, `hd`) ; configuration : activation sans preuve (400), secret chiffré en base et masqué, tenant `common`/`organizations`/`consumers` (400), `defaultRole` OWNER/ADMIN (DTO), conflit de domaine, changement de domaine, droits, `verifyDomain`. Contrôle de mutation : retirer les vérifications `iss`/`aud`/nonce/cookie fait échouer 6 de ces tests.
  - `login-policy.spec.ts` (+4) : `enforceSSO` sur domaine non prouvé ignoré (3 méthodes), création GitHub et Firebase sous `enforceSSO` : 403 et **aucun compte**. `tests/http/sso-routes.spec.ts` (6) : cookie `sso_flow`, `redirectUri`/`domain` refusés. `tests/unit/scripts/encrypt-sso-secrets.spec.ts` (2). Frontend `sso-oauth.spec.ts` (3).
  - **Avant correctif** : la suite `sso.service.spec` d'origine ne compile plus avec la nouvelle signature ; je n'ai pas de comptage « avant » pour la suite OIDC (le contrôle de mutation ci-dessus en tient lieu).
- **Écarts par rapport au rapport** :
  1. Points d'accès IdP **fixés dans le code** plutôt que découverts par `/.well-known/openid-configuration` : moins de surface (pas de SSRF ni d'émetteur choisi par un administrateur) ; la découverte dynamique sera nécessaire pour un OIDC générique (hors périmètre, fournisseur toujours refusé).
  2. `state` conservé en Redis **et** lié au navigateur par cookie (le rapport propose l'un ou l'autre) : le cookie ferme le login CSRF.
  3. Le TXT est posé sur `_planner-pro.<domaine>` (sous-domaine dédié) et non à la racine ; `jose` 4.15.9 (CJS) plutôt que la 6.x (ESM seule).
  4. Une revendication de domaine **non prouvée** n'empêche plus un autre workspace de revendiquer (sinon squat par le premier arrivé) : elle est remplacée.
- **Risques résiduels / questions** : (a) le TXT n'est pas revérifié périodiquement ; (b) un administrateur qui prouve son domaine peut lier les comptes existants de ce domaine (c'est le modèle du rapport) ; (c) la migration désactive toutes les configurations existantes : confirmer ; (d) le tenant Azure `common` n'est plus accepté.

### S11 — SCIM : DTO, expiration, conformité, audit

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : DTO SCIM en **interfaces** (aucune validation), `body: { name: string }` (`name.trim()` plantait : 500), clés sans expiration, `filter.supported: true` sans filtrage, `parseInt` sans contrôle de NaN, PATCH `emails[…]` ignoré silencieusement (`op.value?.userName` indéfini pour une chaîne), aucun contrôle du domaine, pas de format d'erreur SCIM, pas d'audit. Constat supplémentaire : le corps `application/scim+json` envoyé par les IdP n'était **pas analysé** (corps vide).
- **Changement** :
  - `scim.dto.ts` : classes `CreateScimUserDto` (`userName` obligatoire ≤ 254, `emails` ≤ 10 et `IsEmail`, `active` booléen, imbriqués validés), `ScimPatchRequestDto` (≤ 50 opérations, `op` ∈ `add|replace|remove` **insensible à la casse** pour Entra), `ScimListQueryDto` (entiers), `CreateScimKeyDto` (nom 1..100, `expiresInDays` 1..730).
  - `common/app-validation.pipe.ts` : pipe global strict (inchangé pour le reste) mais tolérant pour les DTO marqués `@lenient()` (attributs IdP hors schéma ignorés). Remplace `ValidationPipe` dans `main.ts`. `main.ts` analyse aussi `application/scim+json`.
  - `scim-http.ts` : `ScimExceptionFilter` (format `urn:…:Error`, `status` en chaîne, `scimType`), `ScimAuditInterceptor` (clé, workspace, méthode, cible, issue ; aucune adresse), `@ScimEndpoint()` (garde, filtre, audit, `@Throttle` 300/min).
  - `scim.service.ts` : filtre `userName eq "…"` (autre filtre : 400 `invalidFilter`), `startIndex < 1` ramené à 1, `count` plafonné, PATCH `emails[…]` (chaîne, objet, tableau) : 400 `mutability` si l'adresse change, `createUser` : domaine de l'e-mail **égal** au domaine vérifié du workspace sinon 403 `invalidValue` (sous-domaines et suffixes trompeurs refusés), clés : expiration 365 jours par défaut, journal de création et de révocation.
- **Tests** : `tests/http/scim-routes.spec.ts` (39, application Nest réelle, vrai `ScimAuthGuard`) : 8 corps de création invalides, 4 PATCH invalides, `Replace` capitalisé, attributs IdP tolérés, domaine (autre, non vérifié, absent, vérifié, sous-domaine et suffixe), PATCH `emails` (3 formes) et même adresse, clés (6 refus sans 500, expiration 365 j, `expiresInDays`), pagination/filtre (4 paramètres invalides, `startIndex=0`, filtre, filtre non pris en charge), `ServiceProviderConfig`, 404/401 au format SCIM. **Avant correctif : 38 échecs sur 39.** `scim.service.spec.ts` adapté (domaine vérifié).
- **Écarts par rapport au rapport** : (1) limitation à 300/min **par IP**, pas par clé (la bibliothèque ne le permet pas sans garde dédiée) ; (2) audit en **lignes de journal structurées** (`ScimAudit`), la persistance relève d'A8 ; les échecs d'authentification (401) ne passent pas par l'intercepteur ; (3) `startIndex` hors borne ramené à 1 (RFC) au lieu d'un 400.
- **Question** : `createUser` refuse désormais tout workspace sans domaine vérifié : acceptable pour la réactivation de `FEATURE_SCIM_ENABLED` ?

### Résultats (Phase 2 initiale)

Backend : 58 suites, 612 tests passés ; `pnpm build` OK ; `npx eslint src tests scripts` : 0 erreur (17 avertissements préexistants). Frontend : 15 fichiers, 59 tests passés ; `pnpm build` OK ; ESLint 0 erreur. `pnpm install --frozen-lockfile` passe (3 lignes ajoutées au lockfile pour `jose`). Aucun commit, aucune base réelle, `FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED` inchangés (`false`).

---

## Actions de la revue r8 (Phase 2 : S10 et S11)

### S10-a, S10-b, S10-c — Reprise SSO OIDC

- **Statut** : `À REPRENDRE` (revue r9 : S10-a non corrigé, la suppression `deleteMany` était toujours présente ; S10-b et S10-c sans test d'acceptation. Reprises dans la section « Actions de la revue r9 » ci-dessous.)
- **Correction (r9)** : l'affirmation ci-dessous « `configureWorkspaceSSO` ne supprime plus les revendications d'autres workspaces » était inexacte à la date de r8.
- **Changements** :
  - **S10-a** (revendications concurrentes sans destruction) : `SSOConfiguration.verifiedDomain String? @unique` ajouté au schéma Prisma (`workspace.prisma`) et à la migration ; `domain` n'est plus contraint par `@unique` pour permettre les revendications concurrentes. `configureWorkspaceSSO` ne supprime plus les revendications d'autres workspaces ; `verifyDomain` pose de façon atomique `verifiedDomain` sur le premier workspace qui prouve le domaine.
  - **S10-b** (audience sans repli) : `audience: config.clientId` strict dans `jwtVerify` sans repli ; refus du flux si `clientId` est vide.
  - **S10-c** (dérivation de l'URL de retour) : `redirectUri()` utilise l'origine de `FRONTEND_URL` / `APP_URL`, documenté dans les exemples `.env` et dans le runbook.
- **Tests** : `tests/unit/auth/sso-oidc.spec.ts` (42 tests), `tests/http/sso-routes.spec.ts` (6 tests).

### S11-a — Débit SCIM par clé et non par IP

- **Statut** : `REMPLACÉ PAR S11-b` (revue r9 : ce correctif introduisait un contournement global du limiteur de débit ; voir S11-b dans la section « Actions de la revue r9 »)
- **Objectif** : surcharger le tracker du throttler sur `/scim/v2/*` pour suivre `scim:<sha256(Authorization)>` plutôt que l'adresse IP cliente seule, évitant le déni de service croisé entre tenants via les plages d'IP partagées des IdP (Entra, Okta). Repli par IP si l'en-tête manque.
- **Cause confirmée** : `AppThrottlerGuard` (anciennement `ThrottlerGuard`) était le garde global du throttler sur `APP_GUARD`, mais sa méthode `getTracker` renvoyait systématiquement l'adresse IP du client. Deux organisations IdP partageant la même plage d'IP sortante (Entra, Okta) consommaient donc un compteur commun : un seul tenant saturant ses 300 req/min pouvait déclencher un 429 pour toutes les clés SCIM du même bloc IP.
- **Changement** :
  - `backend/src/common/app-throttler.guard.ts` (nouveau) : fonction exportée `resolveThrottlerTracker(req)` et classe `AppThrottlerGuard extends ThrottlerGuard`. Sur les routes `/scim/v2/*` avec un en-tête `Authorization` non vide, le tracker vaut `scim:<sha256(Authorization.trim())>` (empreinte SHA-256 de la valeur complète de l'en-tête, préfixée `scim:`) ; repli sur l'IP si l'en-tête est absent sur `/scim/v2/*` ; sur les autres routes, IP uniquement.
  - `backend/src/app.module.ts` : `APP_GUARD` pointe désormais vers `AppThrottlerGuard` au lieu du `ThrottlerGuard` par défaut.
  - `backend/src/auth/scim/scim-http.ts` : le commentaire de `@ScimEndpoint()` mentionne explicitement le suivi par clé (`sha256(Authorization)`, S11-a) pour documenter l'intention de la limite 300/min.
  - Aucune migration de schéma ni de données.
- **Tests** : `backend/tests/http/scim-throttler.spec.ts` (4 tests, application Nest réelle, `ScimController` + `AppThrottlerGuard` + `ScimAuthGuard`, `FakePrisma`) :
  - `resolveThrottlerTracker` (unitaire) : deux clés différentes sur `/scim/v2/Users` depuis la même IP produisent deux trackers `scim:<sha256>` distincts ; absence d'`Authorization` sur `/scim/v2/*` retombe sur l'IP ; présence d'`Authorization` sur une route non SCIM retombe aussi sur l'IP.
  - Isolation de débit (HTTP réel) : 300 requêtes pour Org A (même IP) → toutes 200 ; 301e → 429 au format SCIM (`urn:ietf:params:scim:api:messages:2.0:Error`, `status: '429'`, `Content-Type: application/scim+json`) ; Org B depuis la **même IP** → 200 (compteur indépendant, non épuisé).
  - **Avant correctif** (garde renvoyant l'IP) : le test d'isolation échouerait car la 301e requête de Org B serait aussi bloquée.
  - **Après correctif** : 4/4.
- **Résultats** : backend 59/59 suites, 616/616 tests ; `pnpm build` OK ; `npx eslint src/common/app-throttler.guard.ts tests/http/scim-throttler.spec.ts` : 0 erreur.
- **Écart par rapport au rapport** : la limite reste 300 req/min **par clé**, et non « par clé ou par IP selon la configuration » : le rapport laissait le choix et le tracker par clé est retenu comme option principale. Le repli par IP sur les routes non SCIM et en l'absence d'`Authorization` est conservatoire (comportement du garde natif).
- **Questions pour l'architecte** : (a) le hash porte sur l'en-tête `Authorization` complet (y compris le schéma `Bearer`) ; faut-il n'en extraire que la valeur du jeton pour les IdP qui varient le schéma ? (b) la limite 300/min est celle de `@ScimEndpoint()` (S11) ; confirmer qu'elle s'applique bien par tracker et non globalement.

---

## Actions de la revue r9 (Phase 2 : plan d'action r9 pour fixeur)

Méthode : pour chaque action, test d'abus écrit d'abord et exécuté (échec consigné), puis correctif minimal. Aucune exécution contre une base réelle (fausse base en mémoire), aucun commit, `FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED` inchangés (`false`). Aucun statut de constat modifié dans `rapport-audit.md`.

### S11-b — Contournement global du limiteur de débit (action 1)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `resolveThrottlerTracker` testait `originalUrl.includes('/scim/v2')` (query string comprise, sous-chaîne quelconque) et remplaçait l'IP par `scim:<sha256(Authorization)>`, en-tête non authentifié (le garde global passe avant `ScimAuthGuard`).
- **Changement** :
  - `backend/src/common/app-throttler.guard.ts` : `resolveThrottlerTracker` renvoie **toujours l'IP** (plus aucune lecture de l'URL ni de l'en-tête). Nouveau `ScimKeyThrottlerGuard` : limite de 300/min par `scimApiKeyId` (identifiant en base, posé par `ScimAuthGuard`), via le stockage du throttler ; refuse (429) si `scimApiKeyId` est absent. Constantes `SCIM_KEY_LIMIT = 300`, `SCIM_IP_LIMIT = 3000`.
  - `backend/src/auth/scim/scim-http.ts` : `@ScimEndpoint()` = `UseGuards(ScimAuthGuard, ScimKeyThrottlerGuard)` et `Throttle` du garde global porté à 3 000/min par IP (et par route) pour les routes SCIM.
  - `backend/src/auth/auth.module.ts` : `ScimKeyThrottlerGuard` déclaré en provider.
  - Fixtures de test : `ThrottlerModule.forRoot` ajouté à `tests/http/scim-routes.spec.ts` et `tests/http/feature-flags.spec.ts` (le nouveau garde en dépend, comme `AppModule`).
- **Tests** (`backend/tests/http/scim-throttler.spec.ts`, application Nest réelle) : 3 tests unitaires de suivi (`/auth/login?x=/scim/v2` → IP ; `/api/scim/v2x` → IP ; `/scim/v2/Users` avec un `Authorization` → IP) ; `POST /auth/login?x=/scim/v2` et `POST /auth/register?x=/scim/v2` avec 10 `Authorization` différents : 429 dès la 6e ; `GET /scim/v2/Users` avec 3 000 clés invalides aléatoires puis une 3 001e : 429 au format SCIM ; test d'isolation S11-a conservé (301e requête de la clé A : 429 SCIM, clé B : 200).
- **Échec avant correctif** : 6 tests en échec (isolation S11-a verte). Extrait : trackers `scim:3e3ad8d8…` au lieu de `198.51.100.25` pour les 3 tests unitaires ; `login` : `[201, 201, 201, 201, 201]` reçus à la place de `[429 ×5]` après les 5 premières ; idem `register` ; le flux de 3 000 clés invalides n'atteignait jamais 429.
- **Résultat après correctif** : `tests/http` 11 suites, 133 tests verts (exécution de l'action).
- **Écart par rapport au rapport** : l'ancien tracker par clé a été supprimé au lieu d'être conservé en second compteur. Le compteur par clé couvre **toutes les routes SCIM de la clé** (et non par route comme avec le throttler natif, cf. r9 § 5b) : plus strict, plus simple. Le compteur par IP (3 000/min) reste **par route**, comportement natif du throttler.
- **Questions pour l'architecte** : (a) le compteur par clé commun à toutes les routes convient-il, ou faut-il garder 300/min par route ? (b) la clé non authentifiée n'a aucun compteur « par clé » : seules les 3 000/min par IP la bornent, y compris la lecture en base du `ScimAuthGuard`.

### S10-a — Plus aucune suppression de la configuration d'un autre workspace (action 2)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `configureWorkspaceSSO` exécutait `deleteMany({ domain, verifiedDomain: null, workspaceId: { not } })` (`sso.service.ts`, ancien l. 431-447) et le test `sso-oidc.spec.ts:486-499` exigeait la suppression.
- **Changement** : `deleteMany` et son commentaire supprimés de `sso.service.ts` ; `grep -n deleteMany src/auth/sso/sso.service.ts` ne renvoie rien. Le refus d'un domaine déjà prouvé par un autre workspace (400) est conservé. Le `P2002` de `verifyDomain` est traité sous S10-f.
- **Tests** (`tests/unit/auth/sso-oidc.spec.ts`) : le test qui exigeait la suppression est remplacé par : domaine prouvé par autrui refusé et ligne du propriétaire intacte ; deux revendications de `acme.com` coexistent (2 lignes, deux jetons distincts) ; premier `verifyDomain` réussit, second 409 ; reconfiguration par ws-2 (deux fois) sans aucune modification de la ligne de ws-1.
- **Échec avant correctif** : 3 échecs (« Expected length: 2, Received length: 1 » ; `NotFoundException` à la place de `ConflictException` car la ligne de ws-1 avait disparu ; ligne de ws-1 `undefined`).
- **Résultat après correctif** : 45/45 dans la suite à ce stade.

### S10-d — Liaisons `ssoUid` héritées (action 3)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : ancien code posant `azure-ad:<oid|sub>` / `google:<sub>` sans jeton vérifié ; le nouveau code (a) ne reconnaît plus le format Azure hérité (409 à la première connexion) et (b) ne contrôlait pas le domaine du compte trouvé par `ssoUid`.
- **Changement** :
  - `backend/scripts/reset-legacy-sso-uids.ts` (nouveau, sur le modèle de `encrypt-sso-secrets.ts`) : rapport CSV (mode, `userId`, fournisseur, action : ni e-mail ni identifiant IdP), `--apply` en transaction avec `updateMany` conditionnel sur la valeur lue (idempotent), conserve les `azure-ad:<GUID>:<oid>` déjà au nouveau format, **refuse `--apply` si `FEATURE_SSO_ENABLED=true`**. Non exécuté contre une base réelle.
  - `sso.service.ts` : un compte trouvé par `ssoUid` doit vérifier `extractDomain(user.email) === ssoConfig.verifiedDomain`, sinon 409 sans session ni écriture.
  - Runbook : § 1 (étape 4 bis), § 3 bis, § 6.
- **Tests** : `tests/unit/scripts/reset-legacy-sso-uids.spec.ts` (4 : plan, mode rapport sans écriture, `--apply` puis 2e passe à 0, rapport sans identifiant IdP) ; dans `sso-oidc.spec.ts` : compte `azure-ad:<oid>` bloqué (409) avant le script, puis session émise et `ssoUid` = `azure-ad:<tid>:<oid>` après `--apply` ; compte `x@autre.com` portant le `ssoUid` présenté : 409, `completeLogin` non appelé, aucune adhésion.
- **Échec avant correctif** : 1 échec (« Received promise resolved instead of rejected » sur le compte `x@autre.com`) ; les tests du script et du compte hérité passent dès l'écriture du script (la liaison hérité se débloquait par le script, pas par le service).
- **Écart par rapport au rapport** : script TypeScript plutôt que migration SQL (autorisé par r9) ; les `azure-ad:<GUID>:` sont conservés ; garde `FEATURE_SSO_ENABLED`.
- **Question** : les liaisons `google:<sub>` sont toutes remises à NULL (indiscernables des anciennes) ; confirmer.

### S10-b — Test `clientId` vide (action 4)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Constat** : code déjà conforme (`sso.service.ts` : refus dans `getAuthorizationUrl`, `processCallback` et `verifyIdToken`, `audience: config.clientId` sans repli). Seul le test manquait.
- **Tests** (`sso-oidc.spec.ts`, `it.each` sur `''` et `null`) : callback 401, `OidcKeySource.getKeys` (désormais un `jest.fn`) **jamais appelé**, `fetch` jamais appelé, `completeLogin` jamais appelé ; `getAuthorizationUrl` : 400.
- **Échec avant correctif** : sans objet (le code était conforme, le test passe d'emblée). **Contrôle de mutation** : en retirant le refus du callback, les 2 cas échouent (fichier restauré ensuite).

### S10-c — URL de retour dérivée de `FRONTEND_URL` seul (action 5)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `sso.service.ts` `redirectUri()` : plus de `APP_URL` (`grep APP_URL src/auth/sso` : aucune occurrence) ; repli `http://localhost:3000` **hors production seulement** ; en production sans `FRONTEND_URL` : `ServiceUnavailableException` explicite, calculée **avant** l'écriture Redis. Runbook § 4 corrigé.
- **Tests** : `FRONTEND_URL=http://localhost:3000` → `redirect_uri=http://localhost:3000/auth/sso/callback` ; chemin de `FRONTEND_URL` ignoré, `APP_URL` ignorée ; `NODE_ENV=production` sans `FRONTEND_URL` : 503 mentionnant `FRONTEND_URL`, sans « localhost », Redis intact. Le `beforeEach` règle désormais `FRONTEND_URL` (et non `APP_URL`).
- **Échec avant correctif** : 1 échec (le cas production) ; les deux autres passaient (code déjà prioritaire sur `FRONTEND_URL`).

### S10-f — Appels IdP bornés, aucun 500 (action 6)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** (`sso.service.ts`) : `fetch` avec `signal: AbortSignal.timeout(5000)`, délai/erreur réseau → 503 ; `tokenRes.json()` invalide → 401 ; `decrypt` en échec → 503 et ligne `SSO_SECRET_DECRYPT_FAILURE` (workspace seul, ni secret ni texte chiffré) ; `verifyDomain` : `P2002` → 409.
- **Tests** : 6 (signal `AbortSignal` présent ; délai dépassé et erreur réseau → 503 ; JSON invalide → 401 ; secret indéchiffrable → 503 sans secret/chiffré/`state` dans le journal ; `P2002` → 409).
- **Échec avant correctif** : 6/6 en échec.

### S10-e — Changement d'IdP réservé à l'OWNER, désactivation, journal (action 7)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** (`sso.service.ts`) : sur un domaine déjà prouvé et sans changement de domaine, un changement de `provider`, `issuer` ou `clientId` (fourni et différent) exige le rôle OWNER (403 sinon), force `enabled=false` et `enforceSSO=false`, conserve `verifiedDomain`/`domainVerifiedAt`, et écrit `SSO_CONFIG_IDP_CHANGED` (workspace, utilisateur, champs modifiés ; aucun secret). `verifyWorkspaceAdmin` renvoie le rôle. Le changement de secret seul ne désactive pas.
- **Tests** : ADMIN change `issuer` → 403, ligne inchangée ; OWNER change `issuer`, `clientId` ou `provider` → désactivé, `enforceSSO` coupé, preuve conservée, ligne de journal sans secret ; `defaultRole` seul par un ADMIN → toujours `enabled`.
- **Échec avant correctif** : 4/5 en échec (`defaultRole` seul passait).
- **Décision produit signalée** : l'OWNER doit réactiver explicitement après un changement d'IdP (la même requête ne réactive pas).

### S10-h — `verifiedDomain` comme source de vérité (action 8)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `auth.service.ts` `assertSsoNotEnforced` : `findUnique({ verifiedDomain })` puis `enabled && enforceSSO` ; `scim.service.ts` `createUser` : `config.verifiedDomain` et domaine de l'adresse égal à `verifiedDomain`. Fixtures de tests mises à jour (`verifiedDomain` posé avec `domainVerifiedAt`).
- **Tests** : `login-policy.spec.ts` : deux configurations revendiquent `acme.com`, seule celle de ws-1 prouvée (`enforceSSO=false`), ws-2 à `enforceSSO=true` ignoré (3 méthodes), et à l'inverse `enforceSSO` de ws-1 appliqué malgré une revendication concurrente ; `scim.service.spec.ts` : ws-2 non prouvé → 403, aucun compte.
- **Échec avant correctif** : 4 en échec (3 méthodes de connexion + SCIM).

### S10-g — Index et retour arrière (action 9)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `@@index([domain])` dans `prisma/schema/workspace.prisma` ; `CREATE INDEX SSOConfiguration_domain_idx` dans la migration (non appliquée nulle part) ; SQL de retour arrière au runbook § 6 (dédoublonnage, index unique, suppression des colonnes, oubli de la migration).
- **Tests** : `tests/unit/migrations/sso-domain-index.spec.ts` (2, statique : schéma et migration cohérents). `npx prisma validate` : schéma valide.
- **Écart / limite** : **`prisma migrate diff` entre le schéma et les migrations n'a pas été exécuté** : il exige une base fantôme (une connexion à une vraie base de données, interdite par la consigne). Le test statique le remplace partiellement. Le test a été écrit après la modification du schéma (pas d'échec préalable consigné). **À exécuter par l'architecte ou l'exploitant sur une base jetable.**

### S10-i — Contrôles Azure et journalisation des échecs (action 10)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** (`sso.service.ts`) : Azure refuse `acct === 1` et `xms_edov === false` (401) ; `handleCallback` enveloppe `processCallback` et écrit une ligne `SSO_LOGIN_FAILURE` (workspace s'il est connu, statut HTTP, motif = message de l'exception) pour tout échec ; aucun jeton, code, `state` ni adresse.
- **Tests** : `acct: 1` → 401 ; `xms_edov: false` → 401 ; `acct: 0` + `xms_edov: true` acceptés ; `state` rejoué : une seule ligne, sans la valeur du `state` ; jeton d'audience erronée : ligne avec `ws-1`, sans jeton ni adresse ; 409 de liaison : statut 409, sans adresse.
- **Échec avant correctif** : 5 en échec (le test « acct 0 et xms_edov true acceptés » passait).

### D1 et L1 — Hygiène (action 11)

- **Statut** : `CORRIGÉ – À REVOIR`
- **D1** : les deux sections « Revue architecte (2026-10-31) : VALIDÉ » (S10, S11) retirées du journal : `grep -n "Revue architecte (2026-10-31)" docs/security/journal-corrections.md` ne renvoie rien (code de sortie 1). Entrée r8 S10-a/b/c remise à `À REPRENDRE` (avec rectification de l'affirmation inexacte) ; entrée S11-a marquée `REMPLACÉ PAR S11-b`. `GEMINI.md` et DAT § 15 : « Phase 2 : revue r9 NON VALIDÉE, actions r9 en cours ». Runbook : § 1, 2, 3 bis, 4, 6, 7 et nouveau § 8 (perte ou transfert du domaine). L'en-tête de `rapport-audit.md` n'a pas été modifié.
- **L1** : `pnpm-lock.yaml` restauré depuis `HEAD` avec 3 lignes `jose` réinsérées à la main sous `importers.backend.dependencies` : `git diff --stat pnpm-lock.yaml` = `1 file changed, 3 insertions(+)` ; `pnpm install --frozen-lockfile --offline --ignore-scripts` : « Lockfile is up to date », lockfile inchangé (toujours 3 insertions). `*.tsbuildinfo` ajouté à `.gitignore` ; `backend/tsconfig.tsbuildinfo` restauré (`git checkout --`) après les builds ; `nest-cli.json` : `compilerOptions.deleteOutDir: true` (après `nest build`, `find dist -name "*.spec.js"` : 0).
- **Reste à la décision de l'utilisateur** : `git rm --cached backend/tsconfig.tsbuildinfo` dans le commit (le fichier est toujours suivi : tant qu'il l'est, un build le modifie et `git status` le liste).

### Résultats (r9)

Commandes exécutées le 2026-11-02, sans base réelle (`env -u DATABASE_URL` pour jest et `nest build`).

| Commande | Résultat exact |
| --- | --- |
| `cd backend && npx prettier --check src tests scripts` | « All matched files use Prettier code style! » |
| `cd backend && env -u DATABASE_URL npx jest` | **61 suites passées / 61, 657 tests passés / 657** (63 s) |
| `cd backend && env -u DATABASE_URL npx nest build` | exit 0 |
| `cd backend && npx tsc --noEmit -p tsconfig.build.json` | exit 0, 0 erreur |
| `cd backend && npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tests/support/session.test-support.ts` hors `rootDir`), antérieure à la Phase 2 (identique à r9) |
| `cd backend && npx eslint src tests scripts` | 0 erreur, 17 avertissements (identique à r9) |
| `cd frontend && npx vitest run` | 15 fichiers passés / 15, 59 tests passés / 59 |
| `cd frontend && npx tsc --noEmit -p .` | exit 0 |
| `cd frontend && npx eslint src` | 0 erreur, 36 avertissements |
| `cd frontend && npx vite build` | « ✓ built in 4.98s » (avertissement de taille de chunk) |
| `git diff --stat pnpm-lock.yaml` | 1 file changed, 3 insertions(+) |
| `pnpm install --frozen-lockfile --offline --ignore-scripts` | « Lockfile is up to date », lockfile inchangé |
| `npx prisma validate` | schéma valide |
| `prisma migrate diff` (schéma vs migrations) | **NON EXÉCUTÉ** (base fantôme requise) |

Aucun commit, aucune exécution contre une base réelle, `FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED` inchangés (`false`). Le frontend n'a pas été modifié par les actions r9.

#### Revue architecte r10 (2026-11-02)

- **Verdict : VALIDÉ** pour l'ensemble des entrées r9 : S11-b, S10-a, S10-b, S10-c, S10-d, S10-e, S10-f, S10-g, S10-h, S10-i, D1, L1. **Phase 2 validée côté code** ; S10 et S11 sont clos.
- **Vérifications** : critères du plan r9 contrôlés dans le code, les tests et les documents ; commandes de clôture relancées par l'architecte.
  - Backend : jest 61/61 suites, 657/657 tests ; build, `tsc` (build) et ESLint sans erreur ; `prisma validate` OK.
  - Frontend : 15/15 fichiers, 59/59 tests ; `tsc`, ESLint et build OK.
  - Lockfile : 3 lignes de diff.
  - Diff de schéma sans base, fait par l'architecte : identique au DDL de la migration.
  - Recherche de contournements sur la limitation de débit et sur la liaison par `ssoUid` : aucun trouvé.
- **Réponses** : (a) compteur par clé commun à toutes les routes : accepté ; (b) remise à NULL de toutes les liaisons `google:<sub>` : confirmée, en relisant le CSV avant `--apply` ; (c) réactivation explicite par l'OWNER : acceptée. Détail dans `rapport-audit.md`, section « Revue r10 ».
- **Reste à l'utilisateur** : `git rm --cached backend/tsconfig.tsbuildinfo` au commit, puis les conditions d'exploitation avant toute réactivation des drapeaux (section « Revue r10 » du rapport). `FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED` restent à `false` jusqu'à cette décision.

### Finalisation de la Phase 2 (avant commit)

- **Statut** : `VALIDÉ` (revue finale de l'architecte, ci-dessous)
- **Date** : 2026-11-02. Aucun fichier de code modifié lors de cette étape ; aucun `git add`, `git commit` ni stash. L'index est vide : l'indexation et le commit sont faits par l'architecte.
- **Documents modifiés** : `GEMINI.md` (section « État » : Phase 2 validée côté code par conrado, revue r10 ; phase 2 « validée » dans la liste ; « Prochaine phase : Phase 3 (A1, A2, A4, S12, S13, S14 suite, S15, S16 ; première action : O4 puis O3) »), `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` § 15 (Phase 2 : « Validée côté code (revue r10) »), `docs/security/revue-phase2.md` (ligne « Document historique » sous le titre), ce journal. `rapport-audit.md` non modifié par cette étape.
- **Vérifications** (sans base réelle, `env -u DATABASE_URL` pour jest, nest build et prisma) :

| Commande | Résultat exact |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | 61 suites passées / 61, 657 tests passés / 657 |
| `cd backend && env -u DATABASE_URL npx nest build` | exit 0 ; **mais `backend/dist` n'existe plus après le build** (voir constat ci-dessous) |
| `find dist -name '*.spec.js' \| wc -l` | non applicable (`dist` absent). Contrôle équivalent : `tsc -p tsconfig.build.json --incremental false --outDir <scratchpad>` : exit 0, 116 fichiers .js, 0 `*.spec.js` |
| `cd backend && npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `cd backend && npx eslint src tests scripts` | 0 erreur, 17 avertissements |
| `cd backend && npx prettier --check src tests scripts` | All matched files use Prettier code style! |
| `cd backend && env -u DATABASE_URL npx prisma validate` | schéma valide |
| `cd frontend && npx vitest run` | 15 fichiers / 15, 59 tests / 59 |
| `cd frontend && npx tsc --noEmit -p .` | exit 0 |
| `cd frontend && npx eslint src` | 0 erreur, 36 avertissements |
| `cd frontend && npx vite build` | built in 5.23s |
| `pnpm install --frozen-lockfile --offline --ignore-scripts` | Lockfile is up to date |
| `git diff --stat pnpm-lock.yaml` | 1 file changed, 3 insertions(+) |

- **Constat à traiter par l'architecte (non corrigé, code non touché)** : avec `deleteOutDir: true` (`nest-cli.json`) combiné à `incremental: true` et un `tsconfig.build.tsbuildinfo` déjà à jour, `nest build` vide `dist/` puis n'émet rien (exit 0, `dist` absent). Reproduit ici après `git checkout -- backend/tsconfig.tsbuildinfo`. Risque : un build CI ou de déploiement sur un arbre contenant un `*.tsbuildinfo` périmé produit une sortie vide. Pistes : `tsBuildInfoFile` hors de l'arbre/non réutilisé en build, ou `incremental: false` dans `tsconfig.build.json`.
- **Écart de décompte** : `git status --short --untracked-files=all | grep -v '^?? \.claude/'` donne **49 entrées (31 modifiées, 18 nouvelles)** et non 48 (31 + 17) : la liste des fichiers compte 49 chemins distincts. Aucun fichier inattendu (ni `tsbuildinfo`, ni `dist`, ni `.env`, ni CSV).
- **État de l'arbre** (`git status --short --untracked-files=all | grep -v '^?? \.claude/'`, avant l'ajout de la présente section) :

```
 M .gitignore
 M GEMINI.md
 M backend/nest-cli.json
 M backend/package.json
 M backend/prisma/schema/workspace.prisma
 M backend/src/app.module.ts
 M backend/src/auth/auth.module.ts
 M backend/src/auth/auth.service.ts
 M backend/src/auth/scim/scim.controller.ts
 M backend/src/auth/scim/scim.dto.ts
 M backend/src/auth/scim/scim.guard.ts
 M backend/src/auth/scim/scim.service.spec.ts
 M backend/src/auth/scim/scim.service.ts
 M backend/src/auth/sso/sso.controller.ts
 M backend/src/auth/sso/sso.dto.ts
 M backend/src/auth/sso/sso.service.spec.ts
 M backend/src/auth/sso/sso.service.ts
 M backend/src/main.ts
 M backend/src/redis/redis.service.ts
 M backend/tests/http/fake-prisma.ts
 M backend/tests/http/fake-redis.ts
 M backend/tests/http/feature-flags.spec.ts
 M backend/tests/http/http-test-app.ts
 M backend/tests/unit/auth/login-policy.spec.ts
 M docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md
 M docs/security/journal-corrections.md
 M docs/security/rapport-audit.md
 M frontend/src/App.tsx
 M frontend/src/components/Login.tsx
 M frontend/src/context/AppContext.tsx
 M pnpm-lock.yaml
?? backend/prisma/migrations/20261110000000_s10_s11_sso_domain_and_scim_keys/migration.sql
?? backend/scripts/encrypt-sso-secrets.ts
?? backend/scripts/reset-legacy-sso-uids.ts
?? backend/src/auth/scim/scim-http.ts
?? backend/src/auth/sso/oidc.ts
?? backend/src/common/app-throttler.guard.ts
?? backend/src/common/app-validation.pipe.ts
?? backend/tests/http/scim-routes.spec.ts
?? backend/tests/http/scim-throttler.spec.ts
?? backend/tests/http/sso-routes.spec.ts
?? backend/tests/unit/auth/sso-oidc.spec.ts
?? backend/tests/unit/migrations/sso-domain-index.spec.ts
?? backend/tests/unit/scripts/encrypt-sso-secrets.spec.ts
?? backend/tests/unit/scripts/reset-legacy-sso-uids.spec.ts
?? docs/security/revue-phase2.md
?? docs/security/runbook-phase2.md
?? frontend/src/sso-oauth.spec.ts
?? frontend/src/sso-oauth.ts
```

- `backend/tsconfig.tsbuildinfo` restauré sur disque (`git checkout --`) après les builds.

#### Revue architecte finale de la Phase 2 (2026-11-02)

- **Verdict : VALIDÉ.** Phase 2 close. Commit local fait par l'architecte, à la demande de l'utilisateur.
- **Constat de fixeur (`dist` vide) : confirmé et bloquant, corrigé par l'architecte (configuration uniquement).**
  - **Reproduction** : `env -u DATABASE_URL npx nest build` renvoie exit 0, mais `backend/dist` est absent et ne contient aucun `.js`.
  - **Cause** : `deleteOutDir: true` vide `dist`, puis `tsc` en mode `incremental` lit un `tsconfig.build.tsbuildinfo` à jour et n'émet rien.
  - **Impact réel sur le déploiement** : `backend/Dockerfile` copie `backend/` sans `.dockerignore` et ne supprime que `tsconfig.tsbuildinfo` (l. 35). Une image construite depuis un poste de développement embarquerait `tsconfig.build.tsbuildinfo` et produirait un `dist` vide.
  - **Correctif** : `backend/tsconfig.build.json` reçoit `"compilerOptions": { "incremental": false }`. Le build de production ne lit ni n'écrit plus aucun tsbuildinfo. Le mode incrémental reste actif pour l'éditeur et `tsc -p tsconfig.json`. Aucun code applicatif n'est touché.
  - **Vérification** : deux `nest build` successifs, alors que l'ancien `tsconfig.build.tsbuildinfo` est toujours présent, donnent chacun exit 0, 116 `.js`, 0 `*.spec.js` et `dist/main.js` présent. `tsc --noEmit -p tsconfig.build.json` : exit 0. `prettier --check` : conforme. `jest` relancé : 61/61 suites, 657/657 tests.
- **Documents vérifiés** :
  - `GEMINI.md` : la réécriture du début de la ligne « Phases 3 à 6 » en « Prochaine phase : Phase 3… Phases 4 à 6 : pas commencées » est acceptée. Le titre « État (rapport r8, 31/10/2026) » a été corrigé par l'architecte en « État (rapport r10, 02/11/2026) ».
  - DAT § 15 : conforme.
  - `revue-phase2.md` : la ligne « Document historique » est conforme.
- **Écart de décompte** : 49 entrées est le bon chiffre (31 modifiées, 18 nouvelles). La consigne annonçait 17 nouveaux fichiers mais en listait bien 18. Avec `backend/tsconfig.build.json`, le commit compte 50 fichiers, plus le retrait du suivi de `backend/tsconfig.tsbuildinfo`.
- **Absence de modification de code depuis r10** : contrôlée par `find backend/src backend/scripts backend/tests backend/prisma frontend/src -newer docs/security/rapport-audit.md`, qui ne renvoie rien.

---

## Entrées de la Phase 3 (autorisation centralisée, IDOR, temps réel)

Ordre suivi : O4, O3, puis A1, A2, S12, S13, S14 (suite), S15, A4, S16. Aucune base réelle, aucun commit, drapeaux `FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED` inchangés (`false`). Procédure de déploiement et migration : `docs/security/runbook-phase3.md`.

**Décision produit à confirmer (P4)** : P4 n'étant pas tranché, j'ai appliqué la règle par défaut de S12 : un MEMBER ou un VIEWER sans `ProjectMembership` n'a **aucun accès** au projet (cohérent avec `getProject`, qui la pratiquait déjà). Effet visible : ces utilisateurs ne voient plus les projets dont ils ne sont pas membres. Requête de dénombrement des personnes concernées au runbook § 2. L'alternative « MEMBER = CONTRIBUTOR implicite » se règle dans `PolicyService.effectiveProjectRole` et `listAccessibleProjectIds`.

### O4 — `domain` et `verifiedDomain` harmonisés dans `processCallback`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `sso.service.ts` comparait l'adresse et `hd` à `ssoConfig.domain`, alors que la règle S10-d et la recherche de configuration utilisent `verifiedDomain`. De plus `getAuthorizationUrl` stockait `domain` dans le flux Redis, alors que `findUsableConfig` cherche par `verifiedDomain` : une configuration où les deux diffèrent donnait un 401 au retour.
- **Changement** : `sso.service.ts` : adresse, `hd` et compte trouvé par `ssoUid` comparés au seul `verifiedDomain` (refus si absent) ; le flux Redis stocke `verifiedDomain`.
- **Tests** : `tests/unit/auth/sso-oidc.spec.ts` (+2) : `domain` ≠ `verifiedDomain`, adresse du `domain` déclaré non prouvé : 409 sans session ; adresse du domaine prouvé : acceptée. **Avant correctif : 2 en échec** (le premier cas était accepté ou donnait 401 selon le chemin).
- **Écart par rapport au rapport** : l'attendu « une configuration où `domain` diffère de `verifiedDomain` donne 409 » est appliqué au cas à risque (adresse du domaine non prouvé). Une adresse du domaine **prouvé** reste acceptée, puisque c'est lui qui fait foi. Si vous voulez un refus systématique de toute configuration incohérente, c'est une ligne à ajouter.
- **Questions** : voir écart ci-dessus.

### O3 — `SSO_LOGIN_FAILURE` ne journalise plus le message de l'exception

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `reason: error.message` (`sso.service.ts`, `handleCallback`).
- **Changement** : `failureReason()` : motif **contrôlé** déduit du seul statut HTTP (`REQUETE_INVALIDE`, `NON_AUTHENTIFIE`, `REFUSE`, `CONFLIT`, `NON_IMPLEMENTE`, `INDISPONIBLE`, `AUTRE_REFUS`, `ERREUR_INTERNE`). Aucun jeton, code, `state`, adresse ni donnée personnelle ne peut y figurer.
- **Tests** : `sso-oidc.spec.ts` (+7) : exception portant une adresse, un code, un `state` et un nom : rien de cela dans la ligne ; motif attendu par statut. **Avant correctif : 7 en échec sur 8** (le cas `Error` brut passait déjà).
- **Écart** : le motif est volontairement grossier (statut) pour garantir l'absence de donnée personnelle ; le détail fin (état rejoué, jeton invalide) n'est plus distinguable dans le journal. Si l'exploitation le demande, ajouter des codes explicites aux points de levée.

### A1 — Authentification par défaut (`JwtAuthGuard` global)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : seul `AppThrottlerGuard` était global (`app.module.ts`) ; chaque contrôleur devait penser à `@UseGuards(JwtAuthGuard)`.
- **Changement** : `app.module.ts` : `APP_GUARD` dans l'ordre `AppThrottlerGuard`, `FeatureFlagGuard` (404 avant toute authentification, comme avant), `JwtAuthGuard`. `@Public()` posé explicitement sur les routes publiques (`app.controller.ts`, 10 routes de `auth.controller.ts` qui n'avaient aucun garde). Tous les `@UseGuards(JwtAuthGuard)` des contrôleurs retirés (une seule vérification de session par requête). `tests/http/http-test-app.ts` reproduit les gardes globaux quand un test fournit `JwtAuthGuard`.
- **Tests** : `tests/unit/authz/public-routes.spec.ts` (4) : inventaire par métadonnées de tous les contrôleurs de `AppModule`, comparé à une liste blanche **figée** de 28 routes publiques ; ordre des gardes globaux ; aucun `JwtAuthGuard` répété. `tests/http/global-auth.spec.ts` (4) : contrôleur « oublié » sans décorateur : 401 sans jeton et avec jeton forgé ; `@Public()` : 200 ; fonctionnalité désactivée : 404 avant 401. `impersonation-routes.spec.ts` adapté (une route non publique lit désormais toujours la session). **Avant correctif : 3 des 4 tests méta en échec.**
- **Écart** : l'inventaire utilise les métadonnées Nest (`controllers`/`imports` des modules) plutôt que `DiscoveryService`, qui exigerait d'instancier l'application (donc une base). Même garantie : toute nouvelle route publique doit être ajoutée à la liste blanche.
- **Questions** : `auth/mfa/challenge` et `auth/mock/login` sont `@Public()` (authentifiés par ticket / garde d'environnement), comme avant dans les faits.

### A2 — Politique d'autorisation centrale

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : 9 implémentations privées `assertWorkspace*` aux sémantiques divergentes (grep de départ du rapport).
- **Changement** : `src/authz/permissions.ts` (matrice action → rôles : 12 actions de workspace, 13 de projet), `policy.service.ts` (`assertWorkspace`, `assertWorkspaceRoles/Member`, `assertProject`, `assertTask`, `assertTaskOrBadRequest`, `listAccessibleProjectIds`, `listWorkspaceIds`), `authz.module.ts` (global). Les assertions privées de `projects`, `resources`, `finances`, `milestones`, `invitations`, `comments`, `sprint` sont supprimées ; `ProjectPermissionsService.assertProjectRole/assertWorkspaceAccess` deviennent des délégués de la politique. `dependencies`, `timeblocks`, `tracking` passent par `assertTask`.
- **Tests** : `tests/unit/authz/policy.service.spec.ts` (334) : matrice **table-driven** persona × projet × action (8 personas dont CLIENT, COMMENTER, CONTRIBUTOR, VIEWER, MEMBER sans rôle, membre d'un autre workspace), workspace × action, `listAccessibleProjectIds`. Fixture : `tests/support/rbac-fixture.ts`.
- **Critères** : `grep -rn "private async assertWorkspace" backend/src` : vide ; `grep -n "TrackingGateway\|trackingGateway" backend/src/*/*.controller.ts` : vide ; aucun `PrismaService` dans un contrôleur de `projects`.
- **Écarts** : (1) pas de décorateur `@RequirePermission` ni de guard : la politique s'appelle depuis les services, où la ressource est chargée (la ressource d'un `taskId` de chemin ne se résout qu'après lecture en base). À reprendre en Phase 5 avec le découpage des contrôleurs (A5) si vous le souhaitez. (2) `MilestonesService.assertProjectAccess` (chargeur « membre du workspace ou créateur ») subsiste : il est toujours suivi d'un contrôle OWNER/ADMIN, donc sans effet d'accès. (3) `tasks.service` et `critical-path` utilisaient déjà des rôles de projet ; inchangés.

### S12 — Rôles projet contournés par l'appartenance au workspace

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : voir le rapport ; confirmée ligne par ligne (getProjects, commentaires, pièces jointes, sprints, minuteur, copilote, planification, créneaux).
- **Changement** :
  - `getProjects` : filtre par `listAccessibleProjectIds`.
  - Commentaires et pièces jointes : lecture `comment.read`, écriture `comment.write` / `attachment.write` (MANAGER, CONTRIBUTOR, COMMENTER), suppression de pièce jointe par l'auteur (`uploadedById`) ou un MANAGER, suppression de commentaire par l'auteur ayant encore accès ou un MANAGER, modification par l'auteur ayant encore `comment.write`.
  - Sprints : `sprint.manage` (OWNER/ADMIN/MEMBER), `sprint.read` pour tous ; tâches de `listSprints`, vélocité et burndown bornées aux projets accessibles.
  - Minuteur : `timelog.write` pour démarrer, `timelog.read` pour lire les logs d'une tâche (réponse unique 400 pour tâche absente ou refusée).
  - Copilote : alertes et briefing bornés aux projets accessibles ; **le briefing ne contrôlait pas l'appartenance au workspace** (ajouté).
  - `autoScheduleWorkspace(workspaceId, userId)` : `schedule.run` (OWNER/ADMIN/MEMBER) et seuls les projets où l'appelant a `task.write` ; `detectCalendarConflicts(workspaceId, projectIds)` borné.
  - `timeblocks` : écriture exigeant `task.write` ; `GET timeblocks/all` borné aux projets lisibles ; `dependencies` : `task.write`.
  - Migration `20261111000000_s12_attachment_uploader` (colonne, index, clé étrangère, reprise : auteur du commentaire). DDL vérifié par `prisma migrate diff --from-schema <HEAD> --to-schema prisma/schema` **sans base**.
- **Tests** : `tests/unit/authz/rbac-services.spec.ts` (59, services réels sur la fixture) : `getProjects` par persona ; création, lecture, pièces jointes, suppression de commentaires et pièces jointes ; sprints ; minuteur ; copilote ; planification et conflits. `tests/http/projects-realtime-routes.spec.ts` (auto-schedule, conflits). **Avant correctif : 42 échecs sur 55** (les 13 réussites sont des contrôles positifs) ; les tests de planification échouaient à la compilation (la signature n'acceptait pas l'appelant). Suites historiques adaptées (providers `PolicyService`, rôle dans les mocks de membership) sans affaiblir d'assertion.
- **Écarts** : (1) matrice : `timelog.read` réservé à MANAGER/CONTRIBUTOR (les temps peuvent porter sur la facturation) ; à valider par le PO. (2) `schedule.run` reste ouvert aux MEMBER mais borné aux projets où ils écrivent (plutôt que fermé à OWNER/ADMIN). (3) Le test « table-driven » couvre la politique et les services listés par le rapport ; il n'énumère pas chaque route de `projects.controller.ts` (pas de base pour un e2e) : à étendre en Phase 6 (A9, e2e).
- **Questions / observations** : (a) les mentions `@nom` notifient les membres du workspace sans vérifier l'accès au projet de la tâche (le titre de la tâche figure dans la notification) : à traiter avec P4. (b) `assignProjectRole` n'exige pas que la cible soit membre du workspace : c'est S17 (Phase 4).

### S13 — IDOR `associateTasksToSprint`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : contrôle sur `taskIds[0]` seul, puis `updateMany` sur tous ; diffusion de tâches étrangères dans la room du workspace de la première.
- **Changement** : `AssociateTasksDto` (200 UUID v4 au plus). `sprint.service.ts` : toutes les tâches chargées avant écriture, `tasks.length === ids.length`, un seul workspace, celui du sprint, `sprint.manage` puis `task.write` sur chaque projet ; sinon 403 sans écriture. Le service renvoie les tâches modifiées ; le contrôleur ne diffuse que celles-ci, vers `project:<id>`.
- **Tests** : `tests/unit/authz/sprint-associate.spec.ts` (12) : tâche étrangère en 2e position (sprint ou backlog), identifiant inexistant, sprint d'un autre workspace, CLIENT, COMMENTER, VIEWER, CONTRIBUTOR sur P2 : 403 et `updateMany`/outbox jamais appelés ; cas nominal ; DTO. `projects-realtime-routes.spec.ts` : 400 sur UUID invalide, diffusion bornée. **Avant correctif (service d'origine) : 8 en échec sur 12.**
- **Écart** : un identifiant inexistant donne 403, comme une tâche interdite (pas d'oracle d'existence).

### S14 (suite) — Intégrations

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `toggle`/`delete` par `id` seul dans le service ; branches mortes `if (!integration) return service.toggle(...)` ; `url` en clair dans les réponses `create`/`toggle`.
- **Changement** : `IntegrationService.toggleIntegration/deleteIntegration(workspaceId, integrationId)` filtrent `where: { id, workspaceId }` (404) ; `getWorkspaceIdOf` ; URL masquée dans `create` et `toggle`. Contrôleur : branches mortes supprimées ; `OWNER/ADMIN` exigé ; intégration absente **ou** d'un workspace dont l'appelant n'est pas membre : même 404 ; membre non administrateur : 403. `exportToCalendar`, `sync` et `listIntegrations` (sans jetons) avaient été traités en Phase 0 (r2/r3).
- **Tests** : `tests/unit/authz/integrations-idor.spec.ts` (6), `projects-realtime-routes.spec.ts` (6 : inexistante, étrangère, propriétaire, pour `toggle` et `delete`), `integration.service.spec.ts` adapté. **Avant correctif** : échec de compilation (signatures à 1 argument) ; pas de comptage comportemental.
- **Écart** : les routes `integrations/:id/toggle|delete` gardent leur chemin sans `workspaceId` (pas de changement de contrat frontend) ; le workspace est résolu côté serveur puis imposé au service.

### S15 — IDOR IA

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : aucune vérification d'appartenance dans `analyzeCommand`, vision, voix, `executeActions` ; `resolveActions` énumérait tous les membres et toutes les tâches du `workspaceId` fourni ; `project-data-updated` émis vers la room du `workspaceId` du corps.
- **Changement** : `AiService.authorize` (`ai.use`, puis `task.write` sur le projet visé **et** appartenance du projet au workspace) appelé **avant** toute lecture et avant tout appel Gemini (y compris la transcription) ; `resolveActions` borné aux projets où l'appelant écrit ; `CREATE_TASK` sans projet : premier projet **accessible en écriture** ; `ExecuteAiActionsDto` (50 actions au plus, types validés) ; `executeActions` renvoie `changedTaskIds` (seules tâches réellement modifiées) ; le contrôleur émet un signal non sensible au workspace vérifié et les tâches modifiées vers leurs projets.
- **Tests** : `tests/unit/authz/ai-idor.spec.ts` (15) : non-membre et VIEWER sur les 4 entrées : 403, aucune lecture de membres/tâches, Gemini non appelé ; projet d'un autre workspace ; MEMBER sans rôle projet ; résolution bornée ; création dans un projet accessible ; DTO. **Avant correctif (service d'origine) : 12 en échec sur 15.** Gateway `voice-end` avec workspace étranger : `{ status: 'error' }` (`tracking.gateway.spec.ts`).
- **Écart** : un DTO strict pour `actions` pourrait refuser un champ inattendu produit par le modèle ; les champs de `ResolvedAiAction` sont tous couverts. À surveiller à la première utilisation réelle.

### A4 — Une seule gateway, diffusion via `RealtimeService`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : deux gateways sur le même espace de noms (double authentification, double jonction des rooms, deux adaptateurs Redis) ; diffusion codée dans les contrôleurs.
- **Changement** : `src/realtime/realtime.service.ts` + module global (`emitToProject`, `emitToTask`, `emitToUser`, `emitSignalToWorkspace`, `roomsForUser`, `refreshUserRooms`). `NotificationsGateway` supprimée (fichier et spec) ; `TrackingGateway` seule gateway (un seul adaptateur Redis, `realtime.attach`). `NotificationsService`, `ProactiveSchedulerService`, `projects`, `comments` et `ai` contrôleurs diffusent par `RealtimeService`.
- **Critère** : `grep -nE "trackingGateway|TrackingGateway" backend/src/*/*.controller.ts` : vide.
- **Écart** : l'émission reste dans les contrôleurs (après le succès du service), pas dans les services : le rapport vise les services « après commit ». Déplacer l'appel dans chaque service élargirait le périmètre (signatures et tests de la majorité des services) ; le critère mesurable est atteint.

### S16 — Temps réel : salons par projet, saisie, DoS audio, révocation

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : jonction de `workspace:<id>` pour tous les workspaces et diffusion des tâches dans cette room ; `typing` sans contrôle ; `voice-chunk` sans limite et sous `@SkipThrottle()` ; salons jamais recalculés. (Le point 5, authentification par le service de session, était déjà livré en Phase 1.)
- **Changement** : à la connexion, jonction de `project:<id>` pour chaque projet accessible (`listAccessibleProjectIds`) et de `workspace:<id>` réservé aux signaux non sensibles ; toutes les données de tâches vont vers `project:<id>`. `refreshUserRooms` (quitte/rejoint via `fetchSockets`, échec fermé : sockets coupées) appelé par `assignProjectRole`, `removeProjectRole`, l'acceptation d'invitation et l'activation/désactivation SCIM. `typing` exige `client.rooms.has('task:<id>')`. `voice-chunk` : binaire uniquement, 64 Ko par morceau, 10 Mo par session, purge et erreur au-delà ; compteur de 300 messages par 10 s et par socket sur les gestionnaires à effet.
- **Tests** : `tracking.gateway.spec.ts` (+11) : `typing` sans `join-task` ; morceau trop gros ; session > 10 Mo ; message non binaire ; débit ; salons de connexion ; cookie `accessToken` ; coupure après révocation de session. `tests/unit/authz/realtime.spec.ts` (6) : un CLIENT de P1 rejoint `project:P1` et pas `project:P2` ; après `removeProjectRole` la socket a quitté `project:P1` ; après `assignProjectRole` elle rejoint le nouveau salon ; échec fermé. `scim.service.spec.ts` : désactivation SCIM rafraîchit les salons. **Avant correctif : 6 en échec sur 16 (gateway) et 2 sur 6 (révocation).**
- **Écarts** : (1) la suppression directe d'un workspace ou d'une membership hors SCIM/invitations/rôle projet n'existe pas dans le code actuel (aucun autre `membership.delete`) ; à brancher si une telle route apparaît (Phase 4). (2) Le test « un CLIENT de P1 ne reçoit pas l'événement de P2 » est démontré par la composition des salons et du ciblage (`emitToProject`) avec un faux serveur, et non par un serveur Socket.IO réel (e2e, Phase 6). (3) `@SkipThrottle()` est conservé sur la gateway ; la limite est portée par le compteur par socket.

---

## Résultats (Phase 3)

Environnement : branche `security/phase-0`, aucune base de données (`env -u DATABASE_URL`).

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **69 suites / 69 passées, 1122 tests / 1122 passés** (Phase 2 : 61 suites, 657 tests) |
| `cd backend && env -u DATABASE_URL npx nest build` | exit 0 ; `find dist -name '*.spec.js'` : 0 ; 122 fichiers `.js`, `dist/main.js` présent |
| `cd backend && npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `cd backend && npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`rootDir`), de même nature que celle d'avant la Phase 2 (désormais attribuée à `tracking.gateway.spec.ts` après suppression de la spec des notifications) |
| `cd backend && npx eslint src tests scripts` | 0 erreur, 20 avertissements (17 en fin de Phase 2) |
| `cd backend && npx prettier --check src tests scripts` | conforme |
| `cd backend && npx prisma validate` | schéma valide |
| `prisma migrate diff --from-schema <HEAD> --to-schema prisma/schema --script` (sans base) | `ALTER TABLE Attachment ADD COLUMN uploadedById`, index, clé étrangère, rien d'autre ; identique à la migration (hors reprise de données `UPDATE`) |
| `cd frontend && npx vitest run` | 15 fichiers / 15, 59 tests / 59 |
| `cd frontend && npx tsc --noEmit -p .` | exit 0 |
| `cd frontend && npx eslint src` | 0 erreur, 36 avertissements |
| `cd frontend && npx vite build` | built in 5.04s |

- `git status` : aucun `*.tsbuildinfo`, aucun `dist`, `pnpm-lock.yaml` non modifié, aucune dépendance ajoutée.
- Frontend : aucun changement de code ; contrats REST et noms d'événements Socket.IO inchangés. Les corps de `sprints/:id/tasks` et `ai/execute` sont désormais validés strictement (le frontend actuel envoie des formes conformes).
- Non touchés : phases 4 à 6, `rapport-audit.md`, `.claude/`, `GEMINI.md`, DAT (la mise à jour de leur section « État » est laissée à l'architecte).

### Points ouverts pour l'architecte

1. Valider la règle P4 par défaut (MEMBER/VIEWER sans rôle projet : aucun accès) ou choisir « MEMBER = CONTRIBUTOR implicite ».
2. Valider `timelog.read` réservé à MANAGER/CONTRIBUTOR.
3. O4 : accepter l'écart (adresse du domaine prouvé acceptée même si `domain` diffère) ou exiger le refus de toute configuration incohérente.
4. A2 : `@RequirePermission` + guard non livrés (écart documenté) ; A4 : émission dans les contrôleurs et non dans les services.
5. Observations hors périmètre : mentions `@nom` sans contrôle d'accès au projet ; `assignProjectRole` vers un non-membre (S17).

---

## Actions de la revue r11 (Phase 3 : plan d'action r11 pour fixeur)

Reprise après interruption de la session précédente (2026-11-02, vers 19h33). L'état hérité (S12-d, S12-a, S12-b, S12-c partiellement faits, aucune entrée de journal, aucun échec consigné) a été **relu et vérifié contre chaque critère** avant d'être complété. Aucune base réelle, aucun commit, aucun push. Les décisions produit P4, `timelog.read` et DTO IA restent **en attente de l'utilisateur** : non tranchées, script `grant-legacy-project-access.ts` **non écrit**, `timelog.read` inchangé.

**Honnêteté sur les preuves « avant correctif »** : la session précédente n'a pas consigné l'échec initial. Les fichiers `src/authz/` étant non versionnés, il n'existe pas de version HEAD de `policy.service.ts`. Les preuves ci-dessous sont donc, selon le cas : (a) rejeu du test contre la version HEAD du fichier de service (`git show HEAD:...`, fichier restauré ensuite, vérifié par `diff`) ; (b) **mutation** du correctif (reconstitution de l'ancien comportement décrit au rapport r11, annulée ensuite, vérifiée par `diff`) ; (c) test écrit avant le correctif et échec observé (S16-a, S16-b, décision 4, S12-e, A2-b). Ce qui n'a pas pu être prouvé est indiqué entrée par entrée.

### S12-d (action 1) — Test de matrice par route

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `backend/tests/http/rbac-matrix.spec.ts` (app Nest réelle, `JwtAuthGuard` global, contrôleurs et services réels, `PolicyService` réelle, `FakePrisma` sur `tests/support/rbac-fixture.ts`). Une ligne par route de `projects`, `comments`, `tracking` et `ai` (dont `delivery-report`), 9 profils (owner, admin, member, contributor, commenter, viewer, client, outsider, désactivé SCIM), variante P1 des routes de projet, oracle indépendant de `permissions.ts`. Test méta de complétude dans les deux sens. Pour chaque refus : statut 403/404 (ou 400 documenté) **et aucune écriture** ; pour le CLIENT(P1) et les autres : aucune donnée de P2 dans la réponse. **982 tests.**
- **Corrections apportées à l'existant** : (1) le Prisma simulé de la matrice déclarait `var proxy` jamais assigné : `$transaction` appelait donc `cb(undefined)`, ce qui faisait échouer en 500 toute route transactionnelle autorisée sans que la matrice le voie (elle ne vérifie que « ni 401 ni 403 » pour un accès autorisé) ; réécrit en `const proxy`, les écritures dans une transaction sont maintenant enregistrées. (2) 2 erreurs ESLint (`no-var`, `no-unassigned-vars`) et 3 directives devenues inutiles retirées.
- **Preuve avant correctif** : milestones HEAD (`git show HEAD:backend/src/projects/milestones.service.ts`) rejoué contre la matrice : **16 échecs sur 982** (`GET /projects/:id/delivery-report` : 11 ; `PUT /projects/deliveries/items/:itemId/toggle` : 5), les 966 autres passent. Test méta : retrait de la ligne `GET /tracking/logs` : le test méta échoue (`Received: ["GET /tracking/logs"]`). **Non prouvé** : l'échec exact initial de la session précédente (non consigné).
- **Tests** : `tests/http/rbac-matrix.spec.ts` 982/982 passent avec le code actuel.
- **Écart** : aucun par rapport au rapport. Les routes `ANY` (listes bornées, minuteur personnel) ne vérifient que l'absence de 401 ; leur filtrage est couvert par `rbac-services.spec.ts`.
- **Questions pour l'architecte** : aucune.

#### Revue architecte r12 (2026-11-03)

VALIDÉ. 982/982 ; rejeu de milestones HEAD : 16 échecs (refait). Test méta dans les deux sens conforme. Amélioration non bloquante Q-2 (Phase 6) : 120 cas autorisés finissent en 500 à cause du Prisma simulé, et seul « ni 401 ni 403 » est vérifié pour eux.

### S12-a (action 2) — Appartenance au workspace exigée pour tout rôle de projet

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : le créateur était MANAGER et la `ProjectMembership` faisait foi sans lire la `Membership` ; `listAccessibleProjectIds` n'imposait pas l'appartenance.
- **Changement** : `src/authz/policy.service.ts` : `effectiveProjectRole` lit la `Membership` d'abord et renvoie `null` si elle manque (projet personnel : créateur seul) ; `listAccessibleProjectIds` restreint les branches « créateur » et « ProjectMembership » aux workspaces de l'utilisateur, OWNER/ADMIN aux leurs, projet personnel seulement hors filtre de workspace ; `filterUsersWithProjectAction` applique la même règle.
- **Tests** : `tests/unit/authz/policy.service.spec.ts` (suppression de la `Membership` : 403 pour le créateur et pour la `ProjectMembership`, plus rien dans `listAccessibleProjectIds` hors projet personnel, projet personnel conservé) ; persona `deprovisioned` dans la matrice HTTP ; `tests/integration/realtime/task-room-revocation.spec.ts` (désactivation SCIM sur un vrai Socket.IO : plus de `project:P1` ni `task:T1`, plus de `new-comment`) ; `project-permissions.service.spec.ts` (3 mocks de `membership` corrigés, un test ajouté).
- **Preuve avant correctif** : mutation (ancien comportement reconstitué d'après le rapport) : **35 échecs** (matrice HTTP : 20 lignes `deprovisioned [P1]` ; `policy.service.spec` : 14 ; `project-permissions.service.spec` : 1 ; le reste de l'échantillon passe). **Non prouvé** : exécution contre l'original exact (fichier non versionné).
- **Critère 2 (test SCIM)** : couvert par la combinaison matrice HTTP (403 sur `GET /projects/:id` pour le profil désactivé) + test d'intégration Socket.IO (même suppression de `Membership` puis `refreshUserRooms`) + `scim.service.spec` existant (la désactivation appelle `refreshUserRooms`). Je n'ai pas écrit de test `PATCH active=false` de bout en bout qui enchaîne SCIM puis `GET /projects/:id` (pas de base). **À valider.**
- **Écart** : l'effet sur les `ProjectMembership` orphelines (comptes désactivés puis réactivés) est décrit au runbook § 4.1.

#### Revue architecte r12 (2026-11-03)

VALIDÉ. Mutation refaite : 35 échecs. Critère 2 par composition : accepté (réponse 1 du rapport r12). Le chemin des notes contourne encore la règle : nouveau constat S12-f, bloquant.

### S12-b (action 3) — Livrables et rapport de livraison

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `src/projects/milestones.service.ts` : `assertProjectAccess` et `assertWorkspaceRole` locaux supprimés ; `getDeliveryReport` : `policy.assertProject(..., 'project.read')` (404 projet absent, 403 sinon), `NotFoundException` à la place du `throw new Error` ; créations et changements d'état (jalon, livrable, livraison) : `project.manage` ; `toggleDeliveryChecklistItem` : `project.write`. `grep -n "memberships: { some: { userId" src/projects/milestones.service.ts` : aucune ligne.
- **Tests** : `rbac-services.spec.ts` (S12-b : 404 sur projet inexistant, 403 sans lecture pour client/viewer/member/outsider/désactivé, checklist 403 sans écriture) ; lignes de la matrice HTTP pour `delivery-report`, `deliveries`, `milestones`, `deliverables`, `toggle`.
- **Preuve avant correctif** : milestones HEAD : matrice **16 échecs** (voir S12-d) ; `rbac-services.spec -t S12-b` : **7 échecs sur 7**.
- **Écart** : les recherches d'entité par identifiant (jalon, livrable, livraison, élément de checklist) répondent encore 400 « introuvable » quand l'entité n'existe pas, et 403 quand elle existe sans accès : léger oracle d'existence sur ces identifiants UUID. Le rapport n'exigeait que le 404 de `delivery-report`. **Question pour l'architecte** : faut-il unifier (400/403 identiques) ?

#### Revue architecte r12 (2026-11-03)

VALIDÉ. `grep` vide, 404 au lieu du 500, rôles de projet par la politique. Oracle 400/403 sur des UUID : accepté, aucun changement (réponse 2).

### S12-c (action 4) — Mentions et assignations limitées aux personnes autorisées

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `PolicyService.filterUsersWithProjectAction(projectId, userIds, action)` (deux requêtes, mêmes règles que `assertProject`). `comments.service.ts` : `parseMentions(content, workspaceId, projectId)` ne cherche que parmi les lecteurs `comment.read` (mention inconnue ou non autorisée ignorée, sans erreur) ; `tasks.service.ts` : `replaceTaskAssignees(taskId, projectId, ids, actor)` n'assigne que les `task.read` (suppression de `getAccessibleUserIds`).
- **Tests** : `tests/unit/authz/notifications-access.spec.ts` (mention d'un sans-rôle : ni notification ni identifiant ; mention d'un COMMENTER : notifié ; assignation d'un membre sans rôle : ignorée et aucune notification ; méthode de politique) ; `comments.service.spec.ts` (`parseMentions` à 3 arguments, un test d'exclusion ajouté) ; `tasks.service.spec.ts` (mock de `PolicyService`).
- **Preuve avant correctif** : mutation (`filterUsersWithProjectAction` renvoie tous les identifiants) : **7 échecs** dans `notifications-access.spec`. **Non prouvé** : exécution contre `parseMentions` d'origine à 2 arguments (la signature a changé, le test d'origine ne compile plus).
- **Correction de tests hérités** : 2 tests de `notifications-access.spec` échouaient à l'état hérité (mock de tâche sans `createdAt`/`updatedAt`) : corrigés ; `comments.service.spec` et `tasks.service.spec` ne compilaient plus ou échouaient (huit suites rouges à l'état hérité, 17 tests) : adaptés sans affaiblir d'assertion.
- **Écart** : `PUT` d'un commentaire (mentions) passe par la même méthode ; aucune autre source de notification n'a été trouvée (`grep createNotification`).

#### Revue architecte r12 (2026-11-03)

VALIDÉ pour son périmètre (mutation refaite : 7 échecs). L'affirmation « aucune autre source » est inexacte : `notes.service.ts` (recherche d'assigné sur toute la plateforme, `taskAssignee.create` sans filtre) et `resources.service.ts` (`optimizeWorkspaceResources`) assignent sans `task.read`. À traiter en S12-f.

### S16-a (action 5) — Révocation des salons `task:<id>`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `refreshUserRooms` ne traitait que `project:` et `workspace:`.
- **Changement** : `src/realtime/realtime.service.ts` : `refreshUserRooms` collecte les `task:<id>` de toutes les sockets de l'utilisateur, **une seule requête** `PolicyService.filterTaskIdsInProjects(taskIds, projectIds accessibles)` (`task.findMany` bornée, tâches non supprimées) et fait quitter les salons dont la tâche n'est plus dans un projet accessible ; échec fermé conservé. Défense en profondeur (`emitToTask` par intersection) **non faite** : la révocation suffit au critère.
- **Tests** : `tests/integration/realtime/task-room-revocation.spec.ts` : **vrai serveur Socket.IO** (gateway `TrackingGateway` réelle, `IoAdapter` Nest, clients `socket.io-client`, vrai `POST /projects/tasks/:id/comments`, `redis` simulé injoignable). Retrait de rôle : le client révoqué ne reçoit plus `new-comment` (contrôle positif avant), le client autorisé le reçoit ; désactivation SCIM ; salon conservé si le projet reste accessible. Unitaires : `tests/unit/authz/realtime.spec.ts` (+2).
- **Preuve avant correctif** : test d'intégration écrit avant le correctif : **2 échecs sur 3** (`task:T1` toujours présent après `removeProjectRole` et après désactivation). Les 2 tests unitaires ajoutés n'ont **pas** été rejoués sans correctif.
- **Hygiène** : `--detectOpenHandles` sur le fichier : aucun handle signalé ; suite complète : aucun message « did not exit ».
- **Dépendance** : `socket.io-client@4.7.5` en `devDependencies` du backend (déjà verrouillée côté frontend ; installation `pnpm add -D --offline`, `pnpm-lock.yaml` reformaté par prettier : **3 lignes ajoutées**, aucun autre paquet). Justification : critère 2 du rapport.
- **Écart** : le test d'intégration simule Redis (pas d'adaptateur Redis en test) ; la révocation multi-instances reste décrite au runbook § 3.

#### Revue architecte r12 (2026-11-03)

VALIDÉ. Mutation refaite : 3 échecs ; `--detectOpenHandles` propre. Dépendance `socket.io-client@4.7.5` acceptée (réponse 6, `ws` transitif suivi en S25). Défense en profondeur d'`emitToTask` facultative ; le déplacement de tâche par les notes est traité en S16-c, exigé.

### S16-b (action 6) — Salons du nouveau projet et de l'invité

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `RealtimeService.refreshWorkspaceManagersRooms(workspaceId, extraUserIds)` (n'échoue jamais ; liste des OWNER/ADMIN via `PolicyService.listWorkspaceAdminIds`) appelé par `ProjectsService.createProject` après commit pour le créateur et chaque OWNER/ADMIN ; `InvitationsService.validateAndAcceptInvitation` appelle `refreshUserRooms` aussi sur le chemin « déjà membre du workspace ». Option retenue pour OWNER/ADMIN : recalcul par personne (pas de salon `workspace-admin:<id>`).
- **Tests** : intégration Socket.IO réelle (le créateur MEMBER et un ADMIN déjà connectés reçoivent `task-status-changed` du nouveau projet, un CLIENT de P1 non) ; `invitations.service.spec` (membre existant invité sur un projet : rôle attribué et `refreshUserRooms` appelé).
- **Preuve avant correctif** : appel retiré (mutation) : l'intégration S16-b échoue (1 échec) ; invitation : 1 échec sans l'appel.
- **Écart** : coût O(OWNER+ADMIN) recalculs par création de projet ; acceptable pour des workspaces de petite taille. **Question** : préférer un salon `workspace-admin:<id>` si les workspaces ont beaucoup d'administrateurs ?

#### Revue architecte r12 (2026-11-03)

VALIDÉ. Recalcul par administrateur accepté (réponse 4) ; réévaluation en Phase 6 au-delà d'environ 50 administrateurs.

### Décision 4 (action 7, partie technique) — Normalisation de `resolveActions`

- **Statut** : `CORRIGÉ – À REVOIR` (la décision produit « DTO strict » reste **en attente** de l'utilisateur ; DTO inchangé, `forbidNonWhitelisted` conservé)
- **Changement** : `src/projects/ai.service.ts` : `normalizeResolvedAction` appliquée à chaque action renvoyée : champs connus de `ResolvedAiAction` uniquement, valeurs non chaînes retirées (dont `null`), `estimatedMinutes` arrondi à un entier entre 0 et 100000.
- **Tests** : `tests/unit/authz/ai-roundtrip.spec.ts` : sortie d'`analyzeCommand` (45.5, champ inconnu, `null`) passée par le même `AppValidationPipe` strict que l'application sur `ExecuteAiActionsDto` : acceptée ; bornes ; le DTO refuse toujours un champ inconnu ou une décimale envoyés par un client.
- **Preuve avant correctif** : **2 échecs sur 3** avant (arrondi et champs), le 3e (DTO strict) passait déjà.
- **Écart** : le test d'aller-retour passe par le pipe et non par un `POST` HTTP ; l'équivalence repose sur l'usage du même `AppValidationPipe` global.

#### Revue architecte r12 (2026-11-03)

VALIDÉ (partie technique). Test par le pipe global accepté. Observation O5, facultative : retirer les valeurs hors énumération (`priority`, `status`, `dependencyType`). La décision produit reste en attente de l'utilisateur.

### S12-e, A2-b, Q-1 (action 8)

- **Statut** : `CORRIGÉ – À REVOIR`
- **S12-e** : `resources.service.ts` : `costRateCents` et `billingRateCents` retirés du `profile` sauf pour OWNER/ADMIN. Test : `rbac-services.spec` (S12-e) : 4 profils sans taux (y compris la valeur numérique), OWNER/ADMIN avec taux. **Avant correctif : 4 échecs sur 6.**
- **A2-b** : `sprint.service.ts` : sprint absent ou d'un autre workspace → même 403 `denied()`. Test : `sprint-associate.spec` (réponse identique à une tâche interdite). **Avant correctif : 1 échec.** `updateSprint` et `deleteSprint` répondent toujours 404 sur un sprint absent (hors périmètre du constat, qui ne visait que `associateTasksToSprint`). **Question** : à unifier aussi ?
- **Q-1** : ESLint repassé à **17 avertissements** (le nouveau était un `Record<string, any>` de `tracking.gateway.spec.ts` ligne 298, remplacé par `unknown`) et **0 erreur**. Les 2 erreurs et 3 directives inutiles de la matrice ont été corrigées.

#### Revue architecte r12 (2026-11-03)

VALIDÉ. `updateSprint`/`deleteSprint` en 404 : accepté, aucun changement (réponse 3). ESLint : 17 avertissements (vérifié).

### Documents (action 9)

- **Statut** : `CORRIGÉ – À REVOIR`
- `docs/security/runbook-phase3.md` : § 4 (effet de S12-a sur les comptes désactivés et requête SQL de repérage des `ProjectMembership` orphelines, changements visibles, dépendance de test) et § 5 (décisions P4, `timelog.read`, DTO IA **en attente**). Ce journal.

#### Revue architecte r12 (2026-11-03)

VALIDÉ. Requête § 4.1 correcte ; pas de nettoyage automatique : accepté (réponse 7). Complément S17 en Phase 4 : purger les `ProjectMembership` sur SCIM `DELETE`.

## Résultats (r11)

Environnement : branche `security/phase-0`, `env -u DATABASE_URL`, aucune base, aucun commit.

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **73 suites / 73 passées, 2183 tests / 2183 passés** (r11 d'entrée : 69 suites, 1122 tests ; état hérité en début de reprise : 8 suites et 17 tests en échec) |
| `npx nest build` | exit 0 ; `find dist -name '*.spec.js'` : 0 ; 122 `.js`, `dist/main.js` présent |
| `npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`rootDir`) sur `tracking.gateway.spec.ts`, antérieure et inchangée |
| `npx eslint src tests scripts` | **0 erreur, 17 avertissements** |
| `npx prettier --check src tests scripts` | conforme |
| `npx prisma validate` | schéma valide (aucun changement de schéma en r11) |
| `cd frontend && npx vitest run` | 15 fichiers / 15, 59 tests / 59 |
| `npx tsc --noEmit -p .` | exit 0 |
| `npx eslint src` | 0 erreur, 36 avertissements |
| `npx vite build` | built in 7.96s |

- `git status` : aucun `*.tsbuildinfo`, `dist`, `.claude/` ni fichier `.env*` ajouté ; `pnpm-lock.yaml` +3 lignes ; `backend/package.json` +1 ligne (`socket.io-client`).
- Frontend : aucun changement de code.

## Points ouverts pour l'architecte (r11)

1. **S12-a, critère 2** : pas de test `PATCH active=false` de bout en bout (SCIM puis `GET /projects/:id`) ; couvert par composition (matrice + Socket.IO + spec SCIM). Acceptable ?
2. **S12-b** : oracle 400/403 résiduel sur les identifiants de jalon, livrable, livraison et élément de checklist ; à unifier ou à accepter ?
3. **A2-b** : `updateSprint` et `deleteSprint` répondent toujours 404 sur un sprint absent ; à unifier ?
4. **S16-b** : recalcul par administrateur (retenu) ou salon `workspace-admin:<id>` ?
5. **S16-a** : défense en profondeur d'`emitToTask` (intersection avec `project:<id>`) non faite ; la révocation est testée sur un vrai serveur.
6. **Dépendance** : `socket.io-client@4.7.5` en `devDependencies` du backend (lock +3 lignes). Accepter ?
7. **Preuves « avant correctif »** : voir l'en-tête de la section r11 ; l'échec initial de la session interrompue n'a pas été consigné et ne peut pas être reconstitué ; les mutations et rejeux HEAD le remplacent.
8. **Décisions produit en attente de l'utilisateur** (non tranchées) : P4 (script de reprise non écrit), `timelog.read` (inchangé), DTO IA (strict, normalisation faite).
9. Les entrées ci-dessus sont toutes en `CORRIGÉ – À REVOIR` ; aucune n'est marquée `VALIDÉ`.

## Revue architecte r12 (2026-11-03) : NON VALIDÉ

Détail dans `rapport-audit.md`, section « Revue r12 ». Les entrées r11 sont validées. Le plan d'action r12 porte sur S12-f (notes et `optimizeWorkspaceResources` hors `PolicyService`, bloquant), sur S16-c (salon `task:<id>` après déplacement de tâche) et sur O5 (facultatif). Les décisions produit P4, `timelog.read` et DTO IA restent en attente de l'utilisateur.

## Actions de la revue r12 (2026-11-03)

Ordre suivi : S12-f, S16-c, O5, clôture. Aucune base réelle, aucun commit.

### S12-f — Notes et optimisation de charge hors `PolicyService`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `notes.service.ts` cherchait le projet cible par `{ name, userId }`, mettait à jour (et déplaçait) les tâches existantes, cherchait l'assigné parmi tous les utilisateurs (`user.findFirst` par `name`/`githubUsername`) et créait les `taskAssignee` sans filtre. `resources.service.ts` (`optimizeWorkspaceResources`) réassignait à n'importe quel membre.
- **Preuve avant correctif** : nouveau `tests/unit/authz/notes-access.spec.ts` (vrai `PolicyService`, fixture RBAC, Prisma simulé, utilisateur `deprovisioned` = Bob sans `Membership`, projet « Roadmap » de W créé par lui) sur le code d'avant : **8 échecs sur 10** (2 tests de contrôle positif passaient : OWNER crée dans le projet du workspace ; mise à jour sans changement de projet). Échecs : tâche créée dans le projet du workspace `P-W1` (critère 1) ; `task.update` sur une tâche d'un projet devenu inaccessible (critère 2) ; assignation de l'utilisateur d'un autre tenant, d'un membre sans rôle (critère 3) ; assignation COMMENTER impossible car `user.findFirst` renvoyait l'autre tenant ; auteur seul assignable en projet personnel ; `user.findFirst` appelé ; éviction du salon absente (S16-c). Pour `optimizeWorkspaceResources` : `rbac-services.spec` (S12-f) **2 échecs sur 2** avec l'ancien `resources.service.ts` (HEAD).
- **Changement** :
  - `src/notes/notes.service.ts` : injection de `PolicyService` et `RealtimeService` ; projet cible = projet de l'auteur (`userId`), de nom exact, dans `listAccessibleProjectIds(userId, { action: 'task.write' })` (qui inclut ses projets personnels), sinon création d'un projet **personnel** du même nom (comportement existant, sans erreur ni oracle) ; tâche existante : si `filterUsersWithProjectAction(projet actuel, [auteur], 'task.write')` ne renvoie pas l'auteur, la ligne est laissée telle quelle ; assigné : nouvelle méthode privée `resolveAssignee`, nom cherché parmi les membres du workspace du projet (ou l'auteur seul pour un projet personnel) puis filtré par `task.read` ; `user.findFirst` supprimé (`grep -n "user.findFirst" src/notes/notes.service.ts` : vide).
  - `src/projects/resources.service.ts` : `optimizeWorkspaceResources` calcule les lecteurs `task.read` par projet (un appel par projet distinct) ; le meilleur candidat est choisi parmi eux ; une tâche sans candidat est ignorée.
  - `src/notes/notes.service.spec.ts` : fournisseurs `PolicyService` et `RealtimeService` simulés (tout autorisé), comportement inchangé.
- **Tests** : `tests/unit/authz/notes-access.spec.ts` (10), `rbac-services.spec.ts` section S12-f (2 : un VIEWER/MEMBER sans rôle n'est jamais choisi sur 6 tâches ; tâche sans candidat non réassignée). Résultat après correctif : tous verts (voir « Résultats (r12) »).
- **Recherche élargie des chemins d'écriture hors `PolicyService`** (résultat honnête) :
  - `taskAssignee.create*` : `tasks.service.ts` (filtré, S12-c), `resources.service.ts` et `notes.service.ts` (corrigés ici). Aucun autre.
  - Écritures `task.*` : `sprint`, `timeblocks`, `dependencies`, `projects.service` passent par la politique (S12-b / A2). `calendar-sync.service.ts:754` crée la tâche technique « Synchronisation Calendrier » dans le premier projet du workspace : la route est réservée par contrôleur à des rôles de workspace (`assertWorkspaceAccess`), à confirmer comme OWNER/ADMIN (MANAGER de tous les projets) ; non modifié. `auth.service.ts:1103-1139` crée les tâches d'accueil d'un projet neuf de l'utilisateur.
  - `proactive-scheduler.service.ts` (crons, pas de requête utilisateur) : notifications `SYSTEM` aux OWNER/ADMIN et à l'utilisateur surchargé (membre du workspace) ; les messages peuvent citer des titres de tâches de projets où ce dernier n'a pas de rôle. Non modifié (risque résiduel faible, contenu d'alerte agrégé) ; **question** ci-dessous. `timeBlock.create` du planificateur automatique : l'entrée utilisateur (`autoScheduleWorkspace`) est déjà filtrée.
  - `user.findMany()` sans filtre : `proactive-scheduler` (cron briefings, boucle sur les membres, pas d'exposition), `admin.service` (console admin, réservée), purge des comptes non vérifiés.
  - Je n'ai pas relu les services hors `projects/`, `notes/` et `auth/` ligne à ligne : la recherche est par motif (`prisma.*.(create|update|upsert|delete)`, `taskAssignee`, `createNotification`, `user.find*`), pas une preuve d'absence.
- **Écart par rapport au rapport** : (1) j'ai conservé la contrainte `userId` du projet cible (comportement d'origine) : un CONTRIBUTOR ne peut pas viser par `#nom` un projet créé par un autre, il obtient un projet personnel (aucun gain d'accès, aucun oracle) ; (2) pour une tâche non écrivable, un projet personnel du même nom peut être créé avant le constat (effet de bord sans conséquence de sécurité) ; (3) une tâche dont le projet est supprimé (`deletedAt`) n'est plus modifiable par la note (`filterUsersWithProjectAction` renvoie vide) ; (4) comparaison des noms insensible à la casse faite en code.
- **Questions** : voir « Points ouverts pour l'architecte (r12) ».

#### Revue architecte r13 (2026-11-03)

**VALIDÉ.** Les 6 critères passent. La preuve « avant » est rejouée (`notes.service.ts` de HEAD : 8 échecs sur 10). Les mutations isolées sont toutes détectées : projet cible sans `writableIds` (1 échec), tâche existante sans contrôle (1), assigné non filtré (1), optimisation sans filtre (2). `user.findFirst` a disparu. Les écarts (1) à (4) sont acceptés (rapport, r13, réponses 1 à 3). **Deux chemins voisins du même fichier restent ouverts, en nouveaux constats** : S12-h (déplacement d'une tâche hors de son workspace, bloquant) et S12-g (`syncTaskStatusToNote` écrit dans la note d'un auteur sans accès). La recherche par motifs ne suffisait pas seule (réponse 6).

### S16-c — Salon `task:<id>` après déplacement par une note

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `src/realtime/realtime.service.ts` : `evictTaskRoom(taskId)` = `server.in(taskRoom(id)).socketsLeave(taskRoom(id))` (sans effet si le serveur n'est pas attaché). `notes.service.ts` l'appelle après `task.update` quand `projectChanged`. `RealtimeModule` est global : `NotesModule` n'a pas eu besoin d'import (`nest build` OK, aucune dépendance circulaire).
- **Tests** : `notes-access.spec` (déplacement P1 vers P2 : `evictTaskRoom('T1')` appelé ; mise à jour sans changement de projet ou refus : jamais appelé). **Avant correctif** : le test de déplacement échouait (méthode et appel absents). Pas de test d'intégration (non exigé).
- **Écart** : le test unitaire vérifie l'appel du service ; l'effet réel de `socketsLeave` n'est pas rejoué contre un serveur Socket.IO (le critère du rapport ne l'exige pas). Aucun test unitaire de `RealtimeService.evictTaskRoom` isolé (appel sur un serveur factice) : à ajouter si l'architecte le souhaite.

#### Revue architecte r13 (2026-11-03)

**À REPRENDRE** (petit). L'appel depuis les notes est en place et testé : retirer l'appel produit 1 échec. En revanche, vider `RealtimeService.evictTaskRoom` (`return;`) laisse **525/525** tests verts. Le critère r12 (« `socketsLeave('task:T')` est appelé ») n'est donc pas vérifié. Attendu : un test dans `tests/unit/authz/realtime.spec.ts` sur un serveur factice, où `evictTaskRoom('T1')` appelle `in('task:T1')` et `socketsLeave('task:T1')`, sans exception si aucun serveur n'est attaché. La même mutation doit faire échouer ce test. Pas de test d'intégration exigé.

### O5 — Valeurs hors énumération dans `normalizeResolvedAction`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `src/projects/ai.service.ts` : `RESOLVED_ACTION_ENUM_FIELDS` (`priority`, `status`, `dependencyType`, alignés sur `ExecuteAiActionsDto`) ; une valeur hors liste est retirée.
- **Tests** : `ai-roundtrip.spec` : `priority: 'URGENT'`, `status`, `dependencyType` invalides retirés, valeurs valides conservées, action acceptée par le pipe strict. **Avant correctif** : en neutralisant seulement le filtre d'énumération, le test O5 échoue (1 échec, les 3 autres passent) ; code restauré.
- **Écart** : aucun.

#### Revue architecte r13 (2026-11-03)

**VALIDÉ.** Les énumérations sont alignées sur les `@IsIn` d'`ExecuteAiActionsDto`. La mutation (filtre retiré) donne 1 échec.

## Résultats (r12)

Environnement : branche `security/phase-0`, `env -u DATABASE_URL`, aucune base, aucun commit.

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **74 suites / 74 passées, 2196 tests / 2196 passés** (r11 : 73 / 2183 ; +1 suite `notes-access`, +13 tests : 10 notes, 2 optimisation, 1 O5) |
| `npx nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 0 fichier de test ; 122 `.js` |
| `npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`rootDir`, `tracking.gateway.spec.ts`), antérieure et inchangée |
| `npx eslint src tests scripts` | **0 erreur, 17 avertissements** |
| `npx prettier --check src tests scripts` | conforme |
| `npx prisma validate` | schéma valide (aucun changement de schéma) |
| `cd frontend && npx vitest run` | 15 fichiers / 15, 59 tests / 59 |
| `npx tsc --noEmit -p .` | exit 0 |
| `npx eslint src` | 0 erreur, 36 avertissements |
| `npx vite build` | built in 7.27s |

- Frontend : aucun changement de code. Aucune migration, aucun changement d'API. Changement de comportement visible : un tag `#Projet` d'une note ne cible plus un projet de workspace dont l'auteur a perdu l'accès (projet personnel créé à la place) ; un assigné proposé par l'IA qui n'a pas accès au projet est ignoré.

## Points ouverts pour l'architecte (r12)

1. **S12-f, contrainte `userId` du projet cible** conservée (comportement d'origine). Faut-il autoriser le ciblage de tout projet de workspace où l'auteur a `task.write` ? (Ambiguïté en cas de noms identiques.)
2. **Tâche non écrivable** : un projet personnel homonyme peut être créé avant le constat. Faut-il évaluer la tâche existante avant de résoudre le projet ?
3. **`proactive-scheduler`** (crons) : alertes `SYSTEM` à l'utilisateur surchargé pouvant citer des titres de tâches de projets sans rôle. À traiter en Phase 6 ou à ignorer ?
4. **`calendar-sync.service.ts:754`** : tâche technique créée dans le premier projet du workspace ; la route est réservée aux rôles de workspace par le contrôleur. À confirmer.
5. **S16-c** : pas de test isolé de `RealtimeService.evictTaskRoom` ni d'intégration réelle.
6. La recherche élargie est par motifs, pas une preuve d'absence (voir S12-f).
7. Décisions produit en attente de l'utilisateur, non tranchées : P4, `timelog.read`, DTO IA. Points renvoyés à d'autres phases, non traités : Q-2, complément S17, `ws` (S25).
8. Toutes les entrées r12 sont en `CORRIGÉ – À REVOIR` ; aucune n'est marquée `VALIDÉ`.

## Revue architecte r13 (2026-11-03) : NON VALIDÉ

Détail dans `rapport-audit.md`, section « Revue r13 ». Les chiffres de « Résultats (r12) » sont exacts : 74/74 suites, 2196 tests, build sans `*.spec.js`, ESLint 0 erreur et 17 avertissements, frontend vert. **Arbre de travail intact après les stashs** : `git stash list` vide, 83 entrées dans `git status`, tous les fichiers non suivis r11 présents, aucun marqueur de conflit, correctifs r11 en place.

- S12-f : **VALIDÉ**. O5 : **VALIDÉ**. S16-c : **À REPRENDRE** (test de l'implémentation d'`evictTaskRoom`).
- Nouveaux constats prouvés : **S12-h** (Moyen, bloquant : une note sort une tâche de son workspace, avec les commentaires et les pièces jointes des autres) et **S12-g** (Mineur : la note d'un auteur sans accès reçoit les nouveaux titres).
- Réponses aux points ouverts r12 : 1 à 3 acceptés ; 4 tranché, aucun écart (calendrier réservé à OWNER/ADMIN, MANAGER implicites ; les alertes cron avec titres ne vont qu'aux OWNER/ADMIN ; briefings filtrés) ; 5 test isolé exigé ; 6 recherche par motifs insuffisante seule, relecture complète des notes faite ici.
- **Plus de `git stash` pour les preuves** : `git show HEAD:<chemin> > <chemin>` après une copie de sauvegarde (`/bin/cp -f`), puis restauration et `cmp`.
- Plan d'action r13 : S12-h, S12-g, test S16-c, runbook § 4.2, O6 facultatif, clôture.
- Décisions produit P4, `timelog.read`, DTO IA : toujours en attente de l'utilisateur.

## Actions de la revue r13 (2026-11-03)

Procédure de preuve r13 respectée : **aucun `git stash`**. Les preuves « avant » utilisent une sauvegarde `/bin/cp -f` dans le scratchpad, une mutation ciblée ou `git show HEAD:<chemin>`, puis restauration par `/bin/cp -f` et vérification par `cmp` (« restored » à chaque fois). `git stash list` : vide (0 entrée). `git status --short` : 85 entrées (83 en début de r13, plus `scripts/grant-legacy-project-access.ts` et son test).

### S12-h — Une note ne déplace plus une tâche hors de son workspace

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `src/notes/notes.service.ts` (bloc de mise à jour d'une tâche existante) calculait `projectChanged` et écrivait `projectId: project.id` sans comparer le workspace de la source à celui de la destination.
- **Preuve avant correctif** : 5 tests ajoutés dans `tests/unit/authz/notes-access.spec.ts` (section S12-h), lancés sur le code non corrigé : **3 échecs** — critère 1 (CONTRIBUTOR de P1, `#Perso` : `task.update` avec un `projectId` ≠ P1), critère 2 (membre de W et OTHER_W : déplacement W vers OTHER_W), et « projet personnel vers projet de workspace » ; les critères 3 et 4 (contrôles positifs) passaient déjà.
- **Changement** :
  - `src/notes/notes.service.ts` : `findFirst` de la tâche existante avec `include: { project: { select: { workspaceId: true } } }` ; `sameWorkspace = (existingTask.project?.workspaceId ?? null) === (project.workspaceId ?? null)` ; `projectChanged = existingTask.projectId !== project.id && sameWorkspace` ; `task.update` écrit `projectId: projectChanged ? project.id : existingTask.projectId`. Les autres champs sont appliqués normalement, aucune erreur, `evictTaskRoom` seulement si `projectChanged`.
  - `src/notes/notes.service.spec.ts` : deux assertions sur `task.findFirst` adaptées (`expect.objectContaining({ where })`) à cause du `include`.
- **Tests** : `notes-access.spec.ts`, 5 tests S12-h (critères 1 à 4 du rapport, plus personnel vers workspace refusé). Après correctif : verts. **Mutation** (`projectChanged = … || !sameWorkspace`) : 3 échecs. Rejeu de `notes.service.ts` de `HEAD` contre toute la spec : 15 échecs sur 18.
- **Écart par rapport au rapport** : aucun. Précision : un projet personnel (`workspaceId` NULL) vers un projet de workspace, ou l'inverse, est aussi refusé (égalité stricte des workspaces). Une ligne sans tag (« Inbox », projet personnel) ne sort donc plus une tâche de son projet de workspace.
- **Questions pour l'architecte** : voir « Points ouverts (r13) », 1.

#### Revue architecte (r14)

**VALIDÉ.** M8 (`sameWorkspace = true`) : 3 échecs ; M9 (`projectId: project.id`) : 2 échecs. Égalité stricte confirmée (question 1). **Régression du correctif prouvée, suivie à part en S12-i** : sur un déplacement refusé, l'assigné est encore résolu contre le projet cible refusé (`notes.service.ts:429-431`) puis attaché à la tâche restée dans P1 (`:501-510`), après `deleteMany` des assignés existants.

### S12-g — `syncTaskStatusToNote` n'écrit plus dans la note d'un auteur sans accès

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `notes.service.ts` (`syncTaskStatusToNote`) recopiait titre et nom du projet dans la note sans vérifier que son auteur a encore `task.read`.
- **Preuve avant correctif** : tests S12-g sur le code non corrigé : **2 échecs sur 3** (auteur sans `Membership` : 1 `note.update` reçu au lieu de 0 ; membre sans rôle sur P1 : idem) ; le contrôle positif passait.
- **Changement** : après le chargement de la tâche, `policy.filterUsersWithProjectAction(task.projectId, [task.note.userId], 'task.read')` ; si l'auteur n'est pas renvoyé, sortie silencieuse (aucun `note.update`, aucune invalidation de cache, aucune erreur pour `updateTask`).
- **Tests** : `notes-access.spec.ts`, 3 tests S12-g (auteur `deprovisioned`, membre sans rôle, contrôle positif CONTRIBUTOR avec ligne `[x]` mise à jour). **Mutation** « vérification retirée » : 2 échecs. Après correctif : verts.
- **Écart par rapport au rapport** : aucun.
- **Questions pour l'architecte** : aucune.

#### Revue architecte (r14)

**VALIDÉ.** M10 (garde retirée) : 2 échecs. Sortie silencieuse, `updateTask` non affecté.

### S16-c — Test isolé de `RealtimeService.evictTaskRoom`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : aucun code de production. `tests/unit/authz/realtime.spec.ts` : 2 tests (« fait quitter le salon task:<id> » sur un serveur factice : `in('task:T1')` puis `socketsLeave('task:T1')` ; « sans serveur attaché : aucune exception »).
- **Preuve (mutation M7)** : `evictTaskRoom` remplacé par `return;` : **1 échec** (le test sur le serveur factice), 9 réussites ; restauré (`cmp` identique), 10/10.
- **Écart / questions** : aucun.

#### Revue architecte (r14)

**VALIDÉ.** M11 (`return;`, ex-M7) : 1 échec, alors qu'elle survivait en r13. S16 clos.

### O6 — Droits de la note calculés une fois par analyse

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `notes.service.ts` : `writableIds` est calculé au premier besoin (`??=`) puis réutilisé pour toutes les lignes de la note. **Piège évité** : un projet personnel créé en cours d'analyse est ajouté à `writableIds`, sinon deux lignes `#Perso` auraient créé deux projets (l'ancien calcul par ligne le retrouvait).
- **Tests** : `notes-access.spec.ts` « O6 » : 3 lignes `#Perso` : `listAccessibleProjectIds` appelé 1 fois, 1 seul `project.create`, 3 tâches créées. Vert.
- **Écart / questions** : aucun. Le calcul par assigné (`membership.findMany` dans `resolveAssignee`) n'est pas mis en cache (hors périmètre simple).

#### Revue architecte (r14)

**VALIDÉ.** M12 (projet personnel non ajouté au cache) : 1 échec. `resolveAssignee` sans cache : accepté (question 2).

### P4 — Script de reprise `grant-legacy-project-access.ts` (décision utilisateur du 2026-11-03)

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : nouveau `backend/scripts/grant-legacy-project-access.ts`. Par défaut, rapport seul (aucune écriture) ; `--apply` accorde CONTRIBUTOR aux MEMBER et CLIENT aux VIEWER (`createMany` avec `skipDuplicates`, dans une transaction) sur les projets non supprimés des workspaces non supprimés où ils n'ont aucune `ProjectMembership`. Ignorés : OWNER/ADMIN, comptes sans `Membership`, projets personnels, projets supprimés, rôles déjà présents (jamais modifiés). CSV (`reprise-phase0/…`, droits 600) : identifiants et rôles seulement, aucune adresse e-mail. Calcul pur `planLegacyGrants`, lignes CSV `grantsToCsvRows`.
- **Tests** : `tests/unit/scripts/grant-legacy-project-access.spec.ts` (6, Prisma simulé) : dry-run sans écriture ; `--apply` (5 accès créés, rôles existants intacts) ; exclusions ; idempotence (seconde exécution : 0) ; pas de doublon ; CSV sans `@`. Verts.
- **Jamais exécuté** contre une base réelle (ni en dry-run).
- **Écart par rapport au rapport** : la notion de « Membership active » = existence de la ligne (le modèle n'a pas de drapeau d'activité ; la désactivation SCIM supprime la `Membership`).
- **Runbook** : § 2 (usage) et § 5.

#### Revue architecte (r14)

**À REPRENDRE (petit, non sécuritaire).** Revue de sûreté conforme : mode rapport par défaut, jeton `--apply` exact, une seule écriture (`createMany` + `skipDuplicates` sur `@@unique([projectId, userId])`), aucun `update`/`upsert`/`delete`, idempotent, CSV sans adresse (droits 600, `reprise-phase0/` ignoré par git). Mutations détectées : P4-1 (écriture en mode rapport), P4-2 (rôles existants), P4-8 (adresse dans le CSV). **Survivantes** : P4-3 (`OWNER` ajouté au mapping), P4-4 (filtre `role`/`workspace.deletedAt` retiré de la requête), P4-5 (`deletedAt` retiré de `project.findMany`), parce que le faux Prisma refait lui-même ces filtres. À faire : faux Prisma qui évalue les `where`, ou assertions sur les arguments, plus un test pur avec OWNER/ADMIN ; exclure le créateur du projet pour concorder avec la requête SQL du runbook § 2 ; facultatif : `timeout` de la transaction. « Membership active » = existence de la ligne : confirmé (question 3).

### Décisions produit tranchées par l'utilisateur le 2026-11-03

- **P4** : règle stricte confirmée (aucun accès implicite), script ci-dessus. **`timelog.read`** : réservé à MANAGER et CONTRIBUTOR, confirmé, aucun changement de code. **DTO IA** (`ai/execute`) : strict, confirmé, aucun changement de code.
- Les trois passent de « en attente » à « tranchées par l'utilisateur le 2026-11-03 » (runbook § 5, ce journal). Cela ne vaut pas validation de la phase. `GEMINI.md` indique toujours « Prochaine phase : Phase 3 » et n'affirme aucune validation : non modifié.

### Runbook § 4.2

- **Statut** : `CORRIGÉ – À REVOIR`. `docs/security/runbook-phase3.md` § 4.2 : paragraphe « Reprise r12 et r13 » (tag `#Projet` borné aux projets de l'auteur où il écrit, projet personnel homonyme, tâche sans accès ou de projet supprimé non modifiée, plus de changement de workspace par une note, note d'un auteur sans accès non synchronisée, assigné IA sans accès ignoré, optimisation de charge sans candidat, éviction `task:<id>`).

#### Revue architecte (r14)

**VALIDÉ**, avec une ligne à ajouter pour S12-i après le correctif.

## Résultats (r13)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **75/75 suites, 2213/2213 tests** (r12 : 74 et 2196 ; +1 suite, +17 tests : S12-h 5, S12-g 3, O6 1, S16-c 2, script 6) |
| `npx nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 122 `.js` ; 0 `*.spec.js` |
| `npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `npx eslint src tests scripts` | 0 erreur, 17 avertissements |
| `npx prettier --check src tests scripts` | conforme |
| `npx prisma validate` | valide |
| `npx jest tests/integration --detectOpenHandles` | 1 suite, 4/4, aucun handle ouvert |
| Frontend `pnpm test:run` | 15 fichiers, 59/59 |
| Frontend `tsc --noEmit -p .` ; `eslint src` ; `vite build` | exit 0 ; 0 erreur (36 avertissements) ; built in 7.49s |
| `git stash list` | vide (0 entrée) |
| `git status --short` | 85 entrées (frontend : aucune) |

Aucune migration, aucun changement d'API ni de frontend.

## Points ouverts pour l'architecte (r13)

1. **S12-h, projet personnel vers workspace et inverse** : refusé comme un changement de workspace. Le rapport ne le précise pas ; confirmer (une ligne sans tag ne sort plus une tâche de son projet de workspace vers « Inbox »).
2. **O6** : `resolveAssignee` interroge encore `membership.findMany` par assigné ; non mis en cache.
3. **P4, script** : accorde CONTRIBUTOR sur tous les projets du workspace aux MEMBER, ce qui reproduit l'ancien périmètre (large). Le rapport avant `--apply` permet à l'utilisateur d'en juger. Non exécuté.
4. Hors périmètre, non traités : Q-2, complément S17, `ws`/S25.
5. Toutes les entrées r13 sont en `CORRIGÉ – À REVOIR` ; aucune n'est marquée `VALIDÉ`.

## Revue architecte r14 (2026-11-03) : NON VALIDÉ

Détail dans `rapport-audit.md`, section « Revue r14 ». Les chiffres de « Résultats (r13) » sont exacts : 75/75 suites et 2213 tests ; build sans `*.spec.js` ; `tsc` (build) 0 ; TS6059 inchangée ; ESLint 0 erreur et 17 avertissements ; `prettier` et `prisma validate` OK ; intégration 4/4 sans handle ouvert ; frontend vert et inchangé. `git stash list` vide, 85 entrées, diff identique avant et après la revue.

- S12-h, S12-g, S16-c, O6 : **VALIDÉ** (mutations M8 à M12 détectées). Runbook § 4.2 : validé.
- **Nouveau constat S12-i** (Moyen, bloquant, régression de S12-h, prouvé) : quand le déplacement est refusé, l'assigné proposé par l'IA est résolu dans le projet refusé (autre workspace) et attaché à la tâche restée dans W, après suppression de ses assignés.
- Script P4 : **À REPRENDRE** (petit). Il est sûr par construction, mais trois exclusions ne sont pas testées (P4-3, P4-4 et P4-5 survivent) et le créateur n'est pas exclu, alors que la requête SQL du runbook l'exclut.
- Décisions produit tranchées par l'utilisateur le 2026-11-03 : prises en compte. `permissions.ts:11-13` à mettre à jour.
- Réponses : 1 confirmé (égalité stricte) ; 2 accepté (pas de cache) ; 3 confirmé, créateur à exclure ; 4 confirmé hors périmètre.

**Constats encore ouverts (pour relancer `fixeur`), dans l'ordre :** S12-i ; P4 (tests d'exclusion du script, exclusion du créateur) ; documentation (`permissions.ts`, runbook § 2 et § 4.2) ; clôture « Résultats (r14) ». Facultatif : O7 (projet personnel vide créé sur un déplacement refusé), délai de transaction du script.

## Actions de la revue r14

### S12-i — Assigné résolu contre le projet effectif de la tâche

- **Statut** : `CORRIGÉ – À REVOIR`.
- **Changement** : `backend/src/notes/notes.service.ts` : `resolveAssignee` n'est plus appelé avant la décision de déplacement. Un helper local `resolveFor(target)` est appelé dans chaque branche : tâche existante, avec `projectChanged ? project : { id: existingTask.projectId, workspaceId: existingTask.project?.workspaceId ?? null }` ; création (marqueur périmé, ou sans marqueur) avec `project`. La branche « tâche non écrivable » n'assigne toujours rien. Quand l'assigné n'est pas valide sur le projet effectif, `assigneeId` est nul et les assignations existantes ne sont pas touchées (pas de `deleteMany`).
- **Tests** : `backend/tests/unit/authz/notes-access.spec.ts`, bloc « S12-i » (3 tests, critères 1 à 3). **Échec avant correctif** (consigné) : critère 1 en échec (`taskAssignee.create` reçu avec `{ taskId: 'TC', userId: 'u-outsider' }`), critère 2 en échec aussi (assigné COMMENTER de P1 non retenu car résolu contre le projet refusé), critère 3 vert (déjà correct). Après correctif : 3/3. **Mutation** (existant : toujours `project`) : 2 échecs (critères 1 et 2) ; fichier restauré, `cmp` identique. (Une première mutation écrite `true ? …` ne compilait pas, 0 test exécuté ; refaite avec `projectChanged || !projectChanged`.)
- **Écart par rapport au rapport** : aucun.
- **Questions** : aucune.

#### Revue architecte (r15)

**VALIDÉ.** Code conforme : `resolveFor` est appelé après la décision de déplacement dans les trois branches, et il n'y a ni `deleteMany` ni `create` si l'assigné est nul. Mutations rejouées : R1 (toujours `project`) 2 échecs, R2 (`deleteMany` inconditionnel) 2 échecs, R3 (`workspaceId` du projet visé) 1 échec. La mutation `projectChanged || !projectChanged` ne reste nulle part dans l'arbre.

### P4 (script) — tests d'exclusion effectifs, créateur exclu, délai de transaction

- **Statut** : `CORRIGÉ – À REVOIR`. Script jamais exécuté.
- **Changement** : `backend/scripts/grant-legacy-project-access.ts` : `planLegacyGrants` ignore `project.userId === m.userId` ; `project.findMany` sélectionne `userId` ; `$transaction(…, { timeout: 120_000 })`. En-tête du script mis à jour.
- **Tests** : `backend/tests/unit/scripts/grant-legacy-project-access.spec.ts` : le faux Prisma évalue les `where` reçus (`matches` : null, `in`, relation `workspace`, opérateur inconnu = erreur) sur des données contenant les cas exclus ; ajout de : créateur non concerné, `toHaveBeenCalledWith` sur `membership.findMany` et `project.findMany`, délai de transaction, calcul pur OWNER/ADMIN, calcul pur créateur. 11/11.
- **Mutations** (une seule à la fois, sauvegarde `/bin/cp -f`, restauration, `cmp`) :
  - P4-3 `OWNER: 'CONTRIBUTOR'` au mapping : 1 échec (calcul pur OWNER/ADMIN).
  - P4-4 `where: {}` sur `membership.findMany` : 4 échecs ; filtre `workspace.deletedAt` seul retiré : 4 échecs.
  - P4-5 `deletedAt: null` retiré de `project.findMany` : 4 échecs.
  - Créateur non exclu : 4 échecs. `timeout` retiré : 1 échec.
- **Écart** : l'effet des décomptes : le rapport donne maintenant 4 accès sur le jeu de test (au lieu de 5), `member` ayant créé P1.

#### Revue architecte (r15)

**VALIDÉ.** P4-3 : 1 échec ; P4-4 (`where: {}`) : 4 ; P4-4b (`workspace.deletedAt`) : 4 ; P4-4c (`role`) : 1 ; P4-5 : 4 ; créateur non exclu : 4 ; `userId` perdu dans `scoped` : 3 ; `userId` retiré du `select` : erreur de compilation ; `timeout` retiré : 1 ; P4-1 : 1 ; P4-2 : 2. Écart sur les décomptes (4 accès au lieu de 5) : accepté, c'est l'effet voulu. Script jamais exécuté.

### Documentation

- **Statut** : `CORRIGÉ – À REVOIR`. `backend/src/authz/permissions.ts` (commentaire : P4 tranchée le 2026-11-03, règle stricte, script optionnel) ; `docs/security/runbook-phase3.md` § 2 (créateur exclu, décomptes concordants avec la requête SQL) et § 4.2 (ligne S12-i).

#### Revue architecte (r15)

**VALIDÉ.** `permissions.ts:9-13`, runbook § 2 (l. 39) et § 4.2 (l. 90) : présents et exacts. S12-j demandera une ligne de plus au § 4.2.

### O7 — projet personnel vide sur un déplacement refusé

- **Statut** : `NON TRAITÉ` (facultatif). Le projet cible est créé avant la lecture de la tâche existante ; l'éviter demande de réordonner la résolution du projet par ligne, ce qui touche tous les chemins (création, O6). Risque disproportionné pour un effet cosmétique ; proposé pour une phase ultérieure.

#### Revue architecte (r15)

**Report accepté.** O7 reste ouvert en Amélioration, hors Phase 3 (avec A5 ou en Phase 4).

## Résultats (r14)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **75/75 suites, 2221/2221 tests** (r13 : 2213 ; +8 : S12-i 3, script 5) |
| `npx nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 122 `.js` ; 0 `*.spec.js` |
| `npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `npx eslint src tests scripts` | 0 erreur, 17 avertissements |
| `npx prettier --check src tests scripts` | conforme |
| `npx prisma validate` | valide |
| `npx jest tests/integration --detectOpenHandles` | 1 suite, 4/4, aucun handle ouvert |
| Frontend `pnpm test:run` | 15 fichiers, 59/59 |
| Frontend `tsc --noEmit -p .` ; `eslint src` ; `pnpm build` | exit 0 ; 0 erreur (36 avertissements) ; built in 4.51s |
| `git stash list` | vide (0 entrée) |
| `git status --short` | 85 entrées avant et après (frontend : aucune) |

Aucune migration, aucun changement d'API ni de frontend.

## Points ouverts pour l'architecte (r14)

1. Toutes les entrées r14 sont en `CORRIGÉ – À REVOIR` ; aucune n'est marquée `VALIDÉ`.
2. O7 non traité (voir ci-dessus) : accepter le report ?
3. Le script P4 exclut le créateur : le rapport ne contient plus les couples (créateur MEMBER, son projet). Aucun accès perdu (le créateur est MANAGER par `project.userId`).
4. Hors périmètre, non traités : Q-2, complément S17, `ws`/S25.

## Revue architecte r15 (2026-11-04) : NON VALIDÉ

Détail dans `rapport-audit.md`, section « Revue r15 ». Les chiffres de « Résultats (r14) » sont exacts : 75/75 suites et 2221 tests ; build sans `*.spec.js` (122 `.js`) ; `tsc` (build) 0 ; TS6059 inchangée ; ESLint 0 erreur et 17 avertissements ; `prettier` et `prisma validate` OK ; intégration 4/4 sans handle ouvert ; frontend vert et inchangé. `git stash list` vide, 85 entrées, diff et fichiers non suivis identiques avant et après la revue. L'arbre est cohérent malgré la perte du scratchpad : aucun reste de mutation, aucun fichier de sauvegarde, aucun fichier attendu manquant.

- S12-i, script P4 et documentation : **VALIDÉ**. O7 : **report accepté**.
- **Nouveau constat S12-j** (Moyen, CVSS 5.4, bloquant, défaut antérieur à la Phase 3, prouvé) : `deleteNote` (`notes.service.ts:162-190`, `updateMany` à la ligne 173) met `deletedAt` sur toutes les tâches liées à la note sans contrôle `task.write`. Un auteur rétrogradé COMMENTER ou CLIENT, retiré du projet ou désactivé par SCIM peut ainsi supprimer ses tâches d'un projet de workspace. Remédiation et critères 1 à 6 : voir le rapport.
- Non bloquants : O8 (`deleteNote` n'émet aucun événement Firestore pour les tâches supprimées) ; P10 (le créateur reste MANAGER même rétrogradé VIEWER, décision produit à poser en Phase 4).
- Réponses : 1, O7 reporté (accepté) ; 2, créateur MANAGER par `project.userId` dans les trois chemins de la politique (confirmé) ; 3, hors périmètre (confirmé) ; 4, A2 se ferme avec S12-j et non avec S12-i.
- La liste des fichiers du futur commit de Phase 3 et le message proposé sont dans le rapport, pour l'utilisateur, après validation seulement.

**Constats encore ouverts (pour relancer `fixeur`), dans l'ordre :** S12-j ; clôture « Résultats (r15) ». Facultatif : O8.

## Actions de la revue r15

### S12-j — `deleteNote` ne supprime que les tâches où l'auteur a encore `task.write`

- **Statut** : `CORRIGÉ – À REVOIR`.
- **Changement** : `backend/src/notes/notes.service.ts` (`deleteNote`) : `writable = await this.policy.listAccessibleProjectIds(userId, { action: 'task.write' })` (inclut les projets personnels) puis `tx.task.updateMany({ where: { noteId, projectId: { in: writable } }, … })`. La note est supprimée dans tous les cas, sans erreur. `docs/security/runbook-phase3.md` § 4.2 : ligne S12-j.
- **Tests** : `backend/tests/unit/authz/notes-access.spec.ts`, bloc « S12-j » (3 tests, vrai `PolicyService`, faux `updateMany` qui évalue le `where` reçu sur `prisma.data.tasks` et rejette toute clé inconnue). Critère 1 : COMMENTER de P1, T9 (P1) conservée, T10 (projet personnel) supprimée, note supprimée. Critère 2 : `USERS.deprovisioned`, sa tâche de P1 conservée. Critère 3 : CONTRIBUTOR de P1, tâche supprimée.
- **Échec avant correctif (consigné)** : critères 1 et 2 en échec (`deletedAt` de T9 était une `Date` au lieu de `null`), critère 3 vert. 23 verts, 2 échecs sur 25.
- **Mutation** (`where: { noteId }` rétabli ; sauvegarde `/bin/cp -f` hors dépôt, restauration, `cmp` identique) : 2 échecs (critères 1 et 2).
- **Écart par rapport au rapport** : aucun.
- **Questions** : aucune.

#### Revue architecte (r16)

**VALIDÉ.** Code relu (`notes.service.ts:162-196` ; `writable` à la ligne 170, `updateMany` aux lignes 176-179). `listAccessibleProjectIds` (sans `workspaceId`) inclut les projets personnels (`{ userId, workspaceId: null }`), exclut les projets supprimés et exige une `Membership` pour toute branche de workspace. `Task.projectId` est non nul : aucune tâche n'échappe au filtre `in`. Note toujours supprimée, aucune erreur, API inchangée. Les 6 critères sont tenus : critères 1 à 3 dans le bloc « S12-j » de `notes-access.spec.ts` (vrai `PolicyService`, faux `updateMany` qui évalue le `where` et rejette toute clé inconnue) ; critère 4 consigné ci-dessus ; critère 5 rejoué ; critère 6 au runbook § 4.2, ligne 91. Mutations rejouées par l'architecte, une par une (sauvegarde `/bin/cp -f` hors dépôt, restauration, `cmp` « restored ») :

| Mutation | Résultat |
| --- | --- |
| M1 : `where: { noteId }` rétabli (critère 5) | 2 échecs (critères 1 et 2) |
| M2 : `task.write` remplacé par `task.read` | 1 échec (critère 1) |
| M3 : `workspaceId: 'ws-1'` ajouté (projets personnels exclus) | 1 échec (critère 1, T10 non supprimée) |
| M4 : `note.update` retiré | 2 échecs |
| M5 : `in: []` (rien supprimé) | 2 échecs (critères 1 et 3) |

Remarque non bloquante : `writable` est calculé hors de la transaction. La fenêtre de concurrence est négligeable, et c'est le même schéma que dans `parseTasksFromContent`.

### O8 — événements Firestore `delete` pour les tâches supprimées par `deleteNote`

- **Statut** : `NON TRAITÉ` (facultatif, report motivé). `taskSyncPayload` est privé à `TasksService` (et `sprint.service.ts` a sa propre copie du mécanisme) ; l'utiliser depuis `NotesService` demande soit une troisième copie, soit l'extraction d'un helper partagé, plus un `findMany` avec assignés avant le `updateMany` dans la transaction. Ce n'est pas trivial ni sans risque pour une clôture ; à traiter en Phase 4 avec O7/A5.

#### Revue architecte (r16)

**Report accepté** (Amélioration, Phase 4). Le motif est fondé : il faudrait une troisième copie de `taskSyncPayload` (privé à `TasksService`, déjà dupliqué dans `sprint.service.ts`) ou l'extraction d'un helper partagé. Ce ne serait pas trivial. Impact limité à la cohérence du miroir Firestore : la source de vérité MySQL est correcte, et il n'y a aucun accès indu. À faire en Phase 4 : extraire un helper `taskSyncPayload` partagé (tâches, sprints, notes), puis émettre un événement `delete` pour chaque tâche réellement supprimée par `deleteNote`, c'est-à-dire les tâches filtrées par `writable` (lecture `findMany` dans la transaction, avant `updateMany`).

## Résultats (r15)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **75/75 suites, 2224/2224 tests** (r14 : 2221 ; +3 : S12-j) |
| `npx nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 122 `.js` ; 0 `*.spec.js` |
| `npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `npx eslint src tests scripts` | 0 erreur, 17 avertissements |
| `npx prettier --check src tests scripts` | conforme |
| `npx prisma validate` | valide |
| `npx jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| Frontend `pnpm test:run` | 15 fichiers, 59/59 |
| Frontend `tsc --noEmit -p .` ; `eslint src` ; `pnpm build` | exit 0 ; 0 erreur (36 avertissements) ; built in 4.82s |
| `git stash list` | vide (0 entrée) |
| `git status --short` | 85 entrées (aucun nouveau fichier ; frontend : aucune) |

Aucune migration, aucun changement d'API ni de frontend.

## Points ouverts pour l'architecte (r15)

1. S12-j en `CORRIGÉ – À REVOIR` ; A2 peut se fermer avec lui (dernier chemin d'écriture des notes passé par `PolicyService`).
2. O8 non traité (report motivé ci-dessus) : accepter le report en Phase 4 ?
3. Aucun nouveau fichier : la liste de commit de Phase 3 reste inchangée.
4. Hors périmètre, non traités : O7, P10, Q-2, complément S17, `ws`/S25.

## Revue architecte r16 (2026-11-04) : VALIDÉ — Phase 3 close côté code

Détail dans `rapport-audit.md`, section « Revue r16 ». Les chiffres de « Résultats (r15) » sont exacts et ont été relancés par l'architecte : 75/75 suites et 2224/2224 tests ; `nest build` exit 0 (122 `.js`, 0 `*.spec.js`) ; `tsc` (build) 0 ; TS6059 seule et inchangée ; ESLint 0 erreur et 17 avertissements ; `prettier` et `prisma validate` OK ; intégration 4/4 sans handle ouvert ; frontend (15 fichiers, 59/59 ; `tsc` 0 ; ESLint 0 erreur ; build OK) inchangé. `git stash list` vide, 85 entrées. Diff (`6ef3c74d…`), statut et empreintes des 26 fichiers non suivis : identiques avant et après les mutations.

- **S12-j : VALIDÉ** (6 critères tenus ; mutations M1 à M5 détectées). **A2 : VALIDÉ, fermé.** Plus aucun chemin d'écriture du module des notes ne passe hors `PolicyService`.
- **O8 : report en Phase 4 accepté.**
- Relecture finale de tous les chemins d'écriture Prisma des services modifiés en Phase 3 : aucun contournement de `PolicyService`. Les méthodes sans garde locale sont gardées par leur contrôleur (`assertWorkspaceAccess`, qui délègue à la politique), bornées au propriétaire, ou ce sont des chemins système déjà validés (webhook signé, cron, SCIM, SSO).
- Nouveau constat non bloquant : **O9** (documentation). Le DAT § 12 (lignes 81, 690 et 703) décrit encore `notifications.gateway.ts`, supprimé en Phase 3. À mettre à jour en Phase 4.
- `GEMINI.md` (section « État ») et DAT § 15.1 (ligne Phase 3) mis à jour par l'architecte, comme aux clôtures précédentes.
- Hors périmètre, confirmé : O7, O8, O9, P10, Q-2, complément S17, `ws`/S25 (Phases 4 à 6).

**Constats encore ouverts pour `fixeur` en Phase 3 :** aucun. Le commit relève de l'utilisateur (liste et message dans le rapport, section « Revue r16 »).

---

## Plan de correction : Phase 4

Base de départ (mesurée avant toute modification) : backend 75 suites / 2224 tests verts ; frontend 15 fichiers / 59 tests verts. Ordre du rapport : **P4, S17, S18**, puis les reports (O7, O8, O9, P10). Méthode inchangée : test d'abus qui échoue d'abord (échec consigné), correctif minimal, suites complètes. Aucune base réelle, aucun commit, aucun `git stash`, `.claude/` intact.

| Ordre | ID | Contenu | Fichiers (prévision) | Migration |
| --- | --- | --- | --- | --- |
| 4.1 | P4 | Matrice RBAC écrite (`docs/security/matrice-rbac.md`), commentaire de `permissions.ts` mis à jour | `docs/security/matrice-rbac.md`, `authz/permissions.ts` | Aucune |
| 4.2 | S17 | Invitation nominative liée à l'e-mail ; OWNER non invitable ; rôle invité ≤ rôle de l'invitant (revérifié à l'acceptation) ; invitation projet = membership workspace `VIEWER` + `projectRole` explicite ; `durationDays` ≤ 30 ; acceptation atomique (`updateMany` PENDING et non expirée, `count === 1`) ; lien anonyme restreint à un projet, rôle ≤ MEMBER, usage unique | `invitations.service.ts`, `invitations.controller.ts`, `dto/create-invitation.dto.ts`, `schema/workspace.prisma`, migration, frontend `ProjectMembersPanel.tsx` / `AppContext.tsx` | `Invitation.projectRole` (nullable) |
| 4.3 | S17 (suite) | `assignProjectRole` : DTO, cible membre du workspace du projet, `MANAGER` réservé à OWNER/ADMIN ; SCIM `DELETE` purge les `ProjectMembership` du workspace | `project-permissions.service.ts`, `projects.controller.ts`, `dto/assign-project-role.dto.ts`, `scim.service.ts` | Aucune |
| 4.4 | S18.1 | `@PlatformRoles()` ; `updateUserRole` et `impersonate` réservés à SUPER_ADMIN ; pas de modification de son propre rôle ; pas d'impersonation d'un compte `platformRole` | `admin/platform-roles.decorator.ts`, `platform-admin.guard.ts`, `admin.controller.ts`, `admin.service.ts` | Aucune |
| 4.5 | S18.2-bis | `@ForbiddenInImpersonation()` sur invitations, membres de projet, clés SCIM, SSO, intégrations ; test méta étendu | contrôleurs concernés, `impersonation-routes.spec.ts` | Aucune |
| 4.6 | S18.3 | MFA obligatoire pour `platformRole` ; plafond de session 12 h ; motif d'impersonation obligatoire (DTO 10..500) ; révocation de la session de l'administrateur à l'impersonation ; frontend (motif) | `platform-admin.guard.ts`, `session.service.ts`, `admin.service.ts`, `admin.controller.ts`, `dto/admin.dto.ts`, `AdminConsole.tsx` | Aucune |
| 4.7 | O8, O7 | Helper `taskSyncPayload` partagé ; événement `delete` par tâche supprimée dans `deleteNote` ; O7 : projet personnel vide (voir entrée) | `projects/task-sync-payload.ts`, `tasks.service.ts`, `sprint.service.ts`, `notes.service.ts` | Aucune |
| 4.8 | O9, P10 | DAT : `notifications.gateway` remplacé par `RealtimeService` ; P10 posé comme question produit | `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` | Aucune |

### Décisions produit retenues (à arbitrer, voir « Points ouverts pour l'architecte (Phase 4) »)

1. **GUEST ou VIEWER** : `VIEWER` (aucune migration d'énumération). Avec la règle stricte de P4 (aucun accès implicite aux projets), un VIEWER sans `ProjectMembership` ne voit aucun projet. Un rôle `GUEST` n'ajouterait de restriction que sur la lecture du workspace lui-même.
2. **Lien anonyme** : usage unique (le statut passe à `ACCEPTED` à la première acceptation), projet obligatoire, rôle projet ≤ CONTRIBUTOR, rôle workspace forcé à `VIEWER`. Pas de champ `maxUses` (option la plus restrictive, sans migration).
3. **MANAGER attribuable par un MANAGER** : non (recommandation du rapport) : réservé à OWNER/ADMIN du workspace.
4. **P10** : posé en question, comportement actuel inchangé.

### Entrées par constat (Phase 4)

### P4 — Matrice RBAC écrite

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `docs/security/matrice-rbac.md` (nouveau) : rôles de workspace, de projet et de plateforme, actions × rôles (recopiées de `permissions.ts`), règles d'invitation, décisions produit retenues et en attente. `backend/src/authz/permissions.ts:10` renvoie vers elle. Aucun changement de comportement.
- **Tests** : aucun nouveau ; la matrice est déjà exécutée par `tests/http/rbac-matrix.spec.ts` (982 cas).
- **Écart** : la matrice est une documentation d'un état de code déjà tranché (P4 règle stricte, 2026-11-03) ; les décisions nouvelles de la Phase 4 y sont marquées « par défaut, à confirmer ».
- **Questions** : voir « Points ouverts pour l'architecte (Phase 4) ».

### S17 — Invitations

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `invitations.service.ts` (avant) : aucune comparaison `invitation.email` / `loggedUser.email` ; rôle `OWNER` et rôle supérieur à celui de l'invitant acceptés ; invitation de projet = `Membership` workspace au rôle de l'invitation (ADMIN possible) ; `durationDays` sans maximum ; statut lu hors transaction puis `update` inconditionnel (double acceptation) ; lien anonyme possible sans projet.
- **Changement** :
  - `projects/invitations.service.ts` : `createInvitation` (OWNER jamais invitable, 403 ; rôle <= rôle de l'invitant, 403 ; `durationDays` 1..30, 400 ; e-mail normalisé en minuscules ; invitation de projet = rôle workspace forcé à `VIEWER` et `projectRole` explicite, `CLIENT` par défaut ; lien anonyme réservé à un projet et refusé pour `MANAGER`, 400). `validateAndAcceptInvitation` : adresse comparée sans tenir compte de la casse (403), invitation `OWNER` refusée (403), invitant relu (doit rester OWNER/ADMIN avec un rôle >= celui proposé, sinon 400), puis dans une transaction : `updateMany({ id, status: PENDING, expiresAt: { gt: now } })` avec contrôle `count === 1`, création de la `Membership` (VIEWER pour un projet), `ProjectMembership` créée ou relevée, jamais rétrogradée.
  - `projects/dto/create-invitation.dto.ts` : `role` optionnel, `projectRole` (`IsEnum(ProjectRole)`), `durationDays` `@Max(30)`.
  - `projects/invitations.controller.ts` : transmet `projectRole` ; `@ForbiddenInImpersonation()` sur la création.
  - `prisma/schema/workspace.prisma` : `Invitation.projectRole ProjectRole?` ; migration `20261112000000_s17_invitation_project_role` (colonne nullable, `VIEWER` pour les invitations de projet en attente, `REVOKED` pour les invitations `OWNER` en attente).
  - Frontend : `AppContext.tsx` et `ProjectMembersPanel.tsx` envoient `role: 'VIEWER'` et le `projectRole` choisi.
- **Tests** : `tests/unit/projects/invitations-security.spec.ts` (18, faux Prisma en mémoire qui évalue `status` et `expiresAt`). **Avant correctif : 13 échecs sur 16** (les 3 verts sont des contrôles : casse de l'e-mail, ADMIN invite ADMIN, usage unique par statut) ; les 2 tests de DTO ont été ajoutés ensuite. Après : 18/18. `invitations.service.spec.ts` (9) : 2 tests d'acceptation réécrits pour le nouveau déroulé (le service lit désormais l'invitant et utilise `updateMany`).
- **Écarts par rapport au rapport** :
  1. **Ajout** : revérification de l'invitant à l'acceptation (un administrateur déprovisionné ne laisse pas de liens actifs) et refus des lignes `OWNER` héritées. Plus restrictif que le rapport, sans migration.
  2. **GUEST ou VIEWER** : `VIEWER` retenu (aucune migration d'énumération) ; avec la règle stricte de P4, un VIEWER sans `ProjectMembership` ne voit aucun projet.
  3. **`maxUses`** non ajouté : un lien anonyme est à usage unique (option permise par le rapport : « ou à usage unique »).
  4. Le rôle demandé est **ignoré** (forcé à VIEWER) pour une invitation de projet, au lieu d'être refusé : le frontend historique n'échoue pas, et le résultat est le plus restrictif.
  5. **Changement cassant** : un lien anonyme d'espace de travail (sans projet) n'est plus créable ; l'ancienne UI ne l'offrait que depuis le panneau de projet.
- **Questions** : voir « Points ouverts pour l'architecte (Phase 4) » (1, 2, 5).

### S17 (suite) — `assignProjectRole` et SCIM `DELETE`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `project-permissions.service.ts:33-78` (avant) : `upsert` pour n'importe quel `targetUserId` de la plateforme ; `projects.controller.ts` : corps de type littéral, donc non validé ; `scim.service.ts` `deleteUser` : ne retirait que la `Membership`.
- **Changement** :
  - `projects/dto/assign-project-role.dto.ts` (nouveau, `@IsUUID`, `@IsEnum(ProjectRole)`) ; `projects.controller.ts` l'utilise, et `@ForbiddenInImpersonation()` est posé sur `POST :id/members` et `DELETE :id/members/:userId`.
  - `ProjectPermissionsService.assignProjectRole` : projet personnel refusé (403), cible membre du workspace du projet (sinon 403, rien écrit, aucun salon recalculé), rôle `MANAGER` réservé à OWNER/ADMIN du workspace (403).
  - `ScimService.deleteUser` : `projectMembership.deleteMany({ userId, project: { workspaceId } })` puis recalcul des salons (même après une suspension antérieure). `PATCH active=false` n'y touche pas (vérifié).
- **Tests** : `tests/unit/projects/assign-project-role.spec.ts` (7). **Avant correctif : 3 échecs** (cible d'un autre workspace, cible inexistante, MANAGER attribué par un MANAGER) ; les contrôles positifs et le DTO passent. `src/auth/scim/scim.service.spec.ts` : 3 tests ajoutés (DELETE purge, DELETE après suspension, PATCH conserve) ; **avant correctif : 3 échecs**, dont le contrôle PATCH pour une raison de fixture (`createdAt` absent, corrigée ensuite) ; les 2 tests DELETE échouaient bien faute d'appel à `deleteMany`.
- **Effet de bord corrigé** : la matrice HTTP S12-d envoyait des identifiants non UUID (`u-member`) ; `tests/support/rbac-fixture.ts` utilise désormais des UUID v4, et `notifications-access.spec.ts` dérive les noms de la clé de `USERS`. Suites inchangées en nombre : 982 cas matrice, tous verts.
- **Écart** : un MANAGER peut encore rétrograder un autre MANAGER (`assign` d'un rôle inférieur) ou le retirer (`remove`) ; le rapport ne demande que l'attribution de MANAGER. Voir point ouvert 3.

### S18.1 — `@PlatformRoles`, auto-modification, cible de plateforme

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `platform-admin.guard.ts` (tout `platformRole` non nul passe) ; `admin.service.ts` `updateUserRole` et `impersonateUser` sans contrôle du rôle de l'acteur ni de la cible.
- **Changement** : `admin/platform-roles.decorator.ts` (nouveau) ; `PlatformAdminGuard` lit les rôles exigés via `Reflector` (poignée puis classe) ; `@PlatformRoles('SUPER_ADMIN')` sur `PATCH users/:id/role` et `POST users/:id/impersonate` ; `AdminService` relit le rôle de l'acteur en base (défense en profondeur), interdit de modifier son propre rôle (le contrôle « dernier super administrateur » devient sans objet : l'acteur reste toujours SUPER_ADMIN) et d'impersonner un compte de plateforme (soi-même compris).
- **Tests** : `tests/http/admin-platform-roles.spec.ts` (11, HTTP réel) ; `src/admin/admin.service.spec.ts` (+9) ; `platform-admin.guard.spec.ts` (+3). **Avant correctif (HTTP) : 8 échecs sur 11** (rôle, impersonation, MFA, motif). Les tests unitaires du service et du garde ont été écrits avec le correctif (pas d'état « avant » mesuré), la preuve de l'échec est portée par le test HTTP.

### S18.2-bis — Routes d'accès persistant interdites en impersonation

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `@ForbiddenInImpersonation()` sur `POST workspaces/:id/invitations`, `POST|DELETE projects/:id/members`, `POST workspaces/:id/scim/keys`, `POST|DELETE workspaces/:id/sso`, `POST workspaces/:id/sso/verify-domain`, `POST workspaces/:id/integrations`. Il n'existe pas de route de suppression de workspace ni de changement de rôle de workspace (vérifié : seuls `membership.delete` de SCIM et `workspace.deleteMany` de la purge des comptes non vérifiés).
- **Tests** : `tests/unit/auth/impersonation-routes.spec.ts` (60) : 8 gestionnaires ajoutés à la liste paramétrée et balayage méta étendu à `ScimController`, `InvitationsController` et `ProjectsController` avec filtre méthode + chemin. **Avant correctif : 10 échecs** (5 gestionnaires et 5 entrées du balayage ; invitations et membres de projet étaient déjà décorés par les étapes S17 précédentes, donc non comptés).
- **Écart** : non décorés, car ils ne créent aucun accès : `GET` des invitations, `DELETE invitations/:id`, `DELETE scim/keys/:keyId`, `POST integrations/:id/toggle`, `DELETE integrations/:id`, `POST integrations/:id/export` (envoi vers l'URL stockée). À arbitrer (point ouvert 7).

### S18.3 — MFA obligatoire, plafond de 12 h, motif et révocation de la session administrateur

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** :
  - `PlatformAdminGuard` : 403 « authentification à deux facteurs obligatoire » si `mfaEnabled` est faux, pour toute route `/admin/*`.
  - `session.service.ts` : plafond absolu de 12 h pour un compte portant `platformRole` (lu à chaque rafraîchissement, donc dès qu'un compte est promu) ; `PLATFORM_SESSION_ABSOLUTE_LIFETIME_SECONDS`.
  - `ImpersonateUserDto` : `reason` obligatoire, 10 à 500 caractères ; le contrôleur transmet `actor.sid` ; `AdminService.impersonateUser(actorId, targetId, reason, actorSid)` consigne le motif et l'identifiant de la session d'impersonation dans `PlatformAuditLog.metadata` et **révoque la session de l'administrateur** (`SessionService.revoke(actorSid)`).
  - `token.service.ts` : le jeton d'impersonation porte `act: { sub: adminId }` (RFC 8693) en plus de `impersonatedBy` ; à la vérification, `act` fait foi (`impersonatedBy` reconstruit).
  - Frontend `AdminConsole.tsx` : invite de motif (10 à 500 caractères) avant l'appel, sinon aucune requête.
- **Tests** : HTTP (voir S18.1) ; `tests/http/session-lifecycle.spec.ts` (+3) : **avant correctif 2 échecs sur 3** (13 h refusé, 11 h accepté avec refresh plafonné ; contrôle d'un compte ordinaire à 13 h) ; `tests/unit/auth/impersonation-token.spec.ts` (3) : **avant 2 échecs sur 3** (`exp - iat <= 900`, `act.sub`, reconstruction depuis `act`) ; `AdminConsole.spec.tsx` (+2) : **avant 2 échecs**.
- **Écarts** : (1) **audit des actions sous impersonation** : l'`AuditLog` des projets enregistre l'identité de la cible ; l'attribution à l'administrateur réel demande de propager `impersonatedBy` dans `logAction` (neuf appelants) et un champ au journal, ce qui relève de A8 (audit transactionnel unifié, Phase 6). Aujourd'hui, la preuve est le couple motif + `impersonationSessionId` du `PlatformAuditLog` et la durée de 15 min. (2) Le claim historique `impersonatedBy` est conservé (le garde et les tests l'utilisent).
- **Condition ferme maintenue** : `FEATURE_IMPERSONATION_ENABLED` reste désactivé par défaut ; l'architecte arbitre l'ouverture (S18 est clos côté code si cette revue est positive).

### O8 — Événements Firestore `delete` pour `deleteNote`

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `projects/task-sync-payload.ts` (nouveau, fonction `taskSyncPayload` extraite de `TasksService`, qui l'importe) ; `NotesService.deleteNote` lit dans la transaction, **avant** `updateMany`, les tâches réellement supprimées (même filtre `noteId`, `projectId in writable`, plus `deletedAt: null`), puis émet un événement `task` / `delete` par tâche, avec le workspace du projet (`personal-<userId>` pour un projet personnel) et les assignés.
- **Tests** : `notes-access.spec.ts` (+3, faux `findMany` qui évalue `noteId`, `projectId.in`, `deletedAt` et refuse toute autre clé). **Avant correctif : 2 échecs sur 3** (le troisième, « aucune tâche supprimée : aucun événement », est un contrôle). Les 3 tests S12-j existants sont inchangés (seul le faux `findMany` est ajouté).
- **Écart** : `sprint.service.ts` n'a **pas** été migré vers le helper : sa charge `{ id, projectId, sprintId, updatedAt }` est une mise à jour partielle volontaire (`upsert`), pas une copie du format complet ; la remplacer changerait le contenu écrit dans Firestore. À confirmer.

### O7 — Projet personnel vide sur un déplacement refusé

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `NotesService.parseTasksFromContent` : la création du projet personnel est différée (`ensureProject`). Elle n'a lieu que pour une nouvelle tâche, ou pour une tâche existante d'un projet personnel (déplacement permis). Une tâche de workspace dont le tag ne trouve aucun projet, ou dont l'auteur ne peut plus écrire, ne crée rien.
- **Tests** : `notes-access.spec.ts` (+4). **Avant correctif : 2 échecs sur 4** (2 contrôles positifs). Les suites S12-f, S12-h, S12-i et O6 restent vertes (28 tests, puis 32 avec O7 et O8).

### O9 — DAT : remplacement de la passerelle de notifications

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` : schéma (ligne 81) et § 13 (renommé « Diffusion Temps Réel & Mentions », sommaire mis à jour) décrivent `RealtimeService` : salons `project:`, `workspace:`, `user:`, `task:`, éviction `evictTaskRoom`, `refreshUserRooms`, contrôle de lecture à `join-task` ; l'encadré `notificationsGateway.server…` est remplacé par `realtimeService.emitToUser(…, 'new-notification', …)`.
- **Critère** : `grep -n "notifications.gateway" docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` ne renvoie rien (code de sortie 1, vérifié).

### P10 — Créateur MANAGER malgré un rôle de workspace VIEWER

- **Statut** : `À VALIDER PAR L'ARCHITECTE` (décision produit). Comportement inchangé : le créateur d'un projet reste MANAGER (`policy.service.ts`, `effectiveProjectRole`), conforme à la matrice actuelle et consigné dans `matrice-rbac.md`. Option plus restrictive (à n'activer que sur décision de l'utilisateur) : ne reconnaître le créateur MANAGER que si son rôle de workspace est au moins MEMBER.

## Résultats (Phase 4)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **79/79 suites, 2313/2313 tests** (base : 75 suites, 2224 tests ; +4 suites, +89 tests) |
| `npx jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| `npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `npx nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 0 `*.spec.js` |
| `npx eslint src tests scripts` | 0 erreur, 17 avertissements (identique à la base) |
| `npx prettier --check src tests scripts` | conforme |
| `npx prisma validate` | valide |
| `find backend/src backend/tests -name "*.js" -o -name "*.d.ts"` | vide |
| Frontend `npx vitest run` | 15 fichiers, **61/61** (base : 59) |
| Frontend `tsc --noEmit -p .` ; `eslint src` ; `vite build` | exit 0 ; 0 erreur, 36 avertissements (identique) ; built in 4.73s |
| `git stash list` | vide (0 entrée) ; `.claude/` jamais touché ; aucun commit |

Mutations : non rejouées par le fixeur en Phase 4 (le protocole d'échec avant correctif est consigné par entrée).

## Migrations et changements cassants (Phase 4)

- Migration `20261112000000_s17_invitation_project_role` (additive ; deux `UPDATE` sur les invitations **en attente** seulement). Procédure : `docs/security/runbook-phase4.md`. Non appliquée (aucune base).
- Cassants : liens anonymes d'espace de travail supprimés ; invitation nominative non transférable ; `POST /projects/workspaces/:id/invitations` accepte `projectRole` et ignore `role` pour un projet ; `POST /projects/:id/members` valide un UUID ; `POST /admin/users/:id/impersonate` exige `{ reason }` ; comptes `platformRole` sans MFA bloqués sur `/admin/*` ; sessions des comptes de plateforme plafonnées à 12 h.

## Points ouverts pour l'architecte (Phase 4)

Décisions produit prises par défaut, à faire arbitrer par l'utilisateur :

1. **GUEST ou VIEWER** pour un invité de projet : `VIEWER` retenu (pas de migration d'énumération). Un `GUEST` distinct n'aurait d'intérêt que pour cacher aussi `workspace.read`/`sprint.read` (membres, sprints) à un invité externe : à trancher.
2. **Plafond des liens anonymes** : usage unique, projet obligatoire, pas de MANAGER, pas de `maxUses`. Si l'utilisateur veut des liens réutilisables (équipes), ajouter `maxUses` et un compteur atomique.
3. **MANAGER attribuable par un MANAGER de projet** : non (recommandation du rapport). Question liée : un MANAGER peut-il rétrograder ou retirer un autre MANAGER ? Aujourd'hui oui (non couvert par le rapport) ; option : réserver ces deux actions à OWNER/ADMIN.
4. **P10** : le créateur reste MANAGER même rétrogradé VIEWER. Confirmer ou resserrer (voir l'entrée P10).
5. **Invitation de projet : `role` ignoré** (forcé à VIEWER) plutôt que refusé en 400 : confirmer.
6. **MFA des comptes de plateforme** : à activer avant le déploiement (runbook § 3), sinon l'accès `/admin/*` est coupé. Le compte d'amorçage de développement doit lui aussi avoir la MFA.
7. **Routes non décorées en impersonation** (`GET`/`DELETE` des invitations, révocation de clé SCIM, bascule, suppression et export d'une intégration) : ajouter le décorateur par précaution ou laisser, vu qu'elles ne créent aucun accès ?
8. **Audit des actions sous impersonation** : attribution à l'administrateur réel reportée à A8 (Phase 6).
9. **`sprint.service.ts`** : charge partielle volontaire, non migrée vers `taskSyncPayload` (écart O8).
10. **Ouverture de l'impersonation** : `FEATURE_IMPERSONATION_ENABLED` reste faux par défaut ; à l'architecte de déclarer S18 clos et à l'utilisateur de décider de l'activer.
11. **Frontend** : l'écran d'acceptation n'affiche pas de message dédié au 403 « autre adresse » (le message du serveur est repris tel quel) ; la console admin ne masque pas encore le sélecteur de rôle ni le bouton d'impersonation pour un `PLATFORM_ADMIN` (le serveur refuse en 403).

## Revue architecte r17 (2026-11-04) : NON VALIDÉ

Détail dans `rapport-audit.md`, section « Revue r17 ». Les chiffres de « Résultats (Phase 4) » sont exacts et ont été relancés par l'architecte :

- backend : 79/79 suites et 2313/2313 tests ; intégration 4/4 sans handle ouvert ;
- builds : `tsc` (build) 0 ; TS6059 seule et inchangée ; `nest build` exit 0 (125 `.js`, 0 `*.spec.js`) ;
- qualité : ESLint 0 erreur et 17 avertissements ; `prettier` et `prisma validate` OK ;
- frontend : 15 fichiers, 61/61 ; `tsc` 0 ; ESLint 0 erreur ; build OK.

Seule correction : `invitations.service.spec.ts` compte 9 tests, et non 25. 29 mutations rejouées : toutes détectées, sauf M3 (à couvrir, S17-a) et M5 (équivalente). Le diff (`1de96caa…`) et les empreintes des fichiers non suivis sont identiques avant et après.

#### Revue architecte (par entrée)

- **P4 (matrice) : VALIDÉ.**
- **S17 (invitations) : VALIDÉ.** **S17 (suite : `assignProjectRole`, SCIM `DELETE`) : VALIDÉ.**
- **S18.1 : VALIDÉ.** **S18.3 et révocation de la session administrateur : VALIDÉ.** Le report de l'attribution dans `AuditLog` à A8 est accepté. Condition : l'architecte recommande de ne pas ouvrir l'impersonation avant A8.
- **S18.2-bis : À REPRENDRE.** `POST /projects/workspaces/:workspaceId/calendar/oauth/callback` n'est pas décoré : en impersonation, il lie l'agenda de l'administrateur au workspace de la cible (nouveau constat **S18.2-ter**).
- **O7, O8, O9 : VALIDÉ.** L'écart `sprint.service.ts` d'O8 est accepté.
- **P10 : question à l'utilisateur** (recommandation : resserrer).
- Nouveaux constats :
  - **S17-a** (Mineur, Phase 4) : invitations en attente non révoquées au déprovisionnement SCIM, plus le test de M3 ;
  - **O10**, **O11** (Phase 5) ;
  - **P11** (décision de l'utilisateur : annuaire visible par un invité VIEWER).
- Les 11 points ouverts reçoivent leur réponse dans le rapport, section « Réponses aux points ouverts du fixeur (Phase 4) ».

**Constats encore ouverts pour `fixeur` en Phase 4 :** S18.2-ter, S17-a ; plus la rétrogradation d'un MANAGER par un MANAGER si l'utilisateur répond « non » à la question 3. Ordre et critères : rapport, « Plan d'action r17 pour fixeur ».

## Actions de la revue r17

### S18.2-ter — Callback OAuth du calendrier interdit en impersonation

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `projects.controller.ts:561` (`POST /projects/workspaces/:workspaceId/calendar/oauth/callback`) sans `@ForbiddenInImpersonation()` ; il remplace les jetons de l'intégration calendrier du workspace.
- **Changement** : décorateur posé sur `handleOAuthCallback`.
- **Tests** : `impersonation-routes.spec.ts` : `[ProjectsController, 'handleOAuthCallback']` ajouté à la liste paramétrée, motif `POST /projects/workspaces/:workspaceId/calendar/oauth/callback` ajouté au balayage méta et à l'attendu. **Avant correctif : 2 échecs** (cas paramétré et « porte le décorateur »). Après : 63/63.

### S17-a — Invitations en attente révoquées au déprovisionnement SCIM

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `scim.service.ts` retirait la membership (DELETE, `active=false`) sans toucher aux invitations `PENDING` adressées à l'utilisateur.
- **Changement** : `ScimService.revokePendingInvitations` (invitations `PENDING` du workspace dont l'adresse, en minuscules, est celle de l'utilisateur : `updateMany` conditionnel sur `PENDING` en transaction, passage à `REVOKED`, événement Firestore `invitation` / `upsert`), appelé par `deleteUser` et par `patchUser` quand `active=false`. `FirestoreSyncService` est injecté (`AuthModule` importe `FirestoreSyncModule`). La charge utile Firestore est extraite en `projects/invitation-sync-payload.ts`, partagée avec `InvitationsService`.
- **Tests** : `scim.service.spec.ts` (+4) : DELETE, `active=false`, aucune révocation sans changement d'état d'activité, aucune écriture sans invitation ; le filtre de `findMany` est vérifié (workspace, `PENDING`, adresse en minuscules), donc une invitation d'un autre workspace n'est pas visée. **Avant correctif : 2 échecs sur 4** (les 2 autres sont des contrôles). `scim-routes.spec.ts` et `scim-throttler.spec.ts` fournissent un faux `FirestoreSyncService`. `invitations-security.spec.ts` (+1, 19) : invitation de projet héritée (`role: 'ADMIN'`, `projectId`, `projectRole` nul) acceptée par un non-membre : membership `VIEWER` et `ProjectMembership` `CLIENT`.
- **Mutation M3 rejouée** (membership créée au rôle de l'invitation ; sauvegarde hors dépôt, restauration par `/bin/cp -f`, `cmp` identique) : **1 échec** (survivante en r17, désormais détectée).
- **Limite** : l'acceptation par un utilisateur déjà déprovisionné d'un lien anonyme de projet reste possible (usage unique, projet précis, rôle ≤ CONTRIBUTOR), car aucune adresse ne le lie à l'utilisateur.

### Correction du journal

`invitations.service.spec.ts` compte 9 tests (et non 25) ; l'entrée S17 est corrigée.

### Non traités, conformément à la consigne

Rétrogradation d'un MANAGER par un MANAGER (attend la décision de l'utilisateur), O10, O11, P11.

## Résultats (r17)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **79/79 suites, 2321/2321 tests** (Phase 4 : 2313 ; +8, détail ci-dessous) |
| `npx jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| `npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `npx nest build` ; `find dist -name '*.spec.js'` | exit 0 ; 0 |
| `npx eslint src tests scripts` | 0 erreur, 17 avertissements |
| `npx prettier --check src tests scripts` | conforme |
| Frontend `npx vitest run` | 15 fichiers, 61/61 (inchangé) |
| `git stash list` | vide ; aucun commit ; `.claude/` et `ci.yml` non touchés |

Détail des +8 tests : `impersonation-routes.spec.ts` +2 (63), `scim.service.spec.ts` +4 (21), `invitations-security.spec.ts` +1 (19), cas « autorisé hors impersonation » de la liste paramétrée +1.

## Revue architecte r18 (2026-11-04) : NON VALIDÉ — corrections ciblées restantes

Détail dans `rapport-audit.md`, section « Revue r18 ». Les chiffres de « Résultats (r17) » sont exacts et ont été relancés par l'architecte :

- backend : 79/79 suites, 2321/2321 tests ; intégration 4/4 ;
- builds et qualité : `tsc` et `nest build` OK ; ESLint 0 erreur et 17 avertissements ; prettier et `prisma validate` OK ;
- frontend : 61/61.

11 mutations, toutes détectées (N1 à N10, M3). Diff (`91e83832…`) et fichiers non suivis identiques avant et après.

#### Revue architecte

- **S18.2-ter : VALIDÉ.** S18.2-bis est fermé avec lui ; **S18 est clos côté code**. L'impersonation reste désactivée jusqu'à A8 (décision de l'utilisateur).
- **S17-a : VALIDÉ.** La mutation M3 est désormais détectée.
- **Limite « lien anonyme accepté par un utilisateur déprovisionné » : acceptée.** Le lien est un jeton au porteur, borné (usage unique, un projet, rôle ≤ CONTRIBUTOR, 30 jours), et les liens d'un administrateur déprovisionné meurent avec lui. Amélioration consignée comme **O12** (Phase 5) : pas de lien anonyme dans un workspace dont le SCIM est actif.
- **Décisions de l'utilisateur du 2026-11-04** (déléguées à l'architecte) :
  1. pas d'annuaire ni de sprints pour un invité (P11) ;
  2. usage unique, sans `maxUses` ;
  3. un MANAGER ne rétrograde ni ne retire un autre MANAGER (P12) ;
  4. le créateur VIEWER ne reste pas MANAGER (P10) ;
  5. impersonation fermée jusqu'à A8.

**Constats encore ouverts pour `fixeur` en Phase 4 :** P11, P12, P10, dans cet ordre. Critères testables : rapport, « Plan d'action r18 pour fixeur ». La Phase 4 sera validée après ces trois corrections.

## Actions de la revue r18

Décisions de l'utilisateur du 2026-11-04 (déléguées à l'architecte) appliquées dans l'ordre P11, P12, P10. Aucun commit, aucun `git stash`, aucune base ; `.claude/`, `ci.yml` et `eslint.config.cjs` non touchés ; le commit CI `92b39bd` de `main` n'est pas traité.

### P11 — VIEWER sans annuaire, sprints, capacité ni intégrations

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `permissions.ts` : `sprint.read` ouvert à VIEWER ; `getWorkspaceMembers` et `getWorkspaces` renvoyaient tous les membres (noms, e-mails) à tout membre ; `getResourceCapacityReport` et `GET .../integrations` (+ `/status`) n'exigeaient que l'appartenance.
- **Changement** :
  - `authz/permissions.ts` : `sprint.read` = OWNER, ADMIN, MEMBER ; nouvelle action `workspace.directory.read` (OWNER, ADMIN, MEMBER) ; `workspace.read` reste ouverte à VIEWER.
  - `authz/policy.service.ts` : `listVisibleWorkspaceMemberIds(workspaceId, userId)` (tous les membres avec `workspace.directory.read` ; sinon lui-même, OWNER/ADMIN, créateurs au moins MEMBER et titulaires d'une `ProjectMembership` des projets lisibles, restreints aux détenteurs d'une `Membership`).
  - `projects.service.ts` : `getWorkspaceMembers` (`userId in visible`) et `getWorkspaces` (filtrage par workspace selon le rôle de l'appelant). `resources.service.ts` : `workspace.directory.read` sur le rapport de capacité. `projects.controller.ts` : même action sur `GET .../integrations` et `.../integrations/status`.
  - Frontend : `AppContext.tsx` n'appelle `resources/capacity` que si le rôle du workspace par défaut n'est pas VIEWER (la requête est sortie du `Promise.all`, avec la même gestion du 401) ; `App.tsx` masque les onglets Ressources et Agile (barre et navigation mobile) et retombe sur le tableau de bord ; `GovernanceView.tsx` masque l'onglet Intégrations.
- **Tests** : `tests/unit/authz/viewer-directory.spec.ts` (14, fixture RBAC : 7 membres de W, `client` VIEWER avec CLIENT sur P1, `member` sans accès). **Avant correctif : 12 échecs sur 14** (les 2 verts : contrôles MEMBER). Il couvre : matrice, `listVisibleWorkspaceMemberIds` (VIEWER invité : lui-même, OWNER/ADMIN, membres de P1, ni `member` ni son adresse ni le compte déprovisionné ; VIEWER sans projet ; MEMBER voit les 7 ; non-membre 403), `getWorkspaceMembers`, `getWorkspaces`, sprints (liste, vélocité, détail) et capacité refusés à `viewer` et `client`, contrôle positif MEMBER. La matrice HTTP (`rbac-matrix.spec.ts`, 982 cas) est mise à jour : sprints, vélocité, burndown, capacité et intégrations en lecture passent au niveau « contribute » ; tous les cas verts. `rbac-services.spec.ts` et `policy.service.spec.ts` adaptés (un VIEWER ne lit plus les sprints, la capacité n'est plus lue par un VIEWER). Frontend : `GovernanceView.spec.tsx` (+2) : onglet Intégrations absent pour VIEWER et présent pour MEMBER (**avant : 1 échec**).
- **Mutations rejouées** (sauvegarde hors dépôt, restauration `/bin/cp -f`, `cmp` « restored » à chaque fois) :

| Mutation | Résultat |
| --- | --- |
| `getWorkspaceMembers` sans filtre `userId in visible` | 1 échec |
| `getWorkspaces` sans filtrage des `memberships` | 1 échec |
| capacité : `workspace.directory.read` remplacée par `workspace.read` | 2 échecs |
| `GET .../integrations` : `workspace.read` au lieu de `workspace.directory.read` | 2 échecs (matrice HTTP) |
| Frontend : onglet Intégrations toujours affiché | 1 échec |

- **Écart** : le rendu complet de `App.tsx` pour un VIEWER (onglets Ressources et Agile) n'a pas de test vitest : `App` est trop couplé à l'application entière. Le masquage tient à `currentUserRole !== 'VIEWER'`, déjà fourni par `AppContext`. À confirmer : un test d'`App` demanderait de simuler une quinzaine de composants.

#### Revue architecte (r19)

**À REPRENDRE.** Le correctif backend est conforme : R1b, R2, R4 et R5 sont détectées, ainsi que les mutations du fixeur. Restent trois compléments, détaillés dans le rapport (« Revue r19 », « Plan d'action r19 ») :

- **P11-a (nouveau, Mineur)** : `GET /projects/resources/:userId/leaves` (`resources.service.ts:438`) laisse un VIEWER lire les absences, avec leur motif, de tout membre d'un workspace commun. Exiger `workspace.directory.read` lorsque la cible n'est pas l'appelant ;
- **mutation R3 survivante** : la règle P10 de `listVisibleWorkspaceMemberIds` n'est pas testée, car dans la fixture le créateur de P1 est OWNER, donc toujours visible. Ajouter un créateur MEMBER visible et un créateur VIEWER invisible ;
- **mutation F1 survivante** : aucun test ne vérifie que `AppContext` n'appelle pas `resources/capacity` pour un VIEWER. Test exigé avec le harnais d'`AppContext.session.spec.tsx`.

Écart sur `App.tsx` : accepté pour le rendu des onglets (confort, le backend décide), refusé pour l'appel réseau (point précédent).

### P12 — Un MANAGER ne rétrograde ni ne retire un autre MANAGER

- **Statut** : `CORRIGÉ – À REVOIR`
- **Cause confirmée** : `project-permissions.service.ts` : `assignProjectRole` et `removeProjectRole` n'exigeaient que `MANAGER` de l'acteur.
- **Changement** : `assertMayChangeTarget` (appelé avant toute écriture par les deux méthodes) : si le rôle effectif de la cible (`PolicyService.effectiveProjectRole`, désormais public) est MANAGER et que l'acteur n'est pas OWNER/ADMIN, 403 ; exception : l'acteur est la cible, sauf s'il est le créateur du projet. `removeProjectRole` charge le projet par `assertProjectRoles`.
- **Tests** : `assign-project-role.spec.ts` (+6, 13 au total), les 5 du rapport plus le créateur. **Avant correctif : 3 échecs sur 6** (rétrograder, retirer, créateur ; les 3 autres sont des contrôles positifs).
- **Mutations** : contrôle retiré de `removeProjectRole` : 2 échecs ; contrôle retiré de `assignProjectRole` : 2 échecs ; exception du créateur retirée : 1 échec. Restaurations vérifiées.

#### Revue architecte (r19)

**VALIDÉ.** Contrôle fait avant toute écriture, sur le rôle effectif de la cible. Une promotion de soi en MANAGER reste impossible. Mutations Q1 (acteur MEMBER traité comme ADMIN : 3 échecs), Q2 (exception du créateur retirée : 1), Q3 (condition « acteur = cible » retirée : 2) et Q4 (créateur cible non protégé : 1) : toutes détectées.

### P10 — Créateur MANAGER seulement s'il est au moins MEMBER

- **Statut** : `CORRIGÉ – À REVOIR`
- **Changement** : `policy.service.ts`, helper `creatorIsManager(rôle)` (OWNER, ADMIN, MEMBER) appliqué aux trois endroits : `effectiveProjectRole`, `filterUsersWithProjectAction`, `listAccessibleProjectIds` (branche créateur limitée aux workspaces où il n'est pas VIEWER) ; `listVisibleWorkspaceMemberIds` applique la même règle. Les projets personnels sont inchangés.
- **Tests** : `tests/unit/authz/creator-role.spec.ts` (7, vrai `PolicyService`, fixture RBAC). **Avant correctif : 4 échecs sur 7** (créateur VIEWER sans `ProjectMembership` : `assertProject`, liste, filtre ; avec CLIENT : lecture permise, écriture refusée ; les 3 verts : MEMBER, projet personnel, OWNER).
- **Mutations** (règle rétablie dans une seule méthode) : `effectiveProjectRole` : 2 échecs ; `filterUsersWithProjectAction` : 2 échecs ; `listAccessibleProjectIds` : 2 échecs.
- **`grep -rn "project.userId\|userId === " backend/src/authz backend/src/realtime backend/src/projects` (hors specs)**, occurrences restantes justifiées :
  - `policy.service.ts:114` (annuaire VIEWER) : passe par `creatorIsManager` ;
  - `:136` : projet personnel (sans workspace), réservé à son créateur, inchangé ;
  - `:143`, `:280` : règle P10 ;
  - `:257` : projet personnel dans `filterUsersWithProjectAction` ;
  - `project-permissions.service.ts:46` : exception du créateur de P12 ;
  - `finances.service.ts:63`, `resources.service.ts:119-153, 288, 353`, `comments.service.ts:205`, `projects.service.ts:348` : comparaisons d'auteur ou de charge, sans octroi de rôle de projet ;
  - `tasks.service.ts:127, 243, 347, 429` : identifiant du workspace de synchronisation (`personal-<userId>`), sans effet d'accès.
- **Observation non traitée (hors périmètre, à classer)** : deux requêtes accordent encore un droit au créateur sans passer par la politique : `AuthService.syncRepositoryToProject` (`auth.service.ts:512`, `findFirst({ id, userId })` : un créateur sans `Membership`, déprovisionné ou VIEWER, peut renseigner `githubRepo`) et `ResourcesService.createResourceAllocation` (pré-filtre `OR userId`, mais suivi de `OWNER/ADMIN` obligatoire : sans effet). Proposition : **O13** (Mineur, Phase 5) : `assertProject(…, 'project.manage')` dans `syncRepositoryToProject`.
- Il n'existe aucune route qui change un rôle de workspace : aucun recalcul de salons ajouté ; la consigne figure dans `matrice-rbac.md` pour tout futur flux.

#### Revue architecte (r19)

**VALIDÉ.** Même helper aux trois endroits, projets personnels inchangés. `grep` vérifié, chaque occurrence restante est justifiée. Mutations C1 (`creatorIsManager` toujours vrai : 4 échecs) et C2 (branche créateur ouverte : 2) : détectées. La règle P10 appliquée dans l'annuaire du VIEWER n'est pas couverte (R3), ce qui est rattaché à P11.

**Observation O13 : acceptée en Phase 5, Mineur** (CVSS 2.7), avec une remédiation élargie : `assertProject(…, 'project.manage')`, DTO validé pour `POST /auth/github/sync`, tests. Voir le rapport.

### Documentation

`docs/security/matrice-rbac.md` : décisions du 2026-11-04, `workspace.directory.read`, annuaire du VIEWER, P12, P10 et consigne pour un futur changement de rôle ; `runbook-phase4.md` § 5 (requêtes de contrôle des VIEWER internes et des créateurs VIEWER) ; en-tête de `permissions.ts`.

#### Revue architecte (r19)

**VALIDÉ.** Suggestion facultative : dans la première requête du runbook § 5, ajouter le nombre de `ProjectMembership` du VIEWER, pour distinguer un invité d'un collaborateur interne.

## Résultats (r18)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **81/81 suites, 2355/2355 tests** (r17 : 79 suites, 2321 tests) |
| `npx jest tests/integration --detectOpenHandles` | 4/4, aucun handle ouvert |
| `npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tracking.gateway.spec.ts`), antérieure et inchangée |
| `npx nest build` ; `*.spec.js` dans `dist` | exit 0 ; 0 |
| `npx eslint src tests scripts` ; `prettier --check` ; `prisma validate` | 0 erreur, 17 avertissements ; conforme ; valide |
| Frontend `npx vitest run` | 15 fichiers, **63/63** (r17 : 61) |
| Frontend `tsc --noEmit -p .` ; `eslint src` ; `prettier --check src` ; `vite build` | exit 0 ; 0 erreur, 36 avertissements ; conforme ; OK |
| `git stash list` | vide |

Nouveaux fichiers de test : `viewer-directory.spec.ts` (14), `creator-role.spec.ts` (7). Le détail du delta de 34 tests (+27 dans ces deux fichiers et `assign-project-role`, −2 tests de capacité VIEWER/client retirés, le reste dans les suites adaptées) n'a pas été entièrement rapproché ligne à ligne ; les totaux ci-dessus sont ceux mesurés.

## Points ouverts pour l'architecte (r18)

1. Test d'`App.tsx` pour un VIEWER (voir l'écart de P11) : acceptable en l'état ?
2. **O13** proposé (créateur sans `Membership` et `syncRepositoryToProject`).
3. Aucune migration nouvelle ; les VIEWER internes devront être promus MEMBER avant déploiement (runbook § 5).

## Revue architecte r19 (2026-11-04) : NON VALIDÉ — compléments ciblés sur P11

Détail dans `rapport-audit.md`, section « Revue r19 ». Les chiffres de « Résultats (r18) » ont été relancés par l'architecte et sont exacts :

- backend : 81/81 suites, 2355/2355 tests ; intégration 4/4 ;
- `tsc` (build) exit 0 ; ESLint 0 erreur et 17 avertissements ; prettier conforme ;
- frontend : 63/63 ; `tsc` exit 0.

13 mutations backend et 1 frontend ont été rejouées. Deux survivent : R3 (règle P10 dans l'annuaire du VIEWER) et F1 (appel à la capacité pour un VIEWER). Le diff (`4a7b43eb…`) est identique avant et après.

#### Revue architecte

- **P11 : À REPRENDRE** (voir sous l'entrée) : P11-a, test R3, test F1.
- **P12 : VALIDÉ.**
- **P10 : VALIDÉ.**
- **Documentation : VALIDÉ.**
- **Réponses aux points ouverts (r18)** :
  1. Test d'`App.tsx` : l'écart est accepté pour le rendu, mais un test de l'appel réseau dans `AppContext` est exigé (F1).
  2. O13 : accepté en Phase 5, Mineur, avec une remédiation élargie (DTO de `POST /auth/github/sync`).
  3. Promotion des VIEWER internes : accepté comme prérequis de déploiement, à décider par l'utilisateur. Cela ne bloque pas le code.
- **Nouveaux constats** :
  - **P11-a** (Mineur, Phase 4) ;
  - **O13** (Mineur, Phase 5) ;
  - **O14** (Amélioration, Phase 5) : le workspace « par défaut » diffère entre le frontend et le backend.

**Constats encore ouverts pour `fixeur` en Phase 4, dans cet ordre :**

1. P11-a ;
2. le test R3 ;
3. le test F1 ;
4. les suites complètes et « Résultats (r19) ».

Les critères sont dans le rapport, « Plan d'action r19 pour fixeur ». La Phase 4 sera validée après ces points.

## Actions de la revue r19

### P11-a — Absences d'un membre lisibles par un VIEWER

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `backend/src/projects/resources.service.ts` (`getResourceLeaves`) : si l'appelant n'est pas la cible, il faut un workspace commun (non supprimé) où l'appelant a un rôle de `WORKSPACE_PERMISSIONS['workspace.directory.read']` (OWNER, ADMIN, MEMBER), sinon 403 ; aucune liste de rôles en dur. La requête se fait en deux temps (workspaces de la cible, puis `Membership` de l'appelant avec `workspaceId in` et `role in`) pour ne pas dépendre d'un filtre relationnel imbriqué. Ses propres absences restent lisibles par tous.

**Tests** (écrits avant le correctif ; 3 échecs constatés : client, viewer, outsider) : `tests/unit/authz/viewer-directory.spec.ts`, bloc « P11-a » : client et viewer vers owner : 403 sans lecture de `resourceLeave` ; propres absences d'un VIEWER : 200 ; member vers owner : 200 ; outsider : 403. `tests/http/rbac-matrix.spec.ts` : `GET /projects/resources/:userId/leaves` passe de `ANY` à `ws('contribute')` (cible `member`).
**Mutation** : suppression de la ligne `role: { in: … }` : 4 échecs (viewer-directory + matrice) ; fichier restauré (`cmp` identique).

**Écart par rapport au rapport** : aucun. **Correction (r20)** : l'affirmation initiale « la fixture simulée ignore les filtres `workspace: { memberships }` » était inexacte. Le faux Prisma évalue bien `workspace: { memberships: { some } }` ; c'est `workspace: { deletedAt: null }` qu'il ignore (traité comme toujours vrai). Le cas « workspace supprimé » n'est donc couvert qu'en base, par Prisma, et sans test unitaire : rattaché à O15 (Phase 5). La requête en deux temps reste valide (équivalente à la forme relationnelle, validée en r20).

**Questions pour l'architecte** : aucune.

### P11-b — Test de l'annuaire pour un créateur (R3)

**Statut** : CORRIGÉ – À REVOIR

**Changement** : aucun code. Test dans `tests/unit/authz/viewer-directory.spec.ts` (bloc « créateur d'un projet accessible (règle P10) »), projet `PC` sur lequel `client` est CLIENT : créé par `member` (MEMBER sans `ProjectMembership`) : présent dans l'annuaire de client ; créé par `viewer` : absent.
**Mutations** : (R3) `memberRole.has(project.userId)` à la place de `creatorIsManager` : 1 échec (cas VIEWER) ; boucle des créateurs supprimée : 1 échec (cas MEMBER). Fichier restauré (`cmp` identique).

**Écart par rapport au rapport** : aucun. **Questions** : aucune.

### P11-c — Test de l'appel à la capacité (F1)

**Statut** : CORRIGÉ – À REVOIR

**Changement** : aucun code. `frontend/src/context/AppContext.session.spec.tsx`, bloc « appel à la capacité des ressources (P11) » (même harnais, `AppProvider` réel, fetch simulé) : VIEWER sur le premier workspace : aucun appel à `/projects/resources/capacity` (après 100 ms de marge) ; MEMBER : un appel.
**Mutation** : `if (defaultRole)` à la place de `if (defaultRole && defaultRole !== 'VIEWER')` : 1 échec (VIEWER). Fichier restauré (`cmp` identique).

**Écart par rapport au rapport** : aucun. **Questions** : aucune.

## Résultats (r19)

- Backend : `env -u DATABASE_URL npx jest` : 81/81 suites, 2362/2362 tests ; intégration `--detectOpenHandles` : 4/4 ; `tsc --noEmit -p tsconfig.build.json` : exit 0 ; `nest build` : exit 0 ; ESLint : 0 erreur, 17 avertissements ; Prettier : conforme ; `prisma validate` : valide.
- Frontend : vitest 15 fichiers, 65/65 ; `tsc --noEmit -p .` : exit 0 ; Prettier : conforme ; `vite build` : exit 0 ; ESLint : aucune sortie (propre).
- Aucun commit, aucun `git stash`, aucune base ; `.claude/`, `ci.yml`, `eslint.config.cjs` non touchés.

## Points ouverts pour l'architecte (r19)

- Changement visible : un VIEWER ne lit plus les absences d'autrui (comportement voulu par P11-a). Un MEMBER, ADMIN ou OWNER garde l'accès s'il partage un workspace avec la cible.
- O13 et O14 laissés en Phase 5, comme demandé.

#### Revue architecte (r20) — P11-a, P11-b, P11-c

**VALIDÉ (les trois).** Suites relancées par l'architecte : backend 81/81 suites, 2362/2362 ; intégration 4/4 ; frontend 65/65 ; `tsc` backend et frontend, ESLint et Prettier OK. Mutations rejouées et toutes détectées : A1 à A5 sur `getResourceLeaves` (rôle retiré, `workspace.read`, contrôle supprimé, `workspaceId in` retiré, contrôle sur soi-même), R3 et R3b sur l'annuaire, F1 et F1b sur `AppContext`. Les sondes des cas limites sont conformes (403 sans lecture dans chaque cas) : cible sans workspace, cible ou appelant déprovisionnés, `PLATFORM_ADMIN` sans `Membership`, VIEWER dans plusieurs workspaces ; un MEMBER de W2 lit une cible de W2 mais pas une cible de W seul. La requête en deux temps n'ouvre aucun écart.

Une précision pour le journal : le faux Prisma évalue bien `workspace: { memberships: { some } }`, mais il ignore `workspace: { deletedAt: null }`. Le cas « workspace supprimé » n'est donc pas testé. Il est rattaché au nouveau constat **O15** (Phase 5), avec les rôles codés en dur de `createResourceLeave` et `deleteResourceLeave`.

## Revue architecte r20 (2026-11-04) : VALIDÉ — Phase 4 close côté code

Détail dans `rapport-audit.md`, section « Revue r20 ». Les chiffres de « Résultats (r19) » sont exacts. Le changement visible de P11-a est accepté et doit figurer dans les notes de version.

**Actions restantes (aucune correction de code)** :

1. Fixeur : clôture documentaire, à savoir `GEMINI.md`, DAT § 15.1, liste des fichiers du commit sans `.claude/`, notes de version (P11, P11-a).
2. Utilisateur : commit de la Phase 4 ; avant le déploiement : migration `20261112000000`, MFA des comptes de plateforme, promotion en MEMBER des VIEWER internes (runbook § 5).

Constats encore ouverts : P9 (Phase 1) ; S19 à S26, A5 à A9, P2, P5, P7, P8, Q-2, O10 à O15 (Phases 5 et 6).

## Clôture Phase 4 (documentation, après r20)

Aucun changement de code. Documents mis à jour : `GEMINI.md` (état, rappels de règles), `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` § 15.1 (ligne Phase 4 : validée côté code ; ligne Phase 5 : ajout de O15), ce journal (correction de l'écart de P11-a). Aucun commit, aucun `git stash`, aucune base ; `.claude/`, `ci.yml` et `eslint.config.cjs` non touchés.

### Fichiers du commit de Phase 4 (61 entrées de `git status`, hors `.claude/`)

Modifiés (48) :

- Schéma : `backend/prisma/schema/workspace.prisma`
- Admin : `backend/src/admin/{admin.controller.ts, admin.service.spec.ts, admin.service.ts, dto/admin.dto.ts, platform-admin.guard.spec.ts, platform-admin.guard.ts}`
- Auth : `backend/src/auth/{auth.module.ts, session.service.ts, token.service.ts, scim/scim.controller.ts, scim/scim.service.spec.ts, scim/scim.service.ts, sso/sso.controller.ts}`
- Autorisation : `backend/src/authz/{permissions.ts, policy.service.ts}`
- Notes : `backend/src/notes/notes.service.ts`
- Projets : `backend/src/projects/{dto/create-invitation.dto.ts, invitations.controller.ts, invitations.service.ts, project-permissions.service.ts, projects.controller.ts, projects.service.ts, resources.service.ts, tasks.service.ts}`
- Tests : `backend/tests/http/{impersonation-flag, rbac-matrix, scim-routes, scim-throttler, session-lifecycle}.spec.ts`, `backend/tests/support/rbac-fixture.ts`, `backend/tests/unit/auth/impersonation-routes.spec.ts`, `backend/tests/unit/authz/{notes-access, notifications-access, policy.service, rbac-services}.spec.ts`, `backend/tests/unit/projects/invitations.service.spec.ts`
- Frontend : `frontend/src/App.tsx`, `frontend/src/components/{AdminConsole.spec.tsx, AdminConsole.tsx, GovernanceView.spec.tsx, GovernanceView.tsx, ProjectMembersPanel.tsx}`, `frontend/src/context/{AppContext.session.spec.tsx, AppContext.tsx}`
- Docs : `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md`, `docs/security/{journal-corrections.md, rapport-audit.md}`, `GEMINI.md`

Nouveaux (13, à ajouter avec `git add`) :

- `backend/prisma/migrations/20261112000000_s17_invitation_project_role/`
- `backend/src/admin/platform-roles.decorator.ts`, `backend/src/projects/{dto/assign-project-role.dto.ts, invitation-sync-payload.ts, task-sync-payload.ts}`
- `backend/tests/http/admin-platform-roles.spec.ts`, `backend/tests/unit/auth/impersonation-token.spec.ts`, `backend/tests/unit/authz/{creator-role, viewer-directory}.spec.ts`, `backend/tests/unit/projects/{assign-project-role, invitations-security}.spec.ts`
- `docs/security/{matrice-rbac.md, runbook-phase4.md}`

`GEMINI.md` est suivi par git et fait partie du commit. Ne pas utiliser `git add -A` sans exclure `.claude/` (ajouter les chemins explicitement).

### Notes de version (Phase 4)

Changements visibles pour les utilisateurs :

- **P11** : un VIEWER (rôle de workspace) ne voit plus les sprints, la capacité des ressources ni les intégrations, et l'annuaire des membres lui est restreint (permission `workspace.directory.read`, réservée à OWNER, ADMIN et MEMBER). L'interface n'appelle plus la capacité des ressources pour un VIEWER.
- **P11-a** : un VIEWER ne lit plus les absences d'autrui. Un MEMBER, ADMIN ou OWNER les lit s'il partage un workspace (non supprimé) avec la cible. Chacun garde l'accès à ses propres absences.
- **P12** : un MANAGER de projet ne peut ni rétrograder ni retirer un autre MANAGER (réservé aux OWNER/ADMIN du workspace) ; le créateur du projet ne peut pas se rétrograder lui-même.
- **P10** : le créateur d'un projet n'est MANAGER que si son rôle de workspace est au moins MEMBER ; un créateur devenu VIEWER perd ce rôle.
- **Invitations (S17)** : les liens anonymes d'espace de travail sont supprimés ; invitation nominative non transférable ; `projectRole` accepté pour les invitations de projet (`role` ignoré dans ce cas) ; `POST /projects/:id/members` valide un UUID.
- **Console admin (S18)** : `POST /admin/users/:id/impersonate` exige `{ reason }` ; les comptes `platformRole` sans MFA sont bloqués sur `/admin/*` ; leurs sessions sont plafonnées à 12 h.

Prérequis de déploiement (utilisateur, avant mise en production) :

1. Migration `20261112000000_s17_invitation_project_role` (additive ; deux `UPDATE` sur les invitations en attente seulement), selon `docs/security/runbook-phase4.md`. Non appliquée à ce jour.
2. Activer le MFA sur tous les comptes de plateforme (sinon blocage de `/admin/*`).
3. Promouvoir en MEMBER les VIEWER internes qui doivent garder l'annuaire, les sprints, la capacité, les intégrations et les absences (runbook § 5).

Constats encore ouverts : P9 (Phase 1) ; S19 à S26, A5 à A9, P2, P5, P7, P8, Q-2, O10 à O15 (Phases 5 et 6).

### Message de commit proposé (non exécuté)

```
fix(security): phase 4 du programme de remédiation (validée par l'architecte)

Invitations (S17, S17-a), console d'administration (S18.1 à S18.3), RBAC
workspace/projet (P4, P10, P11, P11-a, P12), permission
workspace.directory.read, reports O7, O8, O9.
Migration 20261112000000 (non appliquée), runbook-phase4.

```

---

### P9-MFA — Écran « Sécurité du compte » : volet MFA

**Statut** : CORRIGÉ – À REVOIR (volet MFA uniquement ; P9 reste ouvert pour les autres volets).

**Contexte** : S18.3 exige la MFA sur `/admin/*` ; sans écran d'activation, les SUPER_ADMIN de production (`mfaEnabled=0`) sont bloqués. Le rapport de P9 est suivi (activation avec QR code, affichage unique des 10 codes avec téléchargement, désactivation et régénération).

**Changement** :

- Frontend (nouveaux) : `frontend/src/security-api.ts` (appels `GET /auth/mfa/status`, `POST /auth/mfa/setup|confirm|disable|recovery-codes`, erreur typée avec statut HTTP), `frontend/src/components/SecurityPage.tsx` et `SecurityPage.css`.
  - Activation : `setup` avec `{ password }` (champ masqué pour un compte sans mot de passe, avec le message « reconnectez-vous puis réessayez » sur 403) ; QR code généré localement depuis `authUri` ET secret en texte ; `confirm` avec `{ code }` ; les codes sont affichés une seule fois (état React uniquement, jamais en localStorage), téléchargement `.txt`, case « J'ai conservé ces codes » obligatoire avant « Terminer ».
  - Désactivation : code TOTP ou code de secours (bascule), plus mot de passe. Régénération : code TOTP plus mot de passe, nouveaux codes affichés une seule fois.
- Intégration : `frontend/src/App.tsx` (onglet `security` rendu par `SecurityPage`, bouton bouclier dans le bloc profil de l'en-tête, visible pour tout utilisateur connecté) ; `frontend/src/context/AppContext.tsx` (valeur `'security'` ajoutée aux 3 unions de l'onglet actif).
- Console d'administration (point 6) : `frontend/src/components/AdminConsole.tsx` lit le corps du 403 ; s'il contient « deux facteurs », il affiche le message serveur et un bouton « Activer l'authentification à deux facteurs » qui ouvre l'écran. Les autres 403 gardent le message générique.
- Backend (minimal) : l'objet `user` des réponses de connexion n'expose PAS `mfaEnabled` (`auth.service.ts`, `{ id, email, name, platformRole }`), et le profil est mis en cache dans `localStorage` (donc périmé pour les sessions déjà ouvertes, dont celles des SUPER_ADMIN). Plutôt que de grossir ce cache, ajout de `GET /auth/mfa/status` → `{ mfaEnabled, hasPassword }` (`AuthService.getMfaStatus`, `select` limité à `mfaEnabled` et `passwordHash`, aucun secret). La route porte `@ForbiddenInImpersonation()` (règle S18.2 : `/auth/mfa/*`).

**Dépendance ajoutée** : `qrcode-generator` **2.0.4** exact (`frontend/package.json`, `pnpm-lock.yaml`, +11 lignes une fois le fichier repassé par prettier ; livré à tort à +2353/-6728 lors de la première livraison, corrigé à la reprise r21 ; tout `pnpm install`, même `--lockfile-only`, le réécrit au format natif, donc relancer `npx prettier --write pnpm-lock.yaml` ensuite). Justification : génération du QR code côté navigateur, sans aucun appel externe (le secret contenu dans `authUri` ne quitte jamais l'application). Choisie plutôt que `qrcode` (1.5.4) car elle n'a aucune dépendance transitive (le lockfile ne gagne qu'une entrée) et fournit ses types. Le lockfile a été reformaté avec prettier pour garder un diff minimal ; `pnpm install --frozen-lockfile --lockfile-only` passe. Node 20 : bibliothèque sans code natif.

**Tests** :

- Ajoutés : `frontend/src/components/SecurityPage.spec.tsx` (8 tests : activation complète avec QR en `data:image`, secret en texte, 3 appels corrects, codes affichés une seule fois et inaccessibles après fermeture, fermeture bloquée sans confirmation, téléchargement `.txt` ; 403 mot de passe incorrect ; compte sans mot de passe et message de reconnexion ; 400 code invalide ; désactivation par code de secours ; désactivation par TOTP avec erreur 400 ; régénération). `AdminConsole.spec.tsx` (+1 : le 403 « deux facteurs » mène à l'écran). `backend/src/auth/auth.service.spec.ts` (+2 : `getMfaStatus`).
- Résultats : `pnpm test:run` frontend **74/74** (16 fichiers) ; `pnpm build` frontend OK ; ESLint ciblé sur une liste de fichiers (l'erreur `prettier/prettier` de `AppContext.tsx:263` m'avait échappé car ce fichier a été lancé avant la dernière retouche ; l'affirmation « 0 erreur » était inexacte, `pnpm lint` racine était rouge) ; `nest build` backend OK ; `jest` backend complet : 2362 passés, 3 échecs sur le premier passage : (1) `impersonation-routes.spec.ts` : `/auth/mfa/status` sans `@ForbiddenInImpersonation()` (réel, corrigé) ; (2) `mfa-ticket.spec.ts` (Redis hang, seuil 2,5 s) et (3) `session-lifecycle.spec.ts` (suite de 121 s) : échecs de temporisation sous charge, la relance isolée des 3 suites donne **101/101**.
- Écart de méthode : le test backend `getMfaStatus` a été écrit avec le code (pas de passage au rouge préalable observé) ; le test de la route `status` a été « rouge » par le garde-fou S18.2 existant.

**Écart par rapport au rapport** : aucun sur le périmètre MFA. Ajout non prévu : la route `GET /auth/mfa/status` (le rapport demande seulement que l'écran connaisse `mfaEnabled`). Hors périmètre de cette itération, donc toujours ouverts dans P9 : liaison GitHub et Firebase, page des sessions actives, bouton « Connecter un dépôt ».

**Questions pour l'architecte** :

1. Valider `GET /auth/mfa/status` plutôt que l'ajout de `mfaEnabled` à l'objet `user` (cache localStorage périmé pour les sessions existantes).
2. Le QR est servi en `data:` URI : une future CSP (S-en-têtes, Phase 5) devra autoriser `img-src 'self' data:`. Aucune CSP n'est définie à ce jour.
3. Après désactivation, le backend révoque les autres sessions (comportement existant) ; l'écran l'indique à l'utilisateur.
4. La première activation d'un SUPER_ADMIN déjà connecté doit encore respecter la réauthentification S6-b : un compte à mot de passe saisit le sien ; un compte Firebase/GitHub doit s'être connecté depuis moins de 5 min.

#### Revue architecte (r21) — P9-MFA

**À REPRENDRE.** Détail dans `rapport-audit.md`, section « Revue r21 ». Suites relancées par l'architecte : backend 81/81 suites et 2365/2365 tests (aucun échec de temporisation reproduit, diagnostic accepté) ; frontend 74/74 ; `tsc`, `vite build` et `nest build` OK ; `pnpm install --frozen-lockfile` OK sous Node 20 et pnpm 9.15.4. Dépendance `qrcode-generator@2.0.4` acceptée : intégrité conforme au registre, aucune dépendance, aucun script d'installation. Aucune persistance des secrets dans le code.

À corriger avant validation :

- **P9-MFA-a** : `frontend/src/context/AppContext.tsx:263`, erreur ESLint/Prettier (la CI `pnpm lint` est rouge).
- **P9-MFA-b** : `pnpm-lock.yaml` livré au format natif de pnpm : 9081 lignes de diff au lieu de 11. Le repasser par `npx prettier --write pnpm-lock.yaml`.
- **P9-MFA-c** : test de non-persistance (espion sur `Storage.prototype.setItem` et `console.*`, aucun secret ni code ; plus aucun code dans le DOM après démontage). La mutation « codes en `localStorage` » survit aujourd'hui.
- **P9-MFA-d** : corriger dans cette entrée les affirmations « +11 lignes » et « ESLint : 0 erreur ».

Non bloquants : P9-MFA-e (codes perdus en cas de changement d'onglet), P9-MFA-f (téléchargement sous Safari), P9-MFA-g (texte « mot de passe » pour un compte sans mot de passe). Réponses aux questions 1 à 4 : toutes VALIDÉES (voir le rapport). Nouveaux constats O16 (`no-store`) et O17 (code d'erreur stable), en Phase 5.

#### Reprise r21 (fixeur) — P9-MFA-a à g : CORRIGÉ – À REVOIR

- **a** : indentation de `| 'security'` corrigée dans `AppContext.tsx`. `pnpm lint` à la racine : 0 erreur, 53 avertissements (`no-explicit-any` préexistants).
- **b** : `npx prettier --write pnpm-lock.yaml` ; `git diff --stat pnpm-lock.yaml` : 11 insertions, 0 suppression ; `pnpm install --frozen-lockfile --lockfile-only` passe (sans erreur), puis prettier relancé.
- **c** : test « n'écrit ni secret ni code de secours (stockage, console) et les efface au démontage » dans `SecurityPage.spec.tsx` : espions sur `Storage.prototype.setItem` et `console.log|info|warn|error|debug`, parcours activation puis régénération, contenu de `localStorage`/`sessionStorage`, puis démontage et DOM sans aucun secret ni code. Mutation vérifiée : ajout temporaire de `localStorage.setItem('mut', JSON.stringify(result.recoveryCodes))` dans `confirm` : le test échoue (`expected '[["mut","[\"AAAA-1111\"...' not to contain 'AAAA-1111'`, 1 échec, 9 passés) ; mutation retirée (`grep 'mut'` = 0).
- **d** : chiffres réels après reprise : frontend `pnpm test:run` **76/76** (16 fichiers, dont +2 tests) ; `pnpm build` frontend OK ; `pnpm lint` racine 0 erreur / 53 avertissements ; lockfile +11 lignes. Backend non touché pendant la reprise.
- **e** : nouveau `frontend/src/unsaved-codes.ts` ; `RecoveryCodesPanel` active le drapeau tant qu'il est monté (écouteur `beforeunload`) ; le `setActiveTab` exposé par `AppContext` demande `window.confirm` si des codes sont affichés. Test dédié (confirmation refusée, `beforeunload` annulé, plus de demande après démontage). Limite : la déconnexion n'est pas soumise à la confirmation.
- **f** : lien ajouté au DOM avant `click()` puis retiré ; `URL.revokeObjectURL` différé de 1 s.
- **g** : les formulaires de désactivation et de régénération n'évoquent plus « votre mot de passe » pour un compte sans mot de passe (« connexion de moins de 5 minutes requise »).

#### Revue architecte (r22) — Reprise P9-MFA-a à g

**VALIDÉ.** Détail dans `rapport-audit.md`, section « Revue r22 ». Relancé par l'architecte : `pnpm lint` racine à 0 erreur (53 avertissements) ; frontend 76/76, `tsc` et build OK ; lockfile à +11/−0 ; `--frozen-lockfile` OK sous Node 20.20.2 et pnpm 9.15.4 ; `nest build` OK. Mutations : M1 (codes en `localStorage`), M1b (secret en `sessionStorage`), M1c (`console.debug` des codes) et M3 (drapeau désactivé) sont toutes détectées. Les chiffres de la reprise sont exacts. La limite « déconnexion non soumise à confirmation » est acceptée.

Reste, non bloquant : **P9-MFA-h**. La mutation M2 (`setActiveTab` brut dans `AppContext`) survit. Ajouter un test qui passe par `AppProvider` et `useApp().setActiveTab` avec `confirm` à `false`. Déplacer aussi `vi.restoreAllMocks()` dans un `afterEach`.

Nouveau constat hors P9 : **O18**. Le test S12-e (`rbac-services.spec.ts`) échoue depuis le 2026-11-05, car la fenêtre de capacité de 7 jours contient le 11 novembre. Backend : 2363/2365. À corriger avant le commit : figer l'horloge dans le `describe`.

#### Reprise r22 (fixeur) — O18 et P9-MFA-h : CORRIGÉ – À REVOIR

- **O18** : `backend/tests/unit/authz/rbac-services.spec.ts` : horloge figée au lundi 2026-06-01 (semaine sans jour férié) par `jest.useFakeTimers({ now, doNotFake: [tous sauf Date] })` dans un `beforeEach` du bloc racine, restaurée par `afterEach(jest.useRealTimers)`. Ce bloc couvre tout le fichier, donc aussi les autres tests (sprints datés, optimisation de charge) qui pouvaient dépendre de la date du jour. Code de production inchangé.
  - Preuve (`faketime` absent : préchargement `NODE_OPTIONS=-r` d'un décalage de `Date`) : date système simulée au 2026-11-05 → 72/72 ; au 2026-12-21 → 72/72. Contre-épreuve sans le correctif au 2026-11-05 : 2 échecs (`member` et `contributor : aucun taux dans la réponse`), 70 passés.
- **P9-MFA-h** : test `SecurityPage.spec.tsx` « via AppProvider » : `useApp().setActiveTab('kanban')` avec `window.confirm` → `false` pendant l'affichage des codes laisse l'onglet à `security` (confirm appelé 1 fois) ; avec `true`, l'onglet passe à `kanban`. `vi.restoreAllMocks()` déplacé dans un `afterEach`. Contre-mutation : `setActiveTab` brut exposé dans `AppContext` → échec (`expected "bound " to be called 1 times, but got 0 times`) ; restauré (`grep` = 1).
- **Mesures** : backend `env -u DATABASE_URL npx jest` : 81/81 suites, 2365/2365 tests ; frontend `pnpm test:run` 77/77 (16 fichiers) ; `pnpm build` frontend OK ; `pnpm lint` racine 0 erreur, 53 avertissements.

#### Revue architecte (r23) — O18 et P9-MFA-h ; verdict final du lot

**VALIDÉ. Le lot P9-MFA (volet MFA de P9, points a à h) et O18 est bon pour le commit et le déploiement en production.** Détail dans `rapport-audit.md`, section « Revue r23 ». Relancé par l'architecte :

- backend : 81/81 suites, 2365/2365 tests ; `nest build` et `tsc` OK ;
- frontend : 77/77 ; `tsc` et build OK ;
- `pnpm lint` racine : 0 erreur ;
- lockfile identique à r22 (`--frozen-lockfile` sous Node 20 et pnpm 9.15.4 reste acquis).

O18 : avec 12 dates figées différentes, seul S12-e réagit à la date, et uniquement quand la fenêtre contient un jour férié. L'horloge figée ne masque donc aucun autre test. `doNotFake` ne simule que `Date`, et l'effet est limité au fichier. P9-MFA-h : la contre-mutation M2 est maintenant détectée, et M1 et M3 le restent. Les chiffres de la reprise sont exacts.

Conditions :

- `scim.guard.ts` (modifié par l'utilisateur, hors revue) est à committer séparément, ou après une revue ;
- ne pas committer `.claude/` ;
- ne pas exécuter le seed contre la production avant la correction de **S30**.

Nouveau constat **S30 (Critique)** : mots de passe par défaut dans `backend/prisma/seed.ts:106-108`, dans un dépôt public, et `upsert` qui réattribue `SUPER_ADMIN`. La mesure d'urgence a été prise en production le 2026-11-05. La remédiation du seed est à implémenter en priorité : variables obligatoires, refus en production sans configuration explicite, pas d'élévation à la réexécution, pas de secret dans les journaux, tests `seed.spec.ts`.

---

### S30 — Mots de passe par défaut du seed

**Statut** : CORRIGÉ – À REVOIR.

**Changement** :

- `backend/prisma/seed.ts` (réécrit autour de `resolveSeedConfig`, `runSeed`, `main(env)` exportés ; exécution CLI seulement si `require.main === module`) :
  - plus aucune valeur par défaut : `SEED_ADMIN_PASSWORD`, `SEED_MANAGER_PASSWORD` et `SEED_USER_PASSWORD` obligatoires ; `DATABASE_URL` obligatoire (DSN `root:root_password` supprimé) ; toute la validation précède l'ouverture de la base et de Firebase ;
  - `NODE_ENV` obligatoire et limité à `development|test|staging|production` (une faute de frappe type `prod` est refusée, pas traitée comme un mode non-production) ; en production, refus sauf `SEED_ALLOW_PRODUCTION=true` (et les trois mots de passe), avec avertissement sans secret, et aucun `platformRole` attribué ;
  - mots de passe : 16 caractères minimum, différents entre eux, et différents des trois valeurs publiées ;
  - comptes existants jamais modifiés : `findUnique` puis `create` seulement (plus d'`upsert`) ; rôle, `passwordHash`, `firebaseUid`, `isSuspended` et nom intacts. Hors production, seul `admin@` reçoit `SUPER_ADMIN`, et uniquement à la création ;
  - Firebase : un compte existant n'est jamais mis à jour (ni mot de passe, ni `emailVerified`) ni rattaché ; synchronisation coupée en production sauf `SEED_ALLOW_FIREBASE_IN_PRODUCTION=true` ; l'erreur brute n'est plus journalisée (seule l'adresse l'est) ;
  - plus aucun mot de passe dans les journaux : seules les adresses sont affichées.
- CI : `.gitleaks.toml` (nouveau) et job `secrets-scan` dans `.github/workflows/ci.yml` : gitleaks v8.21.2 (image Docker épinglée par empreinte `sha256:0e99e882…`, aucun paquet npm ajouté) en `detect --no-git`, plus un `git grep` qui échoue si l'une des trois valeurs publiées réapparaît hors `docs/security`.

**Écart par rapport au rapport** (à valider) :

1. Le rapport demande à la fois une liste de refus « en dur » des trois valeurs et un test « `seed.ts` ne contient plus les trois valeurs ». Je concilie les deux par des **empreintes SHA-256** des valeurs publiées : le code source n'a plus les valeurs en clair, et elles restent refusées.
2. Le test et la règle CI de non-réapparition ignorent `docs/security/` (le rapport cite les valeurs pour documenter S30). `seed.spec.ts` assemble les valeurs par concaténation pour ne pas les écrire en clair.
3. Allowlist gitleaks (documentée dans le fichier) : `docs/security/{rapport-audit,journal-corrections}.md`, `backend/tests/` et `.github/workflows/ci.yml` (faux secrets de test et variables de test de la CI). L'analyse porte sur l'arbre courant : les valeurs historiques, restées dans Git, ne bloquent pas la CI (pas de base de référence nécessaire). Limite : un secret ajouté puis retiré dans le même PR n'est pas vu ; un secret dans l'historique n'est pas non plus détecté. Version de gitleaks volontairement figée (v8.21.2, syntaxe `[allowlist]`).

**Tests** : `backend/tests/unit/scripts/seed.spec.ts`, 12 tests (les 8 cas du rapport, la valeur publiée testée pour chacune des trois valeurs, longueur et doublons, SUPER_ADMIN hors production). Contre-mutation : `platformRole` réattribué en production et `update` d'un compte existant rétablis → 2 échecs (production, compte existant) ; seed restauré. Vérification gitleaks sur une copie des fichiers suivis (pas de `.env` local) : arbre propre exit 0 ; valeur publiée réintroduite exit 7 ; faux secret `AKIA…` exit 7.

**Mesures** : backend `env -u DATABASE_URL npx jest` : 82/82 suites, 2377/2377 tests ; `pnpm lint` racine : 0 erreur, 53 avertissements ; `nest build` OK. Le seed n'a jamais été exécuté contre une base ; les tests utilisent un Prisma factice.

**Changement cassant / action requise** : `pnpm seed` exige désormais `NODE_ENV`, `DATABASE_URL` et les trois `SEED_*_PASSWORD` (16 caractères minimum). Les comptes déjà présents ne sont plus mis à jour par le seed ; pour ré-élever ou réinitialiser un compte, utiliser un script dédié et audité. Les trois mots de passe publiés restent compromis dans l'historique Git.

**Questions pour l'architecte** :

1. Valides-tu les empreintes SHA-256 pour concilier « liste de refus » et « source sans les valeurs » ?
2. Le job `secrets-scan` lance Docker sur `ubuntu-latest` (image épinglée par empreinte). Préfères-tu le binaire gitleaks téléchargé avec vérification de somme ?
3. Les actions d'exploitation 1 à 4 du rapport (Firebase, investigation, autres environnements) restent à la charge de l'utilisateur et ne sont pas couvertes par ce code.

#### Revue architecte (r24) — S30

**À REPRENDRE (corrections courtes).** Détail dans `rapport-audit.md`, section « Revue r24 ». Le risque critique est fermé dans le code.

Relancé par l'architecte :

- backend : 82/82 suites et 2377/2377 tests ; `nest build` et `tsc` OK ; `pnpm lint` à 0 erreur ;
- CLI `env -i … tsx prisma/seed.ts` : refus sans `NODE_ENV`, en production sans drapeau, avec une valeur publiée, sans `DATABASE_URL` ;
- empreintes SHA-256 recalculées et conformes ;
- empreinte de l'image gitleaks identique au tag `v8.21.2` sur `ghcr.io` ;
- gitleaks sur l'arbre : exit 0 ; étape `git grep` : passe.

Contre-mutations : A1, B, B2, C1, C2, D1 et F1 sont détectées. A2 est un mutant équivalent (refusé par la liste d'empreintes). **C3, D2 et D3 survivent.**

À corriger :

- **S30-a** : `membership.upsert` et `projectMembership.upsert` ont `update: { role }` et restaurent les rôles de workspace à chaque réexécution. Passer à `update: {}`, avec un test.
- **S30-b** : test des journaux avec `util.inspect` (D2), cas `main()` en production (D3), copie profonde dans le test du compte existant (C3).
- **S30-c** : ne créer un compte Firebase que pour un compte MySQL créé dans la même exécution, avec un test.

Non bloquants : S30-d (allowlist gitleaks trop large : un vrai jeton dans `backend/tests/` ou `ci.yml` n'est pas détecté, vérifié), S30-e (analyse de la plage de commits de la PR), S30-f (`permissions: contents: read`).

Questions :

1. Empreintes SHA-256 : VALIDÉ.
2. Docker épinglé par empreinte : VALIDÉ, à garder.
3. Actions d'exploitation : à la charge de l'utilisateur ; liste à jour dans le rapport.

`README.md` est modifié mais absent de l'entrée : à rattacher à son auteur.

#### Reprise r24 (fixeur) — S30-a à f : CORRIGÉ – À REVOIR

- **S30-a** : `seed.ts` : les 5 `upsert` d'adhésions (3 workspace, 2 projet) passent à `update: {}`. Test : adhésions `VIEWER` existantes toujours `VIEWER` après le seed (fake Prisma à sémantique d'`upsert`), et aucun `upsert` n'a de branche `update` non vide.
- **S30-b** : journaux sérialisés avec `util.inspect` ; test `main()` en production avec `SEED_ALLOW_PRODUCTION=true` (client Prisma simulé, avertissement vérifié émis et sans mot de passe) ; comparaison du compte existant à `structuredClone` pris avant l'exécution. Contre-mutations constatées : D2 (`console.warn(err)` dans le `catch` Firebase) → échec ; D3 (mot de passe dans l'avertissement de `main()`) → échec ; C3 (compte existant modifié en place) → échec ; S30-a (`update: { role }` rétabli) → échec ; S30-c (appel Firebase pour un compte existant) → échec. Seed restauré après chaque mutation (`cmp` identique).
- **S30-c** : `ensureFirebaseAuthUser` n'est plus appelé en amont : il l'est dans `ensureUser`, après le `findUnique`, donc seulement pour un compte MySQL créé dans la même exécution. Test : `admin@` et `manager@` existants, Firebase absent : `createUser` appelé 1 fois (pour `user@` seulement), jamais `updateUser`.
- **S30-d** : `.gitleaks.toml` : exceptions par chemin pour `backend/tests/` et `ci.yml` supprimées ; remplacées par 4 regex sur les valeurs factices (`^test-secret-…-0123456789…$`, `^scim_live_test_key_0123456789$`, `^abcdefghijklmnopqrstuvwxyz123456$`, `^short-1234567$`). Seul le chemin du rapport et du journal reste exclu (ils citent les valeurs publiées). Vérifié sur une copie des fichiers suivis et non suivis non ignorés : arbre actuel exit 0 ; un `ghp_…` réaliste dans `backend/tests/` exit 7 ; dans `ci.yml` exit 7.
- **S30-f** : `permissions: { contents: read }` au niveau du workflow.
- **S30-e** (fait, simple) : sur `pull_request`, étape `gitleaks git` limitée à `base..tête` (`fetch-depth: 0`, `safe.directory` passé au conteneur), l'historique antérieur n'est pas rejoué. Vérifié en local sur `HEAD~3..HEAD` (3 commits, aucune fuite) ; non exécuté sur GitHub.
- `README.md` : modifié dans l'arbre de travail, **pas par moi** (non touché).
- **Mesures** : backend `env -u DATABASE_URL npx jest` 82/82 suites, 2380/2380 tests (+3) ; `pnpm lint` racine 0 erreur, 53 avertissements ; `nest build` exit 0 ; Prettier conforme sur `ci.yml`, `seed.ts`, `seed.spec.ts`.

#### Revue architecte (r25) — Reprise S30-a à f

**VALIDÉ. S30 est bon pour le commit** (pas de déploiement : le seed ne tourne pas en production). Détail dans `rapport-audit.md`, section « Revue r25 ».

Relancé par l'architecte :

- backend : 82/82 suites et 2380/2380 tests ; `nest build` et `tsc` OK ; `pnpm lint` à 0 erreur ;
- 12 contre-mutations, **toutes détectées** : C3, D2, D2b, D3, S30-a (trois adhésions, chacune isolément), S30-c (compte existant, et ordre de r24) ; non-régression A1, B, D1 ;
- gitleaks : arbre exit 0 ; `ghp_` dans `backend/tests/` et dans `ci.yml` exit 7 ; ligne mêlant une valeur factice et un vrai jeton exit 7 ;
- mode `git` sur un clone : PR S30 simulée exit 0 ; ajout de `ghp_` exit 7 ; ajout puis retrait dans la même PR exit 7. L'historique complet donne exit 7 (3 détections dans `c5835ef`), ce qui confirme que limiter la plage à `base..tête` est nécessaire.

Le fonctionnement de `safe.directory` (image en `root`, runner propriétaire) est à confirmer à la première PR réelle.

Pour le commit : lot S30 seulement, sans `README.md`, `scim.guard.ts` ni `.claude/`.

Suivant : **S31**. Les actions d'exploitation de S30 restent à la charge de l'utilisateur.

---

### S31 — Liaison d'identités externes sans réauthentification

**Statut** : CORRIGÉ – À REVOIR.

**Changement** :

- `backend/src/auth/auth.service.ts` :
  - `linkFirebaseAccount(userId, idToken, reauth, sid)` et `linkGitHubAccount(userId, code, state, reauth, sid)` appellent d'abord `assertIdentityReauth` : `assertReauthenticated` (mot de passe, ou connexion de moins de 5 min pour un compte sans mot de passe) puis, si la MFA est active, `verifyCurrentFactor` (code TOTP ou code de secours, pas de temps consommé). Firebase : avant la lecture du jeton ; GitHub : après la vérification locale du `state` et **avant** l'échange du code (aucun appel réseau, aucun jeton si la réauthentification échoue). Toujours avant toute écriture.
  - Nouvelles `unlinkIdentity(userId, 'firebase'|'github', reauth, sid)` (même réauthentification ; 409 si l'identité n'est pas liée ; 409 si aucune autre méthode de connexion : `passwordHash`, autre identité externe ou `ssoUid` ; champs remis à `null`, `githubAccessToken` effacé ; `revokeAllForUser(userId, sid)`) et `getIdentities` (adresse Firebase, nom GitHub, sans jeton).
  - `recordIdentityChange` : entrée `AuditLog` (`IDENTITY_LINKED` / `IDENTITY_UNLINKED`, `changes` = fournisseur, identifiant affichable, `sid`, aucun secret) et e-mail au titulaire, au mieux (un échec d'envoi n'annule pas l'opération).
  - Protections conservées : 409 si l'identité est liée ailleurs, e-mail Firebase vérifié exigé, aucune liaison par e-mail, aucune création de compte Firebase.
- `backend/src/auth/auth.controller.ts` : `POST /auth/firebase/link` et `/auth/github/link` transmettent la preuve (`FirebaseLinkDto`, `GithubLinkDto`) et le `sid` ; nouvelles `POST /auth/firebase/unlink` et `/auth/github/unlink` (204, `@ForbiddenInImpersonation()`, limitées à 5/min) ; `GET /auth/identities`.
- `backend/src/auth/dto/identity.dto.ts` (nouveau) : `password?`, `mfaCode?` (6 chiffres), `recoveryCode?` ; `mfaCode` et non `code` pour ne pas entrer en collision avec le `code` OAuth de GitHub.
- `backend/src/mail/mail.service.ts` : `sendIdentityLinkedEmail`, `sendIdentityUnlinkedEmail` (fournisseur, identifiant, date, lien vers l'application ; aucun jeton).
- Schéma : `User.firebaseEmail String?` et migration `backend/prisma/migrations/20261113000000_s31_firebase_email/migration.sql` (additive, nullable). Point 5 du rapport : l'adresse liée est conservée plutôt que relue par l'Admin SDK.
- Doc : `docs/deployment-production.md:68-71` remplacé par le texte du rapport ; `grep -n "associe alors" docs/deployment-production.md` ne renvoie plus rien.

**Choix : mot de passe dans le corps, pas de `POST /auth/reauth`.** Le mot de passe (et le code MFA) est envoyé avec `code`/`state` au retour de la redirection. Raisons : aucun état serveur supplémentaire (pas de marqueur de session à poser, à expirer et à consommer, donc pas de condition de course ni de marqueur oublié exploitable), même mécanisme que `setupMfa`/`disableMfa` (`assertReauthenticated`), une seule requête atomique, preuve liée à l'action exacte. Le mot de passe n'est jamais conservé côté navigateur ni dans le `state`. Contrepartie : l'écran de P9 doit demander le mot de passe au retour de GitHub (déjà prévu au rapport).

**Tests** :

- Nouveau `backend/tests/unit/auth/identity-linking.spec.ts` (34 tests, FakePrisma + vrai `SessionService`) : paramétré `{firebase, github}` × `{mot de passe, sans mot de passe}` : mot de passe absent/faux = 403, aucun `user.update`, aucun `verifyIdToken`, aucun `fetch` ; sans mot de passe, connexion de plus de 5 min = 403, de moins = liaison ; MFA sans code ou code faux = 400 et aucune écriture, code valide = liaison et pas de temps consommé (rejeu refusé) ; notification vers l'adresse du compte, entrée d'audit sans secret ; adresse liée renvoyée ; 409 si liée ailleurs ; e-mail Firebase non vérifié refusé. Déliaison : seule méthode = 409 sans écriture ; avec une autre méthode (mot de passe, ou l'autre identité) = champs à `null`, `githubAccessToken` effacé, notification, audit, autres sessions révoquées et session courante conservée ; sans réauthentification ou MFA sans code = rien modifié ; identité non liée = 409 ; `getIdentities` sans jeton.
- `impersonation-routes.spec.ts` : `unlinkGitHub` et `unlinkFirebase` dans la liste interdite, balayage méta étendu à `/(un)?link$/` et routes `unlink` attendues.
- `session-lifecycle.spec.ts` (HTTP) : `POST /auth/firebase/link` avec session valide sans mot de passe = 403 (et avec un mot de passe faux), aucune lecture du jeton ; avec le mot de passe = 2xx, e-mail envoyé ; `unlink` = 204.
- Adaptés : `auth.service.spec.ts` (link Firebase avec compte et session récente), `github-oauth.spec.ts` (liaisons avec mot de passe), `fake-prisma.ts` (table `auditLog`).
- Contre-mutations (échecs constatés, code restauré, `cmp` identique) : M1 liaison Firebase sans réauthentification (6 échecs) ; M2 GitHub, réauthentification après l'échange du code (5) ; M3 MFA ignorée (8) ; M4 dernière méthode non protégée (2) ; M5 sessions non révoquées (2) ; M6 jeton GitHub non effacé (1) ; M7 `@ForbiddenInImpersonation` retiré de `unlinkGitHub` (2).

**Mesures** : voir le rapport de remise (suite backend complète, `pnpm lint`, `nest build`).

**Changements cassants / reprise** :

- `POST /auth/github/link` et `/auth/firebase/link` exigent désormais la preuve de réauthentification : le frontend actuel (`frontend/src/github-oauth.ts`, `linkGitHub`) envoie seulement `{ code, state }` et recevra un 403 pour un compte à mot de passe. Aucun écran n'appelle aujourd'hui ces routes (écran de liaison de P9, hors périmètre, à construire sur ce contrat) ; le frontend n'est pas modifié.
- Migration `20261113000000_s31_firebase_email` (additive) à appliquer par `prisma migrate deploy` avant le déploiement : sans la colonne, `loadIdentityAccount` échoue. Les liaisons Firebase existantes ont `firebaseEmail = NULL` jusqu'à une nouvelle liaison (affichage « adresse inconnue »).

**Questions pour l'architecte** :

1. Valides-tu le choix « mot de passe dans le corps » plutôt que `POST /auth/reauth` ?
2. L'ordre pour GitHub est : état OAuth (local) puis réauthentification puis échange du code. Un `state` invalide ne consomme donc pas de code TOTP.
3. `getIdentities` (`GET /auth/identities`) est ajouté pour le futur écran ; il n'est pas listé au rapport.

#### Revue architecte (r26) — S31

**VALIDÉ. Bon pour le commit et le déploiement en production**, aux conditions listées dans `rapport-audit.md`, section « Revue r26 ».

Mesures relancées par l'architecte :

- backend : 83/83 suites et 2421/2421 tests ; `nest build`, `tsc` et `prisma validate` OK ;
- `pnpm lint` racine : 0 erreur ;
- frontend : 77/77, `tsc` et build OK ;
- la migration est identique au différentiel de schéma calculé par Prisma ;
- `grep "associe alors"` est vide.

14 contre-mutations, toutes détectées :

- réauthentification retirée (liaison Firebase, liaison GitHub, déliaison) ;
- MFA non exigée ;
- échange du code GitHub avant la réauthentification ;
- dernière méthode de connexion autorisée (deux variantes) ;
- sessions non révoquées, ou session courante révoquée ;
- `@ForbiddenInImpersonation` retiré de chaque route `unlink` ;
- audit et notification supprimés ;
- jeton GitHub conservé.

Questions :

1. Mot de passe dans le corps : VALIDÉ.
2. Ordre `state`, puis réauthentification, puis échange du code : VALIDÉ.
3. `GET /auth/identities` : VALIDÉ.

Le frontend `linkGitHub` (`{ code, state }`) est dormant : aucun écran ne lance la finalité `link` ni `repos`. Il donnera 403 tant que P9 ne l'aura pas adapté, sans régression visible.

Nouveau constat **S31-a (Mineur)** : deux déliaisons simultanées peuvent retirer la dernière méthode de connexion. Rendre l'écriture conditionnelle, avec l'écran de liaison de P9.

Non bloquants :

- `ssoUid` ancien compté comme méthode ;
- remplacement silencieux d'une identité déjà liée ;
- `MaxLength` manquant sur `idToken`.

---

## Reprise après r26 (fixeur) — P9, volet liaison d'identités, et S31-a

### S31-a — Déliaison atomique (dernière méthode de connexion)

**Statut** : CORRIGÉ – À REVOIR.

**Changement** :

- `backend/src/auth/auth.service.ts` (`unlinkIdentity`) : le `prisma.user.update` non conditionnel est remplacé par `updateMany` dont le `where` porte la condition : identité encore liée **et** `OR` (`passwordHash` non nul, `ssoUid` non nul, autre identité non nulle). `count === 0` donne 409 avant toute révocation de session, audit ou notification. Le contrôle en lecture est conservé pour les messages précis (non lié, dernière méthode).
- `backend/tests/http/fake-prisma.ts` (`matchValue`) : un champ nullable jamais renseigné (`undefined`) est comparé comme `null`, comme le fait la base (`{ not: null }` sinon vrai à tort pour un champ absent).

**Tests** (`identity-linking.spec.ts`, 3 nouveaux, 37 au total) : `Promise.allSettled` de `firebase/unlink` et `github/unlink` sur un compte sans mot de passe à deux identités : une seule réussit, l'autre est un `ConflictException`, il reste une identité, une seule notification ; avec un mot de passe, les deux réussissent ; la même identité déliée deux fois en parallèle : une seule écriture, l'autre 409. Les tests « aucune écriture » de la déliaison espionnent désormais `updateMany` (l'espion sur `update` serait devenu vacueux).

**Contre-mutation** : `where` réduit à `{ id }` : 2 échecs (course, double déliaison) ; code restauré, `cmp` identique.

### P9 (volet liaison) — écran des identités liées

**Statut** : CORRIGÉ – À REVOIR (volet liaison seulement ; voir « Reste ouvert »).

**Changement (frontend)** :

- `src/security-api.ts` : `getIdentities`, `linkFirebase`, `unlinkIdentity`, type `IdentityProof` (`password?`, `mfaCode?`, `recoveryCode?`).
- `src/github-oauth.ts` : `linkGitHub(code, state, proof)` envoie la preuve (champs vides omis), renvoie `githubUsername`, lève `SecurityApiError` (statut conservé).
- `src/components/IdentityProofFields.tsx` : champs de preuve partagés (mot de passe si le compte en a un, code TOTP ou de récupération si MFA active, rappel « connexion de moins de 5 minutes » sinon). Rien n'est conservé après l'envoi.
- `src/components/IdentitiesSection.tsx` (affiché sous l'écran MFA, onglet `security`) : liste GitHub et Firebase. Lier GitHub = `startGitHubAuthorization('link')`. Lier Firebase = connexion Firebase (e-mail vérifié exigé), session Firebase du navigateur refermée aussitôt, puis **écran de confirmation qui affiche l'adresse Firebase avant validation** et avertit si elle diffère de l'adresse du compte, puis preuve et `POST /auth/firebase/link`. « Délier » : preuve puis `/auth/<fournisseur>/unlink` ; **désactivé avec explication quand c'est la dernière méthode** (ni mot de passe ni autre identité). Le mot de passe Firebase n'est jamais envoyé au backend ; le jeton Firebase ne vit qu'en mémoire.
- `src/components/GitHubLinkConfirm.tsx` : au retour de GitHub avec la finalité `link` ou `repos`, `App.tsx` n'appelle plus `/auth/github/link` : il affiche cet écran (adresse du compte, preuve), puis `linkGitHub`. Après un échec, plus de nouvel essai avec le même code : bouton « Recommencer avec GitHub » (voir question 2).
- `src/App.tsx` : routage du retour GitHub, écran de confirmation, composition de l'onglet `security`.

**Tests ajoutés (19)** : `GitHubLinkConfirm.spec.tsx` (7 : aucun appel de liaison avant confirmation, mot de passe, `mfaCode`, `recoveryCode` sans `mfaCode`, compte sans mot de passe, 403 sans nouvel essai, annulation, texte `repos`) ; `IdentitiesSection.spec.tsx` (8 : « Lier GitHub » = finalité `link` sans appel de liaison, adresse Firebase affichée et avertissement avant confirmation et rien d'envoyé avant la preuve, pas d'avertissement à adresse égale, adresse non vérifiée refusée, « Délier » désactivé pour la dernière méthode et actif sinon, déliaison avec mot de passe et MFA, déliaison refusée) ; `App.github-return.spec.tsx` (3 : `link` et `repos` affichent la confirmation sans appeler `/auth/github/link`, `login` connecte) ; `github-oauth.spec.ts` (+1 : preuve envoyée, champs vides omis, statut remonté).

**Contre-mutations frontend (11, toutes détectées, fichiers restaurés et comparés)** : mot de passe omis de la preuve (4 échecs) ; MFA omise (3) ; dernière méthode déliable (1) ; avertissement d'adresse différente supprimé (1) ; retour `link` traité comme `login` (2) ; liaison GitHub immédiate sans preuve dans `App.tsx` (2) ; nouvel essai permis après échec (1) ; `linkGitHub` sans preuve (4) ; Firebase lié sans écran de confirmation (2) ; adresse Firebase non vérifiée acceptée (1) ; mot de passe Firebase transmis au backend (1).

**Mesures réelles** :

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | 83/83 suites, **2424/2424** (2421 avant) |
| `nest build` ; `tsc --noEmit -p tsconfig.build.json` | exit 0 ; exit 0 |
| `cd frontend && pnpm test:run` | 19 fichiers, **96/96** (77 avant) |
| `tsc --noEmit -p .` ; `pnpm build` | exit 0 ; build OK |
| `pnpm lint` racine | **0 erreur**, 53 avertissements (inchangé) |
| Prettier sur les fichiers touchés | conforme |

**Changements cassants** : aucun d'API. Les fichiers `InvitationAcceptance.tsx` et `Login.css` (modifications de l'utilisateur) n'ont pas été touchés.

**Reste ouvert dans P9** : écran « Sessions actives » (liste, `DELETE /auth/sessions/:sid`, « Fermer les autres sessions » après l'activation MFA, cf. r21 point 3) et bouton « Connecter un dépôt » (finalité `repos`, dans les intégrations). Le routage du retour `repos` et sa confirmation sont prêts ; aucun écran ne démarre encore cette finalité.

**Écarts et questions pour l'architecte** :

1. **Adresse avant confirmation pour GitHub (condition 5).** Le nom d'utilisateur GitHub n'est connu qu'après l'échange du code, qui vient **après** la réauthentification (ordre validé en r26). L'écran de confirmation GitHub affiche donc l'adresse du compte Planner-Pro et annonce que le nom GitHub s'affichera après la liaison (et dans l'e-mail de notification), mais ne peut pas l'afficher avant. Pour le montrer avant, il faudrait une route d'aperçu qui consomme le code OAuth (à usage unique) ; je ne l'ai pas créée. Acceptes-tu cet écart pour GitHub (Firebase est conforme) ?
2. **Cookie de `state` effacé dès le premier essai** (`auth.controller.ts`, `linkGitHub` : `clearCookie` avant le service). Un mot de passe faux au retour de GitHub oblige à repartir de GitHub. Le frontend le gère (message et « Recommencer avec GitHub »). Alternative backend : n'effacer le cookie qu'après une réauthentification réussie, ce qui permettrait de ressaisir le mot de passe. Je n'y ai pas touché (ordre S9-b validé) : préfères-tu cette variante ?
3. **« Délier » désactivé côté frontend** se base sur `hasPassword` ou l'autre identité ; `GET /auth/identities` n'expose pas `ssoUid`. Un compte dont la seule autre méthode est un `ssoUid` voit le bouton désactivé alors que le serveur l'autoriserait. Ajouter un booléen `hasSso` (ou `canUnlink`) à `getIdentities` ?
4. `GET /auth/identities` ne renvoie pas l'adresse du compte : elle est passée par `App.tsx` (`user.email`).
5. Non traités (non bloquants r26) : `MaxLength` de `idToken`, notification « déliée » lors du remplacement d'une identité, vérification de la configuration SSO pour `ssoUid`.

#### Revue architecte (r27) — S31-a et P9 (volet liaison)

Détail dans `rapport-audit.md`, section « Revue r27 ».

**S31-a : VALIDÉ.**

- L'`updateMany` conditionnel suivi d'un 409 si `count === 0` est atomique sous InnoDB.
- Les tests de course sont pertinents.
- Le correctif de `fake-prisma` est juste. Il ne porte cependant pas les tests S31-a, car le faux initialise déjà les champs d'identité à `null`.

**P9, volet liaison : À REPRENDRE (points mineurs).**

Le volet est conforme aux exigences de sécurité r23-bis et r26 :

- aucune liaison sans preuve ;
- adresse Firebase affichée avant validation, avec un avertissement si elle diffère ;
- mot de passe Firebase jamais transmis au backend ;
- « Délier » désactivé pour la dernière méthode.

À reprendre :

- **P9-L-a** : ajouter `canUnlink: { firebase, github }` à `GET /auth/identities`. La valeur est calculée par une fonction unique `hasOtherLoginMethod`, partagée avec `unlinkIdentity` (elle compte `ssoUid`). Le frontend l'utilise au lieu de recalculer la règle. Tests attendus :
  - backend : compte sans mot de passe avec `ssoUid` et GitHub, `canUnlink.github` vrai et déliaison réussie ;
  - backend : compte avec une seule méthode, `canUnlink` faux ;
  - frontend : bouton actif ou désactivé selon `canUnlink` ;
  - la mutation « `ssoUid` retiré du `OR` » doit être détectée.
- **P9-L-b** : relire `getIdentities()` à l'ouverture de chaque formulaire de preuve (« Délier », étape de confirmation Firebase), pour ne pas garder un `mfaEnabled` périmé après une action dans `SecurityPage`. Test : première réponse `mfaEnabled: false`, seconde `true`, le champ du code s'affiche et `mfaCode` est envoyé.
- **P9-L-c** : `linkNotice` (`App.tsx`) ne doit s'afficher qu'une fois. Test : après un changement d'onglet puis un retour sur `security`, la notice a disparu.
- **P9-L-d** : test paramétré `link`/`repos`. Après un 403, « Recommencer avec GitHub » appelle `startGitHubAuthorization` avec la même finalité. La mutation « relance en `login` » n'est aujourd'hui pas détectée.
- Facultatif :
  - **P9-L-e** : « depuis votre profil » devient « depuis « Sécurité du compte » » (`auth.service.ts:239`, `:400`) ;
  - `@MaxLength(4096)` sur `idToken`.

**Mesures relancées** :

- backend : 83/83 suites et 2424/2424 tests ; `nest build` et `tsc` OK ;
- frontend : 96/96, `tsc` et `pnpm build` OK ;
- `pnpm lint` : 0 erreur (53 avertissements) ;
- Prettier conforme.

**14 contre-mutations de l'architecte** :

- 11 détectées : B1 à B3, F1 à F7, F9 ;
- B4 (`ssoUid`) non détectée : traitée par P9-L-a ;
- B5 (`fake-prisma`) non détectée, mais équivalente ;
- F8 (finalité de relance) non détectée : traitée par P9-L-d.

Tous les fichiers ont été restaurés (`filecmp`, `git status` et `md5sum` identiques).

**Réponses aux questions** :

1. Condition 5 pour GitHub : **écart accepté.** Afficher le nom avant la preuve imposerait d'échanger le code d'abord, ce qui est refusé. Le nom est affiché aussitôt après la liaison et figure dans l'e-mail. La remédiation est mise à jour dans le rapport.
2. Cookie de `state` effacé au premier essai : **conserver le comportement actuel.** Le `state` reste à usage unique quelle que soit l'issue, sans fenêtre de rejeu. Le retour par GitHub coûte peu.
3. Pas de `ssoUid` ni de `hasSso` : **exposer `canUnlink`** par fournisseur (P9-L-a).
4. Adresse passée par `user.email` : **OK.**

**Constats ouverts** :

- P9-L-a à P9-L-d (à reprendre) ;
- P9-L-e et `MaxLength` de `idToken` (facultatifs) ;
- P9, « Sessions actives » et « Connecter un dépôt » ;
- non bloquants r26 : remplacement d'identité, configuration SSO ;
- S30, actions d'exploitation 1 à 4 ;
- Phases 5 et 6 (S19 à S26, A5 à A9, P2, P5, P7, P8, Q-2, O10 à O17).

---

## Reprise r27 (fixeur) — P9 volet liaison : P9-L-a à P9-L-e

**Statut** : CORRIGÉ – À REVOIR (P9-L-a, b, c, d ; P9-L-e et `MaxLength` faits).

**P9-L-a — règle unique.** `auth.service.ts` : fonction `hasOtherLoginMethod(account, provider)` (mot de passe, `ssoUid`, autre identité), utilisée par le contrôle en lecture de `unlinkIdentity` et par `getIdentities`, qui renvoie `canUnlink: { firebase, github }` (vrai seulement si l'identité est liée **et** qu'une autre méthode existe ; ni `ssoUid` ni `hasSso` exposés). L'écriture conditionnelle (`updateMany`) reste le miroir SQL de la règle. Frontend : `IdentitiesSection` lit `identities.canUnlink[provider]`, plus aucun recalcul ; type `Identities` mis à jour.
Tests backend (`identity-linking.spec.ts`) : compte sans mot de passe avec `ssoUid` + GitHub : `canUnlink.github` vrai et déliaison réussie ; méthode unique : faux et 409 ; mot de passe + une identité ; deux identités sans mot de passe. Frontend : bouton actif (`canUnlink.github: true`, sans mot de passe) / désactivé avec explication (`false`).
Contre-mutations backend : B4a `ssoUid` retiré du `OR` SQL (détectée, 1 échec) ; B4b `ssoUid` retiré de `hasOtherLoginMethod` (détectée, 1) ; `canUnlink` sans la condition « lié » (détectée, 3). Frontend : règle recalculée côté client (détectée, 1) ; `canUnlink` ignoré (détectée, 6).

**P9-L-b — MFA périmée.** `IdentitiesSection` relit `getIdentities()` à l'ouverture de « Délier » (avant d'afficher le formulaire) et avant l'étape de confirmation Firebase. Un échec de relecture n'ouvre pas le formulaire. Tests : 1re réponse `mfaEnabled: false`, 2e `true` : champ « Code à 6 chiffres » affiché et `mfaCode` envoyé (déliaison et liaison Firebase) ; cas inverse (MFA désactivée) : pas de champ. Mutations : pas de relecture à « Délier » (3 échecs), pas de relecture avant confirmation Firebase (2).

**P9-L-c — notice consommée une fois.** Prop `onNoticeShown` : `IdentitiesSection` l'appelle au montage si une notice est transmise ; `App.tsx` remet `linkNotice` à `''`. Test `App.link-notice.spec.tsx` : liaison réussie, notice affichée, changement d'onglet puis retour : disparue. Mutation « jamais consommée » : détectée (2).

**P9-L-d — relance avec la même finalité.** Test paramétré `link`/`repos` dans `GitHubLinkConfirm.spec.tsx` : après un 403, « Recommencer avec GitHub » appelle `startGitHubAuthorization(purpose)`. Mutation F8 (relance en `login`) : détectée (2).

**P9-L-e et `MaxLength`.** Messages 409 : « depuis votre profil » remplacé par « depuis « Sécurité du compte » » (`auth.service.ts`, 2 occurrences ; `grep "depuis votre profil" backend/src` vide ; aucun test ne vérifiait ce texte). `FirebaseLinkDto.idToken` : `@MaxLength(4096)`, test aux bornes 4096 / 4097.

**Mesures réelles** :

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | 83/83 suites, **2429/2429** (2424 avant). Un premier passage complet a eu 1 échec, `tests/http/mfa-ticket.spec.ts` (sous charge) ; la suite seule donne 14/14 et le second passage complet 2429/2429 : échec intermittent, non lié au lot (pas de lien avec l'identité) |
| `nest build` ; `tsc --noEmit -p tsconfig.build.json` | exit 0 ; exit 0 |
| `cd frontend && pnpm test:run` | 20 fichiers, **104/104** (96 avant) |
| `tsc --noEmit -p .` ; `pnpm build` | exit 0 ; build OK |
| `pnpm lint` racine | **0 erreur**, 53 avertissements. Une erreur a été introduite puis corrigée en cours de travail (commentaire `eslint-disable react-hooks/exhaustive-deps` : règle absente de la configuration), retiré |
| Prettier sur les fichiers du lot | conforme |

**Changement d'API** : `GET /auth/identities` gagne `canUnlink` (additif). Aucune migration. `InvitationAcceptance.tsx` et `Login.css` non touchés (Prettier lancé uniquement sur les fichiers du lot).

**Reste hors lot** : « Sessions actives », « Connecter un dépôt ; non bloquants r26 : notification « déliée » au remplacement d'une identité, vérification de la configuration SSO active pour `ssoUid`.

**Questions pour l'architecte** : aucune.

#### Revue architecte (r28) — P9 (volet liaison), reprise P9-L-a à P9-L-e

Détail dans `rapport-audit.md`, section « Revue r28 ».

**P9-L-a, P9-L-b, P9-L-c, P9-L-d, P9-L-e et `MaxLength(4096)` de `idToken` : VALIDÉ. Le volet liaison de P9 est CLOS.**

**Mesures relancées** :

- backend : 83/83 suites et 2429/2429 au second passage complet (machine seule) ; `nest build` et `tsc` OK ;
- frontend : 20 fichiers, 104/104 ; `tsc` et build OK ;
- `pnpm lint` : 0 erreur ;
- Prettier conforme ;
- `grep "depuis votre profil"` vide.

**22 contre-mutations de l'architecte** :

- 21 détectées, dont B4 (`ssoUid`) et F8 (finalité de relance), non détectées en r27 ;
- B6 (`canUnlink.github` sans la condition « lié ») non détectée, sans effet fonctionnel.

Amélioration non bloquante : ajouter le cas « mot de passe et Firebase seul lié : `canUnlink.github === false` ».

**Échec intermittent de `mfa-ticket.spec.ts`** : reproduit au premier passage complet, lancé en même temps que la suite frontend. En cause, le test « login, Redis en mode `hang` : 503 en moins de 3 s ». L'instabilité est **préexistante** (`c5f1391`) et **sans lien avec le lot**. La borne de 3 s ne laisse qu'1 s de marge, après le délai Redis de 2 s, pour Argon2 sous charge. Elle devient le nouveau constat **O19 (Mineur, qualité des tests)**. Remédiation : délai Redis injectable (200 ms en test HTTP, borne à 2 s) et test unitaire de la valeur par défaut avec des minuteries simulées. Critère : 5 passages complets en parallèle du frontend sans échec.

**Constats ouverts** :

- P9 : « Sessions actives » et « Connecter un dépôt » ;
- O19 ;
- non bloquants r26 : remplacement d'identité, configuration SSO ;
- S30, actions d'exploitation 1 à 4 ;
- Phases 5 et 6 (S19 à S26, A5 à A9, P2, P5, P7, P8, Q-2, O10 à O17).

---

## Travail Gemini (InvitationAcceptance / Login.css)

**Statut** : CORRIGÉ – À REVOIR.

**Périmètre** : `frontend/src/components/InvitationAcceptance.tsx` et `Login.css` (modifications non commitées d'un autre assistant ; interdiction de les toucher levée pour ce lot).

**Constats** :

- `InvitationAcceptance.tsx` : seul changement réel par rapport à HEAD : le logo passe à `<div className="login-logo-container"><img className="login-logo"/></div>`, structure identique à `Login.tsx:302` et `AccountLinkPage.tsx:51`. Correct. Le fichier est cohérent : tous les imports (`useApp`, `startGitHubAuthorization`, icônes `lucide-react`, `logo`) et tous les états et handlers (`name`, `handleBypass`, `handleGitHubLogin`, `handleAccept`, `handleGoToApp`) sont utilisés ; `tsc` passe ; aucun import, état ni handler orphelin.
- `Login.css` : `object-fit: contain` ajouté sur `.login-logo` (utile, l'élément est maintenant l'`<img>`). La règle `.login-logo img` était du code mort (`grep` : aucune utilisation hors `Login.css`) : **supprimée**. La media query mobile `.login-logo` (60 px) s'applique bien à l'`<img>` ; `.login-logo:hover` aussi.
- **Disparition de la connexion/inscription classiques** : `classicLogin`, `classicRegister` et `authMode` **ne figurent ni dans HEAD (`git show HEAD:…` : 0 occurrence), ni dans l'historique de ce fichier (`git log -S classicRegister` : vide), ni dans un stash**. Les ~185 lignes constatées plus tôt n'existaient donc que dans l'arbre de travail et sont perdues ; elles n'ont **pas** été réimplémentées. État actuel : un visiteur non connecté arrivant par un lien d'invitation ne peut se connecter que par GitHub ou par le compte de démonstration (`mockLogin`, refusé en production par le backend). **Un utilisateur avec un compte e-mail et mot de passe ne peut pas se connecter depuis cette page**, et `App.tsx` affiche `InvitationAcceptance` avant `Login` tant que le jeton est dans l'URL. **Décision produit à prendre par l'utilisateur** : réintégrer le formulaire (ou un lien vers `Login` en conservant le jeton), ou accepter GitHub seul.
- Constaté, non modifié (préexistant, hors périmètre) : le formulaire « compte de démo » est affiché sans condition d'environnement, ici et dans `Login.tsx:100` ; en production il échoue avec « Erreur d'authentification ».

**Changements** : `Login.css` : suppression de la règle `.login-logo img` (Prettier a normalisé la ligne vide laissée). `InvitationAcceptance.tsx` : aucun changement.

**Mesures** : frontend `pnpm test:run` 20 fichiers, 104/104 ; `tsc --noEmit -p .` exit 0 ; `pnpm build` OK ; `pnpm lint` racine 0 erreur ; Prettier conforme sur les deux fichiers.

**Question pour l'architecte et l'utilisateur** : réintégrer la connexion par e-mail/mot de passe dans le parcours d'invitation ?

#### Revue architecte (r29) — Travail Gemini (InvitationAcceptance, Login.css)

Détail dans `rapport-audit.md`, section « Revue r29 ».

**VALIDÉ** (correctif d'affichage du logo).

- Le diff réel se limite à la structure `login-logo-container` / `img.login-logo` et à `object-fit: contain`. Le retrait de `.login-logo img`, règle morte qui n'existait pas à HEAD, est correct.
- Rendu vérifié en headless Chrome avec la feuille du build : 72 px à 1280 px et 60 px à 375 px (la media query l'emporte), aucun débordement. Le survol s'applique à l'`<img>`.
- Mesures : frontend 20 fichiers, 104/104 ; `tsc` et build OK ; lint sans erreur ; Prettier conforme.

**Correction du journal** : les formulaires e-mail et mot de passe disparus **sont récupérables**. Ils se trouvent dans le journal local de Gemini, `~/.gemini/antigravity/brain/fc2d2132-…/.system_generated/logs/transcript_full.jsonl`, étapes 229, 231 et 237. **Je déconseille de les restaurer** :

- ils ignorent le défi MFA renvoyé par `classicLogin` ;
- ils dupliquent `Login` sans mot de passe oublié, Firebase ni SSO.

Les scripts de l'architecte n'ont jamais modifié ce fichier : `md5sum` identique en r27 et en r28.

**Question « réintégrer e-mail et mot de passe ? »** : je recommande l'**option B**. Elle réutilise le composant `Login` dans le contexte de l'invitation, avec un jeton conservé en `sessionStorage`, plutôt que de dupliquer les formulaires (A) ou de se limiter à GitHub (C). En effet, même GitHub perd aujourd'hui le jeton au retour d'OAuth : `redirect_uri` est l'origine du frontend. La décision revient à l'utilisateur.

Le défaut est instruit sous **P13 (Majeur, produit)**, en reprenant l'identifiant de la section ajoutée par Gemini dans le rapport. Sa remédiation est remplacée : le pré-remplissage de l'adresse complète est **interdit** par S27.

Le compte de démo est déjà couvert côté serveur par **S26**. Son volet `mock/login` est avancé dans **P13-e**. L'affichage côté client relève de **P13-d**.

**Prochain lot pour le fixeur, dans l'ordre** :

1. **O19** (remédiation r28).
2. **P13-a à P13-e** : jeton conservé et retiré de l'URL au montage, `Login` réutilisé, « Changer de compte » sur un 403, démo seulement si `import.meta.env.DEV`, `mock/login` enregistrée seulement si `ENABLE_DEV_AUTH=true` et `NODE_ENV=development`.
3. **P9-S** « Sessions actives » : `POST /auth/sessions/revoke-others`, `SessionsSection`, proposition de fermeture après l'activation de la MFA.
4. **P9-R** « Connecter un dépôt » :
   - côté backend : `GithubSyncDto`, `assertProject(…, 'project.manage')`, vérification du dépôt auprès de GitHub, 409 sur le remplacement d'une identité GitHub ;
   - côté frontend : `IntegrationsPanel`.

Exigences précises, tests attendus et critères d'acceptation : voir le rapport, section r29.

**Constats ouverts** :

- O19 ;
- P13 ;
- P9-S ;
- P9-R ;
- S26 (reste) ;
- non bloquant r26 : configuration SSO ;
- S30, actions d'exploitation 1 à 4 ;
- Phases 5 et 6 (S19 à S26, A5 à A9, P2, P5, P7, P8, Q-2, O10 à O17).

---

## Lot r29 (fixeur) — O19, puis P13 (option B) avec le volet `mock/login` de S26

**Statut** : O19 et P13-a à P13-e : CORRIGÉ – À REVOIR. P9-S et P9-R : **non traités** (voir fin de section).

### O19 — borne de temps instable de `mfa-ticket.spec.ts`

- `auth.service.ts` : délai Redis du parcours MFA injectable (jeton `MFA_REDIS_TIMEOUT_TOKEN`, `@Optional()`, valeur par défaut `MFA_REDIS_TIMEOUT_MS = 2000`). Aucun changement en production.
- `tests/http/mfa-ticket.spec.ts` : délai fixé à 200 ms, borne de réponse `elapsed < 2000` (marge d'environ 1,8 s pour Argon2).
- `tests/unit/auth/mfa-redis-timeout.spec.ts` (nouveau, 4 tests, temporisateurs simulés) : défaut de 2000 ms ; une commande suspendue est rejetée (503) à 2000 ms et pas avant ; délai injecté respecté ; commande rapide inchangée.
- Contre-mutation : `Promise.race` supprimé (attente infinie) : 4 échecs (HTTP et unitaire). Code restauré, `cmp` identique.
- **Critère** : 5 passages complets de `npx jest` lancés en même temps que 6 exécutions de la suite frontend : **5/5 verts** (84 suites, 2433 tests chacun), aucun échec de `mfa-ticket.spec.ts`.

### P13 — parcours d'invitation avec `Login` réutilisé

**Frontend**

- `src/invitation-store.ts` (nouveau) : `captureInviteFromUrl` (retire `?token=`/`?invite=` de l'URL dès la lecture, enregistre `{ token, expiresAt: +30 min }` sous `planner_pending_invite` en `sessionStorage` uniquement), `readPendingInvite` (ignore et supprime une entrée expirée ou illisible), `clearPendingInvite`, `InvitationApiError` (conserve le statut HTTP). Le jeton n'est ni en `localStorage`, ni dans le `state` OAuth.
- `App.tsx` : jeton initial = URL puis entrée en attente ; `InvitationAcceptance` reçoit `oauthError` et `initialMfaTicket` ; la déconnexion explicite de l'en-tête supprime l'entrée.
- `InvitationAcceptance.tsx` : formulaire de démo et bouton GitHub propre **supprimés** (aucun formulaire d'authentification dupliqué). Non connecté : résumé (espace, invitant, rôle, adresse **masquée**) et bouton « Se connecter ou créer un compte » qui affiche `Login` avec un bandeau. Connecté : clic explicite sur « Accepter » (jamais automatique). 403 : message du serveur, adresse masquée, « Changer de compte » (déconnexion qui conserve l'entrée) et « Ignorer l'invitation ». Entrée supprimée après acceptation, ignorance, ou toute autre erreur d'acceptation, ou jeton invalide. Un retour OAuth en erreur ou un défi MFA tardif ramène à `Login` (même écran déjà monté).
- `Login.tsx` : prop `invitation` (bandeau « Invitation à rejoindre {espace}, connectez-vous avec l'adresse {masquée} », « Retour à l'invitation », message de fin d'inscription « Après avoir validé votre adresse, rouvrez le lien d'invitation ou revenez dans cet onglet. »). Compte de démo rendu seulement si `import.meta.env.DEV`. L'erreur s'affiche déjà dans l'encart d'erreur de `Login` (plus d'`alert()`).
- `context/AppContext.tsx` et `api-session.ts` : la requête `mock/login` n'existe qu'en développement (constante conditionnelle, liste de routes filtrée) ; `checkInvitation` et `acceptInvitation` lèvent `InvitationApiError` avec le statut. `Login.css` : style du bandeau.

**Backend (P13-e, volet `mock/login` de S26)**

- `src/auth/dev-auth-flag.ts` (`isDevAuthEnabled` : `NODE_ENV === 'development'` **et** `ENABLE_DEV_AUTH === 'true'`), `src/auth/dev-auth.ts` (`DevAuthController`, `MockLoginDto` avec `IsString`/`MinLength(1)`/`MaxLength(80)`, `@Throttle` 5/min, `devAuthControllers`), enregistré dans `auth.module.ts` seulement si le drapeau est actif ; route retirée de `AuthController`. `mockLogin` du service refuse aussi (400) hors drapeau. `public-routes.spec.ts` : la route n'est plus attendue dans la liste des routes publiques.
- `docs/deployment-production.md` : section « Connexion simulée (développement uniquement) ».

**Tests ajoutés** : `invitation-store.spec.ts` (6), `InvitationAcceptance.spec.tsx` (7 : résumé masqué sans formulaire de démo ni appel à `mock/login`, bouton vers `Login` avec bandeau, aucune acceptation automatique puis acceptation et suppression de l'entrée, 403 et « Changer de compte » qui conserve l'entrée, autre erreur, « Ignorer », retour MFA), `App.invitation-return.spec.tsx` (4 : retour GitHub avec entrée valide restitue l'écran d'invitation, défi MFA, entrée expirée ignorée et supprimée, `?token=` retiré de l'URL), `Login.spec.tsx` (+3), backend `tests/http/dev-auth.spec.ts` (16 : 8 environnements → 404 sans appel du service, 201, 4 corps invalides → 400, limite 5/min, branchement dans `AuthModule`), `auth.service.spec.ts` (+1, 1 adapté).

**Contre-mutations (toutes détectées, fichiers restaurés et comparés)** : frontend : jeton laissé dans l'URL (3 échecs), jeton en `localStorage` (8), expiration ignorée (2), TTL de 30 jours (détectée après ajout d'un test sur la valeur littérale 1 800 000 ms ; elle survivait avant), acceptation automatique (3), 403 non distingué (1), « Changer de compte » qui efface l'entrée (1), entrée non effacée après acceptation (1), App qui ignore l'entrée en attente (3), retour MFA sans `Login` (1), bandeau sans adresse masquée (1) ; build : contrôle de développement retiré de la constante de simulation : `grep -l "mock/login" frontend/dist/assets/*.js` trouve le fichier (rétabli : vide). Backend : drapeau sans `NODE_ENV` (5), sans `ENABLE_DEV_AUTH` (3), `!== 'production'` (3), contrôleur toujours enregistré (1), `@Throttle` retiré (1), `MaxLength` retiré (1).

**Mesures réelles** :

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | 85/85 suites, **2450/2450** (2429 avant) |
| `nest build` ; `tsc --noEmit -p tsconfig.build.json` | exit 0 ; exit 0 |
| `cd frontend && pnpm test:run` | 23 fichiers, **124/124** (104 avant) |
| `tsc --noEmit -p .` ; `pnpm build` | exit 0 ; build OK |
| `grep -l "mock/login" frontend/dist/assets/*.js` | **vide** (exit 1) |
| `pnpm lint` racine | **0 erreur**, 53 avertissements. Une erreur (`require()` dans un test) a été corrigée en cours de lot |
| Prettier (backend/src/auth, tests du lot, frontend/src, doc) | conforme |

**Changements cassants** : `POST /auth/mock/login` disparaît (404) sauf `NODE_ENV=development` et `ENABLE_DEV_AUTH=true` : un poste de développement qui l'utilise doit définir ce drapeau. Aucune migration.

**Écarts et questions pour l'architecte** :

1. **`.env.example` non modifié.** La consigne P13-e demande d'y documenter `ENABLE_DEV_AUTH=false`, mais mes garde-fous m'interdisent de toucher aux fichiers `.env*`. J'ai documenté le drapeau dans `docs/deployment-production.md`. Peux-tu (ou l'utilisateur) ajouter la ligne `ENABLE_DEV_AUTH=false` à `.env.example` ?
2. **Jeton d'invitation dans `GET /projects/invitations/check/:token`.** Le jeton reste dans le chemin de l'URL de l'API (existant, S27). Inchangé ; à reconsidérer si les journaux d'accès du proxy sont conservés.
3. **Déconnexion sur expiration de session ou 401** (`logout()` interne) : l'entrée en attente est conservée (seule la déconnexion explicite de l'en-tête la supprime). C'est le comportement le plus utile pour reprendre une invitation, mais il élargit la fenêtre à 30 minutes au maximum.
4. **Fonctionnalité perdue de l'autre assistant** : non restaurée, comme demandé.

### Non traité dans ce lot

- **P9-S** (« Sessions actives », route `POST /auth/sessions/revoke-others`, `SessionsSection`, proposition après l'activation de la MFA) et **P9-R** (« Connecter un dépôt », DTO et vérification du dépôt, 409 au remplacement d'identité) : non commencés, pour garder le lot P13 relisible. Ils restent ouverts, dans cet ordre.

#### Revue architecte (r30) — O19 et P13 (option B, volet `mock/login` de S26)

Détail dans `rapport-audit.md`, section « Revue r30 ».

**O19 : VALIDÉ. P13-a à P13-e : VALIDÉ** (avec le volet `mock/login` de S26). Non bloquant : **P13-f**, à faire avec le lot suivant :

- un test vérifie que la déconnexion par l'en-tête supprime l'entrée en attente, et qu'une expiration de session la conserve ;
- un test vérifie qu'un jeton refusé par `check` supprime l'entrée ;
- le bandeau n'est affiché que si `inviteInfo` est chargé ;
- contrôle de build en CI : `! grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js`.

**Mesures relancées** :

- backend : 85/85 suites et 2450/2450, aussi en charge concurrente avec la suite frontend (critère O19) ; `nest build` et `tsc` OK ;
- frontend : 23 fichiers, 124/124 ; `tsc` et build OK ;
- `grep "mock/login"` et `grep "Simuler"` sur `dist` : vides ;
- lint : 0 erreur ; Prettier conforme ;
- route simulée vérifiée sur le module compilé : enregistrée avec un `.env` en développement et le drapeau actif, absente sinon et en production.

**22 contre-mutations de l'architecte** :

- 19 détectées ;
- FM10 non détectée, mais équivalente ;
- FM7 et FM11 non détectées : traitées par P13-f.

Le contrôle `grep "mock/login"` seul ne détecte pas un formulaire de démonstration rendu sans condition (FB1). D'où le second motif ajouté au contrôle de CI.

**Nouveau constat S32 (Mineur, CVSS 3.1, préexistant)** : `checkInvitation` et `acceptInvitation` (`AppContext.tsx:1484-1503`) insèrent le jeton dans le chemin sans encodage ni validation. Avec `?token=..%2F..%2F..%2Fauth%2Flogout`, le navigateur de la victime envoie des requêtes authentifiées (`credentials: 'include'`) vers d'autres routes de l'API : `GET` au chargement, `POST` au clic sur « Accepter ». Remédiation :

- valider le format `/^[a-f0-9]{64}$/` dans `invitation-store.ts` : un jeton invalide est retiré de l'URL, mais ni enregistré ni renvoyé ;
- appliquer `encodeURIComponent` dans les deux URL ;
- faire l'inventaire des autres segments de chemin construits à partir de l'URL ou du stockage.

Les tests attendus sont dans le rapport. **À traiter avant P9-S**, qui ajoute `POST /auth/sessions/revoke-others`, une route sans corps.

**Réponses aux questions** :

1. Ajouter la ligne `ENABLE_DEV_AUTH=false` (avec son commentaire, texte exact dans le rapport) à `.env.example`. C'est à la session principale ou à l'utilisateur de le faire. Non bloquant, puisqu'une variable absente vaut « désactivé ».
2. Jeton dans le chemin de `check` et `accept` : accepté (risque borné par le hachage, l'usage unique, l'expiration et S17). Amélioration non bloquante : passer le jeton dans le corps, ou exclure ces chemins des journaux du proxy. Le défaut d'encodage est distinct et traité par S32.
3. Invitation conservée 30 min au plus après une expiration ou un 401 : **VALIDÉ**. Le comportement doit être couvert par un test (P13-f).

**Lot suivant, dans l'ordre** :

1. S32 et P13-f.
2. P9-S, avec deux compléments : `sid` validé côté serveur et encodé côté client.
3. P9-R, avec deux compléments : `planner_pending_repo` validé et encodé, `repoFullName` dans le corps uniquement.

**Constats ouverts** :

- S32 ;
- P13-f ;
- P9-S ;
- P9-R ;
- `.env.example` (session principale) ;
- non bloquants r26 : remplacement d'identité, configuration SSO ;
- S30, actions d'exploitation 1 à 4 ;
- Phases 5 et 6.

## Lot r30 (fixeur) — S32 et P13-f

Source : section « Revue r30 » du rapport. Au démarrage du lot, le working tree contenait déjà une partie du travail, non journalisée. Ci-dessous, la répartition entre l'existant, vérifié, et ce qui a été ajouté.

### S32 — Traversée de chemin côté client par le jeton d'invitation

**Statut** : CORRIGÉ – À REVOIR

**Cause confirmée** : `checkInvitation` et `acceptInvitation` concaténaient le jeton (issu de `?token=` puis de `sessionStorage`) dans le chemin, sans encodage ni contrôle de format.

**Changement** :

- Déjà présent et relu : `frontend/src/invitation-store.ts` (`isInviteToken` = `/^[a-f0-9]{64}$/` ; `captureInviteFromUrl` retire toujours le paramètre mais n'enregistre ni ne renvoie un jeton invalide ; `readPendingInvite` supprime une entrée invalide) ; `frontend/src/context/AppContext.tsx` (`checkInvitation` et `acceptInvitation` refusent un jeton invalide avant tout `fetch`, et utilisent `encodeURIComponent`).
- Ajouté : aucun changement de code de production nécessaire pour S32 (le code était complet).

**Audit des autres `fetch` du frontend** (`grep` sur les appels qui insèrent une variable dans un chemin) :

- Seules deux sources lisent l'URL : le jeton d'invitation (corrigé) et les liens `verify`/`reset` de `account-api.ts`. Ces derniers voyagent dans le **corps** d'un `POST` (`post('/auth/...', { token })`), jamais dans un chemin : rien à encoder.
- Seul stockage navigateur dont une valeur atteint le réseau : `planner_user` (profil). Son `id` n'est utilisé dans aucun chemin d'API (uniquement dans la clé locale `planner_onboarding_completed_${user.id}`). `AdminConsole` lit `planner_admin_original_session` pour restaurer la session, sans l'insérer dans un chemin.
- Les identifiants insérés dans les autres chemins (`projectId`, `taskId`, `workspaceId`, `userId`, `noteId`, `timeBlockId`, `sprintId`, `integrationId`, `notifId`, `targetUserId`, `status`, etc., dans `AppContext.tsx`, `AdminConsole.tsx`, `CapacityView.tsx`, `AgileView.tsx`, `NotificationInbox.tsx`, `IntegrationsPanel.tsx`, `FinancesView.tsx`) proviennent des réponses de l'API ou de l'état de l'application, jamais de l'URL ni du stockage. Les valeurs de requête (`?workspaceId=`) sont déjà encodées pour la plupart. Je n'ai donc pas modifié ces appels : le critère d'acceptation (aucune valeur issue de l'URL ou du stockage ne modifie un chemin) est satisfait, et un encodage généralisé serait du refactoring hors périmètre. Segments déjà encodés : `workspaces/${encodeURIComponent(workspaceId)}/members`, `capacity?workspaceId=`, `check/` et `accept/`.
- Non encodés mais à encoder quand ces fonctions seront touchées (défense en profondeur, non exploitable aujourd'hui) : `projects/ai/copilot/alerts?workspaceId=${workspaceId}` et `briefing?workspaceId=` (`AppContext.tsx` ~1729-1743), `deliverables/${id}/status/${status}`, `audit/logs?limit=${limit}`.

**Tests** (tous verts) :

- `frontend/src/invitation-store.spec.ts` (déjà présent) : 8 jetons invalides (traversée, traversée encodée, `..`, trop court, majuscules, non hexadécimal, 65 caractères, saut de ligne) donnent `null`, paramètre retiré, rien enregistré ; `invite` invalide ; jeton valide accepté ; entrée en attente invalide supprimée.
- `frontend/src/context/AppContext.invitation.spec.tsx` (**nouveau**) : pour 5 jetons dangereux ou vides, `checkInvitation` et `acceptInvitation` rejettent sans émettre aucun `fetch` ; pour un jeton valide, seules des URL `/projects/invitations/check|accept/<jeton>` partent.

**Contre-mutation** : « validation retirée (`isInviteToken` toujours vrai et gardes des deux fonctions retirées) ET encodage retiré » : **15 tests échouent** sur 38 (4 fichiers du lot). « Encodage seul retiré » : non détectée (38/38), ce qui est attendu puisque la validation rend alors l'encodage redondant (défense en profondeur). Fichiers restaurés, `md5sum` identique.

**Écart par rapport au rapport** : aucun. Les trois tests demandés existent ; le test « App » du rapport est un test du contexte (« ou un test du contexte »).

**Questions pour l'architecte** : accepter de ne pas encoder les autres chemins (justification ci-dessus) ? Sinon, un lot dédié « encodage généralisé » est possible.

#### Revue architecte (r31) — S32

Détail dans `rapport-audit.md`, section « Revue r31 ».

**VALIDÉ.** Format imposé à la capture, à la lecture et avant chaque `fetch` ; encodage en défense en profondeur ; les trois tests demandés existent. Contre-mutations de l'architecte AM1 à AM9 et AM15 détectées ; AM14 (encodage seul retiré) non détectée, équivalente du fait de la validation, comme annoncé. Audit des sources vérifié : seuls `?token=`/`?invite=` (corrigé), `?verify=`/`?reset=` et `?code=`/`?state=` (transmis dans le corps) lisent l'URL ; aucune valeur du stockage ni des actions IA n'atteint un chemin.

**Réponse à la question** : accepté, pas de lot dédié. Les segments listés (`copilot/alerts?workspaceId=`, `briefing?workspaceId=`, `deliverables/…/status/${status}`, `audit/logs?limit=`) viennent de l'état ou de l'API et ne satisfont pas le critère d'exploitation de S32. Règle de conduite : tout appel modifié ou ajouté encode ses segments ; toute nouvelle valeur venue de l'URL ou du stockage est validée par format avant usage (déjà exigé pour P9-S et P9-R).

### P13-f — Tests FM11, FM7, bandeau, contrôle de build

**Statut** : CORRIGÉ – À REVOIR

**Changement** :

- Déjà présent et relu : `frontend/src/App.tsx` (le bouton « Se déconnecter » de l'en-tête appelle `clearPendingInvite()` puis `logout()`) ; `frontend/src/components/InvitationAcceptance.tsx` (bandeau `invitation` de `Login` fourni seulement si `inviteInfo` est chargé) ; `.github/workflows/ci.yml` (étape « Aucune connexion simulée dans le build de production » après `pnpm build`, avec un `if grep -l … then exit 1`, qui échoue réellement sous `bash -e`, contrairement à `! grep` seul).
- Ajouté : uniquement des tests (voir ci-dessous).

**Tests ajoutés** :

- `frontend/src/App.invitation-return.spec.tsx` : FM11, un clic sur « Se déconnecter » de l'en-tête appelle `logout` et supprime `planner_pending_invite`. Le contenu du tableau de bord est simulé.
- `frontend/src/context/AppContext.invitation.spec.tsx` : `SESSION_EXPIRED_EVENT` déconnecte (`user` nul) **et conserve** l'entrée en attente (question 3 de r30).
- `frontend/src/components/InvitationAcceptance.spec.tsx` : FM7, un jeton refusé par `check` supprime l'entrée ; retour OAuth en erreur alors que `check` échoue : `Login` s'affiche sans bandeau d'invitation (cosmétique).

**Contre-mutations** (restauration vérifiée par `md5sum`) : FM11 (`clearPendingInvite()` retiré de l'en-tête) : **détectée** (1 échec) ; FM7 (suppression de l'entrée retirée dans `verifyToken`) : **détectée** (1) ; bandeau affiché sans `inviteInfo` : **détectée** (1).

**Contrôle CI** : vérifié en local, `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` ne trouve rien après `pnpm build` (exit 1 de grep, donc l'étape CI réussit). Non joué : l'échec de l'étape dans GitHub Actions (nécessite la CI).

**Écart par rapport au rapport** : la commande du rapport est `! grep -l …` ; l'étape utilise `if grep … then exit 1`, équivalente et sûre sous `bash -e`.

**Questions pour l'architecte** : aucune.

#### Revue architecte (r31) — P13-f

Détail dans `rapport-audit.md`, section « Revue r31 ».

**VALIDÉ.** FM11, FM7, bandeau conditionnel et conservation de l'entrée sur `SESSION_EXPIRED_EVENT` sont couverts (AM10 à AM13 détectées). **Écart CI accepté** : la forme `if grep … then exit 1` est retenue. Précision : `! grep` seul fonctionne s'il est la dernière commande du bloc, mais est ignoré par `-e` au milieu d'un script ; la forme `if` est robuste dans les deux cas (vérifié en local sous `bash --noprofile --norc -eo pipefail`).

**Amélioration P13-g (non bloquante)** : l'étape réussit si `frontend/dist/assets/*.js` ne correspond à aucun fichier (grep sort en 2, la condition est fausse). Ajouter en première ligne de l'étape `ls frontend/dist/assets/*.js > /dev/null` (vérifié : sortie 2 sans paquet, 0 sur build propre, 1 si la chaîne est présente).

### Mesures du lot r30

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **85/85 suites, 2450/2450** |
| `cd frontend && pnpm test:run` | **24 fichiers, 145/145** (124 avant le lot) |
| `tsc --noEmit -p .` (frontend) ; `pnpm build` | exit 0 ; build OK |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine | **0 erreur**, 53 avertissements préexistants |
| Prettier sur les fichiers de code touchés | conforme (les deux fichiers de documentation `docs/security/*.md` n'étaient déjà pas conformes à HEAD) |

Aucun commit, aucune migration, aucun changement cassant. P9-S et P9-R non commencés.

### P13-g — Contrôle CI du build : échec si aucun paquet n'existe

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `.github/workflows/ci.yml`, étape « Aucune connexion simulée dans le build de production » : première ligne du bloc `run` ajoutée, `ls frontend/dist/assets/*.js > /dev/null`. Sans paquet, `ls` échoue et l'étape avec elle (sans cela, `grep` sur un motif de fichier non résolu échouait déjà en erreur interne mais le `if` la traitait comme « absent »).

**Vérification locale** (`bash -eo pipefail`, script identique au bloc `run`) :

| Cas | Résultat |
| --- | --- |
| Pas de paquet (`frontend/dist` déplacé) | exit 2, **échec** |
| Build propre | exit 0, **succès** |
| Chaîne `mock/login` ajoutée à un paquet (puis restauré, md5 vérifié) | exit 1, **échec** |

**Écart par rapport au rapport** : aucun. **Questions** : aucune.

#### Revue architecte (r31-bis) — P13-g

**VALIDÉ.** J'ai extrait le bloc `run` réel de `ci.yml` (lecture YAML) et je l'ai exécuté sous `bash --noprofile --norc -eo pipefail` dans des répertoires de test : sans paquet, exit 2 (échec) ; build propre, exit 0 ; paquet contenant `mock/login` ou « Simuler une session », exit 1 (échec). Sur le `frontend/dist` réel du dépôt : exit 0. Feu vert de commit du lot r29 + r30 + P13-g confirmé.

## Lot P9-S (fixeur) — écran « Sessions actives »

Source : `rapport-audit.md`, constat P9 (r4), Revue r29 (exigences P9-S), Revue r30 (« Exigences complémentaires »), règle de la Revue r31 (segments encodés, valeurs lues validées). P9-R non commencé.

### P9-S — Sessions actives : liste, révocation ciblée, « fermer les autres »

**Statut** : CORRIGÉ – À REVOIR

**Backend**
- `backend/src/auth/auth.controller.ts` : `DELETE /auth/sessions/:sid` reçoit `ParseUUIDPipe` (400 si `sid` n'est pas un UUID, `familyId` étant un `randomUUID()`), `@Throttle` 10/min et un 409 « Utilisez Se déconnecter » pour la session courante. Le `sid` est mis en minuscules avant comparaison et recherche : le pipe accepte les majuscules et une collation MySQL insensible à la casse aurait sinon permis de contourner le 409 en révoquant la session courante.
- Nouvelle route `POST /auth/sessions/revoke-others` (sans corps, 200, `{ revoked: n }`, `@ForbiddenInImpersonation()`, `@Throttle` 5/min, sans réauthentification).
- `backend/src/auth/auth.service.ts` : `revokeOtherSessions(userId, sid)` = `revokeAllForUser(userId, sid)` + entrée `AuditLog` `SESSIONS_REVOKED` (`changes: { count, sid }`, aucun jeton).
- Isolation : inchangée, `revokeOwnSession` et `listForUser` filtrent par `userId` (404 pour la session d'autrui). Révocation effective : `revoke()` invalide le cache Redis (S7-a).

**Frontend**
- `frontend/src/security-api.ts` : `listSessions`, `revokeSession(sid)` (`encodeURIComponent`), `revokeOtherSessions` (POST sans corps) ; `call` accepte `DELETE`.
- `frontend/src/components/SessionsSection.tsx` (nouveau) : navigateur et système tirés de `userAgent` (repli tronqué à 120), dates d'ouverture, de dernière authentification et d'expiration, badge « Cette session », « Révoquer » avec confirmation sur les autres sessions seulement, « Fermer les autres sessions » (notice « n sessions fermées »), relecture de la liste après chaque action et après une erreur (404 compris). Actions masquées si `planner_admin_original_session` existe (impersonation), la liste reste visible.
- `frontend/src/App.tsx` : `SessionsSection` sous les identités dans l'onglet `security`.
- `frontend/src/components/SecurityPage.tsx` : après l'activation de la MFA (une fois les codes de récupération enregistrés), carte « Fermer les autres sessions ? » ; prop `onSessionsClosed` qui fait relire la liste.
- `frontend/src/App.link-notice.spec.tsx` : le stub de `fetch` répond `[]` à `/auth/sessions` (l'écran appelle désormais cette route).

**Tests ajoutés**
- Backend `tests/http/session-lifecycle.spec.ts` (bloc « P9-S », 9 tests) : `sid` invalide (4 formes) -> 400 sans appel au service ; courante -> 409 (aussi en majuscules), session toujours active ; inconnue ou déjà révoquée -> 404 ; jeton d'accès de la session révoquée refusé au tour suivant, cache chaud ; `revoke-others` ferme les autres, garde la courante (refresh encore possible), n'affecte pas un autre utilisateur ; audit (nombre, sid, sans jeton) et cas 0 ; liste sans fuite inter-utilisateur ; impersonation (liste 200, DELETE et revoke-others 403) ; limites 5/min et 10/min.
- Backend `tests/unit/auth/impersonation-routes.spec.ts` : `revokeOtherSessions` dans la liste paramétrée, `/auth/sessions/revoke-others` dans le balayage méta (déjà couvert par `^/auth/sessions/`).
- Frontend `SessionsSection.spec.tsx` (10 tests) et `SecurityPage.spec.tsx` (+1) : rendu, badge, pas de « Révoquer » sur la courante, DELETE avec `sid` encodé puis relecture, annulation, 404 -> erreur + relecture, revoke-others sans corps + notice, bouton absent sans autre session, impersonation, `refreshKey`, erreur de chargement, analyse du `User-Agent`, invitation après activation de la MFA.

**Contre-mutations** (fichier restauré après chaque essai, md5sum identique vérifié) : sans `ParseUUIDPipe` -> 1 échec ; 409 supprimé -> 1 échec ; comparaison sans minuscules -> 1 échec ; `revokeAllForUser` sans `sid` exclu -> 2 échecs ; décorateur d'impersonation retiré de `revoke-others` -> 3 échecs ; action d'audit modifiée -> 1 échec ; limite 5/min modifiée -> 1 échec ; frontend : `encodeURIComponent` retiré -> 1 échec, masquage d'impersonation retiré -> 2, « Révoquer » sur la courante -> 5, invitation post-MFA retirée -> 3.

**Mesures**
| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **85/85 suites, 2462/2462** (2450 avant) |
| `nest build` | exit 0 |
| `cd frontend && pnpm test:run` | **25 fichiers, 156/156** (145 avant) |
| `tsc --noEmit -p .` ; `pnpm build` (frontend) | exit 0 ; build OK |
| `pnpm lint` racine | 0 erreur, 53 avertissements (inchangé) |
| Prettier sur les fichiers de code touchés | conforme |

**Migration** : aucune. **Changement cassant** : `DELETE /auth/sessions/:sid` répond 400 pour un `sid` non UUID (aucun appelant existant) et 409 pour la session courante (auparavant 204 : l'appel laissait des cookies orphelins).

**Écart par rapport au rapport** : aucun. `revoke-others` répond 200 (`@HttpCode(200)`, le rapport ne précise pas le code ; défaut Nest 201 jugé peu pertinent).

**Questions pour l'architecte**
1. Les sessions d'impersonation (15 min, sans refresh) sont des lignes `RefreshToken` du compte cible : elles apparaissent dans sa liste et `revoke-others` les ferme. Cela paraît souhaitable (visibilité et coupure par l'utilisateur), mais il n'existe aucun champ pour les distinguer dans la liste. Faut-il ajouter un indicateur (migration) ou accepter en l'état ?
2. Le masquage des actions en impersonation côté client repose sur la clé `planner_admin_original_session` (présence seulement, aucune valeur lue). Le serveur reste l'autorité (403). Acceptable ?
3. `revokeOwnSession` n'exclut pas les sessions expirées non révoquées (elles sont absentes de la liste, donc non atteignables par l'interface). Sans effet de sécurité, laissé tel quel.

#### Revue architecte (r32) — P9-S

Détail dans `rapport-audit.md`, section « Revue r32 ».

**VALIDÉ.** Toutes les exigences de r29, r30 et r31 sont satisfaites (S7-a et S18.2 compris). Contre-mutations de l'architecte : 27 sur 27 détectées, les deux témoins sans mutation sont verts et les noms des tests en échec ont été vérifiés. Écarts acceptés : `revoke-others` répond 200 (la remédiation est mise à jour) ; `DELETE` répond 400 pour un `sid` non UUID et 409 sur la session courante, avec une normalisation en minuscules jugée nécessaire.

**Réponses** :

1. Sessions d'impersonation indistinguables : accepté en l'état. L'indicateur (`impersonatedBy` sur `RefreshToken`, migration) est reporté à S18, en Phase 4 ; le drapeau d'impersonation reste désactivé d'ici là.
2. Masquage fondé sur `planner_admin_original_session` : accepté comme ergonomie, le serveur reste l'autorité (403). Avec S18, l'information viendra du serveur (`impersonated` sur la session courante de `GET /auth/sessions`).
3. `revokeOwnSession` sur une session expirée : accepté, sans effet.

**Nouveaux constats (non bloquants)** :

- **P9-S-a** : `revokeAllForUser` compte les sessions expirées non révoquées, donc la notice et l'audit peuvent annoncer plus de sessions fermées que la liste n'en montrait. Ajouter `expiresAt: { gt: new Date() }` au filtre, avec un test (`{ revoked: 1 }` en présence d'une session expirée).
- **O20** : quand les deux suites tournent ensemble sur une machine chargée, des tests dépassent le délai de 5 s. Passer `testTimeout` à 15000 dans les configurations Jest et Vitest.

**Commit** : feu vert pour le lot P9-S.

## Lot r32 (fixeur) — P9-S-a, O20 et P9-R « Connecter un dépôt »

Périmètre : section « Revue r32 » du rapport, exigences P9-R de r29 et r30, non bloquant r26 « remplacement silencieux », règle de r31 (segments encodés, valeurs lues validées par format). Aucun commit.

### P9-S-a — `revokeAllForUser` ne compte que les sessions non expirées

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `backend/src/auth/session.service.ts` (`revokeAllForUser`) : filtre `expiresAt: { gt: new Date() }`. Une session expirée est inerte (déjà refusée par `isSessionActive` et le rafraîchissement) : elle n'est ni révoquée ni comptée ; aucun effet pour les autres appelants (suspension, mot de passe, déliaison).

**Tests** : `tests/http/session-lifecycle.spec.ts`, « revoke-others : ne compte pas les sessions expirées non révoquées » : une autre session active et une expirée non révoquée donnent `{ revoked: 1 }` et un audit `count: 1`. Rouge avant le correctif (`revoked: 2`), vert après. Contre-mutation B1 (filtre retiré) : 1 échec.

**Écart par rapport au rapport** : aucun. **Questions** : aucune.

### O20 — `testTimeout: 15000`

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `backend/package.json` (clé `jest`, `testTimeout: 15000`) ; `frontend/vite.config.ts` (`test.testTimeout: 15000`). Aucun délai par test.

**Tests** : un test temporaire de 6 s (supprimé ensuite) passe dans Jest et dans Vitest, ce qui prouve que la valeur est lue (le défaut de 5 s l'aurait fait échouer). Les deux suites complètes, lancées **ensemble** : backend 86/86 suites, 2495/2495 ; frontend 28 fichiers, 195/195 (charge de la machine faible, de l'ordre de 1,5 à 3).

**Écart / limite** : le critère d'acceptation (deux exécutions simultanées vertes sur machine chargée) n'est vérifié que par **un** essai à faible charge, je n'ai pas reproduit la saturation de la revue r32 (charge 15 à 18). **Question** : l'architecte peut-il rejouer ses trois essais sous charge ?

### P9-R — « Connecter un dépôt » (finalité `repos`) et fin du remplacement silencieux

**Statut** : CORRIGÉ – À REVOIR

**Backend**
- `backend/src/auth/dto/github.dto.ts` : `GithubSyncDto` (`projectId` : `IsString`, `IsNotEmpty`, `MaxLength(64)` ; `repoFullName` : `Matches(GITHUB_REPO_FULL_NAME)`), constante exportée `GITHUB_REPO_FULL_NAME`.
- `backend/src/auth/auth.controller.ts` : `POST /auth/github/sync` prend `GithubSyncDto` ; `@Throttle` 10/min sur `github/repos` et `github/sync` ; `@ForbiddenInImpersonation()` sur les deux (voir écart 2).
- `backend/src/auth/auth.service.ts` :
  - `syncRepositoryToProject` : `policy.assertProject(projectId, userId, 'project.manage')` (au lieu de `project.userId`) ; refus 400 si aucun jeton GitHub ; `GET https://api.github.com/repos/{owner}/{repo}` avec le jeton déchiffré de l'utilisateur, `encodeURIComponent` sur chaque segment, `AbortSignal.timeout(5000)` ; réponse autre que 200 : 400 ; erreur réseau ou délai : 503 ; `full_name` renvoyé revalidé par le format ; **c'est ce nom canonique qui est enregistré**. Aucune écriture dans les cas d'échec.
  - `getGitHubRepositories` : même délai de 5 s, 503 si GitHub est injoignable (auparavant aucune borne).
  - `linkGitHubAccount` : 409 « Déliez d'abord le compte GitHub actuel » si le compte porte déjà un autre `githubId` (finalités `link` et `repos`), après l'échange du code mais **avant** toute écriture : ni identité ni jeton remplacés. Même règle pour `linkFirebaseAccount` (voir écart 3). Relier la **même** identité reste permis.
  - Nouvelle dépendance `PolicyService` dans le constructeur d'`AuthService` (module global `AuthzModule`, rien à déclarer en production), placée avant le paramètre optionnel du délai Redis.

**Frontend**
- `frontend/src/pending-repo.ts` (nouveau) : `planner_pending_repo` en `sessionStorage`, échéance de 15 min, `projectId` validé par format (UUID) **à la lecture** et à l'écriture ; entrée illisible, altérée ou expirée : ignorée et supprimée.
- `frontend/src/github-repos.ts` (nouveau) : `listGitHubRepos` (`GET /auth/github/repos`) et `syncGitHubRepo` (`POST /auth/github/sync`, `projectId` et `repoFullName` **dans le corps**, aucun segment de chemin variable).
- `frontend/src/components/GitHubRepoConnector.tsx` (nouveau) : dépôt lié, bouton « Connecter un dépôt » (seulement avec le droit), 200 -> sélecteur puis `sync` ; 400, 401 ou 403 -> projet mémorisé puis `startGitHubAuthorization('repos')` ; autre erreur : message, aucun détour ; ouverture automatique au retour (une seule fois).
- `IntegrationsPanel.tsx` : props optionnelles `project`, `canManageProject`, `autoOpenRepoPicker`, `onRepoPickerOpened` ; section affichée seulement si `project` est fourni ; `refreshData` après une liaison.
- `GovernanceView.tsx` : passe le projet actif et le droit ; props `resumeRepoProjectId` et `onResumeRepoHandled` : au retour, sélectionne le workspace et le projet, ouvre l'onglet Intégrations et demande le sélecteur.
- `App.tsx` : au `onDone` de la finalité `repos`, `readPendingRepo()` (validé) ; si présent, onglet `governance` et reprise sur ce projet ; sinon retour sur `security` comme avant. L'entrée est supprimée à la consommation et à l'annulation.
- `GitHubLinkConfirm.tsx` : le texte rappelle que la portée « repo » donne accès aux dépôts privés.

**Tests ajoutés**
- Backend `tests/http/github-repos.spec.ts` (25 tests, HTTP réel, GitHub simulé) : DTO (projectId objet, trop long, dépôt à 1 ou 3 segments, `../`, `..`, `.`, `?x=1`, trop long, absent) -> 400 sans contrôle de droit ni appel à GitHub ; dépôt non lisible dans le chemin (404) ; 403 sans `project.manage` sans appel à GitHub ni écriture ; 401 non authentifié ; 403 en impersonation sur `sync` et `repos` ; sans jeton GitHub -> 400 ; GitHub 404, 403, 401, 500 -> 400 sans écriture (le corps simulé contient un `full_name` valide, pour que seul le statut protège) ; nom canonique invalide -> 400 ; délai -> 503 sans écriture ; succès : URL, en-tête `Authorization`, signal, nom canonique enregistré (différent de la saisie) ; délai de `repos` -> 503 ; limites 10/min.
- Backend `tests/unit/auth/identity-linking.spec.ts` (+2 cas par fournisseur, +1 cas pour la finalité `repos`) : déjà lié à une autre identité -> 409, ligne intacte, jeton précédent conservé, aucun `update` ; même identité -> permis ; finalité `repos` vers un autre `githubId` -> 409 sans jeton remplacé.
- Backend `tests/unit/auth/impersonation-routes.spec.ts` : `github/repos` et `github/sync` ajoutés au balayage méta (motif `^/auth/github/(repos|sync)$`) et à la liste attendue.
- Frontend : `pending-repo.spec.ts` (17), `GitHubRepoConnector.spec.tsx` (11), `App.repo-return.spec.tsx` (5), `GovernanceView.spec.tsx` (+5), `IntegrationsPanel.spec.tsx` (+1), `GitHubLinkConfirm.spec.tsx` (texte des dépôts privés).
- Fournisseur `PolicyService` ajouté dans 13 fichiers de test qui construisent le vrai `AuthService` (`mfa-redis-timeout.spec.ts` : argument positionnel).

**Contre-mutations** (fichier restauré après chaque essai, md5sum identique vérifié à chaque fois ; `git status` sans fichier inattendu) :
- Backend, 20 essais : filtre `expiresAt` retiré -> 1 échec ; `Matches` retiré -> 8 ; `MaxLength(64)` retiré -> 1 ; `assertProject` retiré -> 1 ; statut GitHub non vérifié -> 4 ; saisie enregistrée au lieu du nom canonique -> 1 ; erreur réseau non traduite -> 1 ; délai retiré (sync) -> 1 ; délai retiré (repos) -> 1 ; 409 GitHub retiré -> 2 ; 409 Firebase retiré -> 1 ; impersonation autorisée sur `sync` -> 2 ; sur `repos` -> 2 ; `@Throttle` retiré sur `sync` -> 1 ; sur `repos` -> 1 ; jeton absent toléré -> 1 ; `..` autorisé -> 2 ; nom canonique non validé -> 1 ; en-tête sans le jeton de l'utilisateur -> 1.
- Frontend, 26 essais : toutes détectées après correction des tests (échéance ignorée -> 3 ; durée 60 min -> 1 ; `localStorage` -> 4 ; format non validé à la lecture -> 6 ; `isProjectId` permissif -> 6 ; écriture sans validation -> 2 ; dépôt dans le chemin -> 1 ; 400, 401, 403 retirés un à un -> 2, 1, 1 ; détour pour tout statut -> 1 ; bouton, ouverture automatique sans droit -> 1, 1 ; pas d'ouverture automatique, ouverture répétée -> 1, 1 ; dépôt affiché différent de la réponse -> 1 ; pas de reprise, annulation sans nettoyage, entrée non consommée -> 1, 1, 1 ; reprise pour la finalité `link` -> 1 ; MEMBER autorisé, ADMIN exclu -> 1, 1 ; onglet non ouvert, projet non sélectionné, ouverture non demandée -> 1, 1, 1 ; section sans projet -> 4 ; rappel des dépôts privés retiré -> 1).
- Survivants au premier passage, corrigés par un test puis rejoués : statut GitHub non vérifié (le corps d'erreur simulé n'avait pas de `full_name`), reprise pour toute finalité, projet non sélectionné au retour (le projet visé était déjà le premier). **Mutations équivalentes, non détectables** : `IsString` retiré de `projectId` (`MaxLength` exige déjà une chaîne) ; sélecteur affiché sans droit (`repos` n'est alimenté que par `open()`, déjà gardé) ; `encodeURIComponent` retiré (le format validé ne contient aucun caractère à encoder : l'encodage est une défense en profondeur sans effet observable, voir écart 1).

**Mesures** (une exécution unique des deux suites **ensemble**)
| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **86/86 suites, 2495/2495** (85 et 2462 avant) |
| `nest build` ; `tsc --noEmit -p tests/tsconfig.json` | exit 0 ; exit 0 |
| `cd frontend && pnpm test:run` | **28 fichiers, 195/195** (25 et 156 avant) |
| `tsc --noEmit -p .` ; `pnpm build` | exit 0 ; build OK |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine | 0 erreur, 53 avertissements (inchangé) |
| Prettier sur tous les fichiers modifiés ou ajoutés | conforme |

**Migration** : aucune. **Changements cassants** : `POST /auth/github/sync` rejette (400) un corps non conforme (auparavant aucune validation) et un dépôt inaccessible ; `github/repos` et `github/sync` répondent 403 en impersonation ; `link` répond 409 si une autre identité est déjà liée (déliaison préalable, qui exige déjà la réauthentification). Aucun appelant existant n'utilisait `sync` et `repos`. Les données existantes ne sont pas touchées : un `githubRepo` déjà enregistré sans vérification reste en l'état.

**Écarts par rapport au rapport**
1. **Regex du dépôt** : `(?!\.{1,2}$)` ajouté pour refuser `owner/.` et `owner/..` : ce ne sont pas des dépôts GitHub et `encodeURIComponent` ne neutralise pas les points (le chemin deviendrait `/repos/owner/..`). Sans effet de sécurité démontré (GitHub répond 404), mais la règle de r31 demande des valeurs validées par format. Test et contre-mutation (2 échecs).
2. **`@ForbiddenInImpersonation()` sur `github/repos` et `github/sync`** (non demandé) : ces routes utilisent le jeton GitHub du compte ciblé et donnent accès à ses dépôts privés ; cohérent avec S18.2 (`link`, `unlink`).
3. **409 aussi sur `firebase/link`** (le rapport r29 ne cite que GitHub, le non bloquant r26 vise les deux identités).
4. **Droit côté interface** : voir question 1.
5. **Codes de retour** : délai ou erreur réseau vers GitHub -> 503 (le rapport dit « erreur sans écriture »).

**Questions pour l'architecte**
1. **Décision produit : qui voit « Connecter un dépôt » ?** Le frontend ne connaît pas le rôle de projet. J'ai retenu `OWNER` et `ADMIN` du workspace (MANAGER implicites de tous les projets), le serveur restant l'autorité (403 sinon). Un MANAGER par `ProjectMembership`, ou le créateur au rôle MEMBER, n'a donc pas le bouton, alors que le serveur l'accepterait. Option recommandée : exposer un champ `canManage` (ou `myRole`) dans la charge utile des projets, calculé par `PolicyService`, puis le lire à la place du rôle de workspace. À traiter dans un lot dédié ? Par ailleurs `IntegrationsPanel` reste réservé aux non-VIEWER, et ses routes d'intégrations exigent `ADMIN`.
2. Un 401 de `github/repos` (jeton GitHub révoqué) est indiscernable d'une session expirée : le `fetch` de session tente une rotation, la rejoue, puis le composant lance l'autorisation GitHub ; si la session est réellement perdue, l'événement de fin de session s'ajoute. Acceptable, ou préférez-vous un code distinct côté serveur (par exemple 403 avec un message dédié) ?
3. `encodeURIComponent` est conservé (défense en profondeur) mais sans test détectant son retrait, le format validé rendant l'encodage neutre. OK ?
4. L'entrée `planner_pending_repo` reste jusqu'à son échéance si l'utilisateur ne revient jamais ; elle n'est consommée que par une confirmation de la finalité `repos` ou une annulation. Suffisant ?
5. O20 : voir plus haut, essai sous charge à rejouer.


#### Revue architecte (r33)

**Verdicts** : P9-S-a **VALIDÉ** ; O20 **VALIDÉ** ; P9-R **À REPRENDRE** (deux points mineurs). Détail, mesures et contre-mutations : section « Revue r33 » de `docs/security/rapport-audit.md`.

**Vérifié par l'architecte** : les deux suites ensemble (86/86, 2495/2495 ; 28 fichiers, 195/195), `nest build`, `tsc` (backend tests et frontend), `pnpm build` et grep du build (vide), lint (0 erreur), Prettier. O20 rejoué sous charge (8 processus, charge de 15 à 17) : 2 essais verts. 29 contre-mutations hors dépôt, fichiers restaurés et `md5sum` vérifié ; 2 survivantes équivalentes (`encodeURIComponent`, contrôle du format dans le service), 2 survivantes réelles (F12, F13).

**Écarts** : les 5 sont **acceptés** (regex excluant `.` et `..` ; `@ForbiddenInImpersonation()` sur `github/repos` et `github/sync` ; 409 étendu à `firebase/link` ; 503 sur délai ou erreur réseau ; dépendance `PolicyService`, sans cycle).

**À reprendre**
- **P9-R-a** : dans `getGitHubRepositories`, GitHub 401 -> 403 « Jeton GitHub invalide ou révoqué », autre statut non 200 -> 503 ; dans `GitHubRepoConnector`, détour GitHub pour 400 et 403 seulement (401 retiré). Tests : backend (401 -> 403, 500 et 429 -> 503), frontend (401 et 503 sans détour).
- **P9-R-b** : test où la réponse de `sync` diffère de la sélection (le texte « Dépôt lié : » affiche la réponse) ; test où `refreshData` est appelé après « Lier … » (`IntegrationsPanel.spec.tsx`). Mes mutations F12 et F13 doivent être détectées.

**Réponses aux questions** : (1) décision produit, **à confirmer par l'utilisateur** : recommandation, exposer `myRole` ou `canManage` calculé par `PolicyService`, sans lot dédié maintenant, à traiter avec S18 ou A5 à A9 ; heuristique OWNER et ADMIN acceptée en attendant (le serveur reste l'autorité). (2) non acceptable en l'état, voir P9-R-a. (3) accepté, mutation équivalente, pas de test artificiel. (4) suffisant ; suppression à la déconnexion facultative. (5) rejoué sous charge, validé.

**Commit** : pas de feu vert avant la reprise ; un seul commit ensuite (P9-S-a, O20 et P9-R sont liés par la dépendance `PolicyService`). Liste des fichiers dans le rapport.

**Constats encore ouverts** : P9-R-a, P9-R-b, puis la liste habituelle (SSO `ssoUid`, jeton d'invitation dans le corps, S30 exploitation, Phases 4 à 6).

## Reprise r33 (fixeur) — P9-R-a et P9-R-b

Avant de commencer : aucune tâche d'arrière-plan ni shell bloqué restant (les `until`/`pgrep` des essais précédents sont terminés), et `md5sum` des fichiers de code identique à celui pris avant les contre-mutations de r32 : aucune mutation restée en place.

### P9-R-a — `github/repos` ne transforme plus tout échec GitHub en 401

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `backend/src/auth/auth.service.ts` (`getGitHubRepositories`) : GitHub 401 -> **403** « Jeton GitHub invalide ou révoqué. » ; autre statut non 200 (5xx, limite de débit, 403, 404) -> **503** ; plus aucun 401 sur cette route. Frontend : `GitHubRepoConnector.tsx` ne lance le détour d'autorisation que pour **400 et 403** ; un 401 suit le traitement normal de la session (message, aucun détour, rien en mémoire) ; 503 : message, aucun détour. Commentaire de `github-repos.ts` mis à jour.

**Tests** : backend `github-repos.spec.ts` (33, +8) : succès 200, GitHub 401 -> 403 (jamais 401), 500, 502, 429, 403, 404 -> 503, jeton absent -> 400 sans appel à GitHub. Frontend `GitHubRepoConnector.spec.tsx` : détour pour 400 et 403 seulement, 401 et 503 sans détour ni mémorisation.

### P9-R-b — tests des mutations F12 et F13

**Statut** : CORRIGÉ – À REVOIR

**Tests** : `GitHubRepoConnector.spec.tsx` : la réponse de `sync` (`Acme/Web`) diffère de la sélection (`acme/web`) et « Dépôt lié : » affiche la réponse du serveur. `IntegrationsPanel.spec.tsx` : après « Lier … », `refreshData` est appelé exactement une fois (le mock `useApp` fournit maintenant `refreshData`).

### Contre-mutations (fichier restauré, md5sum identique vérifié après chacune)
- Backend : GitHub 401 renvoyé en 401 -> 1 échec ; branche 401 retirée (donc 503) -> 1 ; autres échecs en 401 -> 5 ; échec non 200 ignoré -> 5.
- Frontend : 401 relance le détour -> 1 ; 403 sans détour -> 1 ; 400 sans détour -> 2 ; 503 relance le détour -> 1 ; **F12** (dépôt affiché = sélection) -> 1 ; **F13** (`refreshData` non appelé) -> 1 ; `refreshData` appelé deux fois -> 1.

### Mesures (suites lancées ensemble)
| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **86/86 suites, 2503/2503** (2495 avant) |
| `cd frontend && pnpm test:run` | **28 fichiers, 197/197** (195 avant) |
| `nest build` ; `tsc --noEmit -p tests/tsconfig.json` ; frontend `tsc --noEmit -p .` ; `pnpm build` | exit 0 partout |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine ; Prettier sur tous les fichiers modifiés | 0 erreur (53 avertissements inchangés) ; conforme |

**Migration** : aucune. **Changement cassant** : `GET /auth/github/repos` répond 403 (jeton GitHub invalide) ou 503 au lieu de 401 ; seul le composant de ce lot l'appelle.
**Écart par rapport au rapport** : aucun. **Questions pour l'architecte** : aucune.

## Revue architecte (r34)

#### Revue architecte — P9-R-a : **VALIDÉ**
Code relu : GitHub 401 -> 403, autre statut non 200 -> 503, jeton absent -> 400 ; frontend, détour pour 400 et 403 seulement. Contre-mutations M1 à M8 toutes détectées.

#### Revue architecte — P9-R-b : **VALIDÉ**
F12 (affichage de la réponse du serveur) et F13 (`refreshData` appelé exactement une fois) : mutations F12, F13 et F13b détectées.

**P9-R : VALIDÉ.** Mesures relancées : jest 86/86 (2503), vitest 28 fichiers (197), nest build, tsc (backend tests et frontend), `pnpm build` et grep du build (vide), lint (0 erreur), Prettier conforme sur le code. `md5sum` des 36 fichiers identique avant et après mes essais. **Feu vert pour un commit unique** (liste, changements cassants et état migration : « Revue r34 » du rapport ; migration : aucune). Constats ouverts : voir la fin de « Revue r34 ».

## Lot r34 (fixeur)

Périmètre : constats ouverts de « Revue r34 » du rapport, dans l'ordre : (1) non bloquant r26 « configuration SSO pour `ssoUid` » ; (2) non bloquant r30 « jeton d'invitation dans le corps de `check` et `accept` » (S27). Exigences d'origine : Revue r26, « Points non bloquants » (« vérifier aussi qu'une configuration SSO active existe pour le domaine ») ; Revue r30, réponse 2 (`POST /projects/invitations/check` et `/accept` avec `{ token }`) ; règle de r31 (valeurs lues validées par format, segments encodés) ; parcours P13. Aucun commit.

### Non bloquant r26 — `ssoUid` compte comme « autre méthode » seulement si le SSO du domaine est utilisable

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `backend/src/auth/auth.service.ts` :
- nouvelle méthode privée `hasActiveSso(account)` : vrai si le compte porte un `ssoUid` **et** si `sSOConfiguration.findUnique({ verifiedDomain: <domaine de l'adresse> })` renvoie une configuration `enabled` avec `domainVerifiedAt` (mêmes critères que `SsoService.findUsableConfig`, S10-a) ;
- `hasOtherLoginMethod(account, provider, ssoActive)` : `ssoUid` compte seulement si `ssoActive`. Règle toujours unique, partagée par `unlinkIdentity` et `getIdentities` (`canUnlink`) ;
- le `OR` SQL de l'`updateMany` de `unlinkIdentity` n'inclut `{ ssoUid: { not: null } }` que si `ssoActive` (miroir de la règle).

**Tests** : `tests/unit/auth/identity-linking.spec.ts` : `ssoUid` + configuration active du domaine : `canUnlink` vrai et déliaison réussie (test existant, la configuration est maintenant semée) ; `ssoUid` sans configuration, configuration désactivée, domaine non prouvé, configuration d'un autre domaine : `canUnlink` faux, 409, rien d'écrit, aucun courriel (4 cas) ; `ssoUid` sans SSO utilisable mais avec mot de passe : déliaison permise.

**Contre-mutations** (fichier restauré, md5sum identique vérifié après chacune) : `ssoUid` compté sans `ssoActive` -> 4 échecs ; `enabled` ignoré -> 1 ; `domainVerifiedAt` ignoré -> 1 ; domaine ignoré (`findFirst` sans filtre) -> 1 ; `getIdentities` avec `ssoActive = true` -> 4 ; `unlinkIdentity` avec `ssoActive = true` -> 4.
**Mutation non détectée (équivalente en séquentiel)** : retirer la condition `ssoActive` du `OR` SQL. La lecture qui précède renvoie déjà 409 ; le miroir SQL ne joue que si la configuration SSO change entre la lecture et l'écriture, ce que le faux Prisma ne permet pas de simuler sans test de concurrence artificiel. Couverture : revue de code.

### Non bloquant r30 (S27) — jeton d'invitation dans le corps de `check` et `accept`

**Statut** : CORRIGÉ – À REVOIR

**Changement** :
- `backend/src/projects/dto/invitation-token.dto.ts` (nouveau) : `InvitationTokenDto { token }`, `@Matches(/^[a-f0-9]{64}$/)` (format émis par `createInvitation`, identique à `isInviteToken` du frontend) ; 400 sinon.
- `backend/src/projects/invitations.controller.ts` : `GET invitations/check/:token` remplacé par `POST invitations/check` (public, 200, corps `{ token }`) ; `POST invitations/accept/:token` remplacé par `POST invitations/accept` (authentifié, 200, corps `{ token }`). Les anciennes routes sont **supprimées** (404).
- `frontend/src/context/AppContext.tsx` : `checkInvitation` et `acceptInvitation` envoient `POST` avec `{ token }` en JSON ; la validation `isInviteToken` avant tout `fetch` (S32) est conservée ; le jeton n'apparaît plus dans l'URL. Aucun autre appelant (`InvitationAcceptance`, `App` passent par ces deux fonctions ; le jeton en attente P13 reste dans `sessionStorage`, inchangé).
- `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` : route d'acceptation mise à jour.
- `tests/unit/authz/public-routes.spec.ts` : liste blanche `GET /projects/invitations/check/:token` -> `POST /projects/invitations/check`.

**Tests** : `backend/tests/http/invitation-token-body.spec.ts` (nouveau, 14, HTTP réel) : `check` valide 200 sans session ; jeton absent, objet d'opérateurs, `../../auth/logout`, majuscules, trop court, trop long : 400 sans appel au service ; `accept` valide 200 avec l'utilisateur, sans session 401, 3 jetons invalides 400 ; anciennes routes GET/POST avec jeton dans le chemin : 404. Frontend `AppContext.invitation.spec.tsx` : le test « jeton valide » vérifie `POST` sur `/projects/invitations/check` et `/accept`, corps `{ token }`, et qu'aucune URL ne contient le jeton ; les 5 jetons dangereux sont toujours refusés sans `fetch`.

**Contre-mutations** (md5sum vérifié) : format retiré du DTO -> 6 échecs ; `check` non public -> 7 ; `accept` redevenu `accept/:token` -> 6 ; frontend `check` avec jeton dans l'URL -> 1 ; `accept` sans corps -> 1 ; validation de format retirée côté client -> 5.

### Mesures (suites lancées ensemble, après Prettier final)
| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **87/87 suites, 2522/2522** (2503 avant) |
| `cd frontend && pnpm test:run` | **28 fichiers, 197/197** |
| `nest build` ; `tsc --noEmit -p tests/tsconfig.json` ; frontend `tsc --noEmit -p .` ; `pnpm build` | exit 0 partout |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine ; Prettier sur les fichiers de code modifiés | 0 erreur (53 avertissements inchangés) ; conforme |

Aucun processus de restauration en attente à la fin du lot.

**Migration** : aucune.
**Changements cassants** : (1) `GET /projects/invitations/check/:token` et `POST /projects/invitations/accept/:token` n'existent plus ; remplacés par `POST /projects/invitations/check` et `/accept` avec `{ "token": "<64 hex>" }` (400 si le format est invalide). Seul le frontend de ce dépôt les appelle ; les liens d'invitation `?token=` envoyés par courriel sont inchangés. Un frontend ancien déployé avec ce backend verrait 404 sur l'écran d'invitation : déployer ensemble. (2) Un compte dont le seul autre moyen de connexion est un `ssoUid` sans SSO actif du domaine ne peut plus délier GitHub/Firebase (409 « dernière méthode »), et `canUnlink` vaut faux.

**Écart par rapport au rapport** : aucun. Le rapport proposait aussi d'exclure les chemins des journaux du proxy ; devenu inutile puisque le jeton n'est plus dans le chemin.

**Questions pour l'architecte** :
1. Le domaine retenu pour « SSO actif » est celui de l'adresse du compte (`verifiedDomain` unique), cohérent avec S10-a ; un compte dont l'adresse a changé de domaine depuis sa liaison perd donc la valeur de son `ssoUid`. Acceptable ?
2. `POST invitations/check` public n'a pas de `@Throttle` dédié (comme l'ancienne route GET) ; limitation de débit à traiter en Phase 5 (P5) ?
3. Les anciennes routes sont supprimées sans période de transition (aucun client externe connu). Confirmer, ou prévoir un alias temporaire ?


## Revue architecte (r35)

Verdict sur le lot r34 : **VALIDÉ** pour les deux points ; feu vert de commit (10 fichiers, détail dans « Revue r35 » du rapport). Mesures relancées : jest 87/87 suites, 2522/2522 ; vitest 28 fichiers, 197/197 ; `nest build`, deux `tsc`, `pnpm build` en exit 0 ; aucun `mock/login` ni « Simuler une session » dans `dist` ; lint 0 erreur ; Prettier conforme. `md5sum` du working tree identique avant et après mes mutations.

- **Non bloquant r26 (`ssoUid`)** : **VALIDÉ**. Mutation non détectée déclarée (condition `ssoActive` du `OR` SQL) : jugée équivalente et acceptée, le SQL ne pouvant de toute façon pas vérifier l'état de `SSOConfiguration`. Mutation supplémentaire non détectée de mon côté : `toLowerCase()` retiré de `hasActiveSso` (nouveau constat mineur r35-m1 : test avec adresse en casse mixte).
- **Non bloquant r30 (S27)** : **VALIDÉ**. Mes mutations (regex du DTO, `check` non public, `check` en `GET` côté client) sont détectées.

**Réponses** : (1) domaine de l'adresse actuelle : accepté, cohérent avec S10-a. (2) pas de `@Throttle` dédié : le garde global (60 requêtes par minute) couvre la route, jeton de 256 bits ; à revoir en P5 avec `trust proxy`. (3) suppression sans alias : confirmée, déploiement simultané backend et frontend. Les points 1 et 3 sont des décisions produit / exploitation, recommandations à confirmer par l'utilisateur.

**Ouverts** : r35-m1 (mineur), S30 actions 1 à 4, puis phases 4 à 6.


## Lot r35 (fixeur) — S18 (indicateur d'impersonation, S18-a) et r35-m1

### Inventaire S18 avant intervention (relu dans `rapport-audit.md` et dans le code)

**Déjà fait et VALIDÉ** : S18 étape 0 (drapeau `FEATURE_IMPERSONATION_ENABLED`, désactivé par défaut : `features.ts:19-23`, route d'impersonation en 404 et bouton masqué tant qu'il est éteint), S18.1 (escalade `PLATFORM_ADMIN` vers `SUPER_ADMIN`), S18.2 (`@ForbiddenInImpersonation()` + balayage méta), S18.2-bis, S18.2-ter, S18.3 (plafond 12 h, MFA, révocation de la session administrateur), P4, S17. S18 est « clos côté code » (r18 à r19) ; l'ouverture du drapeau reste subordonnée à A8 (attribution des actions dans `AuditLog`, décision 5).

**Restait ouvert (compléments r32 et r33)** :
1. colonne `impersonatedBy` sur `RefreshToken` (migration) et libellé « Session d'assistance d'un administrateur » dans la liste des sessions : **fait dans ce lot** ;
2. champ `impersonated` sur l'élément `current` de `GET /auth/sessions` (depuis `req.user.impersonatedBy`, sans migration), et le client cesse de lire `planner_admin_original_session` : **fait** pour `SessionsSection` et pour le nouveau masquage ci-dessous ;
3. masquer « Connecter un dépôt » en impersonation, d'après l'information du serveur : **fait** ;
4. attribution des actions sous impersonation dans `AuditLog` : reporté à A8, hors de ce lot ;
5. décision `myRole` / `canManage` : **non implémentée** (non confirmée par l'utilisateur). S18 n'en dépend pas : le masquage en impersonation s'ajoute à `canManageProject` existant, sans le changer.

**Découpage** : tout le reste de S18 tient dans ce lot ; pas de S18-b. Le drapeau d'impersonation n'est **pas** réactivé (valeur par défaut `false` inchangée).

### S18-a — Indicateur de session d'impersonation et information fournie par le serveur

**Statut** : CORRIGÉ – À REVOIR

**Changement** :
- `backend/prisma/schema/auth.prisma` (`RefreshToken.impersonatedBy String? @db.VarChar(191)`) et migration `backend/prisma/migrations/20261114000000_s18_refresh_token_impersonated_by/migration.sql` (`ALTER TABLE ... ADD COLUMN ... NULL`).
- `backend/src/auth/session.service.ts` : `issue()` écrit `impersonatedBy` ; `listForUser(userId, currentSid, currentImpersonated)` renvoie `impersonated` pour chaque élément (colonne, ou, pour la session courante, drapeau issu du jeton d'accès) ; `SessionSummary.impersonated`. L'identifiant de l'administrateur n'est jamais renvoyé.
- `backend/src/auth/auth.controller.ts` : `GET /auth/sessions` transmet `Boolean(req.user.impersonatedBy)`.
- `frontend/src/security-api.ts` : `ActiveSession.impersonated`.
- `frontend/src/components/SessionsSection.tsx` : plus de lecture de `planner_admin_original_session` ; lecture seule si l'élément `current` est `impersonated` ; libellé « Session d'assistance d'un administrateur » sur toute session signalée.
- `frontend/src/useImpersonatedSession.ts` (nouveau) : lit `GET /auth/sessions` ; `null` en attente, `false` si la lecture échoue (le serveur reste l'autorité, 403).
- `frontend/src/components/IntegrationsPanel.tsx` : `canManage={canManageProject && impersonated === false}` (bouton masqué pendant le chargement et en impersonation).

**Tests** (écrits avec les correctifs ; contre-mutations ci-dessous) :
- `backend/tests/http/session-lifecycle.spec.ts` (+6, HTTP réel, bloc « S18 ») : colonne écrite par `issue()` et NULL pour une session ordinaire ; session courante d'impersonation `impersonated:true`, autres `false` ; depuis une session ordinaire la session d'assistance est signalée et la courante non ; session seule `false` ; session courante signalée d'après le jeton même si la colonne est vide ; aucune fuite de l'identifiant de l'administrateur.
- `frontend/.../SessionsSection.spec.tsx` : test d'impersonation réécrit sur la réponse serveur (libellé, aucune action) ; nouvel onglet sans clé de stockage ; la clé de stockage seule ne désactive rien ; libellé d'une autre session d'assistance, encore révocable.
- `frontend/.../IntegrationsPanel.spec.tsx` (+2) : bouton masqué en impersonation sans clé de stockage ; masqué tant que le serveur n'a pas répondu ; `listSessions` simulé pour les autres tests.

**Contre-mutations** (fichier restauré par `/bin/cp -f`, `md5sum -c` : 0 écart à la fin ; aucun processus en attente) :

| Mutation | Résultat |
| --- | --- |
| `issue()` n'écrit plus `impersonatedBy` | 2 échecs |
| `impersonated` ne lit plus la colonne | 1 |
| drapeau du jeton ignoré pour la session courante | 1 |
| drapeau du jeton appliqué à toutes les lignes | 1 |
| `impersonatedBy` exposé dans la liste | 1 |
| contrôleur ne transmet plus le drapeau | 1 |
| `SessionsSection` relit `planner_admin_original_session` | 3 |
| libellé retiré | 2 |
| `readOnly` toujours faux | 2 |
| hook : test inversé (`=== false`) | 3 |
| panneau : `impersonated !== true` (visible pendant le chargement) | 1 |
| panneau : garde retirée | 2 |

Incident de méthode, corrigé : un premier passage de mutations a été lancé avec une liste de fichiers non découpée par zsh, donc sans sauvegarde ; les mutations se sont cumulées dans le working tree. Les fichiers ont été remis à l'état voulu (`auth.service.ts` par `git checkout`, qu'aucune modification légitime ne touchait ; les autres à la main, vérifiés par `git diff`), puis toutes les mutations ont été rejouées avec sauvegardes et `md5sum -c` (résultats ci-dessus). Les sauvegardes d'un ancien fichier `scratchpad/orig` (fichier, pas dossier) n'ont pas été touchées.

**Migration** : `20261114000000_s18_refresh_token_impersonated_by`, additive et nullable, sans reprise : les sessions existantes restent à NULL (ordinaires) ; une session d'impersonation créée avant le déploiement (15 min au plus, drapeau éteint) ne serait pas libellée. `prisma validate` et `generate` OK. Note : `prisma format` reformate tous les fichiers de schéma ; non appliqué (les autres schémas ont été restaurés).
**Changements cassants** : `GET /auth/sessions` ajoute `impersonated` à chaque élément (additif). Le client ne lit plus `planner_admin_original_session` pour `SessionsSection` ; `AdminConsole` la lit encore pour le bouton « Quitter l'impersonation » (usage de bascule de session, hors périmètre). Un frontend ancien avec ce backend continue de fonctionner.
**Écart par rapport au rapport** : (1) la colonne enregistre l'administrateur, mais le client ne reçoit qu'un booléen (identité non exposée) ; (2) pour la session courante, le drapeau du jeton et la colonne sont combinés par OU, le rapport ne demandant que le jeton ; (3) pendant le chargement de l'information, « Connecter un dépôt » est masqué (choix de sûreté, à confirmer).
**Questions pour l'architecte** :
1. Faut-il aussi dériver le bouton « Quitter l'impersonation » de la console admin de l'information serveur ? Il dépend encore de la clé de stockage (nécessaire à la restauration de la session de l'administrateur) ; non modifié.
2. La décision `myRole` / `canManage` reste en attente de l'utilisateur ; ce lot ne la préjuge pas.
3. Ouverture du drapeau toujours subordonnée à A8 (décision 5) : inchangé.

### r35-m1 — Test de casse de `hasActiveSso`

**Statut** : CORRIGÉ – À REVOIR

**Changement** : aucun code produit (test seul).
**Tests** : `backend/tests/unit/auth/identity-linking.spec.ts` (+1) : adresse `Alice@ACME.com`, configuration SSO au domaine `acme.com` en minuscules, sans mot de passe : `canUnlink.github` vrai et déliaison réussie. Contre-mutation : `toLowerCase()` retiré de `hasActiveSso` -> 1 échec (restauré, md5 vérifié).
**Écart par rapport au rapport** : aucun. **Questions** : aucune.

### Mesures (après Prettier final)
| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **87/87 suites, 2529/2529** (2522 avant) |
| `nest build` ; `tsc --noEmit -p tests/tsconfig.json` ; `tsc --noEmit -p tsconfig.build.json` ; frontend `tsc --noEmit` ; `pnpm build` | exit 0 partout |
| `cd frontend && vitest run` | **28 fichiers, 202/202** (197 avant) |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine ; Prettier sur les fichiers modifiés | 0 erreur (53 avertissements inchangés) ; conforme |

`tsc --noEmit -p tsconfig.json` (backend) signale une erreur `rootDir` sur `src/tracking/tracking.gateway.spec.ts`, sans lien avec ce lot (fichier non touché).


## Revue architecte (r36)

Revue du « Lot r35 (fixeur) » : voir `rapport-audit.md`, section « Revue r36 ». Mesures relancées (jest 87/87 suites, 2529 tests ; vitest 28 fichiers, 202 tests ; builds, `tsc`, lint, Prettier, `prisma validate` OK ; `mock/login` absent du bundle). `git diff` relu en entier : aucune mutation résiduelle de l'incident, 13 entrées, `auth.service.ts` identique à HEAD. 12 contre-mutations de l'architecte, `md5sum` identique avant et après.

#### Revue architecte — S18-a : **VALIDÉ** (S18 clos côté code)

Migration additive et nullable, champ `impersonated` sans fuite de l'identité, `SessionsSection` sans lecture du stockage, masquage de « Connecter un dépôt » fondé sur le serveur. Les 3 écarts sont acceptés (booléen seul ; OU colonne et jeton ; masquage pendant le chargement, à confirmer par l'utilisateur). Réponses : (1) ne pas toucher `AdminConsole`, la clé sert à restaurer la session administrateur ; (2) `myRole` / `canManage` reste en attente de l'utilisateur, avec A5 à A9 ; (3) attribution `AuditLog` à A8, drapeau éteint jusqu'alors. Réserve mineure **r36-m1** : M10 (échec de lecture traité comme impersonation) et M11 (`some` au lieu de `current`) non détectées, deux tests à ajouter au panneau.

#### Revue architecte — r35-m1 : **VALIDÉ**

M12 (`toLowerCase()` retiré de `hasActiveSso`) détectée.

#### Nouveau constat

O21 (Amélioration) : l'erreur `rootDir` de `tsc --noEmit -p tsconfig.json` est préexistante (reproduite sur HEAD) ; à traiter avec A9.

#### Feu vert de commit

Un seul commit, 14 entrées de `git status` (les 13 du fixeur plus `rapport-audit.md`) hors dossier d'agent local (liste dans le rapport). Aucun changement cassant. Une migration additive à appliquer avant le nouveau backend ; déployer backend et frontend ensemble.

#### Constats encore ouverts

r36-m1 (mineur) ; S30 (actions d'exploitation 1 à 4) ; Phase 5 (S19 à S26 hors `mock/login`, A5 à A7, P5, P8, O10 à O17) ; Phase 6 (A8, A9 avec O21, P2, P7, Q-2).


## Lot r36 (fixeur)

Périmètre demandé : S19 à S22 et r36-m1. **S19 et S20 sont traités** dans ce lot (chacun est volumineux : module réseau, DTO, e-mails, frontend). **S21 et S22 ne sont pas traités** et forment le lot suivant ; leur état et leur plan sont consignés ci-dessous. Aucune migration Prisma dans ce lot. Aucun commit.

### État initial et plan (S19 à S22)

| Constat | État avant le lot (relu dans le code) | Plan |
| --- | --- | --- |
| S19 | Non traité. `IntegrationDto` était une interface (aucune validation) ; `fetch(url)` direct sur l'URL stockée dans `calendar-sync.service.ts` (flux ICS/JSON, titres renvoyés dans les messages de conflit) et dans `integration.service.ts` (`postToWebhook`, corps de réponse mis dans l'exception donc journalisé) ; URL de flux journalisée en clair. Les autres `fetch` (Google, Microsoft, GitHub, points d'accès SSO) visent des hôtes fixés dans le code. | Fait dans ce lot (voir S19). |
| S20 | Non traité. `CreateCommentDto.attachments` : `@IsArray` seulement ; `POST tasks/:taskId/attachments` avec un type inline ; `fileUrl` stocké tel quel ; `<a href={att.fileUrl}>` à 2 endroits ; e-mails d'invitation et de mention sans échappement (`escapeHtml` n'était appliqué qu'aux e-mails simples). | Fait dans ce lot (voir S20). |
| S21 | Non traité. `POST /projects/webhooks/github` public ; HMAC sur `JSON.stringify(payload)` ; secret unique `GITHUB_WEBHOOK_SECRET` ; `return NODE_ENV === 'test'` si le secret est absent ; `closeTaskFromWebhook(taskId)` ferme n'importe quelle tâche par UUID ; pas d'anti-rejeu. `main.ts` sans `rawBody`. `Project.githubRepo` est posé par `auth.service.ts:631` (P9-R). | Lot suivant : (1) `rawBody: true` et HMAC sur `req.rawBody` ; (2) colonne `Project.githubWebhookSecret` chiffrée (migration additive nullable, nom daté) générée à la liaison du dépôt, secret montré une seule fois à l'utilisateur (**décision produit**) ; (3) route `POST /projects/:id/webhooks/github` (l'ancienne route supprimée, ou 410) et exemption CSRF de `origin-guard.ts` ajustée ; (4) `closeTaskFromWebhook(projectId, taskId)` limité au projet et `payload.repository.full_name === githubRepo` ; (5) `X-GitHub-Delivery` dans Redis, TTL 24 h ; (6) suppression du passe-droit `NODE_ENV === 'test'` ; (7) tests listés au rapport. |
| S22 | Non traité. `frontend/nginx.prod.conf` n'a aucun en-tête de sécurité. | Lot suivant, avec O16 (`Cache-Control: no-store` sur `/auth/*` et `/admin/*`, rattaché à la Phase 5 par le rapport) : en-têtes avec `always` sur `/` et sur le bloc des assets (nginx n'hérite pas des `add_header` d'un bloc enfant qui en déclare un), `scripts/check-headers.sh`. Le domaine API de `connect-src` et les domaines Firebase réellement utilisés sont à fournir (**question**). |

### r36-m1 — Deux tests du panneau d'intégrations

**Statut** : CORRIGÉ – À REVOIR

**Changement** : aucun code produit.
**Tests** : `frontend/src/components/IntegrationsPanel.spec.tsx` (+2) : (a) `listSessions` rejeté : « Connecter un dépôt » s'affiche ; (b) session courante ordinaire et autre session de la liste d'assistance : le bouton s'affiche.
**Contre-mutations** (fichier restauré par `/bin/cp -f`, md5 identiques) : hook `.catch` -> `setImpersonated(true)` : détectée ; `find(current)` remplacé par `some(impersonated)` : détectée (M49, M50 ci-dessous).
**Écart par rapport au rapport** : aucun. **Questions** : aucune.

### S19 — SSRF par les URL d'intégration

**Statut** : CORRIGÉ – À REVOIR

**Cause confirmée** : `integration.service.ts` (interface sans validation, `fetch(url)` sur l'URL stockée, corps de réponse dans l'exception) ; `calendar-sync.service.ts` (`fetch(url)` du flux, URL journalisée).

**Changement** :
- `backend/src/common/safe-fetch.ts` (nouveau) : `safeFetch(url, options)`. HTTPS seul, port 443 seul, pas d'identifiants dans l'URL, nom d'hôte avec au moins un point (`cache`, `localhost` refusés) ; résolution DNS préalable (`dns.lookup all`), refus si **une seule** adresse résolue est privée ou réservée ; `isForbiddenAddress` (IPv4 : 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4 ; IPv6 : `::/96` (non spécifiée, loopback, compatible IPv4), `::ffff:0:0/96` (mappées), NAT64, `100::/64`, Teredo, `2001:db8::/32`, 6to4, ULA, link-local, multicast) ; connexion TLS **ouverte sur l'adresse validée** (`host: <ip>`, `servername` = nom d'hôte pour SNI et certificat, en-tête `Host`) : pas de seconde résolution, donc pas de rebinding DNS ; redirections suivies à la main (3 au plus, 0 pour les POST), chacune revalidée (protocole, hôte, liste blanche, adresses) ; délai total de 5 s ; réponse limitée à 1 Mio (connexion détruite au-delà) ; types de contenu optionnels vérifiés (sans paramètres, insensible à la casse) ; `allowHost` appliqué à chaque saut. Points d'injection `resolve` et `transport` pour les tests.
- `backend/src/projects/integration-url.ts` (nouveau) : liste blanche par type (Slack `hooks.slack.com` ; Teams `*.webhook.office.com`, `*.logic.azure.com` et `*.powerplatform.com` ; calendriers : hôte public quelconque), IP littérales et hôtes sans point toujours refusés ; types de contenu des flux : `text/calendar`, `application/json`.
- `backend/src/projects/dto/create-integration.dto.ts` (nouveau) : `@IsIn` sur les 4 types, `@IsUrl({ protocols:['https'], require_protocol, require_tld })`, `@MaxLength(2048)` ; nom et `calendarId` bornés à 191 (taille des colonnes). `projects.controller.ts` : `@Body() body: CreateIntegrationDto` ; l'interface `IntegrationDto` est supprimée.
- `integration.service.ts` : `createIntegration` refuse (400) une URL hors liste blanche du type (IP littérale, hôte voisin comme `hooks.slack.com.evil.example`, port, `http`) ; `postToWebhook` passe par `safeFetch` (sans redirection, `allowHost` revérifié à l'envoi pour les lignes antérieures), et l'erreur ne contient plus que `HTTP <statut>` (corps ni renvoyé ni journalisé).
- `calendar-sync.service.ts` : `fetchExternalEvents` passe par `safeFetch` avec les types de contenu autorisés ; l'URL (qui peut contenir un jeton de flux privé) n'est plus journalisée ; toute erreur de `safeFetch` reste mappée en 502 générique (le motif du refus n'est pas renvoyé au client).

**Tests** : `tests/unit/common/safe-fetch.spec.ts` (51 : `http://127.0.0.1`, `http://169.254.169.254`, `http://[::1]`, `http://cache:6379`, `https://[::ffff:127.0.0.1]`, domaine résolvant vers 10.0.0.1 (DNS mocké), résolution mixte, redirection 302 vers 127.0.0.1, redirection vers hôte résolvant en privé, liste blanche revalidée à chaque saut, 3 sauts au plus, 0 saut, épinglage, types de contenu, 33 adresses classées) ; `tests/unit/projects/integration-ssrf.spec.ts` (30 : `type:'FOO'`, `url:'http://...'`, `javascript:`, hôte sans domaine, URL trop longue, champ inconnu : 400 ; 10 URL refusées et 4 acceptées à la création ; `postToWebhook` : options de `safeFetch`, corps de réponse absent des journaux) ; `calendar-sync.service.spec.ts` (+2 : options passées à `safeFetch` et URL absente des journaux ; refus de `safeFetch` donne un 502 sans le motif ; 5 tests existants adaptés pour simuler `safeFetch` au lieu de `fetch`). Vérification manuelle du transport réel (hors CI) : `safeFetch('https://example.com/')` renvoie 200 `text/html` (SNI et certificat valides sur l'adresse épinglée), un hôte inexistant échoue, `maxBytes: 100` interrompt la réponse.
**Contre-mutations** : M1 à M23 ci-dessous (toutes détectées).

**Écart par rapport au rapport** :
1. Pas de `ipaddr.js` ni d'agent `undici` : `node:net.BlockList` pour les plages (aucune dépendance ajoutée) et `node:https` avec connexion épinglée sur l'IP validée, qui donne la même garantie que l'agent à `lookup` personnalisé. Deux `BlockList` distinctes (IPv4 et IPv6), car Node confronte une IPv4 aux règles IPv6 sous forme mappée (premier essai : tout était refusé).
2. Les IPv4 mappées en IPv6 sont refusées en bloc, plutôt que dépliées : un DNS n'en renvoie jamais de légitime.
3. Types de contenu des flux limités à `text/calendar` et `application/json`, comme le rapport. Des serveurs servent des ICS en `text/plain` ou `application/octet-stream` : ces flux seraient refusés (502).
4. Teams : `*.powerplatform.com` ajouté aux deux domaines du rapport (nouveaux webhooks Power Automate), à confirmer.
5. Les `fetch` vers Google, Microsoft, GitHub et les points d'accès SSO ne sont pas migrés : hôtes fixés dans le code, aucune donnée utilisateur dans l'hôte (sauf `calendarId` encodé dans le chemin).

**Changements cassants** : une intégration Slack/Teams existante dont l'URL est hors liste blanche, ou un flux d'agenda en `http`/non `text/calendar`/`application/json`, cesse de fonctionner (échec journalisé, ou 502 pour un flux). Aucune migration de données ; **reprise recommandée** : requête de recensement des lignes `Integration` dont l'URL ne passe pas `isAllowedIntegrationUrl` avant la mise en production.
**Questions pour l'architecte** : (a) accepter `text/plain` pour les flux ICS ? (b) liste Teams : `powerplatform.com` accepté ? (c) un nettoyage des lignes existantes non conformes est-il à planifier (script d'exploitation) ?

### S20 — XSS stockée (pièces jointes) et injection HTML dans les e-mails

**Statut** : CORRIGÉ – À REVOIR

**Cause confirmée** : `create-comment.dto.ts` (`@IsArray` seul), `comments.controller.ts` (type inline pour `POST tasks/:taskId/attachments`), `comments.service.ts` (`fileUrl` stocké tel quel), `TaskCommentsPanel.tsx` (`href={att.fileUrl}` x2), `mail.service.ts` (invitation et mention sans échappement).

**Changement** :
- `backend/src/projects/attachment-url.ts` (nouveau) : `isSafeAttachmentUrl` : `https:` (2048 caractères au plus, sans identifiants) ou `data:` base64 d'un type de la liste blanche (`image/png|jpeg|gif|webp`, `application/pdf`). `javascript:`, `vbscript:`, `http:`, `data:text/html`, `data:image/svg+xml` refusés.
- `backend/src/projects/dto/attachment.dto.ts` (nouveau) : `AttachmentDto` (`fileName` 1 à 255 sans `/`, `\` ni caractère de contrôle ; `fileUrl` ; `fileType` 127 ; `fileSize` entier de 0 à 10 Mio). `create-comment.dto.ts` : `@ArrayMaxSize(10)`, `@ValidateNested({ each: true })`, `@Type`. `comments.controller.ts` : `@Body() body: AttachmentDto`.
- `comments.service.ts` : `createComment` et `createAttachmentForTask` revérifient les URL (`BadRequestException`) **après** l'autorisation (un appelant non autorisé reçoit 403, pas une réponse de validation).
- `mail.service.ts` : e-mails d'invitation et de mention : espace, invitant, rôle, expéditeur, titre de tâche, extrait, lien et titre HTML passent par `escapeHtml` ; `singleLine()` retire CR/LF/U+2028/9 des objets, à la construction et à l'envoi.
- Frontend : `frontend/src/safe-href.ts` (nouveau, `https:` ou `data:` admis, sinon `undefined`), appliqué aux 2 `href` de `TaskCommentsPanel.tsx` ; `accept` des deux champs fichier aligné sur les types acceptés par le serveur.

**Tests** : `tests/unit/projects/attachment-dto.spec.ts` (19 : `javascript:alert(1)` (casse, espace), `http:`, `data:text/html`, `data:image/svg+xml`, `blob:`, `file:`, identifiants, noms avec `/` ou `\`, taille, champ inconnu : 400 ; liste imbriquée validée, 11 éléments refusés) ; `comments.service.spec.ts` (+9 : refus des 7 URL pour `createAttachmentForTask`, `createComment` refuse `javascript:` sans transaction, image `data:` acceptée) ; `src/mail/mail.service.escape.spec.ts` (6 : `workspaceName = '<a href=x>'` donne `&lt;a href=x&gt;`, invitant, rôle, titre HTML, expéditeur/tâche/extrait d'une mention, jeton cassant l'attribut, objets sur une ligne) ; frontend `safe-href.spec.ts` (16) et `TaskCommentsPanel.spec.tsx` (1 : pièces jointes `javascript:` de commentaire et de tâche rendues **sans attribut `href`**, liens `https:` et `data:` PDF conservés).
**Contre-mutations** : M24 à M48 ci-dessous.

**Écart par rapport au rapport** : (1) la liste blanche des types MIME s'applique aux URL `data:` seulement, `fileType` n'est borné qu'en longueur ; (2) taille maximale de 10 Mio (valeur choisie, alignée sur P5) ; (3) la CSP du frontend (point 4 du rapport) relève de S22, lot suivant ; (4) `safeHref` n'est appliqué qu'aux deux `href` alimentés par des données (seuls existants, vérifié par recherche de `href={`) ; (5) la montée vers React 19 n'est pas faite.
**Changements cassants** : les pièces jointes hors images et PDF (par exemple `.docx`, `.zip`, texte) sont désormais refusées en 400, alors que l'interface les acceptait (en base64, sous la limite d'environ 70 Ko du parseur JSON). Le sélecteur de fichier ne propose plus que les types acceptés. Les pièces jointes déjà stockées sont conservées mais leur lien est masqué si l'URL est dangereuse ; aucune reprise en base.
**Questions pour l'architecte** : (a) le périmètre des types acceptés (images et PDF seulement) convient-il en attendant P5 ? (b) un recensement des lignes `Attachment` dont `fileUrl` ne passe pas `isSafeAttachmentUrl` est-il à demander à l'exploitation ?

### Contre-mutations du lot (méthode imposée)

Sauvegarde de chaque fichier dans le bac à sable avant mutation, une mutation à la fois, restauration par `/bin/cp -f` dans un `finally`, `md5` de chaque fichier comparé avant/après chaque mutation et en fin de passage (identiques), aucun processus en attente. 50 mutations ; 45 détectées au premier passage, 5 non détectées (M21, M28, M31, M32, M35) puis les tests ont été renforcés (ou la mutation corrigée) et rejouées : **50/50 détectées**.

| Mutations | Fichier | Résultat |
| --- | --- | --- |
| M1 plage 169.254/16 retirée ; M10 ULA retiré | `safe-fetch.ts` | détectées |
| M2 `some` -> `every` (une seule IP interdite suffit) ; M3 HTTPS non exigé ; M7 port libre ; M8 hôte sans point admis | `safe-fetch.ts` | détectées |
| M4 plus d'épinglage ; M5 redirections 10 ; M6 type de contenu ignoré ; M9 `allowHost` ignoré ; M11 redirection non revalidée | `safe-fetch.ts` | détectées |
| M12 IP littérale admise ; M13 `endsWith` -> `includes` (Teams) ; M14 Slack par `includes` | `integration-url.ts` | détectées |
| M15 pas de liste blanche à la création ; M16 redirections suivies ; M17 `allowHost` retiré à l'envoi ; M18 corps de réponse dans l'erreur | `integration.service.ts` | détectées |
| M19 `http` admis ; M20 type libre ; M21 longueur 2048 retirée (test renforcé : URL de 2059 caractères) | `create-integration.dto.ts` | détectées |
| M22 types de contenu retirés ; M23 URL journalisée | `calendar-sync.service.ts` | détectées |
| M24 à M30, M32 (invitant, espace, rôle, titre HTML, expéditeur, tâche, extrait, lien non échappés) ; M31 objet multi-ligne à l'envoi | `mail.service.ts` | détectées (M28, M31, M32 après renforcement des tests) |
| M33 `http` admis ; M34 `data:` libre ; M35 type MIME hors liste admis (première version de M35 sans effet : `+` de `svg+xml` non échappé dans l'expression, mutation refaite avec `text/html`) ; M36 identifiants admis | `attachment-url.ts` | détectées |
| M37 nom avec `/` ; M38 taille maximale retirée | `attachment.dto.ts` | détectées |
| M39 liste imbriquée non validée ; M40 limite de 10 retirée | `create-comment.dto.ts` | détectées |
| M41 `createComment` sans contrôle ; M42 `createAttachmentForTask` sans contrôle | `comments.service.ts` | détectées |
| M43 contrôleur à type inline | `comments.controller.ts` | détectée (test de matrice, DTO classe) |
| M44 `safeHref` renvoie tout ; M45 `http` admis ; M46 `data:` libre | `safe-href.ts` | détectées |
| M47 lien de commentaire brut ; M48 lien de tâche brut | `TaskCommentsPanel.tsx` | détectées |
| M49 hook : échec = impersonation ; M50 hook : `some(impersonated)` | `useImpersonatedSession.ts` | détectées (r36-m1) |

Un incident de conception de test, corrigé : le premier mock de `useApp` du test du panneau renvoyait des objets neufs à chaque rendu et provoquait une boucle de chargement (l'effet dépend de `workspaceMembers`) ; le mock renvoie désormais une valeur stable.

### Migrations
Aucune. Le schéma Prisma n'est pas modifié (`prisma validate` non requis).

### Changements cassants (récapitulatif)
- S19 : intégrations Slack/Teams hors liste blanche et flux d'agenda non conformes (`http`, type de contenu autre que `text/calendar` ou `application/json`) cessent de fonctionner.
- S20 : pièces jointes limitées aux images et PDF (400 sinon).
- Contrat d'API : aucun champ ajouté ni retiré ; seuls des refus 400 nouveaux.

### Mesures (après Prettier)
| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **91/91 suites, 2640/2640** (87 suites, 2529 tests avant) |
| `nest build` ; `tsc --noEmit -p tests/tsconfig.json` ; `tsc --noEmit -p tsconfig.build.json` ; frontend `tsc --noEmit` ; `pnpm build` | exit 0 partout |
| `cd frontend && vitest run` | **30 fichiers, 221/221** (28 fichiers, 202 avant) |
| `grep -l -e "mock/login" -e "Simuler une session" frontend/dist/assets/*.js` | vide (exit 1) |
| `pnpm lint` racine ; Prettier sur les fichiers modifiés | 0 erreur (53 avertissements inchangés) ; conforme |

Note : `tsc --noEmit -p tsconfig.json` (backend) garde l'erreur `rootDir` préexistante (O21).

### Constats restants de la Phase 5 (lot suivant)
S21 (webhook GitHub) puis S22 (en-têtes nginx, avec O16), conformément à l'ordre de la revue r36. Décisions à obtenir : affichage du secret de webhook par projet (S21), domaines API et Firebase pour la CSP (S22).


## Revue architecte (r37) — lot r36

Verdicts : **S19 VALIDÉ**, **S20 VALIDÉ**, **r36-m1 VALIDÉ** (réserves non bloquantes). Détail, sondes, contre-mutations de l'architecte, réponses aux 7 questions, exigences S21 et S22 et feu vert de commit : section « Revue r37 » à la fin de `docs/security/rapport-audit.md`.

- **Mesures relancées** : jest 91 suites / 2640 tests, `nest build`, `tsc` (tests, build, frontend), `pnpm build`, vitest 30 fichiers / 221 tests, grep `mock/login` vide, lint 0 erreur, Prettier conforme. `git diff` relu : aucune mutation résiduelle ; working tree identique (md5) après mes contre-mutations.
- **S19** : plages IPv4/IPv6 sondées (49 adresses), hôtes numériques, `localhost.`, rebinding (connexion sur l'adresse validée), certificat vérifié contre le nom d'hôte sur l'IP épinglée, taille et délai appliqués (vérifiés sur serveur HTTPS local). Réserves : r37-m1 (`defaultTransport` non testé en CI : 3 mutations non détectées), r37-m2 (seule la première adresse essayée, DNS non borné par le délai), r37-m3 (`text/plain` ICS), r37-a1 (plages complémentaires).
- **S20** : validé. Réserve r37-m4 (ancre `$` de l'expression `data:` non testée).
- **Écarts** : les 5 écarts acceptés. **Questions** : les 7 tranchées (voir rapport) ; décisions produit et d'exploitation (`text/plain`, `powerplatform.com`, recensement, types de pièces jointes, secret affiché une fois) **à confirmer par l'utilisateur**.
- **Commit** : feu vert, un seul commit, 25 entrées sans `.claude/`.
- **Constats ouverts** : r37-m1, r37-m2, r37-m3, r37-m4, r37-a1 (petit lot), puis S21, puis S22 avec O16.


## Lot r37 (fixeur) — r37-m1, r37-m2, r37-m3, r37-m4, r37-a1

### r37-m1 — `defaultTransport` testé en CI (serveur TLS local)

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `backend/src/common/safe-fetch.ts` : `defaultTransport` exporté ; champ optionnel `ca` dans `PinnedRequest`, transmis à `httpsRequest` (réservé aux tests ; `safeFetch` ne le renseigne jamais, aucune option publique). Nouveau `backend/tests/unit/common/safe-fetch.transport.spec.ts` : serveur `node:https` sur 127.0.0.1, deux certificats ECDSA éphémères générés par `openssl` (binaire présent sur `ubuntu-latest`) dans un dossier temporaire supprimé en fin de suite (aucun secret dans le dépôt). Connexion épinglée sur 127.0.0.1, URL `https://localhost:PORT/`, certificat valable pour `localhost` seulement (donc invalide pour l'IP).

**Tests** (10, tous verts) : certificat vérifié contre le nom d'hôte (SNI `localhost` reçu, `Host` = `localhost:PORT`) ; `servername` passé explicitement (espion sur `https.request`, absent pour une URL en IP) ; certificat d'un autre nom refusé (altnames) ; certificat non approuvé refusé ; dépassement de `maxBytes` interrompu ; réponse exactement à la limite acceptée ; réponse qui ne se termine jamais (un octet toutes les 50 ms, pour que le délai d'inactivité de la socket ne masque pas le minuteur global) coupée à `timeoutMs` ; connexion coupée à l'établissement TLS ; connexion coupée en cours de réponse ; `safeFetch` de bout en bout refuse 127.0.0.1.

**Contre-mutations** (sauvegarde bac à sable, restauration `/bin/cp -f`, une à la fois) :
| Mutation | Résultat |
| --- | --- |
| `servername` supprimé | détectée par le test de l'espion (voir écart) |
| `servername: ''` ; `servername: req.address` ; `servername` supprimé et `Host: req.address` | détectées (4 à 6 tests en échec, dont le test de certificat) |
| contrôle `maxBytes` désactivé (`if (false)`) | détectée |
| minuteur global neutralisé | détectée (test de réponse sans fin) |

**Écart par rapport au rapport** : la suppression pure de `servername` ne change pas le comportement réel : l'Agent HTTPS de Node déduit le nom SNI et du certificat de l'en-tête `Host` (`calculateServerName`), que `defaultTransport` force à `url.host`. Un test de comportement seul (serveur TLS) ne peut donc pas la détecter : c'est un mutant équivalent. Pour satisfaire le critère, un test fige le contrat explicite (espion sur `https.request`, option `servername` égale au nom d'hôte). Toute variante qui change réellement le comportement est détectée par les tests de comportement.

**Questions pour l'architecte** : l'espion couple le test à `https.request` appelé via le module ; acceptable ? `openssl` est requis par la suite : à confirmer côté CI (présent sur `ubuntu-latest` ; l'image Node alpine ne l'a pas toujours).

### r37-m2 — adresses essayées à tour de rôle, DNS borné

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `safe-fetch.ts` : `resolvePublicAddresses` renvoie toutes les adresses, **toutes validées** (une seule interdite refuse l'hôte), IPv4 d'abord ; la résolution est bornée par `timeoutMs` (`withTimeout`, minuteur nettoyé). `safeFetch` essaie les adresses dans l'ordre et passe à la suivante seulement sur `ECONNREFUSED`, `ENETUNREACH`, `EHOSTUNREACH`, `EADDRNOTAVAIN`, `ETIMEDOUT` (échec de connexion, rien envoyé : sans risque de doubler un POST). Délai dépassé, réponse trop volumineuse, certificat invalide, `ECONNRESET` : pas de bascule. Après la dernière adresse, la dernière erreur est relevée.

**Tests** (`safe-fetch.spec.ts`, 5 ajoutés) : IPv4 avant IPv6 puis bascule après `ECONNREFUSED` ; bascule vers IPv6 quand l'IPv4 échoue ; dernière erreur relevée ; pas de bascule sur `SafeFetchError` ni `ECONNRESET` ; adresse interdite parmi d'autres : aucune connexion ; DNS qui ne répond pas : « Délai » en moins de 1,5 s sans transport.

**Contre-mutations** : bascule retirée (4 échecs), tri IPv4 d'abord retiré (2), DNS non borné (1, par dépassement du délai de test) : toutes détectées.

**Écart / question** : chaque tentative dispose de `timeoutMs` (budget par adresse, comme par saut auparavant) ; une adresse qui se bloque sans refuser consomme son délai puis la bascule est tentée seulement pour les codes ci-dessus, donc pas après un « Délai dépassé ». Budget global par appel à définir si l'architecte le souhaite.

### r37-m3 — `text/plain` pour les flux ICS

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `backend/src/projects/integration-url.ts:12` : `CALENDAR_FEED_CONTENT_TYPES = ['text/calendar', 'text/plain', 'application/json']`.
**Tests** : `safe-fetch.spec.ts` (`text/plain; charset=utf-8` accepté, `text/html` et `application/octet-stream` refusés, avec la constante réelle) ; `calendar-sync.service.spec.ts` (liste transmise à `safeFetch` mise à jour). **Contre-mutation** : `text/plain` retiré : détectée (2 échecs).
**Question** : décision à confirmer par l'utilisateur (déjà notée par l'architecte).

### r37-m4 — ancre de fin de l'expression `data:`

**Statut** : CORRIGÉ – À REVOIR

**Changement** : tests seulement. `attachment-dto.spec.ts` (backend) et `safe-href.spec.ts` (frontend) : `data:image/png;base64,AAAA` suivi d'un espace, de `"`, de `"onerror="x`, d'un saut de ligne, d'un saut de ligne plus `<script>` : refusé.
**Contre-mutations** : ancre `$` retirée côté backend (`attachment-url.ts`) : détectée (5 échecs) ; côté frontend (`safe-href.ts`) : détectée (5 échecs).

### r37-a1 — plages complémentaires

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `safe-fetch.ts` : `64:ff9b:1::/48`, `fec0::/10`, `192.88.99.0/24` ajoutées. **Tests** : bornes basses et hautes refusées (`64:ff9b:1:ffff::1`, `febf::1`, `192.88.99.255`), voisins publics admis (`192.88.98.255`, `192.88.100.0`). **Contre-mutations** : chacune des trois lignes retirée : détectée (1 à 2 échecs).

### Mesures
| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **92 suites, 2670/2670** (91 suites, 2640 avant) |
| `nest build` ; `tsc --noEmit -p tsconfig.test.json` ; `-p tsconfig.build.json` ; frontend `tsc --noEmit` ; `pnpm build` | exit 0 ; `tsconfig.json` garde l'erreur `rootDir` préexistante (O21) |
| `cd frontend && vitest run` | **30 fichiers, 226/226** (221 avant) |
| `grep -rlE "mock/login\|Simuler une session" frontend/dist/assets` | vide |
| Lint racine ; Prettier sur les fichiers modifiés | 0 erreur (53 avertissements inchangés) ; conforme |

Contrôle des mutations : après chaque restauration, `cmp` avec la sauvegarde identique pour les 4 fichiers source mutés ; aucun processus jest ou vitest en attente.

### Migrations et changements cassants
Aucune migration. Changements de comportement : les flux ICS servis en `text/plain` sont acceptés ; les hôtes dont l'adresse résolue tombe dans les trois nouvelles plages sont refusés ; un hôte à plusieurs adresses bascule sur la suivante après échec de connexion.

## Revue architecte (r38) — lot r37

Mesures relancées : jest 92 suites 2670/2670, nest build, tsc (tests, build, frontend), pnpm build, vitest 226/226, grep `dist/assets` vide, lint 0 erreur, Prettier conforme ; `git diff` relu, aucune mutation résiduelle.

- **r37-m1 : VALIDÉ.** Serveur TLS local, certificats éphémères, `ca` réservé aux tests. Mutations `ca`, `servername` détectées. Espion sur `https.request` : accepté (mutant équivalent figé, réserve de couplage). `openssl` sur `ubuntu-latest` : acceptable.
- **r37-m2 : À REPRENDRE.** `safe-fetch.ts:187` : `'EADDRNOTAVAIN'` doit être `'EADDRNOTAVAIL'` (confirmé : la constante n'existe pas dans `os.constants.errno`). Contre-mutations « EADDRNOTAVAIN retiré » et « ETIMEDOUT retiré » : non détectées. À faire : corriger la faute ; `it.each` sur les 5 codes (première adresse en échec, seconde réussit) ; test garde-fou que chaque code de `RETRYABLE_CODES` appartient à `Object.keys(os.constants.errno)` (exporter la constante ou équivalent). Critère : retirer une ligne ou réintroduire la faute fait échouer un test. Budget de délai par adresse : accepté. Voir r38-m1 dans le rapport.
- **r37-m3 : VALIDÉ** (décision `text/plain` à confirmer par l'utilisateur).
- **r37-m4 : VALIDÉ.**
- **r37-a1 : VALIDÉ.**

Pas de commit tant que r38-m1 n'est pas repris. Ouvert : r38-m1, puis S21, S22 + O16.


## Reprise r38 (fixeur) — r38-m1

### r38-m1 — faute de frappe `EADDRNOTAVAIN` dans les codes de bascule d'adresse

**Statut** : CORRIGÉ – À REVOIR

**Cause confirmée** : `backend/src/common/safe-fetch.ts:187` contenait `'EADDRNOTAVAIN'` ; `os.constants.errno` ne connaît que `EADDRNOTAVAIL`. La bascule ne se déclenchait jamais sur cette erreur.

**Changement** : `safe-fetch.ts` : `'EADDRNOTAVAIL'` ; `RETRYABLE_CODES` exportée.

**Tests** (`backend/tests/unit/common/safe-fetch.spec.ts`, 7 ajoutés) : `it.each` sur les 5 codes (première adresse en échec avec ce code, seconde réussit, exactement 2 appels au transport) ; le jeu de codes est exactement les 5 attendus ; garde-fou : chaque code appartient à `Object.keys(os.constants.errno)`.

**Contre-mutations** (sauvegarde bac à sable, `/bin/cp -f`, une à la fois, `cmp` identique après chaque restauration) :
| Mutation | Résultat |
| --- | --- |
| ligne `ECONNREFUSED` retirée | détectée (7 échecs) |
| ligne `ENETUNREACH` retirée | détectée (4) |
| ligne `EHOSTUNREACH` retirée | détectée (5) |
| ligne `EADDRNOTAVAIL` retirée | détectée (4) |
| ligne `ETIMEDOUT` retirée | détectée (4) |
| faute `EADDRNOTAVAIN` réintroduite | détectée (5) |

**Écart par rapport au rapport** : aucun.

**Mesures** : jest backend (`env -u DATABASE_URL`) 92 suites, 2677/2677 ; `nest build`, `tsc -p tsconfig.test.json`, `tsc -p tsconfig.build.json`, frontend `tsc --noEmit` et `pnpm build` : exit 0 ; vitest 30 fichiers, 226/226 ; grep `mock/login|Simuler une session` dans `dist/assets` : vide ; lint 0 erreur (53 avertissements inchangés) ; Prettier conforme (backend, frontend/src). Aucun processus de test en attente.

**Questions pour l'architecte** : aucune.


## Revue architecte (r39) — reprise r38-m1

Mesures relancées : jest backend 92 suites 2677/2677, `nest build`, `tsc` (tests et build), ESLint et Prettier sur les fichiers modifiés : propres. `git diff` de `safe-fetch.ts` et `safe-fetch.spec.ts` relu, aucune mutation résiduelle.

#### Revue architecte
- **r38-m1 : VALIDÉ.** `EADDRNOTAVAIL` corrigé, `RETRYABLE_CODES` exporté, `it.each` sur les 5 codes, jeu exact figé, garde-fou `os.constants.errno`. Contre-mutations rejouées : `EADDRNOTAVAIL` retiré (4 échecs), `ETIMEDOUT` retiré (4), faute réintroduite (5) : toutes détectées ; fichier restauré par `/bin/cp -f`, `cmp` identique, aucun processus en attente.
- **r37-m2 : VALIDÉ** (via r38-m1).
- Observation : avertissement jest « worker failed to exit gracefully » en fin de suite, à traiter plus tard (`--detectOpenHandles`), non bloquant.

**Feu vert de commit unique (lot r37 + reprise r38)**, 9 fichiers : `backend/src/common/safe-fetch.ts`, `backend/src/projects/integration-url.ts`, `backend/tests/unit/common/safe-fetch.spec.ts`, `backend/tests/unit/common/safe-fetch.transport.spec.ts`, `backend/tests/unit/projects/attachment-dto.spec.ts`, `backend/tests/unit/projects/calendar-sync.service.spec.ts`, `frontend/src/safe-href.spec.ts`, `docs/security/journal-corrections.md`, `docs/security/rapport-audit.md`.

**Ouverts** : S21, puis S22 + O16, puis le reste (voir « Revue r39 » du rapport pour les décisions à obtenir de l'utilisateur avant S21 et S22).


## Lot r39 (fixeur) — S21

### État initial et plan (consigné avant tout changement)

**État constaté dans le code (HEAD 0838e4e)** :
- `projects.service.ts` : `verifyGitHubSignature` calcule le HMAC sur `JSON.stringify(payload)` (corps re-sérialisé) avec le secret global `GITHUB_WEBHOOK_SECRET` ; sans secret, `return NODE_ENV === 'test'` (passe-droit).
- `projects.controller.ts` : route publique `POST /projects/webhooks/github` ; `tasks.service.ts` `closeTaskFromWebhook(taskId)` ferme toute tâche de la plateforme par UUID ; aucun contrôle du dépôt ; aucun anti-rejeu.
- `main.ts` : pas de `rawBody` ; `origin-guard.ts` exempte `/webhooks/github` et `/projects/webhooks/github`.
- Les lignes `Project` complètes sont renvoyées par plusieurs lectures et écrites dans le journal d'audit (`before`/`after` de `updateProject`) : une colonne ajoutée simplement serait divulguée.
- Mécanisme de chiffrement existant : `backend/src/auth/encryption.util.ts` (`encrypt`/`decrypt`, AES-256-GCM, `ENCRYPTION_KEY`), déjà utilisé pour `githubAccessToken` et le secret MFA. Il est réutilisé.
- Redis : `RedisService` (ioredis, `maxRetriesPerRequest: null`, donc une commande reste en file indéfiniment si Redis est coupé) : un délai explicite est nécessaire (même approche que `AuthService.withRedisTimeout`, O19).

**Décisions de l'utilisateur (confirmées le 2026-11-10)** : (1) secret affiché une seule fois, chiffré, jamais réaffiché, action « Régénérer » ; (2) régénération par le propriétaire du projet et les OWNER/ADMIN de l'espace de travail, vérifiée côté serveur par `PolicyService` ; (3) ancienne route : 410 Gone ; (4) Redis indisponible : refus (fail-closed).

**Plan (un seul lot, S21 n'est pas découpé)** :
1. Migration additive `20261115000000_s21_project_github_webhook_secret` : `Project.githubWebhookSecret TEXT NULL`. Client Prisma configuré avec `omit` global sur ce champ (jamais lu sauf demande explicite).
2. `rawBody: true` dans `NestFactory.create` (et dans le banc de test HTTP) ; HMAC sur `req.rawBody`, `timingSafeEqual` après contrôle des longueurs.
3. Secret généré (32 octets) à la liaison du dépôt (`syncRepositoryToProject`), renvoyé une seule fois dans la réponse (`webhookSecret`), chiffré par `encrypt()`. Route `POST /projects/:id/webhooks/github/secret` (régénération, action `project.manage`).
4. Nouvelle route publique `POST /projects/:id/webhooks/github` ; ancienne route : 410. Exemption CSRF limitée à la nouvelle route.
5. `closeTaskFromWebhook(projectId, taskId)` limité au projet ; dépôt de la charge utile comparé à `githubRepo` du projet.
6. Anti-rejeu Redis `SET NX EX 86400` sur `X-GitHub-Delivery`, avec délai ; Redis indisponible : refus. 401 uniforme. Passe-droit de test supprimé.
7. Frontend : affichage unique du secret et de l'URL à la liaison, bouton « Régénérer ».
8. Tests, contre-mutations, mesures complètes.

### S21 — Webhook GitHub : secret par projet, signature sur le corps brut, liaison au dépôt, anti-rejeu

**Statut** : CORRIGÉ – À REVOIR

**Cause confirmée** (code relu avant correction) : voir l'état initial ci-dessus. HMAC sur `JSON.stringify(payload)` (`projects.service.ts`, ancien `verifyGitHubSignature`), secret global `GITHUB_WEBHOOK_SECRET`, passe-droit `NODE_ENV === 'test'`, `closeTaskFromWebhook(taskId)` sans portée de projet ni de dépôt, aucun anti-rejeu.

**Changement** :
- `backend/prisma/schema/project.prisma` : `Project.githubWebhookSecret String? @db.Text`. Migration `backend/prisma/migrations/20261115000000_s21_project_github_webhook_secret/migration.sql`.
- `backend/src/prisma/prisma.service.ts` : `PRISMA_OMIT` (`project.githubWebhookSecret`) passé à `new PrismaClient({ omit })` : le champ n'est jamais lu par défaut, donc absent de `GET /projects`, `GET /projects/:id`, du journal d'audit (`before`/`after` de `updateProject`), des synchronisations Firestore et de toutes les relations `include: { project: true }`. Seules deux lectures le demandent (`omit: { githubWebhookSecret: false }`) : le webhook et la liaison du dépôt.
- `backend/src/main.ts` : `NestFactory.create(AppModule, { rawBody: true })` ; `tests/http/http-test-app.ts` reproduit le réglage.
- `backend/src/projects/github-webhook.util.ts` (nouveau, pur) : `generateWebhookSecret()` (32 octets, hex), `verifyGitHubSignature(secret, rawBody, signature)` (format `sha256=<64 hex>` vérifié, longueurs égales, `timingSafeEqual`), `extractTaskIdsFromText`.
- `backend/src/projects/github-webhook.service.ts` (nouveau) : `handle()` dans l'ordre projet non supprimé et secret présent, déchiffrement (`decrypt`), signature sur `req.rawBody`, `repository.full_name` égal (insensible à la casse) à `Project.githubRepo`, identifiant `X-GitHub-Delivery` au format valide, `SET NX EX 86400` Redis (clé `github-webhook:<projet>:<livraison>`), puis fermeture. Tout refus d'authentification, d'autorisation du dépôt ou de format : `401 « Webhook refusé. »` identique. Redis en erreur ou sans réponse sous 2 s : 503, aucun traitement (fail-closed). Traitement en échec : la clé est supprimée pour que la livraison puisse être rejouée. `regenerateSecret()` : `PolicyService.assertProject(projectId, userId, 'project.manage')`, 400 si aucun dépôt lié, nouveau secret chiffré par `encrypt()`, écriture d'audit `PROJECT_WEBHOOK_SECRET_REGENERATE` (dépôt seulement, jamais le secret).
- `backend/src/projects/github-webhook.controller.ts` (nouveau) : `POST /projects/:projectId/webhooks/github` (`@Public`, authentifié par signature), `POST /projects/:projectId/webhooks/github/secret` (session, `@ForbiddenInImpersonation`, droit `project.manage`), `POST /projects/webhooks/github` (`@Public`) : **410 Gone** avec message d'orientation. Diffusion temps réel des tâches fermées conservée.
- `backend/src/projects/tasks.service.ts` : `closeTaskFromWebhook(projectId, taskId)` limité aux tâches du projet. `projects.service.ts` et `projects.controller.ts` : ancien code du webhook supprimé (passe-droit de test compris). `projects.module.ts` : nouveau contrôleur, service, `RedisModule`.
- `backend/src/redis/redis.service.ts` : `setIfAbsent(key, value, ttl)` (`SET ... EX ... NX`). `tests/http/fake-redis.ts` : équivalent.
- `backend/src/auth/auth.service.ts` (`syncRepositoryToProject`) : secret généré à la première liaison et à chaque changement de dépôt, conservé si le même dépôt est relié de nouveau ; renvoyé en clair une seule fois dans la réponse (`webhookSecret`), jamais le secret chiffré (retiré explicitement de la réponse).
- `backend/src/auth/origin-guard.ts` : exemption CSRF limitée à `/projects/:id/webhooks/github` ; ancienne route, régénération et reste non exemptés.
- `docker-compose.yml`, `docker-compose.prod.yml`, `.env.production.example` : variable `GITHUB_WEBHOOK_SECRET` supprimée (plus lue).
- Frontend : `frontend/src/github-repos.ts` (`githubWebhookUrl`, `regenerateWebhookSecret`, `webhookSecret` dans la réponse de liaison), `frontend/src/components/GitHubRepoConnector.tsx` : après liaison ou régénération, URL et secret affichés une fois avec la mention « il ne sera plus jamais affiché » et un bouton « J'ai copié le secret » ; bouton « Régénérer le secret du webhook » avec confirmation, visible seulement avec le droit de gestion et un dépôt lié ; le secret n'est qu'en mémoire du composant (jamais dans `localStorage`/`sessionStorage`), effacé au changement de projet.

**Action et permission (décision 2)** : action `project.manage` de `PolicyService` (matrice `PROJECT_PERMISSIONS`, rôle MANAGER). Elle accorde : OWNER et ADMIN de l'espace de travail (MANAGER implicites), le créateur du projet s'il est au moins MEMBER de l'espace (règle P10), et les MANAGER désignés par `ProjectMembership`. C'est la même action que celle de la liaison du dépôt (`POST /auth/github/sync`). Voir question 1.

**Tests** (résultats réels, exécutés) :
- `tests/unit/projects/github-webhook.util.spec.ts` (nouveau, 17) : signature sur corps brut avec espaces acceptée, sur JSON re-sérialisé refusée, autre secret, corps modifié, 7 formes de signature invalides sans exception, corps/secret absents, majuscules ; secret de 64 hex distinct à chaque appel ; extraction des identifiants.
- `tests/http/github-webhook.spec.ts` (nouveau, 44, application Nest réelle, politique réelle sur la fixture RBAC) : tâche fermée avec signature sur corps brut espacé, PR fusionnée, PR non fusionnée, ping ; **tâche d'un autre projet non fermée** ; dépôt différent / absent / projet sans dépôt : 401 ; 401 uniforme (message identique, rien fermé, rien écrit dans Redis) pour 10 motifs (signature fausse, absente, mal formée, secret d'un autre projet, projet inconnu, supprimé, sans secret, secret illisible, livraison absente ou invalide) ; rejeu ignoré (aucune écriture), autre livraison traitée, TTL 86400 s et clé par projet, livraison refusée ne consomme pas l'identifiant, échec de traitement libère l'identifiant, **Redis en erreur ou muet : 503 sans traitement** ; ancienne route 410 avec et sans signature ; régénération par propriétaire, OWNER, ADMIN et créateur MEMBER (secret stocké chiffré, déchiffre vers la valeur renvoyée), ancien secret invalidé immédiatement et nouveau valide, refus (403/404) pour member, contributor, commenter, viewer, client, outsider, deprovisioned (y compris contributor/commenter/client qui ont un rôle sur le projet), 401 sans session, 400 sans dépôt, audit sans secret.
- `tests/http/github-repos.spec.ts` (+4) : première liaison (secret 64 hex renvoyé, stocké chiffré, secret chiffré absent de la réponse), même dépôt (secret conservé, rien réaffiché), autre dépôt (nouveau secret), échec GitHub (aucun secret écrit).
- `tests/http/csrf-origin.spec.ts` (+1, adapté) : exemption limitée à la réception par projet ; régénération et ancienne route soumises au contrôle d'Origin.
- `tests/http/rbac-matrix.spec.ts` : `GitHubWebhookController` ajouté (réception publique à 401 propre au handler, régénération `project.manage` pour les 9 profils et la variante P1) ; `tests/unit/authz/public-routes.spec.ts` : liste blanche mise à jour.
- `tests/unit/prisma-omit.spec.ts` (nouveau, 2) : `PRISMA_OMIT` et omission globale effectivement posée sur le client Prisma ; `tests/unit/main-raw-body.spec.ts` (nouveau, 2) : `main.ts` conserve `rawBody: true`.
- Frontend `GitHubRepoConnector.spec.tsx` (+6) : affichage unique puis effacement (rien dans les stockages), pas d'affichage sans nouveau secret, régénération avec confirmation et POST sans corps, annulation et erreur, absence du bouton sans droit ou sans dépôt, effacement au changement de projet.

**Contre-mutations** (sauvegarde dans le bac à sable, restauration `/bin/cp -f`, une à la fois, `cmp` identique après chacune ; tests ciblés des 6 fichiers ci-dessus, 113 tests) :
| Mutation | Résultat |
| --- | --- |
| HMAC sur JSON re-sérialisé | détectée (16 échecs) |
| comparaison du dépôt supprimée | détectée (1) |
| `closeTaskFromWebhook` sans `projectId` | détectée (1) |
| anti-rejeu neutralisé | détectée (1) |
| Redis fail-open | détectée (2) |
| ancienne route de nouveau active | détectée (2) |
| exemption CSRF élargie à `/secret` | détectée (1) |
| régénération avec l'action `project.read` | détectée (3) ; **non détectée au premier essai** (110/110 : aucun profil de P2 n'a de rôle de projet), test ajouté sur P1 (contributor, commenter, client) puis mutation rejouée |
| `omit` global retiré | détectée (1) |
| `rawBody` retiré de `main.ts` | détectée (1) |
| clé non libérée après échec de traitement | détectée (1) |
| secret chiffré renvoyé par la liaison | détectée (1) |
| projet inconnu : réponse distincte | détectée (3) |
| identifiant de livraison non contrôlé | détectée (1) |
| pas de nouveau secret au changement de dépôt | détectée (1) |
| secret stocké en clair (liaison, puis régénération) | détectée (3 et 3) |
| signature mal formée acceptée | détectée (7) |
| TTL modifié | détectée (1) |
| clé de livraison sans le projet | détectée (1) |
| secret écrit dans l'audit | détectée (1) |
Frontend (3 mutations, `/bin/cp -f` et `cmp`) : « J'ai copié » sans effet (1 échec), effacement au changement de projet retiré (1), régénération sans confirmation (3) : toutes détectées. Aucun processus jest ou vitest en attente à la fin.

**Mesures** : jest backend (`env -u DATABASE_URL`) 96 suites, 2765/2765 ; `nest build`, `tsc -p tsconfig.test.json`, `tsc -p tsconfig.build.json` : exit 0 ; `prisma validate` : valide ; `prisma generate` exécuté (client régénéré, nécessaire au type `omit`) ; ESLint backend 0 erreur (15 avertissements `any` préexistants) ; Prettier conforme ; frontend `tsc --noEmit` exit 0, vitest 30 fichiers, 232/232, `pnpm build` ok, grep `mock/login|Simuler une session` dans `dist/assets` : vide, ESLint 0 erreur (36 avertissements), Prettier conforme.

**Écart par rapport au rapport** :
1. Le champ est omis **globalement** par le client Prisma (non demandé explicitement, mais nécessaire : plusieurs lectures renvoient la ligne `Project` entière et `updateProject` écrit `before`/`after` dans le journal d'audit). Le test « secret absent de `GET /projects/:id` » est donc couvert par la configuration du client (`prisma-omit.spec.ts`) et non par un faux Prisma, qui ignore `omit`. Non vérifié contre une vraie base MariaDB (voir « Non vérifié »).
2. Régénération autorisée selon `project.manage` (voir ci-dessus) : le rapport disait « propriétaire du projet » ; la décision utilisateur élargit aux OWNER/ADMIN.
3. Les 401 du webhook couvrent aussi dépôt différent et livraison invalide (rapport : « 401 uniforme quel que soit le motif »). Redis indisponible : 503 (après contrôle de signature, donc non exploitable sans le secret).
4. Le secret n'est pas régénéré quand le même dépôt est relié de nouveau ; il l'est à tout changement de dépôt.

**Migrations** : `20261115000000_s21_project_github_webhook_secret` : `ALTER TABLE Project ADD COLUMN githubWebhookSecret TEXT NULL`. Additive, nullable, sans reprise de données, réversible par `DROP COLUMN` (perte des secrets). Les projets existants restent à NULL. Appliquer avec `prisma migrate deploy` ; non appliquée sur la base de développement (serveurs en cours non touchés).

**Changements cassants** :
- `POST /projects/webhooks/github` répond désormais 410 : tout webhook existant cesse de fonctionner jusqu'à reconfiguration.
- Tout projet existant n'a **aucun** secret : le webhook de ce projet est refusé (401) tant que le secret n'a pas été généré par « Régénérer le secret du webhook » (ou par une nouvelle liaison de dépôt).
- Le webhook GitHub doit être en `Content-Type: application/json` (le format `x-www-form-urlencoded` n'a pas de corps brut JSON exploitable et sera refusé).
- Variable `GITHUB_WEBHOOK_SECRET` obsolète (retirée des fichiers compose et de `.env.production.example` ; à retirer des environnements déployés).
- Réponse de `POST /auth/github/sync` : champ supplémentaire optionnel `webhookSecret` (présent uniquement à la génération).

**Actions d'exploitation** :
1. Avant la mise en production, recenser les webhooks GitHub configurés avec l'ancien secret global : côté plateforme, savoir quels clients ont un dépôt lié (`SELECT id, name, workspaceId, githubRepo FROM Project WHERE githubRepo IS NOT NULL AND deletedAt IS NULL`, lecture seule) ; côté GitHub, chaque client doit avoir un webhook vers `/projects/webhooks/github` (ou une livraison en échec 410 dans « Recent Deliveries »). Ce recensement n'est pas automatisable depuis la base : à croiser avec les clients.
2. Pour chaque projet concerné : un OWNER/ADMIN (ou le propriétaire du projet) ouvre le projet, clique « Régénérer le secret du webhook », recopie l'URL `https://<API>/projects/<id>/webhooks/github` et le secret dans les paramètres du webhook GitHub (type `application/json`, événements Pushes et Pull requests), puis vérifie une livraison « ping » (réponse 201).
3. Communiquer l'échéance aux clients avant le déploiement (le 410 coupe l'ancien flux immédiatement). Aucun nettoyage automatique.
4. Retirer `GITHUB_WEBHOOK_SECRET` des environnements de production et de préproduction ; appliquer la migration (`prisma migrate deploy`) avant de déployer le code.
5. Vérifier en préproduction, contre MariaDB réelle, que `GET /projects` ne contient pas `githubWebhookSecret` (voir « Non vérifié »).
6. Redis doit être disponible : sans lui, les webhooks sont refusés (503). GitHub ne rejoue pas automatiquement : les livraisons en échec se rejouent à la main (« Redeliver ») dans l'interface GitHub.

**Non vérifié** : le comportement réel de l'omission globale de Prisma (`omit`) sur MariaDB, y compris sur `include`, `update` et les transactions, n'a pas été exercé contre une base (aucune base de test, la base de développement n'a pas été touchée). Les tests établissent que le client est configuré avec `omit` ; la liaison supprime en plus le champ de sa propre réponse. À confirmer en préproduction avant la mise en production (action 5).

**Risques résiduels** : (a) le limiteur de débit global (60/min par IP) s'applique à la route publique ; derrière un proxy sans `trust proxy` (S24), les livraisons de plusieurs clients partagent le compteur, d'où des 429 possibles en pic : à traiter avec S24 (ou `@SkipThrottle` dédié avec limite par projet) ; (b) GitHub ne rejoue pas automatiquement les livraisons en 5xx.

**Questions pour l'architecte** :
1. `project.manage` inclut aussi les MANAGER désignés par `ProjectMembership` (au-delà de « propriétaire + OWNER/ADMIN » de la décision 2). Cohérent avec la liaison du dépôt, qui exige déjà ce droit : acceptable, ou faut-il une action dédiée limitée au créateur et aux OWNER/ADMIN ? Je recommande de garder `project.manage`.
2. Un secret n'est plus relu : un projet lié avant la migration doit utiliser « Régénérer ». Acceptable sans rétro-génération en masse (une rétro-génération ne servirait à rien puisque le secret ne peut plus être affiché) ?
3. Refus de dépôt différent ou de livraison invalide : 401 (uniforme, choisi) plutôt que 403 ou 422 ; confirmer.
4. Rattacher le point (a) des risques résiduels à S24 ?

**Fichiers modifiés ou créés** (aucun commit) : `.env.production.example`, `docker-compose.yml`, `docker-compose.prod.yml`, `backend/prisma/schema/project.prisma`, `backend/prisma/migrations/20261115000000_s21_project_github_webhook_secret/migration.sql`, `backend/src/auth/auth.service.ts`, `backend/src/auth/origin-guard.ts`, `backend/src/main.ts`, `backend/src/prisma/prisma.service.ts`, `backend/src/projects/github-webhook.controller.ts`, `backend/src/projects/github-webhook.service.ts`, `backend/src/projects/github-webhook.util.ts`, `backend/src/projects/projects.controller.ts`, `backend/src/projects/projects.module.ts`, `backend/src/projects/projects.service.ts`, `backend/src/projects/tasks.service.ts`, `backend/src/redis/redis.service.ts`, `backend/tests/http/csrf-origin.spec.ts`, `backend/tests/http/fake-redis.ts`, `backend/tests/http/github-repos.spec.ts`, `backend/tests/http/github-webhook.spec.ts`, `backend/tests/http/http-test-app.ts`, `backend/tests/http/rbac-matrix.spec.ts`, `backend/tests/unit/authz/public-routes.spec.ts`, `backend/tests/unit/main-raw-body.spec.ts`, `backend/tests/unit/prisma-omit.spec.ts`, `backend/tests/unit/projects/github-webhook.util.spec.ts`, `backend/tests/unit/projects/projects.service.spec.ts`, `frontend/src/github-repos.ts`, `frontend/src/components/GitHubRepoConnector.tsx`, `frontend/src/components/GitHubRepoConnector.spec.tsx`, `docs/security/journal-corrections.md`.


## Revue architecte (r40) — S21

**Verdict : VALIDÉ** (non bloquant : r40-m1, r40-m2, r40-a1 dans `rapport-audit.md`, « Revue r40 »).

Vérifié dans le code, pas dans la description : HMAC sur `req.rawBody` (format `sha256=<64 hex>`, longueurs égales puis `timingSafeEqual`), `rawBody: true` effectif avec `useBodyParser` (Nest relaie l'option), liaison au dépôt insensible à la casse, 401 uniforme, `SET NX EX 86400` par projet après signature et dépôt (l'identifiant n'est écrit qu'après authentification), fail-closed 503, clé libérée si le traitement échoue, `closeTaskFromWebhook` borné par `projectId`, passe-droit de test supprimé, exemption CSRF limitée à `/projects/:id/webhooks/github`, ancienne route 410, secret absent des logs, de l'audit et des stockages navigateur, compose et `.env.production.example` sans valeur réelle. Omission globale vérifiée sur MySQL 8 réel (conteneur jetable supprimé, base de développement non touchée). Mesures relancées toutes vertes. Contre-mutations propres (sauvegarde bac à sable, `/bin/cp -f`, `cmp`) : `deletedAt` retiré, détectée ; PR non fusionnée acceptée, détectée ; Redis fail-open, détectée ; décorateur d'impersonation retiré, **non détectée** (r40-m1).

**Réponses aux questions** :
1. `project.manage` : écart à la décision (2) car il ajoute les MANAGER de `ProjectMembership`. Recommandation : le garder (ils peuvent déjà relier un autre dépôt et obtenir un nouveau secret) ; action dédiée possible si l'utilisateur veut la lettre de la décision. **À confirmer par l'utilisateur.**
2. Pas de rétro-génération : accepté (le secret ne pourrait pas être montré). Amélioration facultative : indiquer dans l'interface si un secret existe (booléen calculé, sans le renvoyer).
3. 401 uniforme pour dépôt différent et livraison invalide : confirmé.
4. 429 : rattaché à S24 (avec `@SkipThrottle` dédié ou limite par projet), ainsi que la limite de corps (S23).

**Écarts jugés** : (1) omission globale : acceptée, vérifiée sur base réelle ; (2) `project.manage` : voir ci-dessus ; (3) 401 étendu et 503 Redis : acceptés ; (4) pas de nouveau secret pour le même dépôt : accepté.

**Feu vert de commit** (32 entrées de `git status`, chemins explicites, sans `.claude/` ni `.env` réel) : les 31 fichiers de la liste du fixeur (dont le dossier `backend/prisma/migrations/20261115000000_s21_project_github_webhook_secret/migration.sql`) et `docs/security/rapport-audit.md`.
**Changements cassants** : ancienne route 410 ; projets existants sans secret (401 tant que non régénéré) ; webhook en `application/json` obligatoire ; `GITHUB_WEBHOOK_SECRET` obsolète ; champ `webhookSecret` ajouté à la réponse de `/auth/github/sync`.
**Ordre de déploiement** : migration (`prisma migrate deploy`) avant le code (le client sélectionne la colonne) ; ensuite code ; retirer `GITHUB_WEBHOOK_SECRET` des environnements.
**Actions d'exploitation** : recenser les webhooks clients, prévenir avant le 410, régénérer et saisir secret et URL par projet, Redis disponible, vérifier en préproduction `GET /projects` (déjà confirmé sur MySQL 8 local, à refaire sur MariaDB de production).

**Constats encore ouverts** : r40-m1, r40-m2, r40-a1, puis S22 + O16, S30, S23 à S25, S26, A5 à A7, P5, P8, O10 à O17, O21, Phase 6.


## Lot r40 (fixeur) — r40-m1, r40-m2, r40-a1 (partie i)

### r40-m1 — `@ForbiddenInImpersonation` de la régénération du secret non couvert

**Statut** : CORRIGÉ – À REVOIR

**Changement** : aucun changement de code (le décorateur était en place, `github-webhook.controller.ts`, route `POST :projectId/webhooks/github/secret`). Tests seuls.

**Tests** :
- `tests/http/github-webhook.spec.ts`, « refuse (403) en session d'impersonation, secret inchangé » : jeton avec `impersonatedBy`, 403, secret en base inchangé, `project.update` non appelé ; le même propriétaire hors impersonation obtient 201 (le refus vient bien du décorateur).
- `tests/unit/auth/impersonation-routes.spec.ts` : `GitHubWebhookController.regenerateSecret` ajouté à la liste `forbidden` (403 avec impersonation, autorisé sans), contrôleur ajouté au balayage méta, motif `POST /projects/:projectId/webhooks/github/secret` ajouté à `PERSISTENT_ACCESS`, route ajoutée à la liste attendue du balayage.
- Contre-mutation (décorateur retiré) : 3 tests échouent (HTTP, garde unitaire, balayage méta). Fichier restauré, `cmp` identique.

**Écart par rapport au rapport** : aucun.

### r40-m2 — clé anti-rejeu laissée après un SET dont la réponse s'est perdue

**Statut** : CORRIGÉ – À REVOIR

**Changement** : `backend/src/projects/github-webhook.service.ts` (`handle`) : si l'appel `setIfAbsent` échoue ou dépasse le délai, un `del` best-effort de la clé est tenté, borné par le même `withRedisTimeout` et ses erreurs avalées, puis le 503 est renvoyé. La latence maximale du 503 passe donc à 2 délais (4 s en production). Un rejeu normal (clé déjà posée, `setIfAbsent` renvoie `false`) ne supprime rien.
`backend/tests/http/fake-redis.ts` : mode `write-then-mute` (écrit puis ne répond jamais) et trace `delRequests`.

**Tests** (`github-webhook.spec.ts`, bloc anti-rejeu) : (1) SET abouti mais muet : 503, clé supprimée, un « Redeliver » du même identifiant est ensuite traité ; (2) Redis muet pour tout (`hang`) : 503 en moins de 1,5 s (délai de test 200 ms), nettoyage tenté ; (3) Redis en erreur (`reject`) : 503 inchangé, nettoyage tenté ; (4) un rejeu normal ne déclenche aucun `del`.
Contre-mutations : sans le `del` : 3 échecs (1, 2, 3) ; `del` non borné : le test de temps borné échoue. Fichiers restaurés, `cmp` identique.

**Écart par rapport au rapport** : aucun. Limite connue : si Redis reste muet pendant le `del`, la clé peut subsister jusqu'à 24 h (un « Redeliver » est alors ignoré) ; best-effort demandé, non fermable sans transaction avec le client Redis.

### r40-a1 (i) — confinement de `githubWebhookSecret`

**Statut** : CORRIGÉ – À REVOIR (volets ii à iv non traités ici, voir ci-dessous)

**Changement** : nouveau test `backend/tests/unit/webhook-secret-confinement.spec.ts` : parcourt `backend/src` et exige que seuls ces fichiers contiennent `githubWebhookSecret` (la liste ne doit ni dépasser ni périmer) :
- `projects/github-webhook.service.ts` : vérification de signature et régénération (seul lecteur, `omit: { githubWebhookSecret: false }`) ;
- `auth/auth.service.ts` : liaison du dépôt, création du secret et suppression de la propriété de la réponse ;
- `prisma/prisma.service.ts` : définition de l'omission globale `PRISMA_OMIT` (ajout par rapport à la liste du rapport, justifié : le nom y est nécessairement). Le schéma Prisma est hors de `src`.
Test texte (et non règle ESLint) : il couvre aussi `select` et `omit: false` qui contournent l'omission, sans plugin.
Contre-mutations : une occurrence ajoutée dans `projects.service.ts` : 2 échecs ; une entrée inexistante dans la liste : 1 échec. Restaurés (`cmp` identique) ; entrée fictive retirée.

**Volets ii à iv** : ils sont consignés dans « Revue r40 » (r40-a1), mais les sections S23 (l.478) et S24 (l.486) du rapport ne les mentionnent pas, ni la section O16/S22 (`no-store` sur `/auth/github/sync` et la route du secret ; O16 couvre déjà `/auth/*` donc la première, pas `/projects/:id/webhooks/github/secret`). Rien n'a été modifié dans le rapport (écrit par l'architecte).

**Écart par rapport au rapport** : ajout de `prisma.service.ts` à la liste autorisée.

### Mesures (état final)
- Jest backend (`env -u DATABASE_URL`) : 97 suites, 2776/2776 (avant : 96 suites, 2765). `nest build` OK. `tsc --noEmit -p tsconfig.test.json` OK, `tsconfig.build.json` OK. ESLint et Prettier sur les 5 fichiers touchés : propres.
- `tsc --noEmit -p tsconfig.json` signale TS6059 (`tracking.gateway.spec.ts` importe `tests/support`, hors `rootDir`) : préexistant, identique sur l'arbre sans mes changements (vérifié par `git stash`).
- Vitest frontend 232/232 ; `pnpm build` OK ; aucune occurrence de `mock/login` ni `Simuler une session` dans `dist`.

**Questions pour l'architecte** :
1. Rattacher explicitement les volets ii à iv de r40-a1 dans les sections S22/O16 (route du secret hors `/auth/*`), S23 (limite de corps dédiée) et S24 (429) du rapport : à toi de les y reporter si tu veux qu'ils soient suivis à cet endroit.
2. `prisma.service.ts` dans la liste autorisée : accepté ?
3. Le test de confinement est textuel : un commentaire mentionnant le nom dans un autre fichier échoue aussi (voulu).

**Fichiers modifiés ou créés** (aucun commit) : `backend/src/projects/github-webhook.service.ts`, `backend/tests/http/fake-redis.ts`, `backend/tests/http/github-webhook.spec.ts`, `backend/tests/unit/auth/impersonation-routes.spec.ts`, `backend/tests/unit/webhook-secret-confinement.spec.ts` (nouveau), `docs/security/journal-corrections.md`.


## Revue architecte (r41) — lot r40

- **r40-m1 : VALIDÉ. r40-m2 : VALIDÉ. r40-a1 (i) : VALIDÉ.** Jest 97 suites 2776/2776, nest build, tsc (build et test), ESLint, Prettier propres. Contre-mutations : `del` non borné (2 échecs), `del` sur rejeu normal (1 échec), commentaire dans un autre fichier (2 échecs) ; restaurations vérifiées.
- Réponses : (1) volets ii à iv reportés par l'architecte dans S22, O16, S23, S24 du rapport ; (2) `prisma.service.ts` accepté ; (3) test textuel strict accepté. Risques déclarés (503 jusqu'à 2 délais, clé jusqu'à 24 h si Redis muet pendant le `del`) acceptés.
- Ouverts : S22 + O16, S30, exploitation, S23 à S25, S26, A5 à A7, P5, P8, O10 à O17, O21, Phase 6. Commit autorisé (liste dans « Revue r41 » du rapport).
