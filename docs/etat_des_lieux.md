# 🔍 État des Lieux & Audit Technique — Planner Pro (Juin 2026)

Ce document présente l'audit d'ingénierie logicielle, d'ergonomie UX/UI et d'infrastructure du projet **Planner Pro** à la date du 29 juin 2026.

---

## 🏗️ 1. Architecture Backend & Persistance (Prisma)

### Modélisation des données

* **Refactorisation multi-fichiers Prisma** : L'architecture de persistance a été assainie. Le schéma unique volumineux a été découpé par domaines fonctionnels sous `backend/prisma/schema/*.prisma` (`auth`, `workspace`, `project`, `task`, `resource`, `ai`, `system`).
* **Processus d'import automatique** : La concaténation est assurée par le package `prisma-import` au démarrage du serveur de développement et lors de la phase de compilation.
* **⚠️ Point de vigilance** : Toute modification directe du fichier compilé [schema.prisma](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma) sera automatiquement écrasée lors de la prochaine exécution de `pnpm build` ou `pnpm start:dev`. Les développeurs doivent modifier exclusivement les fichiers individuels présents dans le dossier [schema](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema).

### Performance et Indexation

* Les tables critiques (notamment `Task` et `ResourceLeave`) possèdent des index explicites (`@@index`) sur les clés étrangères (`projectId`, `userId`) réduisant considérablement le coût des jointures MySQL lors des opérations fréquentes de chargement du Gantt et de l'auto-planification.

---

## 🎨 2. Design Système, Frontend & Expérience Utilisateur (UX/UI)

### Structure Esthétique

* Le design est basé sur une identité visuelle sombre moderne de type *Dark Premium* configurable en mode clair via l'attribut `data-theme`.
* Le fichier global [index.css](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/index.css) implémente des variables CSS homogènes, des effets de flou arrière-plan (glassmorphism) et des micro-animations de transition.
* La typographie par défaut utilise la police "Outfit", offrant un rendu visuel épuré et professionnel.

### Évaluation Ergonomique des Composants

* **Diagramme de Gantt** : Implémente le glisser-déposer et le redimensionnement interactifs avec mise à jour immédiate en base de données. L'algorithme de chemin critique (CPM - Critical Path Method) colore les tâches critiques en rouge/corail.
* **Tableau Agile et Kanban** : Prise en charge des sprints et du calcul de vélocité.
* **Time-Tracking et Notes** : Prise en charge du minuteur Pomodoro lié aux logs de temps et synchronisation bidirectionnelle du statut des tâches à l'intérieur des notes markdown collaboratives.
* **Copilote IA** : Présence d'un widget de streaming audio temps réel via WebSockets et d'une barre de commande IA pour l'exécution d'actions groupées.

---

## 🧪 3. Qualité Logicielle & Couverture de Tests

* **Architecture des Tests** : Les scripts de tests rudimentaires ont été éliminés de l'arborescence des sources. Les tests sont désormais organisés sous [backend/tests/](file:///home/gaetan/Documents/GitHub/planner-pro/backend/tests) (unitaires et d'intégration).
* **Fiabilité** : La suite de tests Jest est stable et validée à 100% (18 suites de tests, 116 tests passants). Elle couvre :
  * La logique complexe de planification proactive (`proactive-scheduler.service.ts`).
  * La détection de dépendances cycliques dans le Gantt.
  * La synchronisation des notes et le service d'emails (`MailService`).
  * Le chiffrement et déchiffrement symétrique fort (`AES-256-GCM`) pour les intégrations tierces.

---

## 🌐 4. Infrastructure & DevOps

* **Conteneurisation** : L'environnement est orchestré via Docker-Compose. Les images de production et de développement utilisent des bases Node légères sur Alpine.
* **Cache et Temps Réel** : Redis est configuré pour soulager les lectures de base de données (notamment sur le bloc-notes).

---

## 🚀 5. Roadmap & Chantiers Prioritaires (Roadmap Résiduelle)

1. **Lot A : Permissions Granulaires & RBAC (P0)**
   * Implémenter le rôle `COMMENTER` (lecture + commentaire uniquement) et le rôle `CLIENT` (lecture seule sur un périmètre restreint).
   * Mettre en place un journal d'audit (`AuditLog`) pour l'historique des modifications de sécurité et d'entités.
2. **Lot B : Synchronisation Calendar Avancée (P1)**
   * Finaliser les flux OAuth2 pour Google Calendar et Outlook.
   * Chiffrer de manière symétrique forte (`AES-256-GCM`) les jetons stockés dans la base de données.
3. **Lot F : Finances & Portefeuille Consolidés (P3)**
   * Implémenter les rapports de performance financière cumulés (burn rate, projections) et la vue de portefeuille multi-projets.
4. **Durcissement Technique (Sécurité & Performance)**
   * Retirer le fallback par défaut de `JWT_SECRET` dans `auth.module.ts` pour imposer une exception fatale (Fail-Fast) en cas d'absence de configuration d'environnement.
   * Configurer l'adaptateur Redis de Socket.io (`@socket.io/redis-adapter`) pour assurer la communication temps réel en cas de déploiement multi-instances du backend.
