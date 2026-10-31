import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { AuthService } from '../../../src/auth/auth.service';
import { FirebaseIdentityService } from '../../../src/auth/firebase-identity.service';
import { SessionService } from '../../../src/auth/session.service';
import { TokenService } from '../../../src/auth/token.service';
import { hashPassword, verifyPassword } from '../../../src/auth/encryption.util';
import { MailService } from '../../../src/mail/mail.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';
import { InvitationsService } from '../../../src/projects/invitations.service';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';
import { maskEmail } from '../../../src/projects/mask-email';
import { FakePrisma } from '../../http/fake-prisma';
import { FakeRedisService } from '../../http/fake-redis';

// `argon2.verify` est observé sans changer son comportement
jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const argon2 = require('argon2') as { verify: jest.Mock };

jest.setTimeout(30_000);

/** S27 : oracles d'énumération de comptes et comparaisons non constantes. */
describe('S27 : login sans oracle temporel', () => {
  const savedEnv = { ...process.env };
  let service: AuthService;
  let prisma: FakePrisma;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret-s27-0123456789abcdef0123456789';
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
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
    argon2.verify.mockClear();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('utilisateur absent : argon2.verify est exécuté (même coût que pour un compte existant)', async () => {
    await expect(service.login('inconnu@corp.com', 'MotDePasse!2026')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(argon2.verify).toHaveBeenCalledTimes(1);
  });

  it('compte sans mot de passe (SCIM, GitHub) : argon2.verify est exécuté aussi', async () => {
    await prisma.user.create({
      data: { id: 'u1', email: 'scim@corp.com', name: 'S', passwordHash: null },
    });
    await expect(service.login('scim@corp.com', 'MotDePasse!2026')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(argon2.verify).toHaveBeenCalledTimes(1);
  });

  it('compte existant : un seul argon2.verify, et même message d’erreur que pour un inconnu', async () => {
    await prisma.user.create({
      data: {
        id: 'u2',
        email: 'ada@corp.com',
        name: 'Ada',
        passwordHash: await hashPassword('MotDePasse!2026'),
        emailVerifiedAt: new Date(),
      },
    });
    argon2.verify.mockClear();
    const known = await service.login('ada@corp.com', 'mauvais').catch((e) => e);
    const unknown = await service.login('inconnu@corp.com', 'mauvais').catch((e) => e);
    expect(argon2.verify).toHaveBeenCalledTimes(2);
    expect(known.getResponse()).toEqual(unknown.getResponse());
  });
});

describe('S27 : comparaison PBKDF2 en temps constant', () => {
  const salt = '1234567890123456';
  const legacy = (password: string) =>
    `${salt}:${crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex')}`;

  afterEach(() => jest.restoreAllMocks());

  it('utilise crypto.timingSafeEqual', async () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    expect((await verifyPassword('legacy-pass', legacy('legacy-pass'))).isValid).toBe(true);
    expect((await verifyPassword('autre', legacy('legacy-pass'))).isValid).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('un hachage stocké mal formé est refusé sans exception', async () => {
    for (const stored of [`${salt}:abcd`, `${salt}:zz`, `${salt}:`, ':', 'sans-separateur']) {
      expect((await verifyPassword('x', stored)).isValid).toBe(false);
    }
  });
});

describe('S27 : e-mail d’invitation masqué', () => {
  it('maskEmail', () => {
    expect(maskEmail('jean.dupont@example.com')).toBe('j***@e***.com');
    expect(maskEmail('a@b.co.uk')).toBe('a***@b***.uk');
    expect(maskEmail('x@localhost')).toBe('x***@l***');
    expect(maskEmail('pasunemail')).toBe('***');
  });

  it('checkInvitation (route publique) ne renvoie pas l’adresse invitée complète', async () => {
    const prisma = {
      invitation: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 3600_000),
          role: 'MEMBER',
          projectId: null,
          email: 'jean.dupont@example.com',
          workspace: { name: 'WS' },
          invitedBy: { name: null, email: 'chef@example.com' },
          project: null,
        }),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: {} },
        { provide: FirestoreSyncService, useValue: {} },
      ],
    }).compile();

    const info = await module.get(InvitationsService).checkInvitation('jeton');

    const serialized = JSON.stringify(info);
    expect(serialized).not.toContain('jean.dupont');
    expect(serialized).not.toContain('example.com');
    expect(serialized).not.toContain('chef@example.com');
    expect(info.email).toBe('j***@e***.com');
  });
});
