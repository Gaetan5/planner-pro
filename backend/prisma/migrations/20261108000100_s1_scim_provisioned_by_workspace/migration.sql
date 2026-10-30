-- S1 (audit de sécurité) : SCIM ne modifie plus les champs globaux de User.
-- `provisionedByWorkspaceId` mémorise le workspace dont la clé SCIM a créé le compte : seul ce
-- workspace peut en modifier le nom ou le réactiver. Colonne nullable : aucun backfill requis
-- (les comptes existants sont traités comme non provisionnés par SCIM).

-- AlterTable
ALTER TABLE `User` ADD COLUMN `provisionedByWorkspaceId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `User_provisionedByWorkspaceId_idx` ON `User`(`provisionedByWorkspaceId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_provisionedByWorkspaceId_fkey` FOREIGN KEY (`provisionedByWorkspaceId`) REFERENCES `Workspace`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
