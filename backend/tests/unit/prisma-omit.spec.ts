import { PRISMA_OMIT, PrismaService } from '../../src/prisma/prisma.service';

describe('S21 : le secret de webhook n’est jamais lu par défaut', () => {
  it('PRISMA_OMIT masque Project.githubWebhookSecret', () => {
    expect(PRISMA_OMIT).toEqual({ project: { githubWebhookSecret: true } });
  });

  it('le client Prisma applique l’omission globale (aucune connexion ouverte)', () => {
    const service = new PrismaService() as unknown as { _globalOmit?: unknown };
    expect(service._globalOmit).toEqual(PRISMA_OMIT);
  });
});
