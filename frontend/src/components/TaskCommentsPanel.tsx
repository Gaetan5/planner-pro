import React, { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { X, MessageSquare, Send, Trash2, Edit2, AtSign, Check, Paperclip, CornerDownRight, FileText, Image, File } from 'lucide-react'
import './TaskCommentsPanel.css'

interface TaskCommentsPanelProps {
  taskId: string
  taskTitle: string
  onClose: () => void
}

export const TaskCommentsPanel: React.FC<TaskCommentsPanelProps> = ({ taskId, taskTitle, onClose }) => {
  const { 
    user, 
    socket, 
    addComment, 
    getComments, 
    deleteComment, 
    updateComment, 
    workspaceMembers,
    createTaskAttachment,
    getTaskAttachments,
    deleteTaskAttachment
  } = useApp()

  const [comments, setComments] = useState<any[]>([])
  const [taskAttachments, setTaskAttachments] = useState<any[]>([])
  const [newCommentText, setNewCommentText] = useState('')
  const [loading, setLoading] = useState(true)
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  
  // États pour auto-complétion des mentions @
  const [showMentionsList, setShowMentionsList] = useState(false)
  const [mentionSearch, setMentionSearch] = useState('')
  const [mentionTriggerIndex, setMentionTriggerIndex] = useState(-1)

  // États pour la modification d'un commentaire
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  // État pour répondre à un commentaire
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null)

  // Pièces jointes en attente de publication pour le nouveau commentaire
  const [pendingAttachments, setPendingAttachments] = useState<any[]>([])

  // Indicateur de saisie en temps réel (typing indicator)
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({})
  
  const commentsEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const typingTimeoutRef = useRef<any>(null)
  const taskFileInputRef = useRef<HTMLInputElement>(null)
  const commentFileInputRef = useRef<HTMLInputElement>(null)

  // Fonctions pour manipuler l'arbre des commentaires localement
  const addCommentToTree = (list: any[], newComment: any): any[] => {
    if (!newComment.parentId) {
      if (list.some(c => c.id === newComment.id)) return list
      return [...list, { ...newComment, replies: [] }]
    }
    
    return list.map(c => {
      if (c.id === newComment.parentId) {
        const replies = c.replies || []
        if (replies.some((r: any) => r.id === newComment.id)) return c
        return {
          ...c,
          replies: [...replies, { ...newComment, replies: [] }]
        }
      } else if (c.replies && c.replies.length > 0) {
        return {
          ...c,
          replies: addCommentToTree(c.replies, newComment)
        }
      }
      return c
    })
  }

  const removeCommentFromTree = (list: any[], commentId: string): any[] => {
    return list
      .filter(c => c.id !== commentId)
      .map(c => {
        if (c.replies && c.replies.length > 0) {
          return {
            ...c,
            replies: removeCommentFromTree(c.replies, commentId)
          }
        }
        return c
      })
  }

  const updateCommentInTree = (list: any[], updatedComment: any): any[] => {
    return list.map(c => {
      if (c.id === updatedComment.id) {
        return { ...c, ...updatedComment }
      } else if (c.replies && c.replies.length > 0) {
        return {
          ...c,
          replies: updateCommentInTree(c.replies, updatedComment)
        }
      }
      return c
    })
  }

  // Charger les commentaires, pièces jointes et s'abonner via WebSocket
  useEffect(() => {
    const initData = async () => {
      setLoading(true)
      try {
        const [commentsList, attachmentsList] = await Promise.all([
          getComments(taskId),
          getTaskAttachments(taskId)
        ])
        setComments(commentsList)
        setTaskAttachments(attachmentsList)
      } catch (e) {
        console.error('Erreur chargement données discussion', e)
      } finally {
        setLoading(false)
      }
    }

    initData()

    // S'abonner aux événements temps réel de cette tâche
    if (socket) {
      socket.emit('join-task', { taskId })

      const handleNewComment = (data: any) => {
        if (data.taskId === taskId) {
          setComments(prev => addCommentToTree(prev, data.comment))
        }
      }

      const handleCommentDeleted = (data: any) => {
        if (data.taskId === taskId) {
          setComments(prev => removeCommentFromTree(prev, data.commentId))
        }
      }

      const handleCommentUpdated = (data: any) => {
        if (data.taskId === taskId) {
          setComments(prev => updateCommentInTree(prev, data.comment))
        }
      }

      const handleUserTyping = (data: any) => {
        if (data.taskId === taskId) {
          setTypingUsers(prev => {
            const next = { ...prev }
            if (data.isTyping) {
              const member = workspaceMembers.find(m => m.user.id === data.userId)
              const name = member ? (member.user.name || member.user.email) : 'Quelqu’un'
              next[data.userId] = name
            } else {
              delete next[data.userId]
            }
            return next
          })
        }
      }

      socket.on('new-comment', handleNewComment)
      socket.on('comment-deleted', handleCommentDeleted)
      socket.on('comment-updated', handleCommentUpdated)
      socket.on('user-typing', handleUserTyping)

      return () => {
        socket.emit('leave-task', { taskId })
        socket.off('new-comment', handleNewComment)
        socket.off('comment-deleted', handleCommentDeleted)
        socket.off('comment-updated', handleCommentUpdated)
        socket.off('user-typing', handleUserTyping)
        
        // Arrêter le typing
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current)
        }
      }
    }
  }, [taskId, socket, workspaceMembers])

  // Faire défiler vers le bas lors de l'ajout d'un commentaire
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments])

  // Gérer la saisie et l'auto-complétion du @
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setNewCommentText(text)

    // WebSocket typing
    if (socket) {
      socket.emit('typing', { taskId, isTyping: true })
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }
      
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing', { taskId, isTyping: false })
      }, 3000)
    }

    const cursorPosition = e.target.selectionStart
    const lastAtPos = text.lastIndexOf('@', cursorPosition - 1)

    if (lastAtPos !== -1) {
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
    
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // Filtrer les membres du workspace pour les mentions
  const filteredMembers = workspaceMembers.filter(m => {
    const name = m.user.name || m.user.email
    return name.toLowerCase().includes(mentionSearch.toLowerCase())
  })

  // Envoyer un commentaire
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCommentText.trim() && pendingAttachments.length === 0) return

    try {
      if (socket) {
        socket.emit('typing', { taskId, isTyping: false })
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
      }

      await addComment(taskId, newCommentText, replyingTo?.id, pendingAttachments)
      setNewCommentText('')
      setReplyingTo(null)
      setPendingAttachments([])
    } catch (err: any) {
      alert(err.message || "Erreur lors de la publication du commentaire.")
    }
  }

  // Supprimer un commentaire
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

  // Uploader une pièce jointe pour la Tâche
  const handleTaskFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setAttachmentsLoading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const fileUrl = reader.result as string
      try {
        await createTaskAttachment(taskId, file.name, fileUrl, file.type, file.size)
        // Recharger la liste
        const list = await getTaskAttachments(taskId)
        setTaskAttachments(list)
      } catch (err: any) {
        alert(err.message || "Erreur lors de l'ajout de la pièce jointe.")
      } finally {
        setAttachmentsLoading(false)
        if (taskFileInputRef.current) taskFileInputRef.current.value = ''
      }
    }
    reader.readAsDataURL(file)
  }

  // Supprimer une pièce jointe de la Tâche
  const handleDeleteTaskAttachment = async (attachmentId: string) => {
    if (window.confirm("Voulez-vous vraiment supprimer cette pièce jointe ?")) {
      setAttachmentsLoading(true)
      try {
        await deleteTaskAttachment(attachmentId)
        setTaskAttachments(prev => prev.filter(att => att.id !== attachmentId))
      } catch (err: any) {
        alert(err.message || "Erreur lors de la suppression de la pièce jointe.")
      } finally {
        setAttachmentsLoading(false)
      }
    }
  }

  // Gérer l'ajout d'une pièce jointe au Commentaire (localement)
  const handleCommentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const fileUrl = reader.result as string
      setPendingAttachments(prev => [
        ...prev,
        {
          fileName: file.name,
          fileUrl,
          fileType: file.type,
          fileSize: file.size
        }
      ])
      if (commentFileInputRef.current) commentFileInputRef.current.value = ''
    }
    reader.readAsDataURL(file)
  }

  const handleRemovePendingAttachment = (index: number) => {
    setPendingAttachments(prev => prev.filter((_, idx) => idx !== index))
  }

  // Formatter la date
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

  // Déterminer l'icône de pièce jointe à afficher
  const getAttachmentIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) return <Image size={14} className="attachment-icon-img" />
    if (fileType.includes('pdf') || fileType.includes('document') || fileType.includes('text')) {
      return <FileText size={14} className="attachment-icon-doc" />
    }
    return <File size={14} className="attachment-icon-gen" />
  }

  // Formater la taille du fichier
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  // Rendu d'un commentaire avec ses réponses de manière récursive
  const renderComment = (c: any, depth = 0) => {
    const isMyComment = c.userId === user?.id
    const initials = (c.user?.name || c.user?.email || 'U').slice(0, 2).toUpperCase()
    const isEditing = editingCommentId === c.id

    return (
      <div key={c.id} className="comment-thread-wrapper" style={{ marginLeft: `${Math.min(depth * 16, 48)}px` }}>
        {depth > 0 && (
          <div className="comment-thread-line-indicator">
            <CornerDownRight size={12} color="var(--text-muted)" />
          </div>
        )}

        <div className={`comment-bubble-row ${isMyComment ? 'comment-bubble-row--mine' : ''}`}>
          <div className="comment-avatar">
            {initials}
          </div>
          
          {isEditing ? (
            <div className="comment-bubble-content-box comment-bubble-content-box--editing">
              <div className="comment-bubble-meta">
                <span className="comment-author-name">{c.user?.name || 'Collaborateur'}</span>
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
                  >
                    <Check size={12} /> Enregistrer
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="btn-comment-cancel"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="comment-bubble-content-box">
              <div className="comment-bubble-meta">
                <span className="comment-author-name">{c.user?.name || 'Collaborateur'}</span>
                <span className="comment-date">{formatDate(c.createdAt)}</span>
              </div>
              
              <div className="comment-bubble-text">
                {renderFormattedContent(c.content)}
              </div>

              {/* Pièces jointes du commentaire */}
              {c.attachments && c.attachments.length > 0 && (
                <div className="comment-attachments-list">
                  {c.attachments.map((att: any) => (
                    <a
                      key={att.id}
                      href={att.fileUrl}
                      download={att.fileName}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="comment-attachment-card"
                      title={`${att.fileName} (${formatFileSize(att.fileSize)})`}
                    >
                      {getAttachmentIcon(att.fileType)}
                      <span className="comment-attachment-name">{att.fileName}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions sur les commentaires */}
          <div className="comment-actions-group">
            {!isEditing && (
              <button
                onClick={() => setReplyingTo({ id: c.id, name: c.user?.name || c.user?.email })}
                className="btn-comment-action btn-comment-action--reply"
                title="Répondre"
              >
                <MessageSquare size={12} />
              </button>
            )}
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

        {/* Réponses récursives */}
        {c.replies && c.replies.length > 0 && (
          <div className="comment-replies-container">
            {c.replies.map((reply: any) => renderComment(reply, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const typingNames = Object.values(typingUsers)

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

        {/* Section Pièces jointes de la tâche */}
        <div className="drawer-task-attachments-section">
          <div className="attachments-section-header">
            <h4>Pièces jointes de la tâche ({taskAttachments.length})</h4>
            <label className="btn-upload-task-attachment" title="Ajouter un fichier à la tâche">
              <Paperclip size={14} /> Ajouter
              <input
                ref={taskFileInputRef}
                type="file"
                onChange={handleTaskFileChange}
                style={{ display: 'none' }}
              />
            </label>
          </div>
          
          {attachmentsLoading && (
            <div className="attachments-mini-loader">
              <span className="spinner-loader spinner-loader--xs"></span>
              <span>Traitement...</span>
            </div>
          )}

          {taskAttachments.length > 0 ? (
            <div className="task-attachments-grid">
              {taskAttachments.map(att => (
                <div key={att.id} className="task-attachment-item">
                  <a
                    href={att.fileUrl}
                    download={att.fileName}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="task-attachment-link"
                    title={att.fileName}
                  >
                    {getAttachmentIcon(att.fileType)}
                    <span className="task-attachment-name">{att.fileName}</span>
                  </a>
                  <button
                    onClick={() => handleDeleteTaskAttachment(att.id)}
                    className="btn-delete-task-attachment"
                    title="Supprimer la pièce jointe"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-attachments-placeholder">Aucune pièce jointe sur cette tâche.</p>
          )}
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
              {comments.map(c => renderComment(c))}
              <div ref={commentsEndRef} />
            </div>
          )}
        </div>

        {/* Zone de saisie d'un nouveau commentaire */}
        <div className="drawer-input-area">
          {/* Indicateur de saisie en temps réel */}
          {typingNames.length > 0 && (
            <div className="realtime-typing-container">
              <div className="typing-dots-animation">
                <span></span><span></span><span></span>
              </div>
              <span className="typing-label-text">
                {typingNames.join(', ')} {typingNames.length === 1 ? 'écrit...' : 'écrivent...'}
              </span>
            </div>
          )}

          {/* Mentions auto-complétion */}
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

          {/* Liste des pièces jointes en attente de publication */}
          {pendingAttachments.length > 0 && (
            <div className="pending-attachments-bar">
              {pendingAttachments.map((file, idx) => (
                <div key={idx} className="pending-attachment-badge">
                  {getAttachmentIcon(file.fileType)}
                  <span className="pending-attachment-name" title={file.fileName}>{file.fileName}</span>
                  <button
                    type="button"
                    onClick={() => handleRemovePendingAttachment(idx)}
                    className="btn-remove-pending"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Indicateur de réponse en cours */}
          {replyingTo && (
            <div className="replying-to-indicator">
              <CornerDownRight size={12} />
              <span>Répondre à <strong>{replyingTo.name}</strong></span>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                className="btn-cancel-reply"
              >
                Annuler
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="comment-compose-form">
            <label className="btn-comment-attach-file" title="Attacher un fichier à ce commentaire">
              <Paperclip size={16} />
              <input
                ref={commentFileInputRef}
                type="file"
                onChange={handleCommentFileChange}
                style={{ display: 'none' }}
              />
            </label>

            <textarea
              ref={textareaRef}
              rows={2}
              value={newCommentText}
              onChange={handleTextChange}
              placeholder={replyingTo ? "Écrivez une réponse..." : "Écrivez un commentaire... Utilisez @ pour mentionner."}
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
              disabled={!newCommentText.trim() && pendingAttachments.length === 0}
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

