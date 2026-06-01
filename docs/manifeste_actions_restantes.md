# 📑 Manifeste d'Ingénierie & Plan de Validation E2E — Tâches Résiduelles

> **Posture** : Lead Software Architect / 20+ ans d'expérience
> **Date de mise à jour** : 1er juin 2026
> **Statut** : Prêt pour implémentation

Ce manifeste détaille de manière rigoureuse l'ensemble des tâches résiduelles du projet **Planner Pro** identifiées lors de notre audit de conformité avec la roadmap des 13 phases. Il définit pour chaque lot de tâches un protocole d'implémentation, d'architecture et de test unitaire/d'intégration garantissant un haut niveau de qualité avant validation et commit.

---

## 📈 1. Synthèse des Chantiers & Priorités Stratégiques

| Chantier | Phases Concernées | Priorité | Description | Complexité |
| :--- | :---: | :---: | :--- | :---: |
| **Permissions Granulaires & RBAC** | Phase 1 & Phase 13 | **P0** | Rôles par projet, rôle `Commenter`, rôle `Client`, matrice fine de permissions et historique d'audit | Élevée |
| **Synchronisation Calendar Avancée** | Phase 7 | **P1** | Flux OAuth2 Google/Outlook et synchronisation bidirectionnelle | Élevée |
| **Auto-Scheduling Proactif & Gantt** | Phase 8 & Phase 10 | **P1** | Drag & drop Gantt, zoom, chemin critique (CPM), recalcul global et calendrier des disponibilités | Élevée |
| **Communication & Collaboratif Riche** | Phase 2 | **P2** | ✅ **Terminé** - Réponses hiérarchiques (threads), pièces jointes, typing indicator | Moyenne |
| **IA, Multimodalité & Proactivité** | Phase 3, 4, 5 & 6 | **P2** | ✅ **Terminé** - Historique IA, streaming audio, OCR temps réel et crons proactifs | Élevée |
| **Finances & Portefeuille Consolidés** | Phase 11 & Phase 12 | **P3** | Graphiques d'évolution (burn rate, tendances de marges) et timeline multi-projets consolidée | Moyenne |

---

## 🛠️ 2. Spécification Technique des Chantiers Majeurs

---

### Lot A — Permissions Granulaires & RBAC (Priorité : P0)

#### 📝 Objectifs — Lot A

1. Permettre d'assigner des permissions spécifiques au niveau d'un projet, et pas seulement du workspace.
2. Ajouter le rôle `COMMENTER` (lecture + droit de commenter) et le rôle `CLIENT` (lecture seule sur un périmètre restreint).
3. Consigner chaque action mutative dans une table d'audit dédiée (`AuditLog`).

#### 🗄️ Évolution du Schéma Prisma — Lot A

```prisma
model ProjectMembership {
  id          String        @id @default(uuid())
  projectId   String
  userId      String
  role        ProjectRole
  project     Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@unique([projectId, userId])
  @@index([userId])
  @@index([projectId])
}

enum ProjectRole {
  MANAGER
  CONTRIBUTOR
  COMMENTER
  CLIENT
}

model AuditLog {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  action      String   // ex: "TASK_CREATE", "PROJECT_DELETE"
  entityType  String   // ex: "Task", "Project"
  entityId    String
  changes     Json     // Contenu avant / après
  ipAddress   String?
  createdAt   DateTime @default(now())

  @@index([userId])
}
```

#### 🧪 Protocole de Tests & Validation — Lot A

1. **Tests unitaires (`ProjectPermissionsService`)** :
   - Valider qu'un utilisateur avec le rôle `CLIENT` sur un projet ne peut pas créer de tâche.
   - Valider qu'un utilisateur avec le rôle `COMMENTER` peut ajouter un commentaire mais pas modifier l'état de la tâche.
   - Valider l'insertion systématique d'une ligne d'audit lors des opérations mutatives.

2. **Tests d'intégration (REST API)** :
   - Tester les routes HTTP avec des jetons JWT porteurs de rôles différents et valider les codes de retour (201 Created vs 403 Forbidden).

---

### Lot B — Synchronisation Calendar Avancée (Priorité : P1)

#### 📝 Objectifs — Lot B

1. Implémenter le flux d'authentification OAuth2 (Google API et Microsoft Graph API) pour récupérer et stocker de manière sécurisée les jetons d'accès et de rafraîchissement.
2. Mettre en place un processus de synchronisation bidirectionnelle (les modifications dans Planner Pro mettent à jour l'agenda externe, et inversement).

#### 🗄️ Évolution du Schéma Prisma — Lot B

```prisma
model Integration {
  id           String            @id @default(uuid())
  workspaceId  String
  type         String            // "SLACK", "TEAMS", "GOOGLE_CALENDAR", "OUTLOOK"
  name         String
  url          String?           @db.Text
  calendarId   String?
  active       Boolean           @default(true)
  accessToken  String?           @db.Text // Chiffré en BDD
  refreshToken String?           @db.Text // Chiffré en BDD
  expiresAt    DateTime?
  workspace    Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  @@index([workspaceId])
}
```

#### 🧪 Protocole de Tests & Validation — Lot B

1. **Mocking des services tiers** :
   - Créer des mocks stricts pour `google-auth-library` et `@microsoft/microsoft-graph-client`.
   - Simuler le rafraîchissement automatique de token expiré et valider que le nouveau jeton est correctement rechiffré et persisté en base de données.

2. **Tests de concurrence** :
   - Valider le comportement en cas de conflits de dates détectés simultanément des deux côtés.

---

### Lot C — Auto-Scheduling Intelligent & Gantt (Priorité : P1)

> **Statut** : ✅ **Terminé & validé (1er juin 2026)** (Commit `cbbf0e2`)
> - Modèle Prisma `ResourceLeave` créé et appliqué.
> - Gestion des congés et jours fériés dans l'auto-planification de capacité.
> - Algorithme CPM (Critical Path Method) et détection de cycles implémentés et testés à 100%.
> - Visualisation interactive et mise en relief corail du chemin critique sur le Gantt.

#### 📝 Objectifs — Lot C

1. Ajouter le support du glisser-déposer sur le composant visuel Gantt avec calcul des nouvelles dates (déjà partiellement dégrossi en front, à fiabiliser).
2. Implémenter la méthode du chemin critique (CPM - Critical Path Method) pour mettre en évidence les tâches qui n'ont aucune marge de retard.
3. Prendre en compte le calendrier global des disponibilités (jours fériés et congés des ressources) dans le calcul d'auto-planification.

#### 🗄️ Évolution du Schéma Prisma — Lot C

```prisma
model ResourceLeave {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  startDate   DateTime
  endDate     DateTime
  reason      String?

  @@index([userId])
}
```

#### 🧪 Protocole de Tests & Validation — Lot C

1. **Algorithmique & Graphes** :
   - Rédiger des tests de graphes acycliques orientés (DAG) pour s'assurer de l'absence de boucles de dépendance infinies (détection de cycles).
   - Valider que le chemin critique change correctement lorsqu'une tâche secondaire dépasse la marge disponible.

2. **Intégration Frontend** :
   - Simuler le drag & drop dans des tests unitaires frontend (Jest / React Testing Library) pour s'assurer que les dates calculées sont envoyées avec précision à l'API.

---

### Lot D — Communication & Collaboratif Riche (Priorité : P2)

> **Statut** : ✅ **Terminé & validé (1er juin 2026)**
> - Réponses hiérarchiques (threads) implémentées et gérées en cascade.
> - Pièces jointes (fichiers/images) sur commentaires et tâches (Data URL BDD).
> - Indicateur de saisie (typing indicator) en temps réel via WebSockets.

#### 📝 Objectifs — Lot D

1. Permettre les réponses hiérarchiques (threads) sur les commentaires d'une tâche.
2. Ajouter le support de pièces jointes (fichiers, images) sur les commentaires et les tâches.
3. Intégrer un indicateur de saisie en temps réel (typing indicator) via WebSockets.

#### 🗄️ Évolution du Schéma Prisma — Lot D

```prisma
model Comment {
  id        String       @id @default(uuid())
  content   String       @db.Text
  taskId    String
  task      Task         @relation(fields: [taskId], references: [id], onDelete: Cascade)
  userId    String
  user      User         @relation(fields: [userId], references: [id])
  parentId  String?      // Référence au commentaire parent pour les threads
  parent    Comment?     @relation("CommentReplies", fields: [parentId], references: [id], onDelete: Cascade)
  replies   Comment[]    @relation("CommentReplies")
  attachments Attachment[]
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  @@index([taskId])
  @@index([userId])
  @@index([parentId])
}

model Attachment {
  id          String   @id @default(uuid())
  fileName    String
  fileUrl     String
  fileType    String
  fileSize    Int
  commentId   String?
  comment     Comment? @relation(fields: [commentId], references: [id], onDelete: Cascade)
  taskId      String?
  task        Task?    @relation(fields: [taskId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())

  @@index([commentId])
  @@index([taskId])
}
```

#### 🧪 Protocole de Tests & Validation — Lot D

1. **Tests unitaires et d'intégration** :
   - Valider qu'un commentaire enfant est correctement rattaché à son parent et renvoyé dans l'arborescence hiérarchique.
   - S'assurer que la suppression d'un commentaire parent supprime en cascade l'ensemble des réponses associées.
   - Tester l'upload physique ou simulé de fichiers et l'association avec `Attachment` en base.

2. **WebSocket (Typing Indicator)** :
   - Écrire un test de charge WebSocket validant que l'indicateur de frappe est transmis aux membres actifs du projet en moins de 100ms et s'efface après 3 secondes d'inactivité.

---

### Lot E — IA, Multimodalité & Proactivité (Priorité : P2)

> **Statut** : ✅ **Terminé & validé (1er juin 2026)**
> - Archivage automatique de l'historique d'analyse IA (`AiCommandHistory`).
> - Tâches planifiées et proactivité (surcharges, retards, etc.) via `@Cron`.
> - Pré-calcul et stockage en BDD des briefings matinaux (`AiBriefing`).
> - Streaming audio en temps réel par WebSockets (`voice-start`, `voice-chunk`, `voice-end`).
> - Éditeur interactif des actions générées par l'OCR et l'IA en frontal.

#### 📝 Objectifs — Lot E

1. Archiver l'historique de toutes les requêtes formulées à l'IA de productivité et les actions proposées/exécutées.
2. Implémenter un scheduler/crontab backend pour calculer périodiquement les alertes proactives et générer les briefings en arrière-plan.
3. Intégrer un flux de streaming en temps réel pour l'audio et une interface interactive pour l'OCR de Whiteboard.

#### 🗄️ Évolution du Schéma Prisma — Lot E

```prisma
model AiCommandHistory {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  rawPrompt   String   @db.Text
  actionsJson Json     // Stocke les actions proposées (CREATE_TASK, etc.)
  executed    Boolean  @default(false)
  createdAt   DateTime @default(now())

  @@index([userId])
}
```

#### 🧪 Protocole de Tests & Validation — Lot E

1. **Crons & Proactivité** :
   - Configurer des tests avec horloge simulée (sinon-fake-timers) pour s'assurer que les crons de détection des collaborateurs surchargés ou jalons en retard se déclenchent à intervalle régulier.
   - Vérifier que la génération de briefing pré-calculée en BDD se met à jour correctement.

2. **IA & Historique** :
   - Valider que chaque appel à `AiService.analyzeCommand()` génère un enregistrement dans `AiCommandHistory`.

---

### Lot F — Finances & Portefeuille Consolidés (Priorité : P3)

#### 📝 Objectifs — Lot F

1. Ajouter des visualisations et graphiques temporels (burn rate financier, prévisions de marges) dans le frontend.
2. Implémenter une vue de portefeuille multi-projets consolidée (Gantt Portfolio / Timeline globale) pour le management.

#### 🗄️ Évolution du Schéma Prisma — Lot F

Aucun changement structurel de schéma requis. Les calculs s'appuient sur les relations existantes (`Project`, `Task`, `TimeLog`, `ResourceProfile`).

#### 🧪 Protocole de Tests & Validation — Lot F

1. **Performances & Calculs complexes** :
   - Tester le calcul des marges sur un workspace simulé contenant plus de 100 projets et 50 000 entrées `TimeLog` pour s'assurer que l'agrégation prend moins de 500ms (optimisation via index MySQL).
   - Valider le calcul mathématique des marges prorata (FIXED_PRICE) vs temps réel travaillé (TIME_AND_MATERIALS).

---

## 📋 3. Protocole Strict de Validation & Livraison

Pour assurer la stabilité et éviter toute régression sur la suite existante (88 tests unitaires), chaque contributeur devra respecter le flux suivant avant tout commit sur la branche principale :

### Étape 1 : Exécution locale de la conformité

```bash
# 1. Régénérer le client Prisma local après modification du schéma
npx prisma generate

# 2. Lancer les migrations sur la base de données locale
npx prisma migrate dev

# 3. Exécuter l'ensemble de la suite de tests unitaires
pnpm --filter backend test
```

### Étape 2 : Vérification du Build de Production

```bash
# Valider que le compilateur TS ne remonte aucune erreur de typage
pnpm build
```

### Étape 3 : Exécution du script de test E2E

Le script de validation interactive E2E (basé sur Puppeteer/Playwright) doit être exécuté localement pour s'assurer qu'aucun changement n'a altéré le tunnel de base d'un utilisateur de Planner Pro.

### Étape 4 : Formatage et Standardisation des commits

Tous les commits doivent respecter les spécifications des **Conventional Commits** :

- `feat(auth): ajout du flux oauth2 pour google calendar`
- `fix(gantt): correction du calcul des marges de retard`
