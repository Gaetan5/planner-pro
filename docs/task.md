# Liste des Tâches - Planner-Pro

Voici la feuille de route technique pour le développement complet de l'application.

- `[x]` Initialiser la structure du monorepo (frontend, backend, package.json racine)
- `[x]` Basculer de SQLite à MySQL (Prisma schema MySQL)
- `[x]` Intégrer Redis pour le caching (Redis Service & Module dans NestJS)
- `[x]` Dockeriser l'application (Dockerfiles pour backend/frontend & docker-compose.yml)
- `[x]` Intégrer Prisma ORM dans le backend NestJS (Prisma Service & Module)
- `[x]` Développer le module **Authentification & SSO GitHub** :
  - `[x]` Backend : Intégration JWT et API OAuth GitHub (SSO)
  - `[x]` Backend : API de récupération des dépôts et de liaison aux projets
  - `[x]` Frontend : Formulaire de connexion simplifié et synchronisation GitHub
- `[x]` Développer le module **Projets & Tâches** :
  - `[x]` Backend : Entités, Services et API REST (Création, Lecture, Modification, Suppression)
  - `[x]` Frontend : Intégration du tableau Kanban et affichage dynamique des tâches
- `[x]` Développer le module **Time-Tracking** (Temps Réel) :
  - `[x]` Backend : Gateway Socket.io pour la synchronisation du chronomètre
  - `[x]` Backend : API d'enregistrement des logs de temps en base de données
  - `[x]` Frontend : Liaison du chronomètre avec le backend (enregistrement et synchronisation)
- `[x]` Développer le module **Calendrier & Time-Blocking** :
  - `[x]` Backend : API pour l'allocation de tâches sur des créneaux horaires
  - `[x]` Frontend : Calendrier interactif avec glisser-déposer (Drag-and-Drop)
- `[x]` Développer le module **Bloc-notes Intelligent** :
  - `[x]` Backend : API de sauvegarde des notes et moteur d'auto-parsing de texte vers des tâches
  - `[x]` Frontend : Éditeur Markdown et système de notifications en temps réel
