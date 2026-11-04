-- S10 / S11 (audit de sécurité, Phase 2) : preuve de propriété du domaine SSO, expiration des clés SCIM.
-- Procédure et reprise : docs/security/runbook-phase2.md.

-- AlterTable (S10-a : domain n'est plus unique, verifiedDomain unique stocke le domaine prouvé)
ALTER TABLE `SSOConfiguration` DROP INDEX `SSOConfiguration_domain_key`,
    ADD COLUMN `verifiedDomain` VARCHAR(191) NULL,
    ADD COLUMN `domainVerificationToken` VARCHAR(191) NULL,
    ADD COLUMN `domainVerifiedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `SSOConfiguration_verifiedDomain_key` ON `SSOConfiguration`(`verifiedDomain`);

-- Index non unique de remplacement : les recherches et revendications concurrentes filtrent par domain (S10-g)
CREATE INDEX `SSOConfiguration_domain_idx` ON `SSOConfiguration`(`domain`);

-- Reprise de données (DÉCISION PRODUIT, option recommandée) : aucun domaine existant n'est prouvé.
-- Toute configuration SSO est donc désactivée, sans `enforceSSO`, et son rôle par défaut est borné.
-- Chaque organisation doit publier le TXT DNS puis réactiver. Aucune ligne n'est supprimée.
UPDATE `SSOConfiguration`
SET `enabled` = false,
    `enforceSSO` = false,
    `defaultRole` = 'MEMBER'
WHERE `domainVerifiedAt` IS NULL;

-- Les clés SCIM sans expiration expirent dans 365 jours (S11).
UPDATE `SCIMApiKey`
SET `expiresAt` = DATE_ADD(NOW(3), INTERVAL 365 DAY)
WHERE `expiresAt` IS NULL AND `revokedAt` IS NULL;
