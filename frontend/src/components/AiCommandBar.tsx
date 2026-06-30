import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  Sparkles,
  Trash2,
  Play,
  Check,
  AlertCircle,
  X,
  Loader2,
  Plus,
  User as UserIcon,
  Link2,
  Clock,
  CheckSquare,
  Mic,
  MicOff,
  Image as ImageIcon,
} from 'lucide-react';
import './AiCommandBar.css';

export interface ResolvedAiAction {
  id: string;
  type:
    'CREATE_TASK' | 'ASSIGN_TASK' | 'CREATE_DEPENDENCY' | 'CREATE_TIMEBLOCK' | 'UPDATE_TASK_STATUS';
  description: string;
  resolved: boolean;
  warning?: string;
  taskTitle?: string;
  priority?: string;
  dueDate?: string;
  estimatedMinutes?: number;
  assigneeName?: string;
  assigneeId?: string;
  dependsOnTaskTitle?: string;
  dependsOnTaskId?: string;
  dependencyType?: string;
  timeBlockStart?: string;
  timeBlockEnd?: string;
  status?: string;
}

export const AiCommandBar: React.FC = () => {
  const {
    workspaces,
    projects,
    parseAiCommand,
    executeAiActions,
    parseAiImageCommand,
    refreshData,
    socket,
    workspaceMembers,
  } = useApp();

  const [isOpen, setIsOpen] = useState(false);
  const [commandText, setCommandText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [actions, setActions] = useState<ResolvedAiAction[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [executionSuccess, setExecutionSuccess] = useState(false);

  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Écouter les retours de la voix en streaming via WebSockets
  useEffect(() => {
    if (socket) {
      const handleVoiceResult = (result: {
        transcription: string;
        actions: ResolvedAiAction[];
      }) => {
        setIsLoading(false);
        setCommandText(result.transcription);
        setActions(result.actions);
        if (result.actions.length === 0) {
          setErrorMessage("Aucune action n'a pu être interprétée dans votre enregistrement.");
        }
      };

      const handleVoiceError = (err: { message?: string }) => {
        setIsLoading(false);
        setErrorMessage(
          err.message || "Une erreur est survenue lors de l'analyse vocale en streaming.",
        );
      };

      socket.on('voice-result', handleVoiceResult);
      socket.on('voice-error', handleVoiceError);

      return () => {
        socket.off('voice-result', handleVoiceResult);
        socket.off('voice-error', handleVoiceError);
      };
    }
  }, [socket]);

  const startRecording = async () => {
    try {
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const options = { mimeType: 'audio/webm' };
      let recorder: MediaRecorder;

      try {
        recorder = new MediaRecorder(stream, options);
      } catch {
        recorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = recorder;

      // Signaler le début du stream voix au serveur
      if (socket) {
        socket.emit('voice-start');
      }

      // Émettre les morceaux d'audio au serveur en temps réel toutes les 250ms
      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && socket) {
          const arrayBuffer = await event.data.arrayBuffer();
          socket.emit('voice-chunk', arrayBuffer);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        if (socket) {
          setIsLoading(true);
          const workspaceId = workspaces[0]?.id || '';
          const projectId = projects[0]?.id || null;

          socket.emit('voice-end', {
            workspaceId,
            projectId,
            mimeType: recorder.mimeType,
            isMock: true, // Bypass / Mock pour les tests
          });
        }
      };

      recorder.start(250); // Déclencher ondataavailable toutes les 250ms
      setIsRecording(true);
    } catch (err: unknown) {
      console.error('Erreur microphone:', err);
      setErrorMessage("Impossible d'accéder au microphone. Veuillez vérifier vos permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleImageChange = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Le fichier sélectionné doit être une image.');
      return;
    }
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    setErrorMessage(null);
  };

  const handleClearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleImageChange(e.dataTransfer.files[0]);
    }
  };

  // Lancer l'analyse NLP ou Vision par Gemini
  const handleAnalyze = async () => {
    if (!commandText.trim() && !selectedImage) return;

    setIsLoading(true);
    setErrorMessage(null);
    setActions([]);
    setExecutionSuccess(false);

    try {
      const workspaceId = workspaces[0]?.id || '';
      const projectId = projects[0]?.id || null;

      if (!workspaceId) {
        throw new Error(
          "Aucun espace de travail (workspace) trouvé. Veuillez d'abord créer un espace.",
        );
      }

      let resolved: ResolvedAiAction[] = [];
      if (selectedImage) {
        resolved = (await parseAiImageCommand(
          workspaceId,
          projectId,
          selectedImage,
        )) as ResolvedAiAction[];
      } else {
        resolved = (await parseAiCommand(
          workspaceId,
          projectId,
          commandText.trim(),
        )) as ResolvedAiAction[];
      }

      setActions(resolved);

      if (resolved.length === 0) {
        setErrorMessage("Aucune action n'a pu être interprétée. Essayez d'être plus spécifique.");
      }
    } catch (err: unknown) {
      console.error(err);
      setErrorMessage((err as Error).message || "Une erreur est survenue lors de l'analyse.");
    } finally {
      setIsLoading(false);
    }
  };

  // Mettre à jour une action spécifique localement
  const handleUpdateActionField = (actionId: string, field: string, value: string) => {
    setActions((prev) =>
      prev.map((act) => {
        if (act.id !== actionId) return act;

        const updated = { ...act, [field]: value };

        // Mettre à jour la description de manière lisible
        if (field === 'taskTitle') {
          updated.description = `Créer la tâche "${value}"`;
        } else if (field === 'assigneeId') {
          const member = workspaceMembers.find((m) => m.user.id === value);
          updated.assigneeName = member ? member.user.name || member.user.email : undefined;
          updated.resolved = true; // Si l'id est valide, l'action devient résolue
        }

        return updated;
      }),
    );
  };

  // Supprimer une action de la liste de validation
  const handleDeleteAction = (actionId: string) => {
    setActions((prev) => prev.filter((a) => a.id !== actionId));
  };

  // Exécuter la liste des actions
  const handleExecute = async () => {
    if (actions.length === 0) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const workspaceId = workspaces[0]?.id || '';
      const projectId = projects[0]?.id || null;

      const result = await executeAiActions(workspaceId, projectId, actions);

      if (result.success) {
        setExecutionSuccess(true);
        setActions([]);
        setCommandText('');
        await refreshData();

        setTimeout(() => {
          setIsOpen(false);
        }, 1500);
      } else {
        throw new Error("L'exécution n'a pas renvoyé un résultat positif.");
      }
    } catch (err: unknown) {
      console.error(err);
      setErrorMessage((err as Error).message || "Une erreur est survenue lors de l'exécution.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyExample = (text: string) => {
    setCommandText(text);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      setIsOpen(false);
    }
  };

  if (!isOpen) return null;

  // Helper pour afficher une icône selon le type d'action
  const getActionIcon = (type: string) => {
    switch (type) {
      case 'CREATE_TASK':
        return <Plus className="action-icon text-emerald" size={16} />;
      case 'ASSIGN_TASK':
        return <UserIcon className="action-icon text-blue" size={16} />;
      case 'CREATE_DEPENDENCY':
        return <Link2 className="action-icon text-purple" size={16} />;
      case 'CREATE_TIMEBLOCK':
        return <Clock className="action-icon text-orange" size={16} />;
      case 'UPDATE_TASK_STATUS':
        return <CheckSquare className="action-icon text-pink" size={16} />;
      default:
        return <Sparkles className="action-icon text-violet" size={16} />;
    }
  };

  // Helper pour formater le type d'action en français
  const formatActionType = (type: string) => {
    switch (type) {
      case 'CREATE_TASK':
        return 'Créer tâche';
      case 'ASSIGN_TASK':
        return 'Assigner tâche';
      case 'CREATE_DEPENDENCY':
        return 'Créer dépendance';
      case 'CREATE_TIMEBLOCK':
        return 'Planifier créneau';
      case 'UPDATE_TASK_STATUS':
        return 'Mettre à jour statut';
      default:
        return type;
    }
  };

  const examples = [
    {
      label: 'Créer tâche Secu pour Alice',
      cmd: 'MOCK: créer tâche Configurer sécurité globale pour Alice',
    },
    { label: 'Assigner Alice sur sécurité', cmd: 'MOCK: assigner Alice sur Secu' },
    { label: 'Planifier bloc sécurité', cmd: 'MOCK: planifier Configurer la sécurité globale' },
  ];

  const hasWarnings = actions.some((a) => !a.resolved);
  const canExecute = actions.length > 0 && !isLoading && !executionSuccess;

  return (
    <div
      className="ai-command-bar-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div
        className="glass-panel ai-command-bar-modal"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* Header de la Command Bar */}
        <div className="ai-command-bar-header">
          <div className="ai-title-wrapper">
            <div className="ai-sparkle-glow">
              <Sparkles className="ai-sparkles-icon animated-sparkle" size={20} />
            </div>
            <div>
              <h2 className="ai-bar-title">Assistant Productivité IA</h2>
              <p className="ai-bar-subtitle">Pilotez vos projets en langage naturel ou par image</p>
            </div>
          </div>
          <button className="ai-close-btn" onClick={() => setIsOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* Formulaire de commande ou Onde Sonore de Capture */}
        <div className="ai-input-wrapper">
          {imagePreview && (
            <div
              className={`ai-image-preview-thumbnail glass-panel ${isLoading ? 'scanning' : ''}`}
            >
              <img src={imagePreview} alt="Aperçu du tableau blanc" className="ai-preview-img" />
              {isLoading && <div className="laser-scanner"></div>}
              <button
                className="ai-remove-image-btn"
                onClick={handleClearImage}
                disabled={isLoading}
                title="Supprimer l'image"
              >
                <X size={10} />
              </button>
            </div>
          )}

          {isRecording ? (
            <div className="ai-voice-recording-container">
              <div className="waveform">
                <span className="bar"></span>
                <span className="bar"></span>
                <span className="bar"></span>
                <span className="bar"></span>
                <span className="bar"></span>
                <span className="bar"></span>
                <span className="bar"></span>
                <span className="bar"></span>
              </div>
              <span className="recording-status-text">Écoute en temps réel...</span>
            </div>
          ) : (
            <input
              ref={inputRef}
              type="text"
              className="ai-command-input"
              placeholder={
                selectedImage
                  ? 'Ajouter des instructions textuelles (optionnel)...'
                  : "Ex: créer une tâche 'Design review' pour Alice, ou déposez une image..."
              }
              value={commandText}
              onChange={(e) => setCommandText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isLoading) {
                  handleAnalyze();
                }
              }}
              disabled={isLoading || executionSuccess}
            />
          )}

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept="image/*"
            onChange={(e) =>
              e.target.files && e.target.files[0] && handleImageChange(e.target.files[0])
            }
            disabled={isLoading || executionSuccess}
          />

          {!isRecording && (
            <button
              className={`ai-image-import-btn ${selectedImage ? 'active' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || executionSuccess}
              title="Importer une image de projet (tableau blanc, schéma)"
            >
              <ImageIcon size={16} />
            </button>
          )}

          <button
            className={`ai-voice-btn ${isRecording ? 'recording' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isLoading || executionSuccess || !!selectedImage}
            title={
              isRecording
                ? "Arrêter l'enregistrement"
                : "Démarrer l'enregistrement vocal en streaming"
            }
          >
            {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          {!isRecording && (
            <button
              className={`ai-analyze-btn ${(commandText.trim() || selectedImage) && !isLoading && !executionSuccess ? 'active' : ''}`}
              onClick={handleAnalyze}
              disabled={(!commandText.trim() && !selectedImage) || isLoading || executionSuccess}
            >
              {isLoading ? (
                <Loader2 className="spinner-icon" size={16} />
              ) : (
                <>
                  <span>Analyser</span>
                  <Play size={12} style={{ marginLeft: '4px' }} />
                </>
              )}
            </button>
          )}
        </div>

        {/* Zone de contenu dynamique */}
        <div className="ai-content-area">
          {/* Écran de chargement */}
          {isLoading && actions.length === 0 && (
            <div className="ai-loading-screen">
              <div className="glowing-spinner">
                <Loader2 className="spinner-icon large" size={32} />
              </div>
              <p className="ai-loading-text">Gemini analyse votre commande en temps réel...</p>
            </div>
          )}

          {/* Message d'erreur */}
          {errorMessage && (
            <div className="ai-error-message">
              <AlertCircle size={18} className="error-icon" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Succès d'exécution */}
          {executionSuccess && (
            <div className="ai-success-message">
              <div className="success-icon-wrapper">
                <Check size={28} className="success-icon" />
              </div>
              <h3>Automatisation exécutée !</h3>
              <p>Toutes les actions ont été enregistrées en base de données.</p>
            </div>
          )}

          {/* Liste des actions résolues avec édition interactive */}
          {actions.length > 0 && !executionSuccess && (
            <div className="ai-actions-preview">
              <div className="preview-header">
                <h3>Actions détectées ({actions.length})</h3>
                <span className="preview-badge">À valider</span>
              </div>
              <p className="preview-intro">
                Revoyez et affinez les détails des actions ci-dessous :
              </p>

              <div className="actions-list">
                {actions.map((action) => (
                  <div
                    key={action.id}
                    className={`action-card ${!action.resolved ? 'has-warning' : ''}`}
                  >
                    <div className="action-card-left">
                      <div className="action-type-badge">
                        {getActionIcon(action.type)}
                        <span>{formatActionType(action.type)}</span>
                      </div>

                      <div className="action-card-details">
                        {/* Rendu interactif d'édition des champs */}
                        {action.type === 'CREATE_TASK' ? (
                          <div className="action-interactive-form">
                            <input
                              type="text"
                              className="action-editable-input task-title-edit"
                              value={action.taskTitle || ''}
                              onChange={(e) =>
                                handleUpdateActionField(action.id, 'taskTitle', e.target.value)
                              }
                              placeholder="Titre de la tâche"
                            />
                            <div className="action-form-row">
                              <select
                                className="action-editable-select"
                                value={action.assigneeId || ''}
                                onChange={(e) =>
                                  handleUpdateActionField(action.id, 'assigneeId', e.target.value)
                                }
                              >
                                <option value="">Assigner à...</option>
                                {workspaceMembers.map((m) => (
                                  <option key={m.id} value={m.user.id}>
                                    {m.user.name || m.user.email}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="date"
                                className="action-editable-input date-edit"
                                value={action.dueDate ? action.dueDate.split('T')[0] : ''}
                                onChange={(e) =>
                                  handleUpdateActionField(action.id, 'dueDate', e.target.value)
                                }
                              />
                            </div>
                          </div>
                        ) : action.type === 'ASSIGN_TASK' ? (
                          <div className="action-interactive-form">
                            <p className="action-desc-text">
                              Affectation de la tâche <strong>{action.taskTitle}</strong>
                            </p>
                            <select
                              className="action-editable-select"
                              value={action.assigneeId || ''}
                              onChange={(e) =>
                                handleUpdateActionField(action.id, 'assigneeId', e.target.value)
                              }
                            >
                              <option value="">Sélectionner un assigné...</option>
                              {workspaceMembers.map((m) => (
                                <option key={m.id} value={m.user.id}>
                                  {m.user.name || m.user.email}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <p className="action-desc">{action.description}</p>
                        )}

                        {!action.resolved && (
                          <div className="action-warning">
                            <AlertCircle size={12} className="warning-icon" />
                            <span>{action.warning}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      className="action-delete-btn"
                      onClick={() => handleDeleteAction(action.id)}
                      title="Ignorer cette action"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {hasWarnings && (
                <div className="warning-notice">
                  <AlertCircle size={16} className="notice-icon" />
                  <p>
                    Certaines actions ne sont pas résolues (icône corail). Veuillez sélectionner un
                    collaborateur ou modifier le titre pour pouvoir les exécuter.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Suggestions si vide */}
          {actions.length === 0 && !isLoading && !executionSuccess && (
            <div className="ai-suggestions-section">
              <h4 className="suggestions-title">Suggestions d'exemples</h4>
              <div className="suggestions-list">
                {examples.map((ex, i) => (
                  <button
                    key={i}
                    className="suggestion-badge-btn"
                    onClick={() => handleApplyExample(ex.cmd)}
                  >
                    <Sparkles size={12} className="sugg-spark" />
                    <span>{ex.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer avec boutons d'actions */}
        {actions.length > 0 && !executionSuccess && (
          <div className="ai-command-bar-footer">
            <button
              className="footer-cancel-btn"
              onClick={() => setActions([])}
              disabled={isLoading}
            >
              Réinitialiser
            </button>
            <button
              className={`footer-execute-btn ${canExecute ? 'glow-btn' : ''}`}
              onClick={handleExecute}
              disabled={!canExecute}
            >
              {isLoading ? (
                <Loader2 className="spinner-icon" size={16} />
              ) : (
                <>
                  <Check size={16} style={{ marginRight: '6px' }} />
                  <span>Valider & Exécuter</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Guide rapide raccourcis si vide */}
        {actions.length === 0 && !isLoading && !executionSuccess && (
          <div className="ai-shortcuts-guide">
            <span>Raccourcis : </span>
            <kbd>Entrée</kbd> pour analyser • <kbd>Esc</kbd> pour fermer
          </div>
        )}
      </div>
    </div>
  );
};
