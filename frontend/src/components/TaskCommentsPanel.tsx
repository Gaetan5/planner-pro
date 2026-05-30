import React, { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { X, MessageSquare, Send, Trash2, Edit2, AtSign, Check } from 'lucide-react'
import './TaskCommentsPanel.css'

interface TaskCommentsPanelProps {
  taskId: string
  taskTitle: string
  onClose: () => void
}

export const TaskCommentsPanel: React.FC<TaskCommentsPanelProps> = ({ taskId, taskTitle, onClose }) => {
  const { user, socket, addComment, getComments, deleteComment, updateComment, workspaceMembers } = useApp()

  const [comments, setComments] = useState<any[]>([])
  const [newCommentText, setNewCommentText] = useState('')
  const [loading, setLoading] = useState(true)
  
  // États pour auto-complétion des mentions @
  const [showMentionsList, setShowMentionsList] = useState(false)
  const [mentionSearch, setMentionSearch] = useState('')
  const [mentionTriggerIndex, setMentionTriggerIndex] = useState(-1)

  // États pour la modification d'un commentaire
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  
  const commentsEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Charger les commentaires et s'abonner via WebSocket
  useEffect(() => {
    const fetchComments = async () => {
      setLoading(true)
      try {
        const list = await getComments(taskId)
        setComments(list)
      } catch (e) {
        console.error('Erreur chargement commentaires', e)
      } finally {
        setLoading(false)
      }
    }

    fetchComments()

    // S'abonner aux événements temps réel de cette tâche
    if (socket) {
      socket.emit('join-task', { taskId })

      const handleNewComment = (data: any) => {
        if (data.taskId === taskId) {
          setComments(prev => {
            if (prev.some(c => c.id === data.comment.id)) return prev
            return [...prev, data.comment]
          })
        }
      }

      const handleCommentDeleted = (data: any) => {
        if (data.taskId === taskId) {
          setComments(prev => prev.filter(c => c.id !== data.commentId))
        }
      }

      const handleCommentUpdated = (data: any) => {
        if (data.taskId === taskId) {
          setComments(prev => prev.map(c => c.id === data.comment.id ? data.comment : c))
        }
      }

      socket.on('new-comment', handleNewComment)
      socket.on('comment-deleted', handleCommentDeleted)
      socket.on('comment-updated', handleCommentUpdated)

      return () => {
        socket.emit('leave-task', { taskId })
        socket.off('new-comment', handleNewComment)
        socket.off('comment-deleted', handleCommentDeleted)
        socket.off('comment-updated', handleCommentUpdated)
      }
    }
  }, [taskId, socket])

  // Faire défiler vers le bas lors de l'ajout d'un commentaire
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments])

  // Gérer la saisie et l'auto-complétion du @
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setNewCommentText(text)

    const cursorPosition = e.target.selectionStart
    const lastAtPos = text.lastIndexOf('@', cursorPosition - 1)

    if (lastAtPos !== -1) {
      // S'assurer qu'il n'y a pas d'espace entre le @ et le curseur
      const sub = text.slice(lastAtPos + 1, cursorPosition)
      if (!sub.includes(' ') && !sub.includes('\n')) {
        setShowMentionsList(true)
        setMentionSearch(sub)
        setMentionTriggerIndex(lastAtPos)
        return
      }
    }

    setShowMentionsList(false)
  }

  // Insérer une mention
  const handleSelectMention = (member: any) => {
    if (mentionTriggerIndex === -1) return

    const name = member.user.name || member.user.email.split('@')[0]
    const formattedMention = `@${name.replace(/\s+/g, '')} `
    
    const before = newCommentText.slice(0, mentionTriggerIndex)
    const after = newCommentText.slice(textareaRef.current?.selectionStart || 0)

    setNewCommentText(before + formattedMention + after)
    setShowMentionsList(false)
    setMentionTriggerIndex(-1)
    
    // Remettre le focus
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // Filtrer les membres du workspace pour les mentions
  const filteredMembers = workspaceMembers.filter(m => {
    const name = m.user.name || m.user.email
    return name.toLowerCase().includes(mentionSearch.toLowerCase())
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCommentText.trim()) return

    try {
      await addComment(taskId, newCommentText)
      setNewCommentText('')
    } catch (err: any) {
      alert(err.message || "Erreur lors de la publication du commentaire.")
    }
  }

  const handleDelete = async (commentId: string) => {
    if (window.confirm("Voulez-vous vraiment supprimer ce commentaire ?")) {
      try {
        await deleteComment(commentId)
      } catch (err: any) {
        alert(err.message || "Vous n'avez pas les droits pour supprimer ce commentaire.")
      }
    }
  }

  const handleStartEdit = (commentId: string, currentContent: string) => {
    setEditingCommentId(commentId)
    setEditingText(currentContent)
  }

  const handleCancelEdit = () => {
    setEditingCommentId(null)
    setEditingText('')
  }

  const handleSaveEdit = async (commentId: string) => {
    if (!editingText.trim()) return
    try {
      await updateComment(commentId, editingText)
      setEditingCommentId(null)
      setEditingText('')
    } catch (err: any) {
      alert(err.message || "Erreur lors de la modification du commentaire.")
    }
  }

  // Formatter la date du commentaire
  const formatDate = (isoString: string) => {
    const d = new Date(isoString)
    return d.toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Formater le texte du commentaire pour colorer les mentions @user
  const renderFormattedContent = (content: string) => {
    // Regex pour détecter les mentions @user
    const mentionRegex = /(@[a-zA-Z0-9._@-]+)/g
    const parts = content.split(mentionRegex)

    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        return (
          <span key={index} className="comment-mention-tag">
            {part}
          </span>
        )
      }
      return part
    })
  }

  return (
    <div className="task-comments-drawer-overlay" onClick={onClose}>
      <div className="task-comments-drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-header-title">
            <MessageSquare size={18} color="var(--accent-primary)" />
            <div className="drawer-header-text">
              <h3>Commentaires</h3>
              <p className="task-title-meta">{taskTitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-close-drawer">
            <X size={18} />
          </button>
        </div>

        {/* Historique des commentaires */}
        <div className="drawer-comments-history">
          {loading ? (
            <div className="comments-loading-state">
              <span className="spinner-loader"></span>
              <p>Chargement de la discussion...</p>
            </div>
          ) : comments.length === 0 ? (
            <div className="comments-empty-state">
              <MessageSquare size={36} color="var(--text-muted)" />
              <p>Aucun message sur cette tâche.</p>
              <p className="empty-subtext">Lancez la discussion en ajoutant le premier commentaire !</p>
            </div>
          ) : (
            <div className="comments-list">
              {comments.map(c => {
                const isMyComment = c.userId === user?.id
                const initials = (c.user.name || c.user.email).slice(0, 2).toUpperCase()
                
                const isEditing = editingCommentId === c.id

                return (
                  <div key={c.id} className={`comment-bubble-row ${isMyComment ? 'comment-bubble-row--mine' : ''}`}>
                    <div className="comment-avatar">
                      {initials}
                    </div>
                    
                    {isEditing ? (
                      <div className="comment-bubble-content-box comment-bubble-content-box--editing">
                        <div className="comment-bubble-meta">
                          <span className="comment-author-name">{c.user.name || 'Collaborateur'}</span>
                          <span className="comment-date">{formatDate(c.createdAt)}</span>
                        </div>
                        
                        <div className="comment-edit-form">
                          <textarea
                            rows={2}
                            value={editingText}
                            onChange={e => setEditingText(e.target.value)}
                            className="comment-edit-textarea"
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSaveEdit(c.id)
                              } else if (e.key === 'Escape') {
                                handleCancelEdit()
                              }
                            }}
                            autoFocus
                          />
                          <div className="comment-edit-actions">
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(c.id)}
                              className="btn-comment-save"
                              title="Enregistrer (Entrée)"
                            >
                              <Check size={12} /> Enregistrer
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              className="btn-comment-cancel"
                              title="Annuler (Échap)"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="comment-bubble-content-box">
                        <div className="comment-bubble-meta">
                          <span className="comment-author-name">{c.user.name || 'Collaborateur'}</span>
                          <span className="comment-date">{formatDate(c.createdAt)}</span>
                        </div>
                        
                        <div className="comment-bubble-text">
                          {renderFormattedContent(c.content)}
                        </div>
                      </div>
                    )}

                    {/* Actions sur les commentaires */}
                    <div className="comment-actions-group">
                      {isMyComment && !isEditing && (
                        <button
                          onClick={() => handleStartEdit(c.id, c.content)}
                          className="btn-comment-action btn-comment-action--edit"
                          title="Modifier"
                        >
                          <Edit2 size={12} />
                        </button>
                      )}
                      {(isMyComment || user?.id) && (
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="btn-comment-action btn-comment-action--delete"
                          title="Supprimer"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              <div ref={commentsEndRef} />
            </div>
          )}
        </div>

        {/* Zone de saisie d'un nouveau commentaire */}
        <div className="drawer-input-area">
          {showMentionsList && filteredMembers.length > 0 && (
            <div className="mentions-autocomplete-box">
              <div className="mentions-box-header">
                <AtSign size={12} /> Mentionner un membre
              </div>
              <ul className="mentions-list">
                {filteredMembers.map(m => (
                  <li key={m.id} onClick={() => handleSelectMention(m)}>
                    <div className="mention-avatar-mini">
                      {(m.user.name || m.user.email).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="mention-member-details">
                      <span className="mention-name">{m.user.name || 'Collaborateur'}</span>
                      <span className="mention-email">{m.user.email}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form onSubmit={handleSubmit} className="comment-compose-form">
            <textarea
              ref={textareaRef}
              rows={2}
              value={newCommentText}
              onChange={handleTextChange}
              placeholder="Écrivez un commentaire... Utilisez @ pour mentionner un membre."
              className="comment-textarea"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit(e)
                }
              }}
            />
            <button
              type="submit"
              disabled={!newCommentText.trim()}
              className="btn-send-comment"
              title="Envoyer (Entrée)"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
