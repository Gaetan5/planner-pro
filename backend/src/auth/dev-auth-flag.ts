/**
 * Connexion simulée (P13-e, S26) : disponible uniquement si `NODE_ENV=development` ET
 * `ENABLE_DEV_AUTH=true`. Sinon le contrôleur n'est pas enregistré : la route n'existe pas (404).
 */
export function isDevAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' && env.ENABLE_DEV_AUTH === 'true';
}
