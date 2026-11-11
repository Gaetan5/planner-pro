-- N6 : `SSOConfiguration.clientSecret` passe de VARCHAR(191) à TEXT. Le secret est stocké chiffré
-- (AES-256-GCM, `iv:tag:contenu` en hexadécimal, 58 + 2 n caractères pour n octets) : la borne de
-- 66 caractères du DTO dépendait de ce détail et ne tenait pas compte des caractères non ASCII
-- (plus d'octets que de caractères). Le DTO borne désormais à 1 024 caractères (3 octets au plus
-- par unité UTF-16), soit au plus 58 + 2 × 3 072 = 6 202 caractères chiffrés, très en dessous des
-- 65 535 octets d'un TEXT.
-- Élargissement sans perte : aucune donnée n'est modifiée ; la table est vide en production.
--
-- Idempotente (même principe que la migration de dérive A9) : l'élargissement n'est exécuté que si
-- la colonne n'est pas déjà de type `text`, de sorte que le rejeu sur une base conforme ne fait rien.

SET @n6_secret_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SSOConfiguration' AND COLUMN_NAME = 'clientSecret'
);
SET @n6_secret_sql := IF(
  @n6_secret_type IS NOT NULL AND @n6_secret_type <> 'text',
  'ALTER TABLE `SSOConfiguration` MODIFY `clientSecret` TEXT NULL',
  'DO 0'
);
PREPARE n6_secret_stmt FROM @n6_secret_sql;
EXECUTE n6_secret_stmt;
DEALLOCATE PREPARE n6_secret_stmt;
