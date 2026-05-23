# ⚡ Planner Pro — Spécifications d'Ingénierie de Production & Guide du Monorepo

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript&logoColor=white)](#)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?style=for-the-badge&logo=react&logoColor=black)](#)
[![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](#)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](#)
[![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?style=for-the-badge&logo=mysql&logoColor=white)](#)
[![Redis](https://img.shields.io/badge/Redis-7.0-DC382D?style=for-the-badge&logo=redis&logoColor=white)](#)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](#)

> [!IMPORTANT]
> **Planner Pro** est une application fullstack monorepo de gestion du temps, des tâches (Kanban), du time-blocking (calendrier) et de prise de notes intelligentes. Ce document regroupe les spécifications issues des rôles d'**Architecte Logiciel Senior**, de **UX/UI Designer**, de **DevOps & DevSecOps Engineer**, ainsi que de **Product Owner / Scrum Master**.

---

## 🏗️ 1. Architecture Logicielle & Design Technique (Senior Architect Perspective)

### Modélisation C4 Container Diagram
Le système est modélisé selon l'architecture C4 Niveau 2 (Container Diagram) pour structurer clairement les interactions entre conteneurs de services.

```mermaid
graph TD
    User([Utilisateur Final])
    GitHub[GitHub OAuth Provider]

    subgraph ClientContainer [Conteneur Client]
        Vite[Vite Dev Server / Static Assets]
        ReactApp[React SPA - TypeScript]
    end

    subgraph BackendContainer [Conteneur API & WebSocket]
        NestAPI[NestJS HTTP Server]
        WSHub[Socket.io WebSocket Gateway]
        PrismaClient[Prisma Client ORM]
    end

    subgraph StorageContainer [Stockage & Caching]
        RedisCache[(Redis 7.0 - Cache & Session)]
        MySQLDB[(MySQL 8.0 - Données Physiques)]
    end

    User -->|HTTPS| Vite
    User -->|Interagit avec| ReactApp
    ReactApp -->|Appels REST avec JWT| NestAPI
    ReactApp -->|WebSocket bidirectional| WSHub
    NestAPI -->|Redirection OAuth| GitHub
    NestAPI -->|Cache-Aside / Notes / 1h TTL| RedisCache
    NestAPI -->|Persistance SQL| PrismaClient
    WSHub -->|Logs d'activité temps réel| PrismaClient
    PrismaClient <-->|TCP Port 3306| MySQLDB
```

### Analyse des Compromis Techniques (Trade-off Analysis)

| Technologie | Solution Adoptée | Compromis Accepté | Rationale d'Architecture |
| :--- | :--- | :--- | :--- |
| **Backend Framework** | **NestJS** vs Express natif | Courbe d'apprentissage plus élevée | Typage strict par défaut, injection de dépendances robuste facilitant la testabilité et la modularité. |
| **ORM** | **Prisma** vs TypeORM / SQL brut | Moins performant pour l'écriture de requêtes de masse | Productivité accrue des développeurs, auto-génération de types TS à la volée, et outil de migration (`prisma migrate`) déterministe. |
| **Mise en cache** | **Redis** (Cache-Aside) | Problématique de cohérence éventuelle | Diminution drastique de la charge de lecture sur MySQL pour les notes fréquemment mises à jour (Invalidation immédiate sur chaque écriture/sauvegarde). |
| **Base de données** | **MySQL** vs SQLite | Complexité DevOps accrue (Docker/Volume) | SQLite bloque l'écriture concurrente. MySQL 8 permet des écritures/lectures massives et assure une scalabilité horizontale sereine. |

---

### Architecture Decision Records (ADR)

#### ADR-001 : Chiffrement AES-256-GCM des jetons tiers
* **Statut** : Accepté.
* **Contexte** : Les jetons OAuth GitHub des utilisateurs doivent être persistés dans MySQL pour permettre des requêtes futures aux API GitHub (SSO/liaisons de repo). Stocker ces tokens en clair représente un risque critique de sécurité en cas de vol de base de données.
* **Décision** : Implémentation d'une couche d'encapsulation cryptographique symétrique utilisant **AES-256-GCM** (Galois/Counter Mode). Chaque jeton est chiffré à l'aide d'une clé secrète de 32 octets (`ENCRYPTION_KEY`), produisant un vecteur d'initialisation unique (IV) de 12 octets et un tag d'authentification de 16 octets.
* **Conséquences** : Protection robuste contre la falsification de secrets. L'absence de tag ou d'IV conforme invalide immédiatement le jeton lors du déchiffrement. Une clé invalide de 32 octets déclenche un arrêt propre et immédiat du backend au démarrage (Fail-Fast).

#### ADR-002 : Script de Résilience au Boot (wait-for-db)
* **Statut** : Accepté.
* **Contexte** : Dans un environnement multi-conteneurs Docker Compose, le conteneur MySQL démarre plus lentement que le backend NestJS, provoquant des erreurs de connexion fatales lors des migrations Prisma de démarrage.
* **Décision** : Développement d'un script Node léger à la racine du backend (`wait-for-db.js`) qui utilise le module `net` natif pour tester le port TCP `3306` en boucle toutes les 2 secondes. Le backend attend que ce port réponde avant de lancer `prisma db push` et de démarrer le serveur.
* **Conséquences** : Éradication totale des crashs liés à l'initialisation asynchrone des services de données.

---

## 🎨 2. Design System & Ergonomie UX (UX/UI Designer Perspective)

### Design Tokens (Variables CSS)
Notre design s'inscrit dans un style **Glassmorphism Premium** intégrant une hiérarchie visuelle sombre et contrastée.

```css
:root {
  /* Palette Chromatique */
  --bg-main: #0a0a0f;              /* Noir profond pour minimiser la fatigue visuelle */
  --glass-bg: rgba(18, 18, 26, 0.6); /* Transparence pour l'effet de verre dépoli */
  --glass-border: rgba(255, 255, 255, 0.08); /* Bordure subtile brillante */
  --primary: hsl(250, 85%, 65%);   /* Violet électrique pour l'action principale */
  --secondary: hsl(190, 90%, 50%); /* Turquoise réactif pour les micro-interactions */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  
  /* Flou d'Arrière-Plan (Glassmorphism) */
  --backdrop-blur: blur(16px) saturate(180%);

  /* Systèmes d'Espacement & Angles */
  --radius-lg: 16px;
  --radius-md: 10px;
  --transition-smooth: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}
```

### Directives d'Accessibilité (a11y) & Lois UX
1. **Loi de Hick (Surcharges cognitives évitées)** : Le tableau de bord n'affiche que les composants pertinents (Kanban global, calendrier quotidien, note active). L'utilisateur peut passer d'un module à l'autre sans changer de contexte mental.
2. **WCAG 2.1 AA Compliance** :
   - **Ratio de Contraste** : Le texte clair (`--text-primary`) sur fond sombre (`--bg-main` ou `--glass-bg`) garantit un ratio supérieur à 4.5:1.
   - **Cibles Tactiles** : Les boutons d'action et les éléments déplaçables du Kanban respectent une zone cible minimale de `44px x 44px`.
   - **Éléments interactifs** : Ajout systématique d'états de focus (`:focus-visible`) très nets en turquoise électrique (`--secondary`) pour la navigation au clavier.

---

## 🐳 3. Stratégie de Conteneurisation & DevOps (DevOps Perspective)

### Analyse des Dockerfiles de Production

#### Backend Dockerfile (`/backend/Dockerfile`)
```dockerfile
# Stage 1 : Build & Install deps
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 : Image d'Exécution Minimale
FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/wait-for-db.js ./
RUN npx prisma generate

# Sécurisation par défaut : Exécution en mode non-root
USER node
EXPOSE 3001
CMD ["node", "dist/main"]
```

#### Rationale DevOps :
- **Multi-Stage Build** : Réduction du poids final de l'image de 80% (pas d'outils de compilation TypeScript ni de dépendances de dev dans l'image finale).
- **Sécurité (Principle of Least Privilege)** : L'image finale s'exécute sous l'utilisateur natif `node` et non `root` pour éviter toute élévation de privilèges en cas d'exploitation de faille dans l'application.
- **Volume anonyme `/app/node_modules`** : Dans `docker-compose.yml`, cette directive isole les paquets compilés dans le conteneur Linux de ceux potentiellement présents sur l'hôte Windows/macOS/Linux afin d'éviter les incompatibilités binaires de packages natifs (comme Prisma ou bcrypt).

---

## 📊 4. Gestion de Produit Agile (Product Owner / Scrum Master)

### Roadmap & Périmètre Produit (Priorisation MoSCoW)

* **MUST HAVE** (Livré & Sécurisé) :
  * Gestion de projet avec colonnes Kanban dynamiques.
  * Prise de notes intelligente avec auto-parsing de tâches markdown.
  * Authentification unique SSO GitHub + Sécurisation des sessions par JWT.
  * Suivi du temps en temps réel synchronisé par sockets.
* **SHOULD HAVE** (Prochaines itérations prévues) :
  * Mode hors-ligne avec synchronisation automatique lors de la reconnexion (Service Workers).
  * Rappels de tâches par notification Web Push pour le calendrier.
* **COULD HAVE** (Fonctionnalités avancées bonus) :
  * Analyse sémantique des notes par IA (NLP) pour regrouper automatiquement les idées connexes.
  * Exportation des rapports de temps sous formats CSV et PDF pour la facturation client.

### Normes de Qualité d'Équipe (DoR & DoD)

#### Definition of Ready (DoR) - Pour qu'une tâche soit lancée :
- [ ] La spécification fonctionnelle ou la *User Story* comprend le contexte utilisateur.
- [ ] Les critères d'acceptation sont rédigés et univoques.
- [ ] Les dépendances techniques (ex: structures de base de données) sont prêtes ou mockées.

#### Definition of Done (DoD) - Pour qu'une tâche soit validée :
- [ ] Le code est compilé sans avertissements (TypeScript & Linters OK).
- [ ] Le schéma Prisma est migré et les tests d'intégration de base de données sont au vert.
- [ ] Les flux de chiffrement (tokens) et de routage (JWT) ont été validés par test.
- [ ] La documentation a été mise à jour (Fichiers API, README ou ADR si impact architectural).
- [ ] Les critères d'accessibilité (contraste, raccourcis claviers) sont respectés.

---

## 🚀 5. Procédure de Boot et d'Exploitation

### 📋 Prérequis Locaux
- **Docker Engine** >= 20.10.x et **Docker Compose** >= 2.x
- Ou **NodeJS** (v18.x) pour le développement hôte.

### 🔌 Initialisation de l'Environnement
1. Créez votre fichier d'environnement local :
   ```bash
   cp .env.example .env
   ```
2. Modifiez le `.env` pour y intégrer vos secrets GitHub OAuth (voir [Section GitHub OAuth](#sso-github)).

### 🐳 Démarrage Rapide (Tout-en-un Docker)
```bash
docker-compose up --build
```
Cette commande automatise l'installation, le démarrage de MySQL, l'attente active du serveur de base de données par le backend, la synchronisation du schéma Prisma, et le lancement du serveur React avec Hot-Reload.

### 🏃‍♂️ Démarrage en Mode Développement Local (Hôte)
Si vous développez localement avec un serveur de développement natif pour profiter de performances HMR accrues :

1. Installer l'ensemble du monorepo :
   ```bash
   npm install
   ```
2. Assurez-vous que vos instances MySQL et Redis locales sont actives, puis poussez le schéma de base de données :
   ```bash
   npm run db:push -w backend
   ```
3. Lancer les deux instances en mode Watch/Dev :
   ```bash
   npm run dev
   ```

---

## 🔗 <a id="sso-github"></a>6. Configuration Spécifique du Single Sign-On (SSO) GitHub

Afin de pouvoir connecter des utilisateurs avec leur compte GitHub, configurez les variables d'environnement OAuth :

1. Créez une application sur [GitHub Developer Settings](https://github.com/settings/developers).
2. Configurez les adresses suivantes :
   * **Homepage URL** : `http://localhost:3000`
   * **Authorization callback URL** : `http://localhost:3001/auth/github/callback`
3. Générez et renseignez le `CLIENT_ID` et `CLIENT_SECRET` dans votre fichier `.env` ou directement au niveau des variables d'environnement de votre conteneur Backend dans `docker-compose.yml`.
