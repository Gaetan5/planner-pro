-- A9 : résorption de la dérive entre l'historique des migrations et schema/*.prisma, révélée par
-- `prisma migrate diff --exit-code` en CI. La migration 20261107140000_enterprise_sso_scim_mfa,
-- écrite à la main, créait l'unique de `User.ssoUid` sous le nom implicite MySQL `ssoUid` et
-- laissait un DEFAULT sur `SSOConfiguration.updatedAt` (que Prisma gère par @updatedAt).
-- Opérations de métadonnées uniquement : aucune donnée n'est lue ni réécrite, l'unicité de
-- `ssoUid` est conservée (renommage d'index), l'application renseigne `updatedAt` à chaque écriture.
--
-- r47-m1 : migration idempotente, tolérante aux deux états. La base de production a déjà l'index
-- `User_ssoUid_key` (pas d'index `ssoUid`) et aucun DEFAULT sur `updatedAt` ; une base migrée de
-- zéro a encore l'index `ssoUid`. Le renommage n'est donc exécuté que si l'ancien index existe.

-- AlterTable (sans effet sur une colonne qui n'a déjà plus de DEFAULT)
ALTER TABLE `SSOConfiguration` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- RenameIndex (gardé par information_schema)
SET @a9_ssouid_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND INDEX_NAME = 'ssoUid'
);
SET @a9_ssouid_sql := IF(
  @a9_ssouid_idx > 0,
  'ALTER TABLE `User` RENAME INDEX `ssoUid` TO `User_ssoUid_key`',
  'DO 0'
);
PREPARE a9_ssouid_stmt FROM @a9_ssouid_sql;
EXECUTE a9_ssouid_stmt;
DEALLOCATE PREPARE a9_ssouid_stmt;
