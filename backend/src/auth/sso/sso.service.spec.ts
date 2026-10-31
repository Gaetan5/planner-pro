import { Test, TestingModule } from '@nestjs/testing';
import { SsoService } from './sso.service';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SSOProvider, WorkspaceRole } from '@prisma/client';
import { NotImplementedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfigureSsoDto } from './sso.dto';

describe('SsoService', () => {
  let service: SsoService;

  const prisma = {
    sSOConfiguration: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    membership: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  // Point d'entrée unique des sessions (A3) : aucune session ne doit être émise pour un refus
  const jwtService = {
    sign: jest.fn().mockReturnValue('jwt-sso-token'),
  };
  const authService = {
    completeLogin: jest.fn().mockResolvedValue({ user: {}, session: {} }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SsoService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get<SsoService>(SsoService);
    jest.clearAllMocks();
  });

  describe('extractDomain', () => {
    it('extraie correctement le nom de domaine en minuscules', () => {
      expect(service.extractDomain('Alice.Dupont@Sonatrach.DZ')).toBe('sonatrach.dz');
    });

    it('rejette les emails mal formatés', () => {
      expect(() => service.extractDomain('invalid-email')).toThrow();
    });
  });

  describe('discover', () => {
    it('renvoie ssoAvailable: false si le domaine n’est pas configuré', async () => {
      prisma.sSOConfiguration.findUnique.mockResolvedValue(null);
      const res = await service.discover('test@inconnu.com');
      expect(res.ssoAvailable).toBe(false);
    });

    it('renvoie les détails SSO si le domaine est configuré et actif', async () => {
      prisma.sSOConfiguration.findUnique.mockResolvedValue({
        domain: 'totalenergies.com',
        provider: SSOProvider.OIDC_AZURE_AD,
        enforceSSO: true,
        enabled: true,
        workspace: { name: 'TotalEnergies Exploration' },
      });

      const res = await service.discover('cadre@totalenergies.com');
      expect(res.ssoAvailable).toBe(true);
      expect(res.domain).toBe('totalenergies.com');
      expect(res.provider).toBe(SSOProvider.OIDC_AZURE_AD);
      expect(res.enforceSSO).toBe(true);
      // S27 : le nom du workspace n'est pas révélé à un appelant anonyme
      expect(JSON.stringify(res)).not.toContain('TotalEnergies Exploration');
      expect(res).not.toHaveProperty('workspaceName');
    });
  });

  describe('getAuthorizationUrl', () => {
    it('génère une URL d’autorisation Azure AD valide', async () => {
      prisma.sSOConfiguration.findUnique.mockResolvedValue({
        domain: 'mtn.com',
        provider: SSOProvider.OIDC_AZURE_AD,
        clientId: 'client-123',
        issuer: 'tenant-456',
        enabled: true,
      });

      const res = await service.getAuthorizationUrl('mtn.com');
      expect(res.url).toContain('login.microsoftonline.com/tenant-456/oauth2/v2.0/authorize');
      expect(res.url).toContain('client_id=client-123');
    });
  });

  // S2 : aucun JWT ne doit être émis sans échange de code auprès d'un IdP réel
  describe('S2 : fournisseurs non implémentés (SAML2, OIDC_GENERIC)', () => {
    it.each([SSOProvider.SAML2, SSOProvider.OIDC_GENERIC])(
      'handleCallback(%s) avec un code arbitraire : 501, aucun utilisateur ni jeton',
      async (provider) => {
        prisma.sSOConfiguration.findUnique.mockResolvedValue({
          domain: 'acme.com',
          provider,
          enabled: true,
          autoProvision: true,
          workspaceId: 'ws-acme',
          defaultRole: WorkspaceRole.OWNER,
          workspace: { id: 'ws-acme', name: 'ACME' },
        });
        const fetchSpy = jest.spyOn(global, 'fetch');

        await expect(service.handleCallback('x', 'acme.com')).rejects.toThrow(
          NotImplementedException,
        );

        expect(prisma.user.findFirst).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.membership.create).not.toHaveBeenCalled();
        expect(authService.completeLogin).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
      },
    );

    it('getAuthorizationUrl(SAML2) ne redirige plus vers entryPoint : 501', async () => {
      prisma.sSOConfiguration.findUnique.mockResolvedValue({
        domain: 'acme.com',
        provider: SSOProvider.SAML2,
        entryPoint: 'https://idp.acme.com/saml',
        enabled: true,
      });

      await expect(service.getAuthorizationUrl('acme.com')).rejects.toThrow(
        NotImplementedException,
      );
    });

    it.each([SSOProvider.SAML2, SSOProvider.OIDC_GENERIC])(
      'ConfigureSsoDto refuse provider=%s',
      async (provider) => {
        const dto = plainToInstance(ConfigureSsoDto, { provider, domain: 'acme.com' });
        const errors = await validate(dto);
        expect(errors.map((e) => e.property)).toContain('provider');
      },
    );

    it.each([SSOProvider.OIDC_AZURE_AD, SSOProvider.OIDC_GOOGLE])(
      'ConfigureSsoDto accepte provider=%s',
      async (provider) => {
        const dto = plainToInstance(ConfigureSsoDto, { provider, domain: 'acme.com' });
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      },
    );
  });
});
