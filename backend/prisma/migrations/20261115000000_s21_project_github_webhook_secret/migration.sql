-- S21 : secret de webhook GitHub propre à chaque projet (chiffré par l'application, AES-256-GCM).
-- Additive, nullable : aucune reprise de données. Les projets existants restent à NULL et ne
-- reçoivent plus de webhook tant qu'un secret n'a pas été généré (nouvelle liaison du dépôt ou
-- action « Régénérer »). L'ancienne route à secret global répond 410.
ALTER TABLE `Project` ADD COLUMN `githubWebhookSecret` TEXT NULL;
