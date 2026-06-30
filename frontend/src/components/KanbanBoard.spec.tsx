import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { KanbanBoard } from './KanbanBoard';
import { AppProvider } from '../context/AppContext';
import React from 'react';

describe('KanbanBoard', () => {
  it('doit rendre le titre du projet', () => {
    render(
      <AppProvider>
        <KanbanBoard />
      </AppProvider>,
    );
    expect(screen.getByText('Projets')).toBeInTheDocument();
  });

  it('doit ouvrir le formulaire de création de tâche lors du clic sur le bouton "Ajouter"', () => {
    render(
      <AppProvider>
        <KanbanBoard />
      </AppProvider>,
    );
    
    const addButton = screen.getByText(/Ajouter une tâche/i);
    fireEvent.click(addButton);
    
    expect(screen.getByText('Nouvelle Tâche')).toBeInTheDocument();
  });
});
