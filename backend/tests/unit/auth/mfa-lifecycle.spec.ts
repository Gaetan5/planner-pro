import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from '../../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../../src/auth/firebase-identity.service';
import { MailService } from '../../../src/mail/mail.service';
import { SessionService } from '../../../src/auth/session.service';
import { TokenService } from '../../../src/auth/token.service';
import { encrypt, decrypt, hashPassword } from '../../../src/auth/encryption.util';
import { generateTotpCode, generateTotpSecret } from '../../../src/auth/totp.util';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';
import { FakePrisma } from '../../http/fake-prisma';
import { FakeRedisService } from '../../http/fake-redis';

// Chaque code de récupération est haché en Argon2id (coûteux) : marge pour une machine chargée
jest.setTimeout(30_000);

const ENCRYPTED = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/;
const PASSWORD = 'MotDePasse!2026';

/**
 * S6 : cycle de vie du MFA. Impossible de changer de facteur sans prouver le facteur actuel ET
 * le mot de passe ; aucun secret TOTP en clair ; un code ne passe qu'une fois ; codes de secours.
 */
describe('S6 : cycle de vie du MFA', () => {
  const savedEnv = { ...process.env };
  let service: AuthService;
  let sessions: SessionService;
  let prisma: FakePrisma;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret-s6-mfa-0123456789abcdef0123456';
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    delete process.env.FEATURE_SSO_ENABLED;
    prisma = new FakePrisma();
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
      providers: [
        AuthService,
        SessionService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: new FakeRedisService() },
        { provide: FirebaseIdentityService, useValue: {} },
        { provide: MailService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
    sessions = module.get(SessionService);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  const seed = async (overrides: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: {
        id: 'user-1',
        email: 'ada@corp.com',
        name: 'Ada',
        passwordHash: await hashPassword(PASSWORD),
        ...overrides,
      },
    });
  const userRow = () => prisma.user.rows[0];

  /** Compte avec MFA actif, secret stocké chiffré comme après correction. */
  const seedMfaUser = async (extra: Record<string, unknown> = {}) => {
    const secret = generateTotpSecret();
    await seed({ mfaEnabled: true, mfaSecret: encrypt(secret), ...extra });
    return secret;
  };

  /** Code TOTP du pas suivant : évite l'anti-rejeu quand un code du pas courant a déjà servi. */
  const nextStepCode = (secret: string) => generateTotpCode(secret, Date.now() + 30_000);

  describe('activation', () => {
    it('setupMfa avec MFA déjà actif : 409, secret actuel intact', async () => {
      await seedMfaUser();
      const before = userRow().mfaSecret;
      const updateSpy = jest.spyOn(prisma.user, 'update');

      await expect(service.setupMfa('user-1', { password: PASSWORD })).rejects.toThrow(
        ConflictException,
      );

      expect(updateSpy).not.toHaveBeenCalled();
      expect(userRow().mfaSecret).toBe(before);
    });

    it('setupMfa stocke le secret en attente, chiffré, sans toucher mfaSecret', async () => {
      await seed();
      const { secret } = await service.setupMfa('user-1', { password: PASSWORD });

      expect(userRow().mfaPendingSecret).toMatch(ENCRYPTED);
      expect(userRow().mfaPendingSecret).not.toContain(secret);
      expect(decrypt(userRow().mfaPendingSecret as string)).toBe(secret);
      expect(userRow().mfaSecret).toBeNull();
      expect(userRow().mfaEnabled).toBe(false);
    });

    it('S6-b : setupMfa sans mot de passe (compte avec mot de passe) : refusé, aucune écriture', async () => {
      await seed();
      const updateSpy = jest.spyOn(prisma.user, 'update');
      await expect(service.setupMfa('user-1', {})).rejects.toThrow(ForbiddenException);
      await expect(service.setupMfa('user-1', { password: 'mauvais' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(updateSpy).not.toHaveBeenCalled();
      expect(userRow().mfaPendingSecret ?? null).toBeNull();
    });

    it('S6-b : compte sans mot de passe, connexion de plus de 5 minutes : refusé ; récente : accepté', async () => {
      await seed({ passwordHash: null });
      const stale = await sessions.issue(
        { id: 'user-1', email: 'ada@corp.com', name: 'Ada' },
        { authenticatedAt: new Date(Date.now() - 10 * 60 * 1000) },
      );
      await expect(service.setupMfa('user-1', {}, stale.sid)).rejects.toThrow(ForbiddenException);
      expect(userRow().mfaPendingSecret ?? null).toBeNull();

      const fresh = await sessions.issue({ id: 'user-1', email: 'ada@corp.com', name: 'Ada' });
      await service.setupMfa('user-1', {}, fresh.sid);
      expect(userRow().mfaPendingSecret).toMatch(ENCRYPTED);
    });

    it('confirmMfa promeut le secret chiffré, active le MFA et livre 10 codes de secours hachés', async () => {
      await seed();
      const { secret } = await service.setupMfa('user-1', { password: PASSWORD });

      const result = await service.confirmMfa('user-1', generateTotpCode(secret));

      expect(userRow().mfaEnabled).toBe(true);
      expect(userRow().mfaSecret).toMatch(ENCRYPTED);
      expect(decrypt(userRow().mfaSecret as string)).toBe(secret);
      expect(userRow().mfaPendingSecret).toBeNull();
      expect(result.recoveryCodes).toHaveLength(10);
      expect(new Set(result.recoveryCodes).size).toBe(10);
      const stored = prisma.mfaRecoveryCode.rows;
      expect(stored).toHaveLength(10);
      for (const code of result.recoveryCodes) {
        expect(stored.some((r) => r.codeHash === code)).toBe(false);
      }
      expect(stored.every((r) => String(r.codeHash).startsWith('$argon2'))).toBe(true);
    });

    it('confirmMfa avec un mauvais code : 400, rien n’est promu', async () => {
      await seed();
      await service.setupMfa('user-1', { password: PASSWORD });
      await expect(service.confirmMfa('user-1', '000000')).rejects.toThrow(BadRequestException);
      expect(userRow().mfaEnabled).toBe(false);
      expect(userRow().mfaSecret).toBeNull();
    });

    it('confirmMfa quand le MFA est déjà actif : 409 (pas de nouveaux codes de secours)', async () => {
      await seedMfaUser();
      await expect(service.confirmMfa('user-1', '123456')).rejects.toThrow(ConflictException);
      expect(prisma.mfaRecoveryCode.rows).toHaveLength(0);
    });
  });

  describe('désactivation et changement de facteur', () => {
    it('disableMfa sans mot de passe (compte avec mot de passe) : refusé, MFA toujours actif', async () => {
      const secret = await seedMfaUser();
      await expect(
        service.disableMfa('user-1', { code: generateTotpCode(secret) }, 'sid-x'),
      ).rejects.toThrow(ForbiddenException);
      expect(userRow().mfaEnabled).toBe(true);
    });

    it('disableMfa avec un mauvais mot de passe : refusé', async () => {
      const secret = await seedMfaUser();
      await expect(
        service.disableMfa(
          'user-1',
          { code: generateTotpCode(secret), password: 'mauvais' },
          'sid-x',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(userRow().mfaEnabled).toBe(true);
    });

    it('disableMfa avec le bon mot de passe mais un mauvais code : refusé', async () => {
      await seedMfaUser();
      await expect(
        service.disableMfa('user-1', { code: '000000', password: PASSWORD }, 'sid-x'),
      ).rejects.toThrow(BadRequestException);
      expect(userRow().mfaEnabled).toBe(true);
    });

    it('disableMfa avec code ET mot de passe : MFA retiré, secrets effacés, codes de secours supprimés, autres sessions révoquées', async () => {
      const secret = await seedMfaUser();
      await prisma.mfaRecoveryCode.create({ data: { userId: 'user-1', codeHash: '$argon2id$x' } });
      const current = await sessions.issue({ id: 'user-1', email: 'ada@corp.com', name: 'Ada' });
      const other = await sessions.issue({ id: 'user-1', email: 'ada@corp.com', name: 'Ada' });

      await service.disableMfa(
        'user-1',
        { code: generateTotpCode(secret), password: PASSWORD },
        current.sid,
      );

      expect(userRow().mfaEnabled).toBe(false);
      expect(userRow().mfaSecret).toBeNull();
      expect(userRow().mfaPendingSecret).toBeNull();
      expect(prisma.mfaRecoveryCode.rows).toHaveLength(0);
      expect(await sessions.isSessionActive(current.sid, 'user-1')).toBe(true);
      expect(await sessions.isSessionActive(other.sid, 'user-1')).toBe(false);
    });

    it('compte sans mot de passe : réauthentification de moins de 5 minutes exigée', async () => {
      const secret = await seedMfaUser({ passwordHash: null });
      const stale = await sessions.issue(
        { id: 'user-1', email: 'ada@corp.com', name: 'Ada' },
        { authenticatedAt: new Date(Date.now() - 10 * 60 * 1000) },
      );
      await expect(
        service.disableMfa('user-1', { code: generateTotpCode(secret) }, stale.sid),
      ).rejects.toThrow(ForbiddenException);
      expect(userRow().mfaEnabled).toBe(true);

      const fresh = await sessions.issue({ id: 'user-1', email: 'ada@corp.com', name: 'Ada' });
      await service.disableMfa('user-1', { code: generateTotpCode(secret) }, fresh.sid);
      expect(userRow().mfaEnabled).toBe(false);
    });

    it('régénérer les codes de secours exige aussi code et mot de passe, et invalide les anciens', async () => {
      const secret = await seedMfaUser();
      await prisma.mfaRecoveryCode.create({
        data: { userId: 'user-1', codeHash: '$argon2id$old' },
      });

      await expect(
        service.regenerateRecoveryCodes('user-1', { code: generateTotpCode(secret) }, 'sid-x'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.mfaRecoveryCode.rows).toHaveLength(1);

      const result = await service.regenerateRecoveryCodes(
        'user-1',
        { code: generateTotpCode(secret), password: PASSWORD },
        'sid-x',
      );
      expect(result.recoveryCodes).toHaveLength(10);
      expect(prisma.mfaRecoveryCode.rows).toHaveLength(10);
      expect(prisma.mfaRecoveryCode.rows.some((r) => r.codeHash === '$argon2id$old')).toBe(false);
    });
  });

  describe('challenge de connexion', () => {
    const ticketFor = async () => {
      const result = (await service.login('ada@corp.com', PASSWORD)) as unknown as {
        mfaTicket: string;
      };
      return result.mfaTicket;
    };

    it('anti-rejeu : un même code TOTP ne passe qu’une fois, même avec un second ticket', async () => {
      const secret = await seedMfaUser();
      const code = generateTotpCode(secret);

      const first = await service.verifyMfaChallenge(await ticketFor(), { code });
      expect(first.session.accessToken).toEqual(expect.any(String));

      await expect(service.verifyMfaChallenge(await ticketFor(), { code })).rejects.toThrow();
      expect(prisma.refreshToken.rows).toHaveLength(1);

      // Le pas suivant reste utilisable
      const later = await service.verifyMfaChallenge(await ticketFor(), {
        code: nextStepCode(secret),
      });
      expect(later.session.accessToken).toEqual(expect.any(String));
    });

    it('un code de secours fonctionne une seule fois', async () => {
      await seedMfaUser();
      const recovery = 'ABCDE-FGHJK';
      await prisma.mfaRecoveryCode.create({
        data: { userId: 'user-1', codeHash: await hashPassword('ABCDEFGHJK') },
      });

      const ok = await service.verifyMfaChallenge(await ticketFor(), { recoveryCode: recovery });
      expect(ok.session.accessToken).toEqual(expect.any(String));
      expect(prisma.mfaRecoveryCode.rows[0].usedAt).toBeInstanceOf(Date);

      await expect(
        service.verifyMfaChallenge(await ticketFor(), { recoveryCode: recovery }),
      ).rejects.toThrow();
      expect(prisma.refreshToken.rows).toHaveLength(1);
    });

    it('sans code ni code de secours : 400', async () => {
      await seedMfaUser();
      await expect(service.verifyMfaChallenge(await ticketFor(), {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('transition : un secret encore en clair (avant migration des données) reste valide', async () => {
      const secret = generateTotpSecret();
      await seed({ mfaEnabled: true, mfaSecret: secret });
      const done = await service.verifyMfaChallenge(await ticketFor(), {
        code: generateTotpCode(secret),
      });
      expect(done.session.accessToken).toEqual(expect.any(String));
    });
  });
});
