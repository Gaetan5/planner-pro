/// <reference types="jest" />

import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer');

const SECRET = 'JETON-SECRET-A-NE-JAMAIS-JOURNALISER';

/**
 * P6-a : les liens de vérification et de réinitialisation sont des secrets. Hors développement
 * et test, le corps d'un e-mail n'est jamais journalisé (CWE-532) ; en production, pas de SMTP =
 * pas de démarrage ; le repli « simulé » après un échec d'envoi est réservé au développement.
 */
describe('MailService : aucun secret dans les journaux (P6-a)', () => {
  const savedEnv = { ...process.env };
  let logged: unknown[][];
  let sendMail: jest.Mock;

  const spyOnLogger = () => {
    logged = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }
  };
  const allLogs = () => JSON.stringify(logged, (_k, v) => (v instanceof Error ? v.message : v));

  const configure = (env: Record<string, string | undefined>) => {
    process.env = { ...savedEnv, FRONTEND_URL: 'https://app.test' };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  };
  const smtp = { SMTP_HOST: 'smtp.test', SMTP_PORT: '587' };

  beforeEach(() => {
    sendMail = jest.fn();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    spyOnLogger();
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  it('production, SMTP en échec : le jeton n’apparaît dans aucun appel au Logger, aucun repli simulé', async () => {
    configure({ NODE_ENV: 'production', ...smtp });
    sendMail.mockRejectedValue(new Error('connexion SMTP refusée'));
    const service = new MailService();

    expect(await service.sendPasswordResetEmail('ada@corp.com', SECRET)).toBe(false);
    expect(await service.sendEmailVerificationEmail('ada@corp.com', SECRET)).toBe(false);

    expect(allLogs()).not.toContain(SECRET);
    expect(allLogs()).not.toContain('ada@corp.com');
    expect(allLogs()).not.toContain('SIMULÉ');
    expect(allLogs()).toContain('a***@c***.com');
  });

  it('production, SMTP opérationnel : l’envoi réussi ne journalise pas non plus le jeton', async () => {
    configure({ NODE_ENV: 'production', ...smtp });
    sendMail.mockResolvedValue({ messageId: 'id-1' });
    const service = new MailService();
    expect(await service.sendPasswordResetEmail('ada@corp.com', SECRET)).toBe(true);
    expect(allLogs()).not.toContain(SECRET);
  });

  it('production sans SMTP : refus de démarrer', () => {
    configure({ NODE_ENV: 'production' });
    expect(() => new MailService()).toThrow(/SMTP/);
  });

  it('staging sans SMTP : rien n’est envoyé et le corps n’est pas journalisé', async () => {
    configure({ NODE_ENV: 'staging' });
    const service = new MailService();
    expect(await service.sendPasswordResetEmail('ada@corp.com', SECRET)).toBe(false);
    expect(allLogs()).not.toContain(SECRET);
  });

  it('développement : le mode simulé (lien visible dans la console) reste disponible', async () => {
    configure({ NODE_ENV: 'development' });
    const service = new MailService();
    expect(await service.sendPasswordResetEmail('ada@corp.com', SECRET)).toBe(true);
    expect(allLogs()).toContain(SECRET);
  });

  it('développement, SMTP en échec : repli simulé autorisé', async () => {
    configure({ NODE_ENV: 'development', ...smtp });
    sendMail.mockRejectedValue(new Error('refusé'));
    const service = new MailService();
    await service.sendPasswordResetEmail('ada@corp.com', SECRET);
    expect(allLogs()).toContain(SECRET);
  });
});

describe('MailService : e-mail de vérification (P6-d)', () => {
  it('ne contient aucun texte saisi par le demandeur (nom)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SMTP_HOST;
    const sent: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => {
      sent.push(String(m));
    });
    const service = new MailService();
    await service.sendEmailVerificationEmail('victime@corp.com', 'TOKEN-XYZ');
    expect(sent.join('\n')).toContain('TOKEN-XYZ');
    jest.restoreAllMocks();
  });
});
