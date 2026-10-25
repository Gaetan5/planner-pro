ALTER TABLE `User` ADD COLUMN `firebaseUid` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `User_firebaseUid_key` ON `User`(`firebaseUid`);
