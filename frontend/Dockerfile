FROM node:18-alpine

# Activer pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copier les fichiers de dépendances
COPY package.json pnpm-lock.yaml ./

# Installer les dépendances
RUN pnpm install --frozen-lockfile

# Copier le reste du code source
COPY . .

EXPOSE 3000

# Démarrer le serveur de dev Vite sur le port 3000 en écoutant toutes les interfaces réseau
CMD pnpm exec vite --host 0.0.0.0 --port 3000
