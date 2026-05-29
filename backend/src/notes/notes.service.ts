import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { randomUUID } from 'crypto';

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
    await this.parseTasksFromContent(userId, content, note.id);

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
    await this.parseTasksFromContent(userId, content, noteId);

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

    // Récupérer depuis la base de données avec les tâches associées actives
    const notes = await this.prisma.note.findMany({
      where: { userId, deletedAt: null },
      include: {
        tasks: {
          where: { deletedAt: null },
        },
      },
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
    return this.prisma.note.findFirst({
      where: { id: noteId, deletedAt: null },
      include: {
        tasks: {
          where: { deletedAt: null },
        },
      },
    });
  }

  async deleteNote(noteId: string) {
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, deletedAt: null },
    });

    if (note) {
      await this.prisma.note.update({
        where: { id: noteId },
        data: { deletedAt: new Date() },
      });
      // Supprimer logiquement les tâches associées à la note
      await this.prisma.task.updateMany({
        where: { noteId },
        data: { deletedAt: new Date() },
      });
      // Invalider le cache de l'utilisateur
      await this.redis.del(this.getCacheKey(note.userId));
    }
    return note;
  }

  /**
   * Synchronise le statut d'une tâche cochée/décochée avec la case à cocher correspondante
   * dans la note qui l'a créée.
   */
  async syncTaskStatusToNote(taskId: string, newStatus: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      include: { note: true, project: true },
    });

    if (!task || !task.noteId || !task.note || task.note.deletedAt) return;

    const note = task.note;
    let content = note.content;
    const taskTitle = task.title;
    const isDone = newStatus === 'DONE';
    const projectName = task.project?.name;

    // Retrouver la ligne de la note par le commentaire d'identifiant invisible <!-- task:ID -->
    const lines = content.split('\n');
    let lineIndex = -1;
    let match: RegExpMatchArray | null = null;
    const staticRegex = /^(\s*-\s*\[[ xX]?\]\s+)(.*?)(?:\s+#\w+)?\s*<!--\s*task:([a-zA-Z0-9-]+)\s*-->\s*$/;

    let currentIndex = 0;
    for (const line of lines) {
      const m = line.match(staticRegex);
      if (m && m[3] === taskId) {
        lineIndex = currentIndex;
        match = m;
        break;
      }
      currentIndex++;
    }

    if (lineIndex !== -1 && match) {
      const prefix = match[1];
      const newPrefix = prefix.replace(/\[[ xX]?\]/, isDone ? '[x]' : '[ ]');

      // Mettre à jour le statut, le titre et le projet dans la ligne Markdown
      const projectTag = projectName && projectName !== 'Inbox' ? ` #${projectName}` : '';
      const newLine = `${newPrefix}${taskTitle}${projectTag} <!-- task:${taskId} -->`;

      lines.splice(lineIndex, 1, newLine);
      content = lines.join('\n');

      // Mettre à jour la note en base
      await this.prisma.note.update({
        where: { id: note.id },
        data: { content },
      });

      // Invalider le cache Redis
      await this.redis.del(this.getCacheKey(note.userId));
      console.log(`Statut de la tâche "${taskTitle}" et titre synchronisés dans la note "${note.title}" (${isDone ? '[x]' : '[ ]'})`);
    }
  }

  /**
   * Analyse le contenu Markdown d'une note pour extraire les lignes de type "- [ ] Tâche"
   * et les transformer automatiquement en tâches réelles en base de données.
   */
  private async parseTasksFromContent(userId: string, content: string, noteId: string) {
    const lines = content.split('\n');
    let hasChanges = false;
    const updatedLines = [];

    // Regex pour détecter une tâche avec case à cocher : "- [ ] Tâche" ou "- [x] Tâche"
    const taskLineRegex = /^(\s*-\s*\[([ xX])\]\s+)(.+)$/;

    let inCodeBlock = false;
    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        updatedLines.push(line);
        continue;
      }

      if (inCodeBlock) {
        updatedLines.push(line);
        continue;
      }

      const match = line.match(taskLineRegex);

      if (match) {
        const prefix = match[1];
        const checkChar = match[2];
        let taskText = match[3].trim();
        const isDone = checkChar.toLowerCase() === 'x';

        // Tenter d'extraire un identifiant de tâche existant à la fin de la ligne
        let taskId: string | null = null;
        const idMatch = taskText.match(/(.+)<!--\s*task:([\w-]+)\s*-->/i);
        if (idMatch) {
          taskText = idMatch[1].trim();
          taskId = idMatch[2];
        }

        // Extraire un tag de projet (ex: #ProjetA ou #Startup)
        let targetProjectName = 'Inbox';
        const tagMatch = taskText.match(/#(\w+)/);
        if (tagMatch) {
          targetProjectName = tagMatch[1];
          taskText = taskText.replace(`#${targetProjectName}`, '').trim();
        }

        // 1. Récupérer ou créer le projet cible actif
        let project = await this.prisma.project.findFirst({
          where: {
            name: { equals: targetProjectName },
            userId,
            deletedAt: null,
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

        const taskStatus = isDone ? 'DONE' : 'TODO';

        if (taskId) {
          // Si un identifiant existe déjà, on vérifie la tâche correspondante active
          const existingTask = await this.prisma.task.findFirst({
            where: { id: taskId, deletedAt: null },
          });

          if (existingTask) {
            // Mettre à jour si le statut, le titre ou le projet a changé dans la note
            const statusChanged = (existingTask.status === 'DONE' && !isDone) ? 'TODO' : ((existingTask.status !== 'DONE' && isDone) ? 'DONE' : null);
            const titleChanged = existingTask.title !== taskText;
            const projectChanged = existingTask.projectId !== project.id;

            if (statusChanged || titleChanged || projectChanged) {
              await this.prisma.task.update({
                where: { id: taskId },
                data: {
                  title: taskText,
                  status: statusChanged || existingTask.status as any,
                  projectId: project.id,
                },
              });
              console.log(`Tâche "${taskId}" mise à jour depuis la note.`);
            }
            updatedLines.push(line);
          } else {
            // Recréer la tâche si elle a été supprimée accidentellement
            await this.prisma.task.create({
              data: {
                id: taskId,
                title: taskText,
                status: taskStatus,
                projectId: project.id,
                userId,
                noteId,
              },
            });
            console.log(`Tâche "${taskId}" recréée avec l'ID de la note.`);
            updatedLines.push(line);
          }
        } else {
          // Aucun identifiant présent : création d'une nouvelle tâche et injection du tag dans la note
          const newTaskId = randomUUID();

          await this.prisma.task.create({
            data: {
              id: newTaskId,
              title: taskText,
              status: taskStatus,
              projectId: project.id,
              userId,
              noteId,
            },
          });

          console.log(`Tâche créée automatiquement : "${taskText}" avec l'ID "${newTaskId}"`);

          const projectSuffix = tagMatch ? ` #${targetProjectName}` : '';
          const newLine = `${prefix}${taskText}${projectSuffix} <!-- task:${newTaskId} -->`;
          updatedLines.push(newLine);
          hasChanges = true;
        }
      } else {
        updatedLines.push(line);
      }
    }

    if (hasChanges) {
      const newContent = updatedLines.join('\n');
      await this.prisma.note.update({
        where: { id: noteId },
        data: { content: newContent },
      });
      // Invalider le cache de l'utilisateur
      await this.redis.del(this.getCacheKey(userId));
    }
  }
}
