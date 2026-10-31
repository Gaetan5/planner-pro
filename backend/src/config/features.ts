/**
 * Interrupteurs des fonctionnalités entreprise (P3).
 * Désactivées par défaut : seule la valeur exacte 'true' les active.
 * Lus à chaque appel pour qu'un changement de configuration ne nécessite pas de nouveau build.
 */
export type FeatureFlag = 'SSO' | 'SCIM' | 'IMPERSONATION';

const FEATURE_ENV: Record<FeatureFlag, string> = {
  SSO: 'FEATURE_SSO_ENABLED',
  SCIM: 'FEATURE_SCIM_ENABLED',
  // Mesure transitoire tant que S18 n'est pas livré (jeton complet, sans limite de cible)
  IMPERSONATION: 'FEATURE_IMPERSONATION_ENABLED',
};

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return process.env[FEATURE_ENV[flag]] === 'true';
}

export function getFeatureFlags(): { sso: boolean; scim: boolean; impersonation: boolean } {
  return {
    sso: isFeatureEnabled('SSO'),
    scim: isFeatureEnabled('SCIM'),
    impersonation: isFeatureEnabled('IMPERSONATION'),
  };
}
