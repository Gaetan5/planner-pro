import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, AtSign, UserPlus, Info, BellOff } from 'lucide-react'
import { useApp } from '../context/AppContext'
import './NotificationInbox.css'

export interface Notification {
  id: string
  userId: string
  senderId?: string
  sender?: { id: string; name?: string; email: string }
  type: string
  title: string
  content: string
  read: boolean
  taskId?: string
  projectId?: string
  createdAt: string
}

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export function NotificationInbox() {
  const { user, socket } = useApp()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const getHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': user?.token ? `Bearer ${user.token}` : ''
  }), [user?.token])

  // Charger les notifications depuis le backend
  const fetchNotifications = useCallback(async () => {
    if (!user) return
    try {
      const res = await fetch(`${BACKEND_URL}/notifications`, { headers: getHeaders() })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data)
      }
    } catch (e) {
      console.error('Erreur lors du chargement des notifications:', e)
    }
  }, [user, getHeaders])

  // Charger au montage et quand l'utilisateur change
  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Écouter les notifications WebSocket temps réel
  useEffect(() => {
    if (!socket) return

    const handleNewNotification = (notif: Notification) => {
      setNotifications(prev => [notif, ...prev])
    }

    socket.on('new-notification', handleNewNotification)

    return () => {
      socket.off('new-notification', handleNewNotification)
    }
  }, [socket])

  // Marquer comme lue
  const markAsRead = async (notifId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/notifications/${notifId}/read`, {
        method: 'PATCH',
        headers: getHeaders(),
      })
      if (res.ok) {
        setNotifications(prev =>
          prev.map(n => n.id === notifId ? { ...n, read: true } : n)
        )
      }
    } catch (e) {
      console.error('Erreur lors du marquage de la notification:', e)
    }
  }

  // Marquer toutes comme lues
  const markAllAsRead = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/notifications/read-all`, {
        method: 'POST',
        headers: getHeaders(),
      })
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      }
    } catch (e) {
      console.error('Erreur lors du marquage de toutes les notifications:', e)
    }
  }

  // Fermer au clic extérieur
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const unreadCount = notifications.filter(n => !n.read).length

  // Helper pour le temps relatif
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'à l\'instant'
    if (mins < 60) return `il y a ${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `il y a ${hours}h`
    const days = Math.floor(hours / 24)
    return `il y a ${days}j`
  }

  // Icône selon le type
  const getIcon = (type: string) => {
    switch (type) {
      case 'MENTION':
        return (
          <div className="notification-item__icon notification-item__icon--mention">
            <AtSign size={14} />
          </div>
        )
      case 'ASSIGNMENT':
        return (
          <div className="notification-item__icon notification-item__icon--assignment">
            <UserPlus size={14} />
          </div>
        )
      default:
        return (
          <div className="notification-item__icon notification-item__icon--system">
            <Info size={14} />
          </div>
        )
    }
  }

  return (
    <div className="notification-bell-container" ref={containerRef} style={{ position: 'relative' }}>
      <button
        className="notification-bell"
        onClick={() => setIsOpen(!isOpen)}
        title="Notifications"
        id="notification-bell"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="notification-bell__badge">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="notification-inbox-overlay" onClick={() => setIsOpen(false)} />
          <div className="notification-inbox">
            <div className="notification-inbox__header">
              <span className="notification-inbox__title">Notifications</span>
              <div className="notification-inbox__actions">
                {unreadCount > 0 && (
                  <button
                    className="notification-inbox__mark-all-btn"
                    onClick={markAllAsRead}
                  >
                    Tout marquer comme lu
                  </button>
                )}
              </div>
            </div>

            <div className="notification-inbox__list">
              {notifications.length === 0 ? (
                <div className="notification-inbox__empty">
                  <BellOff size={32} className="notification-inbox__empty-icon" />
                  <span className="notification-inbox__empty-text">Aucune notification</span>
                </div>
              ) : (
                notifications.map(notif => (
                  <div
                    key={notif.id}
                    className={`notification-item ${!notif.read ? 'notification-item--unread' : ''}`}
                    onClick={() => {
                      if (!notif.read) markAsRead(notif.id)
                    }}
                  >
                    {getIcon(notif.type)}
                    <div className="notification-item__body">
                      <div className="notification-item__title-row">
                        <span className="notification-item__title">{notif.title}</span>
                        <span className="notification-item__time">{timeAgo(notif.createdAt)}</span>
                      </div>
                      <div className="notification-item__content">{notif.content}</div>
                      {notif.sender && (
                        <div className="notification-item__sender">
                          par {notif.sender.name || notif.sender.email}
                        </div>
                      )}
                    </div>
                    {!notif.read && <div className="notification-item__dot" />}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
