import { UnauthorizedException } from '@nestjs/common';
import { GithubPurpose, GITHUB_PURPOSES } from './dto/github.dto';
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';

/** Cookie du `state` OAuth GitHub (S9) : httpOnly, SameSite=Lax, limité aux routes GitHub, 10 min. */
export const GITHUB_STATE_COOKIE = 'github_oauth_state';
export const GITHUB_STATE_COOKIE_PATH = '/auth/github';
export const GITHUB_STATE_TTL_SECONDS = 600;

function signingKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET n'est pas défini.");
  }
  return Buffer.from(
    hkdfSync('sha256', secret, 'planner-pro', 'planner-pro:github-oauth-state:v1', 32),
  );
}

function sign(state: string): string {
  return createHmac('sha256', signingKey()).update(state).digest('hex');
}

/**
 * Génère un `state` de 32 octets aléatoires et la valeur de cookie signée correspondante
 * (`<state>.<finalité>.<HMAC>`) : un cookie injecté par un tiers (sous-domaine) ne passe pas la
 * vérification, et la finalité (login, link, repos) ne peut pas être changée (S9-b).
 */
export function createGithubOAuthState(purpose: GithubPurpose = 'login'): {
  state: string;
  cookieValue: string;
} {
  const state = randomBytes(32).toString('base64url');
  return { state, cookieValue: `${state}.${purpose}.${sign(`${state}.${purpose}`)}` };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseCookie(cookieValue: string | undefined) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;
  const [state, purpose, signature] = parts;
  if (!(GITHUB_PURPOSES as readonly string[]).includes(purpose)) return null;
  if (!safeEqual(signature, sign(`${state}.${purpose}`))) return null;
  return { state, purpose: purpose as GithubPurpose };
}

/** Finalité d'un cookie de state valide (signature vérifiée), sinon null. */
export function readGithubOAuthPurpose(cookieValue: string | undefined): GithubPurpose | null {
  return parseCookie(cookieValue)?.purpose ?? null;
}

/**
 * Vérifie, en temps constant, que le `state` renvoyé par GitHub est celui du cookie signé émis
 * par ce navigateur, et que sa finalité fait partie de celles acceptées par la route appelante.
 * Lève 401 dans tous les autres cas. Renvoie la finalité.
 */
export function verifyGithubOAuthState(
  cookieValue: string | undefined,
  state: string | undefined,
  allowedPurposes: readonly GithubPurpose[],
): GithubPurpose {
  const invalid = new UnauthorizedException('Échec OAuth GitHub : state invalide ou expiré.');
  if (!state) throw invalid;
  const parsed = parseCookie(cookieValue);
  if (!parsed || !safeEqual(parsed.state, state)) throw invalid;
  if (!allowedPurposes.includes(parsed.purpose)) throw invalid;
  return parsed.purpose;
}
