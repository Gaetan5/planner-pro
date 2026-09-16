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

# Installer les dépendances à partir du lockfile pour produire une image reproductible
RUN pnpm install --filter backend... --frozen-lockfile

# Copier uniquement les sources nécessaires au backend
COPY --chown=node:node backend ./backend

# Se positionner dans le dossier backend pour les étapes suivantes
WORKDIR /home/node/app/backend

# Générer le client Prisma et compiler le backend dans l'image
RUN pnpm exec prisma generate
RUN pnpm --filter backend build

EXPOSE 3001

# Synchroniser le schéma actuel puis démarrer. La migration historique ne couvre pas encore
# l'ensemble des modèles du schéma réparti.
CMD node wait-for-db.js && pnpm exec prisma db push && node dist/main




