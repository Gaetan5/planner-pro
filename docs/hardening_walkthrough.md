# Walkthrough - Phase de Sécurisation et Stabilisation (Hardening)

Ce document résume les modifications apportées pour corriger la dette technique, stabiliser l'infrastructure sous Docker, et sécuriser les communications et la persistance des données.

---

## 🛠️ Ce qui a été réalisé

### 1. Stabilisation de l'Infrastructure Docker
- **[wait-for-db.js](file:///home/gaetan/Documents/GitHub/planner-pro/backend/wait-for-db.js)** : Script Node.js léger qui teste la connexion au port 3306 de la base de données. Il bloque l'exécution du conteneur backend NestJS tant que MySQL n'est pas prêt à recevoir des requêtes.
- **[Dockerfile Backend](file:///home/gaetan/Documents/GitHub/planner-pro/backend/Dockerfile)** : Intégration du script d'attente au point d'entrée (`CMD node wait-for-db.js && npx prisma db push && node dist/main`).
- **[docker-compose.yml](file:///home/gaetan/Documents/GitHub/planner-pro/docker-compose.yml)** :
  - Configuration du montage de volumes locaux (`./frontend` et `./backend`) avec isolation des répertoires `node_modules` pour supporter le rechargement à chaud (HMR) en développement.
  - Déclaration de la variable d'environnement `ENCRYPTION_KEY` de 32 octets pour le chiffrement des tokens GitHub.

### 2. Chiffrement des Secrets Utilisateurs (GitHub Access Tokens)
- **[encryption.util.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/encryption.util.ts)** : Classe utilitaire de chiffrement symétrique **AES-256-GCM** (grade militaire) avec génération d'IV dynamiques et validation d'authenticité (tags GCM). Cette classe applique une logique *Fail-Fast* si `ENCRYPTION_KEY` est invalide ou manquante.
- **[auth.service.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/auth.service.ts)** : Chiffrement automatique du jeton d'accès GitHub avant l'écriture en base via `upsert`. Déchiffrement à la volée uniquement lors de la récupération des dépôts de l'utilisateur.

### 3. Sécurisation de l'API REST (Authentification JWT)
- **[jwt.guard.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/jwt.guard.ts)** : Guard NestJS qui extrait, décode, et valide le token JWT dans l'en-tête `Authorization: Bearer <token>`. Il injecte l'identité de l'utilisateur (`sub`, `email`, `name`) directement dans l'objet de requête `req.user`.
- **Contrôleurs Sécurisés** :
  - **[projects.controller.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/projects.controller.ts)**
  - **[tracking.controller.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/tracking/tracking.controller.ts)**
  - **[notes.controller.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/notes/notes.controller.ts)**
  - Application du décorateur `@UseGuards(JwtAuthGuard)` sur l'ensemble de ces contrôleurs.
  - Remplacement définitif du compte par défaut `default-user-id` par l'identité dynamique extraite de la session (`req.user.id`).

### 4. Nettoyage du Frontend & En-têtes JWT
- **[AppContext.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/context/AppContext.tsx)** :
  - Suppression de l'intégralité du code de simulation locale et des fausses données en mémoire.
  - Ajout des en-têtes d'autorisation JWT `Authorization: Bearer <token>` sur l'ensemble des requêtes `fetch`.
  - Liaison des identifiants JWT dans le handshake de connexion WebSocket (Socket.io) pour sécuriser le chronomètre.
- **[App.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/App.tsx)** : Remplacement de l'indicateur d'état offline par une alerte rouge "Serveur Déconnecté" si l'API backend ne répond plus, maintenant que la double logique de simulation a été purgée.

---

## 🚀 Lancement du Projet Sécurisé

À présent, pour lancer toute la stack en mode sécurisé et avec MySQL/Redis pleinement opérationnels :

```bash
# À la racine du projet
docker-compose up --build
```
*Le backend attendra automatiquement l'initialisation complète de MySQL, appliquera le schéma Prisma, et le frontend se rechargera en direct lors de vos modifications.*
