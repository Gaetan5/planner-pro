-- S6 (audit de sécurité) : cycle de vie du MFA.
--  - `mfaPendingSecret` : le secret généré par /auth/mfa/setup n'écrase plus le secret actif ;
--    il n'est promu dans `mfaSecret` qu'à la confirmation.
--  - `mfaLastUsedStep` : anti-rejeu (un pas de temps TOTP ne passe qu'une fois).
--  - `MfaRecoveryCode` : codes de récupération à usage unique, hachés en Argon2id.
-- Colonnes nullables : aucun backfill. Les secrets TOTP existants sont chiffrés par
-- `backend/scripts/encrypt-mfa-secrets.ts` (script idempotent, voir docs/security/runbook-phase1.md) ;
-- en attendant, le code lit indifféremment un secret chiffré (iv:tag:data) ou en clair.

-- AlterTable
ALTER TABLE `User` ADD COLUMN `mfaLastUsedStep` INTEGER NULL,
    ADD COLUMN `mfaPendingSecret` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `MfaRecoveryCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(255) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MfaRecoveryCode_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MfaRecoveryCode` ADD CONSTRAINT `MfaRecoveryCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
