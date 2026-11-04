/* eslint-disable @typescript-eslint/no-explicit-any */
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IntegrationService } from '../../../src/projects/integration.service';
import { PrismaService } from '../../../src/prisma/prisma.service';

/** S14 (suite) : les méthodes du service filtrent par (workspaceId, integrationId) ; URL masquée. */
describe('S14 : IntegrationService scopé par workspace', () => {
  let service: IntegrationService;
  const rows: any[] = [
    {
      id: 'int-A',
      workspaceId: 'ws-A',
      type: 'SLACK',
      name: 'A',
      url: 'https://hooks.slack.com/services/T000/B000/SECRETSECRETSECRET',
      active: true,
    },
    { id: 'int-B', workspaceId: 'ws-B', type: 'SLACK', name: 'B', url: null, active: true },
  ];
  const prisma = {
    integration: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          rows.find(
            (r) => r.id === where.id && (!where.workspaceId || r.workspaceId === where.workspaceId),
          ) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => ({
        ...rows.find((r) => r.id === where.id),
        ...data,
      })),
      delete: jest.fn(async () => ({})),
      create: jest.fn(async ({ data }: any) => ({ id: 'int-new', ...data })),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [IntegrationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(IntegrationService);
  });

  it('toggleIntegration(ws-A, intégration de ws-B) : 404, aucune écriture', async () => {
    await expect(service.toggleIntegration('ws-A', 'int-B')).rejects.toThrow(NotFoundException);
    expect(prisma.integration.update).not.toHaveBeenCalled();
  });

  it('deleteIntegration(ws-A, intégration de ws-B) : 404, aucune suppression', async () => {
    await expect(service.deleteIntegration('ws-A', 'int-B')).rejects.toThrow(NotFoundException);
    expect(prisma.integration.delete).not.toHaveBeenCalled();
  });

  it('toggle et delete interrogent la base avec (id, workspaceId)', async () => {
    await service.toggleIntegration('ws-A', 'int-A');
    expect(prisma.integration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'int-A', workspaceId: 'ws-A' } }),
    );
    await service.deleteIntegration('ws-A', 'int-A');
    expect(prisma.integration.delete).toHaveBeenCalledWith({ where: { id: 'int-A' } });
  });

  it('la réponse de toggle masque l’URL du webhook', async () => {
    const result: any = await service.toggleIntegration('ws-A', 'int-A');
    expect(result.url).not.toContain('SECRETSECRET');
  });

  it('la réponse de create masque l’URL du webhook', async () => {
    const result: any = await service.createIntegration('ws-A', {
      type: 'SLACK',
      name: 'x',
      url: 'https://hooks.slack.com/services/T000/B000/SECRETSECRETSECRET',
    });
    expect(result.url).not.toContain('SECRETSECRET');
  });

  it('getWorkspaceIdOf renvoie le workspace propriétaire, ou null', async () => {
    await expect(service.getWorkspaceIdOf('int-A')).resolves.toBe('ws-A');
    await expect(service.getWorkspaceIdOf('absente')).resolves.toBeNull();
  });
});
