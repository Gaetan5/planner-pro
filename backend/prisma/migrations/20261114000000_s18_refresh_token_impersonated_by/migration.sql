-- S18 : administrateur à l'origine d'une session d'impersonation (libellé dans la liste des sessions).
-- Additive, nullable : aucune reprise de données ; les sessions existantes restent à NULL
-- (sessions ordinaires). Les sessions d'impersonation durent 15 minutes au plus.
ALTER TABLE `RefreshToken` ADD COLUMN `impersonatedBy` VARCHAR(191) NULL;
