CREATE TABLE `FirestoreSyncOutbox` (
    `id` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL AUTO_INCREMENT,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `claimedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,

    UNIQUE INDEX `FirestoreSyncOutbox_sequence_key`(`sequence`),
    INDEX `FirestoreSyncOutbox_processedAt_nextAttemptAt_sequence_idx`(`processedAt`, `nextAttemptAt`, `sequence`),
    INDEX `FirestoreSyncOutbox_entityType_entityId_sequence_idx`(`entityType`, `entityId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
