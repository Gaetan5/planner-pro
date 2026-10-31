-- P6 (audit de sécurité) : vérification d'e-mail et réinitialisation de mot de passe.
--  - `User.emailVerifiedAt` : propriété de l'adresse prouvée par un lien envoyé à cette adresse.
--  - `AuthToken` : jetons à usage unique (vérification 24 h, réinitialisation 30 min), hachés.

-- AlterTable
ALTER TABLE `User` ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `AuthToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET') NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuthToken_tokenHash_key`(`tokenHash`),
    INDEX `AuthToken_userId_type_idx`(`userId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AuthToken` ADD CONSTRAINT `AuthToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise des comptes existants (DÉCISION PRODUIT, option recommandée) : les comptes créés avant
-- cette migration sont considérés comme vérifiés, faute de quoi tous les utilisateurs existants
-- seraient bloqués au déploiement. Seules les NOUVELLES inscriptions exigent la vérification.
-- Les comptes provisionnés par SCIM (sans identifiant propre) restent inatteignables par une
-- connexion externe (S8) : leur premier accès passe par la réinitialisation de mot de passe.
UPDATE `User` SET `emailVerifiedAt` = `createdAt` WHERE `emailVerifiedAt` IS NULL;
