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
      providers: [
        IntegrationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
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

      expect(prisma.integration.create).toHaveBeenCalledWith({
        data: {
          workspaceId,
          type: dto.type,
          name: dto.name,
          url: dto.url,
          calendarId: null,
          active: true,
        },
      });
      expect(result).toHaveProperty('id', 'int-123');
    });
  });

  describe('listIntegrations', () => {
    it('devrait retourner les intégrations avec l\'URL masquée', async () => {
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

      expect(prisma.integration.findMany).toHaveBeenCalledWith({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
      });
      expect(result[0].url).toContain('...****');
      expect(result[1].url).toBeNull();
    });
  });

  describe('toggleIntegration', () => {
    it('devrait inverser l\'état actif de l\'intégration', async () => {
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
      expect(prisma.integration.update).toHaveBeenCalledWith({
        where: { id: integrationId },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it('devrait rejeter si l\'intégration est introuvable', async () => {
      mockPrisma.integration.findUnique.mockResolvedValue(null);

      await expect(service.toggleIntegration('int-not-found')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteIntegration', () => {
    it('devrait supprimer l\'intégration', async () => {
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
});
