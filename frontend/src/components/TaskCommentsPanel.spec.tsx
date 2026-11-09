import { render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const comment = {
  id: 'c1',
  content: 'Voir pièces',
  createdAt: '2026-11-09T10:00:00.000Z',
  user: { id: 'u1', name: 'Ada' },
  replies: [],
  attachments: [
    {
      id: 'a1',
      fileName: 'piege.png',
      fileUrl: 'javascript:alert(document.cookie)',
      fileType: 'image/png',
      fileSize: 10,
    },
    {
      id: 'a2',
      fileName: 'plan.png',
      fileUrl: 'https://files.example.com/plan.png',
      fileType: 'image/png',
      fileSize: 10,
    },
  ],
};
const taskAttachments = [
  {
    id: 't1',
    fileName: 'mal.pdf',
    fileUrl: 'javascript:alert(1)',
    fileType: 'application/pdf',
    fileSize: 1,
  },
  {
    id: 't2',
    fileName: 'ok.pdf',
    fileUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
    fileType: 'application/pdf',
    fileSize: 1,
  },
];

// Valeur stable entre rendus : l'effet de chargement dépend de `workspaceMembers`
const app = {
  user: { id: 'u1', name: 'Ada', email: 'ada@corp.com' },
  socket: null,
  addComment: vi.fn(),
  getComments: vi.fn().mockResolvedValue([comment]),
  deleteComment: vi.fn(),
  updateComment: vi.fn(),
  workspaceMembers: [],
  createTaskAttachment: vi.fn(),
  getTaskAttachments: vi.fn().mockResolvedValue(taskAttachments),
  deleteTaskAttachment: vi.fn(),
};
vi.mock('../context/AppContext', () => ({ useApp: () => app }));

import { TaskCommentsPanel } from './TaskCommentsPanel';

describe('TaskCommentsPanel : liens de pièces jointes (S20)', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('une pièce jointe javascript: est rendue sans attribut href, les liens sûrs sont conservés', async () => {
    render(<TaskCommentsPanel taskId="t" taskTitle="Tâche" onClose={() => {}} />);

    const commentBad = (await screen.findByText('piege.png')).closest('a')!;
    const commentOk = screen.getByText('plan.png').closest('a')!;
    await waitFor(() => expect(screen.getByText('mal.pdf')).toBeTruthy());
    const taskBad = screen.getByText('mal.pdf').closest('a')!;
    const taskOk = screen.getByText('ok.pdf').closest('a')!;

    expect(commentBad.hasAttribute('href')).toBe(false);
    expect(taskBad.hasAttribute('href')).toBe(false);
    expect(commentOk.getAttribute('href')).toBe('https://files.example.com/plan.png');
    expect(taskOk.getAttribute('href')).toBe('data:application/pdf;base64,JVBERi0xLjQ=');
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
