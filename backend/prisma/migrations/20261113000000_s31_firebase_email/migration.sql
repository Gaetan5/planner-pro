-- S31 : adresse du compte Firebase lié (affichage et notification). Additive, nullable :
-- aucune reprise de données ; les liaisons existantes restent à NULL jusqu'à la prochaine liaison.
ALTER TABLE `User` ADD COLUMN `firebaseEmail` VARCHAR(191) NULL;
