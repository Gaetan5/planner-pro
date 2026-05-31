# 🔬 Audit Stratégique Complet — Planner Pro vs Roadmap 13 Phases

> **Posture** : Lead Software Architect / 20+ ans d'expérience  
> **Date** : 30 mai 2026  
> **Méthode** : Scan complet du code source (backend + frontend + schéma Prisma)

---

## 📊 Matrice de Couverture Synthétique

| Phase | Intitulé | Backend | Frontend | Maturité | Verdict |
|:---:|:---|:---:|:---:|:---:|:---|
| 1 | Collaboration Réelle | ✅ 85% | ✅ 75% | **80%** | Solide, manque l'envoi d'email |
| 2 | Commentaires & Communication | ✅ 90% | ✅ 80% | **85%** | Très avancé |
| 3 | Assistant IA de Productivité | ✅ 95% | ✅ 85% | **90%** | Le plus mature |
| 4 | Capture Vocale | ✅ 80% | ✅ 70% | **75%** | Fonctionnel avec Gemini |
| 5 | OCR & Whiteboard Import | ✅ 80% | ✅ 70% | **75%** | Vision API câblée |
| 6 | Copilote Proactif | ✅ 85% | ✅ 75% | **80%** | Alertes + Briefing IA |
| 7 | Synchronisation Réelle | ⚠️ 40% | ⚠️ 30% | **35%** | Squelette, pas de vrai OAuth |
| 8 | Auto Scheduling Intelligent | ✅ 60% | ⚠️ 20% | **40%** | Effet domino backend OK |
| 9 | Agile Professionnel | ✅ 80% | ✅ 75% | **78%** | Sprints, Burndown, Velocity |
| 10 | Gantt Nouvelle Génération | ✅ 70% | ✅ 65% | **68%** | Composant GanttView existe |
| 11 | Finances & Rentabilité | ✅ 90% | ⚠️ 50% | **70%** | Backend complet, frontend partiel |
| 12 | Gestion de Portefeuille | ⚠️ 40% | ⚠️ 30% | **35%** | Delivery Report existe |
| 13 | RBAC Avancé | ⚠️ 30% | ⚠️ 10% | **20%** | 4 rôles workspace, pas de granularité projet |

---

## Phase 1 — Collaboration Réelle

### ✅ Ce qui est fait (Backend)

- Modèle [Workspace](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L36-L53) complet avec `ownerId`, soft delete
- Modèle [Membership](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L55-L66) avec contrainte unique `(workspaceId, userId)`
- Enum [WorkspaceRole](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L373-L378) : `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`
- Modèle [Invitation](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L387-L407) avec token hashé, expiration, statuts (`PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`), support lien anonyme (`email` nullable)
- [InvitationsService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/invitations.service.ts) complet : création sécurisée, validation, acceptation, révocation, contrôle RBAC
- [InvitationsController](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/invitations.controller.ts) avec routes CRUD
- `ensureDefaultWorkspace()` dans [ProjectsService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.service.ts#L19-L45) — auto-provisionne un workspace pour les nouveaux utilisateurs
- Modèle [Team](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L68-L78) présent mais **non exploité**

### ✅ Ce qui est fait (Frontend)

- Composant [InvitationAcceptance.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/InvitationAcceptance.tsx) — flux complet d'acceptation d'invitation par lien
- Gestion des workspaces dans [AppContext.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/context/AppContext.tsx) — chargement, sélection, membres

### ⚠️ Ce qui manque

- **Aucun service d'envoi d'email** — L'invitation par email est stockée en BDD, mais **jamais envoyée** (ni Nodemailer, ni SendGrid, ni Resend)
- **Le modèle `Team`** est dans le schéma mais **zéro logique métier associée** — pas d'assignation par équipe, pas de vue équipe
- **Pas de notification temps réel** quand un membre rejoint le workspace (WebSocket pas câblé)
- **Pas de rôle par projet** — le `projectId` optionnel sur `Invitation` est câblé mais **aucune logique de permission spécifique au projet** n'existe

### 📊 Maturité : **80%** — Infrastructure solide, manque les canaux de distribution (email) et la granularité par projet

---

## Phase 2 — Commentaires et Communication

### ✅ Ce qui est fait (Backend)

- Modèle [Comment](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L409-L421) avec index sur `taskId` et `userId`
- [CommentsService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/comments.service.ts) complet :
  - CRUD (create, list, update, delete)
  - **Détection de mentions `@user`** avec résolution fuzzy (nom, email, préfixe email)
  - Contrôle d'accès workspace sur toutes les actions
  - Seul l'auteur peut modifier, mais OWNER/ADMIN peut supprimer
  - Notification webhook Slack/Teams à chaque commentaire
- [CommentsController](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/comments.controller.ts) avec routes REST

### ✅ Ce qui est fait (Frontend)

- Composant [TaskCommentsPanel.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/TaskCommentsPanel.tsx) — UI panel de commentaires avec avatars
- [TaskCommentsPanel.css](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/TaskCommentsPanel.css) — style premium

### ⚠️ Ce qui manque

- **Pas de réponse hiérarchique** (replies / thread) — le modèle `Comment` est plat (pas de `parentId`)
- **Pas de pièces jointes** (fichiers, images)
- **Pas de notification in-app temps réel** — les mentions sont détectées mais **rien n'en est fait côté frontend** (pas de badge, pas de pop-up, pas de boîte de notification)
- **Pas de typing indicator** WebSocket
- **Pas d'éditeur riche** — le commentaire est du texte brut

### 📊 Maturité : **85%** — Le core loop est solide, les mentions marchent, mais l'UX de notification est absente

---

## Phase 3 — Assistant IA de Productivité

### ✅ Ce qui est fait (Backend)

- [GeminiService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/notes/gemini.service.ts) — intégration Gemini 1.5 Flash :
  - `extractTasksFromText()` — extraction NLP de tâches depuis Markdown avec dates, assignations, états
  - `parseCommand()` — interprétation de commandes en langage naturel avec Structured Output JSON
  - Architecture modulaire avec `isAvailable()` + fallback mock
- [AiService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/ai.service.ts) complet :
  - `analyzeCommand()` — pipeline : parsing Gemini → résolution d'entités en BDD → preview
  - `executeActions()` — exécution en batch des actions validées
  - 5 types d'actions : `CREATE_TASK`, `ASSIGN_TASK`, `CREATE_DEPENDENCY`, `CREATE_TIMEBLOCK`, `UPDATE_TASK_STATUS`
  - Résolution fuzzy de membres et tâches (normalisation diacritiques)
  - Mode mock complet pour les tests sans clé API
- [AiController](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/ai.controller.ts)

### ✅ Ce qui est fait (Frontend)

- [AiCommandBar.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/AiCommandBar.tsx) — barre de commande IA avec preview des actions avant exécution
- [CommandPalette.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/CommandPalette.tsx) — raccourci ⌘+K / Ctrl+K

### ⚠️ Ce qui manque

- **Pas d'historique des commandes IA** — aucune trace en BDD
- **Pas de versioning des prompts** — les prompts sont hardcodés dans le service
- **Pas de support multi-fournisseur** (OpenAI, Claude) — uniquement Gemini

### 📊 Maturité : **90%** — Très mature, le pipeline Parse → Resolve → Preview → Execute est exemplaire

---

## Phase 4 — Capture Vocale

### ✅ Ce qui est fait (Backend)

- `transcribeAudio()` dans [GeminiService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/notes/gemini.service.ts#L257-L283) — transcription audio via Gemini 1.5 Flash multimodal
- `transcribeAndAnalyzeVoice()` dans [AiService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/ai.service.ts#L317-L343) — pipeline complet : Audio → Transcription → Analyse NLP → Actions résolues
- Mode mock intégré

### ✅ Ce qui est fait (Frontend)

- Intégré dans [AiCommandBar.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/AiCommandBar.tsx) — bouton micro avec `MediaRecorder` API

### ⚠️ Ce qui manque

- **Pas de streaming en temps réel** — la transcription attend la fin de l'enregistrement complet
- **Pas d'API dédiée type Whisper/Deepgram** — tout passe par Gemini qui n'est pas optimal pour l'audio long
- **Pas de mobile-first** — pas de PWA, pas de gestion de la caméra/micro mobile native

### 📊 Maturité : **75%** — Fonctionnel mais pas optimisé pour la production mobile

---

## Phase 5 — OCR & Whiteboard Import

### ✅ Ce qui est fait (Backend)

- `analyzeImage()` dans [GeminiService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/notes/gemini.service.ts#L289-L392) — analyse d'image via Gemini Vision avec Structured Output JSON
- `analyzeImageAndResolve()` dans [AiService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/ai.service.ts#L87-L114) — pipeline complet : Image → Analyse Vision → Actions résolues
- Endpoint multer pour upload dans [AiController](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/ai.controller.ts)

### ✅ Ce qui est fait (Frontend)

- Upload d'image dans [AiCommandBar.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/AiCommandBar.tsx)

### ⚠️ Ce qui manque

- **Pas de caméra live** — uniquement upload de fichier
- **Pas d'OCR dédié** (Tesseract, Google Vision) — tout repose sur Gemini Vision
- **Pas de prévisualisation annotée** de l'image avec les zones détectées

### 📊 Maturité : **75%** — Même pattern que la capture vocale, fonctionnel mais pas "wow"

---

## Phase 6 — Copilote Proactif

### ✅ Ce qui est fait (Backend)

- [CopilotService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/copilot.service.ts) complet :
  - `calculatePredictiveAlerts()` — moteur de règles heuristiques avec 4 types d'alertes :
    - `OVERDUE` (retard critique)
    - `AT_RISK` (échéance dans 3 jours, encore TODO)
    - `BOTTLENECK` (tâche bloquée par une dépendance en retard)
    - `OVERLOADED` (collaborateur en surcharge vs `weeklyCapacityMinutes`)
  - `generateBriefing()` — Daily Briefing IA personnalisé via Gemini avec données contextuelles (tâches, jalons, alertes)
  - Mode mock pour briefings de qualité sans API

### ✅ Ce qui est fait (Frontend)

- [CopilotWidget.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/CopilotWidget.tsx) — widget panneau latéral avec affichage des alertes et briefing
- [CopilotWidget.css](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/CopilotWidget.css) — design premium

### ⚠️ Ce qui manque

- **Pas de cron/scheduler** — les alertes sont calculées à la demande, pas en arrière-plan
- **Pas de notification push** — pas de badge, pas de notification navigateur
- **Pas de Burnout Detector** avancé — la surcharge est basée uniquement sur les estimations vs capacité, pas sur le temps réel travaillé

### 📊 Maturité : **80%** — Impressive pour un MVP, mais le moteur est réactif et non proactif

---

## Phase 7 — Synchronisation Réelle

### ⚠️ Ce qui est fait (Backend)

- Modèle [Integration](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L423-L436) — supporte `SLACK`, `TEAMS`, `GOOGLE_CALENDAR`, `OUTLOOK`
- [IntegrationService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/integration.service.ts) — CRUD intégrations + webhook fire-and-forget vers Slack/Teams
- [CalendarSyncService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/calendar-sync.service.ts) — **SIMULÉ** :
  - `exportToCalendar()` — récupère les TimeBlocks mais ne fait aucun appel API réel
  - `detectCalendarConflicts()` — détection de conflits avec **événements hardcodés simulés**

### ✅ Ce qui est fait (Frontend)

- [IntegrationsPanel.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/IntegrationsPanel.tsx) — panneau de configuration des intégrations

### ❌ Ce qui manque (CRITIQUE)

- **Aucun OAuth réel** — pas de flux OAuth2 Google Calendar, pas de flux OAuth2 Outlook, pas de token d'accès stocké
- **Aucune API Calendar réelle** — les exports et conflits sont des stubs
- **Pas de synchronisation bidirectionnelle** — zéro import d'événements externes
- **Les webhooks Slack/Teams fonctionnent** mais sont fire-and-forget sans retry

### 📊 Maturité : **35%** — Squelette CRUD + notifications webhook fonctionnelles, mais **zéro intégration Calendar réelle**

---

## Phase 8 — Auto Scheduling Intelligent

### ✅ Ce qui est fait (Backend)

- `propagateScheduleUpdates()` dans [ProjectsService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.service.ts#L561-L611) — **Effet domino complet** :
  - Propagation récursive en transaction Prisma
  - Décalage automatique des tâches dépendantes (FINISH_TO_START)
  - Liste des `impactedTaskIds` renvoyée au frontend
- Notification WebSocket `task-schedule-propagated` dans [ProjectsController](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.controller.ts#L243-L251)
- `optimizeWorkspaceResources()` dans [ProjectsService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.service.ts#L1137-L1239) — algorithme glouton de réallocation par charge/capacité

### ⚠️ Ce qui manque

- **Pas de recalcul automatique global** — l'effet domino se déclenche uniquement quand l'utilisateur modifie un `dueDate` manuellement
- **Pas de Critical Path Method (CPM)** implémenté
- **Pas de prise en compte des disponibilités** (congés, jours fériés)
- **Pas de contrainte horaire** — les TimeBlocks ne sont pas recalculés lors de la propagation
- **Frontend limité** — pas de visualisation de l'impact avant confirmation

### 📊 Maturité : **40%** — Le mécanisme de base existe mais manque d'intelligence et de couverture

---

## Phase 9 — Agile Professionnel

### ✅ Ce qui est fait (Backend)

- Modèle [Sprint](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L438-L451) avec `SprintStatus` (`PLANNED`, `ACTIVE`, `COMPLETED`)
- Champ `storyPoints` et `sprintId` sur [Task](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L237-L239)
- [SprintService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/sprint.service.ts) complet :
  - CRUD Sprints
  - Association/dissociation de tâches
  - Logique de clôture (COMPLETED → tâches non finies renvoyées au backlog)
  - `getAverageVelocity()` — calcul de vélocité moyenne sur sprints terminés
  - `getBurndownChart()` — données burndown jour par jour (réel vs idéal)
- Routes dans [ProjectsController](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.controller.ts#L349-L402)

### ✅ Ce qui est fait (Frontend)

- [AgileView.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/AgileView.tsx) — vue Agile complète avec :
  - Backlog
  - Board de sprint actif
  - Drag & drop des tâches entre sprints/backlog
  - Graphique Burndown
  - Affichage de la vélocité

### ⚠️ Ce qui manque

- **Pas de Cumulative Flow Diagram (CFD)**
- **Pas de Sprint Retrospective** automatisée
- **Pas de distinction Mode Solo / Mode Équipe** comme prévu dans la roadmap
- **Pas d'estimation par Planning Poker** ou système de vote

### 📊 Maturité : **78%** — Solide pour un outil de gestion Agile, les fondamentaux sont là

---

## Phase 10 — Gantt Nouvelle Génération

### ✅ Ce qui est fait (Frontend)

- [GanttView.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/GanttView.tsx) — composant Gantt custom :
  - Rendu SVG
  - Barres de tâches avec dates
  - Lignes de dépendances visuelles
- [GanttView.css](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/GanttView.css) — 13K de CSS

### ⚠️ Ce qui manque

- **Pas de drag & drop** sur les barres Gantt — la modification des dates se fait uniquement via les modales
- **Pas de zoom dynamique** (jour/semaine/mois/trimestre)
- **Pas de surlignage prédictif** des tâches impactées lors du glissement
- **Pas de chemin critique** visualisé
- **Pas de mise à jour optimiste** — tout repasse par une requête API

### 📊 Maturité : **68%** — Un Gantt fonctionnel mais loin du standard Linear/Motion

---

## Phase 11 — Finances & Rentabilité

### ✅ Ce qui est fait (Backend) — **LE PLUS AVANCÉ**

- [getProjectFinances()](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.service.ts#L1241-L1335) — calcul complet :
  - Coût réel basé sur `costRateCents` × heures TrackLogs
  - Revenu réel basé sur `billingRateCents` × heures (mode TIME_AND_MATERIALS)
  - Revenu prorata avancement (mode FIXED_PRICE)
  - Marge (valeur + pourcentage)
  - `burnPercent` (consommation du budget)
  - `hasBudgetAlert` (dépassement budgétaire)
- [getWorkspaceFinancialSummary()](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.service.ts#L1337-L1374) — agrégation multi-projets
- Modèle [ResourceProfile](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L153-L168) avec `costRateCents` et `billingRateCents`
- Champs `budgetCents` et `billingType` sur [Project](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L99-L100)
- DTO [UpdateProjectFinancesDto](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/dto/update-project-finances.dto.ts)

### ⚠️ Ce qui manque (Frontend)

- **Pas de vue dédiée "Finances"** dans le frontend — les données sont disponibles via API mais **pas affichées**
- **Pas de graphiques budgétaires** (burn rate, tendance de marge)
- **Pas d'alerte visuelle** de dépassement budgétaire
- [GovernanceView.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/GovernanceView.tsx) contient des rapports de livraison mais **pas les finances**

### 📊 Maturité : **70%** — Backend exemplaire, frontend lacunaire

---

## Phase 12 — Gestion de Portefeuille

### ⚠️ Ce qui est fait

- `getDeliveryReport()` dans [ProjectsService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.service.ts#L751-L809) — KPIs par projet (taux de complétion, temps tracké, livrables, jalons)
- [GovernanceView.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/GovernanceView.tsx) — vue de gouvernance avec phases, milestones, deliverables, delivery checklist
- [DashboardContent.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/DashboardContent.tsx) — dashboard de base

### ❌ Ce qui manque

- **Pas de Health Score Projet (0-100)** — aucun calcul composite
- **Pas de Dashboard exécutif** cross-projets — `getWorkspaceFinancialSummary` existe backend mais rien en frontend
- **Pas de KPIs globaux agrégés** visuellement
- **Pas de vue portefeuille** avec risques, alertes, tendances

### 📊 Maturité : **35%** — Des briques unitaires existent, mais la vue consolidée est absente

---

## Phase 13 — RBAC Avancé

### ⚠️ Ce qui est fait

- 4 rôles workspace via l'enum [WorkspaceRole](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L373-L378) : `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`
- `assertWorkspaceRole()` utilisé partout pour les actions sensibles (finances, optimisation, milestones, deliverables)
- Le rôle `VIEWER` existe mais **n'est pas exploité** — aucune restriction de lecture

### ❌ Ce qui manque (CRITIQUE pour la collaboration)

- **Pas de rôle par projet** — un `MEMBER` a accès à TOUS les projets du workspace
- **Pas de rôle `Commenter`** — soit on est MEMBER (tout accès), soit VIEWER (passif)
- **Pas de rôle `Client externe`** — aucune vue limitée pour un client
- **Pas de matrice de permissions fine** — tout est basé sur des `if/else` hardcodés
- **Pas d'audit log** — aucune traçabilité des actions

### 📊 Maturité : **20%** — Le minimum syndical pour un MVP mono-équipe

---

## Fonctionnalités Différenciantes

| Feature | Status | Détail |
|:---|:---:|:---|
| Daily Briefing IA | ✅ **Fait** | `generateBriefing()` dans CopilotService avec Gemini + mode mock |
| Health Score Projet | ❌ **Absent** | Aucun calcul composite |
| Burnout Detector | ⚠️ **Partiel** | Surcharge détectée via estimations, pas via temps réel |
| Assistant de Réunion | ⚠️ **Partiel** | Capture vocale → tâches existe, mais pas de segmentation réunion/décisions |
| Smart Inbox | ❌ **Absent** | Aucune intégration email entrante |

---

## 🧠 Verdict d'Expert — Sans Filtre

### Points Forts (ce qui impressionne)

1. **L'architecture IA est exceptionnelle** pour un projet à ce stade. Le pipeline Parse → Resolve → Preview → Execute de l'AiService est propre et bien pensé.
2. **Le modèle de données Prisma est riche** — Workspace, Membership, Invitation, Sprint, Dependencies, TimeLog, ResourceProfile... tout est là.
3. **Le backend à 1376 lignes de ProjectsService** est un monstre qui couvre énormément de fonctionnalités.
4. **La Phase 11 (Finances)** est surprenamment mature côté backend avec un vrai calcul de rentabilité.
5. **L'effet domino** sur les dépendances est un vrai "wow" technique.

### Points Faibles (ce qui pose problème)

> [!CAUTION]
>
> ### 1. God Service Anti-Pattern
>
> Le fichier [projects.service.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.service.ts) fait **1376 lignes** et gère : projets, tâches, dépendances, TimeBlocks, milestones, deliverables, deliveries, resources, finances, GitHub webhooks, et optimisation. C'est un **God Object** flagrant qui viole le Single Responsibility Principle. Chaque domaine devrait avoir son propre service.

> [!WARNING]
>
> ### 2. Décalage Frontend / Backend
>
> Le backend est significativement plus avancé que le frontend. Les finances, le financial summary workspace, et plusieurs APIs de données n'ont **aucune interface utilisateur**. On a un moteur de Ferrari avec une carrosserie de Clio.

> [!WARNING]
>
> ### 3. Synchronisation Calendar = Vaporware
>
> Le CalendarSyncService est entièrement simulé avec des données hardcodées. Les événements "Alice dentiste" et "Gaëtan Comité de Direction" en dur dans le code ne trompent personne. Pas un seul appel OAuth ni API Calendar réel.

> [!IMPORTANT]
>
> ### 4. Pas de système de notifications
>
> Aucun modèle `Notification` en BDD, aucune notification in-app, aucun badge, aucun compteur non-lu. Les mentions dans les commentaires sont détectées mais **tombent dans le vide**. Pour un outil collaboratif, c'est un manque fondamental.

> [!IMPORTANT]
>
> ### 5. Le VIEWER ne voit rien de spécial
>
> Le rôle VIEWER existe dans l'enum mais n'est implémenté nulle part. Un VIEWER peut potentiellement créer des tâches si l'interface lui laisse.

---

## 📋 Recommandation de Priorités d'Implémentation

En respectant les principes sacrés (Simplicité > Complexité, Automatisation > Saisie Manuelle), voici mon ordre recommandé **révisé** :

| Priorité | Action | Impact | Effort |
|:---:|:---|:---:|:---:|
| **P0** | Refactorer ProjectsService en sous-services | 🏗️ Maintenabilité | 2-3j |
| **P0** | Créer le modèle `Notification` + WebSocket temps réel | 👥 Collaboration | 3-4j |
| **P1** | Frontend Phase 11 — Vue Finances + graphiques | 💰 Valeur business | 2-3j |
| **P1** | Frontend Phase 12 — Dashboard Portefeuille + Health Score | 📊 Visibilité | 3-4j |
| **P2** | Phase 7 — OAuth2 réel Google Calendar | 📅 Sync réelle | 4-5j |
| **P2** | Phase 13 — Permissions par projet | 🔐 Sécurité | 3-4j |
| **P3** | Phase 10 — Drag & drop Gantt | ✨ UX premium | 3-4j |
| **P3** | Phase 8 — Auto-scheduling proactif (CPM) | 🧠 Intelligence | 4-5j |

---

> **Conclusion** : Planner Pro a une base technique impressionnante, surtout côté backend et IA. Le codebase couvre déjà **~70% de la surface fonctionnelle** de la roadmap. Mais le frontend accuse un retard de 2-3 phases sur le backend. Le plus gros risque immédiat est le God Service de 1376 lignes et l'absence de système de notifications — deux choses qui bloqueront toute scalabilité collaborative.
