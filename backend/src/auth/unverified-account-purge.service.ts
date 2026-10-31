import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** Une inscription jamais vérifiée libère son adresse au bout de 7 jours (P6-c). */
export const UNVERIFIED_ACCOUNT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const BATCH_SIZE = 200;
/** Plafond de lots par exécution (borne le travail d'une purge de rattrapage). */
const MAX_BATCHES = 50;

/**
 * Purge des inscriptions par mot de passe jamais vérifiées : sans elle, un tiers qui inscrit
 * l'adresse d'une victime l'empêcherait ensuite de créer son compte (409 sur Firebase et GitHub).
 * Sont exclus les comptes qui possèdent une autre identité (Firebase, GitHub, SSO, SCIM) ou qui
 * participent à un espace de travail autre que leur espace d'onboarding resté personnel.
 */
@Injectable()
export class UnverifiedAccountPurgeService {
  private readonly logger = new Logger(UnverifiedAccountPurgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('30 3 * * *')
  async scheduledPurge(): Promise<void> {
    try {
      const purged = await this.purge();
      if (purged > 0) this.logger.log(`${purged} inscription(s) non vérifiée(s) purgée(s).`);
    } catch (error) {
      this.logger.error(
        `Purge des inscriptions non vérifiées en échec : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async purge(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_MAX_AGE_MS);
    const where = {
      emailVerifiedAt: null,
      createdAt: { lt: cutoff },
      passwordHash: { not: null },
      firebaseUid: null,
      githubId: null,
      ssoUid: null,
      provisionedByWorkspaceId: null,
    };

    let purged = 0;
    // Tri stable et curseur : les comptes conservés (espace partagé, erreur) ne monopolisent pas
    // le lot, la purge progresse jusqu'à la fin de la liste
    // (curseur par clé : robuste à la suppression de la dernière ligne d'un lot)
    let last: { createdAt: Date; id: string } | undefined;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const candidates = await this.prisma.user.findMany({
        where: last
          ? {
              AND: [
                where,
                {
                  OR: [
                    { createdAt: { gt: last.createdAt } },
                    { createdAt: last.createdAt, id: { gt: last.id } },
                  ],
                },
              ],
            }
          : where,
        select: { id: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
      });
      if (candidates.length === 0) break;
      last = candidates[candidates.length - 1];
      purged += await this.purgeBatch(candidates.map((c) => c.id));
      if (candidates.length < BATCH_SIZE) break;
    }
    return purged;
  }

  private async purgeBatch(ids: string[]): Promise<number> {
    let purged = 0;
    for (const id of ids) {
      try {
        const removed = await this.prisma.$transaction(async (tx) => {
          const memberships = await tx.membership.findMany({
            where: { userId: id },
            select: { workspaceId: true },
          });
          const owned = await tx.workspace.findMany({
            where: { ownerId: id },
            select: { id: true },
          });
          const ownedIds = owned.map((w) => w.id);
          const foreignMembership = memberships.some((m) => !ownedIds.includes(m.workspaceId));
          const otherMembers = ownedIds.length
            ? await tx.membership.count({
                where: { workspaceId: { in: ownedIds }, userId: { not: id } },
              })
            : 0;
          if (foreignMembership || otherMembers > 0) return false;

          if (ownedIds.length) {
            await tx.workspace.deleteMany({ where: { id: { in: ownedIds } } });
          }
          await tx.user.delete({ where: { id } });
          return true;
        });
        if (removed) purged += 1;
      } catch (error) {
        // Contrainte inattendue : le compte est conservé et sera retenté à la prochaine purge
        this.logger.warn(
          `Purge impossible pour un compte non vérifié : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return purged;
  }
}
