# Runbook : déploiement de la Phase 1 (sessions, MFA, vérification d'e-mail)

| Champ | Valeur |
| --- | --- |
| Constats couverts | A3, S7, S29 (sessions et cookies), S6 (MFA), S9 (OAuth GitHub), P6 (vérification d'e-mail, réinitialisation), S27 |
| Auteur | senior-fixer |
| Public | Exploitant de la production, avec un second relecteur pour `--apply` |
| Prérequis | Phase 0 déployée et son runbook (`runbook-reprise-phase0.md`) exécuté ; accès à MySQL en TLS ; SMTP opérationnel |

> **Aucune étape n'est automatique.** Les migrations s'appliquent par `prisma migrate deploy`, le script MFA tourne d'abord en rapport seul, puis avec `--apply` après relecture. Rien de ce document n'a été exécuté contre une base réelle par le correcteur.

## 0. Ordre de déploiement

| Étape | Action | Écrit en base ? |
| --- | --- | --- |
| 1 | Sauvegarde vérifiée de MySQL (restauration testée) | Non |
| 2 | Contrôle des variables d'environnement (section 1) | Non |
| 3 | Annonce de la déconnexion générale (section 2) | Non |
| 4 | `prisma migrate deploy` : trois migrations, dans l'ordre (section 3) | Oui |
| 5 | Déploiement du backend, puis du frontend | Non |
| 6 | `encrypt-mfa-secrets.ts` en rapport, relecture, puis `--apply` (section 4) | Oui |
| 7 | Seconde exécution `--apply` : doit annoncer 0 modification | Non (attendu) |
| 8 | Révocation côté GitHub des anciens jetons à portée `repo` (section 5) | Non |
| 9 | Vérifications après déploiement (section 7) | Non |

Le backend et le frontend doivent être déployés **ensemble** : les routes de connexion ne renvoient plus de jeton dans le corps (cookies), `register` répond 202 sans session, et le retour GitHub appelle `/auth/github/pending`.

## 1. Variables d'environnement

| Variable | Exigence |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT` (`SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`) | **Obligatoires en production** : le backend refuse de démarrer sans SMTP (P6-a). Sans e-mail, ni vérification d'adresse ni réinitialisation. Le corps des e-mails n'est jamais journalisé hors développement et test. |
| `CORS_ORIGINS` | Obligatoire en production. Sert aussi de liste d'`Origin` autorisées pour les requêtes à cookie et les handshakes WebSocket (S29) : y mettre **uniquement** l'origine du frontend. |
| `FRONTEND_URL` | Origine du frontend : liens d'e-mail (`/?verify=`, `/?reset=`) et `redirect_uri` GitHub. |
| `JWT_SECRET` | Inchangé. Le `state` GitHub en dérive une clé HKDF dédiée : changer `JWT_SECRET` invalide les autorisations GitHub en cours (sans conséquence). |
| `ENCRYPTION_KEY` | 32 octets, **requis** pour le chiffrement des secrets MFA (section 4). La perdre rend les secrets chiffrés illisibles : la sauvegarder séparément. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | L'URL de rappel de l'application GitHub OAuth doit être l'origine de `FRONTEND_URL`. `VITE_GITHUB_CLIENT_ID` n'est plus lue. |
| `DATABASE_URL`, `DATABASE_SSL` | Inchangées (TLS obligatoire en production). |

Le backend et le frontend doivent rester du **même site** (`planner-pro.boukarou-os.com` et `api.planner-pro.boukarou-os.com`) : les cookies sont `SameSite=Strict`.

## 2. Déconnexion générale (à annoncer)

Les jetons d'accès émis avant la Phase 1 n'ont pas de `sid` : ils sont rejetés. **Tous les utilisateurs devront se reconnecter** au déploiement. Prévenir à l'avance, et choisir une plage de faible activité. Les sockets ouvertes sont coupées au déploiement.

## 3. Migrations (ordre strict)

`prisma migrate deploy` les applique dans cet ordre (le nom les trie) :

1. **`20261109000000_a3_s7_session_families`** : `RefreshToken` reçoit `familyId`, `authenticatedAt`, `rotatedAt`, `userAgent`. La migration commence par `DELETE FROM RefreshToken;` : la table n'était alimentée par aucun code, et aucune ligne existante n'est utilisable sans `familyId`. Aucun backfill.
2. **`20261109000100_s6_mfa_lifecycle`** : `User.mfaPendingSecret`, `User.mfaLastUsedStep`, table `MfaRecoveryCode`. Colonnes nullables. Les secrets TOTP existants restent lisibles en clair jusqu'à l'étape 4.
3. **`20261109000200_p6_email_verification_and_auth_tokens`** : `User.emailVerifiedAt`, table `AuthToken`, puis **reprise de données** : `UPDATE User SET emailVerifiedAt = createdAt`. Tous les comptes **existants** sont donc considérés comme vérifiés (décision produit : sinon ils seraient tous bloqués au déploiement). Seules les **nouvelles** inscriptions exigent la vérification.

Contrôles après migration (lecture seule) :

```sql
SELECT COUNT(*) FROM `User` WHERE `emailVerifiedAt` IS NULL;   -- attendu : 0
SELECT COUNT(*) FROM `RefreshToken`;                           -- attendu : 0 avant le premier login
SHOW TABLES LIKE 'AuthToken';  SHOW TABLES LIKE 'MfaRecoveryCode';
```

**Comptes provisionnés par SCIM** : ils sont marqués vérifiés par la reprise, mais n'ont pas de mot de passe et ne peuvent être « réclamés » par une connexion externe (S8). Leur premier accès passe par « Mot de passe oublié ».

## 4. Chiffrement des secrets MFA (S6)

Script : `backend/scripts/encrypt-mfa-secrets.ts`. Idempotent (chaque mise à jour est conditionnée à la valeur lue). Le rapport CSV ne contient jamais de secret, mais contient des adresses e-mail.

```bash
cd backend
# 1. Rapport seul, aucune écriture
npx tsx --env-file=.env scripts/encrypt-mfa-secrets.ts
# 2. Relecture du CSV par deux personnes (nombre de comptes, absence d'anomalie)
# 3. Application (après sauvegarde vérifiée)
npx tsx --env-file=.env scripts/encrypt-mfa-secrets.ts --apply
# 4. Seconde exécution : doit annoncer 0 secret en clair
npx tsx --env-file=.env scripts/encrypt-mfa-secrets.ts --apply
```

- **Sauvegarde préalable** obligatoire, et `ENCRYPTION_KEY` identique à celle de l'API.
- **Conserver le CSV de l'exécution `--apply`** avec le ticket de déploiement (droits `600`, hors Git, pas de transmission par messagerie).
- Tant que le script n'a pas tourné, le code lit indifféremment un secret chiffré (`iv:tag:data`) ou en clair ; toute écriture est chiffrée.

## 5. Jetons GitHub existants

Les jetons GitHub déjà stockés ont l'ancienne portée `repo`. Ils restent valides jusqu'à révocation côté GitHub. Pour réduire l'exposition :

- demander aux utilisateurs concernés de révoquer l'autorisation (GitHub > Settings > Applications), ou
- révoquer en masse via l'API des applications OAuth GitHub (`DELETE /applications/{client_id}/grant`), puis vider `User.githubAccessToken` après revue.

Depuis S9, la connexion GitHub ne persiste plus aucun jeton : seul le parcours « connecter un dépôt » (finalité `repos`, portée `repo` accordée) en stocke un. Le parcours utilisateur (écran « Sécurité du compte ») est un chantier produit distinct (P9).

## 6. Contrat des cookies (scripts et intégrations)

| Cookie | Valeur développement | Valeur production | Portée |
| --- | --- | --- | --- |
| Accès | `accessToken` | `__Host-accessToken` | `Path=/`, 15 min, `HttpOnly`, `SameSite=Strict`, `Secure` en production |
| Rafraîchissement | `refreshToken` | `__Secure-refreshToken` | `Path=/auth`, 7 jours glissants (plafond absolu de 30 jours), mêmes attributs |

- Aucun jeton n'est plus renvoyé dans le corps des réponses ni stocké par le JavaScript.
- Une requête **à effet** (`POST`, `PUT`, `PATCH`, `DELETE`) qui porte un cookie de session doit avoir un en-tête `Origin` (à défaut `Referer`) présent dans `CORS_ORIGINS`, sinon 403. Exemptés : webhook GitHub et SCIM (authentifiés par signature ou clé).
- Un handshake WebSocket authentifié **par cookie** exige aussi une `Origin` autorisée.
- Un **script non navigateur** doit présenter `Authorization: Bearer <jeton d'accès>` (sans cookie, donc sans contrôle d'`Origin`). Il ne reçoit plus de jeton à la connexion : prévoir une session par cookie (`curl -c`) ou attendre les jetons d'API personnels (backlog). Le `Bearer` sera retiré à la Phase 5 sauf consommateur documenté.
- Un cookie présent en double (déposé par un sous-domaine voisin) est ignoré.

## 7. Vérifications après déploiement

1. Connexion, puis `POST /auth/logout`, puis rejeu de l'ancien cookie : 401.
2. Inscription d'un compte de test : réponse 202, e-mail reçu, connexion refusée (403) avant clic sur le lien, acceptée après.
3. « Mot de passe oublié » : e-mail reçu, lien utilisable une fois, toutes les sessions fermées.
4. Requête `POST` avec cookie et `Origin` étrangère : 403.
5. Aucun lien `?verify=` ni `?reset=` (jeton) dans les journaux de l'API : `grep -r "verify=\|reset=" <journaux>` ne doit rien renvoyer.
6. Démarrage de l'API sans `SMTP_HOST` en production : échec explicite (attendu).
7. **Alerte sur les échecs SMTP** (à configurer avant l'ouverture aux utilisateurs) : en production, un échec d'envoi n'est plus « simulé » et la réponse de l'API reste générique ; l'utilisateur ne voit donc rien, et vérification d'adresse comme réinitialisation sont silencieusement perdues. Alerter sur les lignes de journal `Échec de l'envoi de l'email à` et `Échec de l'envoi d'un e-mail de compte` (niveau `error`, logger `MailService` / `AuthService`) : par exemple plus de 5 occurrences en 10 minutes, ou toute occurrence persistant plus de 5 minutes. Ces lignes ne contiennent ni lien ni adresse en clair (destinataire masqué).

## 8. Retour arrière

- **Code** : redéployer la version précédente. Les nouvelles colonnes (nullables ou à défaut) ne gênent pas l'ancien code, sauf `RefreshToken.familyId` (NOT NULL, jamais écrit par l'ancien code, table vide) : prévoir `DELETE FROM RefreshToken;` avant de revenir en arrière si des sessions ont été créées.
- **Secrets MFA** : le retour au code précédent **ne sait pas lire** un secret chiffré. Avant de revenir en arrière après l'étape 4, restaurer les secrets depuis la sauvegarde (ou déchiffrer avec `ENCRYPTION_KEY`). Sans cela, tous les comptes MFA seraient bloqués. C'est la raison de la sauvegarde préalable.
- **Migrations** : ne pas supprimer les tables `AuthToken` et `MfaRecoveryCode` ; elles sont inertes pour l'ancien code. `emailVerifiedAt` ne nécessite aucun retour.
- Un retour arrière des sessions est une **nouvelle déconnexion générale**.

## 9. Tâche planifiée

Une purge quotidienne (03:30) supprime les inscriptions par mot de passe **jamais vérifiées** depuis plus de 7 jours, avec leur espace d'onboarding personnel (P6-c). Elle ne touche pas aux comptes ayant une autre identité (Firebase, GitHub, SSO, SCIM) ni à ceux qui participent à un autre espace. Les échecs sont journalisés en avertissement.
