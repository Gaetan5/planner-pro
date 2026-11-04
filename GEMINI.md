# Planner-Pro — Règles pour l'agent Antigravity (Gemini)

Réponds toujours en français.

## Programme de remédiation sécurité en cours (branche `security/phase-0`)

Deux agents (fixeur et conrado) travaillent sur ce dépôt et tu dois rester aligné avec eux :

- **conrado** (architecte sécurité) : a audité le projet et revoit chaque correction dans le code. Il est le seul à pouvoir passer un constat à `VALIDÉ`.
- **fixeur** (ingénieur) : implémente les corrections, une par constat, en suivant le rapport de conrado.

Sources de vérité, à lire avant toute modification touchant la sécurité, l'authentification, l'autorisation, le SSO/SCIM/MFA, les intégrations calendrier, la base de données ou le déploiement :

1. `docs/security/rapport-audit.md` — rapport d'audit de conrado (45 constats : S1…S28 sécurité, A1…A9 architecture, P1…P8 produit), avec sévérité, fichier:ligne, remédiation attendue et critère d'acceptation. Plan d'action par phase en section 6.
2. `docs/security/journal-corrections.md` — journal de fixeur : plan, une entrée par constat (statut, changements, tests), et sous chaque entrée la « Revue architecte » de conrado.
3. `docs/DOSSIER_ARCHITECTURE_TECHNIQUE.md` §15 — vue d'ensemble du programme (v2.2).

### État (rapport r16, 04/11/2026)

- **Phase 0 validée côté code** par conrado (commit `aa66054`).
- **Phase 1 validée côté code** par conrado (revue r7, commit `c5f1391` : A3, S7, S8, S6, S9, P6, S27).
- **Phase 2 validée côté code** par conrado (revue r10, commit `aaf696d` : S10, S11). Réactivation de SSO et SCIM soumise au runbook `docs/security/runbook-phase2.md` et à la décision de l'utilisateur.
- **Phase 3 validée côté code** par conrado (revue r16, 04/11/2026 : A1, A2, A4, S12-a à S12-j, S13 à S16, script P4). Migration `20261111000000`, et exécution éventuelle du script `backend/scripts/grant-legacy-project-access.ts` (rapport puis `--apply`), soumises au runbook `docs/security/runbook-phase3.md` et à la décision de l'utilisateur.
- Le programme compte **7 phases (0 à 6)** :
  - 0 urgences — validée ;
  - 1 authentification et sessions — validée ;
  - 2 SSO/SCIM complets (S10, S11) — validée ;
  - 3 autorisation centralisée, IDOR, temps réel (A1, A2, A4, S12, S13, S14 suite, S15, S16) — validée ;
  - 4 invitations, console admin (P4, S17, S18 suite) ;
  - 5 durcissement (S19 à S26, A5, A6, A7, P5, P8) ;
  - 6 audit log, tests e2e, CI (A8, A9, P2, P7).
- **Prochaine phase : Phase 4** (invitations et console admin : S17 avec le complément SCIM `DELETE`, S18 suite ; P4 déjà tranché en Phase 3 ; reports acceptés : O7, O8, O9 ; décision produit P10). Phases 4 à 6 : pas commencées. Ne les anticipe pas. SSO et SCIM restent désactivés jusqu'à l'exécution du runbook Phase 2 et la décision de l'utilisateur. La montée vers pnpm 10 est prévue en Phase 6 (A9) : d'ici là, les overrides de `package.json` et `pnpm-workspace.yaml` doivent rester identiques.

### Ce qui a changé et que tu ne dois pas défaire

- Jetons typés : `typ: "access"` seul accepté par `jwt.guard.ts` et les gateways WebSocket ; ticket MFA `typ: "mfa_ticket"` à usage unique (Redis), 5 essais max, accepté uniquement sur `/auth/mfa/challenge`.
- SSO et SCIM désactivés par défaut (`FEATURE_SSO_ENABLED`, `FEATURE_SCIM_ENABLED` → 404). Fournisseurs `SAML2` / `OIDC_GENERIC` → 501.
- SCIM : jamais d'écriture sur l'e-mail ou le statut global d'un utilisateur (409 si e-mail existant, 400 sur changement d'e-mail), désactivation = retrait de l'adhésion au workspace.
- Calendrier : plus de simulateur ni de jetons `mock-*` ; sans identifiants OAuth → 503 ; synchronisation/export réservés OWNER/ADMIN.
- Intégrations : chargées uniquement si elles appartiennent au workspace de l'appelant (`where: { id, workspaceId }`, sinon 404) ; les réponses n'exposent jamais les jetons (`INTEGRATION_PUBLIC_SELECT`).
- Impersonation désactivée par défaut (`FEATURE_IMPERSONATION_ENABLED` → 404, bouton masqué).
- Redis indisponible pendant le MFA → 503 en 2 s maximum (`withRedisTimeout`) ; ne change pas `maxRetriesPerRequest` globalement.
- Base de données : `mariadb >= 3.5.4` (override pnpm), `DATABASE_URL` obligatoire hors dev/test, plus de repli `root`. **TLS MySQL obligatoire en production** (`DATABASE_SSL=true`, `--require-secure-transport=ON`, certificats via `ops/mysql-tls/generate-certs.sh`).
- Les scripts de reprise de données ne sont pas réversibles : le retour arrière passe par une sauvegarde testée.
- Autorisation par projet : toute lecture ou écriture d'un projet, d'une tâche ou d'un salon temps réel passe par `PolicyService` (`backend/src/authz/`, matrice unique `permissions.ts`) ; aucun rôle de projet sans `Membership` active dans le workspace du projet ; MEMBER/VIEWER sans `ProjectMembership` n'ont pas accès aux projets d'autrui (règle stricte P4). Les notes ne créent, modifient ou suppriment une tâche que là où l'auteur a `task.write`.

## Règles de travail

1. **Ne modifie pas un fichier en cours de correction par fixeur** (voir les constats non `VALIDÉ` dans le journal) sans que l'utilisateur te le demande explicitement : vous écraseriez mutuellement vos changements.
2. Si tu trouves une faille ou un bug de sécurité, **ne le corrige pas seul** : propose à l'utilisateur de l'ajouter au rapport (nouvel identifiant à la suite, ex. S29), pour que conrado et fixeur le traitent dans le même circuit.
3. Ne marque jamais un constat `VALIDÉ` et n'écris pas dans les sections « Revue architecte ».
4. Toute correction de sécurité commence par un test qui reproduit l'attaque et échoue ; puis `cd backend && pnpm test`, `cd frontend && pnpm test:run`, et `pnpm build`.
5. Ne réintroduis aucune donnée ou jeton simulé en dehors des fixtures de test. Toute nouvelle fonctionnalité d'entreprise reste derrière un drapeau `FEATURE_*` désactivé par défaut.
6. Ne lis pas et n'affiche pas les secrets des fichiers `.env*`. Ne commite pas, ne pousse pas et n'exécute pas de migration ou de script de reprise de données (`--apply`) sans demande explicite de l'utilisateur.
7. Ne committe jamais le dossier `.claude/`.
