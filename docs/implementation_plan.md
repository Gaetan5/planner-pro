# Plan d'implémentation - Sécurisation, Stabilisation & Durcissement (Planner-Pro)

Ce document décrit le plan d'action technique pour résoudre la dette technique et les vulnérabilités identifiées lors de l'audit technique de **Planner-Pro**.

---

## Revue Utilisateur Requise

> [!IMPORTANT]
> **Changements Structurels Majeurs :**
> 1. **Nettoyage du Frontend** : Suppression définitive de la double logique "offline/simulation" dans le frontend React. L'interface échouera si l'API est absente, garantissant une logique de code unique et robuste.
> 2. **Chiffrement des Jetons GitHub** : Les jetons d'accès OAuth seront chiffrés avec l'algorithme de grade militaire **AES-256-GCM** en base de données.
> 3. **Sécurisation des Routes (Authentification)** : Suppression du compte temporaire `'default-user-id'`. Toutes les requêtes devront obligatoirement passer par un Guard JWT validant la session utilisateur.

---

## Questions Ouvertes

> [!WARNING]
> 1. **Clé de chiffrement (Secret de chiffrement)** : Souhaitez-vous générer la clé de chiffrement des tokens à la volée au démarrage si elle est absente dans le `.env`, ou préférez-vous que le serveur refuse de démarrer s'il manque la clé `ENCRYPTION_KEY` ? (Recommandé : Fail-Fast si absente).
> 2. **Volume de développement local (Docker)** : Êtes-vous d'accord pour que l'on configure le montage de volumes dans le docker-compose pour le développement ? (Cela nécessite que le dossier `node_modules` local ne rentre pas en conflit avec celui du conteneur).

---

## Modifications Proposées par Composant

### 1. Composant Infrastructure & Docker
#### [MODIFY] [docker-compose.yml](file:///home/gaetan/Documents/GitHub/planner-pro/docker-compose.yml)
- Ajout de la configuration de volumes locaux pour le HMR (Hot Module Replacement) :
  - Montage de `./frontend:/app` pour recharger automatiquement le code frontend.
  - Montage de `./backend:/app` pour recharger le code backend NestJS.
- Ajout d'une clé de chiffrement `ENCRYPTION_KEY` dans les variables du backend.

#### [MODIFY] [backend/Dockerfile](file:///home/gaetan/Documents/GitHub/planner-pro/backend/Dockerfile)
- Ajout d'un script ou d'un check de boucle Node pour attendre que MySQL réponde sur le port `3306` avant de lancer Prisma.
  - Commande de démarrage modifiée pour exécuter un script de type "wait-for-it".

---

### 2. Composant Sécurité Backend (NestJS)
#### [NEW] [backend/src/auth/encryption.util.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/encryption.util.ts)
- Utilitaire utilisant le module natif de Node `crypto` :
  - `encrypt(text: string): string` (renvoie l'IV + le texte chiffré + le tag d'authentification).
  - `decrypt(cipherText: string): string` (déchiffre et valide le tag).

#### [MODIFY] [backend/src/auth/auth.service.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/auth.service.ts)
- Chiffrement du `githubAccessToken` avant l'écriture en base via `upsert`.
- Déchiffrement du token uniquement lors de l'appel pour lister les dépôts GitHub de l'utilisateur.

#### [NEW] [backend/src/auth/jwt.guard.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/jwt.guard.ts)
- Guard d'authentification extrait du payload du token JWT pour renseigner l'utilisateur connecté sur la requête.

#### [MODIFY] [backend/src/projects/projects.controller.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.controller.ts)
#### [MODIFY] [backend/src/tracking/tracking.controller.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/tracking/tracking.controller.ts)
#### [MODIFY] [backend/src/notes/notes.controller.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/notes/notes.controller.ts)
- Ajout du décorateur `@UseGuards(JwtAuthGuard)` sur les contrôleurs.
- Remplacement de `default-user-id` par l'ID réel extrait de la requête (`req.user.id`).

---

### 3. Composant Frontend (React)
#### [MODIFY] [frontend/src/context/AppContext.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/context/AppContext.tsx)
- Suppression définitive des variables d'états de simulation locale (`localProjects`, `localTasks`, `localNotes`, etc.).
- Suppression des branches logiques d'écriture locale. Tout appel passe par `fetch` avec le header d'authentification `Authorization: Bearer <token>`.

---

## Plan de Vérification

### Tests Automatisés
- Lancement de `docker-compose up --build` :
  - Vérifier que le backend attend bien MySQL et ne plante pas au démarrage.
  - Vérifier que Prisma applique les tables avec succès.

### Validation Manuelle
- Tenter d'effectuer une requête sur `/projects` sans token JWT et valider le retour `401 Unauthorized`.
- Connecter un compte de test, vérifier que le token d'accès GitHub est illisible (chiffré) directement dans la base de données MySQL.
