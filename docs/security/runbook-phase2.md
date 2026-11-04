# Runbook : déploiement de la Phase 2 (SSO OIDC et SCIM)

| Champ | Valeur |
| --- | --- |
| Constats couverts | S10 (SSO OIDC), S11 (SCIM) |
| Auteur | senior-fixer |
| Public | Exploitant de la production |
| Prérequis | Phases 0 et 1 déployées (`runbook-reprise-phase0.md`, `runbook-phase1.md`) |

> **`FEATURE_SSO_ENABLED` et `FEATURE_SCIM_ENABLED` restent à `false`.** Leur réactivation est une décision à prendre à la fin de la phase (voir section 5). Rien de ce document n'a été exécuté contre une base réelle.

## 1. Ordre de déploiement

| Étape | Action | Écrit en base ? |
| --- | --- | --- |
| 1 | Sauvegarde vérifiée de MySQL | Non |
| 2 | `prisma migrate deploy` : `20261110000000_s10_s11_sso_domain_and_scim_keys` | Oui |
| 3 | Déploiement backend puis frontend (ensemble) | Non |
| 4 | `encrypt-sso-secrets.ts` : rapport, relecture, `--apply` | Oui |
| 4 bis | `reset-legacy-sso-uids.ts` : rapport, relecture, `--apply` (avant toute réactivation du SSO, voir § 3 bis) | Oui |
| 5 | Redis opérationnel (le `state` SSO y est stocké ; sans Redis, le flux répond 503) | Non |

## 2. Migration et reprise de données

La migration :
- ajoute `SSOConfiguration.verifiedDomain` (domaine **prouvé** par DNS, unique : source de vérité unique pour `enforceSSO`, SCIM et la connexion), `domainVerificationToken` et `domainVerifiedAt` ;
- **supprime l'index unique sur `SSOConfiguration.domain`** (plusieurs workspaces peuvent revendiquer un même domaine ; le premier qui prouve le domaine par DNS obtient `verifiedDomain`, les autres reçoivent 409) et le remplace par un **index non unique** `SSOConfiguration_domain_idx` ;
- **désactive toutes les configurations SSO existantes** (`enabled=false`, `enforceSSO=false`) et ramène leur rôle par défaut à `MEMBER` : aucun domaine n'est prouvé. Aucune ligne n'est supprimée ;
- donne aux clés SCIM sans expiration une **expiration à 365 jours** à compter de la migration.

Contrôles (lecture seule) :

```sql
SELECT COUNT(*) FROM `SSOConfiguration` WHERE `enabled` = true;               -- attendu : 0
SELECT COUNT(*) FROM `SCIMApiKey` WHERE `expiresAt` IS NULL AND `revokedAt` IS NULL;  -- attendu : 0
SHOW INDEX FROM `SSOConfiguration` WHERE `Key_name` IN ('SSOConfiguration_domain_idx', 'SSOConfiguration_verifiedDomain_key');  -- attendu : 2 index
```

La migration ne touche pas à `User.ssoUid` : voir § 3 bis.

## 3. Secrets client SSO

```bash
cd backend
npx tsx --env-file=.env scripts/encrypt-sso-secrets.ts           # rapport seul
npx tsx --env-file=.env scripts/encrypt-sso-secrets.ts --apply   # après relecture et sauvegarde
npx tsx --env-file=.env scripts/encrypt-sso-secrets.ts --apply   # doit annoncer 0 secret en clair
```

Même procédure et mêmes précautions que `encrypt-mfa-secrets.ts` (sauvegarde, `ENCRYPTION_KEY` identique à celle de l'API, CSV conservé sans secret). Le code lit un secret en clair ou chiffré ; toute écriture est chiffrée.

## 3 bis. Liaisons `ssoUid` héritées (S10-d)

L'ancien code posait `User.ssoUid` (`azure-ad:<oid|sub>` ou `google:<sub>`) à partir d'un `id_token` **non vérifié**. Ces liaisons ne sont pas fiables, et le format Azure a changé (`azure-ad:<tid>:<oid>`) : sans reprise, tout utilisateur Azure déjà lié reçoit 409 à sa première connexion. Le script les remet à NULL ; les comptes sont ensuite liés de nouveau par leur e-mail, dans le domaine prouvé de l'organisation.

```bash
cd backend
npx tsx --env-file=.env scripts/reset-legacy-sso-uids.ts           # rapport seul (CSV sans e-mail ni identifiant IdP)
npx tsx --env-file=.env scripts/reset-legacy-sso-uids.ts --apply   # après relecture et sauvegarde
npx tsx --env-file=.env scripts/reset-legacy-sso-uids.ts --apply   # doit annoncer 0 liaison héritée
```

- À exécuter **avant** la réactivation de `FEATURE_SSO_ENABLED` : le mode `--apply` est refusé si `FEATURE_SSO_ENABLED=true` (les identifiants `google:<sub>` actuels ne se distinguent pas des anciens). Les identifiants Azure déjà au nouveau format sont conservés.
- Impact : un utilisateur concerné se reconnecte par SSO sans autre action (liaison par e-mail dans le domaine prouvé). Un compte dont l'adresse sort du domaine prouvé reçoit 409 (le code vérifie aussi le domaine d'un compte trouvé par `ssoUid`).
- Rien de ce script n'a été exécuté contre une base réelle.

## 4. Remise en service d'une organisation (par organisation, à la demande)

1. L'administrateur du workspace ouvre la configuration SSO : `GET /workspaces/:id/sso` renvoie `dnsVerification` (hôte `_planner-pro.<domaine>`, type TXT, valeur `planner-pro-verification=<jeton>`).
2. L'organisation publie ce TXT, puis `POST /workspaces/:id/sso/verify-domain` (5 par minute).
3. Pour Azure AD, saisir l'**identifiant de tenant (GUID)** dans `issuer` ; `common`, `organizations` et `consumers` sont refusés. Pour Google, `hd` doit valoir le domaine et l'adresse doit être vérifiée.
4. L'URL de redirection enregistrée chez l'IdP doit valoir l'**origine de `FRONTEND_URL`** + `/auth/sso/callback` (ex. `https://planner-pro.boukarou-os.com/auth/sso/callback`). `FRONTEND_URL` est lue côté serveur ; le client ne la choisit plus. `APP_URL` n'est plus utilisée. En production, sans `FRONTEND_URL`, le flux SSO répond 503 (aucun repli sur localhost).
5. Activer (`enabled=true`) puis, si voulu, `enforceSSO=true` : seulement possibles une fois le domaine prouvé.
6. Changer de **fournisseur, de tenant (`issuer`) ou de client (`clientId`)** sur un domaine prouvé est réservé à l'OWNER (403 pour un ADMIN) ; la configuration repasse alors à `enabled=false` et `enforceSSO=false` (la preuve du domaine est conservée) et la ligne `SSO_CONFIG_IDP_CHANGED` est écrite au journal. L'OWNER réactive ensuite explicitement.

SCIM : la création d'utilisateurs exige que l'adresse appartienne au domaine **vérifié** du workspace (403 sinon). Une clé SCIM expire par défaut à 365 jours (option `expiresInDays` jusqu'à 730). Les IdP SCIM envoient `Content-Type: application/scim+json` : le corps est désormais analysé.

## 5. Réactivation des drapeaux (décision de l'utilisateur)

Conditions rappelées par le rapport avant de passer `FEATURE_SSO_ENABLED=true` ou `FEATURE_SCIM_ENABLED=true` :
- Phase 2 relue et validée par l'architecte ;
- activation par workspace réservée aux offres autorisées (P3) ;
- alerte sur les échecs SMTP en place (runbook Phase 1) ;
- `FEATURE_IMPERSONATION_ENABLED` reste désactivé (S18).

## 6. Retour arrière

- Code : redéployer la version précédente. Les nouvelles colonnes sont nullables ; les configurations désactivées par la migration **restent désactivées** (réactivation manuelle si un retour arrière est décidé, mais l'ancien code ne vérifie pas les jetons d'identité : ne pas le faire).
- Secrets chiffrés : l'ancien code ne sait pas lire un secret chiffré. Avant de revenir en arrière après l'étape 4, restaurer les secrets depuis la sauvegarde.
- `ssoUid` : le script du § 3 bis n'est pas réversible ; restaurer `User.ssoUid` depuis la sauvegarde si nécessaire (l'ancien code ne vérifie pas les jetons d'identité : déconseillé).
- Schéma (retour arrière complet, après sauvegarde, SEULEMENT si aucun autre workspace n'a revendiqué le même domaine ou après arbitrage) : l'index unique sur `domain` ne peut être recréé qu'après dédoublonnage.

```sql
-- 1. Lecture : domaines revendiqués plusieurs fois (à arbitrer avant toute suppression)
SELECT `domain`, COUNT(*) AS n FROM `SSOConfiguration` GROUP BY `domain` HAVING COUNT(*) > 1;

-- 2. Dédoublonnage : conserver la ligne dont le domaine est prouvé, sinon la plus ancienne
DELETE c FROM `SSOConfiguration` c
JOIN `SSOConfiguration` k ON k.`domain` = c.`domain` AND k.`id` <> c.`id`
 AND (
      (k.`verifiedDomain` IS NOT NULL AND c.`verifiedDomain` IS NULL)
   OR (((k.`verifiedDomain` IS NULL) = (c.`verifiedDomain` IS NULL))
       AND (k.`createdAt` < c.`createdAt` OR (k.`createdAt` = c.`createdAt` AND k.`id` < c.`id`)))
 );

-- 3. Retour à l'ancien schéma
DROP INDEX `SSOConfiguration_domain_idx` ON `SSOConfiguration`;
CREATE UNIQUE INDEX `SSOConfiguration_domain_key` ON `SSOConfiguration`(`domain`);
DROP INDEX `SSOConfiguration_verifiedDomain_key` ON `SSOConfiguration`;
ALTER TABLE `SSOConfiguration`
  DROP COLUMN `verifiedDomain`,
  DROP COLUMN `domainVerificationToken`,
  DROP COLUMN `domainVerifiedAt`;

-- 4. Oublier la migration, pour qu'un nouveau « migrate deploy » la rejoue
DELETE FROM `_prisma_migrations`
 WHERE `migration_name` = '20261110000000_s10_s11_sso_domain_and_scim_keys';
```

## 7. Limites connues

- Le TXT n'est pas revérifié périodiquement (à envisager).
- Journal d'audit SCIM : lignes structurées dans le journal applicatif (`ScimAudit`), sans persistance en base (A8).
- Limitation de débit SCIM (S11-b) : **300 requêtes par minute et par clé authentifiée** (`scimApiKeyId`, toutes routes SCIM confondues), appliquée après l'authentification de la clé ; **3 000 par minute et par IP et par route** avant authentification (garde global), pour que des clés invalides aléatoires ne contournent aucune limite. Les autres routes restent limitées par IP. Aucune valeur fournie par le client (URL, en-tête `Authorization`) ne choisit le compteur.

## 8. Perte ou transfert du domaine

Si une organisation perd ou transfère son domaine (rachat, expiration, changement de propriétaire du DNS), la preuve acquise ne vaut plus :
1. Désactiver la configuration (`enabled=false`, `enforceSSO=false`) : soit par l'OWNER via l'API, soit en base après sauvegarde.
2. Supprimer `verifiedDomain` et `domainVerifiedAt` de la ligne (`UPDATE SSOConfiguration SET verifiedDomain = NULL, domainVerifiedAt = NULL, enabled = false, enforceSSO = false WHERE workspaceId = '<id>'`) : le domaine redevient revendicable par le nouveau propriétaire, qui devra publier son propre TXT.
3. Prévenir les administrateurs du workspace concerné (les comptes liés par e-mail conservent leur mot de passe éventuel ; les comptes sans mot de passe doivent passer par la réinitialisation).
4. Journaliser l'opération dans le registre d'exploitation (qui, quand, pourquoi).
