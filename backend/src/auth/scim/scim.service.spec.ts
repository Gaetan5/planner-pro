import { Test, TestingModule } from '@nestjs/testing';
import { ScimService } from './scim.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ScimService', () => {
  let service: ScimService;

  const prisma = {
    membership: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    sCIMApiKey: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScimService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ScimService>(ScimService);
    jest.clearAllMocks();
  });

  describe('getServiceProviderConfig', () => {
    it('renvoie les métadonnées de conformité SCIM 2.0', () => {
      const config = service.getServiceProviderConfig();
      expect(config.schemas).toContain(
        'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
      );
      expect(config.patch.supported).toBe(true);
      expect(config.authenticationSchemes[0].type).toBe('oauthbearertoken');
    });
  });

  describe('listUsers', () => {
    it('formate la réponse selon RFC 7644 ListResponse', async () => {
      prisma.membership.findMany.mockResolvedValue([
        {
          user: {
            id: 'u-1',
            email: 'dev@enterprise.org',
            name: 'Jean Dupont',
            isSuspended: false,
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        },
      ]);
      prisma.membership.count.mockResolvedValue(1);

      const res = await service.listUsers('ws-1', 1, 10);
      expect(res.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.totalResults).toBe(1);
      expect(res.Resources[0].userName).toBe('dev@enterprise.org');
      expect(res.Resources[0].active).toBe(true);
    });
  });

  describe('patchUser', () => {
    it('suspend un utilisateur lors d’un patch active: false', async () => {
      prisma.membership.findUnique.mockResolvedValue({
        user: {
          id: 'u-1',
          email: 'dev@enterprise.org',
          name: 'Jean Dupont',
          isSuspended: false,
          createdAt: new Date(),
        },
      });

      prisma.user.update.mockResolvedValue({
        id: 'u-1',
        email: 'dev@enterprise.org',
        name: 'Jean Dupont',
        isSuspended: true,
        createdAt: new Date(),
      });

      const res = await service.patchUser('ws-1', 'u-1', {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { isSuspended: true, name: undefined },
      });
      expect(res.active).toBe(false);
    });
  });
});
