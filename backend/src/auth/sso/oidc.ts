import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { promises as dns } from 'dns';
import { createRemoteJWKSet, JWTVerifyGetKey } from 'jose';
import { SSOProvider } from '@prisma/client';

/** Identifiant de tenant Azure : un GUID, jamais `common`, `organizations` ni `consumers` (S10). */
export const AZURE_TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OidcEndpoints {
  authorize: string;
  token: string;
  /** Émetteur attendu (`iss`) du jeton d'identité. */
  issuer: string;
  jwks: string;
}

/**
 * Points d'accès des fournisseurs, fixés dans le code : une URL de découverte saisie par un
 * administrateur de workspace n'est jamais suivie (pas de SSRF, pas d'émetteur arbitraire).
 */
export function oidcEndpoints(provider: SSOProvider, tenantId?: string | null): OidcEndpoints {
  if (provider === SSOProvider.OIDC_AZURE_AD) {
    if (!tenantId || !AZURE_TENANT_GUID.test(tenantId)) {
      throw new Error("L'identifiant de tenant Azure (GUID) est requis.");
    }
    const base = `https://login.microsoftonline.com/${tenantId.toLowerCase()}`;
    return {
      authorize: `${base}/oauth2/v2.0/authorize`,
      token: `${base}/oauth2/v2.0/token`,
      issuer: `${base}/v2.0`,
      jwks: `${base}/discovery/v2.0/keys`,
    };
  }
  if (provider === SSOProvider.OIDC_GOOGLE) {
    return {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      issuer: 'https://accounts.google.com',
      jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    };
  }
  throw new Error(`Fournisseur OIDC non pris en charge : ${provider}`);
}

/** Aléa du flux d'autorisation : `state` (préfixe `sso_`), `nonce` et vérificateur PKCE. */
export function newFlowSecrets() {
  const random = () => randomBytes(32).toString('base64url');
  return { state: `sso_${random()}`, nonce: random(), codeVerifier: random() };
}

export const pkceChallenge = (codeVerifier: string) =>
  createHash('sha256').update(codeVerifier).digest('base64url');

/** Source des clés de signature des IdP (injectable : les tests fournissent un JWKS local). */
@Injectable()
export class OidcKeySource {
  private readonly cache = new Map<string, JWTVerifyGetKey>();

  getKeys(jwksUri: string): JWTVerifyGetKey {
    let keys = this.cache.get(jwksUri);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 5000 });
      this.cache.set(jwksUri, keys);
    }
    return keys;
  }
}

/** Enregistrement TXT attendu pour prouver la propriété d'un domaine (S10). */
export const DOMAIN_VERIFICATION_PREFIX = 'planner-pro-verification=';
export const domainVerificationHost = (domain: string) => `_planner-pro.${domain}`;

/** Résolution DNS TXT (injectable pour les tests). */
@Injectable()
export class DomainVerifier {
  async hasVerificationToken(domain: string, token: string): Promise<boolean> {
    let records: string[][];
    try {
      records = await dns.resolveTxt(domainVerificationHost(domain));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA') return false;
      throw error;
    }
    const expected = `${DOMAIN_VERIFICATION_PREFIX}${token}`;
    return records.some((chunks) => chunks.join('') === expected);
  }
}
