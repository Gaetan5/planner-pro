-- S17 (audit de sécurité, Phase 4) : rôle de projet choisi explicitement à l'invitation, au lieu
-- d'être déduit du rôle de workspace. Colonne nullable : une invitation en attente créée avant
-- cette migration (projectRole NULL) donne le rôle CLIENT (le plus restreint) à l'acceptation.
-- Procédure : docs/security/runbook-phase4.md.

-- AlterTable
ALTER TABLE `Invitation` ADD COLUMN `projectRole` ENUM('MANAGER', 'CONTRIBUTOR', 'COMMENTER', 'CLIENT') NULL;

-- Une invitation en attente à un projet donne désormais toujours le rôle VIEWER sur le workspace
-- (jamais ADMIN ni MEMBER) ; une invitation OWNER en attente n'est plus acceptable (OWNER n'est
-- jamais invitable). Les lignes déjà acceptées ne sont pas modifiées.
UPDATE `Invitation` SET `role` = 'VIEWER' WHERE `projectId` IS NOT NULL AND `status` = 'PENDING' AND `role` <> 'VIEWER';
UPDATE `Invitation` SET `status` = 'REVOKED' WHERE `role` = 'OWNER' AND `status` = 'PENDING';
