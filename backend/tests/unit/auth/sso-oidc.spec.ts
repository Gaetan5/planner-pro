import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'crypto';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  exportSPKI,
  generateKeyPair,
  JWK,
  JWTVerifyGetKey,
} from 'jose';
import { PrismaClient } from '@prisma/client';
import { runLegacySsoUidReset } from '../../../scripts/reset-legacy-sso-uids';
import { AuthService } from '../../../src/auth/auth.service';
import { decrypt, encrypt } from '../../../src/auth/encryption.util';
import { DomainVerifier, OidcKeySource } from '../../../src/auth/sso/oidc';
import { ConfigureSsoDto } from '../../../src/auth/sso/sso.dto';
import { SsoService } from '../../../src/auth/sso/sso.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';
import { FakePrisma } from '../../http/fake-prisma';
import { FakeRedisService } from '../../http/fake-redis';

jest.setTimeout(30_000);

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const CLIENT_ID = 'client-acme';

/** S10 : validation OIDC complète, state/nonce/PKCE, domaine prouvé, liaison, rôle borné, secret chiffré. */
describe('S10 : SSO OIDC', () => {
  const savedEnv = { ...process.env };
  let service: SsoService;
  let prisma: FakePrisma;
  let redis: FakeRedisService;
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  let otherPrivateKey: CryptoKey;
  let jwks: JWTVerifyGetKey;
  let fetchSpy: jest.SpyInstance;
  const authService = { completeLogin: jest.fn() };
  const dns = { hasVerificationToken: jest.fn() };
  const keySource = { getKeys: jest.fn() };

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    otherPrivateKey = other.privateKey;
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    jwks = createLocalJWKSet({ keys: [jwk] });
  });

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    process.env.FRONTEND_URL = 'https://app.planner.test';
    prisma = new FakePrisma();
    redis = new FakeRedisService();
    jest.clearAllMocks();
    keySource.getKeys.mockImplementation(() => jwks);
    authService.completeLogin.mockImplementation(async (user: unknown) => ({
      user,
      session: { accessToken: 'a' },
    }));
    const module = await Test.createTestingModule({
      providers: [
        SsoService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: AuthService, useValue: authService },
        { provide: OidcKeySource, useValue: keySource },
        { provide: DomainVerifier, useValue: dns },
      ],
    }).compile();
    service = module.get(SsoService);
    await seedConfig();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    fetchSpy?.mockRestore();
  });

  const seedConfig = (overrides: Record<string, unknown> = {}) =>
    prisma.sSOConfiguration.create({
      data: {
        workspaceId: 'ws-1',
        provider: 'OIDC_AZURE_AD',
        domain: 'acme.com',
        verifiedDomain: 'acme.com',
        clientId: CLIENT_ID,
        clientSecret: encrypt('s3cret'),
        issuer: TENANT,
        enabled: true,
        domainVerifiedAt: new Date(),
        domainVerificationToken: 'tok',
        ...overrides,
      },
    });

  const sign = async (
    claims: Record<string, unknown>,
    options: {
      key?: CryptoKey;
      iss?: string;
      aud?: string;
      exp?: string | number;
      alg?: string;
      kid?: string;
      omitIat?: boolean;
    } = {},
  ) => {
    const jwt = new SignJWT({
      tid: TENANT,
      oid: 'oid-1',
      email: 'ada@acme.com',
      name: 'Ada',
      ...claims,
    })
      .setProtectedHeader({ alg: (options.alg ?? 'RS256') as 'RS256', kid: options.kid ?? 'k1' })
      .setIssuer(options.iss ?? ISSUER)
      .setAudience(options.aud ?? CLIENT_ID)
      .setExpirationTime(options.exp ?? '5m');
    if (!options.omitIat) jwt.setIssuedAt();
    return jwt.sign(options.key ?? privateKey);
  };

  /** Démarre le flux et renvoie le state, le nonce et l'URL. */
  const start = async () => {
    const { url, state } = await service.getAuthorizationUrl('acme.com');
    return { url, state, nonce: new URL(url).searchParams.get('nonce') as string };
  };
  const mockIdp = (idToken: string | undefined, ok = true) => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok,
      json: async () => ({ id_token: idToken }),
    } as Response);
  };
  /** Flux complet : state valide puis callback avec le jeton fabriqué. */
  const login = async (claims: Record<string, unknown> = {}, options = {}) => {
    const flow = await start();
    mockIdp(await sign({ nonce: flow.nonce, ...claims }, options));
    return service.handleCallback('code', flow.state, flow.state);
  };
  const expectNoSideEffect = () => {
    expect(authService.completeLogin).not.toHaveBeenCalled();
    expect(prisma.user.rows).toHaveLength(0);
  };

  describe('validation de l’id_token', () => {
    it('jeton valide : compte créé (adresse vérifiée), rôle MEMBER, session émise par completeLogin', async () => {
      await login();
      expect(prisma.user.rows).toHaveLength(1);
      expect(prisma.user.rows[0]).toMatchObject({
        email: 'ada@acme.com',
        ssoUid: `azure-ad:${TENANT}:oid-1`,
      });
      expect(prisma.user.rows[0].emailVerifiedAt).toBeInstanceOf(Date);
      expect(prisma.membership.rows[0]).toMatchObject({ workspaceId: 'ws-1', role: 'MEMBER' });
      expect(authService.completeLogin).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ada@acme.com' }),
        expect.objectContaining({ method: 'sso' }),
      );
    });

    it.each([
      ['signature invalide (autre clé)', () => ({ options: { key: otherPrivateKey } })],
      ['émetteur différent', () => ({ options: { iss: 'https://evil.example/v2.0' } })],
      [
        'émetteur d’un autre tenant',
        () => ({
          options: { iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` },
        }),
      ],
      ['audience différente', () => ({ options: { aud: 'autre-client' } })],
      ['nonce différent', () => ({ claims: { nonce: 'autre-nonce' } })],
      ['jeton expiré', () => ({ options: { exp: Math.floor(Date.now() / 1000) - 3600 } })],
      [
        'jeton expiré depuis 10 minutes (au-delà de la tolérance de 60 s)',
        () => ({ options: { exp: Math.floor(Date.now() / 1000) - 600 } }),
      ],
      ['iat manquant', () => ({ options: { omitIat: true } })],
      ['nonce absent', () => ({ claims: { nonce: undefined } })],
      ['nonce de type non textuel', () => ({ claims: { nonce: 12345 } })],
      ['clé inconnue (kid absent du JWKS)', () => ({ options: { kid: 'k-inconnu' } })],
      ['tid d’un autre tenant', () => ({ claims: { tid: OTHER_TENANT } })],
      ['oid manquant', () => ({ claims: { oid: undefined } })],
    ])('%s : 401, ni compte ni session', async (_label, make) => {
      const { claims = {}, options = {} } = make() as {
        claims?: Record<string, unknown>;
        options?: Record<string, unknown>;
      };
      const flow = await start();
      mockIdp(await sign({ nonce: flow.nonce, ...claims }, options));
      await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
        UnauthorizedException,
      );
      expectNoSideEffect();
    });

    it('liste blanche d’algorithmes : PS256 signé par une clé du JWKS sans attribut alg est refusé (seul RS256 est admis)', async () => {
      const pss = await generateKeyPair('PS256');
      const pssJwk: JWK = { ...(await exportJWK(pss.publicKey)), kid: 'k1', use: 'sig' };
      keySource.getKeys.mockImplementation(() => createLocalJWKSet({ keys: [pssJwk] }));
      const flow = await start();
      mockIdp(await sign({ nonce: flow.nonce }, { key: pss.privateKey, alg: 'PS256' }));
      await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
        UnauthorizedException,
      );
      expectNoSideEffect();
    });

    it('jeton expiré depuis 30 s : accepté (tolérance d’horloge de 60 s)', async () => {
      await login({}, { exp: Math.floor(Date.now() / 1000) - 30 });
      expect(authService.completeLogin).toHaveBeenCalledTimes(1);
    });

    it('HS256 signé avec la clé PUBLIQUE de l’IdP comme secret (confusion de clé) : 401', async () => {
      const flow = await start();
      const spki = await exportSPKI(publicKey);
      const hs = await new SignJWT({
        tid: TENANT,
        oid: 'o',
        email: 'ada@acme.com',
        nonce: flow.nonce,
      })
        .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode(spki));
      mockIdp(hs);
      await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
        UnauthorizedException,
      );
      expectNoSideEffect();
    });

    it('récupération des clés en échec (IdP injoignable, délai dépassé) : 401 générique, jamais 500', async () => {
      const flow = await start();
      mockIdp(await sign({ nonce: flow.nonce }));
      keySource.getKeys.mockImplementation(() => async () => {
        throw new Error('timeout');
      });
      const outcome = service.handleCallback('code', flow.state, flow.state);
      await expect(outcome).rejects.toThrow(UnauthorizedException);
      await expect(outcome).rejects.toThrow("Jeton d'identité invalide.");
      expectNoSideEffect();
    });

    it('algorithme HS256 (confusion de clé) et alg none : 401', async () => {
      const flow = await start();
      const hs = await new SignJWT({
        tid: TENANT,
        oid: 'o',
        email: 'ada@acme.com',
        nonce: flow.nonce,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(ISSUER)
        .setAudience(CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode('secret-de-test-0123456789abcdef'));
      mockIdp(hs);
      await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
        UnauthorizedException,
      );

      const flow2 = await start();
      const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          iss: ISSUER,
          aud: CLIENT_ID,
          exp: Math.floor(Date.now() / 1000) + 300,
          iat: Math.floor(Date.now() / 1000),
          nonce: flow2.nonce,
          tid: TENANT,
          oid: 'o',
          email: 'ada@acme.com',
        }),
      ).toString('base64url');
      mockIdp(`${header}.${payload}.`);
      await expect(service.handleCallback('code', flow2.state, flow2.state)).rejects.toThrow(
        UnauthorizedException,
      );
      expectNoSideEffect();
    });

    it('jeton absent de la réponse ou échange refusé par l’IdP : 401', async () => {
      const flow = await start();
      mockIdp(undefined);
      await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
        UnauthorizedException,
      );
      const flow2 = await start();
      mockIdp('x', false);
      await expect(service.handleCallback('code', flow2.state, flow2.state)).rejects.toThrow(
        UnauthorizedException,
      );
      expectNoSideEffect();
    });
  });

  describe('state, nonce et PKCE', () => {
    it('l’URL d’autorisation porte state, nonce, PKCE S256 et un redirect_uri fixé côté serveur', async () => {
      const { url, state } = await start();
      const params = new URL(url).searchParams;
      expect(
        url.startsWith(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`),
      ).toBe(true);
      expect(params.get('state')).toBe(state);
      expect(state.startsWith('sso_')).toBe(true);
      expect(Buffer.from(state.slice(4), 'base64url').length).toBeGreaterThanOrEqual(32);
      expect(Buffer.from(params.get('nonce') as string, 'base64url').length).toBeGreaterThanOrEqual(
        32,
      );
      expect(params.get('code_challenge_method')).toBe('S256');
      expect(params.get('redirect_uri')).toBe('https://app.planner.test/auth/sso/callback');
      expect(params.get('client_id')).toBe(CLIENT_ID);
    });

    it('S10-c : FRONTEND_URL=http://localhost:3000 donne redirect_uri=http://localhost:3000/auth/sso/callback', async () => {
      process.env.FRONTEND_URL = 'http://localhost:3000';
      const { url } = await start();
      expect(new URL(url).searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/auth/sso/callback',
      );
    });

    it('S10-c : seule l’origine de FRONTEND_URL est retenue, APP_URL est ignorée', async () => {
      process.env.FRONTEND_URL = 'https://app.planner.test/chemin/ignore?x=1';
      process.env.APP_URL = 'https://autre.example';
      const { url } = await start();
      expect(new URL(url).searchParams.get('redirect_uri')).toBe(
        'https://app.planner.test/auth/sso/callback',
      );
    });

    it('S10-c : en production sans FRONTEND_URL, erreur explicite et aucune URL en localhost', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.FRONTEND_URL;
      process.env.APP_URL = 'https://autre.example';
      const error = await service.getAuthorizationUrl('acme.com').catch((e: Error) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).toContain('FRONTEND_URL');
      expect((error as Error).message).not.toContain('localhost');
      expect(redis.store.size).toBe(0);
    });

    it('l’échange de code envoie le code_verifier (PKCE) et le secret DÉCHIFFRÉ', async () => {
      const flow = await start();
      mockIdp(await sign({ nonce: flow.nonce }));
      await service.handleCallback('code-1', flow.state, flow.state);
      const body = new URLSearchParams(String(fetchSpy.mock.calls[0][1].body));
      const verifier = body.get('code_verifier') as string;
      expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
        new URL(flow.url).searchParams.get('code_challenge'),
      );
      expect(body.get('client_secret')).toBe('s3cret');
      expect(body.get('redirect_uri')).toBe('https://app.planner.test/auth/sso/callback');
      expect(String(fetchSpy.mock.calls[0][0])).toBe(
        `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      );
    });

    it('state conservé en Redis 10 minutes au plus', async () => {
      await start();
      expect(redis.ttls.every((t) => (t.ttl ?? 0) <= 600)).toBe(true);
      expect(redis.ttls.length).toBeGreaterThan(0);
    });

    it.each([
      ['state inconnu', async (flow: { state: string }) => ['sso_inconnu', 'sso_inconnu']],
      ['sans cookie de flux', async (flow: { state: string }) => [flow.state, undefined]],
      ['cookie différent du state', async (flow: { state: string }) => [flow.state, 'sso_autre']],
      ['state sans le préfixe sso_', async () => ['github-state', 'github-state']],
    ])('%s : 401, aucun appel à l’IdP', async (_label, make) => {
      const flow = await start();
      fetchSpy = jest.spyOn(global, 'fetch');
      const [state, cookie] = (await make(flow)) as [string, string | undefined];
      await expect(service.handleCallback('code', state, cookie)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expectNoSideEffect();
    });

    it('un state n’est utilisable qu’une fois (rejeu : 401)', async () => {
      const flow = await start();
      mockIdp(await sign({ nonce: flow.nonce }));
      await service.handleCallback('code', flow.state, flow.state);
      authService.completeLogin.mockClear();
      await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.completeLogin).not.toHaveBeenCalled();
    });
  });

  describe('domaine prouvé et liaison', () => {
    it('adresse hors du domaine de la configuration : 409, aucun update ni création', async () => {
      const updateSpy = jest.spyOn(prisma.user, 'update');
      await expect(login({ email: 'pdg@victime.com' })).rejects.toThrow(ConflictException);
      expect(updateSpy).not.toHaveBeenCalled();
      expectNoSideEffect();
    });

    it('O4 : domain différent de verifiedDomain, adresse du domain déclaré (non prouvé) : 409, aucune session', async () => {
      await prisma.sSOConfiguration.updateMany({ where: {}, data: { domain: 'ancien.com' } });
      await expect(login({ email: 'ada@ancien.com' })).rejects.toThrow(ConflictException);
      expectNoSideEffect();
    });

    it('O4 : domain différent de verifiedDomain, adresse du domaine prouvé : acceptée', async () => {
      await prisma.sSOConfiguration.updateMany({ where: {}, data: { domain: 'ancien.com' } });
      await login({ email: 'ada@acme.com' });
      expect(authService.completeLogin).toHaveBeenCalledTimes(1);
    });

    it('nOAuth : e-mail d’un autre domaine dans un tenant étranger configuré par un attaquant : 409', async () => {
      await prisma.user.create({ data: { id: 'pdg', email: 'pdg@victime.com', name: 'PDG' } });
      await expect(login({ email: 'pdg@victime.com' })).rejects.toThrow(ConflictException);
      expect(prisma.user.rows[0].ssoUid).toBeNull();
      expect(authService.completeLogin).not.toHaveBeenCalled();
    });

    it('compte existant du domaine sans ssoUid : lié à l’identité, adresse marquée vérifiée', async () => {
      await prisma.user.create({
        data: { id: 'u1', email: 'ada@acme.com', name: 'Ada', emailVerifiedAt: null },
      });
      await login();
      expect(prisma.user.rows[0].ssoUid).toBe(`azure-ad:${TENANT}:oid-1`);
      expect(prisma.user.rows[0].emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('compte déjà lié à une AUTRE identité : 409, ssoUid inchangé', async () => {
      await prisma.user.create({
        data: { id: 'u1', email: 'ada@acme.com', name: 'Ada', ssoUid: 'azure-ad:autre:oid' },
      });
      await expect(login()).rejects.toThrow(ConflictException);
      expect(prisma.user.rows[0].ssoUid).toBe('azure-ad:autre:oid');
      expect(authService.completeLogin).not.toHaveBeenCalled();
    });

    it('S10-d : compte Azure au ssoUid hérité, après le script de reprise : session émise et ssoUid au nouveau format', async () => {
      await prisma.user.create({
        data: { id: 'u1', email: 'ada@acme.com', name: 'Ada', ssoUid: 'azure-ad:oid-1' },
      });
      // Avant la reprise, la liaison héritée bloque le compte
      await expect(login()).rejects.toThrow(ConflictException);
      const client = {
        user: {
          findMany: (args: never) => prisma.user.findMany(args),
          updateMany: (args: never) => prisma.user.updateMany(args),
        },
        $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ user: prisma.user }),
      } as unknown as PrismaClient;
      await runLegacySsoUidReset(client, { apply: true });

      await login();
      expect(authService.completeLogin).toHaveBeenCalledTimes(1);
      expect(prisma.user.rows[0].ssoUid).toBe(`azure-ad:${TENANT}:oid-1`);
    });

    it.each([
      ['acct: 1 (invité du tenant)', { acct: 1 }],
      ['xms_edov: false (domaine non vérifié)', { xms_edov: false }],
    ])('S10-i : Azure, jeton %s : 401, ni compte ni session', async (_label, claims) => {
      await expect(login(claims)).rejects.toThrow(UnauthorizedException);
      expectNoSideEffect();
    });

    it('S10-i : Azure, acct: 0 et xms_edov: true (ou absents) restent acceptés', async () => {
      await login({ acct: 0, xms_edov: true });
      expect(authService.completeLogin).toHaveBeenCalledTimes(1);
    });

    describe('journal SSO_LOGIN_FAILURE', () => {
      const captureLogs = () => {
        const logged: string[] = [];
        const capture = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
        const spies = (['warn', 'error', 'log'] as const).map((level) =>
          jest.spyOn(Logger.prototype, level).mockImplementation(capture),
        );
        return { logged, restore: () => spies.forEach((spy) => spy.mockRestore()) };
      };

      it('state rejoué : une ligne est écrite, sans la valeur du state', async () => {
        const flow = await start();
        mockIdp(await sign({ nonce: flow.nonce }));
        await service.handleCallback('code', flow.state, flow.state);
        const logs = captureLogs();
        try {
          await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
            UnauthorizedException,
          );
        } finally {
          logs.restore();
        }
        const lines = logs.logged.filter((l) => l.includes('SSO_LOGIN_FAILURE'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('401');
        expect(lines[0]).not.toContain(flow.state);
        expect(lines[0]).not.toContain('code');
      });

      it('jeton invalide : ligne avec le workspace, sans jeton ni adresse', async () => {
        const flow = await start();
        const idToken = await sign({ nonce: flow.nonce }, { aud: 'autre' });
        mockIdp(idToken);
        const logs = captureLogs();
        try {
          await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
            UnauthorizedException,
          );
        } finally {
          logs.restore();
        }
        const line = logs.logged.find((l) => l.includes('SSO_LOGIN_FAILURE')) as string;
        expect(line).toContain('ws-1');
        expect(line).not.toContain(idToken);
        expect(line).not.toContain(flow.state);
        expect(line).not.toContain('ada@acme.com');
      });

      it('O3 : le message brut de l’exception n’est jamais journalisé, seulement un motif contrôlé', async () => {
        authService.completeLogin.mockRejectedValueOnce(
          new ForbiddenException('ada@acme.com a-secret-code-123 sso_state_xyz Ada Lovelace'),
        );
        const flow = await start();
        mockIdp(await sign({ nonce: flow.nonce }));
        const logs = captureLogs();
        try {
          await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
            ForbiddenException,
          );
        } finally {
          logs.restore();
        }
        const line = logs.logged.find((l) => l.includes('SSO_LOGIN_FAILURE')) as string;
        expect(line).not.toContain('ada@acme.com');
        expect(line).not.toContain('a-secret-code-123');
        expect(line).not.toContain('sso_state_xyz');
        expect(line).not.toContain('Lovelace');
        expect(JSON.parse(line).reason).toBe('REFUSE');
        expect(JSON.parse(line).status).toBe(403);
      });

      it.each([
        [new BadRequestException('x'), 'REQUETE_INVALIDE'],
        [new UnauthorizedException('x'), 'NON_AUTHENTIFIE'],
        [new ConflictException('x'), 'CONFLIT'],
        [new ServiceUnavailableException('x'), 'INDISPONIBLE'],
        [new NotFoundException('x'), 'AUTRE_REFUS'],
        [new Error('ada@acme.com'), 'ERREUR_INTERNE'],
      ])('O3 : motif contrôlé pour %p', async (error, reason) => {
        authService.completeLogin.mockRejectedValueOnce(error);
        const flow = await start();
        mockIdp(await sign({ nonce: flow.nonce }));
        const logs = captureLogs();
        try {
          await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow();
        } finally {
          logs.restore();
        }
        const line = logs.logged.find((l) => l.includes('SSO_LOGIN_FAILURE')) as string;
        expect(JSON.parse(line).reason).toBe(reason);
        expect(line).not.toContain('ada@acme.com');
      });

      it('liaison refusée (409) : journalisée avec le statut, sans adresse', async () => {
        const logs = captureLogs();
        try {
          await expect(login({ email: 'pdg@victime.com' })).rejects.toThrow(ConflictException);
        } finally {
          logs.restore();
        }
        const line = logs.logged.find((l) => l.includes('SSO_LOGIN_FAILURE')) as string;
        expect(line).toContain('409');
        expect(line).not.toContain('victime.com');
      });
    });

    it('S10-d : compte x@autre.com portant le ssoUid présenté : 409, aucune session ni adhésion', async () => {
      await prisma.user.create({
        data: {
          id: 'x',
          email: 'x@autre.com',
          name: 'X',
          ssoUid: `azure-ad:${TENANT}:oid-1`,
        },
      });
      await expect(login()).rejects.toThrow(ConflictException);
      expect(authService.completeLogin).not.toHaveBeenCalled();
      expect(prisma.membership.rows).toHaveLength(0);
      expect(prisma.user.rows).toHaveLength(1);
    });

    it.each(['', null])(
      'S10-b : configuration active avec clientId %p : callback 401 sans lecture des clés ni appel IdP, autorisation 400',
      async (clientId) => {
        const flow = await start();
        mockIdp(await sign({ nonce: flow.nonce }));
        await prisma.sSOConfiguration.updateMany({ where: {}, data: { clientId } });

        await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
          UnauthorizedException,
        );
        expect(keySource.getKeys).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(authService.completeLogin).not.toHaveBeenCalled();
        await expect(service.getAuthorizationUrl('acme.com')).rejects.toThrow(BadRequestException);
      },
    );

    it('compte suspendu : 403 avant toute adhésion au workspace', async () => {
      await prisma.user.create({
        data: { id: 'u1', email: 'ada@acme.com', name: 'Ada', isSuspended: true },
      });
      await expect(login()).rejects.toThrow(ForbiddenException);
      expect(prisma.membership.rows).toHaveLength(0);
    });

    it('autoProvision désactivé : 403 sans création', async () => {
      await prisma.sSOConfiguration.updateMany({ where: {}, data: { autoProvision: false } });
      await expect(login()).rejects.toThrow(ForbiddenException);
      expect(prisma.user.rows).toHaveLength(0);
    });

    it.each([
      ['domaine non prouvé', { domainVerifiedAt: null, verifiedDomain: null }],
      ['configuration désactivée', { enabled: false }],
    ])('%s : aucun flux (404), ni découverte', async (_label, patch) => {
      await prisma.sSOConfiguration.updateMany({ where: {}, data: patch });
      await expect(service.getAuthorizationUrl('acme.com')).rejects.toThrow(NotFoundException);
      expect((await service.discover('ada@acme.com')).ssoAvailable).toBe(false);
    });

    it('configuration désactivée ou domaine révoqué entre le démarrage et le retour : 401', async () => {
      const flow = await start();
      await prisma.sSOConfiguration.updateMany({
        where: {},
        data: { domainVerifiedAt: null, verifiedDomain: null },
      });
      mockIdp(await sign({ nonce: flow.nonce }));
      await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rôle par défaut hérité OWNER/ADMIN d’une ancienne ligne : ramené à MEMBER', async () => {
      await prisma.sSOConfiguration.updateMany({ where: {}, data: { defaultRole: 'OWNER' } });
      await login();
      expect(prisma.membership.rows[0].role).toBe('MEMBER');
    });
  });

  describe('Google', () => {
    beforeEach(async () => {
      await prisma.sSOConfiguration.updateMany({
        where: {},
        data: { provider: 'OIDC_GOOGLE', issuer: null },
      });
    });
    const googleLogin = async (claims: Record<string, unknown>) => {
      const flow = await start();
      mockIdp(
        await sign(
          { nonce: flow.nonce, sub: 'g-1', tid: undefined, oid: undefined, ...claims },
          { iss: 'https://accounts.google.com' },
        ),
      );
      return service.handleCallback('code', flow.state, flow.state);
    };

    it('email_verified et hd conformes : connexion', async () => {
      await googleLogin({ email_verified: true, hd: 'acme.com' });
      expect(prisma.user.rows[0].ssoUid).toBe('google:g-1');
    });

    it.each([
      ['email_verified faux', { email_verified: false, hd: 'acme.com' }],
      ['email_verified absent', { hd: 'acme.com' }],
      ['hd d’un autre domaine', { email_verified: true, hd: 'autre.com' }],
      ['hd absent (compte Gmail personnel)', { email_verified: true }],
    ])('%s : 401', async (_label, claims) => {
      await expect(googleLogin(claims)).rejects.toThrow(UnauthorizedException);
      expectNoSideEffect();
    });
  });

  describe('configuration : preuve DNS, rôle borné, secret chiffré', () => {
    const base = {
      provider: 'OIDC_AZURE_AD' as const,
      domain: 'beta.io',
      clientId: 'c',
      clientSecret: 'secret-beta',
      issuer: TENANT,
    };
    const adminOf = async (workspaceId: string) =>
      prisma.membership.create({
        data: { workspaceId, userId: `admin-${workspaceId}`, role: 'OWNER' },
      });

    it('activer sans domaine vérifié : 400', async () => {
      await adminOf('ws-2');
      await expect(
        service.configureWorkspaceSSO('ws-2', 'admin-ws-2', { ...base, enabled: true }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.configureWorkspaceSSO('ws-2', 'admin-ws-2', { ...base, enforceSSO: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('création : désactivée par défaut, jeton DNS fourni, secret chiffré en base et masqué', async () => {
      await adminOf('ws-2');
      const view = (await service.configureWorkspaceSSO('ws-2', 'admin-ws-2', base)) as Record<
        string,
        unknown
      >;
      const row = prisma.sSOConfiguration.rows.find((r) => r.workspaceId === 'ws-2') as Record<
        string,
        string
      >;
      expect(row.enabled).toBe(false);
      expect(row.clientSecret).not.toContain('secret-beta');
      expect(decrypt(row.clientSecret)).toBe('secret-beta');
      expect(view.clientSecret).toBe('********');
      expect(JSON.stringify(view)).not.toContain('secret-beta');
      expect(view.dnsVerification).toEqual({
        host: '_planner-pro.beta.io',
        type: 'TXT',
        value: `planner-pro-verification=${row.domainVerificationToken}`,
      });
    });

    it('tenant Azure common / organizations / non GUID : 400', async () => {
      await adminOf('ws-2');
      for (const issuer of ['common', 'organizations', 'consumers', undefined]) {
        await expect(
          service.configureWorkspaceSSO('ws-2', 'admin-ws-2', { ...base, issuer }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('defaultRole OWNER ou ADMIN : refusé par le DTO', async () => {
      for (const defaultRole of ['OWNER', 'ADMIN']) {
        const dto = plainToInstance(ConfigureSsoDto, { ...base, defaultRole });
        expect((await validate(dto)).some((e) => e.property === 'defaultRole')).toBe(true);
      }
      for (const defaultRole of ['MEMBER', 'VIEWER']) {
        const dto = plainToInstance(ConfigureSsoDto, { ...base, defaultRole });
        expect(await validate(dto)).toHaveLength(0);
      }
    });

    it('domaine déjà PROUVÉ par un autre workspace : refusé, la ligne du propriétaire est intacte', async () => {
      await adminOf('ws-2');
      const before = JSON.stringify(prisma.sSOConfiguration.rows[0]);
      await expect(
        service.configureWorkspaceSSO('ws-2', 'admin-ws-2', { ...base, domain: 'acme.com' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.sSOConfiguration.rows).toHaveLength(1);
      expect(JSON.stringify(prisma.sSOConfiguration.rows[0])).toBe(before);
    });

    describe('revendications concurrentes d’un même domaine non prouvé (S10-a)', () => {
      const claim = { ...base, domain: 'acme.com' };
      const rowOf = (workspaceId: string) =>
        prisma.sSOConfiguration.rows.find((r) => r.workspaceId === workspaceId) as Record<
          string,
          unknown
        >;

      beforeEach(async () => {
        // ws-1 repart d'une revendication non prouvée du domaine
        await prisma.sSOConfiguration.updateMany({
          where: {},
          data: { domainVerifiedAt: null, verifiedDomain: null, enabled: false },
        });
        await prisma.membership.create({
          data: { workspaceId: 'ws-1', userId: 'admin-ws-1', role: 'OWNER' },
        });
        await adminOf('ws-2');
      });

      it('deux workspaces revendiquent acme.com : aucune ligne supprimée, deux jetons distincts', async () => {
        await service.configureWorkspaceSSO('ws-2', 'admin-ws-2', claim);
        expect(prisma.sSOConfiguration.rows).toHaveLength(2);
        expect(rowOf('ws-1')).toBeDefined();
        expect(rowOf('ws-2').domain).toBe('acme.com');
        expect(rowOf('ws-1').domainVerificationToken).toBe('tok');
        expect(rowOf('ws-2').domainVerificationToken).not.toBe('tok');
      });

      it('le premier verifyDomain réussit, le second reçoit 409', async () => {
        await service.configureWorkspaceSSO('ws-2', 'admin-ws-2', claim);
        dns.hasVerificationToken.mockResolvedValue(true);
        await service.verifyDomain('ws-2', 'admin-ws-2');
        expect(rowOf('ws-2').verifiedDomain).toBe('acme.com');
        await expect(service.verifyDomain('ws-1', 'admin-ws-1')).rejects.toThrow(ConflictException);
        expect(rowOf('ws-1').verifiedDomain).toBeNull();
      });

      it('une reconfiguration par ws-2 ne modifie aucun champ de la ligne de ws-1', async () => {
        const before = JSON.stringify(rowOf('ws-1'));
        await service.configureWorkspaceSSO('ws-2', 'admin-ws-2', claim);
        await service.configureWorkspaceSSO('ws-2', 'admin-ws-2', { ...claim, clientId: 'autre' });
        expect(JSON.stringify(rowOf('ws-1'))).toBe(before);
      });
    });

    describe('changement d’IdP sur un domaine prouvé (S10-e)', () => {
      const keep = {
        provider: 'OIDC_AZURE_AD' as const,
        domain: 'acme.com',
        clientId: CLIENT_ID,
        issuer: TENANT,
        enabled: true,
      };
      const member = (userId: string, role: 'OWNER' | 'ADMIN') =>
        prisma.membership.create({ data: { workspaceId: 'ws-1', userId, role } });
      const row = () => prisma.sSOConfiguration.rows[0];

      it('un ADMIN qui change issuer : 403, configuration inchangée', async () => {
        await member('adm', 'ADMIN');
        const before = JSON.stringify(row());
        await expect(
          service.configureWorkspaceSSO('ws-1', 'adm', { ...keep, issuer: OTHER_TENANT }),
        ).rejects.toThrow(ForbiddenException);
        expect(JSON.stringify(row())).toBe(before);
      });

      it.each([
        ['issuer', { issuer: OTHER_TENANT }],
        ['clientId', { clientId: 'autre-client' }],
        ['provider', { provider: 'OIDC_GOOGLE' as const, issuer: undefined }],
      ])(
        'l’OWNER qui change %s : 200, désactivé, enforceSSO coupé, preuve du domaine conservée, journalisé',
        async (_field, change) => {
          await member('own', 'OWNER');
          await prisma.sSOConfiguration.updateMany({ where: {}, data: { enforceSSO: true } });
          const proofAt = row().domainVerifiedAt;
          const logged: string[] = [];
          const spy = jest
            .spyOn(Logger.prototype, 'log')
            .mockImplementation(
              (...args: unknown[]) => void logged.push(args.map(String).join(' ')),
            );
          try {
            await service.configureWorkspaceSSO('ws-1', 'own', {
              ...keep,
              enforceSSO: true,
              ...change,
            });
          } finally {
            spy.mockRestore();
          }
          expect(row().enabled).toBe(false);
          expect(row().enforceSSO).toBe(false);
          expect(row().domainVerifiedAt).toBe(proofAt);
          expect(row().verifiedDomain).toBe('acme.com');
          const line = logged.find((l) => l.includes('SSO_CONFIG_IDP_CHANGED'));
          expect(line).toBeDefined();
          expect(line).not.toContain('s3cret');
          expect(line).not.toContain(row().clientSecret as string);
        },
      );

      it('une modification de defaultRole seule ne désactive pas la configuration', async () => {
        await member('adm', 'ADMIN');
        await service.configureWorkspaceSSO('ws-1', 'adm', { ...keep, defaultRole: 'VIEWER' });
        expect(row().enabled).toBe(true);
        expect(row().defaultRole).toBe('VIEWER');
      });
    });

    it('changer de domaine remet la preuve à zéro et désactive', async () => {
      await prisma.membership.create({
        data: { workspaceId: 'ws-1', userId: 'a1', role: 'ADMIN' },
      });
      await service.configureWorkspaceSSO('ws-1', 'a1', {
        ...base,
        domain: 'gamma.io',
        clientSecret: undefined,
      });
      const row = prisma.sSOConfiguration.rows[0];
      expect(row.domainVerifiedAt).toBeNull();
      expect(row.enabled).toBe(false);
      expect(row.domainVerificationToken).not.toBe('tok');
    });

    it('un membre simple ne configure rien (403)', async () => {
      await prisma.membership.create({
        data: { workspaceId: 'ws-1', userId: 'm1', role: 'MEMBER' },
      });
      await expect(service.configureWorkspaceSSO('ws-1', 'm1', base)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.verifyDomain('ws-1', 'm1')).rejects.toThrow(ForbiddenException);
    });

    it('verifyDomain : TXT absent = refus ; TXT présent = domaine prouvé', async () => {
      await prisma.membership.create({
        data: { workspaceId: 'ws-1', userId: 'a1', role: 'ADMIN' },
      });
      await prisma.sSOConfiguration.updateMany({
        where: {},
        data: { domainVerifiedAt: null, verifiedDomain: null },
      });
      dns.hasVerificationToken.mockResolvedValueOnce(false);
      await expect(service.verifyDomain('ws-1', 'a1')).rejects.toThrow(BadRequestException);
      expect(prisma.sSOConfiguration.rows[0].domainVerifiedAt).toBeNull();

      dns.hasVerificationToken.mockResolvedValueOnce(true);
      await service.verifyDomain('ws-1', 'a1');
      expect(dns.hasVerificationToken).toHaveBeenLastCalledWith('acme.com', 'tok');
      expect(prisma.sSOConfiguration.rows[0].domainVerifiedAt).toBeInstanceOf(Date);
    });
  });

  describe('S10-f : appels IdP bornés, aucune erreur 500', () => {
    it('l’appel au point de jeton porte un délai maximal (AbortSignal)', async () => {
      const flow = await start();
      mockIdp(await sign({ nonce: flow.nonce }));
      await service.handleCallback('code', flow.state, flow.state);
      expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it.each([
      ['délai dépassé', Object.assign(new Error('timeout'), { name: 'TimeoutError' })],
      ['erreur réseau', new TypeError('fetch failed')],
    ])('IdP injoignable (%s) : 503, aucune session', async (_label, failure) => {
      const flow = await start();
      fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(failure);
      await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(authService.completeLogin).not.toHaveBeenCalled();
    });

    it('réponse de l’IdP qui n’est pas du JSON : 401', async () => {
      const flow = await start();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response);
      await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.completeLogin).not.toHaveBeenCalled();
    });

    it('secret client indéchiffrable : 503, journal sans secret ni texte chiffré', async () => {
      const flow = await start();
      mockIdp(await sign({ nonce: flow.nonce }));
      const stored = prisma.sSOConfiguration.rows[0].clientSecret as string;
      process.env.ENCRYPTION_KEY = 'b'.repeat(32);
      const logged: string[] = [];
      const capture = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
      const spies = (['warn', 'error', 'log'] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(capture),
      );
      try {
        await expect(service.handleCallback('code', flow.state, flow.state)).rejects.toThrow(
          ServiceUnavailableException,
        );
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      const output = logged.join('\n');
      expect(output).toContain('SSO_SECRET_DECRYPT_FAILURE');
      expect(output).not.toContain(stored);
      expect(output).not.toContain('s3cret');
      expect(output).not.toContain(flow.state);
    });

    it('verifyDomain : course perdue contre la contrainte unique (P2002) : 409', async () => {
      await prisma.membership.create({
        data: { workspaceId: 'ws-1', userId: 'a1', role: 'ADMIN' },
      });
      await prisma.sSOConfiguration.updateMany({
        where: {},
        data: { domainVerifiedAt: null, verifiedDomain: null },
      });
      dns.hasVerificationToken.mockResolvedValue(true);
      jest
        .spyOn(prisma.sSOConfiguration, 'updateMany')
        .mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
      await expect(service.verifyDomain('ws-1', 'a1')).rejects.toThrow(ConflictException);
    });
  });
});
