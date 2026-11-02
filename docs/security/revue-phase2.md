# Revue architecte : Phase 2 (SSO OIDC et SCIM), travail non commité

> Document historique (revue r9, verdict NON VALIDÉ). Verdict final : **VALIDÉ** en revue r10, voir docs/security/rapport-audit.md, section « Revue r10 ».

| Champ | Valeur |
| --- | --- |
| Date | 2026-11-02 |
| Branche | `security/phase-0` (HEAD `c5f1391`), arbre de travail non commité |
| Périmètre | S10 (et reprises r8 S10-a, S10-b, S10-c), S11 (et reprise r8 S11-a), plus les non-bloquants r8 |
| Référence | `docs/security/rapport-audit.md` (S10, S11, revue r8), `docs/security/journal-corrections.md` (r7, r8) |
| Méthode | Lecture du code réel (et non des descriptions du journal), exécution des suites, des builds, de `tsc` et d'ESLint, preuve par script du contournement S11-b |

## 1. Résumé exécutif

Le cœur de S10 est solide : `id_token` vérifié par `jose` (RS256 seul, `iss`, `aud`, `exp`/`iat`, nonce), tenant Azure GUID, `tid` lié, Google `email_verified` + `hd`, `state`/nonce/PKCE en Redis consommés par `GETDEL` et liés au navigateur par cookie, preuve DNS, rôle borné, secret chiffré. Le durcissement de S11 (DTO, filtre, format d'erreur, expiration, domaine vérifié) est conforme.

En revanche, **la reprise r8 n'est pas terminée et l'une de ses corrections introduit une faille** :
- **S11-a introduit une régression de sécurité (Haute)** : le limiteur de débit global devient contournable sur **toutes** les routes (connexion, inscription, réinitialisation du mot de passe…) en ajoutant `/scim/v2` dans la query string et un en-tête `Authorization` aléatoire.
- **S10-a n'est pas corrigé**, contrairement à ce qu'affirment le journal, `GEMINI.md` et l'en-tête du rapport : `configureWorkspaceSSO` supprime toujours la configuration d'une autre organisation, et un test l'exige.
- Les liaisons `ssoUid` héritées de l'ancien code (non vérifié) ne sont pas purgées : tous les comptes Azure déjà liés seront bloqués (409) à la réactivation, et les liaisons établies sans vérification restent réutilisables.
- Le journal contient deux sections « Revue architecte (2026-10-31) : VALIDÉ » (S10, S11) qui contredisent la revue r8 (À REPRENDRE) et citent un fichier qui n'existe pas (`oidc-key-source.ts`).

**Verdict : NON VALIDÉ** (détail en section 6). `FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED` doivent rester à `false`.

## 2. Ce que le travail prétend corriger

| ID | Source | Statut annoncé | Constat de la revue |
| --- | --- | --- | --- |
| S10 | Rapport § Phase 2, journal r7 | `CORRIGÉ – À REVOIR`, puis « VALIDÉ » (section suspecte, voir 5.1) | Cœur conforme ; reprises r8 incomplètes |
| S11 | Rapport § Phase 2, journal r7 | `CORRIGÉ – À REVOIR`, puis « VALIDÉ » (section suspecte) | Conforme hors S11-a |
| S10-a | Revue r8 | `CORRIGÉ – À REVOIR` | **Non corrigé** (suppression toujours présente) |
| S10-b | Revue r8 | `CORRIGÉ – À REVOIR` | Code conforme ; **test attendu absent** |
| S10-c | Revue r8 | `CORRIGÉ – À REVOIR` | Code conforme ; **documentation et test non mis à jour** |
| S11-a | Revue r8 | `CORRIGÉ – À REVOIR` | Implémenté, mais **introduit S11-b (Haute)** |
| Non-bloquants r8 | Revue r8 | non mentionnés | `getOwnMetadata` : fait. Audit des 401 SCIM : fait. Contrôles Azure `acct`/`xms_edov` : non faits. Procédure « perte du domaine » : non faite |

## 3. Résultats des tests et outils (exécutés le 2026-11-02)

| Commande | Résultat |
| --- | --- |
| `cd backend && env -u DATABASE_URL npx jest` | **59/59 suites, 616/616 tests passés** (80 s). Avertissement Jest : « A worker process has failed to exit gracefully » (fuite de handle, préexistante) |
| `cd backend && env -u DATABASE_URL npx nest build` | OK (exit 0) |
| `cd backend && npx tsc --noEmit -p tsconfig.build.json` | OK, 0 erreur |
| `cd backend && npx tsc --noEmit -p tsconfig.json` | 1 erreur TS6059 (`tests/support/session.test-support.ts` hors `rootDir`, importé par `notifications.gateway.spec.ts` et `tracking.gateway.spec.ts`) : **préexistante**, fichiers non modifiés par cette phase |
| `cd backend && npx eslint src tests scripts` | 0 erreur, 17 avertissements (préexistants) |
| `cd frontend && npx vitest run` | **15/15 fichiers, 59/59 tests passés** |
| `cd frontend && npx tsc --noEmit -p .` | OK |
| `cd frontend && npx eslint src` | 0 erreur, 36 avertissements |
| `cd frontend && npx vite build` | OK (avertissement de taille de chunk) |
| Preuve S11-b (script `tsx` sur `resolveThrottlerTracker`) | `/auth/login` → `1.2.3.4` ; `/auth/login?x=/scim/v2` + `Authorization: Bearer a` → `scim:122c…` ; idem avec `Bearer b` → `scim:929c…` : un compteur neuf par requête |

Les suites sont vertes, mais **elles ne couvrent pas les critères d'acceptation r8** de S10-a (le test vérifie même le comportement refusé), S10-b et S10-c, ni l'abus S11-b.

## 4. Vérification point par point

### 4.1 Conforme (constaté dans le code)

| Point | Où | Constat |
| --- | --- | --- |
| Signature et claims de l'`id_token` | `sso.service.ts:312-338` | `jwtVerify`, `algorithms: ['RS256']`, `issuer` du tenant configuré, `audience: config.clientId` sans repli (S10-b), `clockTolerance: 60`, `exp`/`iat` exigés, nonce comparé en temps constant ; toute erreur donne 401 générique |
| Points d'accès IdP | `oidc.ts:22-44` | Fixés dans le code, GUID Azure exigé, `discoveryUrl`/`entryPoint`/`cert` effacés à l'écriture : pas de SSRF |
| Azure | `sso.service.ts:349-357` | `tid` égal au tenant configuré, identité `azure-ad:<tid>:<oid>` |
| Google | `sso.service.ts:358-366` | `email_verified === true` et `hd === domaine` |
| `state` / nonce / PKCE | `oidc.ts:47-53`, `sso.service.ts:146-176,192-206` | 32 octets chacun, PKCE S256, Redis 10 min sous clé hachée, `GETDEL` (usage unique), cookie `sso_flow` comparé en temps constant **avant** Redis, puis effacé ; `redirect_uri` côté serveur |
| Login CSRF | `sso.controller.ts:52-90` | Un `state` d'attaquant ne correspond jamais au cookie de la victime ; le `GET /auth/sso/authorize` renvoie du JSON (le `state` n'est pas divulgué à un tiers) ; frontend et API sont same-site en production (`.env.production.example`), cookie `SameSite=Lax` transmis par le `fetch` global (`api-session.ts:90`) |
| Liaison et domaine | `sso.service.ts:240-302` | Adresse hors domaine : 409 ; compte lié ailleurs : 409 ; suspendu : 403 avant adhésion ; rôle borné `MEMBER`/`VIEWER` ; session via `completeLogin` (MFA conservé) |
| Preuve DNS | `oidc.ts:72-91`, `sso.service.ts:496-546` | TXT sur `_planner-pro.<domaine>`, jeton 128 bits, `enabled`/`enforceSSO` refusés sans preuve, écriture conditionnelle (`updateMany`) |
| `enforceSSO` | `auth.service.ts:190-200,240,391` | Ignoré sur domaine non prouvé ; création GitHub/Firebase refusée **avant** écriture |
| Secret client | `sso.service.ts:89-93,465-485`, `scripts/encrypt-sso-secrets.ts` | Chiffré à l'écriture, masqué en lecture, script idempotent conditionnel, CSV sans secret |
| SCIM : DTO, filtre, erreurs, mutabilité, domaine | `scim.dto.ts`, `scim.service.ts:136-224,279-317`, `scim-http.ts:26-58` | Conforme au rapport ; pas de fuite d'information hors workspace par le filtre (`userId` restreint au workspace) |
| SCIM : clés | `scim.guard.ts`, `scim.service.ts:338-368` | Jeton 192 bits, stocké en SHA-256, recherche par empreinte (pas de comparaison de chaîne côté application), `revokedAt`/`expiresAt` contrôlés, expiration 365 j par défaut (≤ 730), audit création/révocation, 401 audités sans secret |
| Pipe de validation | `common/app-validation.pipe.ts` | Strict par défaut, tolérance par `Reflect.getOwnMetadata` (non-bloquant r8 traité) |
| Isolation multi-tenant SCIM | `scim.service.ts:78-93` | Inchangée depuis S1 : toute ressource hors workspace de la clé donne 404 |
| Journaux | `scim-http.ts:64-95`, `scim.guard.ts:20-35` | Aucune adresse, aucun jeton, aucun secret journalisé |
| Migration | `20261110000000_.../migration.sql` | Colonnes nullables, aucune suppression de ligne, configurations désactivées, clés SCIM bornées à 365 j |

### 4.2 Problèmes restants

#### S11-b (NOUVEAU, régression introduite par S11-a) : contournement global du limiteur de débit

- **Sévérité : Haute.** CVSS 3.1 **7.3** `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:L`. **Bloquant.**
- **Localisation** : `backend/src/common/app-throttler.guard.ts:22-28` (`AppThrottlerGuard` est le garde global, `app.module.ts:44`).
- **Cause** : le choix du compteur repose sur `req.originalUrl.includes('/scim/v2')`. `originalUrl` contient la **query string** et le test porte sur une sous-chaîne quelconque. L'empreinte de l'en-tête `Authorization` (choisi par le client) remplace alors l'IP. Comme le garde global passe **avant** `ScimAuthGuard`, la valeur n'est jamais authentifiée.
- **Scénario** : `POST /auth/login?x=/scim/v2` avec `Authorization: Bearer <aléa>` différent à chaque requête. Chaque requête a un compteur neuf, donc la limite de 5/min tombe. Démontré par script (section 3). Aucun verrou par compte n'existe (`auth.service.ts` : seul le ticket MFA a un compteur d'essais). La même chose vaut pour `/auth/register` (création de comptes en masse), `/auth/password/*` et `/auth/email/*` (bombardement d'e-mails), `/auth/sso/*` et le reste de l'API (60/min par défaut). Sur les vraies routes `/scim/v2/*`, des clés aléatoires suppriment toute limite et chaque requête coûte une lecture en base dans `ScimAuthGuard`.
- **Correction attendue** :
  1. Décider sur le **chemin** seul, ancré : `const path = (req.path ?? new URL(req.originalUrl, 'http://x').pathname)` puis `path.startsWith('/scim/v2/')`.
  2. Ne jamais donner à un en-tête non authentifié le pouvoir de **retirer** la limite par IP. Option recommandée : garder l'IP comme compteur du garde global (avec une limite IP large sur `/scim/v2/*`, par exemple 3 000/min) **et** appliquer la limite 300/min par clé **après** authentification, sur `scimApiKeyId` (garde dédié ou second throttler nommé `scim` appelé dans `ScimAuthGuard` / un garde placé après lui). À défaut, combiner les deux compteurs (`ip` et `scim:<hash>`) et exiger le respect des deux.
- **Tests attendus** : (a) `POST /auth/login?x=/scim/v2` avec 10 `Authorization` différents depuis la même IP donne 429 à partir de la 6e requête ; (b) `GET /scim/v2/Users` avec N clés **invalides** aléatoires depuis une même IP finit en 429 ; (c) le test d'isolation existant (deux clés valides, même IP, compteurs indépendants) reste vert.

#### S10-a (reprise r8) : NON CORRIGÉ, la configuration d'une autre organisation est toujours supprimée

- **Sévérité : Moyenne** (déni de service gratuit, condition de réactivation du drapeau SSO fixée en r8). **Bloquant.**
- **Localisation** : `backend/src/auth/sso/sso.service.ts:431-447` (`deleteMany({ where: { domain, verifiedDomain: null, workspaceId: { not: workspaceId } } })`, commentaire « Une revendication non prouvée d'un autre workspace est remplacée ») ; `backend/tests/unit/auth/sso-oidc.spec.ts:486-499` affirme cette suppression (`toBeUndefined()`).
- **Écart avec le journal** : l'entrée r8 affirme « `configureWorkspaceSSO` ne supprime plus les revendications d'autres workspaces ». C'est faux. Le schéma (`verifiedDomain @unique`, `domain` non unique) et `verifyDomain` sont bien en place, seule la suppression est restée, ce qui annule l'intérêt du modèle à revendications concurrentes.
- **Scénario** : inchangé par rapport à r8. Un attaquant crée un workspace, revendique `acme.com` en boucle et efface à chaque fois la configuration en cours d'Acme (client, secret, jeton TXT), ce qui empêche indéfiniment la preuve.
- **Correction attendue** : supprimer le `deleteMany` (et son commentaire). Remplacer le test l.486-499 par ceux de r8 : deux workspaces revendiquent `acme.com`, aucune ligne supprimée et deux jetons distincts ; le premier `verifyDomain` gagne ; le second reçoit 409 ; une reconfiguration par un tiers ne modifie pas la ligne de l'autre workspace.
- **À compléter dans la foulée** (Basse) : `verifyDomain` (l.535-545) peut perdre une course à la preuve contre la contrainte unique et lever une erreur Prisma `P2002`, donc un 500. Intercepter `P2002` et renvoyer 409, avec un test.

#### S10-d (NOUVEAU) : liaisons `ssoUid` héritées de l'ancien code non purgées

- **Sévérité : Moyenne** (sécurité, défense en profondeur), **Majeure** sur le plan fonctionnel. **Bloquant** pour la réactivation et la validation de S10.
- **Localisation** : `backend/src/auth/sso/sso.service.ts:248-258` ; migration `20261110000000_s10_s11_sso_domain_and_scim_keys/migration.sql` (aucun traitement de `User.ssoUid`).
- **Cause** : l'ancien code posait `ssoUid = azure-ad:<oid|sub>` ou `google:<sub>` à partir d'un `id_token` **non vérifié** (tenant `common`, e-mail non contrôlé). Le nouveau code (1) ne reconnaît plus le format Azure hérité et (2) fait confiance à toute liaison existante, sans revérifier le domaine du compte trouvé par `ssoUid`.
- **Scénarios** :
  - Panne : chaque utilisateur Azure déjà lié a `ssoUid = azure-ad:<oid>`. À sa première connexion, `findFirst` par le nouveau format échoue, `byEmail.ssoUid` diffère, donc **409 « déjà lié à une autre identité »**. Tous les comptes Azure existants sont bloqués, et les comptes sans mot de passe n'ont plus aucun accès.
  - Sécurité : un compte dont le `ssoUid` a été posé par l'ancienne faille (nOAuth) reste lié à l'identité de l'attaquant au format `google:<sub>`, inchangé. Le chemin « trouvé par `ssoUid` » ne contrôle pas que `user.email` appartient au domaine prouvé de la configuration qui authentifie. L'exploitation suppose que le même `sub` Google soit aujourd'hui rattaché à un domaine prouvé par l'attaquant (peu probable avec Google), mais rien dans le code ne l'interdit.
- **Correction attendue** :
  1. Migration de données (documentée au runbook, avec un rapport préalable) : `UPDATE User SET ssoUid = NULL WHERE ssoUid IS NOT NULL` pour tous les identifiants établis avant la Phase 2. Ils ont été obtenus sans vérification : on les rétablit par la liaison par e-mail dans le domaine prouvé, qui est désormais sûre.
  2. Dans `handleCallback`, si le compte est trouvé par `ssoUid`, exiger `extractDomain(user.email) === ssoConfig.verifiedDomain`, sinon 409.
- **Tests attendus** : un compte `ssoUid = 'azure-ad:<oid>'` (format hérité) se reconnecte après la migration et reçoit le nouveau `ssoUid` ; un compte `x@autre.com` portant le `ssoUid` présenté pour une configuration `acme.com` donne 409 sans session.

#### S10-b (reprise r8) : code conforme, test manquant

- **Sévérité : Basse.** **Bloquant**, car le test fait partie du critère d'acceptation r8.
- **Constat** : `sso.service.ts:150-154,209-214,318-323,326` refusent un `clientId` vide et passent `audience: config.clientId` sans repli. Aucun test ne couvre « configuration active sans `clientId` → callback 401, `jwtVerify` non appelé ».
- **Correction attendue** : ajouter ce test dans `tests/unit/auth/sso-oidc.spec.ts`, avec un espion sur la source de clés pour prouver l'absence d'appel.

#### S10-c (reprise r8) : code conforme, documentation et test non mis à jour

- **Sévérité : Basse.** **Bloquant** pour le runbook, qui sert à la réactivation.
- **Constat** : `sso.service.ts:83-87` dérive bien l'URL de l'origine de `FRONTEND_URL`, mais garde `APP_URL` en repli puis `http://localhost:3000` **en silence**. `docs/security/runbook-phase2.md:52` dit encore « `APP_URL` + `/auth/sso/callback` ». Le test (`sso-oidc.spec.ts:62`) ne règle que `APP_URL`, donc le cas `FRONTEND_URL` n'est pas testé.
- **Correction attendue** : runbook § 4 corrigé (origine de `FRONTEND_URL`) ; retrait du repli `APP_URL` ; en production, `FRONTEND_URL` absente doit provoquer une erreur explicite au démarrage du flux plutôt qu'un `redirect_uri` en localhost ; test `FRONTEND_URL=http://localhost:3000` → `redirect_uri=http://localhost:3000/auth/sso/callback`.

#### D1 : documents de suivi incohérents et revue « VALIDÉ » non attribuable

- **Sévérité : Moyenne** (gouvernance du programme). **Bloquant.**
- **Constat** :
  - `journal-corrections.md:1064-1080` et `:1095-1108` contiennent deux sections « Revue architecte (2026-10-31) : **VALIDÉ** » pour S10 et S11, alors que la revue r8 du rapport (source de vérité) conclut **À REPRENDRE**. La section S10 cite un fichier `oidc-key-source.ts` qui n'existe pas (la classe est dans `oidc.ts`) et ne relève pas la suppression S10-a. Ces sections ne sont pas de l'architecte et ne doivent pas être prises en compte.
  - L'en-tête du rapport (`rapport-audit.md:11`), `GEMINI.md` et `DOSSIER_ARCHITECTURE_TECHNIQUE.md` § 15 annoncent « S10-a, S10-b, S10-c traités ». C'est faux pour S10-a.
  - `runbook-phase2.md` : § 2 ne mentionne ni `verifiedDomain` ni la suppression de l'index unique sur `domain` ; § 4 parle encore d'`APP_URL` ; § 7 dit encore « 300/min par IP » ; la procédure « perte du domaine » demandée en r8 manque ; rien sur les `ssoUid` hérités (S10-d).
- **Correction attendue** : retirer (ou barrer avec mention « non valide, remplacée par r8/revue-phase2 ») les deux sections « VALIDÉ » ; remettre les statuts réels (S10-a `À REPRENDRE`) ; mettre à jour le runbook (points ci-dessus) ; ne modifier l'en-tête du rapport et `GEMINI.md` qu'après une revue favorable.

#### L1 : `pnpm-lock.yaml` réécrit (environ 9 000 lignes)

- **Sévérité : Basse** (hygiène de livraison). **Préalable au commit.**
- **Constat** : l'incident signalé en r8 n'est pas résorbé (`git diff --stat` : 2 348 insertions, 6 728 suppressions). Le contenu est sémantiquement équivalent (vérifié en r8), mais le diff masque toute revue de la chaîne d'approvisionnement.
- **Correction attendue** : `git show HEAD:pnpm-lock.yaml > pnpm-lock.yaml`, puis réinsérer les 3 lignes `jose` sous `importers.backend.dependencies` (procédure r8). Ne pas committer `backend/tsconfig.tsbuildinfo` (modifié) ni `backend/tsconfig.build.tsbuildinfo` (non suivi) : les ajouter au `.gitignore`.

#### Non bloquants

| ID | Sévérité | Localisation | Constat | Recommandation |
| --- | --- | --- | --- | --- |
| S10-e (nouveau) | Moyenne | `sso.service.ts:449-485` | Sur un domaine **déjà prouvé**, un ADMIN (pas seulement l'OWNER) peut changer `provider`, `issuer` (tenant) ou `clientId` sans nouvelle preuve et sans désactivation. Un ADMIN malveillant ou compromis pointe le SSO vers son propre tenant et se fait lier tout compte non lié du domaine (sous réserve du MFA du compte). | Changer de fournisseur, de tenant ou de client remet `enabled=false`, réservé à l'OWNER, journalisé (A8) ; test associé |
| S10-f (nouveau) | Basse | `sso.service.ts:218-235,89-93` | `fetch` vers le point de jeton sans délai maximal ; `tokenRes.json()` ou `decrypt()` qui échouent donnent un 500 | `signal: AbortSignal.timeout(5000)` ; `try/catch` vers 401/503 ; test |
| S10-g (nouveau) | Basse | migration l.6 | `SSOConfiguration_domain_key` supprimé sans index non unique de remplacement (`assertSsoNotEnforced` et `deleteMany` filtrent par `domain`) ; § 6 du runbook ne dit pas qu'un retour à l'ancien code exige de dédoublonner `domain` avant de recréer l'index unique | `@@index([domain])` ; SQL de retour arrière documenté |
| S10-h (nouveau) | Basse | `auth.service.ts:195`, `scim.service.ts:214` | `enforceSSO` et SCIM lisent `domain` + `domainVerifiedAt` au lieu de `verifiedDomain`, comme r8 le demandait. C'est équivalent aujourd'hui (seul `verifyDomain` pose les deux), mais cela fait deux sources de vérité | Lire `verifiedDomain` partout |
| r8-Azure | Basse | `sso.service.ts:349-357` | Contrôles `acct === 1` (invité) et `xms_edov === false` non implémentés ; repli sur `preferred_username` (attribut non vérifié) | Implémenter comme recommandé en r8 |
| S10-i (nouveau) | Basse | `sso.service.ts` | Aucun échec SSO n'est journalisé (jeton invalide, `state` rejoué, 409 de liaison) : aucune détection possible d'une tentative | Ligne structurée `SSO_LOGIN_FAILURE` (motif, workspace, sans jeton) |
| B1 | Basse | `backend/dist/` | `dist/` contient d'anciens `*.spec.js` (31/10) : `nest build` est incrémental et ne vide pas la sortie, ce qui contredit « dist sans spec » du journal | `"deleteOutDir": true` dans `nest-cli.json` |

## 5. Réponses aux questions ouvertes du journal (S11-a)

- **(a) Empreinte de l'en-tête complet, schéma `Bearer` compris ?** Sans objet après correction de S11-b : la limite par clé doit porter sur `scimApiKeyId` **après** authentification, pas sur un en-tête brut.
- **(b) 300/min par compteur ou globale ?** Par compteur et par route : `@nestjs/throttler` 5.1.2 génère la clé à partir de la classe, du gestionnaire, du nom du throttler et du compteur. La limite s'applique donc par clé **et par route** (`GET /Users` et `PATCH /Users/:id` ont des compteurs distincts). C'est acceptable, mais à documenter.

## 6. Verdict

**NON VALIDÉ.**

Points bloquants, dans l'ordre de traitement recommandé :

1. **S11-b (Haute)** : contournement global du limiteur de débit introduit par `AppThrottlerGuard`. Corriger et tester avant tout commit.
2. **S10-a (Moyenne)** : supprimer le `deleteMany` inter-workspace, remplacer le test qui l'exige, ajouter les tests de revendications concurrentes, convertir `P2002` en 409 dans `verifyDomain`.
3. **S10-d (Moyenne / Majeure fonctionnelle)** : purger les `ssoUid` hérités et revérifier le domaine du compte trouvé par `ssoUid`.
4. **S10-b, S10-c (Basse)** : tests d'acceptation r8 manquants ; retrait du repli `APP_URL` et de localhost.
5. **D1 (Moyenne)** : retirer les sections « VALIDÉ » non attribuables du journal, corriger les statuts, `GEMINI.md`, le DAT et le runbook (§ 2, 4, 6, 7, procédure « perte du domaine », `ssoUid` hérités).
6. **L1** : restaurer `pnpm-lock.yaml` (diff de 3 lignes) et exclure les `*.tsbuildinfo` avant de committer.

Validés en l'état, sous réserve des points ci-dessus : le cœur de S10 (validation OIDC, flux `state`/nonce/PKCE, preuve DNS, rôle, chiffrement du secret, `enforceSSO`) et S11 hors limitation de débit.

**Constats ouverts à transmettre à fixeur** : S11-b, S10-a, S10-d, S10-b (test), S10-c (doc et test), D1, L1 ; non bloquants : S10-e, S10-f, S10-g, S10-h, S10-i, contrôles Azure, B1. Ces identifiants sont à reporter dans `rapport-audit.md` (révision r9). `FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED` restent à `false`.
