import { INestApplication, LoggerService } from '@nestjs/common';
import { PlatformRole, ProjectRole, WorkspaceRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as http from 'http';
import { getAllowedOrigins } from '../../../src/auth/origin-guard';
import { encrypt, hashPassword } from '../../../src/auth/encryption.util';
import { generateTotpCode, generateTotpSecret } from '../../../src/auth/totp.util';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';
import { startE2eApp } from './e2e-app';

/** Mot de passe commun des comptes de test (hachage Argon2id calculé une fois). */
export const E2E_PASSWORD = 'MotDePasse!2026-e2e';
let sharedPasswordHash: Promise<string> | undefined;

export interface E2eResponse {
  status: number;
  headers: Headers;
  /** Corps JSON si analysable, sinon le texte brut. */
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
  /** Lignes `Set-Cookie` brutes. */
  setCookies: string[];
}

export interface E2eRequestInit {
  /** Adresse cliente simulée (`X-Forwarded-For`) ; par défaut une adresse neuve : compteur isolé. */
  ip?: string | null;
  headers?: Record<string, string>;
  /** Corps JSON. */
  body?: unknown;
  /** Corps brut (prioritaire sur `body`) avec son type de contenu. */
  raw?: string | Buffer;
  contentType?: string;
  /** Jeton d'accès en cookie. */
  accessToken?: string;
  /** Jeton de rafraîchissement en cookie. */
  refreshToken?: string;
  bearer?: string;
  /** `Origin` envoyée avec un cookie de session (défaut : l'origine autorisée) ; `null` pour l'omettre. */
  origin?: string | null;
}

export interface E2eUser {
  id: string;
  email: string;
  mfaSecret?: string;
}

export interface E2eSession {
  accessToken: string;
  refreshToken: string;
  response: E2eResponse;
}

/**
 * R4 (A9-b0) : `Retry-After` d'un 429 est un entier de secondes, au moins 1 et au plus `max`
 * (60 pour les limiteurs par minute ; le verrouillage de compte peut aller jusqu'à 24 h).
 */
export function expectRetryAfter(res: E2eResponse, max = 60): void {
  const raw = res.headers.get('retry-after');
  expect([res.status, raw]).toEqual([429, raw]);
  expect(raw).toMatch(/^[1-9]\d*$/);
  expect(Number(raw)).toBeLessThanOrEqual(max);
}

/** Valeur d'un cookie posé par une réponse (nom exact), ou undefined. */
export function cookieValue(res: E2eResponse, name: string): string | undefined {
  const line = res.setCookies.find((c) => c.startsWith(`${name}=`));
  return line ? line.split(';')[0].slice(name.length + 1) : undefined;
}

/** Ligne `Set-Cookie` complète d'un cookie (attributs compris). */
export function cookieLine(res: E2eResponse, name: string): string | undefined {
  return res.setCookies.find((c) => c.startsWith(`${name}=`));
}

/**
 * Monde d'une suite e2e : application complète, vraie base, vrai Redis, fabrique de comptes et
 * d'espaces de travail, nettoyage des lignes créées. Chaque suite démarre le sien.
 */
export class E2eWorld {
  private ipCounter = 0;
  private readonly ipBase = [1 + Math.floor(Math.random() * 250), Math.floor(Math.random() * 250)];
  private readonly userIds: string[] = [];
  private readonly workspaceIds: string[] = [];
  readonly prisma: PrismaService;
  readonly redis: RedisService;

  private constructor(
    readonly app: INestApplication,
    readonly baseUrl: string,
  ) {
    this.prisma = app.get(PrismaService);
    this.redis = app.get(RedisService);
  }

  static async start(
    options: { trustProxyHops?: string; logger?: LoggerService } = {},
  ): Promise<E2eWorld> {
    const { app, baseUrl } = await startE2eApp(options);
    return new E2eWorld(app, baseUrl);
  }

  async request(method: string, path: string, init: E2eRequestInit = {}): Promise<E2eResponse> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    const ip = init.ip === undefined ? this.uniqueIp() : init.ip;
    if (ip) headers['X-Forwarded-For'] = ip;
    let body: string | Buffer | undefined;
    if (init.raw !== undefined) {
      body = init.raw;
      headers['Content-Type'] ??= init.contentType ?? 'application/json';
    } else if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      headers['Content-Type'] ??= 'application/json';
    }
    const cookies: string[] = [];
    if (init.accessToken) cookies.push(`accessToken=${init.accessToken}`);
    if (init.refreshToken) cookies.push(`refreshToken=${init.refreshToken}`);
    if (cookies.length > 0) {
      headers['Cookie'] = cookies.join('; ');
      const origin = init.origin === undefined ? getAllowedOrigins()[0] : init.origin;
      if (origin) headers['Origin'] = origin;
    }
    if (init.bearer) headers['Authorization'] = `Bearer ${init.bearer}`;
    const res = await this.send(method, path, headers, body);
    const text = res.text;
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      /* corps non JSON */
    }
    return {
      status: res.status,
      headers: res.headers,
      body: parsed,
      text,
      setCookies: res.setCookies,
    };
  }

  /** Transport `node:http` : `fetch` (undici) ignore l'en-tête `Origin`, que l'API contrôle (S29). */
  private send(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: string | Buffer | undefined,
  ): Promise<{ status: number; headers: Headers; text: string; setCookies: string[] }> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const req = http.request(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method,
          headers:
            body === undefined
              ? headers
              : { ...headers, 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const outHeaders = new Headers();
            for (const [name, value] of Object.entries(res.headers)) {
              if (name === 'set-cookie' || value === undefined) continue;
              outHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
            resolve({
              status: res.statusCode ?? 0,
              headers: outHeaders,
              text: Buffer.concat(chunks).toString('utf8'),
              setCookies: res.headers['set-cookie'] ?? [],
            });
          });
        },
      );
      // Un refus anticipé (413) peut fermer la connexion pendant l'envoi : on lit quand même la réponse
      req.on('error', reject);
      req.end(body);
    });
  }

  /** Adresse cliente neuve (10.x.y.z), donc compteurs de débit isolés. */
  nextIp(): string {
    return this.uniqueIp();
  }

  private uniqueIp(): string {
    this.ipCounter += 1;
    const n = this.ipCounter;
    return `10.${this.ipBase[0]}.${(this.ipBase[1] + Math.floor(n / 250)) % 250}.${(n % 250) + 1}`;
  }

  /** Compte vérifié (mot de passe `E2E_PASSWORD`), facultativement avec MFA ou rôle de plateforme. */
  async createUser(
    options: { mfa?: boolean; platformRole?: PlatformRole; label?: string } = {},
  ): Promise<E2eUser> {
    sharedPasswordHash ??= hashPassword(E2E_PASSWORD);
    const mfaSecret = options.mfa || options.platformRole ? generateTotpSecret() : undefined;
    const email = `${options.label ?? 'u'}-${randomUUID()}@e2e.example`;
    const user = await this.prisma.user.create({
      data: {
        email,
        name: `Compte ${options.label ?? 'e2e'}`,
        passwordHash: await sharedPasswordHash,
        emailVerifiedAt: new Date(),
        ...(mfaSecret ? { mfaEnabled: true, mfaSecret: encrypt(mfaSecret) } : {}),
        ...(options.platformRole ? { platformRole: options.platformRole } : {}),
      },
    });
    this.userIds.push(user.id);
    return { id: user.id, email, mfaSecret };
  }

  /** Connexion réelle par `POST /auth/login` (et défi MFA si le compte en a un). */
  async login(user: E2eUser, ip: string = this.uniqueIp()): Promise<E2eSession> {
    let res = await this.request('POST', '/auth/login', {
      ip,
      body: { email: user.email, passwordRaw: E2E_PASSWORD },
    });
    if (res.body?.mfaRequired) {
      // Le pas TOTP courant a pu être consommé par une connexion précédente : on libère l'anti-rejeu
      await this.prisma.user.update({ where: { id: user.id }, data: { mfaLastUsedStep: null } });
      res = await this.request('POST', '/auth/mfa/challenge', {
        ip,
        body: { mfaTicket: res.body.mfaTicket, code: generateTotpCode(user.mfaSecret!) },
      });
    }
    const accessToken = cookieValue(res, 'accessToken');
    const refreshToken = cookieValue(res, 'refreshToken');
    if (res.status >= 300 || !accessToken || !refreshToken) {
      throw new Error(`Connexion e2e impossible (${res.status}) : ${res.text}`);
    }
    return { accessToken, refreshToken, response: res };
  }

  async createWorkspace(owner: E2eUser, name = 'Espace e2e'): Promise<string> {
    const workspace = await this.prisma.workspace.create({
      data: { name: `${name} ${randomUUID().slice(0, 8)}`, ownerId: owner.id },
    });
    this.workspaceIds.push(workspace.id);
    await this.prisma.membership.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: 'OWNER' },
    });
    return workspace.id;
  }

  async addMember(workspaceId: string, user: E2eUser, role: WorkspaceRole): Promise<void> {
    await this.prisma.membership.create({ data: { workspaceId, userId: user.id, role } });
  }

  async createProject(workspaceId: string, creator: E2eUser, name = 'Projet e2e'): Promise<string> {
    const project = await this.prisma.project.create({
      data: { name, userId: creator.id, workspaceId, status: 'ACTIVE' },
    });
    return project.id;
  }

  async addProjectMember(projectId: string, user: E2eUser, role: ProjectRole): Promise<void> {
    await this.prisma.projectMembership.create({ data: { projectId, userId: user.id, role } });
  }

  async createTask(projectId: string, creator: E2eUser, title = 'Tâche e2e'): Promise<string> {
    const task = await this.prisma.task.create({
      data: { title, projectId, userId: creator.id },
    });
    return task.id;
  }

  async createNote(owner: E2eUser, title = 'Note e2e'): Promise<string> {
    const note = await this.prisma.note.create({
      data: { title, content: 'contenu confidentiel', userId: owner.id },
    });
    return note.id;
  }

  /**
   * Supprime les lignes créées (la base e2e est jetable, mais la suite reste propre). Ordre imposé
   * par les clés étrangères RESTRICT ; les sessions et les clés partent en cascade avec le compte.
   */
  async cleanup(): Promise<void> {
    try {
      const users = { in: this.userIds };
      const projects = await this.prisma.project.findMany({
        where: { OR: [{ workspaceId: { in: this.workspaceIds } }, { userId: users }] },
        select: { id: true },
      });
      const projectIds = projects.map((p) => p.id);
      const tasks = await this.prisma.task.findMany({
        where: { OR: [{ projectId: { in: projectIds } }, { userId: users }] },
        select: { id: true },
      });
      const taskIds = { in: tasks.map((t) => t.id) };
      await this.prisma.timeLog.deleteMany({ where: { taskId: taskIds } });
      await this.prisma.taskDependency.deleteMany({
        where: { OR: [{ taskId: taskIds }, { dependsOnTaskId: taskIds }] },
      });
      await this.prisma.task.deleteMany({ where: { id: taskIds } });
      await this.prisma.projectMembership.deleteMany({
        where: { OR: [{ projectId: { in: projectIds } }, { userId: users }] },
      });
      await this.prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await this.prisma.auditLog.deleteMany({ where: { userId: users } });
      await this.prisma.platformAuditLog.deleteMany({ where: { actorId: users } });
      await this.prisma.note.deleteMany({ where: { userId: users } });
      await this.prisma.membership.deleteMany({
        where: { OR: [{ workspaceId: { in: this.workspaceIds } }, { userId: users }] },
      });
      const owned = await this.prisma.workspace.findMany({
        where: { OR: [{ id: { in: this.workspaceIds } }, { ownerId: users }] },
        select: { id: true },
      });
      const wsIds = owned.map((w) => w.id);
      await this.prisma.sCIMApiKey.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await this.prisma.integration.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await this.prisma.invitation.deleteMany({ where: { workspaceId: { in: wsIds } } });
      await this.prisma.workspace.deleteMany({ where: { id: { in: wsIds } } });
      await this.prisma.user.deleteMany({ where: { id: users } });
    } catch (error) {
      // Base jetable : un nettoyage incomplet ne doit pas masquer le résultat des tests
      console.warn('Nettoyage e2e incomplet :', error instanceof Error ? error.message : error);
    }
  }

  async close(): Promise<void> {
    await this.cleanup();
    await this.app.close();
  }
}
