import { Test, TestingModule } from '@nestjs/testing';
import { CalendarSyncService } from '../../../src/projects/calendar-sync.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decrypt } from '../../../src/auth/encryption.util';

const FIXTURE_ICS = readFileSync(
  join(__dirname, '../../fixtures/calendar/sample-feed.ics'),
  'utf8',
);
const OAUTH_ENV_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
];

describe('CalendarSyncService', () => {
  let service: CalendarSyncService;
  let prisma: PrismaService;

  const mockPrisma = {
    integration: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    timeBlock: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
    },
    task: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  };

  const savedEnv = { ...process.env };
  let integrationStore: Array<Record<string, unknown>> = [];

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...savedEnv };
  });

  beforeEach(async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(32); // Clé de chiffrement de 32 octets requise par l'utilitaire
    for (const key of OAUTH_ENV_KEYS) delete process.env[key];

    const module: TestingModule = await Test.createTestingModule({
      providers: [CalendarSyncService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<CalendarSyncService>(CalendarSyncService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
    // Magasin simulé : findFirst applique le filtre where, findUnique ne regarde que l'id
    integrationStore = [];
    mockPrisma.integration.findFirst.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) =>
        integrationStore.find((i) => Object.entries(where).every(([k, v]) => i[k] === v)) ?? null,
    );
    mockPrisma.integration.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        integrationStore.find((i) => i.id === where.id) ?? null,
    );
  });

  describe('exportToCalendar', () => {
    it("devrait rejeter si l'intégration est introuvable", async () => {
      integrationStore = [];

      await expect(service.exportToCalendar('workspace-123', 'int-not-found')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("devrait rejeter si le type d'intégration n'est pas un calendrier", async () => {
      integrationStore.push({
        workspaceId: 'workspace-123',
        id: 'int-123',
        type: 'SLACK',
      });

      await expect(service.exportToCalendar('workspace-123', 'int-123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("S5 : refuse l'export d'une intégration non connectée au lieu d'annoncer un faux succès", async () => {
      integrationStore.push({
        workspaceId: 'workspace-123',
        id: 'int-cal',
        type: 'GOOGLE_CALENDAR',
        accessToken: null,
      });
      mockPrisma.timeBlock.findMany.mockResolvedValue([
        { id: 'block-1', task: { title: 'Tâche A' } },
      ]);
      const fetchSpy = jest.spyOn(global, 'fetch');

      await expect(service.exportToCalendar('workspace-123', 'int-cal')).rejects.toThrow(
        BadRequestException,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('exporte réellement les créneaux via l’API du fournisseur et compte les succès', async () => {
      process.env.GOOGLE_CLIENT_ID = 'gid';
      process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
      const { encrypt } = jest.requireActual('../../../src/auth/encryption.util');
      integrationStore.push({
        workspaceId: 'workspace-123',
        id: 'int-cal',
        type: 'GOOGLE_CALENDAR',
        accessToken: encrypt('vrai-jeton'),
        calendarId: 'primary',
      });
      mockPrisma.timeBlock.findMany.mockResolvedValue([
        { id: 'block-1', startTime: new Date(), endTime: new Date(), task: { title: 'Tâche A' } },
        { id: 'block-2', startTime: new Date(), endTime: new Date(), task: { title: 'Tâche B' } },
      ]);
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

      const result = await service.exportToCalendar('workspace-123', 'int-cal');

      expect(result).toEqual({ success: true, exportedCount: 2, exportedRealCount: 2 });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('googleapis.com'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer vrai-jeton' }),
        }),
      );
    });
  });

  describe('detectCalendarConflicts', () => {
    it("devrait retourner un tableau vide si aucun calendrier externe n'est connecté", async () => {
      mockPrisma.integration.findMany.mockResolvedValue([]);

      const result = await service.detectCalendarConflicts('workspace-123');

      expect(prisma.integration.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          active: true,
          type: { in: ['GOOGLE_CALENDAR', 'OUTLOOK'] },
        },
      });
      expect(result).toEqual([]);
    });

    it('S5 : une intégration sans source réelle ne produit aucun événement simulé', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        { id: 'int-gcal', type: 'GOOGLE_CALENDAR', active: true },
        { id: 'int-out', type: 'OUTLOOK', active: true, accessToken: 'iv:tag:enc' },
      ]);
      mockPrisma.timeBlock.findMany.mockResolvedValue([
        {
          id: 'block-1',
          startTime: new Date('2026-06-01T11:00:00Z'),
          endTime: new Date('2026-06-01T13:00:00Z'),
          task: {
            title: 'Tâche urgente de dev',
            assignees: [{ user: { id: 'user-alice', name: 'Alice', email: 'alice@test.com' } }],
          },
        },
      ]);
      const fetchSpy = jest.spyOn(global, 'fetch');

      const conflicts = await service.detectCalendarConflicts('workspace-123');

      expect(conflicts).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('détecte un conflit réel à partir d’un flux ICS attribué par adresse e-mail', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        {
          id: 'int-ics',
          type: 'GOOGLE_CALENDAR',
          active: true,
          url: 'https://calendar.example/feed.ics',
          calendarId: 'alice@corp.com',
        },
      ]);
      mockPrisma.timeBlock.findMany.mockResolvedValue([
        {
          id: 'block-1',
          startTime: new Date('2026-06-01T11:00:00Z'),
          endTime: new Date('2026-06-01T13:00:00Z'),
          task: {
            title: 'Tâche urgente de dev',
            assignees: [{ user: { id: 'user-alice', name: 'Alice', email: 'alice@corp.com' } }],
          },
        },
      ]);
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true, text: async () => FIXTURE_ICS } as Response);

      const conflicts = await service.detectCalendarConflicts('workspace-123');

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].externalEventTitle).toBe('Rendez-vous externe');
      expect(conflicts[0].message).toContain("Conflit d'agenda pour Alice");
    });

    it('S5 : un flux sans adresse cible n’est attribué à personne (plus de repli alice@test.com)', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        {
          id: 'int-ics',
          type: 'GOOGLE_CALENDAR',
          active: true,
          url: 'https://calendar.example/f.ics',
          calendarId: 'primary',
        },
      ]);
      mockPrisma.timeBlock.findMany.mockResolvedValue([
        {
          id: 'block-1',
          startTime: new Date('2026-06-01T11:00:00Z'),
          endTime: new Date('2026-06-01T13:00:00Z'),
          task: {
            title: 'Tâche',
            assignees: [{ user: { id: 'user-alice', name: 'Alice', email: 'alice@test.com' } }],
          },
        },
      ]);
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true, text: async () => FIXTURE_ICS } as Response);

      expect(await service.detectCalendarConflicts('workspace-123')).toEqual([]);
    });

    it('devrait ne détecter aucun conflit si les créneaux locaux ne chevauchent pas les événements externes', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        { id: 'int-gcal', type: 'GOOGLE_CALENDAR', active: true },
      ]);

      // Un bloc horaire pour Alice le 01 Juin 2026 de 08:00 à 09:30 (aucun chevauchement avec 10:00 - 12:00)
      const localTimeBlocks = [
        {
          id: 'block-1',
          startTime: new Date('2026-06-01T08:00:00Z'),
          endTime: new Date('2026-06-01T09:30:00Z'),
          task: {
            title: 'Daily Meeting',
            assignees: [
              {
                user: {
                  id: 'user-alice',
                  name: 'Alice',
                  email: 'alice@test.com',
                },
              },
            ],
          },
        },
      ];

      mockPrisma.timeBlock.findMany.mockResolvedValue(localTimeBlocks);

      const result = await service.detectCalendarConflicts('workspace-123');

      expect(result.length).toBe(0);
    });

    it('propage une erreur claire quand un flux de calendrier externe est indisponible', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        { id: 'int-calendar', type: 'GOOGLE_CALENDAR', url: 'https://calendar.example/feed.ics' },
      ]);
      mockPrisma.timeBlock.findMany.mockResolvedValue([
        {
          id: 'block-1',
          startTime: new Date('2026-06-01T11:00:00Z'),
          endTime: new Date('2026-06-01T13:00:00Z'),
          task: { title: 'Tâche', assignees: [] },
        },
      ]);
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      } as Response);

      await expect(service.detectCalendarConflicts('workspace-123')).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('propage une erreur claire quand le flux externe renvoie un format invalide', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        { id: 'int-calendar', type: 'GOOGLE_CALENDAR', url: 'https://calendar.example/feed.ics' },
      ]);
      mockPrisma.timeBlock.findMany.mockResolvedValue([
        {
          id: 'block-1',
          startTime: new Date('2026-06-01T11:00:00Z'),
          endTime: new Date('2026-06-01T13:00:00Z'),
          task: { title: 'Tâche', assignees: [] },
        },
      ]);
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => 'unsupported response',
      } as Response);

      await expect(service.detectCalendarConflicts('workspace-123')).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('generateAuthUrl', () => {
    it('devrait générer des URLs contenant les scopes et redirect_uri appropriés', () => {
      process.env.GOOGLE_CLIENT_ID = 'gid';
      process.env.MICROSOFT_CLIENT_ID = 'mid';
      const googleUrl = service.generateAuthUrl('GOOGLE_CALENDAR', 'ws-123');
      expect(googleUrl).toContain('accounts.google.com');
      expect(googleUrl).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar');

      const outlookUrl = service.generateAuthUrl('OUTLOOK', 'ws-123');
      expect(outlookUrl).toContain('login.microsoftonline.com');
      expect(outlookUrl).toContain('ws-123%3AOUTLOOK');
      expect(googleUrl).toContain('client_id=gid');
    });

    it('S5 : sans identifiant client OAuth, aucune URL factice (mock-*) n’est générée', () => {
      expect(() => service.generateAuthUrl('GOOGLE_CALENDAR', 'ws-123')).toThrow(
        ServiceUnavailableException,
      );
      expect(() => service.generateAuthUrl('OUTLOOK', 'ws-123')).toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('handleOAuthCallback', () => {
    it('chiffre et stocke les jetons réellement obtenus auprès du fournisseur', async () => {
      process.env.GOOGLE_CLIENT_ID = 'gid';
      process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
      mockPrisma.integration.findFirst.mockResolvedValue(null);
      mockPrisma.integration.upsert.mockResolvedValue({
        id: 'new-int-123',
        type: 'GOOGLE_CALENDAR',
      });
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'at-reel', refresh_token: 'rt-reel', expires_in: 3600 }),
      } as Response);

      const result = await service.handleOAuthCallback(
        'ws-123',
        'GOOGLE_CALENDAR',
        'auth-code-123',
      );

      expect(result.success).toBe(true);
      const create = mockPrisma.integration.upsert.mock.calls[0][0].create;
      expect(create).toEqual(
        expect.objectContaining({ workspaceId: 'ws-123', type: 'GOOGLE_CALENDAR' }),
      );
      expect(decrypt(create.accessToken)).toBe('at-reel');
      expect(decrypt(create.refreshToken)).toBe('rt-reel');
    });

    it.each(['staging', 'development', 'test', undefined])(
      'S5 : identifiants absents (NODE_ENV=%s) : erreur, aucun jeton mock persisté',
      async (nodeEnv) => {
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
        const fetchSpy = jest.spyOn(global, 'fetch');

        await expect(
          service.handleOAuthCallback('ws-123', 'GOOGLE_CALENDAR', 'code'),
        ).rejects.toThrow(ServiceUnavailableException);

        expect(mockPrisma.integration.upsert).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );

    it('S5 : échec de l’échange de code hors production : erreur, aucun jeton mock persisté', async () => {
      process.env.NODE_ENV = 'staging';
      process.env.GOOGLE_CLIENT_ID = 'gid';
      process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      } as Response);

      await expect(
        service.handleOAuthCallback('ws-123', 'GOOGLE_CALENDAR', 'code'),
      ).rejects.toThrow(BadGatewayException);
      expect(mockPrisma.integration.upsert).not.toHaveBeenCalled();
    });
  });

  describe('refreshAccessToken', () => {
    it("devrait lever NotFoundException si l'intégration n'a pas de refresh token", async () => {
      integrationStore.push({
        workspaceId: 'workspace-123',
        id: 'int-123',
        refreshToken: null,
      });

      await expect(service.refreshAccessToken('workspace-123', 'int-123')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('devrait lever une erreur en production si les credentials manquent', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      integrationStore.push({
        workspaceId: 'workspace-123',
        id: 'int-123',
        type: 'GOOGLE_CALENDAR',
        refreshToken: 'iv:tag:enc',
      });

      await expect(service.refreshAccessToken('workspace-123', 'int-123')).rejects.toThrow();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('refreshAccessToken hors production', () => {
    it('S5 : identifiants absents en staging : erreur, aucun jeton mock enregistré', async () => {
      process.env.NODE_ENV = 'staging';
      integrationStore.push({
        workspaceId: 'workspace-123',
        id: 'int-123',
        type: 'GOOGLE_CALENDAR',
        refreshToken: jest.requireActual('../../../src/auth/encryption.util').encrypt('rt'),
      });

      await expect(service.refreshAccessToken('workspace-123', 'int-123')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockPrisma.integration.update).not.toHaveBeenCalled();
    });
  });

  describe('syncCalendarEvents (S5)', () => {
    it('sans URL ni jeton : 0 import, intégration signalée NOT_CONFIGURED, aucune écriture', async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        { id: 'int-vide', type: 'GOOGLE_CALENDAR', active: true },
        { id: 'int-sans-creds', type: 'OUTLOOK', active: true, accessToken: 'iv:tag:enc' },
      ]);
      mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
      const fetchSpy = jest.spyOn(global, 'fetch');

      const result = await service.syncCalendarEvents('ws-1', 'user-appelant');

      expect(result).toEqual({
        importedCount: 0,
        skipped: [
          { integrationId: 'int-vide', reason: 'NOT_CONFIGURED' },
          { integrationId: 'int-sans-creds', reason: 'NOT_CONFIGURED' },
        ],
      });
      expect(mockPrisma.timeBlock.create).not.toHaveBeenCalled();
      expect(mockPrisma.task.create).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("importe un flux réel et crée la tâche de synchronisation au nom de l'appelant", async () => {
      mockPrisma.integration.findMany.mockResolvedValue([
        {
          id: 'int-ics',
          type: 'GOOGLE_CALENDAR',
          active: true,
          url: 'https://calendar.example/f.ics',
        },
      ]);
      mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
      mockPrisma.task.findFirst.mockResolvedValue(null);
      mockPrisma.task.create.mockResolvedValue({ id: 'sync-task' });
      mockPrisma.timeBlock.findFirst.mockResolvedValue(null);
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true, text: async () => FIXTURE_ICS } as Response);

      const result = await service.syncCalendarEvents('ws-1', 'user-appelant');

      expect(result.importedCount).toBe(2);
      expect(mockPrisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-appelant', projectId: 'project-1' }),
      });
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('production error handling', () => {
    it('devrait lever une erreur en production si handleOAuthCallback manque de credentials', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      await expect(
        service.handleOAuthCallback('ws-123', 'GOOGLE_CALENDAR', 'code'),
      ).rejects.toThrow();

      process.env.NODE_ENV = originalEnv;
    });
  });

  // S14, étape 1 : une intégration n'est jamais utilisée hors de son workspace
  describe('S14 : isolation des intégrations par workspace', () => {
    const integrationOfB = () => ({
      id: 'int-B',
      workspaceId: 'ws-B',
      type: 'GOOGLE_CALENDAR',
      accessToken: jest.requireActual('../../../src/auth/encryption.util').encrypt('jeton-de-B'),
      refreshToken: jest.requireActual('../../../src/auth/encryption.util').encrypt('rt-de-B'),
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    });

    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = 'gid';
      process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
      integrationStore = [integrationOfB()];
    });

    it('exportToCalendar(wsA, intégrationDeB) : 404, ni rafraîchissement ni appel sortant', async () => {
      mockPrisma.timeBlock.findMany.mockResolvedValue([
        { id: 'b-1', startTime: new Date(), endTime: new Date(), task: { title: 'Créneau A' } },
      ]);
      const fetchSpy = jest.spyOn(global, 'fetch');
      const refreshSpy = jest.spyOn(service, 'refreshAccessToken');

      await expect(service.exportToCalendar('ws-A', 'int-B')).rejects.toThrow(NotFoundException);

      expect(refreshSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockPrisma.integration.update).not.toHaveBeenCalled();
    });

    it('refreshAccessToken(wsA, intégrationDeB) : 404, aucun échange de jeton', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      await expect(service.refreshAccessToken('ws-A', 'int-B')).rejects.toThrow(NotFoundException);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockPrisma.integration.update).not.toHaveBeenCalled();
    });
  });
});
