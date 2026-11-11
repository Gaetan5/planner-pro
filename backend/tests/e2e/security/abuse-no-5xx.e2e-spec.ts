import { E2eRequestInit, E2eUser, E2eWorld } from '../support/e2e-world';

/**
 * Q-2 / P7 : un cas d'abus ne doit JAMAIS produire un 5xx. Un 5xx sur une entrée hostile est un
 * bug (fuite possible de détails, déni de service, état incohérent) que le refus attendu (4xx)
 * aurait évité. Le test parcourt un catalogue d'abus sur l'application réelle (vraie base, vrai
 * Redis) et échoue sur tout statut >= 500, ou sur toute réponse qui laisserait voir une pile
 * d'appels ou un message de base de données.
 *
 * Exceptions admises (liste explicite, chacune justifiée) : aucune à ce jour.
 */
const ALLOWED_5XX: Array<{ name: string; reason: string }> = [];

interface AbuseCase {
  name: string;
  method: string;
  path: string;
  auth?: 'user' | 'none';
  body?: unknown;
  raw?: string;
  contentType?: string;
  headers?: Record<string, string>;
  cookies?: 'garbage' | 'duplicate';
}

const UUID0 = '00000000-0000-4000-8000-000000000000';
const BIG = 'A'.repeat(300_000);
const POLLUTION = '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}';

const cases = (): AbuseCase[] => [
  // Corps hostiles sur les routes publiques
  ...[
    '/auth/login',
    '/auth/register',
    '/auth/mfa/challenge',
    '/auth/password/forgot',
    '/auth/password/reset',
    '/auth/email/verify',
    '/auth/email/resend',
    '/auth/refresh',
    '/auth/firebase/login',
    '/auth/github/login',
  ].flatMap(
    (path) =>
      [
        { name: `JSON tronqué ${path}`, method: 'POST', path, raw: '{"email":' },
        { name: `corps vide ${path}`, method: 'POST', path, raw: '' },
        { name: `tableau au lieu d'objet ${path}`, method: 'POST', path, body: [1, 2, 3] },
        { name: `null ${path}`, method: 'POST', path, raw: 'null' },
        {
          name: `types inattendus ${path}`,
          method: 'POST',
          path,
          body: { email: 42, passwordRaw: {}, code: [], token: true, mfaTicket: 1 },
        },
        { name: `pollution de prototype ${path}`, method: 'POST', path, raw: POLLUTION },
        {
          name: `chaîne gigantesque ${path}`,
          method: 'POST',
          path,
          body: { email: BIG, passwordRaw: BIG, token: BIG, name: BIG },
        },
        {
          name: `type de contenu texte ${path}`,
          method: 'POST',
          path,
          raw: 'email=a&password=b',
          contentType: 'text/plain',
        },
        {
          name: `formulaire ${path}`,
          method: 'POST',
          path,
          raw: 'email=a&passwordRaw=b',
          contentType: 'application/x-www-form-urlencoded',
        },
      ] as AbuseCase[],
  ),
  {
    name: 'injection SQL dans l’e-mail',
    method: 'POST',
    path: '/auth/login',
    body: { email: "admin'--@e2e.example", passwordRaw: "' OR '1'='1' -- 1234567" },
  },
  {
    name: 'octet nul dans le mot de passe',
    method: 'POST',
    path: '/auth/login',
    body: { email: 'nul@e2e.example', passwordRaw: 'abcdefghij\u0000klm' },
  },
  {
    name: 'e-mail unicode exotique',
    method: 'POST',
    path: '/auth/login',
    body: { email: 'ａｄｍｉｎ@е2е.example', passwordRaw: 'MotDePasse!2026-e2e' },
  },
  {
    name: 'ticket MFA falsifié',
    method: 'POST',
    path: '/auth/mfa/challenge',
    body: { mfaTicket: 'a.b.c', code: '123456' },
  },
  {
    name: 'ticket MFA gigantesque',
    method: 'POST',
    path: '/auth/mfa/challenge',
    body: { mfaTicket: BIG, code: '123456' },
  },
  {
    name: 'code MFA non numérique',
    method: 'POST',
    path: '/auth/mfa/challenge',
    body: { mfaTicket: 'x', code: 'abcdef' },
  },
  {
    name: 'jeton de réinitialisation inconnu',
    method: 'POST',
    path: '/auth/password/reset',
    body: { token: 'inconnu', password: 'NouveauMotDePasse!2026' },
  },
  {
    name: 'jeton de vérification inconnu',
    method: 'POST',
    path: '/auth/email/verify',
    body: { token: 'inconnu' },
  },
  {
    name: 'cookie de rafraîchissement hostile',
    method: 'POST',
    path: '/auth/refresh',
    cookies: 'garbage',
  },
  {
    name: 'état OAuth GitHub inconnu',
    method: 'POST',
    path: '/auth/github/login',
    body: { code: 'x', state: 'inconnu' },
  },
  {
    name: 'invitation : jeton inconnu',
    method: 'POST',
    path: '/invitations/accept',
    body: { token: 'inconnu' },
  },

  // En-têtes hostiles
  {
    name: 'Authorization sans schéma',
    method: 'GET',
    path: '/projects/workspaces',
    headers: { Authorization: 'inconnu' },
  },
  {
    name: 'Authorization Bearer vide',
    method: 'GET',
    path: '/projects/workspaces',
    headers: { Authorization: 'Bearer ' },
  },
  {
    name: 'Bearer gigantesque',
    method: 'GET',
    path: '/projects/workspaces',
    headers: { Authorization: `Bearer ${'x'.repeat(8000)}` },
  },
  {
    name: 'cookie d’accès hostile',
    method: 'GET',
    path: '/projects/workspaces',
    cookies: 'garbage',
  },
  {
    name: 'cookies d’accès dupliqués',
    method: 'GET',
    path: '/projects/workspaces',
    cookies: 'duplicate',
  },
  {
    name: 'X-Forwarded-For hostile',
    method: 'POST',
    path: '/auth/password/forgot',
    headers: { 'X-Forwarded-For': "'; DROP TABLE User;--" },
    body: { email: 'a@e2e.example' },
  },
  {
    name: 'Origin hostile avec cookie',
    method: 'POST',
    path: '/auth/logout',
    cookies: 'garbage',
    headers: { Origin: 'https://evil.example' },
  },

  // Identifiants de chemin hostiles, utilisateur connecté
  ...['/projects/', '/projects/tasks/', '/projects/workspaces/', '/notes/'].flatMap((prefix) =>
    [
      ['non UUID', 'pas-un-uuid'],
      ['UUID inconnu', UUID0],
      ['traversée de chemin', '..%2F..%2Fetc%2Fpasswd'],
      ['injection SQL', '1%27%20OR%20%271%27=%271'],
      ['très long', 'a'.repeat(2000)],
    ].map(([label, id]) => ({
      name: `GET ${prefix}${label}`,
      method: 'GET',
      path: `${prefix}${id}`,
      auth: 'user' as const,
    })),
  ),
  ...[
    'PUT /projects/:id',
    'DELETE /projects/:id',
    'GET /projects/:id/tasks',
    'GET /projects/:id/members',
    'POST /projects/:id/tasks',
    'PUT /projects/tasks/:id',
    'DELETE /projects/tasks/:id',
    'GET /projects/workspaces/:id/members',
    'GET /projects/workspaces/:id/audit/logs',
    'GET /projects/workspaces/:id/integrations',
    'GET /projects/workspaces/:id/finances',
    'POST /projects/:id/webhooks/github/secret',
    'PUT /notes/:id',
    'DELETE /notes/:id',
    'DELETE /auth/sessions/:id',
  ].flatMap((route) => {
    const [method, template] = route.split(' ');
    return [UUID0, 'pas-un-uuid'].map((id) => ({
      name: `${route} avec ${id === UUID0 ? 'UUID inconnu' : 'identifiant invalide'}`,
      method,
      path: template.replace(':id', id),
      auth: 'user' as const,
      body:
        method === 'GET' || method === 'DELETE'
          ? undefined
          : { title: 't', name: 'n', content: 'c' },
    }));
  }),

  // Corps hostiles, utilisateur connecté
  {
    name: 'création de projet : types inattendus',
    method: 'POST',
    path: '/projects',
    auth: 'user',
    body: {
      name: 42,
      workspaceId: {},
      status: 'INCONNU',
      startDate: 'pas-une-date',
      budgetCents: -1,
    },
  },
  {
    name: 'création de projet : espace inconnu',
    method: 'POST',
    path: '/projects',
    auth: 'user',
    body: { name: 'x', workspaceId: UUID0 },
  },
  {
    name: 'création de projet : dates incohérentes',
    method: 'POST',
    path: '/projects',
    auth: 'user',
    body: { name: 'x', startDate: '2026-12-31', dueDate: '2020-01-01' },
  },
  {
    name: 'création de projet : nom gigantesque',
    method: 'POST',
    path: '/projects',
    auth: 'user',
    body: { name: BIG },
  },
  {
    name: 'note : contenu gigantesque',
    method: 'POST',
    path: '/notes',
    auth: 'user',
    body: { title: 't', content: 'x'.repeat(900_000) },
  },
  {
    name: 'note : types inattendus',
    method: 'POST',
    path: '/notes',
    auth: 'user',
    body: { title: [], content: {} },
  },
  {
    name: 'note : pollution de prototype',
    method: 'POST',
    path: '/notes',
    auth: 'user',
    raw: POLLUTION,
  },
  {
    name: 'corps JSON > 1 Mo',
    method: 'POST',
    path: '/notes',
    auth: 'user',
    body: { title: 't', content: 'x'.repeat(1_200_000) },
  },
  {
    name: 'attribution de rôle : rôle inconnu',
    method: 'POST',
    path: `/projects/${UUID0}/members`,
    auth: 'user',
    body: { targetUserId: UUID0, role: 'ROOT' },
  },
  {
    name: 'attribution de rôle : cible non UUID',
    method: 'POST',
    path: `/projects/${UUID0}/members`,
    auth: 'user',
    body: { targetUserId: "x'; --", role: 'MANAGER' },
  },
  {
    name: 'impersonation : motif hostile',
    method: 'POST',
    path: `/admin/users/${UUID0}/impersonate`,
    auth: 'user',
    body: { reason: BIG },
  },
  {
    name: 'administration : pagination négative',
    method: 'GET',
    path: '/admin/users?page=-1&pageSize=99999999',
    auth: 'user',
  },
  {
    name: 'rôle de plateforme inconnu',
    method: 'PATCH',
    path: `/admin/users/${UUID0}/role`,
    auth: 'user',
    body: { role: 'ROOT' },
  },
  {
    name: 'MFA : code hostile',
    method: 'POST',
    path: '/auth/mfa/confirm',
    auth: 'user',
    body: { code: { $ne: null } },
  },
  {
    name: 'MFA : désactivation sans code',
    method: 'POST',
    path: '/auth/mfa/disable',
    auth: 'user',
    body: {},
  },
  {
    name: 'liste paginée hostile',
    method: 'GET',
    path: '/projects?page=abc&limit=-5&sort=;DROP',
    auth: 'user',
  },
  {
    name: 'requête de synchronisation GitHub hostile',
    method: 'POST',
    path: '/auth/github/sync',
    auth: 'user',
    body: { repos: 'x' },
  },
  {
    name: 'intégration : URL interne (SSRF)',
    method: 'POST',
    path: `/projects/workspaces/${UUID0}/integrations`,
    auth: 'user',
    body: { type: 'GITHUB', name: 'x', url: 'http://169.254.169.254/latest/meta-data' },
  },
  {
    name: 'rappel OAuth calendrier hostile',
    method: 'POST',
    path: `/projects/workspaces/${UUID0}/calendar/oauth/callback`,
    auth: 'user',
    body: { code: BIG, state: 'x', provider: 'inconnu' },
  },

  // Champs trop longs sur ses propres ressources (la colonne est un VARCHAR(191))
  {
    name: 'projet : mise à jour avec un nom gigantesque',
    method: 'PUT',
    path: '/projects/:project',
    auth: 'user',
    body: { name: BIG },
  },
  {
    name: 'tâche : création avec un titre gigantesque',
    method: 'POST',
    path: '/projects/:project/tasks',
    auth: 'user',
    body: { title: BIG },
  },
  {
    name: 'tâche : mise à jour avec un titre gigantesque',
    method: 'PUT',
    path: '/projects/tasks/:task',
    auth: 'user',
    body: { title: BIG },
  },
  {
    name: 'sprint : création avec un nom gigantesque',
    method: 'POST',
    path: '/projects/workspaces/:ws/sprints',
    auth: 'user',
    body: { name: BIG, startDate: '2026-01-01', endDate: '2026-01-15' },
  },
  {
    name: 'note : titre gigantesque',
    method: 'POST',
    path: '/notes',
    auth: 'user',
    body: { title: BIG, content: 'c' },
  },
  {
    name: 'création de projet : description gigantesque',
    method: 'POST',
    path: '/projects',
    auth: 'user',
    body: { name: 'x', description: 'x'.repeat(900_000) },
  },

  // SCIM et webhook
  {
    name: 'SCIM : filtre hostile',
    method: 'GET',
    path: '/scim/v2/Users?filter=userName%20eq%20%22%27%20OR%201=1%22&startIndex=-1&count=999999',
    headers: { Authorization: 'Bearer inconnu' },
  },
  {
    name: 'SCIM : utilisateur non UUID',
    method: 'GET',
    path: '/scim/v2/Users/pas-un-uuid',
    headers: { Authorization: 'Bearer inconnu' },
  },
  {
    name: 'webhook : projet non UUID',
    method: 'POST',
    path: '/projects/pas-un-uuid/webhooks/github',
    raw: '{}',
    headers: { 'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}`, 'X-GitHub-Delivery': 'abcdefgh' },
  },
  {
    name: 'webhook : corps binaire',
    method: 'POST',
    path: `/projects/${UUID0}/webhooks/github`,
    raw: '\u0000\u0001\u0002�',
    headers: { 'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}`, 'X-GitHub-Delivery': 'abcdefgh' },
  },
  {
    name: 'webhook : signature gigantesque',
    method: 'POST',
    path: `/projects/${UUID0}/webhooks/github`,
    raw: '{}',
    headers: {
      'X-Hub-Signature-256': `sha256=${'f'.repeat(5000)}`,
      'X-GitHub-Delivery': 'x'.repeat(5000),
    },
  },

  // Routes inexistantes et méthodes inattendues
  { name: 'route inexistante', method: 'GET', path: '/n-importe-quoi', auth: 'user' },
  { name: 'méthode inattendue', method: 'PATCH', path: '/auth/login', auth: 'none' },
  {
    name: 'traversée de chemin brute',
    method: 'GET',
    path: '/projects/../../etc/passwd',
    auth: 'user',
  },
  {
    name: 'chemin avec encodage invalide',
    method: 'GET',
    path: '/projects/%E0%A4%A',
    auth: 'user',
  },
];

describe('Q-2 e2e : aucun cas d’abus ne produit un 5xx', () => {
  let world: E2eWorld;
  let user: E2eUser;
  let accessToken: string;
  const refs = { project: '', task: '', ws: '' };

  beforeAll(async () => {
    world = await E2eWorld.start();
    user = await world.createUser({ label: 'q2' });
    refs.ws = await world.createWorkspace(user, 'Espace Q-2');
    refs.project = await world.createProject(refs.ws, user, 'Projet Q-2');
    refs.task = await world.createTask(refs.project, user, 'Tâche Q-2');
    accessToken = (await world.login(user)).accessToken;
  });
  afterAll(async () => {
    await world?.close();
  });

  const list = cases();
  it('le catalogue est assez large pour être significatif', () => {
    expect(list.length).toBeGreaterThanOrEqual(100);
    expect(new Set(list.map((c) => c.name)).size).toBe(list.length);
  });

  it.each(list.map((c) => [c.name, c] as const))('%s', async (_name, abuse) => {
    const init: E2eRequestInit = { headers: { ...abuse.headers }, contentType: abuse.contentType };
    if (abuse.auth === 'user') init.accessToken = accessToken;
    if (abuse.cookies === 'garbage') {
      init.headers!['Cookie'] = 'accessToken=%E0%A4%A; refreshToken=;;==; foo';
    }
    if (abuse.cookies === 'duplicate') {
      init.headers!['Cookie'] = `accessToken=${accessToken}; accessToken=${accessToken}`;
    }
    if (abuse.raw !== undefined) init.raw = abuse.raw;
    else if (abuse.body !== undefined) init.body = abuse.body;
    const path = abuse.path
      .replace(':project', refs.project)
      .replace(':task', refs.task)
      .replace(':ws', refs.ws);
    const res = await world.request(abuse.method, path, init);

    const exception = ALLOWED_5XX.find((e) => e.name === abuse.name);
    if (!exception) {
      expect([abuse.name, res.status >= 500]).toEqual([abuse.name, false]);
    }
    // Jamais de détail interne dans un refus
    expect(res.text).not.toMatch(
      /\bat \S+ \(.+:\d+:\d+\)|PrismaClient|ER_[A-Z_]+|SQLSTATE|node_modules/,
    );
  });

  it('chaque exception admise est justifiée', () => {
    for (const e of ALLOWED_5XX) expect(e.reason.length).toBeGreaterThan(20);
  });
});
