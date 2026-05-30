import { Test, TestingModule } from '@nestjs/testing';
import { NotesService } from './notes.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

import { GeminiService } from './gemini.service';

describe('NotesService', () => {
  let service: NotesService;
  let prisma: PrismaService;
  let redis: RedisService;

  const mockGemini = {
    isAvailable: jest.fn().mockReturnValue(false),
    extractTasksFromText: jest.fn().mockResolvedValue([]),
  };

  const mockPrisma = {
    note: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    task: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    project: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    taskAssignee: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
  };

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: GeminiService, useValue: mockGemini },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
    prisma = module.get<PrismaService>(PrismaService);
    redis = module.get<RedisService>(RedisService);

    jest.clearAllMocks();
  });

  describe('parseTasksFromContent (via createNote)', () => {
    it('devrait créer une nouvelle tâche et injecter le tag task ID dans la note', async () => {
      const userId = 'user-123';
      const noteId = 'note-456';
      const noteTitle = 'Ma Note';
      const noteContent = '- [ ] Acheter du lait #Inbox';

      mockPrisma.note.create.mockResolvedValue({ id: noteId, title: noteTitle, content: noteContent, userId });
      mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-inbox', name: 'Inbox' });
      mockPrisma.task.create.mockResolvedValue({ id: 'task-new-id', title: 'Acheter du lait', status: 'TODO' });

      await service.createNote(userId, noteTitle, noteContent);

      // Devrait insérer la tâche en base de données
      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Acheter du lait',
            status: 'TODO',
            projectId: 'project-inbox',
            userId,
            noteId,
          }),
        })
      );

      // Devrait mettre à jour le contenu de la note avec le tag <!-- task:... -->
      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: noteId },
          data: expect.objectContaining({
            content: expect.stringMatching(/- \[ \] Acheter du lait #Inbox <!-- task:[a-f0-9-]+ -->/),
          }),
        })
      );
    });

    it('devrait mettre à jour une tâche existante si le tag est présent', async () => {
      const userId = 'user-123';
      const noteId = 'note-456';
      const noteTitle = 'Ma Note';
      const taskId = 'task-existing-uuid';
      const noteContent = `- [ ] Nettoyer le code #Inbox <!-- task:${taskId} -->`;

      mockPrisma.note.create.mockResolvedValue({ id: noteId, title: noteTitle, content: noteContent, userId });
      mockPrisma.project.findFirst.mockResolvedValue({ id: 'project-inbox', name: 'Inbox' });
      mockPrisma.task.findFirst.mockResolvedValue({ id: taskId, title: 'Ancien Titre', status: 'TODO', projectId: 'project-inbox' });

      await service.createNote(userId, noteTitle, noteContent);

      // Ne devrait pas recréer la tâche
      expect(mockPrisma.task.create).not.toHaveBeenCalled();

      // Devrait mettre à jour le titre
      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: taskId },
          data: expect.objectContaining({
            title: 'Nettoyer le code',
          }),
        })
      );
    });
  });

  describe('syncTaskStatusToNote', () => {
    it('devrait cocher la case dans la note quand la tâche passe à DONE', async () => {
      const taskId = 'task-uuid';
      const noteId = 'note-123';
      const initialContent = `- [ ] Réviser le projet #Startup <!-- task:${taskId} -->`;

      mockPrisma.task.findFirst.mockResolvedValue({
        id: taskId,
        title: 'Réviser le projet',
        noteId,
        project: { name: 'Startup' },
        note: { id: noteId, content: initialContent, userId: 'user-123', deletedAt: null },
      });

      await service.syncTaskStatusToNote(taskId, 'DONE');

      expect(mockPrisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: noteId },
          data: expect.objectContaining({
            content: `- [x] Réviser le projet #Startup <!-- task:${taskId} -->`,
          }),
        })
      );
    });
  });
});
