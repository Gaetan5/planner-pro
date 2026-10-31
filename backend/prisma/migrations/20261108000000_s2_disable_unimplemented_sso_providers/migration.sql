-- S2 (audit de sécurité) : les fournisseurs SAML2 et OIDC_GENERIC ne sont pas implémentés.
-- Le callback authentifiait `user@<domaine>` sans aucune vérification : toute configuration
-- existante de ce type est désactivée. Migration de données uniquement, aucun changement de schéma.
-- Réactivation possible seulement quand la Phase 2 (S10) livrera une validation réelle.
UPDATE `SSOConfiguration`
SET `enabled` = FALSE
WHERE `provider` IN ('SAML2', 'OIDC_GENERIC') AND `enabled` = TRUE;
