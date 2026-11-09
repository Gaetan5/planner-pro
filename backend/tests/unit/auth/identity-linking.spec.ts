import { PolicyService } from '../../../src/authz/policy.service';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { validate } from 'class-validator';
import { FirebaseLinkDto } from '../../../src/auth/dto/identity.dto';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from '../../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../../src/auth/firebase-identity.service';
import { MailService } from '../../../src/mail/mail.service';
import { SessionService } from '../../../src/auth/session.service';
import { TokenService } from '../../../src/auth/token.service';
import { decrypt, encrypt, hashPassword } from '../../../src/auth/encryption.util';
import { createGithubOAuthState } from '../../../src/auth/github-oauth-state';
import { generateTotpCode, generateTotpSecret } from '../../../src/auth/totp.util';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';
import { FakePrisma } from '../../http/fake-prisma';
import { FakeRedisService } from '../../http/fake-redis';

jest.setTimeout(30_000);

const PASSWORD = 'MotDePasse!2026';
type Provider = 'firebase' | 'github';
type Reauth = { password?: string; mfaCode?: string; recoveryCode?: string };

/**
 * S31 : lier ou délier une identité externe exige une réauthentification récente (mot de passe ou
 * connexion de moins de 5 min, plus le second facteur si la MFA est active), avant toute écriture
 * et, pour GitHub, avant l'échange du code. Chaque changement est notifié et audité.
 */
describe('S31 : liaison et déliaison d’identités externes', () => {
  const savedEnv = { ...process.env };
  let service: AuthService;
  let sessions: SessionService;
  let prisma: FakePrisma;
  let fetchSpy: jest.SpyInstance;
  const firebase = { verifyIdToken: jest.fn() };
  const mail = {
    sendIdentityLinkedEmail: jest.fn().mockResolvedValue(true),
    sendIdentityUnlinkedEmail: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-s31-link-0123456789abcdef0123456';
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    process.env.GITHUB_CLIENT_ID = 'gh-client';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';
    delete process.env.FEATURE_SSO_ENABLED;
    prisma = new FakePrisma();
    firebase.verifyIdToken.mockResolvedValue({
      uid: 'fb-uid-1',
      email: 'Perso@Example.com',
      email_verified: true,
    });
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async (url: string) => {
      const target = String(url);
      const body = target.includes('access_token')
        ? { access_token: 'gho_secret', scope: 'repo' }
        : target.endsWith('/emails')
          ? [{ email: 'ada@corp.com', primary: true, verified: true }]
          : { id: 4242, login: 'ada-gh', name: 'Ada' };
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch);
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
      providers: [
        AuthService,
        SessionService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: new FakeRedisService() },
        { provide: FirebaseIdentityService, useValue: firebase },
        { provide: MailService, useValue: mail },
        { provide: PolicyService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
    sessions = module.get(SessionService);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  const row = () => prisma.user.rows.find((u) => u.id === 'user-1')!;
  const seed = async (extra: Record<string, unknown> = {}, withPassword = true) =>
    prisma.user.create({
      data: {
        id: 'user-1',
        email: 'ada@corp.com',
        name: 'Ada',
        passwordHash: withPassword ? await hashPassword(PASSWORD) : null,
        ...extra,
      },
    });
  const session = (ageMs = 0) =>
    sessions.issue(
      { id: 'user-1', email: 'ada@corp.com', name: 'Ada' },
      { authenticatedAt: new Date(Date.now() - ageMs) },
    );
  const link = (provider: Provider, reauth: Reauth, sid?: string) =>
    provider === 'firebase'
      ? service.linkFirebaseAccount('user-1', 'id-token', reauth, sid)
      : service.linkGitHubAccount(
          'user-1',
          'oauth-code',
          (({ state, cookieValue }) => ({ state, cookie: cookieValue }))(
            createGithubOAuthState('link'),
          ),
          reauth,
          sid,
        );
  const linked = (provider: Provider) =>
    provider === 'firebase' ? row().firebaseUid : row().githubId;
  /** Aucune lecture du jeton Firebase ni échange du code GitHub n'a eu lieu. */
  const noExternalCall = () => {
    expect(firebase.verifyIdToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  };

  describe.each<Provider>(['firebase', 'github'])('liaison %s', (provider) => {
    describe('compte avec mot de passe', () => {
      it.each([
        ['absent', undefined],
        ['faux', 'mauvais'],
      ])('mot de passe %s : 403, aucune écriture, aucun appel externe', async (_l, password) => {
        await seed();
        const updateSpy = jest.spyOn(prisma.user, 'update');
        await expect(link(provider, { password })).rejects.toThrow(ForbiddenException);
        expect(updateSpy).not.toHaveBeenCalled();
        expect(linked(provider) ?? null).toBeNull();
        expect(row().githubAccessToken ?? null).toBeNull();
        noExternalCall();
        expect(mail.sendIdentityLinkedEmail).not.toHaveBeenCalled();
      });

      it('mot de passe correct : liaison, notification au titulaire et entrée d’audit', async () => {
        await seed();
        const res = await link(provider, { password: PASSWORD });
        expect(linked(provider)).toBeTruthy();
        expect(mail.sendIdentityLinkedEmail).toHaveBeenCalledTimes(1);
        expect(mail.sendIdentityLinkedEmail.mock.calls[0][0]).toBe('ada@corp.com');
        const audit = prisma.auditLog.rows;
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({ userId: 'user-1', action: 'IDENTITY_LINKED' });
        expect(JSON.stringify(audit[0].changes)).not.toMatch(/gho_secret|id-token|oauth-code/);
        // adresse liée renvoyée pour l'affichage
        if (provider === 'firebase') {
          expect(row().firebaseEmail).toBe('perso@example.com');
          expect((res as { firebaseEmail: string }).firebaseEmail).toBe('perso@example.com');
        } else {
          expect((res as { githubUsername: string }).githubUsername).toBe('ada-gh');
        }
      });
    });

    describe('compte sans mot de passe', () => {
      it('connexion de plus de 5 min : 403, aucune écriture, aucun appel externe', async () => {
        await seed({}, false);
        const stale = await session(10 * 60 * 1000);
        const updateSpy = jest.spyOn(prisma.user, 'update');
        await expect(link(provider, {}, stale.sid)).rejects.toThrow(ForbiddenException);
        await expect(link(provider, {}, undefined)).rejects.toThrow(ForbiddenException);
        expect(updateSpy).not.toHaveBeenCalled();
        noExternalCall();
      });

      it('connexion de moins de 5 min : liaison effectuée', async () => {
        await seed({}, false);
        const fresh = await session();
        await link(provider, {}, fresh.sid);
        expect(linked(provider)).toBeTruthy();
      });
    });

    describe('MFA active', () => {
      const seedMfa = async () => {
        const secret = generateTotpSecret();
        await seed({ mfaEnabled: true, mfaSecret: encrypt(secret) });
        return secret;
      };

      it.each([
        ['sans code', {}],
        ['avec un code faux', { mfaCode: '000000' }],
      ])('mot de passe correct %s : refus, aucune écriture', async (_l, extra) => {
        await seedMfa();
        const updateSpy = jest.spyOn(prisma.user, 'update');
        await expect(link(provider, { password: PASSWORD, ...extra })).rejects.toThrow(
          BadRequestException,
        );
        expect(updateSpy).not.toHaveBeenCalled();
        expect(linked(provider) ?? null).toBeNull();
        noExternalCall();
      });

      it('code TOTP valide : liaison effectuée, pas de temps consommé (rejeu refusé)', async () => {
        const secret = await seedMfa();
        const code = generateTotpCode(secret);
        await link(provider, { password: PASSWORD, mfaCode: code });
        expect(linked(provider)).toBeTruthy();
        expect(row().mfaLastUsedStep).not.toBeNull();
        await expect(
          service.unlinkIdentity('user-1', provider, { password: PASSWORD, mfaCode: code }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('protections conservées', () => {
      it('identité déjà liée à un autre compte : 409, aucune écriture', async () => {
        await seed();
        await prisma.user.create({
          data: {
            id: 'other',
            email: 'bob@corp.com',
            firebaseUid: 'fb-uid-1',
            githubId: '4242',
          },
        });
        const updateSpy = jest.spyOn(prisma.user, 'update');
        await expect(link(provider, { password: PASSWORD })).rejects.toThrow(ConflictException);
        expect(updateSpy).not.toHaveBeenCalled();
      });

      it('compte déjà lié à une autre identité : 409 sans écriture ni jeton conservé (P9-R)', async () => {
        const previous =
          provider === 'firebase' ? { firebaseUid: 'fb-ancien' } : { githubId: '1111' };
        await seed({ ...previous, githubAccessToken: encrypt('gho_ancien') });
        const before = { ...row() };
        const updateSpy = jest.spyOn(prisma.user, 'update');
        await expect(link(provider, { password: PASSWORD })).rejects.toThrow(ConflictException);
        expect(updateSpy).not.toHaveBeenCalled();
        expect(row()).toEqual(before);
        expect(decrypt(row().githubAccessToken as string)).toBe('gho_ancien');
      });

      it('relier la même identité reste permis (renouvellement)', async () => {
        const same = provider === 'firebase' ? { firebaseUid: 'fb-uid-1' } : { githubId: '4242' };
        await seed(same);
        await expect(link(provider, { password: PASSWORD })).resolves.toBeDefined();
        expect(linked(provider)).toBe(provider === 'firebase' ? 'fb-uid-1' : '4242');
      });
    });
  });

  it('finalité repos vers un autre githubId : 409, le jeton obtenu n’est pas conservé (P9-R)', async () => {
    await seed({
      githubId: '1111',
      githubUsername: 'ancien',
      githubAccessToken: encrypt('gho_ancien'),
    });
    const { state, cookieValue } = createGithubOAuthState('repos');
    await expect(
      service.linkGitHubAccount(
        'user-1',
        'oauth-code',
        { state, cookie: cookieValue },
        { password: PASSWORD },
      ),
    ).rejects.toThrow(ConflictException);
    expect(row().githubId).toBe('1111');
    expect(row().githubUsername).toBe('ancien');
    expect(decrypt(row().githubAccessToken as string)).toBe('gho_ancien');
  });

  it('Firebase : e-mail non vérifié refusé, aucune écriture', async () => {
    await seed();
    firebase.verifyIdToken.mockResolvedValue({ uid: 'x', email: 'a@b.c', email_verified: false });
    await expect(link('firebase', { password: PASSWORD })).rejects.toThrow(BadRequestException);
    expect(row().firebaseUid ?? null).toBeNull();
  });

  describe.each<Provider>(['firebase', 'github'])('déliaison %s', (provider) => {
    const linkedFields = () =>
      provider === 'firebase'
        ? { firebaseUid: 'fb-uid-1', firebaseEmail: 'perso@example.com' }
        : {
            githubId: '4242',
            githubUsername: 'ada-gh',
            githubAccessToken: encrypt('gho_secret'),
          };

    it('seule méthode de connexion : 409, aucune écriture', async () => {
      await seed(linkedFields(), false);
      const fresh = await session();
      const updateSpy = jest.spyOn(prisma.user, 'updateMany');
      await expect(service.unlinkIdentity('user-1', provider, {}, fresh.sid)).rejects.toThrow(
        ConflictException,
      );
      expect(updateSpy).not.toHaveBeenCalled();
      expect(linked(provider)).toBeTruthy();
    });

    it('avec un mot de passe : champs remis à null, jeton effacé, notification, audit, autres sessions révoquées', async () => {
      await seed(linkedFields());
      const current = await session();
      const other = await session();
      await service.unlinkIdentity('user-1', provider, { password: PASSWORD }, current.sid);

      expect(linked(provider)).toBeNull();
      if (provider === 'github') {
        expect(row().githubUsername).toBeNull();
        expect(row().githubAccessToken).toBeNull();
      } else {
        expect(row().firebaseEmail).toBeNull();
      }
      expect(mail.sendIdentityUnlinkedEmail).toHaveBeenCalledTimes(1);
      expect(mail.sendIdentityUnlinkedEmail.mock.calls[0][0]).toBe('ada@corp.com');
      expect(prisma.auditLog.rows[0]).toMatchObject({ action: 'IDENTITY_UNLINKED' });
      expect(await sessions.isSessionActive(current.sid, 'user-1')).toBe(true);
      expect(await sessions.isSessionActive(other.sid, 'user-1')).toBe(false);
    });

    it('avec l’autre identité comme seule autre méthode : autorisé', async () => {
      const other =
        provider === 'firebase'
          ? { githubId: '9', githubUsername: 'x' }
          : { firebaseUid: 'fb-2', firebaseEmail: 'x@y.z' };
      await seed({ ...linkedFields(), ...other }, false);
      const fresh = await session();
      await service.unlinkIdentity('user-1', provider, {}, fresh.sid);
      expect(linked(provider)).toBeNull();
    });

    it.each([
      ['mot de passe absent', undefined],
      ['mot de passe faux', 'mauvais'],
    ])('%s : 403, rien n’est modifié', async (_l, password) => {
      await seed(linkedFields());
      const updateSpy = jest.spyOn(prisma.user, 'updateMany');
      await expect(service.unlinkIdentity('user-1', provider, { password })).rejects.toThrow(
        ForbiddenException,
      );
      expect(updateSpy).not.toHaveBeenCalled();
      expect(linked(provider)).toBeTruthy();
    });

    it('MFA active sans code : refus, rien n’est modifié', async () => {
      await seed({ ...linkedFields(), mfaEnabled: true, mfaSecret: encrypt(generateTotpSecret()) });
      await expect(
        service.unlinkIdentity('user-1', provider, { password: PASSWORD }),
      ).rejects.toThrow(BadRequestException);
      expect(linked(provider)).toBeTruthy();
    });

    it('identité non liée : 409', async () => {
      await seed();
      await expect(
        service.unlinkIdentity('user-1', provider, { password: PASSWORD }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // S31-a : deux déliaisons simultanées ne doivent pas retirer toutes les méthodes de connexion
  describe('déliaisons simultanées (S31-a)', () => {
    const both = () => ({
      firebaseUid: 'fb-uid-1',
      firebaseEmail: 'perso@example.com',
      githubId: '4242',
      githubUsername: 'ada-gh',
      githubAccessToken: encrypt('gho_secret'),
    });

    it('sans mot de passe, deux identités : une seule déliaison réussit, l’autre donne 409', async () => {
      await seed(both(), false);
      const fresh = await session();
      const results = await Promise.allSettled([
        service.unlinkIdentity('user-1', 'firebase', {}, fresh.sid),
        service.unlinkIdentity('user-1', 'github', {}, fresh.sid),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      expect(Boolean(row().firebaseUid) || Boolean(row().githubId)).toBe(true);
      expect(mail.sendIdentityUnlinkedEmail).toHaveBeenCalledTimes(1);
    });

    it('avec un mot de passe, les deux déliaisons réussissent', async () => {
      await seed(both());
      const fresh = await session();
      await Promise.all([
        service.unlinkIdentity('user-1', 'firebase', { password: PASSWORD }, fresh.sid),
        service.unlinkIdentity('user-1', 'github', { password: PASSWORD }, fresh.sid),
      ]);
      expect(row().firebaseUid).toBeNull();
      expect(row().githubId).toBeNull();
    });

    it('la même identité déliée deux fois en parallèle : une seule écriture, l’autre 409', async () => {
      await seed(both());
      const fresh = await session();
      const results = await Promise.allSettled([
        service.unlinkIdentity('user-1', 'github', { password: PASSWORD }, fresh.sid),
        service.unlinkIdentity('user-1', 'github', { password: PASSWORD }, fresh.sid),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(mail.sendIdentityUnlinkedEmail).toHaveBeenCalledTimes(1);
    });
  });

  it('getIdentities renvoie l’adresse Firebase et le nom GitHub, sans aucun jeton', async () => {
    await seed({
      firebaseUid: 'fb-uid-1',
      firebaseEmail: 'perso@example.com',
      githubId: '4242',
      githubUsername: 'ada-gh',
      githubAccessToken: encrypt('gho_secret'),
    });
    const res = await service.getIdentities('user-1');
    expect(res).toEqual({
      firebase: { linked: true, email: 'perso@example.com' },
      github: { linked: true, username: 'ada-gh' },
      hasPassword: true,
      mfaEnabled: false,
      canUnlink: { firebase: true, github: true },
    });
    expect(JSON.stringify(res)).not.toMatch(/gho_|fb-uid|ssoUid/);
  });

  // P9-L-a : une seule règle « dernière méthode de connexion », pour la lecture et la déliaison
  describe('canUnlink et ssoUid (P9-L-a)', () => {
    const gh = { githubId: '4242', githubUsername: 'ada-gh' };

    it('sans mot de passe, avec ssoUid et GitHub : canUnlink vrai et la déliaison réussit', async () => {
      await seed({ ...gh, ssoUid: 'sso-1' }, false);
      const res = await service.getIdentities('user-1');
      expect(res.canUnlink).toEqual({ firebase: false, github: true });
      expect(res).not.toHaveProperty('ssoUid');
      const fresh = await session();
      await service.unlinkIdentity('user-1', 'github', {}, fresh.sid);
      expect(row().githubId).toBeNull();
    });

    it('sans mot de passe ni ssoUid, une seule identité : canUnlink faux, déliaison 409', async () => {
      await seed(gh, false);
      expect((await service.getIdentities('user-1')).canUnlink).toEqual({
        firebase: false,
        github: false,
      });
      const fresh = await session();
      await expect(service.unlinkIdentity('user-1', 'github', {}, fresh.sid)).rejects.toThrow(
        ConflictException,
      );
    });

    it('avec un mot de passe, une identité liée : canUnlink vrai pour elle seule', async () => {
      await seed(gh);
      expect((await service.getIdentities('user-1')).canUnlink).toEqual({
        firebase: false,
        github: true,
      });
    });

    it('deux identités sans mot de passe : chacune est déliable', async () => {
      await seed({ ...gh, firebaseUid: 'fb-1', firebaseEmail: 'p@e.fr' }, false);
      expect((await service.getIdentities('user-1')).canUnlink).toEqual({
        firebase: true,
        github: true,
      });
    });
  });

  it('FirebaseLinkDto : idToken borné à 4096 caractères', async () => {
    const make = (idToken: string) => Object.assign(new FirebaseLinkDto(), { idToken });
    expect(await validate(make('a'.repeat(4096)))).toHaveLength(0);
    expect(await validate(make('a'.repeat(4097)))).not.toHaveLength(0);
  });
});
