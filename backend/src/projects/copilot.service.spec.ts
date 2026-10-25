import { CopilotService } from './copilot.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../notes/gemini.service';

describe('CopilotService', () => {
  it('returns a clearly labeled data-based summary when AI is unavailable', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Camille' }) },
      task: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { title: 'Préparer la livraison', priority: 'HIGH', project: { name: 'Lancement' } },
          ]),
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: 'project-1' }]) },
      milestone: {
        findMany: jest.fn().mockResolvedValue([
          {
            name: 'Validation client',
            dueDate: new Date('2026-10-28T12:00:00.000Z'),
            project: { name: 'Lancement' },
          },
        ]),
      },
    } as unknown as PrismaService;
    const gemini = { isAvailable: jest.fn().mockReturnValue(false) } as unknown as GeminiService;
    const service = new CopilotService(prisma, gemini);
    jest.spyOn(service, 'calculatePredictiveAlerts').mockResolvedValue([
      {
        id: 'alert-1',
        type: 'OVERDUE',
        severity: 'HIGH',
        message: 'Une tâche est en retard.',
      },
    ]);

    const result = await service.generateBriefing('user-1', 'workspace-1');

    expect(result.source).toBe('rules');
    expect(result.briefing).toContain('Résumé automatique — IA indisponible');
    expect(result.briefing).toContain('Préparer la livraison');
    expect(result.briefing).toContain('Une tâche est en retard.');
    expect(result.briefing).toContain('Validation client');
    expect(result.briefing).not.toContain('Alice');
    expect(result.briefing).not.toContain('configuration de sécurité');
  });
});
