-- AlterTable User
ALTER TABLE `User`
    ADD COLUMN `ssoUid` VARCHAR(191) NULL UNIQUE,
    ADD COLUMN `mfaSecret` VARCHAR(191) NULL,
    ADD COLUMN `mfaEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN `isSuspended` BOOLEAN NOT NULL DEFAULT FALSE;

-- CreateTable SSOConfiguration
CREATE TABLE `SSOConfiguration` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `provider` ENUM('SAML2', 'OIDC_AZURE_AD', 'OIDC_GOOGLE', 'OIDC_GENERIC') NOT NULL DEFAULT 'OIDC_AZURE_AD',
    `domain` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `clientSecret` VARCHAR(191) NULL,
    `discoveryUrl` VARCHAR(191) NULL,
    `entryPoint` VARCHAR(191) NULL,
    `cert` TEXT NULL,
    `issuer` VARCHAR(191) NULL,
    `defaultRole` ENUM('OWNER', 'ADMIN', 'MEMBER', 'VIEWER') NOT NULL DEFAULT 'MEMBER',
    `enforceSSO` BOOLEAN NOT NULL DEFAULT FALSE,
    `autoProvision` BOOLEAN NOT NULL DEFAULT TRUE,
    `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SSOConfiguration_workspaceId_key`(`workspaceId`),
    UNIQUE INDEX `SSOConfiguration_domain_key`(`domain`),
    PRIMARY KEY (`id`),
    CONSTRAINT `SSOConfiguration_workspaceId_fkey`
        FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable SCIMApiKey
CREATE TABLE `SCIMApiKey` (
    `id` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SCIMApiKey_tokenHash_key`(`tokenHash`),
    INDEX `SCIMApiKey_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `SCIMApiKey_workspaceId_fkey`
        FOREIGN KEY (`workspaceId`) REFERENCES `Workspace`(`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
