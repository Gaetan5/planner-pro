FROM node:18-alpine

# Activer pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copier les fichiers de dépendances
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Installer les dépendances
RUN pnpm install --frozen-lockfile

# Copier le reste du code source
COPY . .

# Générer le client Prisma
RUN pnpm exec prisma generate

# Compiler l'application NestJS
RUN pnpm run build

EXPOSE 3001

# Lancer l'attente de MySQL, la synchronisation Prisma puis démarrer l'application
CMD node wait-for-db.js && pnpm exec prisma migrate deploy && node dist/main
