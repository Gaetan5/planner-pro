FROM node:18-alpine

# Installer les dépendances système pour Prisma (openssl et libc6-compat pour Alpine)
RUN apk add --no-cache openssl libc6-compat

# Activer pnpm via corepack
RUN corepack enable

# Créer le répertoire de travail et lui attribuer les droits node
RUN mkdir -p /home/node/app && chown -R node:node /home/node/app

WORKDIR /home/node/app

USER node

# Copier les fichiers de configuration du monorepo pnpm à la racine avec les droits node
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copier les package.json de tous les packages pour la résolution des dépendances pnpm
COPY --chown=node:node backend/package.json ./backend/
COPY --chown=node:node frontend/package.json ./frontend/

# Installer les dépendances du monorepo filtrées pour le backend
RUN pnpm install --filter backend... --frozen-lockfile

# Copier le reste des fichiers du backend
COPY --chown=node:node backend ./backend/

# Se positionner dans le dossier backend pour les étapes suivantes
WORKDIR /home/node/app/backend

# Générer le client Prisma
RUN pnpm exec prisma generate

# Compiler l'application NestJS
RUN pnpm run build

EXPOSE 3001

# Lancer l'attente de MySQL, la génération de Prisma, la synchronisation Prisma puis démarrer l'application
CMD node wait-for-db.js && pnpm exec prisma generate && pnpm exec prisma migrate deploy && node dist/main



