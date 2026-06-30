import React, { useState } from 'react';
import {
  Sparkles,
  Kanban,
  Timer,
  CalendarRange,
  Info,
  X,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
} from 'lucide-react';
import './OnboardingModal.css';

interface OnboardingModalProps {
  onClose: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ onClose }) => {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    {
      title: 'Bienvenue sur Planner-Pro',
      description:
        "Le hub de planification immersif conçu pour les ingénieurs et équipes d'élite. Planner-Pro combine la gestion de projet moderne et l'intelligence artificielle pour maximiser votre Focus & Flow.",
      icon: <Info className="onboarding-icon onboarding-icon--blue" size={48} />,
      badge: 'Présentation',
      tips: [
        'Un projet de démarrage a été créé automatiquement pour vous !',
        'Utilisez les différents onglets pour alterner les perspectives sur vos tâches.',
        'Le thème sombre (activé par défaut) réduit la fatigue oculaire lors des sessions nocturnes.',
      ],
    },
    {
      title: 'Le Kanban Interactif',
      description:
        'Visualisez votre flux de travail et gérez vos priorités de manière agile. Notre Kanban réagit en temps réel et intègre des micro-animations pour rendre la mise à jour de vos tâches agréable.',
      icon: <Kanban className="onboarding-icon onboarding-icon--purple" size={48} />,
      badge: 'Gestion Agile',
      tips: [
        'Glissez-déposez vos tâches entre À faire, En cours et Terminé.',
        'Double-cliquez sur une carte pour voir ou ajouter des commentaires en temps réel.',
        'Assignez des priorités (Basse, Moyenne, Haute) pour structurer vos journées.',
      ],
    },
    {
      title: 'Planification Gantt & Moteur Domino',
      description:
        "Visualisez vos échéances et les dépendances sous forme de frise chronologique. Planner-Pro intègre un moteur d'Auto-Scheduling : modifiez une tâche parente, et toutes ses dépendantes s'ajustent automatiquement !",
      icon: <CalendarRange className="onboarding-icon onboarding-icon--pink" size={48} />,
      badge: 'Planning Temporel',
      tips: [
        'Créez des dépendances en reliant les tâches directement sur le diagramme.',
        "Visualisez le Chemin Critique mis en évidence en rouge pour anticiper les goulots d'étranglement.",
        "Consultez les conflits d'allocation et la capacité hebdomadaire de votre équipe.",
      ],
    },
    {
      title: 'Focus & Flow avec Pomodoro',
      description:
        'Suivez votre temps réel de travail et évitez le burnout grâce à notre minuteur Pomodoro intégré et synchronisé avec le Time Tracking.',
      icon: <Timer className="onboarding-icon onboarding-icon--green" size={48} />,
      badge: 'Productivité',
      tips: [
        'Sélectionnez une tâche pour y associer directement vos sessions de concentration.',
        'Les blocs de temps enregistrés alimentent automatiquement la capacité des ressources.',
        'Respectez les pauses de 5 minutes suggérées pour maintenir une productivité maximale.',
      ],
    },
    {
      title: "L'Assistant IA Copilot Prédictif",
      description:
        "Propulsé par l'IA de pointe, votre Copilot analyse la charge de travail, identifie les risques de retard et propose un briefing personnalisé pour démarrer votre journée.",
      icon: <Sparkles className="onboarding-icon onboarding-icon--gold" size={48} />,
      badge: 'Intelligence Artificielle',
      tips: [
        "Ouvrez la barre de commande avec ⌘+K (ou l'icône Sparkles).",
        "Demandez à l'IA : 'Crée un projet Site Web avec 4 tâches' pour automatiser sa création.",
        "Générez un briefing vocal ou visuel pour analyser l'avancement global en un instant.",
      ],
    },
  ];

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    localStorage.setItem('planner_onboarding_completed', 'true');
    onClose();
  };

  const current = steps[currentStep];

  return (
    <div className="onboarding-overlay">
      <div className="glass-panel onboarding-card">
        {/* Close Button */}
        <button className="onboarding-close-btn" onClick={handleComplete} title="Passer le guide">
          <X size={18} />
        </button>

        {/* Progress indicators */}
        <div className="onboarding-progress-dots">
          {steps.map((_, index) => (
            <div
              key={index}
              className={`progress-dot ${index === currentStep ? 'progress-dot--active' : ''} ${index < currentStep ? 'progress-dot--completed' : ''}`}
              onClick={() => setCurrentStep(index)}
            />
          ))}
        </div>

        {/* Content Body */}
        <div className="onboarding-body fade-in" key={currentStep}>
          <div className="onboarding-header">
            <span className="onboarding-badge">{current.badge}</span>
            <div className="onboarding-icon-wrapper">{current.icon}</div>
            <h2 className="onboarding-title">{current.title}</h2>
          </div>

          <p className="onboarding-description">{current.description}</p>

          <div className="onboarding-tips-card">
            <h4 className="onboarding-tips-title">💡 Conseils d'utilisation :</h4>
            <ul className="onboarding-tips-list">
              {current.tips.map((tip, idx) => (
                <li key={idx} className="onboarding-tip-item">
                  <span className="bullet">⚡</span>
                  <span className="text">{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="onboarding-footer">
          <button
            className="btn-secondary onboarding-nav-btn"
            onClick={prevStep}
            disabled={currentStep === 0}
          >
            <ChevronLeft size={16} />
            Précédent
          </button>

          <span className="onboarding-step-counter">
            Étape {currentStep + 1} sur {steps.length}
          </span>

          <button className="btn-primary onboarding-nav-btn" onClick={nextStep}>
            {currentStep === steps.length - 1 ? (
              <>
                Démarrer
                <CheckCircle2 size={16} style={{ marginLeft: '4px' }} />
              </>
            ) : (
              <>
                Suivant
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
