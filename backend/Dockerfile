FROM node:20-alpine

# Installer les dépendances système pour Prisma (openssl et libc6-compat pour Alpine)
RUN apk add --no-cache openssl libc6-compat

# Installer pnpm globalement
RUN npm install -g pnpm@9.15.4

# Créer le répertoire de travail et lui attribuer les droits node
RUN mkdir -p /home/node/app && chown -R node:node /home/node/app

WORKDIR /home/node/app

USER node

# Copier les fichiers de configuration du monorepo pnpm à la racine avec les droits node
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copier les package.json de tous les packages pour la résolution des dépendances pnpm
COPY --chown=node:node backend/package.json ./backend/
COPY --chown=node:node frontend/package.json ./frontend/

# Copier les dossiers node_modules déjà installés et le build du backend depuis l'hôte
COPY --chown=node:node node_modules ./node_modules
COPY --chown=node:node backend/node_modules ./backend/node_modules
COPY --chown=node:node backend/dist ./backend/dist
COPY --chown=node:node backend/prisma ./backend/prisma
COPY --chown=node:node backend/wait-for-db.js ./backend/wait-for-db.js
COPY --chown=node:node backend/prisma.config.ts ./backend/prisma.config.ts

# Se positionner dans le dossier backend pour les étapes suivantes
WORKDIR /home/node/app/backend

# Régénérer le client Prisma pour garantir la compatibilité binaire musl
RUN pnpm exec prisma generate

EXPOSE 3001

# Lancer l'attente de MySQL, s'assurer que les tables sont poussées puis démarrer
CMD node wait-for-db.js && pnpm exec prisma db push && node dist/main




