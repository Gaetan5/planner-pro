import { createHash, createHmac, randomUUID } from 'crypto';
import { encrypt } from '../../../src/auth/encryption.util';
import { E2eUser, E2eWorld } from '../support/e2e-world';

/**
 * P7 / webhook GitHub (S21) et SCIM (S11) : signature absente, invalide ou calculée sur un autre
 * corps ; rejeu ; charge utile surdimensionnée ; refus répétés ; clé SCIM absente, inconnue,
 * révoquée, expirée ou d'un autre espace ; 429 par clé au format SCIM.
 */
describe('P7 e2e : webhook GitHub et SCIM', () => {
  let world: E2eWorld;
  beforeAll(async () => {
    world = await E2eWorld.start();
  });
  afterAll(async () => {
    delete process.env.FEATURE_SCIM_ENABLED;
    await world?.close();
  });

  describe('webhook GitHub', () => {
    const SECRET = 'a'.repeat(64);
    const REPO = 'org/depot-e2e';
    let owner: E2eUser;
    let projectId: string;
    let taskId: string;

    beforeAll(async () => {
      owner = await world.createUser({ label: 'hook' });
      const ws = await world.createWorkspace(owner, 'Espace webhook');
      projectId = await world.createProject(ws, owner, 'Projet webhook');
      await world.prisma.project.update({
        where: { id: projectId },
        data: { githubRepo: REPO, githubWebhookSecret: encrypt(SECRET) },
      });
      taskId = await world.createTask(projectId, owner, 'Tâche à clore');
    });

    const sign = (body: string | Buffer, secret = SECRET) =>
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const payload = (id = taskId, repo = REPO) =>
      JSON.stringify({ repository: { full_name: repo }, commits: [{ message: `fixes #${id}` }] });
    const deliver = (
      body: string | Buffer,
      opts: {
        signature?: string | null;
        delivery?: string | null;
        ip?: string;
        project?: string;
      } = {},
    ) => {
      const headers: Record<string, string> = {};
      const signature = opts.signature === undefined ? sign(body) : opts.signature;
      if (signature) headers['X-Hub-Signature-256'] = signature;
      const delivery = opts.delivery === undefined ? `d-${randomUUID()}` : opts.delivery;
      if (delivery) headers['X-GitHub-Delivery'] = delivery;
      return world.request('POST', `/projects/${opts.project ?? projectId}/webhooks/github`, {
        ip: opts.ip,
        headers,
        raw: body,
        contentType: 'application/json',
      });
    };
    const taskStatus = async () =>
      (await world.prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status;

    it('livraison valide : la tâche citée est close ; la même livraison rejouée est ignorée', async () => {
      const body = payload();
      const delivery = `ok-${randomUUID()}`;
      const first = await deliver(body, { delivery });
      expect(first.status).toBe(201);
      expect(first.body.closedTaskIds).toEqual([taskId]);
      expect(await taskStatus()).toBe('DONE');

      // Rejeu : même identifiant de livraison, même signature. La tâche rouverte ne doit pas être reclose.
      await world.prisma.task.update({ where: { id: taskId }, data: { status: 'TODO' } });
      const replay = await deliver(body, { delivery });
      expect(replay.status).toBe(201);
      expect(replay.body.closedTaskIds).toEqual([]);
      expect(await taskStatus()).toBe('TODO');
    });

    it('signature absente, mal formée, d’un autre secret ou calculée sur un autre corps : 401, rien n’est clos', async () => {
      await world.prisma.task.update({ where: { id: taskId }, data: { status: 'TODO' } });
      const body = payload();
      const attempts: Array<[string, string | null]> = [
        ['absente', null],
        ['sans préfixe', createHmac('sha256', SECRET).update(body).digest('hex')],
        ['mal formée', 'sha256=zz'],
        ['autre secret', sign(body, 'b'.repeat(64))],
        ['autre corps', sign(payload(randomUUID()))],
        ['sha1', `sha1=${'0'.repeat(40)}`],
      ];
      for (const [label, signature] of attempts) {
        const res = await deliver(body, { signature, ip: world.nextIp() });
        expect([label, res.status]).toEqual([label, 401]);
      }
      expect(await taskStatus()).toBe('TODO');
    });

    it('identifiant de livraison absent ou invalide, dépôt différent, projet inconnu : 401 indiscernables', async () => {
      const body = payload();
      const wrongRepo = payload(taskId, 'autre/depot');
      const results = [
        await deliver(body, { delivery: null, ip: world.nextIp() }),
        await deliver(body, { delivery: 'a b', ip: world.nextIp() }),
        await deliver(wrongRepo, { ip: world.nextIp() }),
        await deliver(body, { project: randomUUID(), ip: world.nextIp() }),
      ];
      for (const res of results) expect(res.status).toBe(401);
      expect(new Set(results.map((r) => r.text)).size).toBe(1);
      expect(await taskStatus()).toBe('TODO');
    });

    it('corps JSON invalide mais correctement signé : 400 (jamais 5xx)', async () => {
      const body = '{pas du json';
      const res = await deliver(body, { ip: world.nextIp() });
      expect(res.status).toBe(400);
    });

    it('charge surdimensionnée (> 2 Mo) : 413 sans lecture complète', async () => {
      const body = Buffer.alloc(2 * 1024 * 1024 + 4096, 0x61);
      const res = await deliver(body, { ip: world.nextIp() });
      expect(res.status).toBe(413);
    });

    it('au-delà de 20 refus par minute pour une adresse et un projet : 429, y compris pour une livraison valide', async () => {
      const ip = world.nextIp();
      const body = payload();
      for (let i = 0; i < 21; i++)
        await deliver(body, { signature: 'sha256=' + '0'.repeat(64), ip });
      const blocked = await deliver(body, { ip });
      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toBe('Trop de requêtes refusées.');
      // Les livraisons légitimes d'une autre adresse ne sont pas touchées
      await world.prisma.task.update({ where: { id: taskId }, data: { status: 'TODO' } });
      const other = await deliver(body, { ip: world.nextIp() });
      expect(other.status).toBe(201);
    });

    it('ancienne route à secret global : 410', async () => {
      const res = await world.request('POST', '/projects/webhooks/github', { body: {} });
      expect(res.status).toBe(410);
    });
  });

  describe('SCIM', () => {
    const tokenA = `scim_live_${randomUUID().replace(/-/g, '')}`;
    let wsA: string;
    let wsB: string;
    let userB: E2eUser;

    const hash = (t: string) => createHash('sha256').update(t).digest('hex');
    const scim = (method: string, path: string, token?: string, body?: unknown, ip?: string) =>
      world.request(method, path, {
        ip,
        headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
        raw:
          body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        contentType: 'application/scim+json',
      });

    beforeAll(async () => {
      process.env.FEATURE_SCIM_ENABLED = 'true';
      const ownerA = await world.createUser({ label: 'scimA' });
      const ownerB = await world.createUser({ label: 'scimB' });
      userB = await world.createUser({ label: 'victimeB' });
      wsA = await world.createWorkspace(ownerA, 'Espace SCIM A');
      wsB = await world.createWorkspace(ownerB, 'Espace SCIM B');
      await world.addMember(wsB, userB, 'MEMBER');
      await world.prisma.sCIMApiKey.create({
        data: { workspaceId: wsA, name: 'clé A', tokenHash: hash(tokenA) },
      });
    });

    it('clé absente, inconnue, révoquée ou expirée : 401 au format SCIM', async () => {
      const revoked = `scim_live_${randomUUID()}`;
      const expired = `scim_live_${randomUUID()}`;
      await world.prisma.sCIMApiKey.createMany({
        data: [
          { workspaceId: wsA, name: 'révoquée', tokenHash: hash(revoked), revokedAt: new Date() },
          {
            workspaceId: wsA,
            name: 'expirée',
            tokenHash: hash(expired),
            expiresAt: new Date(Date.now() - 1000),
          },
        ],
      });
      for (const token of [undefined, '', 'scim_live_inconnue', revoked, expired]) {
        const res = await scim('GET', '/scim/v2/Users', token);
        expect([token, res.status]).toEqual([token, 401]);
        expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
        expect(res.headers.get('content-type')).toMatch(/scim\+json/);
      }
      // Clé valide : accès
      expect((await scim('GET', '/scim/v2/Users', tokenA)).status).toBe(200);
    });

    it('une clé de l’espace A ne voit ni ne modifie les comptes de l’espace B', async () => {
      const read = await scim('GET', `/scim/v2/Users/${userB.id}`, tokenA);
      expect(read.status).toBe(404);
      const list = await scim('GET', '/scim/v2/Users', tokenA);
      expect(list.text).not.toContain(userB.email);
      const del = await scim('DELETE', `/scim/v2/Users/${userB.id}`, tokenA);
      expect([403, 404]).toContain(del.status);
      expect(
        await world.prisma.membership.count({ where: { workspaceId: wsB, userId: userB.id } }),
      ).toBe(1);
    });

    it('charge SCIM surdimensionnée (> 1 Mo) : 413', async () => {
      const big = JSON.stringify({ schemas: [], userName: 'x'.repeat(1024 * 1024 + 1024) });
      const res = await scim('POST', '/scim/v2/Users', tokenA, big);
      expect(res.status).toBe(413);
    });

    it('JSON SCIM malformé : 400, jamais 5xx', async () => {
      const res = await scim('POST', '/scim/v2/Users', tokenA, '{"userName":');
      expect(res.status).toBe(400);
    });

    it('N3 : PATCH et PUT SCIM avec une valeur démesurée : 400 au format SCIM (invalidValue), jamais 5xx, nom inchangé', async () => {
      const owner = await world.createUser({ label: 'scimN3' });
      const ws = await world.createWorkspace(owner, 'Espace SCIM N3');
      const key = `scim_live_${randomUUID().replace(/-/g, '')}`;
      await world.prisma.sCIMApiKey.create({
        data: { workspaceId: ws, name: 'clé N3', tokenHash: hash(key) },
      });
      // Domaine vérifié : seul moyen de provisionner un compte par SCIM (S10/S11)
      const domain = `n3-${randomUUID().slice(0, 8)}.example`;
      await world.prisma.sSOConfiguration.create({
        data: { workspaceId: ws, domain, verifiedDomain: domain },
      });
      const created = await scim('POST', '/scim/v2/Users', key, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `n3@${domain}`,
        displayName: 'Nom initial',
        active: true,
      });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      const patch = (operation: Record<string, unknown>) =>
        scim('PATCH', `/scim/v2/Users/${id}`, key, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [operation],
        });
      const expectInvalid = (res: { status: number; body: Record<string, unknown> }) => {
        expect(res.status).toBe(400);
        expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
        expect(res.body.scimType).toBe('invalidValue');
      };

      const big = 'x'.repeat(300_000);
      expectInvalid(await patch({ op: 'replace', path: 'displayName', value: big }));
      expectInvalid(await patch({ op: 'replace', value: { displayName: big } }));
      expectInvalid(await patch({ op: 'replace', path: 'displayName', value: 'y'.repeat(192) }));
      expectInvalid(
        await patch({
          op: 'replace',
          path: 'displayName',
          value: ['y'.repeat(100), 'z'.repeat(100)],
        }),
      );
      expectInvalid(await patch({ op: 'replace', path: 'userName', value: big }));
      expectInvalid(await patch({ op: 'replace', path: 'emails', value: [{ value: big }] }));
      // Création et remplacement : 192 caractères dépassent la colonne VARCHAR(191)
      const long = 'n'.repeat(192);
      expectInvalid(
        await scim('POST', '/scim/v2/Users', key, { userName: `n3b@${domain}`, displayName: long }),
      );
      expectInvalid(
        await scim('PUT', `/scim/v2/Users/${id}`, key, {
          userName: `n3@${domain}`,
          displayName: long,
        }),
      );
      expect((await world.prisma.user.findUniqueOrThrow({ where: { id } })).name).toBe(
        'Nom initial',
      );

      // Limite exacte : 191 caractères, y compris non ASCII, acceptés
      const exact = 'é'.repeat(191);
      const ok = await patch({ op: 'replace', path: 'displayName', value: exact });
      expect(ok.status).toBe(200);
      expect((await world.prisma.user.findUniqueOrThrow({ where: { id } })).name).toBe(exact);
    });

    it('r53-m1 : PATCH remove de displayName : 400 SCIM mutability, nom inchangé en base', async () => {
      const owner = await world.createUser({ label: 'scimM1' });
      const ws = await world.createWorkspace(owner, 'Espace SCIM m1');
      const key = `scim_live_${randomUUID().replace(/-/g, '')}`;
      await world.prisma.sCIMApiKey.create({
        data: { workspaceId: ws, name: 'clé m1', tokenHash: hash(key) },
      });
      const domain = `m1-${randomUUID().slice(0, 8)}.example`;
      await world.prisma.sSOConfiguration.create({
        data: { workspaceId: ws, domain, verifiedDomain: domain },
      });
      const created = await scim('POST', '/scim/v2/Users', key, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `m1@${domain}`,
        displayName: 'Nom à conserver',
        active: true,
      });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      for (const operation of [
        { op: 'remove', path: 'displayName' },
        { op: 'Remove', path: 'DisplayName' },
        { op: 'remove', value: { displayName: 'x' } },
      ]) {
        const res = await scim('PATCH', `/scim/v2/Users/${id}`, key, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [operation],
        });
        expect(res.status).toBe(400);
        expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
        expect(res.body.scimType).toBe('mutability');
      }
      expect((await world.prisma.user.findUniqueOrThrow({ where: { id } })).name).toBe(
        'Nom à conserver',
      );
    });

    it('r54-m1 : PATCH active : remove, valeur absente ou non booléenne refusés (400), membership conservée ; formats Entra et Okta acceptés', async () => {
      const owner = await world.createUser({ label: 'scimA1' });
      const ws = await world.createWorkspace(owner, 'Espace SCIM active');
      const key = `scim_live_${randomUUID().replace(/-/g, '')}`;
      await world.prisma.sCIMApiKey.create({
        data: { workspaceId: ws, name: 'clé active', tokenHash: hash(key) },
      });
      const domain = `act-${randomUUID().slice(0, 8)}.example`;
      await world.prisma.sSOConfiguration.create({
        data: { workspaceId: ws, domain, verifiedDomain: domain },
      });
      const created = await scim('POST', '/scim/v2/Users', key, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `act@${domain}`,
        displayName: 'Nom actif',
        active: true,
      });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      const send = (operation: Record<string, unknown>) =>
        scim('PATCH', `/scim/v2/Users/${id}`, key, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [operation],
        });
      const isMember = async () =>
        (await world.prisma.membership.count({ where: { workspaceId: ws, userId: id } })) === 1;

      const refused: Array<[Record<string, unknown>, string]> = [
        [{ op: 'remove', path: 'active' }, 'mutability'],
        [{ op: 'Remove', path: 'Active' }, 'mutability'],
        [{ op: 'remove', value: { active: false } }, 'mutability'],
        [{ op: 'replace', path: 'active' }, 'invalidValue'],
        [{ op: 'add', path: 'active' }, 'invalidValue'],
        [{ op: 'replace', path: 'active', value: null }, 'invalidValue'],
        [{ op: 'replace', path: 'active', value: 'yes' }, 'invalidValue'],
        [{ op: 'replace', path: 'active', value: 0 }, 'invalidValue'],
        [{ op: 'replace', value: { active: 'oui' } }, 'invalidValue'],
      ];
      for (const [operation, scimType] of refused) {
        const res = await send(operation);
        expect(res.status).toBe(400);
        expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
        expect(res.body.scimType).toBe(scimType);
        expect(await isMember()).toBe(true);
      }

      // Formats réellement émis par Entra ID (chaîne « False ») et Okta (objet sans chemin)
      expect((await send({ op: 'Replace', path: 'active', value: 'False' })).status).toBe(200);
      expect(await isMember()).toBe(false);
      expect((await send({ op: 'Replace', path: 'active', value: 'True' })).status).toBe(200);
      expect(await isMember()).toBe(true);
      expect((await send({ op: 'replace', value: { active: false } })).status).toBe(200);
      expect(await isMember()).toBe(false);
      expect((await send({ op: 'replace', path: 'active', value: true })).status).toBe(200);
      expect(await isMember()).toBe(true);
    });

    it('r54-a1 : PATCH replace de displayName vide ou blanc : 400 invalidValue, nom inchangé', async () => {
      const owner = await world.createUser({ label: 'scimA2' });
      const ws = await world.createWorkspace(owner, 'Espace SCIM nom vide');
      const key = `scim_live_${randomUUID().replace(/-/g, '')}`;
      await world.prisma.sCIMApiKey.create({
        data: { workspaceId: ws, name: 'clé nom vide', tokenHash: hash(key) },
      });
      const domain = `vide-${randomUUID().slice(0, 8)}.example`;
      await world.prisma.sSOConfiguration.create({
        data: { workspaceId: ws, domain, verifiedDomain: domain },
      });
      const created = await scim('POST', '/scim/v2/Users', key, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `vide@${domain}`,
        displayName: 'Nom à conserver',
        active: true,
      });
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      for (const operation of [
        { op: 'replace', path: 'displayName', value: '' },
        { op: 'replace', path: 'displayName', value: '   ' },
        { op: 'replace', value: { displayName: '' } },
        { op: 'replace', value: { displayName: ' \t ' } },
      ]) {
        const res = await scim('PATCH', `/scim/v2/Users/${id}`, key, {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [operation],
        });
        expect(res.status).toBe(400);
        expect(res.body.scimType).toBe('invalidValue');
      }
      expect((await world.prisma.user.findUniqueOrThrow({ where: { id } })).name).toBe(
        'Nom à conserver',
      );
    });

    it('300 requêtes par minute et par clé, la suivante reçoit un 429 SCIM en français avec Retry-After', async () => {
      const key = `scim_live_${randomUUID().replace(/-/g, '')}`;
      await world.prisma.sCIMApiKey.create({
        data: { workspaceId: wsA, name: 'clé débit', tokenHash: hash(key) },
      });
      const ok: number[] = [];
      for (let i = 0; i < 300; i++) {
        ok.push(
          (await scim('GET', '/scim/v2/Users?count=1', key, undefined, world.nextIp())).status,
        );
      }
      expect(new Set(ok)).toEqual(new Set([200]));
      const limited = await scim('GET', '/scim/v2/Users?count=1', key, undefined, world.nextIp());
      expect(limited.status).toBe(429);
      expect(limited.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
      expect(limited.body.status).toBe('429');
      expect(limited.body.detail).toBe('Trop de requêtes. Réessayez dans quelques instants.');
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      // Une autre clé n'est pas affectée
      expect(
        (await scim('GET', '/scim/v2/Users?count=1', tokenA, undefined, world.nextIp())).status,
      ).toBe(200);
    });
  });
});
