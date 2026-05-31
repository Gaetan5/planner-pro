# 📑 Manifeste d'Ingénierie & Plan de Validation E2E — Tâches Résiduelles

> **Posture** : Lead Software Architect / 20+ ans d'expérience
> **Date de création** : 31 mai 2026
> **Statut** : Prêt pour implémentation

Ce manifeste détaille de manière rigoureuse l'ensemble des tâches résiduelles du projet **Planner Pro** identifiées lors de notre audit de conformité avec la roadmap des 13 phases. Il définit pour chaque lot de tâches un protocole d'implémentation, d'architecture et de test unitaire/d'intégration garantissant un haut niveau de qualité avant validation et commit.

---

## 📈 1. Synthèse des Chantiers & Priorités Stratégiques

| Chantier | Phases Concernées | Priorité | Description | Complexité |
| :--- | :---: | :---: | :--- | :---: |
| **Permissions Granulaires & RBAC** | Phase 1 & Phase 13 | **P2** | Rôles par projet, rôle `Commenter`, rôle `Client`, matrice fine de permissions et historique d'audit | Élevée |
| **Synchronisation Calendar Avancée** | Phase 7 | **P2** | Flux OAuth2 Google/Outlook et synchronisation bidirectionnelle | Élevée |
| **Auto-Scheduling Proactif & Gantt** | Phase 8 & Phase 10 | **P3** | Drag & drop Gantt, zoom, chemin critique (CPM), recalcul global et calendrier des disponibilités | Élevée |
| **Communication & Collaboratif Riche** | Phase 2 | **P3** | Réponses hiérarchiques, pièces jointes, typing indicator et éditeur riche | Moyenne |
| **IA, Multimodalité & Proactivité** | Phase 3, 4, 5 & 6 | **P3** | Historique IA, streaming audio, OCR temps réel et crons proactifs | Élevée |
| **Finances & Portefeuille Consolidés** | Phase 11 & Phase 12 | **P3** | Graphiques d'évolution, alertes proactives et timeline multi-projets | Moyenne |

---

## 🛠️ 2. Spécification Technique des Chantiers Majeurs

---

### Lot A — Permissions Granulaires & RBAC (Priorité : P2)

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

### Lot B — Synchronisation Calendar Avancée (Priorité : P2)

#### 📝 Objectifs — Lot B

1. Implémenter le flux d'authentification OAuth2 (Google API et Microsoft Graph API) pour récupérer et stocker de manière sécurisée les jetons d'accès et de rafraîchissement.
2. Mettre en place un processus de synchronisation bidirectionnelle (les modifications dans Planner Pro mettent à jour l'agenda externe, et inversement).

#### 🗄️ Évolution du Schéma Prisma — Lot B

```prisma
model Integration {
  id           String            @id @default(uuid())
  workspaceId  String
  provider     IntegrationType   // SLACK, TEAMS, GOOGLE_CALENDAR, OUTLOOK
  accessToken  String?           @db.Text // Chiffré en BDD
  refreshToken String?           @db.Text // Chiffré en BDD
  expiresAt    DateTime?
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
}
```

#### 🧪 Protocole de Tests & Validation — Lot B

1. **Mocking des services tiers** :
   - Créer des mocks stricts pour `google-auth-library` et `@microsoft/microsoft-graph-client`.
   - Simuler le rafraîchissement automatique de token expiré et valider que le nouveau jeton est correctement rechiffré et persisté en base de données.

2. **Tests de concurrence** :
   - Valider le comportement en cas de conflits de dates détectés simultanément des deux côtés.

---

### Lot C — Auto-Scheduling Intelligent & Gantt (Priorité : P3)

#### 📝 Objectifs — Lot C

1. Ajouter le support du glisser-déposer sur le composant visuel Gantt avec calcul des nouvelles dates.
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
}
```

#### 🧪 Protocole de Tests & Validation — Lot C

1. **Algorithmique & Graphes** :
   - Rédiger des tests de graphes acycliques orientés (DAG) pour s'assurer de l'absence de boucles de dépendance infinies (détection de cycles).
   - Valider que le chemin critique change correctement lorsqu'une tâche secondaire dépasse la marge disponible.

2. **Intégration Frontend** :
   - Simuler le drag & drop dans des tests unitaires frontend (Jest / React Testing Library) pour s'assurer que les dates calculées sont envoyées avec précision à l'API.

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

Le script de validation interactive E2E (basé sur Puppeteer headless) doit être exécuté localement pour s'assurer qu'aucun changement n'a altéré le tunnel de base d'un utilisateur de Planner Pro.

### Étape 4 : Formatage et Standardisation des commits

Tous les commits doivent respecter les spécifications des **Conventional Commits** :

- `feat(auth): ajout du flux oauth2 pour google calendar`
- `fix(gantt): correction du calcul des marges de retard`
