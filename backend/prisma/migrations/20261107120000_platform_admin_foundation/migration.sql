ALTER TABLE `User`
ADD COLUMN `platformRole` ENUM('SUPER_ADMIN', 'PLATFORM_ADMIN') NULL;

CREATE TABLE `PlatformAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlatformAuditLog_createdAt_idx`(`createdAt`),
    INDEX `PlatformAuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PlatformAuditLog_actorId_fkey`
        FOREIGN KEY (`actorId`) REFERENCES `User`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
