import { Test, TestingModule } from '@nestjs/testing';
import { IntegrationService } from '../../../src/projects/integration.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('IntegrationService', () => {
  let service: IntegrationService;
  let prisma: PrismaService;

  const mockPrisma = {
    integration: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IntegrationService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<IntegrationService>(IntegrationService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('createIntegration', () => {
    it('devrait créer une intégration avec les paramètres fournis', async () => {
      const dto = {
        type: 'SLACK' as const,
        name: 'Slack Webhook',
        url: 'https://hooks.slack.com/services/123/456',
      };
      const workspaceId = 'workspace-123';

      mockPrisma.integration.create.mockResolvedValue({
        id: 'int-123',
        workspaceId,
        ...dto,
        active: true,
      });

      const result = await service.createIntegration(workspaceId, dto);

      expect(prisma.integration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            workspaceId,
            type: dto.type,
            name: dto.name,
            url: dto.url,
            calendarId: null,
            active: true,
          },
        }),
      );
      expect(result).toHaveProperty('id', 'int-123');
    });
  });

  describe('listIntegrations', () => {
    it("devrait retourner les intégrations avec l'URL masquée", async () => {
      const workspaceId = 'workspace-123';
      const mockList = [
        {
          id: 'int-1',
          type: 'SLACK',
          name: 'Slack',
          url: 'https://hooks.slack.com/services/ABC/XYZ',
          active: true,
        },
        {
          id: 'int-2',
          type: 'GOOGLE_CALENDAR',
          name: 'Google Calendar',
          calendarId: 'primary',
          url: null,
          active: true,
        },
      ];

      mockPrisma.integration.findMany.mockResolvedValue(mockList);

      const result = await service.listIntegrations(workspaceId);

      expect(prisma.integration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId }, orderBy: { createdAt: 'desc' } }),
      );
      expect(result[0].url).toContain('...****');
      expect(result[1].url).toBeNull();
    });
  });

  describe('toggleIntegration', () => {
    it("devrait inverser l'état actif de l'intégration", async () => {
      const integrationId = 'int-123';
      mockPrisma.integration.findUnique.mockResolvedValue({
        id: integrationId,
        active: true,
      });
      mockPrisma.integration.update.mockResolvedValue({
        id: integrationId,
        active: false,
      });

      const result = await service.toggleIntegration(integrationId);

      expect(prisma.integration.findUnique).toHaveBeenCalledWith({
        where: { id: integrationId },
      });
      expect(prisma.integration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: integrationId },
          data: { active: false },
        }),
      );
      expect(result.active).toBe(false);
    });

    it("devrait rejeter si l'intégration est introuvable", async () => {
      mockPrisma.integration.findUnique.mockResolvedValue(null);

      await expect(service.toggleIntegration('int-not-found')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteIntegration', () => {
    it("devrait supprimer l'intégration", async () => {
      const integrationId = 'int-123';
      mockPrisma.integration.findUnique.mockResolvedValue({ id: integrationId });
      mockPrisma.integration.delete.mockResolvedValue({ id: integrationId });

      const result = await service.deleteIntegration(integrationId);

      expect(prisma.integration.findUnique).toHaveBeenCalledWith({
        where: { id: integrationId },
      });
      expect(prisma.integration.delete).toHaveBeenCalledWith({
        where: { id: integrationId },
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('sendNotification', () => {
    it('devrait appeler findMany pour récupérer les intégrations actives de type SLACK ou TEAMS', async () => {
      const workspaceId = 'workspace-123';
      mockPrisma.integration.findMany.mockResolvedValue([]);

      await service.sendNotification(workspaceId, 'Test Event', 'Test Content');

      expect(prisma.integration.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId,
          active: true,
          type: { in: ['SLACK', 'TEAMS'] },
          url: { not: null },
        },
      });
    });
  });

  // P1 : l'état affiché reflète la source réelle, jamais un mode « démo »
  describe('getIntegrationsStatus (P1)', () => {
    const savedEnv = { ...process.env };
    afterEach(() => {
      process.env = { ...savedEnv };
    });

    const statusOf = async (integration: Record<string, unknown>) => {
      mockPrisma.integration.findMany.mockResolvedValue([
        { id: 'int-1', name: 'Agenda', active: true, expiresAt: null, ...integration },
      ]);
      const [result] = await service.getIntegrationsStatus('ws-1');
      return result;
    };

    beforeEach(() => {
      for (const key of [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'MICROSOFT_CLIENT_ID',
        'MICROSOFT_CLIENT_SECRET',
      ]) {
        delete process.env[key];
      }
    });

    it.each(['development', 'staging', 'production', undefined])(
      'calendrier sans URL ni jeton (NODE_ENV=%s) : NOT_CONFIGURED, jamais CONNECTED ni DEMO',
      async (nodeEnv) => {
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
        const result = await statusOf({ type: 'GOOGLE_CALENDAR' });
        expect(result.status).toBe('NOT_CONFIGURED');
      },
    );

    it('calendrier avec jeton mais sans identifiants serveur : NOT_CONFIGURED', async () => {
      const result = await statusOf({ type: 'OUTLOOK', accessToken: 'iv:tag:enc' });
      expect(result.status).toBe('NOT_CONFIGURED');
    });

    it('calendrier OAuth avec identifiants serveur : CONNECTED, ou EXPIRED si le jeton a expiré', async () => {
      process.env.GOOGLE_CLIENT_ID = 'gid';
      process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
      expect((await statusOf({ type: 'GOOGLE_CALENDAR', accessToken: 'iv:tag:enc' })).status).toBe(
        'CONNECTED',
      );
      expect(
        (
          await statusOf({
            type: 'GOOGLE_CALENDAR',
            accessToken: 'iv:tag:enc',
            expiresAt: new Date('2020-01-01T00:00:00Z'),
          })
        ).status,
      ).toBe('EXPIRED');
    });

    it('calendrier par flux URL : CONNECTED', async () => {
      const result = await statusOf({ type: 'GOOGLE_CALENDAR', url: 'https://cal.example/f.ics' });
      expect(result.status).toBe('CONNECTED');
    });

    it('webhook Slack sans URL : NOT_CONFIGURED ; avec URL : CONNECTED', async () => {
      expect((await statusOf({ type: 'SLACK' })).status).toBe('NOT_CONFIGURED');
      expect((await statusOf({ type: 'SLACK', url: 'https://hooks.slack.com/x' })).status).toBe(
        'CONNECTED',
      );
    });

    it('intégration désactivée : DISABLED', async () => {
      expect((await statusOf({ type: 'SLACK', active: false })).status).toBe('DISABLED');
    });

    it('la réponse ne contient ni jeton ni URL', async () => {
      const result = await statusOf({
        type: 'GOOGLE_CALENDAR',
        url: 'https://cal.example/f.ics',
        accessToken: 'iv:tag:enc',
        refreshToken: 'iv:tag:enc2',
      });
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
      expect(result).not.toHaveProperty('url');
    });
  });

  // S14, étape 1 : les jetons OAuth (même chiffrés) ne sortent jamais de l'API
  describe('listIntegrations (S14)', () => {
    it('la requête et la réponse ne contiennent ni accessToken ni refreshToken', async () => {
      mockPrisma.integration.findMany.mockImplementation(
        async ({ select }: { select?: Record<string, boolean> }) => {
          const row: Record<string, unknown> = {
            id: 'int-1',
            type: 'GOOGLE_CALENDAR',
            name: 'Agenda',
            url: null,
            calendarId: 'primary',
            active: true,
            accessToken: 'iv:tag:enc',
            refreshToken: 'iv:tag:enc2',
          };
          // Simule la projection Prisma : sans select, toutes les colonnes sont renvoyées
          return [
            select ? Object.fromEntries(Object.entries(row).filter(([k]) => select[k])) : row,
          ];
        },
      );

      const [result] = await service.listIntegrations('ws-1');

      const query = mockPrisma.integration.findMany.mock.calls[0][0];
      expect(query.select).toBeDefined();
      expect(query.select.accessToken).toBeUndefined();
      expect(query.select.refreshToken).toBeUndefined();
      expect(result).not.toHaveProperty('accessToken');
      expect(result).not.toHaveProperty('refreshToken');
      expect(result).toEqual(expect.objectContaining({ id: 'int-1', name: 'Agenda' }));
    });
  });

  describe('réponses de création et de bascule (S14)', () => {
    it('createIntegration et toggleIntegration projettent sans jetons', async () => {
      mockPrisma.integration.create.mockResolvedValue({ id: 'i-1' });
      mockPrisma.integration.findUnique.mockResolvedValue({ id: 'i-1', active: true });
      mockPrisma.integration.update.mockResolvedValue({ id: 'i-1', active: false });

      await service.createIntegration('ws-1', { type: 'SLACK', name: 'Canal' });
      await service.toggleIntegration('i-1');

      for (const call of [
        mockPrisma.integration.create.mock.calls[0][0],
        mockPrisma.integration.update.mock.calls[0][0],
      ]) {
        expect(call.select).toBeDefined();
        expect(call.select.accessToken).toBeUndefined();
        expect(call.select.refreshToken).toBeUndefined();
      }
    });
  });
});
