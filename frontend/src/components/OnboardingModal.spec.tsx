import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingModal } from './OnboardingModal';

describe('OnboardingModal', () => {
  it('guide vers une tâche puis ouvre le module correspondant', () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(<OnboardingModal onClose={onClose} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /étape 2 : tâche 1/i }));
    expect(screen.getByRole('heading', { name: 'Faites avancer une tâche' })).toBeInTheDocument();
    expect(screen.getByText(/À essayer : déplacer une carte/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le Kanban' }));

    expect(onNavigate).toHaveBeenCalledWith('kanban');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('explique quand les données de démarrage existent et propose une alternative', () => {
    render(<OnboardingModal onClose={vi.fn()} onNavigate={vi.fn()} />);

    expect(
      screen.getByRole('dialog', { name: 'Votre projet de prise en main' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Une inscription classique crée le projet/)).toBeInTheDocument();
    expect(screen.getByText(/peuvent ne pas les avoir/)).toBeInTheDocument();
    expect(screen.getByText(/créez un projet et une tâche de test/)).toBeInTheDocument();
  });
});
