import React, { useState } from 'react'
import { useApp, Note } from '../context/AppContext'
import { FileText, Plus, Save, Trash2, CheckCircle2 } from 'lucide-react'

export const Notepad: React.FC = () => {
  const { notes, saveNote, deleteNote } = useApp()
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(notes[0]?.id || null)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [showSuccessToast, setShowSuccessToast] = useState(false)
  const [parsedCount, setParsedCount] = useState(0)

  const activeNote = notes.find(n => n.id === selectedNoteId)

  // Synchroniser l'éditeur avec la note sélectionnée
  React.useEffect(() => {
    if (activeNote) {
      setNoteTitle(activeNote.title)
      setNoteContent(activeNote.content)
    } else {
      setNoteTitle('')
      setNoteContent('')
    }
  }, [selectedNoteId, notes])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!noteTitle.trim()) return

    // Estimer combien de tâches vont être créées
    const taskRegex = /^-\s*\[\s*\]\s+(.+)$/im
    const lines = noteContent.split('\n')
    const count = lines.filter(line => taskRegex.test(line)).length

    await saveNote(noteTitle, noteContent, selectedNoteId || undefined)
    
    if (count > 0) {
      setParsedCount(count)
      setShowSuccessToast(true)
      setTimeout(() => setShowSuccessToast(false), 5000)
    }
  }

  const handleCreateNew = () => {
    setSelectedNoteId(null)
    setNoteTitle('')
    setNoteContent('')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '24px', flex: 1, minHeight: 0 }}>
      {/* Sidebar de la liste des notes */}
      <aside className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mes Notes</h3>
          <button onClick={handleCreateNew} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer' }}>
            <Plus size={18} />
          </button>
        </div>

        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto', flex: 1 }}>
          {notes.map(note => (
            <li
              key={note.id}
              onClick={() => setSelectedNoteId(note.id)}
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                background: selectedNoteId === note.id ? 'var(--glass-highlight)' : 'none',
                color: selectedNoteId === note.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                {note.title || 'Note sans titre'}
              </span>
              <Trash2 size={13} style={{ cursor: 'pointer', opacity: 0.5 }} onClick={(e) => { e.stopPropagation(); deleteNote(note.id); handleCreateNew() }} />
            </li>
          ))}
        </ul>
      </aside>

      {/* Zone d'édition */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
        {showSuccessToast && (
          <div style={{
            background: 'var(--color-success)',
            color: '#fff',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: 'var(--shadow-md)',
            animation: 'pulse-glow 3s infinite'
          }}>
            <CheckCircle2 size={20} />
            <div>
              <p style={{ fontWeight: 600, fontSize: '14px' }}>Note enregistrée avec succès !</p>
              <p style={{ fontSize: '12px', opacity: 0.9 }}>{parsedCount} tâche(s) ont été extraite(s) et ajoutée(s) à votre Todo-list.</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Titre de la note"
              value={noteTitle}
              onChange={e => setNoteTitle(e.target.value)}
              style={{
                background: 'none',
                border: 'none',
                color: '#fff',
                fontSize: '20px',
                fontWeight: 700,
                outline: 'none',
                width: '70%',
                borderBottom: '1px solid transparent'
              }}
              onFocus={e => e.target.style.borderBottom = '1px solid var(--glass-border)'}
              onBlur={e => e.target.style.borderBottom = '1px solid transparent'}
              required
            />

            <button type="submit" className="btn-primary">
              <Save size={16} /> Enregistrer
            </button>
          </div>

          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr', gap: '20px', minHeight: 0 }}>
            <textarea
              placeholder="Rédigez vos notes en Markdown ici...&#10;&#10;Pour automatiser une tâche, écrivez simplement :&#10;- [ ] Rédiger le rapport d'architecture #Planner-Pro"
              value={noteContent}
              onChange={e => setNoteContent(e.target.value)}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--glass-border)',
                color: '#fff',
                padding: '16px',
                borderRadius: 'var(--radius-sm)',
                outline: 'none',
                resize: 'none',
                fontFamily: 'monospace',
                fontSize: '14px',
                lineHeight: '1.6'
              }}
            />
          </div>
        </form>
      </div>
    </div>
  )
}
