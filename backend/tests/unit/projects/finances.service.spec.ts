import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { FinancesService } from '../../../src/projects/finances.service';
import { PrismaService } from '../../../src/prisma/prisma.service';

describe('FinancesService', () => {
  let service: FinancesService;

  const mockPrisma = {
    membership: {
      findFirst: jest.fn(),
    },
    project: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FinancesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<FinancesService>(FinancesService);
    jest.clearAllMocks();
  });

  it('propage une erreur de calcul au lieu de renvoyer un résumé partiel', async () => {
    mockPrisma.membership.findFirst.mockResolvedValue({ role: WorkspaceRole.ADMIN });
    mockPrisma.project.findMany.mockResolvedValue([{ id: 'project-1' }]);
    const calculationError = new Error('Échec de lecture financière');
    jest.spyOn(service, 'getProjectFinances').mockRejectedValue(calculationError);

    await expect(service.getWorkspaceFinancialSummary('workspace-1', 'user-1')).rejects.toBe(
      calculationError,
    );
  });

  it('refuse le résumé aux utilisateurs sans rôle autorisé', async () => {
    mockPrisma.membership.findFirst.mockResolvedValue({ role: WorkspaceRole.MEMBER });

    await expect(service.getWorkspaceFinancialSummary('workspace-1', 'user-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
  });
});
