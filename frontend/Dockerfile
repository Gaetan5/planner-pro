FROM node:20-alpine

# Installer pnpm globalement
RUN npm install -g pnpm@9.15.4

# Créer le répertoire de travail et lui attribuer les droits node
RUN mkdir -p /home/node/app && chown -R node:node /home/node/app

WORKDIR /home/node/app

USER node

# Copier les fichiers de configuration du monorepo pnpm à la racine avec les droits node
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copier les package.json de tous les packages pour la résolution des dépendances pnpm
COPY --chown=node:node frontend/package.json ./frontend/
COPY --chown=node:node backend/package.json ./backend/

# Copier les dossiers node_modules déjà installés et le code du frontend depuis l'hôte
COPY --chown=node:node node_modules ./node_modules
COPY --chown=node:node frontend/node_modules ./frontend/node_modules
COPY --chown=node:node frontend ./frontend/

# Se positionner dans le dossier frontend pour les étapes suivantes
WORKDIR /home/node/app/frontend

EXPOSE 3000

# Démarrer le serveur de dev Vite sur le port 3000 en écoutant toutes les interfaces réseau
CMD pnpm exec vite --host 0.0.0.0 --port 3000




