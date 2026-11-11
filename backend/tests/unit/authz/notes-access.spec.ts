/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { PolicyService } from '../../../src/authz/policy.service';
import { FirestoreSyncService } from '../../../src/firestore-sync/firestore-sync.service';
import { GeminiService } from '../../../src/notes/gemini.service';
import { NotesService } from '../../../src/notes/notes.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RealtimeService } from '../../../src/realtime/realtime.service';
import { RedisService } from '../../../src/redis/redis.service';
import { OTHER_W, USERS, W, buildRbacPrisma, id } from '../../support/rbac-fixture';

/**
 * S12-f / S16-c : le module des notes passe par `PolicyService` pour le projet cible, les tâches
 * existantes et les assignés, et fait quitter le salon `task:<id>` d'une tâche déplacée.
 */
/**
 * Faux `task.findMany` pour `deleteNote` (O8) : évalue le `where` (noteId, projectId.in, deletedAt),
 * refuse toute autre clé, et renvoie assignés et projet comme l'`include` réel.
 */
function installNoteTaskFinder(prisma: any) {
  prisma.task.findMany = jest.fn(async ({ where }: any) => {
    const known = new Set(['noteId', 'projectId', 'deletedAt']);
    const unknown = Object.keys(where).filter((k) => !known.has(k));
    if (unknown.length > 0) throw new Error(`where inconnu : ${unknown.join(',')}`);
    return prisma.data.tasks
      .filter(
        (t: any) =>
          t.noteId === where.noteId &&
          (where.projectId === undefined || where.projectId.in.includes(t.projectId)) &&
          (where.deletedAt === undefined || t.deletedAt === where.deletedAt),
      )
      .map((t: any) => ({
        createdAt: new Date(0),
        updatedAt: new Date(0),
        ...t,
        assignees: [{ userId: 'u-assigned' }],
        project: prisma.data.projects.find((p: any) => p.id === t.projectId),
      }));
  });
}

describe('S12-f / S16-c : notes et politique d’autorisation', () => {
  let prisma: any;
  let service: NotesService;
  let policy: PolicyService;
  const evictTaskRoom = jest.fn();
  const enqueue = jest.fn();
  const gemini = { isAvailable: jest.fn(), extractTasksFromText: jest.fn() };

  const userNames: Record<string, string> = {
    [USERS.outsider]: 'outsider',
    [USERS.viewer]: 'viewer',
    [USERS.commenter]: 'commenter',
    [USERS.deprovisioned]: 'bob',
    [USERS.owner]: 'owner',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildRbacPrisma() as any;
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    // Projet de workspace créé par Bob (désactivé par SCIM : plus de Membership dans W)
    prisma.data.projects.push({
      id: 'P-W1',
      name: 'Roadmap',
      userId: USERS.deprovisioned,
      workspaceId: W,
      deletedAt: null,
    });
    const members = prisma.membership.findMany;
    prisma.membership.findMany = jest.fn(async (args: any) =>
      (await members(args)).map((m: any) => ({
        ...m,
        user: { id: m.userId, name: userNames[m.userId] ?? m.userId, githubUsername: null },
      })),
    );
    prisma.note = {
      create: jest.fn(async ({ data }: any) => ({ id: 'N1', ...data })),
      update: jest.fn(),
    };
    prisma.project.create = jest.fn(async ({ data }: any) => {
      const row = {
        id: `P-new-${prisma.data.projects.length}`,
        workspaceId: null,
        deletedAt: null,
        ...data,
      };
      prisma.data.projects.push(row);
      return row;
    });
    prisma.task.create = jest.fn(async ({ data }: any) => {
      prisma.data.tasks.push({ deletedAt: null, ...data });
      return data;
    });
    prisma.task.update = jest.fn(async () => ({}));
    prisma.taskAssignee = {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(async () => null),
    };
    // Aucune recherche d'utilisateur à l'échelle de la plateforme : si elle existait, elle trouverait l'autre tenant
    prisma.user = {
      findFirst: jest.fn(async () => ({ id: USERS.outsider, name: 'outsider' })),
      findUnique: jest.fn(async ({ where }: any) => ({
        id: where.id,
        name: userNames[where.id] ?? where.id,
        githubUsername: null,
      })),
    };
    gemini.isAvailable.mockReturnValue(false);
    gemini.extractTasksFromText.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        NotesService,
        PolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: { del: jest.fn(), get: jest.fn(), set: jest.fn() } },
        { provide: GeminiService, useValue: gemini },
        { provide: FirestoreSyncService, useValue: { enqueue } },
        { provide: RealtimeService, useValue: { evictTaskRoom } },
      ],
    }).compile();
    service = module.get(NotesService);
    policy = module.get(PolicyService);
  });

  const askAssignee = (assigneeName: string) => {
    gemini.isAvailable.mockReturnValue(true);
    gemini.extractTasksFromText.mockResolvedValue([{ title: 'Pirater', assigneeName }]);
  };

  describe('projet cible', () => {
    it('créateur sans Membership : aucune tâche dans le projet du workspace, une tâche personnelle', async () => {
      await service.createNote(USERS.deprovisioned, 'N', '- [ ] Pirater #Roadmap');
      const created = prisma.task.create.mock.calls.map((c: any) => c[0].data);
      expect(created.some((d: any) => d.projectId === 'P-W1')).toBe(false);
      expect(created).toHaveLength(1);
      const target = prisma.data.projects.find((p: any) => p.id === created[0].projectId);
      expect(target).toMatchObject({ name: 'Roadmap', workspaceId: null });
    });

    it('membre autorisé (OWNER) : la tâche est créée dans le projet du workspace', async () => {
      prisma.data.projects[0].name = 'Alpha';
      await service.createNote(USERS.owner, 'N', '- [ ] Faire #Alpha');
      expect(prisma.task.create.mock.calls[0][0].data.projectId).toBe(id('P1'));
    });
  });

  describe('tâche existante', () => {
    it('marqueur d’une tâche d’un projet devenu inaccessible : aucune mise à jour', async () => {
      prisma.data.tasks.push({
        id: 'T9',
        title: 'Ancien titre',
        status: 'TODO',
        projectId: 'P-W1',
        userId: USERS.deprovisioned,
        noteId: 'N1',
        deletedAt: null,
      });
      await service.createNote(
        USERS.deprovisioned,
        'N',
        '- [x] Renommée #Roadmap <!-- task:T9 -->',
      );
      expect(prisma.task.update).not.toHaveBeenCalled();
      expect(evictTaskRoom).not.toHaveBeenCalled();
    });

    it('S16-c : tâche déplacée vers un autre projet : le salon task:<id> est évincé', async () => {
      prisma.data.projects[1].name = 'Beta';
      prisma.data.tasks[0].noteId = 'N1';
      await service.createNote(USERS.owner, 'N', `- [ ] Tâche 1 #Beta <!-- task:${id('T1')} -->`);
      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: id('T1') },
          data: expect.objectContaining({ projectId: id('P2') }),
        }),
      );
      expect(evictTaskRoom).toHaveBeenCalledWith(id('T1'));
    });

    it('S16-c : tâche mise à jour sans changement de projet : aucune éviction', async () => {
      prisma.data.projects[0].name = 'Alpha';
      prisma.data.tasks[0].noteId = 'N1';
      await service.createNote(USERS.owner, 'N', `- [x] Tâche 1 #Alpha <!-- task:${id('T1')} -->`);
      expect(prisma.task.update).toHaveBeenCalled();
      expect(evictTaskRoom).not.toHaveBeenCalled();
    });
  });

  describe('S12-h : une note ne sort pas une tâche de son workspace', () => {
    const moved = () =>
      prisma.task.update.mock.calls
        .map((c: any) => c[0].data)
        .filter((d: any) => d.projectId !== undefined);

    const taskOf = (id: string, projectId: string, userId: string, extra: any = {}) => ({
      id,
      title: 'Tâche C',
      status: 'TODO',
      projectId,
      userId,
      noteId: 'N1',
      deletedAt: null,
      ...extra,
    });

    it('critère 1 : CONTRIBUTOR de P1, tâche de P1, #Perso : projectId inchangé, titre appliqué', async () => {
      prisma.data.tasks.push(taskOf('TC', id('P1'), USERS.contributor));
      await service.createNote(
        USERS.contributor,
        'N',
        `- [ ] Titre modifié #Perso <!-- task:TC -->`,
      );
      const updates = prisma.task.update.mock.calls.map((c: any) => c[0].data);
      expect(updates.some((d: any) => d.projectId && d.projectId !== id('P1'))).toBe(false);
      expect(updates).toHaveLength(1);
      expect(updates[0].title).toBe('Titre modifié');
      expect(evictTaskRoom).not.toHaveBeenCalled();
    });

    it('critère 2 : membre de W et OTHER_W, aucun déplacement de W vers OTHER_W', async () => {
      prisma.data.memberships.push({
        id: 'm9',
        workspaceId: OTHER_W,
        userId: USERS.contributor,
        role: 'MEMBER',
      });
      prisma.data.projects.find((p: any) => p.id === id('PX')).userId = USERS.contributor;
      prisma.data.projects.find((p: any) => p.id === id('PX')).name = 'Externe';
      prisma.data.projectMemberships.push({
        id: 'pm9',
        projectId: id('PX'),
        userId: USERS.contributor,
        role: 'CONTRIBUTOR',
      });
      prisma.data.tasks.push(taskOf('TC', id('P1'), USERS.contributor));
      await service.createNote(USERS.contributor, 'N', `- [x] Tâche C #Externe <!-- task:TC -->`);
      expect(moved().filter((d: any) => d.projectId !== id('P1'))).toEqual([]);
      expect(prisma.task.update.mock.calls[0][0].data.status).toBe('DONE');
      expect(evictTaskRoom).not.toHaveBeenCalled();
    });

    it('critère 3 : déplacement P1 vers P2 (même workspace) permis, suivi de l’éviction', async () => {
      prisma.data.projects[1].name = 'Beta';
      prisma.data.tasks[0].noteId = 'N1';
      await service.createNote(USERS.owner, 'N', `- [ ] Tâche 1 #Beta <!-- task:${id('T1')} -->`);
      expect(moved()).toEqual([expect.objectContaining({ projectId: id('P2') })]);
      expect(evictTaskRoom).toHaveBeenCalledWith(id('T1'));
    });

    it('critère 4 : d’un projet personnel à un autre projet personnel : permis', async () => {
      prisma.data.projects.push(
        { id: 'PP1', name: 'Perso1', userId: USERS.owner, workspaceId: null, deletedAt: null },
        { id: 'PP2', name: 'Perso2', userId: USERS.owner, workspaceId: null, deletedAt: null },
      );
      prisma.data.tasks.push(taskOf('TP', 'PP1', USERS.owner));
      await service.createNote(USERS.owner, 'N', `- [ ] Tâche C #Perso2 <!-- task:TP -->`);
      expect(moved()).toEqual([expect.objectContaining({ projectId: 'PP2' })]);
      expect(evictTaskRoom).toHaveBeenCalledWith('TP');
    });

    it('d’un projet personnel vers un projet de workspace : refusé', async () => {
      prisma.data.projects[0].name = 'Alpha';
      prisma.data.projects.push({
        id: 'PP1',
        name: 'Perso1',
        userId: USERS.owner,
        workspaceId: null,
        deletedAt: null,
      });
      prisma.data.tasks.push(taskOf('TP', 'PP1', USERS.owner));
      await service.createNote(USERS.owner, 'N', `- [ ] Tâche C #Alpha <!-- task:TP -->`);
      expect(moved().filter((d: any) => d.projectId !== 'PP1')).toEqual([]);
      expect(evictTaskRoom).not.toHaveBeenCalled();
    });
  });

  describe('O7 : aucun projet personnel vide créé par un déplacement refusé', () => {
    const taskOf = (id: string, projectId: string, userId: string) => ({
      id,
      title: 'Tâche C',
      status: 'TODO',
      projectId,
      userId,
      noteId: 'N1',
      deletedAt: null,
    });

    it('tâche d’un projet de workspace, tag inconnu : déplacement refusé, aucun projet créé', async () => {
      prisma.data.tasks.push(taskOf('TC', id('P1'), USERS.contributor));
      await service.createNote(USERS.contributor, 'N', `- [ ] Tâche C #Inconnu <!-- task:TC -->`);
      expect(prisma.project.create).not.toHaveBeenCalled();
    });

    it('auteur qui ne peut plus écrire dans le projet de la tâche : aucun projet créé', async () => {
      prisma.data.tasks.push(taskOf('TC', id('P1'), USERS.commenter));
      await service.createNote(USERS.commenter, 'N', `- [ ] Tâche C #Inconnu <!-- task:TC -->`);
      expect(prisma.project.create).not.toHaveBeenCalled();
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it('contrôle : tâche d’un projet personnel, tag inconnu : le projet personnel est créé (déplacement permis)', async () => {
      prisma.data.projects.push({
        id: 'PP1',
        name: 'Perso1',
        userId: USERS.owner,
        workspaceId: null,
        deletedAt: null,
      });
      prisma.data.tasks.push(taskOf('TP', 'PP1', USERS.owner));
      await service.createNote(USERS.owner, 'N', `- [ ] Tâche C #Nouveau <!-- task:TP -->`);
      expect(prisma.project.create).toHaveBeenCalledTimes(1);
      expect(
        prisma.task.update.mock.calls.map((c: any) => c[0].data).some((d: any) => d.projectId),
      ).toBe(true);
    });

    it('contrôle : nouvelle tâche avec tag inconnu : le projet personnel est créé', async () => {
      await service.createNote(USERS.owner, 'N', '- [ ] Nouvelle #Nouveau');
      expect(prisma.project.create).toHaveBeenCalledTimes(1);
      expect(prisma.task.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('S12-i : l’assigné est résolu contre le projet où reste la tâche', () => {
    const askFor = (title: string, assigneeName: string) => {
      gemini.isAvailable.mockReturnValue(true);
      gemini.extractTasksFromText.mockResolvedValue([{ title, assigneeName }]);
    };
    const moved = () =>
      prisma.task.update.mock.calls
        .map((c: any) => c[0].data)
        .filter((d: any) => d.projectId !== undefined);
    const assignees = () => prisma.taskAssignee.create.mock.calls.map((c: any) => c[0].data);
    const setupExterne = () => {
      prisma.data.memberships.push({
        id: 'm9',
        workspaceId: OTHER_W,
        userId: USERS.contributor,
        role: 'MEMBER',
      });
      const px = prisma.data.projects.find((p: any) => p.id === id('PX'));
      px.userId = USERS.contributor;
      px.name = 'Externe';
      prisma.data.projectMemberships.push({
        id: 'pm9',
        projectId: id('PX'),
        userId: USERS.contributor,
        role: 'CONTRIBUTOR',
      });
      prisma.data.tasks.push({
        id: 'TC',
        title: 'Tâche C',
        status: 'TODO',
        projectId: id('P1'),
        userId: USERS.contributor,
        noteId: 'N1',
        deletedAt: null,
      });
    };

    it('critère 1 : déplacement refusé vers un autre tenant, assigné de ce tenant : ni création ni suppression', async () => {
      setupExterne();
      askFor('Tâche C', 'outsider');
      await service.createNote(USERS.contributor, 'N', `- [ ] Tâche C #Externe <!-- task:TC -->`);
      expect(assignees()).toEqual([]);
      expect(prisma.taskAssignee.deleteMany).not.toHaveBeenCalled();
    });

    it('critère 2 : déplacement refusé, assigné COMMENTER de P1 : assigné (résolu contre P1)', async () => {
      setupExterne();
      askFor('Tâche C', 'commenter');
      await service.createNote(USERS.contributor, 'N', `- [ ] Tâche C #Externe <!-- task:TC -->`);
      expect(assignees()).toEqual([{ taskId: 'TC', userId: USERS.commenter }]);
    });

    it('critère 3 : déplacement P1 vers P2 accepté, assigné COMMENTER de P1 seulement : non assigné', async () => {
      prisma.data.projects[1].name = 'Beta';
      prisma.data.tasks[0].noteId = 'N1';
      askFor('Tâche 1', 'commenter');
      await service.createNote(USERS.owner, 'N', `- [ ] Tâche 1 #Beta <!-- task:${id('T1')} -->`);
      expect(moved()).toEqual([expect.objectContaining({ projectId: id('P2') })]);
      expect(assignees()).toEqual([]);
      expect(prisma.taskAssignee.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('S12-g : synchronisation tâche vers note', () => {
    const noteOf = (userId: string) => ({
      id: 'N9',
      title: 'Ma note',
      userId,
      deletedAt: null,
      content: '- [ ] Ancien titre #Roadmap <!-- task:T9 -->',
    });
    const pushTask = (projectId: string, authorId: string) =>
      prisma.data.tasks.push({
        id: 'T9',
        title: 'Rachat de ACME (confidentiel)',
        status: 'TODO',
        projectId,
        userId: authorId,
        noteId: 'N9',
        deletedAt: null,
        note: noteOf(authorId),
      });

    it('critère 1 : auteur sans Membership (SCIM) : aucune écriture dans sa note', async () => {
      pushTask('P-W1', USERS.deprovisioned);
      await service.syncTaskStatusToNote('T9', 'DONE');
      expect(prisma.note.update).not.toHaveBeenCalled();
    });

    it('auteur retiré du projet (membre sans rôle) : aucune écriture', async () => {
      pushTask(id('P1'), USERS.member);
      await service.syncTaskStatusToNote('T9', 'DONE');
      expect(prisma.note.update).not.toHaveBeenCalled();
    });

    it('critère 2 : auteur avec task.read : la ligne est mise à jour', async () => {
      pushTask(id('P1'), USERS.contributor);
      await service.syncTaskStatusToNote('T9', 'DONE');
      expect(prisma.note.update).toHaveBeenCalledTimes(1);
      expect(prisma.note.update.mock.calls[0][0].data.content).toContain(
        '- [x] Rachat de ACME (confidentiel)',
      );
    });
  });

  describe('S12-j : supprimer une note ne supprime que les tâches où l’auteur peut encore écrire', () => {
    const setupNote = (author: string, taskProjectId: string, extra: any[] = []) => {
      prisma.data.tasks.push(
        {
          id: 'T9',
          title: 'T9',
          projectId: taskProjectId,
          userId: author,
          noteId: 'N9',
          deletedAt: null,
        },
        ...extra,
      );
      prisma.note.findFirst = jest.fn(async ({ where }: any) =>
        where.id === 'N9' && where.userId === author ? { id: 'N9', userId: author } : null,
      );
      installNoteTaskFinder(prisma);
      // Faux updateMany : évalue le `where` reçu (noteId, projectId.in) sur les tâches
      prisma.task.updateMany = jest.fn(async ({ where, data }: any) => {
        const known = new Set(['noteId', 'projectId']);
        const unknown = Object.keys(where).filter((k) => !known.has(k));
        if (unknown.length > 0) throw new Error(`where inconnu : ${unknown.join(',')}`);
        const rows = prisma.data.tasks.filter(
          (t: any) =>
            t.noteId === where.noteId &&
            (where.projectId === undefined || where.projectId.in.includes(t.projectId)),
        );
        rows.forEach((t: any) => Object.assign(t, data));
        return { count: rows.length };
      });
    };
    const deletedAtOf = (id: string) => prisma.data.tasks.find((t: any) => t.id === id).deletedAt;

    it('critère 1 : COMMENTER de P1 : T9 (P1) conservée, T10 (projet personnel) supprimée, note supprimée', async () => {
      prisma.data.projects.push({
        id: 'PP-c',
        name: 'Perso',
        userId: USERS.commenter,
        workspaceId: null,
        deletedAt: null,
      });
      setupNote(USERS.commenter, id('P1'), [
        {
          id: 'T10',
          title: 'T10',
          projectId: 'PP-c',
          userId: USERS.commenter,
          noteId: 'N9',
          deletedAt: null,
        },
      ]);
      await service.deleteNote(USERS.commenter, 'N9');
      expect(deletedAtOf('T9')).toBeNull();
      expect(deletedAtOf('T10')).toBeInstanceOf(Date);
      expect(prisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'N9' }, data: { deletedAt: expect.any(Date) } }),
      );
    });

    it('critère 2 : auteur désactivé par SCIM (plus de Membership) : sa tâche de P1 est conservée', async () => {
      setupNote(USERS.deprovisioned, id('P1'));
      await service.deleteNote(USERS.deprovisioned, 'N9');
      expect(deletedAtOf('T9')).toBeNull();
      expect(prisma.note.update).toHaveBeenCalled();
    });

    it('critère 3 : contrôle positif, CONTRIBUTOR de P1 : sa tâche de P1 est supprimée', async () => {
      setupNote(USERS.contributor, id('P1'));
      await service.deleteNote(USERS.contributor, 'N9');
      expect(deletedAtOf('T9')).toBeInstanceOf(Date);
    });
  });

  describe('O8 : un événement Firestore delete par tâche réellement supprimée par deleteNote', () => {
    const baseTask = (id: string, projectId: string, userId: string) => ({
      id,
      title: id,
      description: null,
      priority: 'MEDIUM',
      status: 'TODO',
      startDate: null,
      dueDate: null,
      estimatedMinutes: null,
      progress: 0,
      labels: null,
      storyPoints: null,
      sprintId: null,
      userId,
      noteId: 'N9',
      projectId,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null as Date | null,
    });
    const fakeFind = () => installNoteTaskFinder(prisma);
    const events = () =>
      enqueue.mock.calls
        .map((c: any) => c[1])
        .filter((e: any) => e.entityType === 'task' && e.operation === 'delete');
    const noteDeleted = () =>
      prisma.note.update.mock.calls.length > 0 && prisma.task.updateMany.mock.calls.length > 0;

    beforeEach(() => {
      // Mêmes fausses écritures que S12-j
      prisma.note.findFirst = jest.fn(async ({ where }: any) =>
        where.id === 'N9' ? { id: 'N9', userId: where.userId } : null,
      );
      prisma.task.updateMany = jest.fn(async ({ where, data }: any) => {
        const rows = prisma.data.tasks.filter(
          (t: any) =>
            t.noteId === where.noteId &&
            (where.projectId === undefined || where.projectId.in.includes(t.projectId)),
        );
        rows.forEach((t: any) => Object.assign(t, data));
        return { count: rows.length };
      });
      fakeFind();
    });

    it('COMMENTER de P1 : seule la tâche du projet personnel est supprimée et notifiée', async () => {
      prisma.data.projects.push({
        id: 'PP-c',
        name: 'Perso',
        userId: USERS.commenter,
        workspaceId: null,
        deletedAt: null,
      });
      prisma.data.tasks.push(
        baseTask('T9', id('P1'), USERS.commenter),
        baseTask('T10', 'PP-c', USERS.commenter),
      );

      await service.deleteNote(USERS.commenter, 'N9');

      expect(noteDeleted()).toBe(true);
      const sent = events();
      expect(sent.map((e: any) => e.entityId)).toEqual(['T10']);
      expect(sent[0]).toMatchObject({
        workspaceId: `personal-${USERS.commenter}`,
        payload: expect.objectContaining({
          id: 'T10',
          projectId: 'PP-c',
          assigneeIds: ['u-assigned'],
          deletedAt: expect.any(String),
        }),
      });
    });

    it('CONTRIBUTOR de P1 : la tâche de P1 est supprimée et notifiée avec le workspace du projet', async () => {
      prisma.data.tasks.push(baseTask('T9', id('P1'), USERS.contributor));
      await service.deleteNote(USERS.contributor, 'N9');
      const sent = events();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ entityId: 'T9', workspaceId: W });
    });

    it('aucune tâche supprimée : aucun événement de tâche', async () => {
      prisma.data.tasks.push(baseTask('T9', id('P1'), USERS.deprovisioned));
      await service.deleteNote(USERS.deprovisioned, 'N9');
      expect(events()).toEqual([]);
    });
  });

  describe('O6 : droits calculés une fois par analyse', () => {
    it('plusieurs lignes : un seul calcul, et un seul projet personnel créé pour le même tag', async () => {
      const spy = jest.spyOn(policy, 'listAccessibleProjectIds');
      await service.createNote(
        USERS.owner,
        'N',
        '- [ ] Un #Perso\n- [ ] Deux #Perso\n- [ ] Trois #Perso',
      );
      expect(spy).toHaveBeenCalledTimes(1);
      expect(prisma.project.create).toHaveBeenCalledTimes(1);
      expect(prisma.task.create).toHaveBeenCalledTimes(3);
    });
  });

  describe('assigné', () => {
    beforeEach(() => {
      prisma.data.projects[0].name = 'Alpha';
    });
    const assigned = () => prisma.taskAssignee.create.mock.calls.map((c: any) => c[0].data.userId);

    it('utilisateur d’un autre tenant : jamais assigné', async () => {
      askAssignee('outsider');
      await service.createNote(USERS.owner, 'N', '- [ ] Pirater #Alpha');
      expect(prisma.task.create).toHaveBeenCalled();
      expect(assigned()).toEqual([]);
    });

    it('membre du workspace sans rôle sur le projet : jamais assigné', async () => {
      askAssignee('viewer');
      await service.createNote(USERS.owner, 'N', '- [ ] Pirater #Alpha');
      expect(assigned()).toEqual([]);
    });

    it('COMMENTER du projet : assigné', async () => {
      askAssignee('commenter');
      await service.createNote(USERS.owner, 'N', '- [ ] Pirater #Alpha');
      expect(assigned()).toEqual([USERS.commenter]);
    });

    it('projet personnel : seul l’auteur est assignable', async () => {
      askAssignee('commenter');
      await service.createNote(USERS.owner, 'N', '- [ ] Pirater #Perso');
      expect(assigned()).toEqual([]);
      askAssignee('owner');
      await service.createNote(USERS.owner, 'N', '- [ ] Pirater #Perso');
      expect(assigned()).toEqual([USERS.owner]);
    });

    it('aucune recherche d’utilisateur à l’échelle de la plateforme', async () => {
      askAssignee('outsider');
      await service.createNote(USERS.owner, 'N', '- [ ] Pirater #Alpha');
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });
  });
});
