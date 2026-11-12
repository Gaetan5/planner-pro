import { createHash, createHmac, randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { encrypt } from '../../../src/auth/encryption.util';
import { E2eResponse, E2eWorld } from '../support/e2e-world';

/**
 * A9-b0 : caractérisation du comportement HTTP de l'API sur la pile actuelle (NestJS 10, Express 4),
 * avec le câblage réel de `main.ts` (`configureHttpApp` : Helmet, CORS, no-store, analyseurs de
 * corps). Ces tests doivent rester verts, sans modification, après A9-b2 (NestJS 11, Express 5) :
 * R2 (webhook : casse et barre finale), R6 (limites et corps brut), R9 (requête à clé imbriquée),
 * R11 (en-têtes Helmet, CORS, no-store). L'instantané complet est comparé à
 * `a9b0-http-snapshot.reference.json` (régénération voulue : `A9B0_WRITE_SNAPSHOT=1`, diff à relire).
 */
const SNAPSHOT = join(__dirname, 'a9b0-http-snapshot.reference.json');
const ORIGIN = 'http://localhost:3000';
const EVIL = 'https://evil.example';
const MB = 1024 * 1024;

const HELMET_HEADERS = [
  'content-security-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'origin-agent-cluster',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-dns-prefetch-control',
  'x-download-options',
  'x-frame-options',
  'x-permitted-cross-domain-policies',
  'x-xss-protection',
];

/** Valeurs volatiles remplacées avant comparaison ; `Retry-After` est vérifié à part. */
function normalizeHeaders(res: E2eResponse): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    if (name === 'date') out[name] = '<date>';
    else if (name === 'etag') out[name] = '<etag>';
    else if (name === 'x-ratelimit-reset' || name === 'retry-after') out[name] = '<n>';
    else out[name] = value;
  });
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

describe('A9-b0 e2e : caractérisation HTTP (en-têtes, limites de corps, webhook)', () => {
  let world: E2eWorld;
  const SECRET = 'c'.repeat(64);
  const REPO = 'org/depot-a9b0';
  let projectId: string;
  let workspaceId: string;
  /**
   * Variables fixées pour un instantané reproductible : le chargement d'un `.env` local par
   * `ConfigModule` (dotenv ne remplace pas une variable déjà définie) ne doit rien changer.
   */
  const PINNED_ENV: Record<string, string> = {
    CORS_ORIGINS: ORIGIN,
    FEATURE_SCIM_ENABLED: 'true',
    FEATURE_SSO_ENABLED: 'false',
    FEATURE_IMPERSONATION_ENABLED: 'false',
  };
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [name, value] of Object.entries(PINNED_ENV)) {
      previousEnv[name] = process.env[name];
      process.env[name] = value;
    }
    world = await E2eWorld.start();
    const owner = await world.createUser({ label: 'a9b0' });
    const ws = await world.createWorkspace(owner, 'Espace A9-b0');
    workspaceId = ws;
    projectId = await world.createProject(ws, owner, 'Projet A9-b0');
    await world.prisma.project.update({
      where: { id: projectId },
      data: { githubRepo: REPO, githubWebhookSecret: encrypt(SECRET) },
    });
  });
  afterAll(async () => {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await world?.close();
  });

  const sign = (body: string | Buffer, secret = SECRET) =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const harmless = (padding = 0) =>
    JSON.stringify({
      repository: { full_name: REPO },
      commits: [{ message: 'rien à clore' + ' '.repeat(padding) }],
    });
  const deliverTo = (
    path: string,
    body: string | Buffer,
    opts: { signature?: string; ip?: string } = {},
  ) =>
    world.request('POST', path, {
      ip: opts.ip,
      headers: {
        'X-Hub-Signature-256': opts.signature ?? sign(body),
        'X-GitHub-Delivery': `d-${randomUUID()}`,
      },
      raw: body,
      contentType: 'application/json',
    });

  /** Trois écritures de la même route : le routage et l'expression de plafond doivent s'accorder. */
  const forms = () => [
    ['minuscules', `/projects/${projectId}/webhooks/github`],
    ['barre finale', `/projects/${projectId}/webhooks/github/`],
    ['casse mêlée et barre finale', `/Projects/${projectId}/WEBHOOKS/GitHub/`],
  ];

  describe('R11 : en-têtes de l’API (câblage réel)', () => {
    it('Helmet : tous les en-têtes par défaut présents, aucun X-Powered-By, sur 200, 401 et 404', async () => {
      const responses = [
        await world.request('GET', '/features'),
        await world.request('GET', '/projects/workspaces'),
        await world.request('GET', `/route-inconnue-${randomUUID()}`),
      ];
      expect(responses.map((r) => r.status)).toEqual([200, 401, 404]);
      for (const res of responses) {
        for (const name of HELMET_HEADERS)
          expect([name, res.headers.has(name)]).toEqual([name, true]);
        expect(res.headers.has('x-powered-by')).toBe(false);
        expect(res.headers.get('x-xss-protection')).toBe('0');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
        expect(res.headers.get('strict-transport-security')).toMatch(/^max-age=\d+/);
        expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
      }
    });

    it('Cache-Control: no-store sur /auth, /admin et le secret du webhook, y compris en erreur ; absent ailleurs', async () => {
      const protectedPaths: Array<[string, string]> = [
        ['GET', '/auth/sessions'],
        ['GET', '/admin/health'],
        ['POST', `/projects/${projectId}/webhooks/github/secret`],
        ['POST', `/Projects/${projectId}/Webhooks/GitHub/Secret/`],
      ];
      for (const [method, path] of protectedPaths) {
        const res = await world.request(method, path);
        expect([path, res.status]).toEqual([path, 401]);
        expect([path, res.headers.get('cache-control')]).toEqual([path, 'no-store']);
        expect([path, res.headers.get('pragma')]).toEqual([path, 'no-cache']);
      }
      expect((await world.request('GET', '/features')).headers.get('cache-control')).not.toBe(
        'no-store',
      );
    });

    it('CORS : origine autorisée reflétée avec credentials ; origine inconnue sans en-tête CORS', async () => {
      const allowed = await world.request('OPTIONS', '/auth/login', {
        headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
      });
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(allowed.headers.get('access-control-allow-credentials')).toBe('true');
      expect(allowed.headers.get('access-control-allow-methods')).toContain('POST');
      expect(allowed.headers.get('vary')).toMatch(/Origin/i);

      const simple = await world.request('GET', '/features', { headers: { Origin: ORIGIN } });
      expect(simple.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(simple.headers.get('access-control-allow-credentials')).toBe('true');

      const denied = await world.request('OPTIONS', '/auth/login', {
        headers: { Origin: EVIL, 'Access-Control-Request-Method': 'POST' },
      });
      expect(denied.headers.has('access-control-allow-origin')).toBe(false);
      // `Access-Control-Allow-Credentials: true` accompagne toute réponse (cors 2.8), sans effet
      // sans `Access-Control-Allow-Origin` : le navigateur refuse la lecture. Figé par l'instantané.
      const deniedSimple = await world.request('GET', '/features', { headers: { Origin: EVIL } });
      expect(deniedSimple.headers.has('access-control-allow-origin')).toBe(false);
    });

    it('instantané complet (statut, en-têtes normalisés, corps) comparé à la référence', async () => {
      const snapshot: Record<string, unknown> = {};
      const record = (name: string, res: E2eResponse) => {
        snapshot[name] = {
          status: res.status,
          headers: normalizeHeaders(res),
          body: res.body,
        };
      };
      record('GET /features', await world.request('GET', '/features'));
      record(
        'GET /projects/workspaces sans jeton',
        await world.request('GET', '/projects/workspaces'),
      );
      record('GET route inconnue', await world.request('GET', '/route-inconnue'));
      record('GET /auth/sessions sans jeton', await world.request('GET', '/auth/sessions'));
      record('GET /admin/health sans jeton', await world.request('GET', '/admin/health'));
      record(
        'POST secret du webhook sans jeton',
        await world.request('POST', `/projects/${projectId}/webhooks/github/secret`),
      );
      record(
        'OPTIONS origine autorisée',
        await world.request('OPTIONS', '/auth/login', {
          headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' },
        }),
      );
      record(
        'OPTIONS origine inconnue',
        await world.request('OPTIONS', '/auth/login', {
          headers: { Origin: EVIL, 'Access-Control-Request-Method': 'POST' },
        }),
      );
      record('GET SCIM sans clé', await world.request('GET', '/scim/v2/Users'));
      record(
        'webhook non signé',
        await world.request('POST', `/projects/${projectId}/webhooks/github`, {
          body: { repository: { full_name: REPO } },
        }),
      );
      record(
        'webhook signé',
        await deliverTo(`/projects/${projectId}/webhooks/github`, harmless()),
      );
      record(
        'JSON de 1,2 Mo',
        await world.request('POST', '/auth/login', {
          raw: JSON.stringify({ x: 'a'.repeat(1.2 * MB) }),
        }),
      );
      record(
        'JSON mal formé',
        await world.request('POST', '/auth/login', {
          raw: '{"email":',
          contentType: 'application/json',
        }),
      );
      const ip = world.nextIp();
      let limited: E2eResponse | undefined;
      for (let i = 0; i < 6; i++) {
        limited = await world.request('POST', '/auth/login', {
          ip,
          body: { email: `snap-${i}@e2e.example`, passwordRaw: 'MauvaisMotDePasse!1' },
        });
      }
      record('POST /auth/login, 6e échec : 429', limited!);

      if (process.env.A9B0_WRITE_SNAPSHOT === '1') {
        writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');
      }
      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(
        JSON.parse(readFileSync(SNAPSHOT, 'utf8')),
      );
    });
  });

  describe('R2 : webhook GitHub, mêmes résultats sur les trois formes de chemin', () => {
    it('livraison signée valide : 201 sur les trois formes', async () => {
      for (const [label, path] of forms()) {
        const res = await deliverTo(path, harmless());
        expect([label, res.status, res.body.closedTaskIds]).toEqual([label, 201, []]);
      }
    });

    it('corps de 1,5 Mo signé : accepté (201) sur les trois formes (plafond dédié de 2 Mo)', async () => {
      const body = harmless(1.5 * MB);
      expect(Buffer.byteLength(body)).toBeGreaterThan(1.4 * MB);
      for (const [label, path] of forms()) {
        const res = await deliverTo(path, body);
        expect([label, res.status]).toEqual([label, 201]);
      }
    });

    it('corps de 2,5 Mo : 413 sur les trois formes', async () => {
      const body = Buffer.alloc(2.5 * MB, 0x61);
      for (const [label, path] of forms()) {
        const res = await deliverTo(path, body, { ip: world.nextIp() });
        expect([label, res.status]).toEqual([label, 413]);
      }
    });

    it('signature altérée : 401 sur les trois formes', async () => {
      for (const [label, path] of forms()) {
        const res = await deliverTo(path, harmless(), {
          signature: sign(harmless(), 'd'.repeat(64)),
          ip: world.nextIp(),
        });
        expect([label, res.status]).toEqual([label, 401]);
      }
    });

    it('refus répétés : le 429 du pré-contrôle est identique sur les trois formes', async () => {
      const results: Array<[string, number, unknown]> = [];
      for (const [label, path] of forms()) {
        const ip = world.nextIp();
        for (let i = 0; i < 21; i++) {
          await deliverTo(path, harmless(), { signature: 'sha256=' + '0'.repeat(64), ip });
        }
        const blocked = await deliverTo(path, harmless(), { ip });
        results.push([label, blocked.status, blocked.body]);
      }
      for (const [label, status, body] of results) {
        expect([label, status, body]).toEqual([
          label,
          429,
          { statusCode: 429, message: 'Trop de requêtes refusées.' },
        ]);
      }
    });
  });

  describe('R6 : analyseurs de corps', () => {
    it('corps brut conservé : signature valide sur les octets reçus acceptée, signature d’un corps ré-sérialisé refusée', async () => {
      const compact = harmless();
      const pretty = JSON.stringify(JSON.parse(compact), null, 4);
      expect(pretty).not.toBe(compact);
      const accepted = await deliverTo(`/projects/${projectId}/webhooks/github`, pretty, {
        signature: sign(pretty),
      });
      expect(accepted.status).toBe(201);
      const refused = await deliverTo(`/projects/${projectId}/webhooks/github`, pretty, {
        signature: sign(compact),
        ip: world.nextIp(),
      });
      expect(refused.status).toBe(401);
    });

    it('JSON : 413 au-delà de 1 Mo, accepté (analysé, refus de validation) en dessous', async () => {
      const over = await world.request('POST', '/auth/login', {
        raw: JSON.stringify({ x: 'a'.repeat(1.2 * MB) }),
      });
      expect(over.status).toBe(413);
      const under = await world.request('POST', '/auth/login', {
        raw: JSON.stringify({ email: 'a'.repeat(0.9 * MB) }),
      });
      expect([400, 401]).toContain(under.status);
    });

    it('JSON mal formé : 400 ; POST sans corps sur une route à DTO : 400, jamais 5xx', async () => {
      const malformed = await world.request('POST', '/auth/login', {
        raw: '{"email":',
        contentType: 'application/json',
      });
      expect(malformed.status).toBe(400);
      const empty = await world.request('POST', '/auth/login');
      expect(empty.status).toBe(400);
      const emptyJson = await world.request('POST', '/auth/login', {
        raw: '',
        contentType: 'application/json',
      });
      expect(emptyJson.status).toBe(400);
    });

    it('application/scim+json analysé comme du JSON : corps valide transmis au service, corps mal formé 400', async () => {
      const token = `scim_live_${randomUUID().replace(/-/g, '')}`;
      await world.prisma.sCIMApiKey.create({
        data: {
          workspaceId,
          name: 'clé A9-b0',
          tokenHash: createHash('sha256').update(token).digest('hex'),
        },
      });
      const scim = (raw: string, ip = world.nextIp()) =>
        world.request('POST', '/scim/v2/Users', {
          ip,
          raw,
          contentType: 'application/scim+json',
          headers: { Authorization: `Bearer ${token}` },
        });
      const malformed = await scim('{"userName":');
      expect(malformed.status).toBe(400);
      expect(malformed.body.schemas).toBeUndefined();
      const created = await scim(
        JSON.stringify({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: `a9b0-${randomUUID()}@e2e.example`,
          active: true,
        }),
      );
      // Le corps valide est analysé et atteint le service (refus métier : domaine non vérifié)
      expect(created.status).toBe(403);
      expect(created.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
      expect(created.body.scimType).toBe('invalidValue');
    });
  });

  describe('R9 : clés imbriquées dans la requête', () => {
    it('?a[b]=1 sur une route à DTO de requête : 400', async () => {
      const res = await world.request('GET', '/auth/github/authorize?a[b]=1');
      expect(res.status).toBe(400);
      const flat = await world.request('GET', '/auth/github/authorize?a=1');
      expect(flat.status).toBe(400);
    });
  });
});
