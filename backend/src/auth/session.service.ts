import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ACCESS_TOKEN_TTL_SECONDS, TokenService, VerifiedAccessToken } from './token.service';

/** Jeton de rafraîchissement : 7 jours glissants, dans la limite de 30 jours depuis la connexion. */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600;
export const SESSION_ABSOLUTE_LIFETIME_SECONDS = 30 * 24 * 3600;
/** Cache Redis du statut de session : 60 s au maximum (critère S7). */
export const SESSION_CACHE_TTL_SECONDS = 60;
/** Un jeton déjà tourné présenté dans ce délai est un rejeu bénin (deux onglets), pas un vol. */
export const REFRESH_REUSE_LEEWAY_MS = 10_000;
/** Délai maximal d'un appel Redis du chemin d'authentification : au-delà, repli sur la base. */
const REDIS_BEST_EFFORT_TIMEOUT_MS = 500;

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export interface IssueSessionOptions {
  userAgent?: string;
  /** Administrateur à l'origine d'une impersonation : session sans rafraîchissement. */
  impersonatedBy?: string;
  /** Début de l'authentification (rotation : conservé). */
  authenticatedAt?: Date;
}

export interface IssuedSession {
  sid: string;
  accessToken: string;
  accessMaxAgeSeconds: number;
  /** Absent pour une session d'impersonation. */
  refreshToken?: string;
  refreshMaxAgeSeconds?: number;
}

export interface VerifiedSession extends VerifiedAccessToken {
  sid: string;
}

export interface SessionSummary {
  id: string;
  createdAt: Date;
  authenticatedAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  current: boolean;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Seul détenteur de l'émission des sessions (A3, S7) : jeton d'accès court + jeton de
 * rafraîchissement opaque, haché en base, avec rotation et détection de réutilisation.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly redis: RedisService,
  ) {}

  private cacheKey(sid: string): string {
    return `session:active:${sid}`;
  }

  /** Redis n'est qu'un cache : toute erreur ou lenteur retombe sur la base, jamais sur un refus. */
  private async redisBestEffort<T>(operation: () => Promise<T>): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), REDIS_BEST_EFFORT_TIMEOUT_MS);
    });
    try {
      return await Promise.race([operation(), timeout]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Crée une session. Sans impersonation : famille de jetons de rafraîchissement (7 jours,
   * plafond 30 jours). Impersonation : une seule ligne de 15 minutes dont le secret n'est
   * jamais remis, donc sans possibilité de rafraîchissement.
   */
  async issue(user: SessionUser, options: IssueSessionOptions = {}): Promise<IssuedSession> {
    const sid = randomUUID();
    const now = new Date();
    const impersonation = Boolean(options.impersonatedBy);
    const refreshSecret = randomBytes(32).toString('base64url');
    const expiresAt = impersonation
      ? new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000)
      : new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);

    await this.prisma.refreshToken.create({
      data: {
        hashedToken: sha256(refreshSecret),
        userId: user.id,
        familyId: sid,
        authenticatedAt: options.authenticatedAt ?? now,
        expiresAt,
        userAgent: options.userAgent?.slice(0, 255) ?? null,
      },
    });

    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      sid,
      ...(options.impersonatedBy ? { impersonatedBy: options.impersonatedBy } : {}),
    });

    return {
      sid,
      accessToken,
      accessMaxAgeSeconds: ACCESS_TOKEN_TTL_SECONDS,
      ...(impersonation
        ? {}
        : { refreshToken: refreshSecret, refreshMaxAgeSeconds: REFRESH_TOKEN_TTL_SECONDS }),
    };
  }

  /**
   * Rotation du jeton de rafraîchissement. Un jeton déjà tourné présenté hors tolérance indique
   * un vol probable : toute la famille est révoquée.
   */
  async refresh(
    rawRefreshToken: string | undefined,
    userAgent?: string,
  ): Promise<IssuedSession & { user: SessionUser & { platformRole: string | null } }> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Session expirée. Veuillez vous reconnecter.');
    }

    const row = await this.prisma.refreshToken.findUnique({
      where: { hashedToken: sha256(rawRefreshToken) },
    });
    if (!row) {
      throw new UnauthorizedException('Session expirée. Veuillez vous reconnecter.');
    }

    const now = new Date();

    if (row.revokedAt) {
      const rotatedRecently =
        row.rotatedAt && now.getTime() - row.rotatedAt.getTime() < REFRESH_REUSE_LEEWAY_MS;
      if (rotatedRecently) {
        // Deux requêtes simultanées avec le même jeton : la seconde réessaiera avec les nouveaux cookies
        throw new ConflictException('Session en cours de renouvellement, réessayez.');
      }
      await this.revoke(row.familyId);
      this.logger.warn(
        `Réutilisation d'un jeton de rafraîchissement : session ${row.familyId} révoquée.`,
      );
      throw new UnauthorizedException('Session expirée. Veuillez vous reconnecter.');
    }

    const absoluteLimit = new Date(
      row.authenticatedAt.getTime() + SESSION_ABSOLUTE_LIFETIME_SECONDS * 1000,
    );
    if (row.expiresAt <= now || absoluteLimit <= now) {
      await this.revoke(row.familyId);
      throw new UnauthorizedException('Session expirée. Veuillez vous reconnecter.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, email: true, name: true, isSuspended: true, platformRole: true },
    });
    if (!user || user.isSuspended) {
      await this.revoke(row.familyId);
      throw new UnauthorizedException('Session expirée. Veuillez vous reconnecter.');
    }

    // Consommation atomique : une seule requête concurrente peut tourner ce jeton
    const consumed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: now, rotatedAt: now },
    });
    if (consumed.count !== 1) {
      throw new ConflictException('Session en cours de renouvellement, réessayez.');
    }

    const nextSecret = randomBytes(32).toString('base64url');
    const nextExpiry = new Date(
      Math.min(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000, absoluteLimit.getTime()),
    );
    await this.prisma.refreshToken.create({
      data: {
        hashedToken: sha256(nextSecret),
        userId: row.userId,
        familyId: row.familyId,
        authenticatedAt: row.authenticatedAt,
        expiresAt: nextExpiry,
        userAgent: (userAgent ?? row.userAgent)?.slice(0, 255) ?? null,
      },
    });

    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      sid: row.familyId,
    });

    return {
      sid: row.familyId,
      accessToken,
      accessMaxAgeSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: nextSecret,
      refreshMaxAgeSeconds: Math.max(1, Math.floor((nextExpiry.getTime() - now.getTime()) / 1000)),
      user: { id: user.id, email: user.email, name: user.name, platformRole: user.platformRole },
    };
  }

  /** Révoque une session (toute la famille) et invalide son cache. */
  async revoke(sid: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId: sid, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.redisBestEffort(() => this.redis.del(this.cacheKey(sid)));
  }

  /** Révoque toutes les sessions actives d'un compte (suspension, administration, mot de passe). */
  async revokeAllForUser(userId: string, exceptSid?: string): Promise<number> {
    const active = (await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
      select: { familyId: true },
    })) as Array<{ familyId: string }>;
    const sids = [...new Set(active.map((r) => r.familyId))].filter((sid) => sid !== exceptSid);
    for (const sid of sids) {
      await this.revoke(sid);
    }
    return sids.length;
  }

  /**
   * Vérifie un jeton d'accès (HTTP et WebSocket) : signature et type, puis session active et
   * compte non suspendu. Le statut est mis en cache 60 s au plus ; sans Redis, la base répond.
   */
  async verifyAccess(token: string): Promise<VerifiedSession> {
    const payload = (await this.tokenService.verifyAccessToken(token)) as VerifiedSession;

    if (!(await this.isSessionActive(payload.sid, payload.sub))) {
      throw new UnauthorizedException("Token d'authentification invalide ou expiré.");
    }
    return payload;
  }

  /**
   * Session active (non révoquée, non expirée) d'un compte non suspendu. Statut mis en cache
   * 60 s au plus ; sans Redis, la base répond. `bypassCache` : lecture directe en base (sockets).
   */
  async isSessionActive(
    sid: string,
    userId: string,
    options: { bypassCache?: boolean } = {},
  ): Promise<boolean> {
    if (!options.bypassCache) {
      const cached = await this.redisBestEffort(() => this.redis.get(this.cacheKey(sid)));
      if (cached === userId) {
        return true;
      }
    }

    const now = new Date();
    const session = await this.prisma.refreshToken.findFirst({
      where: { familyId: sid, userId, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    const user = session
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { isSuspended: true } })
      : null;

    if (!session || !user || user.isSuspended) {
      // Lecture directe de la base : le cache périmé ne doit pas survivre (S7-a)
      if (options.bypassCache) {
        await this.redisBestEffort(() => this.redis.del(this.cacheKey(sid)));
      }
      return false;
    }

    await this.redisBestEffort(() =>
      this.redis.set(this.cacheKey(sid), userId, SESSION_CACHE_TTL_SECONDS),
    );
    return true;
  }

  /** Début d'authentification de la session (réauthentification récente, S6). */
  async getAuthenticatedAt(sid: string, userId: string): Promise<Date | null> {
    const row = await this.prisma.refreshToken.findFirst({
      where: { familyId: sid, userId, revokedAt: null },
      select: { authenticatedAt: true },
    });
    return row?.authenticatedAt ?? null;
  }

  /** Sessions actives d'un compte (page « Sessions actives », P6). */
  async listForUser(userId: string, currentSid?: string): Promise<SessionSummary[]> {
    const rows = (await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        familyId: true,
        createdAt: true,
        authenticatedAt: true,
        expiresAt: true,
        userAgent: true,
      },
      orderBy: { createdAt: 'desc' },
    })) as Array<{
      familyId: string;
      createdAt: Date;
      authenticatedAt: Date;
      expiresAt: Date;
      userAgent: string | null;
    }>;

    return rows.map((r) => ({
      id: r.familyId,
      createdAt: r.createdAt,
      authenticatedAt: r.authenticatedAt,
      expiresAt: r.expiresAt,
      userAgent: r.userAgent,
      current: r.familyId === currentSid,
    }));
  }

  /** Révoque une session précise d'un compte (jamais celle d'un autre utilisateur). */
  async revokeOwnSession(userId: string, sid: string): Promise<boolean> {
    const owned = await this.prisma.refreshToken.findFirst({
      where: { familyId: sid, userId, revokedAt: null },
      select: { id: true },
    });
    if (!owned) return false;
    await this.revoke(sid);
    return true;
  }

  /** Identifie la session d'un jeton de rafraîchissement (déconnexion avec accès expiré). */
  async findSidByRefreshToken(rawRefreshToken: string): Promise<string | null> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { hashedToken: sha256(rawRefreshToken) },
      select: { familyId: true },
    });
    return row?.familyId ?? null;
  }
}
