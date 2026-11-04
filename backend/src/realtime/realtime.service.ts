import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { PolicyService } from '../authz/policy.service';

/** Salon d'un projet : seul lieu de diffusion des données de tâches (S16). */
const PROJECT_ROOM_PREFIX = 'project:';
const TASK_ROOM_PREFIX = 'task:';
export const projectRoom = (projectId: string) => `${PROJECT_ROOM_PREFIX}${projectId}`;
export const userRoom = (userId: string) => `user:${userId}`;
export const taskRoom = (taskId: string) => `${TASK_ROOM_PREFIX}${taskId}`;
export const workspaceRoom = (workspaceId: string) => `workspace:${workspaceId}`;

/**
 * Point unique de diffusion temps réel (A4). Les contrôleurs et services n'accèdent jamais au
 * serveur Socket.IO : ils appellent ce service, après validation des droits et écriture en base.
 *
 * Règles de salons (S16) :
 * - `project:<id>` : événements contenant des données de tâches ; jointure selon les projets
 *   accessibles, recalculée à chaque changement de droits.
 * - `workspace:<id>` : signaux non sensibles uniquement (aucune donnée de tâche).
 * - `user:<id>` : notifications personnelles.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server?: Server;

  constructor(private readonly policy: PolicyService) {}

  /** Appelé une fois par la gateway lors de son initialisation. */
  attach(server: Server): void {
    this.server = server;
  }

  get isReady(): boolean {
    return !!this.server;
  }

  emitToProject(projectId: string, event: string, payload: unknown): void {
    this.server?.to(projectRoom(projectId)).emit(event, payload);
  }

  emitToTask(taskId: string, event: string, payload: unknown): void {
    this.server?.to(taskRoom(taskId)).emit(event, payload);
  }

  /**
   * Fait quitter le salon `task:<id>` à tous ses abonnés (S16-c) : à appeler quand une tâche change
   * de projet. Les clients autorisés le rejoignent de nouveau par `join-task`.
   */
  evictTaskRoom(taskId: string): void {
    this.server?.in(taskRoom(taskId)).socketsLeave(taskRoom(taskId));
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  /** Signal non sensible (aucune donnée de tâche) à tous les membres connectés d'un workspace. */
  emitSignalToWorkspace(
    workspaceId: string,
    event: string,
    payload: { workspaceId: string },
  ): void {
    this.server?.to(workspaceRoom(workspaceId)).emit(event, payload);
  }

  /** Salons à rejoindre à la connexion : un par projet accessible et un par workspace. */
  async roomsForUser(userId: string): Promise<{ projects: string[]; workspaces: string[] }> {
    const projectIds = await this.policy.listAccessibleProjectIds(userId);
    const workspaces = await this.policy.listWorkspaceIds(userId);
    return {
      projects: projectIds.map(projectRoom),
      workspaces: workspaces.map(workspaceRoom),
    };
  }

  /**
   * Après la création d'un projet (S16-b) : les OWNER/ADMIN du workspace (MANAGER de tout projet)
   * et les utilisateurs donnés (le créateur) rejoignent le salon du nouveau projet sans se
   * reconnecter. À appeler après le commit ; n'échoue jamais (le recalcul échoue fermé).
   */
  async refreshWorkspaceManagersRooms(workspaceId: string, extraUserIds: string[] = []) {
    if (!this.server) return;
    try {
      const admins = await this.policy.listWorkspaceAdminIds(workspaceId);
      await Promise.all(
        [...new Set([...extraUserIds, ...admins])].map((id) => this.refreshUserRooms(id)),
      );
    } catch (error) {
      this.logger.error(
        `Recalcul des salons du workspace ${workspaceId} impossible : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Recalcule les salons `project:*`, `workspace:*` et `task:*` de toutes les sockets d'un
   * utilisateur : à appeler après tout changement d'appartenance ou de rôle (S16). Les salons
   * perdus sont quittés immédiatement ; un salon `task:<id>` n'est conservé que si la tâche
   * existe encore dans un projet accessible (S16-a) ; les salons de projet et de workspace
   * autorisés sont rejoints.
   */
  async refreshUserRooms(userId: string): Promise<void> {
    if (!this.server) return;
    try {
      const { projects, workspaces } = await this.roomsForUser(userId);
      const allowed = new Set([...projects, ...workspaces]);
      const sockets = await this.server.in(userRoom(userId)).fetchSockets();

      // Une seule requête pour toutes les tâches suivies par les sockets de l'utilisateur
      const joinedTaskIds = new Set<string>();
      for (const socket of sockets) {
        for (const room of socket.rooms) {
          if (room.startsWith(TASK_ROOM_PREFIX))
            joinedTaskIds.add(room.slice(TASK_ROOM_PREFIX.length));
        }
      }
      const keptTaskIds = new Set(
        await this.policy.filterTaskIdsInProjects(
          [...joinedTaskIds],
          projects.map((room) => room.slice(PROJECT_ROOM_PREFIX.length)),
        ),
      );

      for (const socket of sockets) {
        for (const room of socket.rooms) {
          const scoped = room.startsWith(PROJECT_ROOM_PREFIX) || room.startsWith('workspace:');
          const task =
            room.startsWith(TASK_ROOM_PREFIX) &&
            !keptTaskIds.has(room.slice(TASK_ROOM_PREFIX.length));
          if ((scoped && !allowed.has(room)) || task) socket.leave(room);
        }
        for (const room of allowed) socket.join(room);
      }
    } catch (error) {
      // Échec fermé : sans recalcul, on coupe les salons de projet de l'utilisateur
      this.logger.error(
        `Recalcul des salons impossible pour l'utilisateur ${userId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.server.in(userRoom(userId)).disconnectSockets(true);
    }
  }
}
