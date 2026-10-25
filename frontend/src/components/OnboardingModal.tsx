import React, { useState } from 'react';
import {
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Kanban,
  ListChecks,
  Sparkles,
  Timer,
  X,
} from 'lucide-react';
import './OnboardingModal.css';

type GuideTab = 'kanban' | 'pomodoro' | 'gantt' | 'ai';

interface OnboardingModalProps {
  onClose: () => void;
  onNavigate: (tab: GuideTab) => void;
}

const steps = [
  {
    title: 'Votre projet de prise en main',
    description:
      'Une inscription classique crée le projet « Démarrage Planner-Pro » et quatre tâches de démonstration dans votre espace. Les comptes créés avant ce parcours et la session de démonstration peuvent ne pas les avoir : dans ce cas, suivez les étapes avec vos propres tâches.',
    icon: <Info className="onboarding-icon onboarding-icon--blue" size={32} />,
    badge: 'Avant de commencer',
    task: 'Votre parcours',
    tips: [
      'Sur Kanban, faites avancer une tâche existante ou créez un projet et une tâche de test.',
      'Dans Pomodoro, choisissez n’importe quelle tâche pour démarrer une session.',
      'Dans Gantt, liez deux tâches existantes pour essayer une dépendance.',
      'L’Assistant IA est facultatif et dépend de la configuration du serveur.',
    ],
  },
  {
    title: 'Faites avancer une tâche',
    description:
      'Dans le Kanban, repérez « Découvrir le Kanban » si cette tâche existe dans votre espace. Sinon, prenez n’importe quelle carte de la colonne « À faire » ou créez un projet et une tâche de test.',
    icon: <Kanban className="onboarding-icon onboarding-icon--purple" size={32} />,
    badge: 'Tâche 1 · Kanban',
    task: 'À essayer : déplacer une carte de « À faire » à « En cours »',
    tab: 'kanban' as const,
    action: 'Ouvrir le Kanban',
    tips: [
      'Faites glisser la carte dans une autre colonne.',
      'Le bouton de commentaire sur la carte ouvre la discussion de cette tâche.',
      'Le bouton ▶ démarre son suivi de temps ; le bouton ■ l’arrête.',
    ],
  },
  {
    title: 'Lancez une session de concentration',
    description:
      'Dans Pomodoro, choisissez « Lancer un timer Pomodoro » si elle est dans la liste ; sinon, choisissez n’importe quelle tâche disponible. Appuyez ensuite sur ▶ pour démarrer.',
    icon: <Timer className="onboarding-icon onboarding-icon--green" size={32} />,
    badge: 'Tâche 2 · Pomodoro',
    task: 'À essayer : associer une tâche à votre session',
    tab: 'pomodoro' as const,
    action: 'Ouvrir Pomodoro',
    tips: [
      'Mettez la session en pause avec le bouton pause ; reprenez-la avec ▶.',
      'Le suivi de temps peut aussi être lancé directement depuis une carte Kanban.',
      'À la fin du cycle de concentration, l’application vous propose une pause.',
    ],
  },
  {
    title: 'Essayez l’Assistant IA',
    description:
      'Cliquez sur l’icône ✨ dans l’en-tête, saisissez « Crée une tâche pour préparer ma semaine », puis lancez l’analyse. Vérifiez les actions proposées avant de les exécuter.',
    icon: <Sparkles className="onboarding-icon onboarding-icon--gold" size={32} />,
    badge: 'Tâche 3 · Assistant IA',
    task: 'À essayer : analyser une commande avant validation',
    tab: 'ai' as const,
    action: 'Ouvrir l’Assistant IA',
    tips: [
      'L’Assistant peut proposer des tâches et des actions de planification.',
      'Relisez les propositions : rien n’est appliqué avant votre validation.',
      'Les fonctions IA nécessitent que le fournisseur soit configuré sur le serveur.',
    ],
  },
  {
    title: 'Comprenez les dépendances dans Gantt',
    description:
      'Si les tâches de démonstration sont présentes, « Voir le chemin critique sur Gantt » dépend déjà de « Découvrir le Kanban ». Sinon, choisissez deux tâches : cliquez sur le lien de la tâche qui attend, puis sur celui de son prédécesseur.',
    icon: <CalendarRange className="onboarding-icon onboarding-icon--pink" size={32} />,
    badge: 'Tâche 4 · Gantt',
    task: 'À essayer : planifier une tâche et suivre sa dépendance',
    tab: 'gantt' as const,
    action: 'Ouvrir Gantt',
    tips: [
      'Sur la première tâche, cliquez sur l’icône de lien ; sélectionnez ensuite la tâche qui doit la précéder.',
      'Cliquez sur « Non planifiée » dans la frise pour donner des dates à une tâche ; faites glisser sa barre pour les modifier.',
      'Activez « Chemin Critique » pour mettre en évidence la chaîne de tâches planifiées.',
    ],
  },
  {
    title: 'Vous êtes prêt',
    description:
      'Si le projet de démarrage existe dans votre espace, gardez-le comme pense-bête ou supprimez-le quand vous n’en avez plus besoin. Le bouton ? en haut de l’écran permet de rouvrir ce guide à tout moment.',
    icon: <ListChecks className="onboarding-icon onboarding-icon--blue" size={32} />,
    badge: 'À vous de jouer',
    task: 'Votre espace est prêt pour vos propres projets',
    tips: [
      'Créez un projet à vous depuis le Kanban.',
      'Utilisez Calendrier pour placer une tâche dans un créneau.',
      'Invitez des collègues seulement si vous souhaitez partager un espace.',
    ],
  },
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ onClose, onNavigate }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const current = steps[currentStep];

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((step) => step + 1);
    } else {
      onClose();
    }
  };

  const openStep = () => {
    if (!current.tab) return;
    onNavigate(current.tab);
    onClose();
  };

  return (
    <div className="onboarding-overlay">
      <section
        className="glass-panel onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <button
          className="onboarding-close-btn"
          onClick={onClose}
          title="Fermer le guide"
          aria-label="Fermer le guide"
        >
          <X size={18} />
        </button>

        <div
          className="onboarding-route"
          aria-label={`Étape ${currentStep + 1} sur ${steps.length}`}
        >
          {steps.map((step, index) => (
            <React.Fragment key={step.badge}>
              <button
                type="button"
                className={`onboarding-route-stop ${index === currentStep ? 'onboarding-route-stop--active' : ''} ${index < currentStep ? 'onboarding-route-stop--completed' : ''}`}
                onClick={() => setCurrentStep(index)}
                aria-label={`Aller à l’étape ${index + 1} : ${step.badge}`}
                aria-current={index === currentStep ? 'step' : undefined}
              >
                {index < currentStep ? <CheckCircle2 size={14} /> : index + 1}
              </button>
              {index < steps.length - 1 && (
                <span
                  className={`onboarding-route-line ${index < currentStep ? 'onboarding-route-line--completed' : ''}`}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="onboarding-body" key={currentStep} aria-live="polite">
          <div className="onboarding-header">
            <span className="onboarding-badge">{current.badge}</span>
            <div className="onboarding-icon-wrapper">{current.icon}</div>
            <h2 className="onboarding-title" id="onboarding-title">
              {current.title}
            </h2>
          </div>

          <p className="onboarding-description">{current.description}</p>

          <div className="onboarding-task-callout">
            <span>À faire</span>
            <strong>{current.task}</strong>
          </div>

          <div className="onboarding-tips-card">
            <h3 className="onboarding-tips-title">Comment faire</h3>
            <ul className="onboarding-tips-list">
              {current.tips.map((tip) => (
                <li key={tip} className="onboarding-tip-item">
                  <span className="bullet" aria-hidden="true">
                    →
                  </span>
                  <span className="text">{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="onboarding-footer">
          <button
            className="btn-secondary onboarding-nav-btn"
            onClick={() => setCurrentStep((step) => Math.max(step - 1, 0))}
            disabled={currentStep === 0}
          >
            <ChevronLeft size={16} />
            Précédent
          </button>

          {current.tab && (
            <button className="btn-secondary onboarding-open-btn" onClick={openStep}>
              {current.action}
              <ArrowRight size={16} />
            </button>
          )}

          <span className="onboarding-step-counter">
            {currentStep + 1} / {steps.length}
          </span>

          <button className="btn-primary onboarding-nav-btn" onClick={nextStep}>
            {currentStep === steps.length - 1 ? (
              <>
                Terminer
                <CheckCircle2 size={16} />
              </>
            ) : (
              <>
                Suivant
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
};
