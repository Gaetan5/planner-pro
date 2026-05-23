import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private getCacheKey(userId: string): string {
    return `notes:${userId}`;
  }

  async createNote(userId: string, title: string, content: string) {
    const note = await this.prisma.note.create({
      data: {
        title,
        content,
        userId,
      },
    });

    // Invalider le cache
    await this.redis.del(this.getCacheKey(userId));

    // Analyser le contenu pour extraire et automatiser les tâches
    await this.parseTasksFromContent(userId, content);

    return note;
  }

  async updateNote(userId: string, noteId: string, title: string, content: string) {
    const note = await this.prisma.note.update({
      where: { id: noteId },
      data: {
        title,
        content,
      },
    });

    // Invalider le cache
    await this.redis.del(this.getCacheKey(userId));

    // Analyser à nouveau le contenu pour voir s'il y a de nouvelles tâches
    await this.parseTasksFromContent(userId, content);

    return note;
  }

  async getNotes(userId: string) {
    const cacheKey = this.getCacheKey(userId);
    
    // Essayer de lire depuis Redis
    try {
      const cachedNotes = await this.redis.get(cacheKey);
      if (cachedNotes) {
        console.log('Notes récupérées depuis le cache Redis.');
        return JSON.parse(cachedNotes);
      }
    } catch (e) {
      console.warn('Impossible de lire le cache Redis, repli sur la base de données:', e);
    }

    // Récupérer depuis la base de données
    const notes = await this.prisma.note.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    // Écrire dans le cache avec un TTL de 5 minutes (300 secondes)
    try {
      await this.redis.set(cacheKey, JSON.stringify(notes), 300);
    } catch (e) {
      console.warn('Impossible d\'écrire dans le cache Redis :', e);
    }

    return notes;
  }

  async getNote(noteId: string) {
    return this.prisma.note.findUnique({
      where: { id: noteId },
    });
  }

  async deleteNote(noteId: string) {
    const note = await this.prisma.note.findUnique({
      where: { id: noteId },
    });

    if (note) {
      await this.prisma.note.delete({
        where: { id: noteId },
      });
      // Invalider le cache de l'utilisateur
      await this.redis.del(this.getCacheKey(note.userId));
    }
    return note;
  }

  /**
   * Analyse le contenu Markdown d'une note pour extraire les lignes de type "- [ ] Tâche"
   * et les transformer automatiquement en tâches réelles en base de données.
   */
  private async parseTasksFromContent(userId: string, content: string) {
    const lines = content.split('\n');
    const taskRegex = /^-\s*\[\s*\]\s+(.+)$/i;

    for (const line of lines) {
      const match = line.match(taskRegex);
      if (match) {
        let taskTitle = match[1].trim();
        let targetProjectName = 'Inbox'; // Projet par défaut

        // Extraire un éventuel tag de projet (ex: #ProjetA ou #Startup)
        const tagMatch = taskTitle.match(/#(\w+)/);
        if (tagMatch) {
          targetProjectName = tagMatch[1];
          // Nettoyer le titre de la tâche en enlevant le hashtag
          taskTitle = taskTitle.replace(`#${targetProjectName}`, '').trim();
        }

        // 1. Récupérer ou créer le projet cible
        let project = await this.prisma.project.findFirst({
          where: {
            name: { equals: targetProjectName },
            userId,
          },
        });

        if (!project) {
          project = await this.prisma.project.create({
            data: {
              name: targetProjectName,
              description: targetProjectName === 'Inbox' ? 'Boîte de réception pour les tâches capturées dans les notes' : `Projet créé automatiquement via les notes`,
              userId,
            },
          });
        }

        // 2. Vérifier si cette tâche n'a pas déjà été créée pour éviter les doublons
        const existingTask = await this.prisma.task.findFirst({
          where: {
            title: taskTitle,
            projectId: project.id,
            userId,
          },
        });

        // 3. Créer la tâche si elle n'existe pas encore
        if (!existingTask) {
          await this.prisma.task.create({
            data: {
              title: taskTitle,
              projectId: project.id,
              userId,
            },
          });
          console.log(`Tâche créée automatiquement : "${taskTitle}" dans le projet "${targetProjectName}"`);
        }
      }
    }
  }
}
