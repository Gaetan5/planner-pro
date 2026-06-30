import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  Search,
  LayoutDashboard,
  Kanban,
  Calendar,
  FileText,
  Timer,
  Plus,
  Play,
  Sparkles,
} from 'lucide-react';
import './CommandPalette.css';

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  category: 'Navigation' | 'Actions' | 'Tâches' | 'Projets' | 'Notes';
  icon: React.ReactNode;
  action: () => void;
}

export const CommandPalette: React.FC = () => {
  const { projects, notes, setActiveTab, createTask, createProject, saveNote, startTimer } =
    useApp();

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Écouter le raccourci global Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus sur l'input à l'ouverture
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSearch('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Fermer si clic à l'extérieur
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      setIsOpen(false);
    }
  };

  // Compiler la liste de toutes les commandes et données indexées
  const getCommands = (): CommandItem[] => {
    const items: CommandItem[] = [];

    // 1. Navigation
    items.push(
      {
        id: 'nav-dash',
        title: 'Aller au Dashboard',
        category: 'Navigation',
        icon: <LayoutDashboard size={16} />,
        action: () => {
          setActiveTab('dashboard');
          setIsOpen(false);
        },
      },
      {
        id: 'nav-kanban',
        title: 'Aller au Kanban',
        category: 'Navigation',
        icon: <Kanban size={16} />,
        action: () => {
          setActiveTab('kanban');
          setIsOpen(false);
        },
      },
      {
        id: 'nav-cal',
        title: 'Aller au Calendrier',
        category: 'Navigation',
        icon: <Calendar size={16} />,
        action: () => {
          setActiveTab('calendar');
          setIsOpen(false);
        },
      },
      {
        id: 'nav-notes',
        title: 'Aller aux Notes',
        category: 'Navigation',
        icon: <FileText size={16} />,
        action: () => {
          setActiveTab('notes');
          setIsOpen(false);
        },
      },
      {
        id: 'nav-pomo',
        title: 'Aller au Pomodoro',
        category: 'Navigation',
        icon: <Timer size={16} />,
        action: () => {
          setActiveTab('pomodoro');
          setIsOpen(false);
        },
      },
    );

    // 2. Actions Rapides dynamiques basées sur la saisie
    if (search.trim().length > 0) {
      const trimmed = search.trim();
      items.push(
        {
          id: 'action-task',
          title: `Créer la tâche "${trimmed}"`,
          subtitle: 'Dans le premier projet disponible',
          category: 'Actions',
          icon: <Plus size={16} />,
          action: async () => {
            if (projects.length > 0) {
              await createTask(projects[0].id, trimmed);
              setIsOpen(false);
            } else {
              alert("Veuillez d'abord créer un projet.");
            }
          },
        },
        {
          id: 'action-project',
          title: `Créer le projet "${trimmed}"`,
          category: 'Actions',
          icon: <Plus size={16} />,
          action: async () => {
            await createProject(trimmed);
            setIsOpen(false);
          },
        },
        {
          id: 'action-note',
          title: `Créer la note "${trimmed}"`,
          category: 'Actions',
          icon: <Plus size={16} />,
          action: async () => {
            await saveNote(trimmed, '');
            setIsOpen(false);
            setActiveTab('notes');
          },
        },
      );
    }

    // 3. Recherche dans les tâches existantes (pour lancer le timer)
    projects.forEach((proj) => {
      if (proj.tasks) {
        proj.tasks.forEach((task) => {
          items.push({
            id: `task-${task.id}`,
            title: `Démarrer le timer : ${task.title}`,
            subtitle: `Projet: ${proj.name}`,
            category: 'Tâches',
            icon: <Play size={16} />,
            action: () => {
              startTimer(task.id);
              setIsOpen(false);
            },
          });
        });
      }
    });

    // 4. Recherche dans les Notes existantes
    notes.forEach((note) => {
      items.push({
        id: `note-${note.id}`,
        title: `Ouvrir la note : ${note.title}`,
        category: 'Notes',
        icon: <FileText size={16} />,
        action: () => {
          // Normalement on ouvre cette note précise
          setActiveTab('notes');
          setIsOpen(false);
        },
      });
    });

    // 5. Recherche dans les Projets existants
    projects.forEach((proj) => {
      items.push({
        id: `project-${proj.id}`,
        title: `Afficher le projet : ${proj.name}`,
        category: 'Projets',
        icon: <Kanban size={16} />,
        action: () => {
          setActiveTab('kanban');
          setIsOpen(false);
        },
      });
    });

    // Filtrer par recherche
    if (!search.trim()) return items.slice(0, 8); // Retourner seulement les premiers items par défaut

    const query = search.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(query)) ||
        item.category.toLowerCase().includes(query),
    );
  };

  const filteredCommands = getCommands();

  // Gérer la navigation clavier
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="glass-panel command-palette-modal">
        {/* Barre de recherche */}
        <div className="command-palette-search-wrapper">
          <Search className="search-icon" size={18} />
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Rechercher une tâche, un projet, créer une note ou naviguer..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="shortcut-hint">ESC</div>
        </div>

        {/* Liste des résultats */}
        <div className="command-palette-results">
          {filteredCommands.length === 0 ? (
            <div className="no-results">
              <Sparkles size={16} />
              <span>Aucun résultat pour "{search}"</span>
            </div>
          ) : (
            // Regrouper par catégorie pour un rendu propre
            filteredCommands.map((cmd, index) => (
              <div
                key={cmd.id}
                className={`command-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={cmd.action}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="command-item-icon">{cmd.icon}</div>
                <div className="command-item-details">
                  <span className="command-item-title">{cmd.title}</span>
                  {cmd.subtitle && <span className="command-item-subtitle">{cmd.subtitle}</span>}
                </div>
                <span className="command-item-category">{cmd.category}</span>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="command-palette-footer">
          <span>↑↓ Naviguer</span>
          <span>↵ Valider</span>
          <span>Fermer avec Esc</span>
        </div>
      </div>
    </div>
  );
};
