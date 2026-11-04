-- S12 (audit de sécurité, Phase 3) : auteur du dépôt d'une pièce jointe, pour que seul l'auteur
-- ou un MANAGER du projet puisse la supprimer. Procédure : docs/security/runbook-phase3.md.

-- AlterTable
ALTER TABLE `Attachment` ADD COLUMN `uploadedById` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Attachment_uploadedById_idx` ON `Attachment`(`uploadedById`);

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise de données : une pièce jointe liée à un commentaire a pour auteur celui du commentaire.
-- Les pièces jointes directes d'une tâche (sans commentaire) restent à NULL : l'auteur est
-- inconnu, seul un MANAGER du projet (ou OWNER/ADMIN du workspace) peut les supprimer.
UPDATE `Attachment` AS a
INNER JOIN `Comment` AS c ON c.`id` = a.`commentId`
SET a.`uploadedById` = c.`userId`
WHERE a.`uploadedById` IS NULL;
