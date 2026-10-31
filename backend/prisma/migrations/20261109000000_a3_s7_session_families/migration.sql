-- A3 / S7 (audit de sécurité) : sessions révocables.
-- Une session est une « famille » de jetons de rafraîchissement : `familyId` est le `sid` du jeton
-- d'accès. La table `RefreshToken` n'était alimentée par aucun code (révocation sans effet) : elle
-- est vide en pratique, l'ajout d'une colonne NOT NULL sans valeur par défaut est donc sans risque.
-- Aucun backfill requis. Par prudence, les éventuelles lignes existantes sont supprimées avant
-- l'ALTER : sans `familyId` valide, aucune n'est utilisable (elles recevraient familyId = '').

DELETE FROM `RefreshToken`;

-- AlterTable
ALTER TABLE `RefreshToken` ADD COLUMN `authenticatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `familyId` VARCHAR(191) NOT NULL,
    ADD COLUMN `rotatedAt` DATETIME(3) NULL,
    ADD COLUMN `userAgent` VARCHAR(255) NULL;

-- CreateIndex
CREATE INDEX `RefreshToken_familyId_idx` ON `RefreshToken`(`familyId`);
