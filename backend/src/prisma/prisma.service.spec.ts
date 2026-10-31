import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildMariaDbOptions, PrismaService } from './prisma.service';

/**
 * S4 : pas de DSN root par défaut hors développement/test, TLS piloté par la configuration,
 * pas de récupération de clé publique hors développement sans TLS.
 */
describe('PrismaService : configuration de connexion (S4)', () => {
  const DSN = 'mysql://planner:s3cr%40t@db.internal:3307/planner_pro';
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('NODE_ENV=production sans DATABASE_URL : new PrismaService() lève une erreur', () => {
    process.env = { ...savedEnv, NODE_ENV: 'production' };
    delete process.env.DATABASE_URL;
    expect(() => new PrismaService()).toThrow(/DATABASE_URL/);
  });

  it.each([undefined, 'staging', 'prod'])(
    'NODE_ENV=%s sans DATABASE_URL : aucun repli vers le DSN root local',
    (nodeEnv) => {
      expect(() => buildMariaDbOptions({ NODE_ENV: nodeEnv })).toThrow(/DATABASE_URL/);
    },
  );

  it('NODE_ENV=development sans DATABASE_URL : repli local autorisé', () => {
    const options = buildMariaDbOptions({ NODE_ENV: 'development' });
    expect(options.host).toBe('localhost');
  });

  // A7 : une suite de tests ne doit jamais viser par défaut la base de développement locale
  it('NODE_ENV=test sans DATABASE_URL : erreur, aucun repli vers le DSN local', () => {
    expect(() => buildMariaDbOptions({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('sous Jest, DATABASE_URL est fixée sur une adresse injoignable (jamais la base de dev)', () => {
    const parsed = new URL(process.env.DATABASE_URL as string);
    expect(parsed.hostname).toBe('127.0.0.1');
    expect(parsed.port).toBe('1');
  });

  it('analyse DATABASE_URL (hôte, port, identifiants décodés, base)', () => {
    const options = buildMariaDbOptions({ NODE_ENV: 'staging', DATABASE_URL: DSN });
    expect(options).toEqual(
      expect.objectContaining({
        host: 'db.internal',
        port: 3307,
        user: 'planner',
        password: 's3cr@t',
        database: 'planner_pro',
      }),
    );
  });

  it('production avec TLS : allowPublicKeyRetrieval === false', () => {
    const options = buildMariaDbOptions({
      NODE_ENV: 'production',
      DATABASE_URL: DSN,
      DATABASE_SSL: 'true',
    });
    expect(options.allowPublicKeyRetrieval).toBe(false);
  });

  // S4 (r2) : TLS obligatoire en production ; la clé épinglée ne chiffre pas le trafic
  it.each([
    ['sans TLS', {}],
    ['avec seulement une clé RSA épinglée', { DATABASE_RSA_PUBLIC_KEY: '/inexistant.pem' }],
    ['avec DATABASE_SSL=false', { DATABASE_SSL: 'false' }],
  ])('production %s : arrêt au démarrage', (_label, extra) => {
    expect(() =>
      buildMariaDbOptions({ NODE_ENV: 'production', DATABASE_URL: DSN, ...extra }),
    ).toThrow(/DATABASE_SSL/);
  });

  it.each([undefined, 'staging'])(
    'NODE_ENV=%s (non listé) : allowPublicKeyRetrieval === false',
    (nodeEnv) => {
      const options = buildMariaDbOptions({ NODE_ENV: nodeEnv, DATABASE_URL: DSN });
      expect(options.allowPublicKeyRetrieval).toBe(false);
    },
  );

  it('DATABASE_SSL=true : TLS avec vérification du certificat, sans récupération de clé', () => {
    const options = buildMariaDbOptions({
      NODE_ENV: 'development',
      DATABASE_URL: DSN,
      DATABASE_SSL: 'true',
    });
    expect(options.ssl).toEqual(expect.objectContaining({ rejectUnauthorized: true }));
    expect(options.allowPublicKeyRetrieval).toBe(false);
  });

  it('DATABASE_SSL_CA : le certificat de l’autorité est chargé depuis le fichier', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's4-'));
    const caPath = path.join(dir, 'ca.pem');
    fs.writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
    const options = buildMariaDbOptions({
      NODE_ENV: 'production',
      DATABASE_URL: DSN,
      DATABASE_SSL: 'true',
      DATABASE_SSL_CA: caPath,
    });
    expect(options.ssl).toEqual({
      rejectUnauthorized: true,
      ca: expect.stringContaining('BEGIN CERTIFICATE'),
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('développement sans TLS : récupération de clé publique tolérée (MySQL 8 local)', () => {
    const options = buildMariaDbOptions({ NODE_ENV: 'development', DATABASE_URL: DSN });
    expect(options.ssl).toBeUndefined();
    expect(options.allowPublicKeyRetrieval).toBe(true);
  });

  it('DATABASE_RSA_PUBLIC_KEY en staging : clé publique du serveur épinglée (alternative sans TLS)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's4-'));
    const keyPath = path.join(dir, 'public_key.pem');
    fs.writeFileSync(keyPath, '-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----\n');
    const options = buildMariaDbOptions({
      NODE_ENV: 'staging',
      DATABASE_URL: DSN,
      DATABASE_RSA_PUBLIC_KEY: keyPath,
    });
    expect(options.cachingRsaPublicKey).toContain('BEGIN PUBLIC KEY');
    expect(options.allowPublicKeyRetrieval).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
