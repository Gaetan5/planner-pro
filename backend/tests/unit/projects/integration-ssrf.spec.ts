import { BadRequestException, Logger } from '@nestjs/common';
import { AppValidationPipe } from '../../../src/common/app-validation.pipe';
import { CreateIntegrationDto } from '../../../src/projects/dto/create-integration.dto';
import { IntegrationService } from '../../../src/projects/integration.service';
import { safeFetch } from '../../../src/common/safe-fetch';

jest.mock('../../../src/common/safe-fetch', () => ({
  ...jest.requireActual('../../../src/common/safe-fetch'),
  safeFetch: jest.fn(),
}));
const safeFetchMock = safeFetch as jest.Mock;

describe('S19 : URL d’intégration', () => {
  const pipe = new AppValidationPipe();
  const validate = (value: object) =>
    pipe.transform(value, { type: 'body', metatype: CreateIntegrationDto });

  describe('CreateIntegrationDto (400)', () => {
    it('accepte une intégration valide', async () => {
      await expect(
        validate({ type: 'SLACK', name: 'Canal', url: 'https://hooks.slack.com/services/T/B/x' }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['type inconnu', { type: 'FOO', name: 'x' }],
      ['URL http', { type: 'SLACK', name: 'x', url: 'http://hooks.slack.com/services/a' }],
      ['URL javascript', { type: 'SLACK', name: 'x', url: 'javascript:alert(1)' }],
      ['hôte sans domaine', { type: 'GOOGLE_CALENDAR', name: 'x', url: 'https://cache/f.ics' }],
      [
        'URL trop longue',
        { type: 'OUTLOOK', name: 'x', url: `https://a.example/${'a'.repeat(2040)}` },
      ],
      ['nom vide', { type: 'SLACK', name: '' }],
      ['champ inconnu', { type: 'SLACK', name: 'x', active: false }],
    ])('rejette : %s', async (_label, body) => {
      await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('IntegrationService', () => {
    const prisma = { integration: { create: jest.fn(), findMany: jest.fn() } };
    const service = new IntegrationService(prisma as never);

    beforeEach(() => {
      jest.clearAllMocks();
      prisma.integration.create.mockResolvedValue({ id: 'i', url: null });
    });

    it.each([
      ['SLACK', 'https://evil.example/hook'],
      ['SLACK', 'https://hooks.slack.com.evil.example/x'],
      ['TEAMS', 'https://webhook.office.com.evil.example/x'],
      ['TEAMS', 'https://evil.example/x'],
      ['GOOGLE_CALENDAR', 'https://127.0.0.1/feed.ics'],
      ['OUTLOOK', 'https://[::1]/feed.ics'],
      ['OUTLOOK', 'https://169.254.169.254/'],
      ['GOOGLE_CALENDAR', 'https://cache/feed.ics'],
      ['GOOGLE_CALENDAR', 'https://example.com:6379/feed.ics'],
      ['GOOGLE_CALENDAR', 'http://example.com/feed.ics'],
    ])('createIntegration refuse %s %s', async (type, url) => {
      await expect(
        service.createIntegration('ws', { type: type as 'SLACK', name: 'x', url }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.integration.create).not.toHaveBeenCalled();
    });

    it.each([
      ['SLACK', 'https://hooks.slack.com/services/T/B/x'],
      ['TEAMS', 'https://contoso.webhook.office.com/webhookb2/x'],
      ['TEAMS', 'https://prod-12.westeurope.logic.azure.com/workflows/x'],
      ['GOOGLE_CALENDAR', 'https://calendar.google.com/calendar/ical/x/basic.ics'],
    ])('createIntegration accepte %s %s', async (type, url) => {
      await service.createIntegration('ws', { type: type as 'SLACK', name: 'x', url });
      expect(prisma.integration.create).toHaveBeenCalled();
    });

    describe('sendNotification', () => {
      const send = async (url: string, type = 'SLACK') => {
        prisma.integration.findMany.mockResolvedValue([{ id: 'i', type, name: 'n', url }]);
        await service.sendNotification('ws', 'evt', 'texte');
        await new Promise((r) => setImmediate(r));
      };

      it('poste via safeFetch, sans suivre de redirection, avec la liste blanche du type', async () => {
        safeFetchMock.mockResolvedValue({ ok: true, status: 200, contentType: '', text: 'ok' });
        await send('https://hooks.slack.com/services/T/B/x');
        const [url, options] = safeFetchMock.mock.calls[0];
        expect(url).toBe('https://hooks.slack.com/services/T/B/x');
        expect(options.method).toBe('POST');
        expect(options.maxRedirects).toBe(0);
        expect(options.allowHost('hooks.slack.com')).toBe(true);
        expect(options.allowHost('evil.example')).toBe(false);
        expect(options.allowHost('127.0.0.1')).toBe(false);
      });

      it('ne journalise jamais le corps de la réponse en cas d’échec', async () => {
        const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
        safeFetchMock.mockResolvedValue({
          ok: false,
          status: 500,
          contentType: '',
          text: 'SECRET-INTERNE-CORPS',
        });
        await send('https://hooks.slack.com/services/T/B/x');
        const logged = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
        expect(logged).toContain('HTTP 500');
        expect(logged).not.toContain('SECRET-INTERNE-CORPS');
        errorSpy.mockRestore();
      });
    });
  });
});
