import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Plus, Save, Trash2, CheckCircle2 } from 'lucide-react';
import './Notepad.css';

export const Notepad: React.FC = () => {
  const { notes, saveNote, deleteNote } = useApp();
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(notes[0]?.id || null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [parsedCount, setParsedCount] = useState(0);
  const [liveTaskCount, setLiveTaskCount] = useState(0);

  const activeNote = notes.find((n) => n.id === selectedNoteId);

  // Synchroniser l'éditeur avec la note sélectionnée
  React.useEffect(() => {
    if (activeNote) {
      setNoteTitle(activeNote.title);
      setNoteContent(activeNote.content);
    } else {
      setNoteTitle('');
      setNoteContent('');
    }
  }, [selectedNoteId, notes]);

  // Debounce regex local pour compter les - [ ] en temps réel
  React.useEffect(() => {
    const handler = setTimeout(() => {
      const taskRegex = /^-\s*\[\s*\]\s+(.+)$/im;
      const lines = noteContent.split('\n');
      const count = lines.filter((line) => taskRegex.test(line)).length;
      setLiveTaskCount(count);
    }, 300);

    return () => clearTimeout(handler);
  }, [noteContent]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim()) return;

    // Estimer combien de tâches vont être créées
    const taskRegex = /^-\s*\[\s*\]\s+(.+)$/im;
    const lines = noteContent.split('\n');
    const count = lines.filter((line) => taskRegex.test(line)).length;

    await saveNote(noteTitle, noteContent, selectedNoteId || undefined);

    if (count > 0) {
      setParsedCount(count);
      setShowSuccessToast(true);
      setTimeout(() => setShowSuccessToast(false), 5000);
    }
  };

  const handleCreateNew = () => {
    setSelectedNoteId(null);
    setNoteTitle('');
    setNoteContent('');
  };

  return (
    <div className="notepad-layout">
      {/* Sidebar de la liste des notes */}
      <aside className="glass-panel notepad-sidebar">
        <div className="notepad-sidebar-header">
          <h3 className="notepad-sidebar-title">Mes Notes</h3>
          <button onClick={handleCreateNew} className="notepad-new-note-btn">
            <Plus size={18} />
          </button>
        </div>

        <ul className="notepad-note-list">
          {notes.map((note) => {
            const activeTasks = note.tasks?.filter((t) => t.status !== 'DONE') || [];
            return (
              <li
                key={note.id}
                onClick={() => setSelectedNoteId(note.id)}
                className={`notepad-note-item ${selectedNoteId === note.id ? 'notepad-note-item--active' : ''}`}
              >
                <span className="notepad-note-title-span">
                  {note.title || 'Note sans titre'}
                  {activeTasks.length > 0 && (
                    <span
                      className="task-indicator"
                      style={{ marginLeft: '8px', padding: '1px 5px', fontSize: '10px' }}
                    >
                      {activeTasks.length}
                    </span>
                  )}
                </span>
                <button
                  className="notepad-note-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNote(note.id);
                    handleCreateNew();
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Zone d'édition */}
      <div className="notepad-editor-container">
        {showSuccessToast && (
          <div className="toast toast--success">
            <CheckCircle2 size={20} />
            <div>
              <p style={{ fontWeight: 600, fontSize: '14px', margin: 0 }}>
                Note enregistrée avec succès !
              </p>
              <p style={{ fontSize: '12px', opacity: 0.9, margin: 0 }}>
                {parsedCount} tâche(s) ont été extraite(s) et ajoutée(s) à votre Todo-list.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="glass-panel notepad-editor-form">
          <div className="notepad-editor-header">
            <input
              type="text"
              placeholder="Titre de la note"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              className="notepad-note-title-input"
              required
            />

            <button type="submit" className="btn-primary">
              <Save size={16} /> Enregistrer
            </button>
          </div>

          <div className="notepad-textarea-container">
            <textarea
              placeholder="Rédigez vos notes en Markdown ici...&#10;&#10;Pour automatiser une tâche, écrivez simplement :&#10;- [ ] Rédiger le rapport d'architecture #Planner-Pro"
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="notepad-textarea"
            />
            <div className="notepad-toolbar">
              <span>Markdown supporté</span>
              {liveTaskCount > 0 && (
                <span className="task-indicator">{liveTaskCount} tâche(s) détectée(s)</span>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
