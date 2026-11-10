import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * r42-m1 : Firebase Auth est initialisé sans résolveur popup/redirection, pour que le SDK ne
 * charge ni `apis.google.com/js/api.js` ni l'iframe `<authDomain>/__/auth/iframe` (bloqués par la
 * CSP en mode `enforce`).
 */
vi.mock('./firebase-config', () => ({
  firebaseConfig: {
    apiKey: 'cle-de-test',
    authDomain: 'planner-test.firebaseapp.com',
    projectId: 'planner-test',
    appId: '1:1:web:1',
  },
  isFirebaseAuthConfigured: true,
}));

const source = readFileSync(join(process.cwd(), 'src', 'firebase-auth.ts'), 'utf8');
const code = source.replace(/\/\/.*$/gm, '');

describe('r42-m1 : source de firebase-auth.ts', () => {
  it("n'utilise ni getAuth ni résolveur popup/redirection", () => {
    expect(code).not.toMatch(/\bgetAuth\b/);
    expect(code).not.toMatch(/browserPopupRedirectResolver/);
    expect(code).not.toMatch(/popupRedirectResolver/);
    expect(code).toMatch(/\binitializeAuth\(/);
  });

  it('conserve la persistance de getAuth() (IndexedDB, localStorage, sessionStorage)', () => {
    expect(code).toMatch(
      /persistence:\s*\[\s*indexedDBLocalPersistence,\s*browserLocalPersistence,\s*browserSessionPersistence\s*\]/,
    );
  });

  it("aucun module de l'application n'utilise getAuth, un résolveur ou une connexion popup/redirection", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('firebase-auth.spec.ts')
            ? [join(dir, e.name)]
            : [],
      );
    const offenders = walk(join(process.cwd(), 'src')).filter((f) =>
      /\b(getAuth|browserPopupRedirectResolver|signInWithPopup|signInWithRedirect|linkWithPopup|reauthenticateWithPopup)\b/.test(
        readFileSync(f, 'utf8').replace(/\/\/.*$/gm, ''),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe('r42-m1 : comportement avec le vrai SDK', () => {
  beforeEach(async () => {
    const { deleteApp, getApps } = await import('firebase/app');
    await Promise.all(getApps().map((a) => deleteApp(a)));
    vi.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('sur Safari/iOS : aucun script gapi ni iframe auth chargé, pas de résolveur', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    const { getFirebaseAuth } = await import('./firebase-auth');
    const auth = getFirebaseAuth();
    await (auth as unknown as { _initializationPromise: Promise<void> })._initializationPromise;
    await auth.authStateReady();

    expect((auth as unknown as { _popupRedirectResolver: unknown })._popupRedirectResolver).toBe(
      null,
    );
    expect(document.querySelectorAll('script[src*="apis.google.com"]')).toHaveLength(0);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    expect(auth.currentUser).toBeNull();
  });

  it('signInWithEmailAndPassword, réauthentification et liaison fonctionnent sans résolveur', async () => {
    const jwt = (sub: string) =>
      `${btoa('{"alg":"none"}')}.${btoa(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600, iat: 1 })).replace(/=/g, '')}.sig`;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        const body = url.includes('accounts:lookup')
          ? {
              users: [
                { localId: 'u1', email: 'a@b.test', emailVerified: true, providerUserInfo: [] },
              ],
            }
          : {
              localId: 'u1',
              email: 'a@b.test',
              idToken: jwt('u1'),
              refreshToken: 'r',
              expiresIn: '3600',
            };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const { getFirebaseAuth } = await import('./firebase-auth');
    const {
      signInWithEmailAndPassword,
      reauthenticateWithCredential,
      linkWithCredential,
      EmailAuthProvider,
    } = await import('firebase/auth');
    const auth = getFirebaseAuth();
    const cred = await signInWithEmailAndPassword(auth, 'a@b.test', 'secret-123');
    expect(cred.user.uid).toBe('u1');
    await reauthenticateWithCredential(
      cred.user,
      EmailAuthProvider.credential('a@b.test', 'secret-123'),
    );
    await linkWithCredential(cred.user, EmailAuthProvider.credential('a@b.test', 'secret-123'));
    expect(calls.every((u) => /googleapis\.com\//.test(u))).toBe(true);
    expect(calls.some((u) => /apis\.google\.com|__\/auth\/iframe/.test(u))).toBe(false);
    // Session persistée dans le même stockage que getAuth() (IndexedDB, repli localStorage)
    expect(Object.keys(localStorage).some((k) => k.startsWith('firebase:authUser:'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('retourne la même instance à chaque appel', async () => {
    const { getFirebaseAuth } = await import('./firebase-auth');
    expect(getFirebaseAuth()).toBe(getFirebaseAuth());
  });
});
