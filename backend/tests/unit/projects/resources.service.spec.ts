import { Test, TestingModule } from '@nestjs/testing';
import { ResourcesService } from '../../../src/projects/resources.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';

describe('ResourcesService', () => {
  let service: ResourcesService;
  let prisma: PrismaService;

  const mockPrisma = {
    workspace: {
      create: jest.fn(),
    },
    membership: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    resourceProfile: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
    taskAssignee: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    timeBlock: {
      findMany: jest.fn(),
    },
    resourceAllocation: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    resourceLeave: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResourcesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<ResourcesService>(ResourcesService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('createResourceLeave', () => {
    it("devrait créer un congé si l'utilisateur crée son propre congé", async () => {
      const mockLeave = {
        id: 'leave-1',
        userId: 'user-1',
        startDate: new Date('2026-06-15'),
        endDate: new Date('2026-06-20'),
        reason: 'Vacances',
      };
      mockPrisma.resourceLeave.create.mockResolvedValue(mockLeave);

      const result = await service.createResourceLeave(
        'user-1',
        'user-1',
        '2026-06-15',
        '2026-06-20',
        'Vacances',
      );

      expect(result).toEqual(mockLeave);
      expect(mockPrisma.resourceLeave.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          startDate: new Date('2026-06-15'),
          endDate: new Date('2026-06-20'),
          reason: 'Vacances',
        },
      });
    });

    it('devrait lever une erreur si la date de fin est antérieure à la date de début', async () => {
      await expect(
        service.createResourceLeave('user-1', 'user-1', '2026-06-20', '2026-06-15'),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait lever une erreur si un autre utilisateur non admin tente de créer un congé', async () => {
      mockPrisma.membership.findMany.mockResolvedValue([]); // aucun workspace commun où admin

      await expect(
        service.createResourceLeave('user-2', 'user-1', '2026-06-15', '2026-06-20'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getResourceCapacityReport avec réduction de capacité', () => {
    it('devrait calculer la capacité ajustée avec congés et jours fériés', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({
        id: 'member-1',
        role: WorkspaceRole.MEMBER,
      });
      mockPrisma.membership.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          role: WorkspaceRole.MEMBER,
          user: { id: 'user-1', name: 'John Doe', email: 'john@doe.com' },
        },
      ]);
      mockPrisma.resourceProfile.findMany.mockResolvedValue([
        { userId: 'user-1', weeklyCapacityMinutes: 2400 }, // 480 min/jour sur 5 jours
      ]);
      mockPrisma.task.findMany.mockResolvedValue([]);
      mockPrisma.timeBlock.findMany.mockResolvedValue([]);
      mockPrisma.resourceAllocation.findMany.mockResolvedValue([]);

      // Ajoutons un congé de 1 jour pendant la semaine de test
      // Mettons le test sur une semaine fixe (ex: du lundi 15 juin 2026 au dimanche 21 juin 2026)
      // Aucun jour férié en France cette semaine-là.
      // Si l'utilisateur prend congé le lundi 15 juin : sa capacité disponible passe à 4/5 * 2400 = 1920 minutes.
      mockPrisma.resourceLeave.findMany.mockResolvedValue([
        {
          id: 'leave-1',
          userId: 'user-1',
          startDate: new Date('2026-06-15T00:00:00.000Z'),
          endDate: new Date('2026-06-15T23:59:59.000Z'),
        },
      ]);

      const RealDate = global.Date;
      const mockDate = new RealDate('2026-06-15T09:00:00.000Z');

      (global as any).Date = class extends RealDate {
        constructor(...args: any[]) {
          if (args.length > 0) {
            super(args[0]);
          } else {
            super(mockDate.getTime());
          }
        }
      };
      (global as any).Date.now = () => mockDate.getTime();
      (global as any).Date.UTC = RealDate.UTC;
      (global as any).Date.parse = RealDate.parse;

      const report = await service.getResourceCapacityReport('user-1', 'workspace-1');

      global.Date = RealDate;

      expect(report[0].weeklyCapacityMinutes).toBe(1920); // 2400 * 4/5
      expect(report[0].overloaded).toBe(false);
    });
  });
});
