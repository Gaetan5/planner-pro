# Implémentation des 15 Recommandations — Planner-Pro

Ce plan couvre l'ensemble des recommandations identifiées lors de l'état des lieux du 27 mai 2026, de la sécurité critique aux nouvelles fonctionnalités.

---

## Phase 1 — 🔴 Sécurité & Stabilité

---

### 1. Supprimer le fallback JWT secret

> [!CAUTION]
> Le `JwtAuthGuard` contient un fallback en dur `'planner-pro-super-secret-key-a-changer-en-production'`. Si la variable `JWT_SECRET` est absente en production, n'importe qui pourrait forger des tokens valides.

#### [MODIFY] [jwt.guard.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/jwt.guard.ts)

- **Ligne 24** : Supprimer `|| 'planner-pro-super-secret-key-a-changer-en-production'`
- Lancer une `Error` fatale si `process.env.JWT_SECRET` est absent, cohérent avec le pattern Fail-Fast déjà appliqué dans `auth.module.ts` et `encryption.util.ts`

```diff
- secret: process.env.JWT_SECRET || 'planner-pro-super-secret-key-a-changer-en-production',
+ secret: process.env.JWT_SECRET,
```

> [!NOTE]
> Le `auth.module.ts` implémente déjà le Fail-Fast sur `JWT_SECRET` au démarrage (lignes 14-20). Si le module démarre, la variable est forcément présente. On retire donc le fallback qui est un vestige inutile et dangereux.

---

### 2. Restreindre le CORS

> [!WARNING]
> `origin: '*'` sur le serveur HTTP **et** la Gateway WebSocket accepte les requêtes de n'importe quel domaine, exposant l'API aux attaques CSRF et cross-origin.

#### [MODIFY] [main.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/main.ts)

- Charger la liste des origines autorisées depuis la variable d'env `CORS_ORIGINS` (défaut `http://localhost:3000` pour le dev)
- Activer `credentials: true` pour supporter les cookies httpOnly futurs

```typescript
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');
app.enableCors({
  origin: allowedOrigins,
  credentials: true,
});
```

#### [MODIFY] [tracking.gateway.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/tracking/tracking.gateway.ts)

- Même logique pour la Gateway WebSocket :

```typescript
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
    credentials: true,
  },
})
```

#### [MODIFY] [.env.example](file:///home/gaetan/Documents/GitHub/planner-pro/.env.example) et [.env](file:///home/gaetan/Documents/GitHub/planner-pro/.env)

- Ajouter `CORS_ORIGINS=http://localhost:3000`

#### [MODIFY] [docker-compose.yml](file:///home/gaetan/Documents/GitHub/planner-pro/docker-compose.yml)

- Ajouter `CORS_ORIGINS: http://localhost:3000` dans les variables d'environnement du backend

---

### 3. Authentifier les WebSockets

> [!IMPORTANT]
> La Gateway utilise un `defaultUserId` hardcodé (`'default-user-id'`). Tous les clients partagent le même userId, ce qui est un problème de sécurité majeur et un bug fonctionnel (les timers d'un utilisateur sont visibles par tous).

#### [MODIFY] [tracking.gateway.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/tracking/tracking.gateway.ts)

- Supprimer `private readonly defaultUserId = 'default-user-id'`
- Injecter `JwtService` dans le constructeur
- Dans `handleConnection()` : extraire le JWT depuis `client.handshake.auth.token` ou `client.handshake.headers.authorization`, vérifier le token avec `jwtService.verifyAsync()`, stocker `userId` dans `client.data.userId`
- Déconnecter le client si le token est invalide
- Dans `handleStartTimer` et `handleStopTimer` : utiliser `client.data.userId` au lieu de `defaultUserId`
- Dans `handleRequestActiveTimer` : idem

#### [MODIFY] [auth.controller.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/auth/auth.controller.ts)

- Supprimer `private readonly defaultUserId = 'default-user-id'`
- Protéger les endpoints `github/repos` et `github/sync` avec `@UseGuards(JwtAuthGuard)` et utiliser `req.user.id`

---

### 4. Configurer le Throttler (Rate Limiting)

> [!NOTE]
> Le package `@nestjs/throttler` v5.1.2 est déjà installé en dépendance mais jamais configuré ni utilisé. Il suffit de l'activer dans `AppModule`.

#### [MODIFY] [app.module.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/app.module.ts)

- Importer `ThrottlerModule` et `ThrottlerGuard`
- Configurer avec un rate limit raisonnable (60 requêtes / 60 secondes par défaut)
- Appliquer globalement via `APP_GUARD`

```typescript
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    // ... autres imports
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    AppService,
  ],
})
```

#### [MODIFY] [tracking.gateway.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/tracking/tracking.gateway.ts)

- Ajouter `@SkipThrottle()` sur la Gateway WebSocket (le throttler ne s'applique pas aux connexions WS)

---

### 5. Externaliser les variables d'environnement frontend

> [!IMPORTANT]
> Le `BACKEND_URL` est hardcodé en `http://localhost:3001` et le `GITHUB_CLIENT_ID` est hardcodé en `votre_client_id_github`. Cela empêche tout déploiement multi-environnement.

#### [MODIFY] [AppContext.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/context/AppContext.tsx)

- **Ligne 67** : Remplacer `const BACKEND_URL = 'http://localhost:3001'` par :

```typescript
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
```

#### [MODIFY] [Login.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/Login.tsx)

- **Ligne 12** : Remplacer le `clientId` hardcodé par :

```typescript
const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID || ''
```

#### [NEW] [frontend/.env](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/.env)

```
VITE_API_URL=http://localhost:3001
VITE_GITHUB_CLIENT_ID=votre_client_id_github
```

#### [NEW] [frontend/.env.example](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/.env.example)

Même contenu avec des valeurs d'exemple.

#### [MODIFY] [.gitignore](file:///home/gaetan/Documents/GitHub/planner-pro/.gitignore)

- S'assurer que `.env` est ignoré (déjà le cas à la racine, mais le confirmer pour `frontend/.env` aussi)

---

## Phase 2 — 🟡 Qualité & Maintenabilité

---

### 6. Ajouter le pipeline CI/CD

#### [NEW] [.github/workflows/ci.yml](file:///home/gaetan/Documents/GitHub/planner-pro/.github/workflows/ci.yml)

Pipeline GitHub Actions avec :
- **Trigger** : push et PR sur `main`
- **Jobs** :
  1. `lint-and-build` : Install pnpm, `pnpm install`, `pnpm run build` (frontend + backend)
  2. `test-backend` : Service MySQL + Redis dans les services GitHub Actions, exécuter `pnpm --filter backend test`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root_password
          MYSQL_DATABASE: planner_pro_test
        ports: ['3306:3306']
        options: >-
          --health-cmd="mysqladmin ping -h localhost"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm --filter backend test
        env:
          DATABASE_URL: mysql://root:root_password@localhost:3306/planner_pro_test
          JWT_SECRET: ci-test-secret-key-32-chars-min!
          ENCRYPTION_KEY: ci-test-encryption-key-32-bytes!
          REDIS_HOST: localhost
          REDIS_PORT: 6379
```

---

### 7. Ajouter les healthchecks Docker

#### [MODIFY] [docker-compose.yml](file:///home/gaetan/Documents/GitHub/planner-pro/docker-compose.yml)

- Supprimer `version: '3.8'` (déprécié dans Docker Compose V2+)
- Ajouter `healthcheck` sur les services `db`, `cache` et `backend`
- Utiliser `depends_on.condition: service_healthy` au lieu du simple `depends_on`

```yaml
services:
  db:
    image: mysql:8.0
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    # ...

  cache:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    # ...

  backend:
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_healthy
    # ...
```

> [!TIP]
> Avec les healthchecks, le script `wait-for-db.js` devient redondant pour Docker Compose (mais reste utile si on lance le backend hors Docker). On le conserve comme filet de sécurité.

---

### 8. Supprimer la clé `version` dépréciée du docker-compose

Fait en même temps que le point 7 ci-dessus.

---

### 9. Mettre à jour les variables d'environnement du docker-compose

#### [MODIFY] [docker-compose.yml](file:///home/gaetan/Documents/GitHub/planner-pro/docker-compose.yml)

- Ajouter `CORS_ORIGINS` dans la section `environment` du service `backend`

#### [MODIFY] [.env.example](file:///home/gaetan/Documents/GitHub/planner-pro/.env.example)

- Ajouter `CORS_ORIGINS=http://localhost:3000`
- Ajouter `VITE_API_URL=http://localhost:3001`
- Ajouter `VITE_GITHUB_CLIENT_ID=votre_client_id_github`

---

### 10. Commiter l'état actuel

Après toutes les modifications, créer un commit propre avec un message descriptif :

```bash
git add -A
git commit -m "feat: implement security hardening, CI/CD, Docker healthchecks, and env externalization

- Remove JWT secret fallback (Fail-Fast pattern)
- Restrict CORS to allowed origins via CORS_ORIGINS env var
- Authenticate WebSocket connections with JWT
- Configure @nestjs/throttler rate limiting (60 req/min)
- Externalize BACKEND_URL and GITHUB_CLIENT_ID via Vite env vars
- Add GitHub Actions CI pipeline (build + test)
- Add Docker healthchecks and service_healthy dependencies
- Remove deprecated docker-compose version key
- Secure auth controller endpoints with JwtAuthGuard"
```

---

## Phase 3 — 🟢 Fonctionnalités & Évolutions

---

### 11. Mode Pomodoro

Ajout d'un timer Pomodoro immersif intégré au système de tracking existant.

#### [MODIFY] [AppContext.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/context/AppContext.tsx)

- Ajouter l'état Pomodoro : `pomodoroState` ('idle' | 'focus' | 'break'), `pomodoroTimeLeft`, `pomodoroSettings` (focusDuration: 25min, breakDuration: 5min)
- Fonctions : `startPomodoro(taskId)`, `pausePomodoro()`, `resetPomodoro()`, `skipBreak()`
- Le Pomodoro appelle `startTimer(taskId)` au début de la session focus et `stopTimer()` à la fin

#### [NEW] [PomodoroTimer.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/PomodoroTimer.tsx)

- Composant overlay/flottant avec :
  - Cercle de progression animé (SVG stroke-dasharray)
  - Affichage du temps restant (MM:SS)
  - Boutons Play/Pause/Reset/Skip
  - Indicateur visuel focus (violet) vs break (turquoise)
  - Nom de la tâche en cours
  - Mode plein écran optionnel avec assombrissement

#### [NEW] [PomodoroTimer.css](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/PomodoroTimer.css)

- Glassmorphism, animation de pulsation, cercle de progression SVG

#### [MODIFY] [App.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/App.tsx)

- Ajouter un onglet "Pomodoro" dans la navigation (desktop + mobile)
- Rendre le composant `PomodoroTimer` quand l'onglet est actif

---

### 12. Barre de commande Cmd+K

Barre de commande modale accessible globalement via `Cmd+K` / `Ctrl+K`.

#### [NEW] [CommandPalette.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/CommandPalette.tsx)

- Modale overlay avec champ de recherche
- Commandes disponibles :
  - `Créer une tâche` → ouvre le formulaire de création
  - `Créer un projet` → ouvre le formulaire
  - `Démarrer un timer sur [tâche]` → lance le tracking
  - `Nouvelle note` → ouvre le bloc-notes
  - `Aller au Dashboard / Kanban / Calendrier / Notes / Pomodoro` → navigation
- Recherche fuzzy sur les titres de tâches, projets et notes
- Navigation au clavier (↑↓ + Enter + Esc)

#### [NEW] [CommandPalette.css](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/CommandPalette.css)

- Design glassmorphism, animation slide-down, surlignage des résultats

#### [MODIFY] [App.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/App.tsx)

- Ajouter l'écouteur global `keydown` pour `Cmd+K` / `Ctrl+K`
- Rendre le composant `CommandPalette` conditionnellement

---

### 13. Adaptateur Redis pour Socket.io

Prépare la scalabilité horizontale du backend.

#### [MODIFY] [tracking.gateway.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/tracking/tracking.gateway.ts)

- Importer et configurer `@socket.io/redis-adapter` dans `afterInit()` :

```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

async afterInit(server: Server) {
  const pubClient = createClient({ url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}` });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  server.adapter(createAdapter(pubClient, subClient));
}
```

> [!IMPORTANT]
> Cela nécessite l'ajout des packages `@socket.io/redis-adapter` et `redis` aux dépendances backend. La lib `ioredis` est déjà utilisée par le `RedisService`, mais l'adaptateur Socket.io utilise la lib `redis` officielle (node-redis). Les deux peuvent coexister.

---

### 14. Mode clair (Theme Switcher)

#### [MODIFY] [index.css](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/index.css)

- Ajouter un bloc `[data-theme="light"]` avec les tokens inversés :
  - `--bg-primary: #f8f9fc`, `--bg-secondary: #ffffff`, etc.
  - `--glass-bg: rgba(255, 255, 255, 0.7)`, `--glass-border: rgba(0, 0, 0, 0.08)`
  - Textes sombres : `--text-primary: #1f2937`, `--text-secondary: #6b7280`

#### [MODIFY] [AppContext.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/context/AppContext.tsx)

- Ajouter l'état `theme: 'dark' | 'light'` (persister dans `localStorage`)
- Fonction `toggleTheme()` qui bascule `document.documentElement.dataset.theme`

#### [MODIFY] [App.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/App.tsx)

- Ajouter un bouton toggle Soleil/Lune dans le header (icônes `Sun` et `Moon` de lucide-react)

---

### 15. Notifications Web Push (base de travail)

> [!NOTE]
> L'implémentation complète des Web Push Notifications nécessite un serveur VAPID et un Service Worker. On pose les **bases fonctionnelles** ici avec les notifications in-app et le `Notification API` du navigateur.

#### [MODIFY] [AppContext.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/context/AppContext.tsx)

- Ajouter une fonction `requestNotificationPermission()` appelée au login
- Ajouter une fonction `scheduleReminder(taskId, dateTime)` qui utilise `setTimeout` + `new Notification(...)` pour les rappels en session

#### [MODIFY] [CalendarView.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/CalendarView.tsx)

- Lors de la création d'un time block, proposer d'activer un rappel 5 min avant (checkbox)
- Le rappel utilise la `Notification API` du navigateur

---

## Open Questions

> [!IMPORTANT]
> **Question 1** : Pour le Mode Pomodoro, faut-il le rendre accessible comme un **5ème onglet** de navigation (Dashboard / Kanban / Calendrier / Notes / **Pomodoro**), ou comme un **widget flottant** superposé à n'importe quel onglet actif ?

> [!IMPORTANT]
> **Question 2** : Pour la restriction CORS (point 2), souhaitez-vous une valeur par défaut en dev qui accepte `http://localhost:3000` uniquement, ou plusieurs origines séparées par virgule (ex: `http://localhost:3000,https://planner.example.com`) ?

> [!IMPORTANT]
> **Question 3** : Pour l'adaptateur Redis Socket.io (point 13), faut-il ajouter les dépendances `@socket.io/redis-adapter` et `redis` maintenant, ou reporter à une phase ultérieure de déploiement multi-instances ?

---

## Verification Plan

### Tests automatiques
- Exécuter `pnpm --filter backend test` — valider que les tests existants passent toujours
- Vérifier la compilation : `pnpm build` (frontend + backend)
- Tester le pipeline CI localement avec `act` ou en poussant sur une branche

### Vérification manuelle
- Lancer `docker compose up --build` et vérifier que les healthchecks passent
- Tester le login OAuth mock → vérifier la navigation entre onglets
- Tester la commande `Cmd+K` → vérifier la recherche et les actions
- Tester le Pomodoro : lancer un cycle focus de 25 min → vérifier le passage en break
- Tester le theme switcher : basculer dark↔light → vérifier tous les composants
- Vérifier que les WebSockets sont bien authentifiés (tenter une connexion sans token → refus)
