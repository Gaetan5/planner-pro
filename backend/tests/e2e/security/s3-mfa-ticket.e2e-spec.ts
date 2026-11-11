import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { encrypt, hashPassword } from '../../../src/auth/encryption.util';
import { generateTotpCode, generateTotpSecret } from '../../../src/auth/totp.util';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { prepareE2eEnvironment, startE2eApp } from '../support/e2e-app';

/**
 * A9 / S3 : critère de la CI. Application complète, vraie base et vrai Redis : le ticket MFA
 * émis par `POST /auth/login` ne doit donner accès à aucune route protégée, et ne sert qu'une
 * fois. Un PR qui réintroduirait S3 (ticket accepté comme jeton d'accès) fait échouer cette suite.
 */
prepareE2eEnvironment();

describe('S3 e2e : le ticket MFA n’est jamais un jeton d’accès', () => {
  const PASSWORD = 'MotDePasse!2026-e2e';
  const email = `s3-e2e-${randomUUID()}@e2e.example`;
  // Adresse cliente propre à cette exécution : compteurs de débit isolés (trust proxy = 1)
  const clientIp = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${
    1 + Math.floor(Math.random() * 250)
  }`;
  const PROTECTED_ROUTE = '/projects/workspaces';
  let app: INestApplication;
  let baseUrl: string;
  let prisma: PrismaService;
  let userId: string;
  let mfaSecret: string;
  let mfaTicket: string;

  const request = (method: string, path: string, init: { headers?: HeadersInit; body?: unknown }) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp,
        ...(init.headers as Record<string, string> | undefined),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  beforeAll(async () => {
    ({ app, baseUrl } = await startE2eApp());
    prisma = app.get(PrismaService);
    mfaSecret = generateTotpSecret();
    const user = await prisma.user.create({
      data: {
        email,
        name: 'Victime e2e',
        passwordHash: await hashPassword(PASSWORD),
        emailVerifiedAt: new Date(),
        mfaEnabled: true,
        mfaSecret: encrypt(mfaSecret),
      },
    });
    userId = user.id;

    const login = await request('POST', '/auth/login', { body: { email, passwordRaw: PASSWORD } });
    const body = await login.json();
    expect(body.mfaRequired).toBe(true);
    expect(body.accessToken).toBeUndefined();
    mfaTicket = body.mfaTicket;
    expect(typeof mfaTicket).toBe('string');
  });

  afterAll(async () => {
    if (prisma && userId) {
      // Clés étrangères RESTRICT vers User : journal, appartenances puis espace de travail créé à
      // la première lecture de /projects/workspaces ; sessions et codes de secours partent en cascade
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.membership.deleteMany({ where: { userId } });
      await prisma.workspace.deleteMany({ where: { ownerId: userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await app?.close();
  });

  it('sans jeton, la route protégée répond 401', async () => {
    expect((await request('GET', PROTECTED_ROUTE, {})).status).toBe(401);
  });

  it('le ticket MFA présenté en Bearer est rejeté (401)', async () => {
    const res = await request('GET', PROTECTED_ROUTE, {
      headers: { Authorization: `Bearer ${mfaTicket}` },
    });
    expect(res.status).toBe(401);
  });

  it('le ticket MFA présenté en cookie accessToken est rejeté (401)', async () => {
    const res = await request('GET', PROTECTED_ROUTE, {
      headers: { Cookie: `accessToken=${mfaTicket}` },
    });
    expect(res.status).toBe(401);
  });

  it('un jeton signé avec JWT_SECRET sans claim typ est rejeté (401)', async () => {
    const legacy = new JwtService({ secret: process.env.JWT_SECRET }).sign({
      sub: userId,
      email,
      mfaPending: true,
    });
    const res = await request('GET', PROTECTED_ROUTE, {
      headers: { Authorization: `Bearer ${legacy}` },
    });
    expect(res.status).toBe(401);
  });

  it('challenge réussi : la session fonctionne, puis le ticket ne peut pas être rejoué', async () => {
    const first = await request('POST', '/auth/mfa/challenge', {
      body: { mfaTicket, code: generateTotpCode(mfaSecret) },
    });
    expect(first.status).toBe(201);
    const accessToken = first.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('accessToken='))!
      .split(';')[0]
      .slice('accessToken='.length);
    expect(accessToken.length).toBeGreaterThan(20);

    const session = await request('GET', PROTECTED_ROUTE, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(session.status).toBe(200);

    // Code du pas suivant (accepté par la fenêtre TOTP et non encore consommé) : seul l'usage
    // unique du ticket peut expliquer le refus, pas l'anti-rejeu du code lui-même
    const replay = await request('POST', '/auth/mfa/challenge', {
      body: { mfaTicket, code: generateTotpCode(mfaSecret, Date.now() + 30_000) },
    });
    expect(replay.status).toBe(401);
  });
});
