import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  Brain,
  Volume2,
  Pause,
  AlertTriangle,
  Activity,
  ShieldAlert,
  Check,
  Loader2,
  Square,
  RefreshCw,
} from 'lucide-react';
import './CopilotWidget.css';

export interface CopilotAlert {
  id: string;
  type: 'OVERDUE' | 'AT_RISK' | 'OVERLOADED' | 'BOTTLENECK';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  message: string;
  taskId?: string;
  taskTitle?: string;
  userId?: string;
  userName?: string;
}

export const CopilotWidget: React.FC = () => {
  const { workspaces, getCopilotAlerts, getCopilotBriefing, setActiveTab } = useApp();
  const [activeTab, setWidgetTab] = useState<'briefing' | 'alerts'>('briefing');

  const [alerts, setAlerts] = useState<CopilotAlert[]>([]);
  const [briefing, setBriefing] = useState<string | null>(null);

  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // États pour le lecteur audio TTS
  const [isPlayingTts, setIsPlayingTts] = useState(false);
  const [isPausedTts, setIsPausedTts] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const workspaceId = workspaces[0]?.id || '';

  // Charger les alertes au montage
  useEffect(() => {
    if (workspaceId) {
      fetchAlerts();
    }
    // Nettoyage TTS au démontage
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [workspaceId]);

  const fetchAlerts = async () => {
    if (!workspaceId) return;
    setLoadingAlerts(true);
    setError(null);
    try {
      const data = (await getCopilotAlerts(workspaceId)) as CopilotAlert[];
      setAlerts(data);
    } catch (err: unknown) {
      console.error(err);
      setError('Erreur lors de la récupération des alertes.');
    } finally {
      setLoadingAlerts(false);
    }
  };

  const handleGenerateBriefing = async () => {
    if (!workspaceId) return;
    setLoadingBriefing(true);
    setError(null);
    setBriefing(null);

    // Arrêter le TTS en cours si existant
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsPlayingTts(false);
      setIsPausedTts(false);
    }

    try {
      // Si aucune clé API n'est active en CI ou local, on demande explicitement le briefing mocké
      // de façon sécurisée.
      const data = await getCopilotBriefing(workspaceId, false);
      setBriefing(data.briefing);
    } catch (err: unknown) {
      console.error(err);
      setError('Impossible de générer le briefing IA.');
    } finally {
      setLoadingBriefing(false);
    }
  };

  // Synthèse Vocale (TTS) native
  const startTts = () => {
    if (!briefing || !window.speechSynthesis) return;

    // Si c'est en pause, on reprend
    if (isPausedTts) {
      window.speechSynthesis.resume();
      setIsPlayingTts(true);
      setIsPausedTts(false);
      return;
    }

    window.speechSynthesis.cancel();

    // Retirer les caractères Markdown complexes pour la lecture vocale
    const cleanText = briefing
      .replace(/[*#_`-]/g, '')
      .replace(/📅/g, 'Agenda.')
      .replace(/⚠️/g, 'Attention.')
      .replace(/💡/g, 'Recommandation.');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'fr-FR';

    // Essayer de trouver une voix française agréable
    const voices = window.speechSynthesis.getVoices();
    const frVoice = voices.find((v) => v.lang.startsWith('fr'));
    if (frVoice) {
      utterance.voice = frVoice;
    }

    utterance.onend = () => {
      setIsPlayingTts(false);
      setIsPausedTts(false);
    };

    utterance.onerror = () => {
      setIsPlayingTts(false);
      setIsPausedTts(false);
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setIsPlayingTts(true);
    setIsPausedTts(false);
  };

  const pauseTts = () => {
    if (window.speechSynthesis && isPlayingTts) {
      window.speechSynthesis.pause();
      setIsPlayingTts(false);
      setIsPausedTts(true);
    }
  };

  const stopTts = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsPlayingTts(false);
      setIsPausedTts(false);
    }
  };

  const getAlertIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return <ShieldAlert className="alert-badge-icon text-red" size={16} />;
      case 'HIGH':
        return <AlertTriangle className="alert-badge-icon text-orange" size={16} />;
      case 'MEDIUM':
        return <Activity className="alert-badge-icon text-yellow" size={16} />;
      default:
        return <AlertTriangle className="alert-badge-icon" size={16} />;
    }
  };

  const formatSeverityLabel = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'Critique';
      case 'HIGH':
        return 'Élevé';
      case 'MEDIUM':
        return 'Moyen';
      default:
        return severity;
    }
  };

  return (
    <div className="glass-panel copilot-widget-container">
      {/* En-tête Widget */}
      <div className="copilot-widget-header">
        <div className="copilot-title-glow-wrapper">
          <div className="copilot-icon-container animated-pulse-glow">
            <Brain className="copilot-brain-icon" size={18} />
          </div>
          <div>
            <h3 className="copilot-title">Copilote Proactif</h3>
            <p className="copilot-subtitle">Alertes & Briefing IA en temps réel</p>
          </div>
        </div>

        {/* Sélecteur d'onglets */}
        <div className="copilot-tab-bar">
          <button
            className={`copilot-tab-btn ${activeTab === 'briefing' ? 'active' : ''}`}
            onClick={() => setWidgetTab('briefing')}
          >
            Briefing Matinal
          </button>
          <button
            className={`copilot-tab-btn ${activeTab === 'alerts' ? 'active' : ''}`}
            onClick={() => setWidgetTab('alerts')}
          >
            Alertes de Risques
            {alerts.length > 0 && (
              <span
                className={`alerts-count-badge ${alerts.some((a) => a.severity === 'CRITICAL') ? 'critical' : ''}`}
              >
                {alerts.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Zone de contenu */}
      <div className="copilot-widget-body">
        {error && (
          <div className="copilot-error-box">
            <AlertTriangle size={14} className="err-icon" />
            <span>{error}</span>
          </div>
        )}

        {/* Onglet : Briefing Matinal */}
        {activeTab === 'briefing' && (
          <div className="copilot-briefing-tab-content">
            {!briefing && !loadingBriefing ? (
              <div className="copilot-briefing-placeholder">
                <Brain className="placeholder-brain" size={40} />
                <p>
                  Prêt à démarrer votre journée ? Laissez l'IA analyser vos tâches et priorités pour
                  rédiger votre briefing.
                </p>
                <button
                  className="btn-primary copilot-generate-btn"
                  onClick={handleGenerateBriefing}
                >
                  <Brain size={16} style={{ marginRight: '8px' }} />
                  <span>Générer mon Briefing</span>
                </button>
              </div>
            ) : loadingBriefing ? (
              <div className="copilot-loading-briefing">
                <Loader2 className="spinner-icon large" size={32} />
                <p>Gemini synthétise vos données de projet et prépare vos recommandations...</p>
              </div>
            ) : (
              <div className="copilot-briefing-display-wrapper">
                {/* Actions sur le Briefing */}
                <div className="briefing-actions-panel">
                  <div className="tts-controls">
                    {!isPlayingTts ? (
                      <button
                        className="tts-action-btn"
                        onClick={startTts}
                        title="Écouter le briefing"
                      >
                        <Volume2 size={16} />
                        <span>Écouter</span>
                      </button>
                    ) : (
                      <button
                        className="tts-action-btn active"
                        onClick={pauseTts}
                        title="Suspendre l'écoute"
                      >
                        <Pause size={16} />
                        <span>Pause</span>
                      </button>
                    )}
                    {(isPlayingTts || isPausedTts) && (
                      <button
                        className="tts-action-btn stop"
                        onClick={stopTts}
                        title="Arrêter l'écoute"
                      >
                        <Square size={14} />
                      </button>
                    )}
                  </div>

                  <button
                    className="briefing-refresh-btn"
                    onClick={handleGenerateBriefing}
                    title="Regénérer le briefing"
                  >
                    <RefreshCw size={14} />
                    <span>Regénérer</span>
                  </button>
                </div>

                {/* Contenu du Briefing */}
                <div className="briefing-text-content">
                  {(briefing || '').split('\n').map((line, idx) => {
                    const cleanLine = line.trim();
                    if (
                      cleanLine.startsWith('📅') ||
                      cleanLine.startsWith('⚠️') ||
                      cleanLine.startsWith('💡')
                    ) {
                      return (
                        <h4 key={idx} className="briefing-section-title">
                          {cleanLine}
                        </h4>
                      );
                    }
                    if (cleanLine.startsWith('-') || cleanLine.startsWith('*')) {
                      return (
                        <li key={idx} className="briefing-list-item">
                          {cleanLine.replace(/^[-*]\s*/, '')}
                        </li>
                      );
                    }
                    return (
                      <p key={idx} className="briefing-para-text">
                        {cleanLine}
                      </p>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Onglet : Alertes de Risques */}
        {activeTab === 'alerts' && (
          <div className="copilot-alerts-tab-content">
            {loadingAlerts ? (
              <div className="copilot-loading-alerts">
                <Loader2 className="spinner-icon" size={24} />
                <p>Analyse des charges et échéances en cours...</p>
              </div>
            ) : alerts.length === 0 ? (
              <div className="copilot-alerts-empty-state">
                <div className="green-checkmark-glow">
                  <Check size={28} className="green-check" />
                </div>
                <h4>Tout est sous contrôle !</h4>
                <p>
                  Aucun retard, aucune surcharge ni dépendance bloquée n'ont été détectés sur ce
                  workspace.
                </p>
              </div>
            ) : (
              <div className="copilot-alerts-list">
                <div className="alerts-meta">
                  <span>Moteur de règles heuristiques actif</span>
                  <button
                    className="alerts-refresh-icon-btn"
                    onClick={fetchAlerts}
                    title="Rafraîchir les alertes"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>

                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`copilot-alert-card ${alert.severity.toLowerCase()}`}
                  >
                    <div className="alert-card-left">
                      {getAlertIcon(alert.severity)}
                      <div className="alert-card-info">
                        <span className="alert-severity-badge">
                          {formatSeverityLabel(alert.severity)}
                        </span>
                        <p className="alert-message">{alert.message}</p>
                      </div>
                    </div>

                    {alert.taskId && (
                      <button className="alert-action-btn" onClick={() => setActiveTab('kanban')}>
                        Voir Kanban
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
