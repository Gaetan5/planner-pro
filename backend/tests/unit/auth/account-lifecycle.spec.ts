import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from '../../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../../src/auth/firebase-identity.service';
import { SessionService } from '../../../src/auth/session.service';
import { TokenService } from '../../../src/auth/token.service';
import { hashPassword, verifyPassword } from '../../../src/auth/encryption.util';
import { ResetPasswordDto } from '../../../src/auth/dto/password-reset.dto';
import { MailService } from '../../../src/mail/mail.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';
import { FakePrisma } from '../../http/fake-prisma';
import { FakeRedisService } from '../../http/fake-redis';

jest.setTimeout(30_000);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const PASSWORD = 'MotDePasse!2026';
const NEW_PASSWORD = 'NouveauMdp!2027';

/**
 * P6 + S27 : inscription générique avec vérification d'e-mail, réinitialisation de mot de passe,
 * jetons hachés à usage unique.
 */
describe('P6 : parcours de compte', () => {
  const savedEnv = { ...process.env };
  let service: AuthService;
  let sessions: SessionService;
  let prisma: FakePrisma;
  const mail = {
    sendEmailVerificationEmail: jest.fn().mockResolvedValue(true),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
    sendAccountExistsEmail: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret-p6-accounts-0123456789abcdef012';
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    jest.clearAllMocks();
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
        { provide: MailService, useValue: mail },
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
  const lastMailToken = (fn: jest.Mock) => fn.mock.calls[fn.mock.calls.length - 1].at(-1) as string;

  describe('P6-b : envoi détaché de la réponse (pas d’oracle temporel)', () => {
    /** Résolu seulement si l'appel se termine : une promesse d'e-mail jamais résolue ne doit rien bloquer. */
    const settles = async <T>(promise: Promise<T>): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("la réponse attend l'envoi de l'e-mail")), 3000),
        ),
      ]);
    const never = () => new Promise<boolean>(() => undefined);

    beforeEach(() => {
      mail.sendEmailVerificationEmail.mockImplementation(never);
      mail.sendPasswordResetEmail.mockImplementation(never);
      mail.sendAccountExistsEmail.mockImplementation(never);
    });
    afterEach(() => {
      mail.sendEmailVerificationEmail.mockResolvedValue(true);
      mail.sendPasswordResetEmail.mockResolvedValue(true);
      mail.sendAccountExistsEmail.mockResolvedValue(true);
    });

    it('register (adresse nouvelle ou existante), forgot et resend répondent avec le même message', async () => {
      await seed({ emailVerifiedAt: null });
      const fresh = await settles(service.register('nouvelle@corp.com', PASSWORD, 'N'));
      const duplicate = await settles(service.register('ada@corp.com', PASSWORD, 'X'));
      const forgotKnown = await settles(service.requestPasswordReset('ada@corp.com'));
      const forgotUnknown = await settles(service.requestPasswordReset('inconnu@corp.com'));
      const resendKnown = await settles(service.resendVerification('ada@corp.com'));
      const resendUnknown = await settles(service.resendVerification('inconnu@corp.com'));

      expect(duplicate).toEqual(fresh);
      expect(forgotKnown).toEqual(forgotUnknown);
      expect(resendKnown).toEqual(resendUnknown);
      // L'envoi a bien été déclenché (en arrière-plan)
      expect(mail.sendEmailVerificationEmail).toHaveBeenCalled();
      expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      expect(mail.sendAccountExistsEmail).toHaveBeenCalledTimes(1);
    });

    it('un envoi qui échoue ne fait pas échouer la réponse', async () => {
      mail.sendPasswordResetEmail.mockRejectedValue(new Error('SMTP indisponible'));
      await seed();
      await expect(service.requestPasswordReset('ada@corp.com')).resolves.toEqual(
        expect.objectContaining({ message: expect.any(String) }),
      );
    });
  });

  describe('inscription', () => {
    it('nouvelle adresse : compte non vérifié, aucune session, e-mail de vérification, jeton haché (24 h)', async () => {
      const result = await service.register('ada@corp.com', PASSWORD, 'Ada');

      expect(result).toEqual({ message: expect.stringMatching(/e-mail/i) });
      expect(prisma.refreshToken.rows).toHaveLength(0);
      expect(prisma.user.rows).toHaveLength(1);
      expect(prisma.user.rows[0].emailVerifiedAt).toBeNull();

      expect(mail.sendEmailVerificationEmail).toHaveBeenCalledTimes(1);
      const raw = lastMailToken(mail.sendEmailVerificationEmail);
      const stored = prisma.authToken.rows[0];
      expect(stored.tokenHash).toBe(sha256(raw));
      expect(stored.tokenHash).not.toBe(raw);
      expect(stored.type).toBe('EMAIL_VERIFICATION');
      const ttl = (stored.expiresAt as Date).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(23 * 3600_000);
      expect(ttl).toBeLessThanOrEqual(24 * 3600_000);
    });

    it('adresse déjà utilisée : MÊME réponse, aucune création ni modification, notification au titulaire', async () => {
      await seed();
      const fresh = await service.register('nouvelle@corp.com', PASSWORD, 'Nouvelle');
      mail.sendEmailVerificationEmail.mockClear();
      const updateSpy = jest.spyOn(prisma.user, 'update');
      const rowsBefore = prisma.user.rows.length;

      const duplicate = await service.register('ada@corp.com', PASSWORD, 'Usurpateur');

      expect(duplicate).toEqual(fresh);
      expect(prisma.user.rows).toHaveLength(rowsBefore);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(mail.sendEmailVerificationEmail).not.toHaveBeenCalled();
      expect(mail.sendAccountExistsEmail).toHaveBeenCalledWith('ada@corp.com');
    });
  });

  describe('connexion avant vérification', () => {
    it('mot de passe correct mais adresse non vérifiée : 403, aucune session', async () => {
      await seed({ emailVerifiedAt: null });
      await expect(service.login('ada@corp.com', PASSWORD)).rejects.toThrow(ForbiddenException);
      expect(prisma.refreshToken.rows).toHaveLength(0);
    });

    it('mauvais mot de passe sur un compte non vérifié : 401, indiscernable d’un compte inconnu', async () => {
      await seed({ emailVerifiedAt: null });
      await expect(service.login('ada@corp.com', 'mauvais-mot-de-passe')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('vérification d’adresse', () => {
    const register = async () => {
      await service.register('ada@corp.com', PASSWORD, 'Ada');
      return lastMailToken(mail.sendEmailVerificationEmail);
    };

    it('lien valide : adresse vérifiée, jeton consommé ; la connexion devient possible', async () => {
      const token = await register();
      await service.verifyEmail(token);
      expect(prisma.user.rows[0].emailVerifiedAt).toBeInstanceOf(Date);
      expect(prisma.authToken.rows[0].usedAt).toBeInstanceOf(Date);
      const login = await service.login('ada@corp.com', PASSWORD);
      expect('session' in login).toBe(true);
    });

    it('un lien ne sert qu’une fois', async () => {
      const token = await register();
      await service.verifyEmail(token);
      await expect(service.verifyEmail(token)).rejects.toThrow(BadRequestException);
    });

    it('lien expiré : refusé, adresse toujours non vérifiée', async () => {
      const token = await register();
      prisma.authToken.rows[0].expiresAt = new Date(Date.now() - 1000);
      await expect(service.verifyEmail(token)).rejects.toThrow(BadRequestException);
      expect(prisma.user.rows[0].emailVerifiedAt).toBeNull();
    });

    it('jeton inconnu : refusé', async () => {
      await expect(service.verifyEmail('inconnu')).rejects.toThrow(BadRequestException);
    });

    it('un jeton de réinitialisation ne vérifie pas une adresse (confusion de type)', async () => {
      await seed({ emailVerifiedAt: null });
      await service.requestPasswordReset('ada@corp.com');
      const resetToken = lastMailToken(mail.sendPasswordResetEmail);
      await expect(service.verifyEmail(resetToken)).rejects.toThrow(BadRequestException);
    });

    it('renvoi : nouveau lien pour un compte non vérifié, l’ancien est invalidé ; silencieux sinon', async () => {
      const first = await register();
      mail.sendEmailVerificationEmail.mockClear();

      const unknown = await service.resendVerification('inconnu@corp.com');
      expect(mail.sendEmailVerificationEmail).not.toHaveBeenCalled();

      const known = await service.resendVerification('ada@corp.com');
      expect(known).toEqual(unknown);
      expect(mail.sendEmailVerificationEmail).toHaveBeenCalledTimes(1);
      await expect(service.verifyEmail(first)).rejects.toThrow(BadRequestException);
      await service.verifyEmail(lastMailToken(mail.sendEmailVerificationEmail));

      mail.sendEmailVerificationEmail.mockClear();
      await service.resendVerification('ada@corp.com'); // déjà vérifiée
      expect(mail.sendEmailVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('réinitialisation du mot de passe', () => {
    it('demande : réponse identique pour une adresse connue ou inconnue, e-mail seulement si connue', async () => {
      await seed();
      const unknown = await service.requestPasswordReset('inconnu@corp.com');
      expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
      const known = await service.requestPasswordReset('ada@corp.com');
      expect(known).toEqual(unknown);
      expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);

      const raw = lastMailToken(mail.sendPasswordResetEmail);
      const stored = prisma.authToken.rows[0];
      expect(stored.tokenHash).toBe(sha256(raw));
      expect(stored.type).toBe('PASSWORD_RESET');
      const ttl = (stored.expiresAt as Date).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(29 * 60_000);
      expect(ttl).toBeLessThanOrEqual(30 * 60_000);
    });

    it('un nouveau lien invalide le précédent', async () => {
      await seed();
      await service.requestPasswordReset('ada@corp.com');
      const first = lastMailToken(mail.sendPasswordResetEmail);
      await service.requestPasswordReset('ada@corp.com');
      await expect(service.resetPassword(first, NEW_PASSWORD)).rejects.toThrow(BadRequestException);
    });

    it('réinitialisation : mot de passe changé, jeton consommé, TOUTES les sessions révoquées', async () => {
      await seed();
      const a = await sessions.issue({ id: 'user-1', email: 'ada@corp.com', name: 'Ada' });
      const b = await sessions.issue({ id: 'user-1', email: 'ada@corp.com', name: 'Ada' });
      await service.requestPasswordReset('ada@corp.com');
      const token = lastMailToken(mail.sendPasswordResetEmail);

      await service.resetPassword(token, NEW_PASSWORD);

      expect(
        (await verifyPassword(NEW_PASSWORD, prisma.user.rows[0].passwordHash as string)).isValid,
      ).toBe(true);
      expect(
        (await verifyPassword(PASSWORD, prisma.user.rows[0].passwordHash as string)).isValid,
      ).toBe(false);
      expect(prisma.authToken.rows[0].usedAt).toBeInstanceOf(Date);
      expect(await sessions.isSessionActive(a.sid, 'user-1')).toBe(false);
      expect(await sessions.isSessionActive(b.sid, 'user-1')).toBe(false);
      await expect(service.login('ada@corp.com', PASSWORD)).rejects.toThrow(UnauthorizedException);
      expect('session' in (await service.login('ada@corp.com', NEW_PASSWORD))).toBe(true);
    });

    it('prouve la propriété de l’adresse : un compte non vérifié (ou provisionné par SCIM) devient vérifié', async () => {
      await seed({ emailVerifiedAt: null, passwordHash: null, provisionedByWorkspaceId: 'ws-1' });
      await service.requestPasswordReset('ada@corp.com');
      await service.resetPassword(lastMailToken(mail.sendPasswordResetEmail), NEW_PASSWORD);
      expect(prisma.user.rows[0].emailVerifiedAt).toBeInstanceOf(Date);
      expect('session' in (await service.login('ada@corp.com', NEW_PASSWORD))).toBe(true);
    });

    it('un lien ne sert qu’une fois, et un lien expiré est refusé', async () => {
      await seed();
      await service.requestPasswordReset('ada@corp.com');
      const token = lastMailToken(mail.sendPasswordResetEmail);
      await service.resetPassword(token, NEW_PASSWORD);
      await expect(service.resetPassword(token, 'AutreMdp!2028')).rejects.toThrow(
        BadRequestException,
      );

      await service.requestPasswordReset('ada@corp.com');
      const second = lastMailToken(mail.sendPasswordResetEmail);
      prisma.authToken.rows.find((r) => r.tokenHash === sha256(second))!.expiresAt = new Date(
        Date.now() - 1000,
      );
      await expect(service.resetPassword(second, 'AutreMdp!2028')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('un jeton de vérification d’adresse ne réinitialise pas un mot de passe', async () => {
      await service.register('ada@corp.com', PASSWORD, 'Ada');
      const verification = lastMailToken(mail.sendEmailVerificationEmail);
      await expect(service.resetPassword(verification, NEW_PASSWORD)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('le changement de mot de passe et le marquage « vérifié » sont groupés dans une transaction', async () => {
      await seed({ emailVerifiedAt: null });
      await service.requestPasswordReset('ada@corp.com');
      const token = lastMailToken(mail.sendPasswordResetEmail);
      const txSpy = jest.spyOn(prisma, '$transaction');
      await service.resetPassword(token, NEW_PASSWORD);
      expect(txSpy).toHaveBeenCalledTimes(1);
    });

    it('le MFA n’est pas désactivé par une réinitialisation', async () => {
      await seed({ mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' });
      await service.requestPasswordReset('ada@corp.com');
      await service.resetPassword(lastMailToken(mail.sendPasswordResetEmail), NEW_PASSWORD);
      expect(prisma.user.rows[0].mfaEnabled).toBe(true);
      const login = (await service.login('ada@corp.com', NEW_PASSWORD)) as {
        mfaRequired?: boolean;
      };
      expect(login.mfaRequired).toBe(true);
    });

    it('politique de mot de passe appliquée au nouveau mot de passe (DTO)', async () => {
      const weak = plainToInstance(ResetPasswordDto, { token: 't', password: 'court' });
      const noDigit = plainToInstance(ResetPasswordDto, {
        token: 't',
        password: 'sansChiffreMaisLong',
      });
      const ok = plainToInstance(ResetPasswordDto, { token: 't', password: NEW_PASSWORD });
      expect((await validate(weak)).length).toBeGreaterThan(0);
      expect((await validate(noDigit)).length).toBeGreaterThan(0);
      expect(await validate(ok)).toHaveLength(0);
    });
  });
});
