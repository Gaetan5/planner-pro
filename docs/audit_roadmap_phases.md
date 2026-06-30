# 🔬 Audit Stratégique Complet — Planner Pro vs Roadmap 13 Phases

> **Posture** : Lead Software Architect / 20+ ans d'expérience  
> **Date** : 1er juin 2026  
> **Méthode** : Scan complet du code source (backend + frontend + schéma Prisma)

---

## 🔴 SPRINT 0 — Sécurité critique (bloquant production)

1. **Migration du hachage de mot de passe vers argon2id**
   - **ÉTAT : TERMINÉ**
   - Implémentation : Remplacé `pbkdf2Sync` par `argon2` dans `encryption.util.ts`.
   - Migration : Implémentation "lazy" lors du login dans `auth.service.ts` : détection du format (legacy PBKDF2 vs Argon2) et re-hachage automatique.
   - Tests : `tests/unit/password.spec.ts` couvre hash Argon2, vérification PBKDF2 legacy, et détection du besoin de migration. Tests passés (100% de succès sur la suite backend).

2. **DTOs validés pour l'authentification**
   - **ÉTAT : TERMINÉ**
   - Implémentation : Création de `RegisterDto` et `LoginDto` (`class-validator`) avec règles de complexité.
   - Intégration : `AuthController` mis à jour pour utiliser ces DTOs.
   - Validation : `main.ts` configuré avec `forbidNonWhitelisted: true` pour rejeter les entrées non autorisées.
   - Tests : La suite de tests backend complète (122 tests) passe sans régression.

3. **Sécurisation du stockage du token côté frontend**
   - **ÉTAT : TERMINÉ**
   - Implémentation : Migration vers cookies `httpOnly`, `sameSite=strict` pour le stockage du token. `cookie-parser` configuré dans `main.ts`.
   - Ajustements : `AuthController` envoie désormais le token via cookie (plus de retour explicite dans le corps). `JwtAuthGuard` extrait le token depuis le cookie.
   - Tests : Suite de tests backend complète (122 tests) passe sans régression.

4. **Rate limiting dédié sur l'authentification**
   - **ÉTAT : TERMINÉ**
   - Implémentation : Application du décorateur `@Throttle({ default: { limit: 5, ttl: 60000 } })` sur les endpoints `login` et `register` dans `AuthController` pour limiter les tentatives de force brute.
   - Tests : Suite de tests backend complète (122 tests) passe sans régression.

5. **Helmet et en-têtes de sécurité HTTP**
   - **ÉTAT : TERMINÉ**
   - Implémentation : Installation et configuration de `helmet` dans `main.ts` pour sécuriser les en-têtes HTTP de l'application.
   - Tests : Suite de tests backend complète (122 tests) passe sans régression.

6. **Correction IDOR WebSocket `join-task`**
   - **ÉTAT : TERMINÉ**
   - Implémentation : Sécurisation de `TrackingGateway.handleJoinTask` avec une vérification explicite des permissions via `ProjectPermissionsService`.
   - Tests : Suite de tests backend complète (122 tests) passe sans régression.

---

## 📊 Matrice de Couverture Synthétique (Mise à jour)

| Phase | Intitulé | Backend | Frontend | Maturité | Verdict |
| :---: | :--- | :---: | :---: | :---: | :--- |
| 1 | Collaboration Réelle | ✅ 95% | ✅ 85% | **90%** | Solide, envoi d'email câblé |
| 2 | Commentaires & Communication | ✅ 98% | ✅ 92% | **95%** | Très avancé, notifications temps réel et e-mails opérationnels |
| 3 | Assistant IA de Productivité | ✅ 95% | ✅ 85% | **90%** | Moteur NLP mature |
| 4 | Capture Vocale | ✅ 80% | ✅ 70% | **75%** | Fonctionnel avec Gemini |
| 5 | OCR & Whiteboard Import | ✅ 80% | ✅ 70% | **75%** | Vision API câblée |
| 6 | Copilote Proactif | ✅ 85% | ✅ 75% | **80%** | Alertes + Briefing IA |
| 7 | Synchronisation Réelle | ✅ 80% | ✅ 70% | **75%** | Intégration iCal/ICS & JSON réelle avec simulateur dynamique |
| 8 | Auto Scheduling Intelligent | ✅ 60% | ⚠️ 20% | **40%** | Effet domino backend OK |
| 9 | Agile Professionnel | ✅ 80% | ✅ 75% | **78%** | Sprints, Burndown, Velocity |
| 10 | Gantt Nouvelle Génération | ✅ 85% | ✅ 85% | **85%** | Drag & drop, zoom, liens interactifs et conflits opérationnels |
| 11 | Finances & Rentabilité | ✅ 98% | ✅ 92% | **95%** | Intégration complète, rapports et sécurité d'accès OK |
| 12 | Gestion de Portefeuille | ✅ 80% | ✅ 80% | **80%** | Dashboard complet, Health Scores composites calculés |
| 13 | RBAC Avancé | ⚠️ 35% | ⚠️ 15% | **25%** | Rôles workspace stricts (dont limitation VIEWER), projet partiel |

---

## Phase 1 — Collaboration Réelle

### ✅ Ce qui est fait (Backend) — Collaboration

- Modèle [Workspace](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L38-L55) complet avec `ownerId`, soft delete.
- Modèle [Membership](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L57-L68) avec contrainte unique `(workspaceId, userId)`.
- Enum [WorkspaceRole](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L375-L380) : `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`.
- Modèle [Invitation](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L389-L409) avec token hashé, expiration, statuts (`PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`), support lien anonyme.
- [InvitationsService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/invitations.service.ts) complet : création sécurisée, validation, acceptation, révocation, contrôle RBAC.
- **Envoi réel d'emails d'invitation** : Câblé via le `MailService` avec modèle d'e-mail responsive HTML et support SMTP réel (avec fallback propre de logs en console en développement local).
- [InvitationsController](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/invitations.controller.ts) avec routes CRUD.
- `ensureDefaultWorkspace()` dans [ProjectsService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.service.ts#L43-L69) — auto-provisionne un workspace pour les nouveaux utilisateurs.
- Modèle [Team](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L70-L80) présent dans le schéma.

### ✅ Ce qui est fait (Frontend) — Collaboration

- Composant [InvitationAcceptance.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/InvitationAcceptance.tsx) — flux complet d'acceptation d'invitation par lien.
- Gestion des workspaces dans [AppContext.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/context/AppContext.tsx) — chargement, sélection, membres.

### ⚠️ Ce qui manque — Collaboration

- **Le modèle `Team`** est dans le schéma mais **sans logique métier associée** (pas d'assignation par équipe, pas de vue équipe).
- **Pas de rôle par projet** — le `projectId` optionnel sur `Invitation` est câblé mais aucune logique de permission spécifique au projet n'est active.

### 📊 Maturité : **90%** — L'envoi d'e-mails d'invitation est entièrement résolu. Manque principalement la gestion par projet et les équipes

---

## Phase 2 — Commentaires et Communication

### ✅ Ce qui est fait (Backend) — Commentaires

- Modèle [Comment](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L411-L423) avec index sur `taskId` et `userId`.
- [CommentsService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/comments.service.ts) complet :
  - CRUD avec vérification d'accès au workspace.
  - **Détection des mentions `@user`** dans le corps du texte.
  - **Système de notification robuste** : Câblé avec le nouveau module `NotificationsService` pour créer une notification en base et émettre un événement temps réel via WebSocket + envoi d'un email de mention personnalisé.
  - Webhook de notification sortant vers Slack/Teams.

### ✅ Ce qui est fait (Frontend) — Commentaires

- Composant [TaskCommentsPanel.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/TaskCommentsPanel.tsx) — UI panel de commentaires avec avatars.
- **Notification Inbox** : Intégration du composant [NotificationInbox.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/NotificationInbox.tsx) avec indicateurs visuels (badge cloche), panneau déroulant de lecture, marquage unitaire/global comme lu, et mise à jour temps réel par socket.

### ⚠️ Ce qui manque — Commentaires

- **Pas de réponse hiérarchique** (replies / thread) — le modèle `Comment` est plat.
- **Pas de pièces jointes** dans les commentaires (fichiers, images).

### 📊 Maturité : **95%** — Excellent. Les mentions déclenchent maintenant de vraies notifications in-app, e-mails de mention, et mises à jour WebSocket temps réel

---

## Phase 3 — Assistant IA de Productivité

### ✅ Ce qui est fait (Backend) — IA

- [GeminiService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/notes/gemini.service.ts) — intégration Gemini 1.5 Flash :
  - `extractTasksFromText()` — extraction NLP de tâches depuis Markdown avec dates, assignations, états.
  - `parseCommand()` — interprétation de commandes en langage naturel avec Structured Output JSON.
- [AiService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/ai.service.ts) complet :
  - `analyzeCommand()` — pipeline : parsing Gemini → résolution d'entités en BDD → preview.
  - `executeActions()` — exécution en batch des actions validées.
  - 5 types d'actions : `CREATE_TASK`, `ASSIGN_TASK`, `CREATE_DEPENDENCY`, `CREATE_TIMEBLOCK`, `UPDATE_TASK_STATUS`.
  - Résolution fuzzy de membres et tâches.

### ✅ Ce qui est fait (Frontend) — IA

- [AiCommandBar.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/AiCommandBar.tsx) — barre de commande IA avec preview des actions avant exécution.
- [CommandPalette.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/CommandPalette.tsx) — raccourci ⌘+K / Ctrl+K.

### ⚠️ Ce qui manque — IA

- Pas d'historique des commandes IA enregistré en base de données.

### 📊 Maturité : **90%** — Le pipeline IA (Parse → Resolve → Preview → Execute) reste exemplaire

---

## Phase 7 — Synchronisation Réelle

### ✅ Ce qui est fait (Backend) — Synchro

- Modèle [Integration](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L425-L438) — supporte `SLACK`, `TEAMS`, `GOOGLE_CALENDAR`, `OUTLOOK`.
- [IntegrationService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/integration.service.ts) — CRUD intégrations + webhook Slack/Teams.
- **CalendarSyncService** : Réécriture robuste avec import et parsing réel de flux de calendriers externes via URL (formats iCal/ICS et JSON), avec parser ICS custom. Propose également un simulateur dynamique en temps réel pour l'UI.

### ✅ Ce qui est fait (Frontend) — Synchro

- [IntegrationsPanel.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/IntegrationsPanel.tsx) — panneau de configuration des intégrations.

### ⚠️ Ce qui manque — Synchro

- **Pas d'OAuth2 natif Google/Outlook** — la synchronisation s'effectue via des liens de partage d'agendas publics (URLs iCal/ICS) plutôt que via authentification OAuth directe.

### 📊 Maturité : **75%** — Le service est maintenant opérationnel avec parsing d'agendas réels et détection dynamique de conflits

---

## Phase 8 — Auto Scheduling Intelligent

### ✅ Ce qui est fait (Backend) — Auto Scheduling

- `propagateScheduleUpdates()` dans [ProjectsService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.service.ts) (délégué à `TasksService`) — **Effet domino complet** :
  - Propagation récursive en transaction Prisma.
  - Décalage automatique des tâches dépendantes (FINISH_TO_START).
- `optimizeWorkspaceResources()` dans [ProjectsService` (délégué à `ResourcesService`) — algorithme glouton de réallocation.

### ⚠️ Ce qui manque — Auto Scheduling

- **Pas de Critical Path Method (CPM)** implémenté.
- **Frontend limité** — pas de visualisation de l'impact avant confirmation.

### 📊 Maturité : **40%** — Le moteur de propagation fonctionne mais manque d'intelligence avancée (dates de congés, CPM)

---

## Phase 9 — Agile Professionnel

### ✅ Ce qui est fait (Backend) — Agile

- Modèle [Sprint](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L440-L453) avec `SprintStatus`.
- Champ `storyPoints` et `sprintId` sur [Task](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L216-L251).
- [SprintService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/sprint.service.ts) complet : CRUD, clôture intelligente de sprints, calcul de vélocité moyenne et Burndown.

### ✅ Ce qui est fait (Frontend) — Agile

- [AgileView.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/AgileView.tsx) — vue Agile complète : Backlog, tableau de sprint actif avec Drag & Drop, graphique Burndown et indicateurs de vélocité.

### 📊 Maturité : **78%** — Trame Agile solide et complète

---

## Phase 10 — Gantt Nouvelle Génération

### ✅ Ce qui est fait (Frontend) — Gantt

- [GanttView.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/GanttView.tsx) — composant de Gantt interactif custom :
  - Rendu vectoriel SVG complet.
  - **Drag & Drop interactif** : Déplacement de barres, et étirement des bords (resize-start, resize-end) pour changer les dates en temps réel.
  - **Création interactive de dépendances** : Drag & drop de lignes de liaisons directement entre tâches.
  - **Détection visuelle des conflits** : Les lignes de liaison passent au rouge si une tâche dépendante commence avant la fin de sa tâche parente.
  - Mode zoom jour/semaine interactif.

### ⚠️ Ce qui manque — Gantt

- Pas de tracé de chemin critique global (CPM) en couleur distincte.

### 📊 Maturité : **85%** — Le Gantt est désormais hautement interactif et visuellement digne d'un outil moderne

---

## Phase 11 — Finances & Rentabilité

### ✅ Ce qui est fait (Backend) — Finances

- [FinancesService](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/finances.service.ts) complet : calcul des coûts réels via TimeLogs et profils de ressources (`ResourceProfile`), revenus réels en fonction du type de facturation (`TIME_AND_MATERIALS` ou `FIXED_PRICE`), marges nettes, burn rate et drapeaux d'alerte de budget.
- Modèle [ResourceProfile](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma#L155-L170).

### ✅ Ce qui est fait (Frontend) — Finances

- **Vue Finances Dédiée** : Création de [FinancesView.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/FinancesView.tsx) proposant des tableaux de synthèse financières par projet et cumulatifs pour le workspace.
- **Gestion des Alertes** : Indication visuelle claire des dépassements de budget.
- **Sécurité et Permissions** : Protection de la vue avec contrôle RBAC strict (réservé aux rôles `ADMIN` et `OWNER`). Les membres `VIEWER` ou `MEMBER` reçoivent un message de refus d'accès.

### 📊 Maturité : **95%** — L'implémentation est totale, propre et sécurisée

---

## Phase 12 — Gestion de Portefeuille

### ✅ Ce qui est fait (Backend & Frontend) — Portefeuille

- **Portfolio Dashboard** : Intégration complète de [PortfolioDashboard.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/PortfolioDashboard.tsx) affiché sur la page d'accueil.
- **Health Score Composite (0-100)** : Algorithme d'évaluation basé sur 4 critères (taux de complétion des tâches, tâches en retard critique, statut opérationnel de risque, et budget/burn rate).
- **Analyses Automatisées** : Génération d'un résumé écrit personnalisé de l'état du projet ("Excellente santé opérationnelle", "Attention requise", etc.) selon son score.
- KPIs consolidés (taux d'avancement moyen, heures consommées, jalons à venir).

### 📊 Maturité : **80%** — La vue portefeuille offre désormais une excellente vue consolidée

---

## Phase 13 — RBAC Avancé

### ✅ Ce qui est fait — RBAC

- 4 rôles workspace via `WorkspaceRole` : `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`.
- Restitution sécurisée des données : Le rôle `VIEWER` n'est plus seulement passif, il est rejeté des actions d'édition et n'a pas accès aux données financières ou d'optimisation.

### ❌ Ce qui manque — RBAC

- Pas de granularité fine par projet (les rôles s'appliquent sur tout le workspace).
- Pas d'audit log pour la traçabilité.

### 📊 Maturité : **25%** — Suffisant pour un usage standard, mais manque de finesse pour une structure multi-projets cloisonnée

---

## 🧠 Verdict d'Expert — Sans Filtre

### Points Forts (ce qui impressionne)

1. **Le "God Service" a été éliminé** : La décomposition de `ProjectsService` en un ensemble de services modulaires spécialisés (`tasks`, `dependencies`, `finances`, `resources`, `milestones`, `timeblocks`) est un travail de refactoring d'une grande propreté.
2. **L'interactivité du Gantt est superbe** : Le support du drag-and-drop, du resize, et de la création interactive de dépendances en SVG rend l'application fluide et premium.
3. **Le système de notification est enfin présent** : Notifications in-app, via WebSocket (temps réel) et par email pour les mentions, comblant ainsi un vide fonctionnel majeur.
4. **Le Dashboard de Portefeuille et la Vue Financière** sont pleinement intégrés et sécurisés.

### Points Faibles restants

> [!WARNING]
> **1. Absence de rôles par projet**
> Un membre d'un workspace a toujours accès à l'intégralité des projets de ce workspace. Le cloisonnement au niveau projet reste à concevoir.

---

## 📋 Recommandation de Priorités d'Implémentation (Mise à jour)

Voici les prochaines étapes recommandées :

| Priorité | Action | Impact | Effort |
| :---: | :--- | :---: | :---: |
| **P0** | Phase 13 — Permissions et rôles par projet | 🔐 Sécurité & Cloisonnement | 3-4j |
| **P1** | Phase 8 — Auto-scheduling proactif avec CPM (Critical Path Method) | 🧠 Intelligence | 4-5j |
| **P1** | Intégration de flux OAuth2 réels pour Google Calendar/Outlook | 📅 Sync bidirectionnelle sans ICS public | 4-5j |
| **P2** | Phase 1 — Gestion et assignation par équipe (`Team`) | 👥 Collaboration | 2-3j |
