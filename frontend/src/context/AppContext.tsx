import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { SESSION_EXPIRED_EVENT, refreshSession } from '../api-session';

export interface TaskAssignee {
  id: string;
  user: { id: string; name?: string; email: string };
}

export interface TaskDependency {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  type: 'FINISH_TO_START' | 'START_TO_START' | 'FINISH_TO_FINISH';
  dependsOnTask?: Task;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  startDate?: string;
  dueDate?: string;
  estimatedMinutes?: number;
  progress?: number;
  labels?: string;
  projectId: string;
  project?: { name: string };
  assignees?: TaskAssignee[];
  dependencies?: TaskDependency[];
  dependents?: { id: string; task: Task }[];
  noteId?: string;
  storyPoints?: number;
  sprintId?: string;
  completedAt?: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  memberships?: WorkspaceMember[];
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  githubRepo?: string;
  status?: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'AT_RISK' | 'DELIVERED' | 'CLOSED';
  startDate?: string;
  dueDate?: string;
  workspaceId?: string;
  workspace?: Workspace;
  milestones?: Milestone[];
  deliverables?: Deliverable[];
  deliveries?: DeliveryRecord[];
  tasks?: Task[];
}

export interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  tasks?: Task[];
}

export interface TimeBlock {
  id: string;
  startTime: string;
  endTime: string;
  taskId: string;
  task?: Task;
}

export interface WorkspaceMember {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  user: { id: string; name?: string; email: string };
}

export type ProjectRole = 'MANAGER' | 'CONTRIBUTOR' | 'COMMENTER' | 'CLIENT';

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  user: { id: string; name?: string; email: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectAuditLog {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes: Record<string, unknown> | string | null;
  ipAddress?: string | null;
  createdAt: string;
  user?: { id: string; name?: string; email: string };
}

export interface Sprint {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
  workspaceId: string;
  totalPoints?: number;
  completedPoints?: number;
  tasks?: Task[];
}

export interface Milestone {
  id: string;
  name: string;
  description?: string;
  dueDate?: string;
  completedAt?: string;
  projectId: string;
}

export interface Deliverable {
  id: string;
  title: string;
  description?: string;
  status: 'DRAFT' | 'READY_FOR_REVIEW' | 'ACCEPTED' | 'DELIVERED';
  dueDate?: string;
  acceptedAt?: string;
  projectId: string;
}

export interface DeliveryChecklistItem {
  id: string;
  deliveryId: string;
  title: string;
  checked: boolean;
}

export interface DeliveryRecord {
  id: string;
  projectId: string;
  status: 'DRAFT' | 'READY_FOR_ACCEPTANCE' | 'ACCEPTED' | 'REJECTED';
  summary?: string;
  deliveredAt?: string;
  acceptedAt?: string;
  checklist?: DeliveryChecklistItem[];
}

export interface ResourceProfile {
  id: string;
  workspaceId: string;
  userId: string;
  weeklyCapacityMinutes: number;
  skills?: string;
  costRateCents?: number;
}

export interface ResourceCapacityReportItem {
  user: { id: string; name?: string; email: string };
  role: string;
  profile?: ResourceProfile;
  weeklyCapacityMinutes: number;
  plannedMinutes: number;
  estimatedOpenMinutes: number;
  allocationPercent: number;
  loadPercent: number;
  overloaded: boolean;
  conflicts: string[];
}

export type CreateTaskOptions = {
  startDate?: string;
  dueDate?: string;
  estimatedMinutes?: number;
  progress?: number;
  labels?: string;
  assigneeIds?: string[];
  storyPoints?: number;
  sprintId?: string;
};
/** Second facteur requis : aucune session n'existe tant que le challenge n'est pas validé (S8). */
export interface MfaChallenge {
  mfaRequired: true;
  mfaTicket: string;
}

interface AppContextType {
  apiError: string | null;
  dismissApiError: () => void;
  user: {
    id: string;
    name: string;
    email: string;
    platformRole?: 'SUPER_ADMIN' | 'PLATFORM_ADMIN' | null;
  } | null;
  projects: Project[];
  notes: Note[];
  workspaces: Workspace[];
  workspaceMembers: WorkspaceMember[];
  resourceCapacity: ResourceCapacityReportItem[];
  timeBlocks: TimeBlock[];
  activeWorkspaceId: string;
  setActiveWorkspaceId: (workspaceId: string) => void;
  activeTimer: { id: string; startTime: string; taskId: string; task?: Task } | null;
  activeTab:
    | 'dashboard'
    | 'kanban'
    | 'calendar'
    | 'notes'
    | 'pomodoro'
    | 'governance'
    | 'resources'
    | 'agile'
    | 'gantt'
    | 'finances'
    | 'admin';
  isConnected: boolean;
  login: (code: string, state?: string) => Promise<MfaChallenge | void>;
  classicLogin: (email: string, passwordRaw: string) => Promise<MfaChallenge | void>;
  verifyMfa: (mfaTicket: string, factor: { code?: string; recoveryCode?: string }) => Promise<void>;
  discoverSso: (email: string) => Promise<{
    ssoAvailable: boolean;
    domain?: string;
    provider?: string;
    enforceSSO?: boolean;
    authUrl?: string;
  }>;
  classicRegister: (email: string, passwordRaw: string, name: string) => Promise<string>;
  firebaseLogin: (idToken: string, name?: string) => Promise<MfaChallenge | void>;
  ssoLogin: (code: string, domain: string) => Promise<MfaChallenge | void>;
  logout: () => void;
  mockLogin: (name: string) => Promise<void>;
  setActiveTab: (
    tab:
      | 'dashboard'
      | 'kanban'
      | 'calendar'
      | 'notes'
      | 'pomodoro'
      | 'governance'
      | 'resources'
      | 'agile'
      | 'gantt'
      | 'finances'
      | 'admin',
  ) => void;
  createProject: (
    name: string,
    description?: string,
    workspaceId?: string,
    status?: string,
    startDate?: string,
    dueDate?: string,
  ) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  createTask: (
    projectId: string,
    title: string,
    description?: string,
    priority?: string,
    options?: CreateTaskOptions,
  ) => Promise<Task>;
  updateTask: (taskId: string, data: Partial<Task>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  startTimer: (taskId: string) => void;
  stopTimer: () => void;
  saveNote: (title: string, content: string, noteId?: string) => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;
  createTimeBlock: (taskId: string, startTime: string, endTime: string) => Promise<boolean>;
  updateTimeBlock: (timeBlockId: string, startTime: string, endTime: string) => Promise<void>;
  deleteTimeBlock: (timeBlockId: string) => Promise<void>;
  // Pomodoro
  pomodoroState: 'idle' | 'focus' | 'break';
  pomodoroTaskId: string | null;
  pomodoroTimeLeft: number;
  pomodoroSettings: { focusDuration: number; breakDuration: number };
  isPomodoroRunning: boolean;
  setPomodoroSettings: (settings: { focusDuration: number; breakDuration: number }) => void;
  startPomodoro: (taskId: string) => void;
  pausePomodoro: () => void;
  resumePomodoro: () => void;
  resetPomodoro: () => void;
  skipBreak: () => void;
  // Thème
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  // Notifications
  requestNotificationPermission: () => Promise<void>;
  sendBrowserNotification: (title: string, options?: NotificationOptions) => void;
  scheduleReminder: (taskTitle: string, startTimeIso: string) => void;
  // Professional features
  createMilestone: (
    projectId: string,
    name: string,
    description?: string,
    dueDate?: string,
  ) => Promise<void>;
  completeMilestone: (milestoneId: string) => Promise<void>;
  createDeliverable: (
    projectId: string,
    title: string,
    description?: string,
    status?: string,
    dueDate?: string,
  ) => Promise<void>;
  updateDeliverableStatus: (deliverableId: string, status: string) => Promise<void>;
  createDelivery: (projectId: string, summary?: string, checklist?: string[]) => Promise<void>;
  updateDeliveryStatus: (deliveryId: string, status: string) => Promise<void>;
  toggleDeliveryChecklistItem: (itemId: string) => Promise<void>;
  addTaskDependency: (taskId: string, dependsOnTaskId: string, type?: string) => Promise<void>;
  removeTaskDependency: (taskId: string, dependsOnTaskId: string) => Promise<void>;
  getProjectCriticalPath: (
    projectId: string,
  ) => Promise<{ criticalTaskIds: string[]; slacks: Record<string, number> } | null>;
  updateResourceProfile: (
    userId: string,
    weeklyCapacityMinutes?: number,
    skills?: string,
    costRateCents?: number,
    workspaceId?: string,
  ) => Promise<void>;
  getResourceCapacityReport: (workspaceId: string) => Promise<ResourceCapacityReportItem[]>;
  getWorkspaceMembers: (workspaceId: string) => Promise<WorkspaceMember[]>;
  createResourceAllocation: (
    projectId: string,
    userId: string,
    allocationPercent: number,
    roleLabel?: string,
    startDate?: string,
    endDate?: string,
  ) => Promise<void>;
  refreshData: () => void;
  // Invitations / Collaboration
  createInvitation: (
    workspaceId: string,
    email: string | null,
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER',
    projectId?: string,
    durationDays?: number,
  ) => Promise<{ invitation: unknown; rawToken: string }>;
  listInvitations: (workspaceId: string) => Promise<unknown[]>;
  revokeInvitation: (invitationId: string) => Promise<void>;
  checkInvitation: (token: string) => Promise<{
    workspaceName: string;
    invitedByName: string;
    role: string;
    projectName?: string | null;
    projectId?: string | null;
    email?: string | null;
  }>;
  acceptInvitation: (
    token: string,
  ) => Promise<{ workspaceId: string; projectId?: string; message: string }>;
  // Commentaires & Communication
  socket: Socket | null;
  addComment: (
    taskId: string,
    content: string,
    parentId?: string,
    attachments?: unknown[],
  ) => Promise<unknown>;
  getComments: (taskId: string) => Promise<unknown[]>;
  deleteComment: (commentId: string) => Promise<void>;
  updateComment: (commentId: string, content: string) => Promise<unknown>;
  createTaskAttachment: (
    taskId: string,
    fileName: string,
    fileUrl: string,
    fileType: string,
    fileSize: number,
  ) => Promise<unknown>;
  getTaskAttachments: (taskId: string) => Promise<unknown[]>;
  deleteTaskAttachment: (attachmentId: string) => Promise<void>;
  parseAiCommand: (
    workspaceId: string,
    projectId: string | null,
    command: string,
  ) => Promise<unknown[]>;
  executeAiActions: (
    workspaceId: string,
    projectId: string | null,
    actions: unknown[],
  ) => Promise<{ success: boolean; executedCount: number }>;
  parseAiVoiceCommand: (
    workspaceId: string,
    projectId: string | null,
    audioBlob: Blob,
  ) => Promise<{ transcription: string; actions: unknown[] }>;
  parseAiImageCommand: (
    workspaceId: string,
    projectId: string | null,
    imageBlob: Blob,
  ) => Promise<unknown[]>;
  getCopilotAlerts: (workspaceId: string) => Promise<unknown[]>;
  getCopilotBriefing: (
    workspaceId: string,
  ) => Promise<{ briefing: string; source: 'ai' | 'rules' }>;
  // Intégrations & Synchronisation Réelle
  listIntegrations: (workspaceId: string) => Promise<unknown[]>;
  createIntegration: (
    workspaceId: string,
    type: 'SLACK' | 'TEAMS' | 'GOOGLE_CALENDAR' | 'OUTLOOK',
    name: string,
    url?: string,
    calendarId?: string,
  ) => Promise<unknown>;
  toggleIntegration: (integrationId: string) => Promise<unknown>;
  deleteIntegration: (integrationId: string) => Promise<unknown>;
  exportToCalendar: (workspaceId: string, integrationId: string) => Promise<unknown>;
  getCalendarConflicts: (workspaceId: string) => Promise<unknown[]>;
  // Agile
  createSprint: (
    name: string,
    startDate: string,
    endDate: string,
    workspaceId: string,
  ) => Promise<void>;
  updateSprintStatus: (
    sprintId: string,
    status: 'PLANNED' | 'ACTIVE' | 'COMPLETED',
  ) => Promise<void>;
  associateTasksToSprint: (sprintId: string | null, taskIds: string[]) => Promise<void>;
  getBurndownData: (sprintId: string) => Promise<unknown>;
  getVelocityData: (workspaceId: string) => Promise<number>;
  getWorkspaceRole: (workspaceId: string) => WorkspaceMember['role'] | null;
  isReadOnlyForWorkspace: (workspaceId: string) => boolean;
  currentUserRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | null;
  isReadOnly: boolean;
  // Permissions et Audit Projet
  getProjectMembers: (projectId: string) => Promise<ProjectMember[]>;
  assignProjectRole: (projectId: string, targetUserId: string, role: ProjectRole) => Promise<void>;
  removeProjectRole: (projectId: string, targetUserId: string) => Promise<void>;
  getProjectAuditLogs: (projectId: string, limit?: number) => Promise<ProjectAuditLog[]>;
}
const AppContext = createContext<AppContextType | undefined>(undefined);

const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiError, setApiError] = useState<string | null>(null);
  const [user, setUser] = useState<AppContextType['user']>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [workspaceRoles, setWorkspaceRoles] = useState<Record<string, WorkspaceMember['role']>>({});
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [resourceCapacity, setResourceCapacity] = useState<ResourceCapacityReportItem[]>([]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [activeTimer, setActiveTimer] = useState<AppContextType['activeTimer']>(null);
  const [activeTab, setActiveTab] = useState<
    | 'dashboard'
    | 'kanban'
    | 'calendar'
    | 'notes'
    | 'pomodoro'
    | 'governance'
    | 'resources'
    | 'agile'
    | 'gantt'
    | 'finances'
    | 'admin'
  >('dashboard');
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (workspaces.length === 0) {
      if (activeWorkspaceId) setActiveWorkspaceId('');
      return;
    }
    if (!workspaces.some((workspace) => workspace.id === activeWorkspaceId)) {
      setActiveWorkspaceId(workspaces[0].id);
    }
  }, [activeWorkspaceId, workspaces]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  // Pomodoro States
  const [pomodoroState, setPomodoroState] = useState<'idle' | 'focus' | 'break'>('idle');
  const [pomodoroTaskId, setPomodoroTaskId] = useState<string | null>(null);
  const [pomodoroSettings, setPomodoroSettings] = useState({ focusDuration: 25, breakDuration: 5 });
  const [pomodoroTimeLeft, setPomodoroTimeLeft] = useState<number>(25 * 60);
  const [isPomodoroRunning, setIsPomodoroRunning] = useState(false);

  // Thème State
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('planner_theme') as 'dark' | 'light') || 'dark',
  );

  // Charger le profil de la session au démarrage. Le jeton n'est plus stocké côté navigateur (S7) :
  // la session vit dans des cookies httpOnly. Un ancien profil qui contiendrait encore un jeton
  // (version précédente) est purgé de localStorage.
  useEffect(() => {
    const savedUser = localStorage.getItem('planner_user');
    if (savedUser) {
      const { token: legacyToken, ...profile } = JSON.parse(savedUser) as Record<string, unknown>;
      if (legacyToken !== undefined) {
        localStorage.setItem('planner_user', JSON.stringify(profile));
      }
      setUser(profile as unknown as NonNullable<AppContextType['user']>);
    }
  }, []);

  // Headers HTTP : l'authentification passe par les cookies de session (credentials: 'include')
  const getHeaders = useCallback(() => {
    return {
      'Content-Type': 'application/json',
    };
  }, []);

  const logout = useCallback(() => {
    // Déconnexion serveur : révoque la session et efface les cookies httpOnly (S7)
    void fetch(`${BACKEND_URL}/auth/logout`, { method: 'POST' }).catch(() => undefined);
    void import('../firebase-auth')
      .then(({ signOutFirebase }) => signOutFirebase())
      .catch((error: unknown) => {
        setApiError(error instanceof Error ? error.message : 'Échec de la déconnexion Firebase.');
      });
    setUser(null);
    localStorage.removeItem('planner_user');
    setProjects([]);
    setNotes([]);
    setWorkspaces([]);
    setActiveWorkspaceId('');
    setWorkspaceRoles({});
    setWorkspaceMembers([]);
    setTimeBlocks([]);
    setActiveTimer(null);
    if (socket) socket.disconnect();
  }, [socket]);

  // Session perdue (rotation impossible, révocation, suspension) : retour à l'écran de connexion
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, logout);
  }, [logout]);

  const reportApiError = async (res: Response, action: string): Promise<never> => {
    if (res.status === 401) {
      console.warn(`Session expirée (401) lors de l'action : ${action}`);
      logout();
    }
    const responseBody = await res.text();
    let detail = responseBody;
    try {
      const parsed: unknown = JSON.parse(responseBody);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'message' in parsed &&
        (typeof parsed.message === 'string' ||
          (Array.isArray(parsed.message) &&
            parsed.message.every((item) => typeof item === 'string')))
      ) {
        detail = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
      }
    } catch {
      detail = responseBody;
    }
    const message = detail || `${action} (HTTP ${res.status})`;
    setApiError(message);
    throw new Error(message);
  };

  // Gérer la connexion WebSocket et tester l'API Backend
  useEffect(() => {
    let activeSocket: Socket | null = null;

    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      setIsConnected(false);
      return;
    }

    const initConnection = async () => {
      try {
        const testRes = await fetch(`${BACKEND_URL}/projects`, {
          headers: getHeaders(),
        });

        if (testRes.ok) {
          setIsConnected(true);

          // Initialisation du WebSocket
          // Authentification par le cookie httpOnly au handshake (S7)
          const newSocket = io(BACKEND_URL, { withCredentials: true });
          activeSocket = newSocket;
          setSocket(newSocket);

          const handleConnect = () => {
            console.log('Connecté au WebSocket backend');
          };
          const handleActiveTimerState = (
            state: { id: string; startTime: string; taskId: string; task?: Task } | null,
          ) => {
            setActiveTimer(state);
          };
          const handleTimerStarted = (log: {
            id: string;
            startTime: string;
            taskId: string;
            task?: Task;
          }) => {
            setActiveTimer({
              id: log.id,
              startTime: log.startTime,
              taskId: log.taskId,
              task: log.task,
            });
          };
          const handleTimerStopped = () => {
            setActiveTimer(null);
          };
          const patchTaskLocal = (task: Task) => {
            setProjects((prevProjects) =>
              prevProjects.map((p) => {
                if (p.id !== task.projectId) return p;
                const tasks = p.tasks || [];
                const exist = tasks.some((t) => t.id === task.id);
                const updatedTasks = exist
                  ? tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t))
                  : [...tasks, task];
                return { ...p, tasks: updatedTasks };
              }),
            );
          };

          const patchMultipleTasksLocal = (projectId: string, tasksToPatch: Task[]) => {
            setProjects((prevProjects) =>
              prevProjects.map((p) => {
                if (p.id !== projectId) return p;
                const tasks = p.tasks || [];
                const updatedTasks = tasks.map((t) => {
                  const patch = tasksToPatch.find((pt) => pt.id === t.id);
                  return patch ? { ...t, ...patch } : t;
                });
                return { ...p, tasks: updatedTasks };
              }),
            );
          };

          const handleTaskStatusChanged = (data: { taskId: string; task?: Task }) => {
            if (data.task) {
              patchTaskLocal(data.task);
            } else {
              refreshData();
            }
          };
          const handleTaskSchedulePropagated = (data: {
            projectId: string;
            impactedTaskIds?: string[];
            impactedTasks?: Task[];
          }) => {
            if (data.impactedTasks && data.projectId) {
              patchMultipleTasksLocal(data.projectId, data.impactedTasks);
            } else {
              refreshData();
            }
            sendBrowserNotification('Auto-Scheduling Activé', {
              body: `${data.impactedTaskIds?.length || 'Plusieurs'} tâche(s) ont été décalées par effet domino suite à un changement d'échéance.`,
            });
          };
          const handleProjectDataUpdated = () => {
            refreshData();
          };
          const handleMentionNotification = (data: { message?: string }) => {
            sendBrowserNotification('Nouvelle Mention !', {
              body: data.message || 'Vous avez été mentionné dans un commentaire.',
            });
            try {
              const audio = new Audio(
                'https://assets.mixkit.co/active_storage/sfx/2869/2869-500.wav',
              );
              audio.volume = 0.5;
              audio.play();
            } catch (e) {
              console.log('Impossible de jouer la notification sonore', e);
            }
          };

          // Cookie d'accès expiré pendant l'absence : on renouvelle la session puis on se reconnecte
          let reconnectAttempts = 0;
          newSocket.on('connect', () => {
            reconnectAttempts = 0;
          });
          newSocket.on('connect_error', () => {
            if (reconnectAttempts >= 3) return;
            reconnectAttempts += 1;
            void refreshSession().then((renewed) => {
              if (renewed) newSocket.connect();
            });
          });
          newSocket.on('connect', handleConnect);
          newSocket.on('active-timer-state', handleActiveTimerState);
          newSocket.on('timer-started', handleTimerStarted);
          newSocket.on('timer-stopped', handleTimerStopped);
          newSocket.on('task-status-changed', handleTaskStatusChanged);
          newSocket.on('task-schedule-propagated', handleTaskSchedulePropagated);
          newSocket.on('project-data-updated', handleProjectDataUpdated);
          newSocket.on('mention-notification', handleMentionNotification);
        } else if (testRes.status === 401) {
          console.warn('Session expirée ou invalide. Veuillez vous reconnecter.');
          localStorage.removeItem('planner_user');
          setUser(null);
          setIsConnected(false);
        } else {
          setIsConnected(false);
        }
      } catch (err) {
        console.warn('Le serveur backend est injoignable.', err);
        setIsConnected(false);
      }
    };

    initConnection();

    return () => {
      if (activeSocket) {
        activeSocket.off('connect');
        activeSocket.off('active-timer-state');
        activeSocket.off('timer-started');
        activeSocket.off('timer-stopped');
        activeSocket.off('task-status-changed');
        activeSocket.off('task-schedule-propagated');
        activeSocket.off('project-data-updated');
        activeSocket.off('mention-notification');
        activeSocket.disconnect();
      }
    };
  }, [user]);

  // Charger les données réelles depuis le backend
  const refreshData = useCallback(() => {
    if (!user || !isConnected) return;

    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = setTimeout(async () => {
      try {
        const [projRes, noteRes, membersRes, tbRes, activeRes, workspacesRes, capacityRes] =
          await Promise.all([
            fetch(`${BACKEND_URL}/projects`, { headers: getHeaders() }),
            fetch(`${BACKEND_URL}/notes`, { headers: getHeaders() }),
            fetch(`${BACKEND_URL}/projects/members`, { headers: getHeaders() }),
            fetch(`${BACKEND_URL}/projects/timeblocks/all`, { headers: getHeaders() }),
            fetch(`${BACKEND_URL}/tracking/active`, { headers: getHeaders() }),
            fetch(`${BACKEND_URL}/projects/workspaces`, { headers: getHeaders() }),
            fetch(`${BACKEND_URL}/projects/resources/capacity`, { headers: getHeaders() }),
          ]);

        const anyUnauthorized = [
          projRes,
          noteRes,
          membersRes,
          tbRes,
          activeRes,
          workspacesRes,
          capacityRes,
        ].some((res) => res.status === 401);

        if (anyUnauthorized) {
          console.warn('Session expirée ou révoquée détectée par le serveur.');
          logout();
          return;
        }

        if (projRes.ok) setProjects(await projRes.json());
        if (noteRes.ok) setNotes(await noteRes.json());
        if (membersRes.ok) setWorkspaceMembers(await membersRes.json());
        if (tbRes.ok) setTimeBlocks(await tbRes.json());
        if (workspacesRes.ok) {
          const workspaceData: Workspace[] = await workspacesRes.json();
          setWorkspaces(workspaceData);
          setWorkspaceRoles(
            Object.fromEntries(
              workspaceData.flatMap((workspace) => {
                const membership = workspace.memberships?.find((item) => item.user.id === user.id);
                return membership ? [[workspace.id, membership.role]] : [];
              }),
            ),
          );
        }
        if (capacityRes.ok) setResourceCapacity(await capacityRes.json());
        if (activeRes.ok) {
          const text = await activeRes.text();
          const act = text ? JSON.parse(text) : null;
          setActiveTimer(act);
        }
      } catch (e) {
        console.error('Erreur lors du chargement des données depuis le backend :', e);
      }
    }, 200);
  }, [user, isConnected, getHeaders, logout]);

  useEffect(() => {
    refreshData();
  }, [user, isConnected]);

  // Réponse d'une connexion : ticket MFA ou profil (la session est dans les cookies httpOnly)
  const applyLoginResponse = (data: {
    mfaRequired?: boolean;
    mfaTicket?: string;
    user: {
      id: string;
      name: string;
      email: string;
      platformRole?: 'SUPER_ADMIN' | 'PLATFORM_ADMIN' | null;
    };
  }): MfaChallenge | void => {
    if (data.mfaRequired && data.mfaTicket) {
      return { mfaRequired: true, mfaTicket: data.mfaTicket };
    }
    const userData = {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      platformRole: data.user.platformRole ?? null,
    };
    setUser(userData);
    localStorage.setItem('planner_user', JSON.stringify(userData));
  };

  // SSO & Auth
  const login = async (code: string, state?: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/github/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
      });
      if (!res.ok) throw new Error('Échec OAuth');
      const data = await res.json();
      return applyLoginResponse(data);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const mockLogin = async (name: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/mock/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'Gaëtan' }),
      });
      if (!res.ok) throw new Error('Échec simulation login');
      const data = await res.json();
      applyLoginResponse(data);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const classicLogin = async (email: string, passwordRaw: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, passwordRaw }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Identifiants invalides');
      }
      const data = await res.json();

      return applyLoginResponse(data);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const verifyMfa = async (mfaTicket: string, factor: { code?: string; recoveryCode?: string }) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/mfa/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaTicket, ...factor }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Code d’authentification TOTP invalide');
      }
      const data = await res.json();
      applyLoginResponse(data);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const discoverSso = async (email: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/sso/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        return { ssoAvailable: false };
      }
      return await res.json();
    } catch {
      return { ssoAvailable: false };
    }
  };

  const ssoLogin = async (code: string, domain: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/sso/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, domain }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Échec de l’authentification SSO');
      }
      const data = await res.json();
      return applyLoginResponse(data);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const classicRegister = async (email: string, passwordRaw: string, name: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, passwordRaw, name }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Échec de l'inscription");
      }
      // 202 générique : aucune session avant la vérification de l'adresse e-mail (P6, S27)
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      return data.message ?? "Un e-mail de confirmation vient d'être envoyé.";
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const firebaseLogin = async (idToken: string, name?: string) => {
    const res = await fetch(`${BACKEND_URL}/auth/firebase/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, name }),
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.message || 'Connexion Firebase refusée.');
    }
    const data = await res.json();
    return applyLoginResponse(data);
  };

  // CRUD Projets
  const createProject = async (
    name: string,
    description?: string,
    workspaceId?: string,
    status?: string,
    startDate?: string,
    dueDate?: string,
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, description, workspaceId, status, startDate, dueDate }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de créer le projet.');
    refreshData();
  };

  const deleteProject = async (projectId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de supprimer le projet.');
    refreshData();
  };

  // CRUD Tâches
  const createTask = async (
    projectId: string,
    title: string,
    description?: string,
    priority: string = 'MEDIUM',
    options: CreateTaskOptions = {},
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ title, description, priority, ...options }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de créer la tâche.');
    const task = await res.json();
    refreshData();
    return task;
  };

  const updateTask = async (taskId: string, data: Partial<Task>) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de modifier la tâche.');
    refreshData();
  };

  const deleteTask = async (taskId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de supprimer la tâche.');
    refreshData();
  };

  const getProjectCriticalPath = async (
    projectId: string,
  ): Promise<{ criticalTaskIds: string[]; slacks: Record<string, number> } | null> => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/critical-path`, {
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de charger le chemin critique.');
    return res.json();
  };

  // WebSocket Time Tracking
  const startTimer = (taskId: string) => {
    if (socket) {
      socket.emit('start-timer', { taskId });
    }
  };

  const stopTimer = () => {
    if (socket) {
      socket.emit('stop-timer');
    }
  };

  // CRUD Notes
  const saveNote = async (title: string, content: string, noteId?: string) => {
    const url = noteId ? `${BACKEND_URL}/notes/${noteId}` : `${BACKEND_URL}/notes`;
    const method = noteId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: getHeaders(),
      body: JSON.stringify({ title, content }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible d’enregistrer la note.');
    refreshData();
  };

  const deleteNote = async (noteId: string) => {
    const res = await fetch(`${BACKEND_URL}/notes/${noteId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de supprimer la note.');
    refreshData();
  };

  // CRUD Calendrier (TimeBlocks)
  const createTimeBlock = async (
    taskId: string,
    startTime: string,
    endTime: string,
  ): Promise<boolean> => {
    let res: Response;
    try {
      res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/timeblocks`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ startTime, endTime }),
      });
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      setApiError(`Impossible de planifier le bloc horaire.${detail}`);
      return false;
    }

    if (!res.ok) {
      try {
        await reportApiError(res, 'Impossible de planifier le bloc horaire.');
      } catch {
        return false;
      }
    }

    refreshData();
    return true;
  };

  const updateTimeBlock = async (timeBlockId: string, startTime: string, endTime: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/timeblocks/${timeBlockId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ startTime, endTime }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de modifier le bloc horaire.');
    refreshData();
  };

  const deleteTimeBlock = async (timeBlockId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/timeblocks/${timeBlockId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de supprimer le bloc horaire.');
    refreshData();
  };

  // Professional features
  const createMilestone = async (
    projectId: string,
    name: string,
    description?: string,
    dueDate?: string,
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/milestones`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, description, dueDate }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de créer le jalon.');
    refreshData();
  };

  const completeMilestone = async (milestoneId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/milestones/${milestoneId}/complete`, {
      method: 'PUT',
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de terminer le jalon.');
    refreshData();
  };

  const createDeliverable = async (
    projectId: string,
    title: string,
    description?: string,
    status?: string,
    dueDate?: string,
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/deliverables`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ title, description, status, dueDate }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de créer le livrable.');
    refreshData();
  };

  const updateDeliverableStatus = async (deliverableId: string, status: string) => {
    const res = await fetch(
      `${BACKEND_URL}/projects/deliverables/${deliverableId}/status/${status}`,
      {
        method: 'PUT',
        headers: getHeaders(),
      },
    );
    if (!res.ok) await reportApiError(res, 'Impossible de modifier le statut du livrable.');
    refreshData();
  };

  const createDelivery = async (projectId: string, summary?: string, checklist?: string[]) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/deliveries`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ summary, checklist }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de créer la livraison.');
    refreshData();
  };

  const updateDeliveryStatus = async (deliveryId: string, status: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/deliveries/${deliveryId}/status`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de modifier le statut de la livraison.');
    refreshData();
  };

  const toggleDeliveryChecklistItem = async (itemId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/deliveries/items/${itemId}/toggle`, {
      method: 'PUT',
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de modifier la checklist de livraison.');
    refreshData();
  };

  const addTaskDependency = async (
    taskId: string,
    dependsOnTaskId: string,
    type: string = 'FINISH_TO_START',
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/dependencies`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ dependsOnTaskId, type }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de créer la dépendance.');
    refreshData();
  };

  const removeTaskDependency = async (taskId: string, dependsOnTaskId: string) => {
    const res = await fetch(
      `${BACKEND_URL}/projects/tasks/${taskId}/dependencies/${dependsOnTaskId}`,
      {
        method: 'DELETE',
        headers: getHeaders(),
      },
    );
    if (!res.ok) await reportApiError(res, 'Impossible de supprimer la dépendance.');
    refreshData();
  };

  const updateResourceProfile = async (
    userId: string,
    weeklyCapacityMinutes?: number,
    skills?: string,
    costRateCents?: number,
    workspaceId?: string,
  ) => {
    const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
    const res = await fetch(`${BACKEND_URL}/projects/resources/${userId}/profile${query}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ weeklyCapacityMinutes, skills, costRateCents }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de modifier le profil de ressource.');
    refreshData();
  };

  const getResourceCapacityReport = async (workspaceId: string) => {
    const res = await fetch(
      `${BACKEND_URL}/projects/resources/capacity?workspaceId=${encodeURIComponent(workspaceId)}`,
      { headers: getHeaders() },
    );
    if (!res.ok) await reportApiError(res, 'Impossible de charger la capacité du workspace.');
    return res.json();
  };

  const createResourceAllocation = async (
    projectId: string,
    userId: string,
    allocationPercent: number,
    roleLabel?: string,
    startDate?: string,
    endDate?: string,
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/allocations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ userId, allocationPercent, roleLabel, startDate, endDate }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de créer l’affectation.');
    refreshData();
  };

  // Agile
  const createSprint = async (
    name: string,
    startDate: string,
    endDate: string,
    workspaceId: string,
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/sprints`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, startDate, endDate }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de créer le sprint.');
    refreshData();
  };

  const updateSprintStatus = async (
    sprintId: string,
    status: 'PLANNED' | 'ACTIVE' | 'COMPLETED',
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/sprints/${sprintId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de modifier le sprint.');
    refreshData();
  };

  const associateTasksToSprint = async (sprintId: string | null, taskIds: string[]) => {
    const sId = sprintId === null ? 'backlog' : sprintId;
    const res = await fetch(`${BACKEND_URL}/projects/sprints/${sId}/tasks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ taskIds }),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de déplacer les tâches du sprint.');
    refreshData();
  };

  const getBurndownData = async (sprintId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/sprints/${sprintId}/burndown`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de charger le burndown.');
    return res.json();
  };

  const getVelocityData = async (workspaceId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/velocity`, {
      method: 'GET',
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de charger la vélocité.');
    const data: unknown = await res.json();
    if (typeof data === 'number') return data;
    if (
      typeof data === 'object' &&
      data !== null &&
      'velocity' in data &&
      typeof data.velocity === 'number'
    ) {
      return data.velocity;
    }
    const message = 'La réponse du serveur ne contient pas une vélocité valide.';
    setApiError(message);
    throw new Error(message);
  };

  const createInvitation = async (
    workspaceId: string,
    email: string | null,
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER',
    projectId?: string,
    durationDays?: number,
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/invitations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email, role, projectId, durationDays }),
    });
    if (!res.ok) await reportApiError(res, "Impossible de créer l'invitation.");
    return res.json();
  };

  const listInvitations = async (workspaceId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/invitations`, {
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de charger les invitations.');
    return res.json();
  };

  const getWorkspaceMembers = async (workspaceId: string) => {
    const res = await fetch(
      `${BACKEND_URL}/projects/workspaces/${encodeURIComponent(workspaceId)}/members`,
      { headers: getHeaders() },
    );
    if (!res.ok) await reportApiError(res, 'Impossible de charger les membres du workspace.');
    return res.json();
  };

  const getProjectMembers = async (projectId: string): Promise<ProjectMember[]> => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/members`, {
      headers: getHeaders(),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || 'Impossible de récupérer les membres du projet.');
    }
    return res.json();
  };

  const assignProjectRole = async (
    projectId: string,
    targetUserId: string,
    role: ProjectRole,
  ): Promise<void> => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/members`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ targetUserId, role }),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || "Impossible d'assigner le rôle sur le projet.");
    }
  };

  const removeProjectRole = async (projectId: string, targetUserId: string): Promise<void> => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/members/${targetUserId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || 'Impossible de retirer le membre du projet.');
    }
  };

  const getProjectAuditLogs = async (projectId: string, limit = 50): Promise<ProjectAuditLog[]> => {
    const res = await fetch(`${BACKEND_URL}/projects/${projectId}/audit/logs?limit=${limit}`, {
      headers: getHeaders(),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || "Impossible de charger le journal d'audit du projet.");
    }
    return res.json();
  };

  const revokeInvitation = async (invitationId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/invitations/${invitationId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, "Impossible de révoquer l'invitation.");
    refreshData();
  };

  const checkInvitation = async (token: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/invitations/check/${token}`);
    if (!res.ok) {
      throw new Error((await res.text()) || "Lien d'invitation invalide ou expiré.");
    }
    return res.json();
  };

  const acceptInvitation = async (token: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/invitations/accept/${token}`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || "Impossible d'accepter l'invitation.");
    }
    const data = await res.json();
    refreshData();
    return data;
  };

  const addComment = async (
    taskId: string,
    content: string,
    parentId?: string,
    attachments?: unknown[],
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ content, parentId, attachments }),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || "Impossible d'ajouter le commentaire.");
    }
    return res.json();
  };

  const getComments = async (taskId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/comments`, {
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de charger les commentaires.');
    return res.json();
  };

  const deleteComment = async (commentId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/comments/${commentId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || 'Impossible de supprimer le commentaire.');
    }
  };

  const createTaskAttachment = async (
    taskId: string,
    fileName: string,
    fileUrl: string,
    fileType: string,
    fileSize: number,
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/attachments`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ fileName, fileUrl, fileType, fileSize }),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || "Impossible d'ajouter la pièce jointe.");
    }
    return res.json();
  };

  const getTaskAttachments = async (taskId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/attachments`, {
      headers: getHeaders(),
    });
    if (!res.ok) await reportApiError(res, 'Impossible de charger les pièces jointes.');
    return res.json();
  };

  const deleteTaskAttachment = async (attachmentId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/attachments/${attachmentId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || 'Impossible de supprimer la pièce jointe.');
    }
  };

  const updateComment = async (commentId: string, content: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/comments/${commentId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || 'Impossible de modifier le commentaire.');
    }
    return res.json();
  };

  // Thème logic
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('planner_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Notifications logic
  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      console.log('Permission notification:', permission);
    }
  };

  const sendBrowserNotification = (title: string, options?: NotificationOptions) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, options);
      } catch (e) {
        console.error("Erreur lors de l'envoi de la notification:", e);
      }
    }
  };

  const scheduleReminder = (taskTitle: string, startTimeIso: string) => {
    const targetTime = new Date(startTimeIso).getTime();
    const now = Date.now();
    const reminderTime = targetTime - 5 * 60 * 1000;
    const delay = reminderTime - now;

    if (delay > 0) {
      console.log(`Rappel programmé pour "${taskTitle}" dans ${Math.round(delay / 1000)}s`);
      setTimeout(() => {
        sendBrowserNotification('Time-Blocking imminent !', {
          body: `Votre bloc de temps pour "${taskTitle}" commence dans 5 minutes.`,
        });
      }, delay);
    } else {
      const startDelay = targetTime - now;
      if (startDelay > 0) {
        setTimeout(() => {
          sendBrowserNotification('Time-Blocking commencé !', {
            body: `C'est l'heure de commencer : "${taskTitle}"`,
          });
        }, startDelay);
      }
    }
  };

  const parseAiCommand = async (workspaceId: string, projectId: string | null, command: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/ai/command`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ workspaceId, projectId, command }),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || "Erreur lors du traitement de la commande par l'IA.");
    }
    return res.json();
  };

  const executeAiActions = async (
    workspaceId: string,
    projectId: string | null,
    actions: unknown[],
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/ai/execute`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ workspaceId, projectId, actions }),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || "Erreur lors de l'exécution des actions IA.");
    }
    const data = await res.json();
    refreshData();
    return data;
  };

  const parseAiVoiceCommand = async (
    workspaceId: string,
    projectId: string | null,
    audioBlob: Blob,
  ) => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'voice-command.webm');
    formData.append('workspaceId', workspaceId);
    if (projectId) {
      formData.append('projectId', projectId);
    }

    const res = await fetch(`${BACKEND_URL}/projects/ai/voice`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error(
        (await res.text()) || "Erreur lors de la transcription ou de l'analyse vocale.",
      );
    }
    return res.json();
  };

  const parseAiImageCommand = async (
    workspaceId: string,
    projectId: string | null,
    imageBlob: Blob,
  ) => {
    const formData = new FormData();
    formData.append('file', imageBlob, 'whiteboard.png');
    formData.append('workspaceId', workspaceId);
    if (projectId) {
      formData.append('projectId', projectId);
    }

    const res = await fetch(`${BACKEND_URL}/projects/ai/vision`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error((await res.text()) || "Erreur lors de l'analyse de l'image.");
    }
    return res.json();
  };

  const getCopilotAlerts = async (workspaceId: string) => {
    const res = await fetch(
      `${BACKEND_URL}/projects/ai/copilot/alerts?workspaceId=${workspaceId}`,
      {
        method: 'GET',
        headers: getHeaders(),
      },
    );
    if (!res.ok) {
      throw new Error((await res.text()) || 'Erreur lors de la récupération des alertes.');
    }
    return res.json();
  };

  const getCopilotBriefing = async (workspaceId: string) => {
    const res = await fetch(
      `${BACKEND_URL}/projects/ai/copilot/briefing?workspaceId=${workspaceId}`,
      {
        method: 'GET',
        headers: getHeaders(),
      },
    );
    if (!res.ok) {
      throw new Error((await res.text()) || 'Erreur lors de la génération du briefing.');
    }
    return res.json();
  };

  const listIntegrations = async (workspaceId: string) => {
    const res = await fetch(
      `${BACKEND_URL}/projects/workspaces/${workspaceId}/integrations/status`,
      {
        headers: getHeaders(),
      },
    );
    if (!res.ok) await reportApiError(res, 'Impossible de charger les intégrations.');
    return res.json();
  };

  const createIntegration = async (
    workspaceId: string,
    type: 'SLACK' | 'TEAMS' | 'GOOGLE_CALENDAR' | 'OUTLOOK',
    name: string,
    url?: string,
    calendarId?: string,
  ) => {
    const res = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/integrations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ type, name, url, calendarId }),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || "Erreur lors de la création de l'intégration.");
    }
    return res.json();
  };

  const toggleIntegration = async (integrationId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/integrations/${integrationId}/toggle`, {
      method: 'POST',
      headers: getHeaders(),
    });
    if (!res.ok) {
      throw new Error(
        (await res.text()) || "Erreur lors de l'activation/désactivation de l'intégration.",
      );
    }
    return res.json();
  };

  const deleteIntegration = async (integrationId: string) => {
    const res = await fetch(`${BACKEND_URL}/projects/integrations/${integrationId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) {
      throw new Error((await res.text()) || "Erreur lors de la suppression de l'intégration.");
    }
    return res.json();
  };

  const exportToCalendar = async (workspaceId: string, integrationId: string) => {
    const res = await fetch(
      `${BACKEND_URL}/projects/workspaces/${workspaceId}/integrations/${integrationId}/export`,
      {
        method: 'POST',
        headers: getHeaders(),
      },
    );
    if (!res.ok) {
      throw new Error(
        (await res.text()) || "Erreur lors de l'exportation vers le calendrier externe.",
      );
    }
    return res.json();
  };

  const getCalendarConflicts = async (workspaceId: string) => {
    const res = await fetch(
      `${BACKEND_URL}/projects/workspaces/${workspaceId}/calendar-conflicts`,
      {
        headers: getHeaders(),
      },
    );
    if (!res.ok) await reportApiError(res, 'Impossible de charger les conflits de calendrier.');
    return res.json();
  };

  // Demander la permission de notification au login
  useEffect(() => {
    if (user) {
      requestNotificationPermission();
    }
  }, [user]);

  // Pomodoro logic
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isPomodoroRunning && pomodoroTimeLeft > 0) {
      interval = setInterval(() => {
        setPomodoroTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (isPomodoroRunning && pomodoroTimeLeft === 0) {
      if (pomodoroState === 'focus') {
        stopTimer();
        setPomodoroState('break');
        setPomodoroTimeLeft(pomodoroSettings.breakDuration * 60);
        sendBrowserNotification('Session Focus terminée !', {
          body: 'Il est temps de faire une pause bien méritée.',
        });
      } else if (pomodoroState === 'break') {
        setPomodoroState('focus');
        setPomodoroTimeLeft(pomodoroSettings.focusDuration * 60);
        if (pomodoroTaskId) {
          startTimer(pomodoroTaskId);
        }
        sendBrowserNotification('La pause est terminée !', {
          body: "C'est parti pour une nouvelle session de focus.",
        });
      }
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPomodoroRunning, pomodoroTimeLeft, pomodoroState, pomodoroSettings, pomodoroTaskId]);

  const startPomodoro = (taskId: string) => {
    setPomodoroTaskId(taskId);
    setPomodoroState('focus');
    setPomodoroTimeLeft(pomodoroSettings.focusDuration * 60);
    setIsPomodoroRunning(true);
    startTimer(taskId);
  };

  const pausePomodoro = () => {
    setIsPomodoroRunning(false);
    stopTimer();
  };

  const resumePomodoro = () => {
    if (pomodoroTaskId) {
      setIsPomodoroRunning(true);
      if (pomodoroState === 'focus') {
        startTimer(pomodoroTaskId);
      }
    }
  };

  const resetPomodoro = () => {
    setIsPomodoroRunning(false);
    setPomodoroState('idle');
    setPomodoroTaskId(null);
    setPomodoroTimeLeft(pomodoroSettings.focusDuration * 60);
    stopTimer();
  };

  const skipBreak = () => {
    if (pomodoroState === 'break') {
      setPomodoroState('focus');
      setPomodoroTimeLeft(pomodoroSettings.focusDuration * 60);
      if (pomodoroTaskId) {
        startTimer(pomodoroTaskId);
      }
    }
  };

  const currentUserRole = useMemo(() => {
    const defaultWorkspace = workspaces[0];
    return defaultWorkspace ? (workspaceRoles[defaultWorkspace.id] ?? null) : null;
  }, [workspaces, workspaceRoles]);

  const getWorkspaceRole = useCallback(
    (workspaceId: string) => workspaceRoles[workspaceId] ?? null,
    [workspaceRoles],
  );

  const isReadOnlyForWorkspace = useCallback(
    (workspaceId: string) => getWorkspaceRole(workspaceId) === 'VIEWER',
    [getWorkspaceRole],
  );

  const isReadOnly = useMemo(() => {
    return currentUserRole === 'VIEWER';
  }, [currentUserRole]);

  return (
    <AppContext.Provider
      value={{
        apiError,
        dismissApiError: () => setApiError(null),
        user,
        projects,
        notes,
        workspaces,
        workspaceMembers,
        resourceCapacity,
        timeBlocks,
        activeWorkspaceId,
        setActiveWorkspaceId,
        activeTimer,
        activeTab,
        isConnected,
        login,
        classicLogin,
        verifyMfa,
        discoverSso,
        classicRegister,
        firebaseLogin,
        ssoLogin,
        logout,
        mockLogin,
        setActiveTab,
        createProject,
        deleteProject,
        createTask,
        updateTask,
        deleteTask,
        startTimer,
        stopTimer,
        saveNote,
        deleteNote,
        createTimeBlock,
        updateTimeBlock,
        deleteTimeBlock,
        // Pomodoro
        pomodoroState,
        pomodoroTaskId,
        pomodoroTimeLeft,
        pomodoroSettings,
        isPomodoroRunning,
        setPomodoroSettings,
        startPomodoro,
        pausePomodoro,
        resumePomodoro,
        resetPomodoro,
        skipBreak,
        // Thème
        theme,
        toggleTheme,
        // Notifications
        requestNotificationPermission,
        sendBrowserNotification,
        scheduleReminder,
        // Professional features
        createMilestone,
        completeMilestone,
        createDeliverable,
        updateDeliverableStatus,
        createDelivery,
        updateDeliveryStatus,
        toggleDeliveryChecklistItem,
        addTaskDependency,
        removeTaskDependency,
        getProjectCriticalPath,
        updateResourceProfile,
        getResourceCapacityReport,
        getWorkspaceMembers,
        createResourceAllocation,
        refreshData,
        // Invitations / Collaboration
        createInvitation,
        listInvitations,
        revokeInvitation,
        checkInvitation,
        acceptInvitation,
        // Commentaires & Communication
        socket,
        addComment,
        getComments,
        deleteComment,
        updateComment,
        createTaskAttachment,
        getTaskAttachments,
        deleteTaskAttachment,
        parseAiCommand,
        executeAiActions,
        parseAiVoiceCommand,
        parseAiImageCommand,
        getCopilotAlerts,
        getCopilotBriefing,
        // Intégrations & Calendrier
        listIntegrations,
        createIntegration,
        toggleIntegration,
        deleteIntegration,
        exportToCalendar,
        getCalendarConflicts,
        // Agile
        createSprint,
        updateSprintStatus,
        associateTasksToSprint,
        getBurndownData,
        getVelocityData,
        getWorkspaceRole,
        isReadOnlyForWorkspace,
        // Permissions
        currentUserRole,
        isReadOnly,
        // Permissions et Audit Projet
        getProjectMembers,
        assignProjectRole,
        removeProjectRole,
        getProjectAuditLogs,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (context === undefined) throw new Error('useApp doit être utilisé dans un AppProvider');
  return context;
};
