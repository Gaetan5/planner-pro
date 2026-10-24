import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { randomUUID } from 'crypto';

import { GeminiService } from './gemini.service';
import type { ExtractedTask } from '../projects/interfaces/ai-provider.interface';

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gemini: GeminiService,
  ) {}

  private getCacheKey(userId: string): string {
    return `notes:${userId}`;
  }

  private getProjectTagMatch(taskText: string): { projectName: string; taskText: string } {
    const tagMatch = taskText.match(/(?:^|\s)#([^\s#]+)/u);

    if (!tagMatch) {
      return { projectName: 'Inbox', taskText };
    }

    const projectName = tagMatch[1];
    const sanitizedTaskText = taskText
      .replace(new RegExp(`#${this.escapeRegExp(projectName)}`, 'gu'), '')
      .trim();

    return { projectName, taskText: sanitizedTaskText };
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeDueDate(value: string | Date | null | undefined): Date | null {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
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
    const updatedContent = await this.parseTasksFromContent(userId, content, note.id);

    return { ...note, content: updatedContent };
  }

  async updateNote(userId: string, noteId: string, title: string, content: string) {
    const existingNote = await this.prisma.note.findFirst({
      where: { id: noteId, userId, deletedAt: null },
    });
    if (!existingNote) {
      throw new NotFoundException('Note introuvable.');
    }

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
    const updatedContent = await this.parseTasksFromContent(userId, content, noteId);

    return { ...note, content: updatedContent };
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
      console.warn("Impossible d'écrire dans le cache Redis :", e);
    }

    return notes;
  }

  async getNote(userId: string, noteId: string) {
    return this.prisma.note.findFirst({
      where: { id: noteId, userId, deletedAt: null },
      include: {
        tasks: {
          where: { deletedAt: null },
        },
      },
    });
  }

  async deleteNote(userId: string, noteId: string) {
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, userId, deletedAt: null },
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
    const staticRegex =
      /^(\s*-\s*\[[ xX]?\]\s+)(.*?)(?:\s+#([^\s]+))?\s*<!--\s*task:([a-zA-Z0-9-]+)\s*-->\s*$/u;

    let currentIndex = 0;
    for (const line of lines) {
      const m = line.match(staticRegex);
      if (m && m[4] === taskId) {
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
      console.log(
        `Statut de la tâche "${taskTitle}" et titre synchronisés dans la note "${note.title}" (${isDone ? '[x]' : '[ ]'})`,
      );
    }
  }

  /**
   * Analyse le contenu Markdown d'une note pour extraire les lignes de type "- [ ] Tâche"
   * et les transformer automatiquement en tâches réelles en base de données.
   */
  private async parseTasksFromContent(
    userId: string,
    content: string,
    noteId: string,
  ): Promise<string> {
    const lines = content.split('\n');
    let hasChanges = false;
    const updatedLines = [];

    // Regex pour détecter une tâche avec case à cocher : "- [ ] Tâche" ou "- [x] Tâche"
    const taskLineRegex = /^(\s*-\s*\[([ xX])\]\s+)(.+)$/;

    // Appel à Gemini si disponible pour enrichir l'extraction (NLP)
    let aiTasks: ExtractedTask[] = [];
    if (this.gemini.isAvailable()) {
      try {
        aiTasks = await this.gemini.extractTasksFromText(content, new Date());
        console.log(`[Gemini NLP] ${aiTasks.length} tâches analysées par l'IA.`);
      } catch (err: unknown) {
        console.error(
          "Erreur lors de l'appel de Gemini pour l'extraction NLP, bascule sur le mode standard:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

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

        // Nettoyer le titre du hashtag de projet éventuel pour chercher dans les tâches IA
        const cleanText = taskText.replace(/#[^\s#]+/gu, '').trim();
        const aiTask = aiTasks.find((t) => {
          const aiCleanTitle = t.title.toLowerCase().trim();
          const localCleanTitle = cleanText.toLowerCase().trim();
          return aiCleanTitle.includes(localCleanTitle) || localCleanTitle.includes(aiCleanTitle);
        });

        // Déterminer la date limite (dueDate) et l'assigné si trouvés par l'IA
        const dueDate = this.normalizeDueDate(aiTask?.dueDate);
        let assigneeId: string | null = null;

        if (aiTask && aiTask.assigneeName) {
          const user = await this.prisma.user.findFirst({
            where: {
              OR: [
                { name: { equals: aiTask.assigneeName } },
                { githubUsername: { equals: aiTask.assigneeName } },
              ],
            },
          });
          if (user) {
            assigneeId = user.id;
          }
        }

        // Extraire un tag de projet (ex: #ProjetA ou #Startup-Pro)
        const hasProjectTag = /#[^\s#]+/u.test(taskText);
        let targetProjectName = 'Inbox';
        if (hasProjectTag) {
          const projectTagMatch = this.getProjectTagMatch(taskText);
          targetProjectName = projectTagMatch.projectName;
          taskText = projectTagMatch.taskText;
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
              description:
                targetProjectName === 'Inbox'
                  ? 'Boîte de réception pour les tâches capturées dans les notes'
                  : `Projet créé automatiquement via les notes`,
              userId,
            },
          });
        }

        const taskStatus = isDone ? 'DONE' : 'TODO';

        if (taskId) {
          // Vérifier que l'identifiant appartient bien à cette note et à cet utilisateur.
          const existingTask = await this.prisma.task.findFirst({
            where: { id: taskId, userId, noteId },
          });

          if (existingTask) {
            // Mettre à jour si le statut, le titre, la date limite ou le projet a changé dans la note
            const statusChanged =
              existingTask.status === 'DONE' && !isDone
                ? 'TODO'
                : existingTask.status !== 'DONE' && isDone
                  ? 'DONE'
                  : null;
            const titleChanged = existingTask.title !== taskText;
            const projectChanged = existingTask.projectId !== project.id;
            const dateChanged = dueDate
              ? existingTask.dueDate
                ? existingTask.dueDate.toISOString().split('T')[0] !==
                  dueDate.toISOString().split('T')[0]
                : true
              : false;

            if (
              existingTask.deletedAt ||
              statusChanged ||
              titleChanged ||
              projectChanged ||
              dateChanged
            ) {
              await this.prisma.task.update({
                where: { id: taskId },
                data: {
                  title: taskText,
                  status: statusChanged ?? existingTask.status,
                  projectId: project.id,
                  dueDate: dueDate || undefined,
                  deletedAt: null,
                },
              });
              console.log(`Tâche "${taskId}" mise à jour depuis la note.`);
            }

            if (assigneeId) {
              const existingAssignee = await this.prisma.taskAssignee.findUnique({
                where: { taskId_userId: { taskId, userId: assigneeId } },
              });
              if (!existingAssignee) {
                await this.prisma.taskAssignee.deleteMany({ where: { taskId } });
                await this.prisma.taskAssignee.create({
                  data: { taskId, userId: assigneeId },
                });
              }
            }

            updatedLines.push(line);
          } else {
            // Ne pas réutiliser l'identifiant d'un marqueur périmé ou étranger.
            const newTaskId = randomUUID();
            await this.prisma.task.create({
              data: {
                id: newTaskId,
                title: taskText,
                status: taskStatus,
                projectId: project.id,
                userId,
                noteId,
                dueDate,
              },
            });
            if (assigneeId) {
              await this.prisma.taskAssignee.create({
                data: { taskId: newTaskId, userId: assigneeId },
              });
            }
            console.log(`Tâche recréée avec un nouvel ID après un marqueur invalide.`);
            const projectSuffix = hasProjectTag ? ` #${targetProjectName}` : '';
            updatedLines.push(`${prefix}${taskText}${projectSuffix} <!-- task:${newTaskId} -->`);
            hasChanges = true;
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
              dueDate,
            },
          });

          if (assigneeId) {
            await this.prisma.taskAssignee.create({
              data: { taskId: newTaskId, userId: assigneeId },
            });
          }

          console.log(`Tâche créée automatiquement : "${taskText}" avec l'ID "${newTaskId}"`);

          const projectSuffix = hasProjectTag ? ` #${targetProjectName}` : '';
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
      return newContent;
    }

    return content;
  }
}
