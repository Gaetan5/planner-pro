# Walkthrough - Initialisation de Planner-Pro

Ce document décrit le travail accompli pour poser toutes les bases techniques et architecturales de **Planner-Pro**.

---

## 🛠️ Ce qui a été réalisé

### 1. Structure Monorepo
- **[package.json (Racine)](file:///home/gaetan/Documents/GitHub/planner-pro/package.json)** : Configuration des Workspaces pnpm (`frontend` et `backend`). Script global `dev` configuré avec `concurrently` (à installer lors du premier `pnpm install`).
- **[.gitignore](file:///home/gaetan/Documents/GitHub/planner-pro/.gitignore)** : Configuration des exclusions standards (bases de données locales, builds, modules, logs).

### 2. Frontend React + Vite
- **[package.json (Frontend)](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/package.json)** : Dépendances définies (React 18, Lucide React pour les icônes, Socket.io-client pour le temps réel).
- **[vite.config.ts](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/vite.config.ts)** & **[tsconfig.json](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/tsconfig.json)** : Configurations optimales avec port de dev à `3000`.
- **[index.html](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/index.html)** : Fichier HTML d'entrée avec favicone d'horloge emoji et titre de l'application.
- **[src/index.css](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/index.css)** : Charte graphique premium implémentée (thème sombre, variables HSL, design Glassmorphism, animations de pulsation et scrollbars stylisées).
- **[src/App.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/App.tsx)** : Tableau de bord immersif interactif avec :
  - Un en-tête moderne.
  - Un volet latéral de navigation des projets.
  - Un module de Time Tracking fonctionnel (démarrer/arrêter un chronomètre temps réel).
  - Des sections de Todo-list et de calendrier prêtes pour l'intégration.

### 3. Backend NestJS & Base de données
- **[package.json (Backend)](file:///home/gaetan/Documents/GitHub/planner-pro/backend/package.json)** : Dépendances NestJS, WebSockets et Prisma client.
- **[tsconfig.json](file:///home/gaetan/Documents/GitHub/planner-pro/backend/tsconfig.json)** & **[nest-cli.json](file:///home/gaetan/Documents/GitHub/planner-pro/backend/nest-cli.json)** : Configuration TypeScript et compilation NestJS.
- **[src/main.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/main.ts)** : Point d'entrée avec activation de CORS sur le port `3001`.
- **Modules de Base** : `app.module.ts`, `app.controller.ts`, `app.service.ts` configurés et fonctionnels.
- **[prisma/schema.prisma](file:///home/gaetan/Documents/GitHub/planner-pro/backend/prisma/schema.prisma)** : Schéma de base de données SQLite complet modélisant la vision produit (Utilisateurs, Projets, Tâches, Blocs de temps pour le calendrier, Logs de temps pour le chronomètre, et Bloc-notes).

### 4. Authentification & SSO GitHub (Mise en œuvre Expert)
- **[auth.service.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/auth.service.ts)** : Logique d'échange de code OAuth GitHub, enregistrement/mise à jour automatique de l'utilisateur, génération de JWT d'accès, récupération des dépôts et liaison à un projet.
- **[auth.controller.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/auth.controller.ts)** : Points d'accès REST `/auth/github/login`, `/auth/github/repos` et `/auth/github/sync`.
- **[auth.module.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/auth.module.ts)** : Déclaration et configuration de JWT et de ConfigModule.
- **[.env.example](file:///home/gaetan/Documents/GitHub/planner-pro/.env.example)** : Exemple de configuration pour la clé secrète JWT et les identifiants OAuth GitHub.

---

## 🚀 Prochaines étapes (Installation & Démarrage)

Pour lancer le projet localement :

1. **Installer les dépendances** :
   ```bash
   # À la racine du projet
   pnpm install
   ```
2. **Générer le client Prisma & Migrer la base** :
   ```bash
   # Dans le dossier backend/
   pnpm exec prisma migrate dev --name init
   ```
3. **Lancer les serveurs de développement** :
   ```bash
   # À la racine du projet (lance simultanément le frontend sur le port 3000 et le backend sur le port 3001)
   pnpm dev
   ```
