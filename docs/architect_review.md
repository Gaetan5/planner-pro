# Revue d'Architecture Logicielle & Audit Technique - Planner-Pro

**Auteur** : Architecte Logiciel Senior & Expert DevOps  
**Date** : 23 mai 2026  
**Statut** : Complété (Revue de conception de la phase d'initialisation)

---

## 1. Vue d'Ensemble & Alignement Métier
Le projet **Planner-Pro** est conçu comme un monorepo orchestré avec Docker-Compose, séparant clairement les responsabilités :
- Un frontend React léger et réactif, typé en TypeScript.
- Un backend NestJS robuste, utilisant Prisma pour l'ORM, intégrant Redis pour le cache et WebSockets (Socket.io) pour la communication temps réel.

D'un point de vue fonctionnel, l'intégration des 4 piliers (Kanban, Calendrier, Time-tracking, Bloc-notes) est cohérente. La décision d'inclure des automatisations comme l'auto-parsing Markdown et l'auto-stop des minuteurs témoigne d'une excellente sensibilité UX/UI.

---

## 2. Analyse de l'Architecture & DevOps (Docker / Composabilité)

### Points Forts (Strengths)
- **Monorepo Propre** : L'utilisation de Workspaces NPM facilite la gestion des dépendances partagées et l'unification des builds.
- **Orchestration Standardisée** : Le fichier `docker-compose.yml` isole parfaitement les couches de persistance (MySQL), de cache (Redis), de logique métier (NestJS) et de présentation (React).
- **Dockerfiles Optimisés** : Les conteneurs utilisent des bases Alpine légères. La commande de démarrage du backend (`npx prisma db push && node dist/main`) garantit que le schéma de base de données MySQL est synchronisé de manière transparente au lancement local.

### Risques & Compromis (Trade-offs / Risks)
- **Base de données éphémère si non configurée** : Le volume MySQL `mysql_data` est déclaré, ce qui préserve les données en local. C'est parfait pour le développement.
- **Vite en mode dev sous Docker** : Monter le code source local comme volume (non implémenté actuellement dans le compose) permettrait le Hot Module Replacement (HMR) depuis le conteneur. En l'état, modifier le code du frontend nécessite de reconstruire l'image (`docker-compose up --build`).
  - *Recommandation* : Ajouter des volumes de montage (`volumes: - ./frontend:/app - /app/node_modules`) dans le compose pour le développement local afin de bénéficier du HMR.

---

## 3. Audit de la Base de Données (Prisma + MySQL)

### Points Forts
- Le modèle relationnel est propre. Les cascades de suppression (comme supprimer les tâches d'un projet avant de supprimer le projet lui-même dans `projects.service`) sont bien gérées côté service.

### Optimisations de Performance Requises (Scalabilité)
Dans [schema.prisma](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma) :
1. **Indexation des Clés Étrangères** : MySQL n'indexe pas toujours automatiquement toutes les clés étrangères selon les moteurs de stockage. Pour accélérer les jointures fréquentes (ex: récupérer les tâches d'un projet, ou les logs d'une tâche), il est recommandé d'ajouter des index explicites avec `@@index` sur les champs `projectId`, `userId` et `taskId` dans Prisma :
   ```prisma
   model Task {
     // ...
     @@index([projectId])
     @@index([userId])
   }
   ```
2. **Taille des UUID** : Utiliser des UUID (`@id @default(uuid())`) est excellent pour la distribution et la sécurité (évite l'énumération de ressources). En revanche, sur MySQL, un UUID stocké en tant que string (`VARCHAR(191)` par défaut dans Prisma) prend 191 caractères au lieu de 36 nécessaires (ou 16 octets au format binaire). 
  - *Recommandation* : Configurer explicitement la taille des champs UUID avec `@db.VarChar(36)` pour économiser l'espace disque et accélérer les index.

---

## 4. Cache & Performance (Redis)

### Points Forts
- L'implémentation du pattern **Cache-Aside** dans `NotesService` est correcte : le cache est lu en priorité et écrit/invalidé lors des mutations (create, update, delete). Le TTL de 300s évite la stagnation des données obsolètes.

### Risques de Concurrence & Invalidation
- **Invalidation globale brute** : Supprimer l'intégralité de la clé `notes:${userId}` force un re-fetch complet de la liste des notes lors de la prochaine lecture. Si l'utilisateur a des centaines de notes, cela peut créer un pic de charge (phénomène de *Cache Stampede*).
  - *Recommandation* : Pour un système à grande échelle, utiliser des clés par note individuelle (`note:${noteId}`) en plus de la liste, ou utiliser des structures Redis plus avancées (comme les Hashes) pour ne mettre à jour que la note modifiée.

---

## 5. Sécurité (SSO GitHub & JWT)

### Points Forts
- L'authentification utilise un flux d'autorisation OAuth 2.0 sécurisé : l'échange du code contre le token d'accès s'effectue exclusivement côté serveur (backend), évitant ainsi d'exposer le `client_secret` de l'application dans le navigateur.

### Vulnérabilités Potentielles & Durcissement (Hardening)
1. **Secrets en Dur dans le Code** : 
   - Le code du frontend ([Login.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/Login.tsx)) contient la chaîne `"votre_client_id_github"`. Bien que le `Client ID` soit public par nature, il est préférable de le charger via des variables d'environnement (`import.meta.env.VITE_GITHUB_CLIENT_ID`) pour faciliter les déploiements multi-environnements (staging, production).
2. **Fallback JWT trop permissif** :
   - Dans [auth.module.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/auth.module.ts), la clé secrète JWT a un repli par défaut : `process.env.JWT_SECRET || 'planner-pro-super-secret-key'`. En production, si la variable d'environnement n'est pas chargée par erreur, le serveur utilisera cette clé publique, permettant à quiconque de forger des jetons d'accès.
   - *Recommandation* : Retirer le fallback. Si `process.env.JWT_SECRET` est absent, le serveur doit lever une exception fatale et refuser de démarrer (Fail-Fast).

---

## 6. Temps Réel & Passage à l'Échelle (WebSockets)

### Points Forts
- L'utilisation de Socket.io facilite la gestion des reconnexions et des fallback de transport. La Gateway [tracking.gateway.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/tracking/tracking.gateway.ts) gère proprement la diffusion des événements.

### Problématique de Scalabilité Horizontale
- Actuellement, l'instance Socket.io stocke les connexions et l'état des clients en mémoire locale. Si vous déployez demain plusieurs instances de votre backend derrière un répartiteur de charge (Load Balancer), un client connecté sur le serveur A ne recevra pas les événements émis sur le serveur B.
  - *Recommandation* : Puisque Redis est déjà présent dans notre architecture, il suffit d'intégrer l'adaptateur Redis de Socket.io (`@socket.io/redis-adapter`). Cela permettra de diffuser les événements (comme `timer-started`) sur toutes les instances de backend de manière transparente.

---

## 🏆 Synthèse de l'Audit

| Module | Évaluation | Note / Recommandation Principale |
| :--- | :--- | :--- |
| **DevOps / Docker** | 🟢 Excellent | Ajouter les volumes locaux dans compose pour le HMR frontend. |
| **Base de données** | 🟡 Bon | Ajouter des index explicites (`@@index`) sur les relations Prisma. |
| **Caching Redis** | 🟢 Excellent | Pattern Cache-Aside bien implémenté, à affiner si le volume de notes grandit. |
| **Sécurité Auth** | 🟡 Correct | Supprimer le fallback de clé JWT secrète pour forcer le Fail-Fast. |
| **WebSockets** | 🟢 Excellent | Configurer l'adaptateur Redis de Socket.io pour la production. |
