/// <reference types="jest" />

import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer');

/** S20 : toute valeur saisie par un utilisateur est échappée dans le HTML des e-mails. */
describe('MailService : échappement HTML (S20)', () => {
  const savedEnv = { ...process.env };
  let sendMail: jest.Mock;
  let service: MailService;

  beforeEach(() => {
    sendMail = jest.fn().mockResolvedValue({ messageId: 'id' });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    process.env = {
      ...savedEnv,
      SMTP_HOST: 'smtp.test',
      SMTP_PORT: '587',
      FRONTEND_URL: 'https://app.test',
    };
    service = new MailService();
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    jest.clearAllMocks();
  });

  const sent = () => sendMail.mock.calls[0][0] as { subject: string; html: string; text: string };

  it('invitation : espace, invitant et rôle sont échappés, aucune balise injectée', async () => {
    await service.sendInvitationEmail(
      'cible@corp.com',
      '<a href=x>',
      '<img src=x onerror=alert(1)>',
      'tok123',
      '"><script>x</script>',
    );
    const { html } = sent();
    expect(html).toContain('&lt;a href=x&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<a href=x>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
  });

  it("invitation : le titre HTML est échappé et l'objet tient sur une ligne", async () => {
    await service.sendInvitationEmail(
      'cible@corp.com',
      'Acme</title><script>1</script>\r\nBcc: victime@corp.com',
      'Ada',
      'tok',
      'MEMBER',
    );
    const { html, subject } = sent();
    expect(html).not.toContain('</title><script>');
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;');
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('mention : expéditeur, titre de tâche et extrait sont échappés', async () => {
    await service.sendMentionEmail(
      'cible@corp.com',
      '<b>Ada</b>',
      '<a href="https://phishing.example">Voir</a>',
      '<form action="https://phishing.example"><input name=pwd></form>',
    );
    const { html, subject } = sent();
    expect(html).toContain('&lt;b&gt;Ada&lt;/b&gt;');
    expect(html).not.toContain('<b>Ada</b>');
    expect(html).toContain('&lt;a href=&quot;https://phishing.example&quot;&gt;Voir&lt;/a&gt;');
    expect(html).toContain('&lt;form action=');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<a href="https://phishing.example">');
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("invitation : un jeton qui sort de l'attribut href ne crée pas de balise", async () => {
    await service.sendInvitationEmail(
      'cible@corp.com',
      'Acme',
      'Ada',
      '"><script>x</script>',
      'MEMBER',
    );
    expect(sent().html).not.toContain('<script>');
  });

  it("l'envoi final remet l'objet sur une ligne, quel que soit l'appelant", async () => {
    await (
      service as unknown as {
        sendMail: (to: string, subject: string, text: string, html: string) => Promise<boolean>;
      }
    ).sendMail('cible@corp.com', 'Objet\r\nBcc: x@y.z', 't', 'h');
    expect(sent().subject).toBe('Objet Bcc: x@y.z');
  });

  it("mention : un saut de ligne dans le nom ne crée pas d'en-tête", async () => {
    await service.sendMentionEmail('cible@corp.com', 'Ada\r\nBcc: x@y.z', 'T', 'extrait');
    expect(sent().subject).not.toMatch(/[\r\n]/);
  });
});
