FROM node:18-alpine

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./
COPY prisma ./prisma/

# Installer les dépendances
RUN npm install

# Copier le reste du code source
COPY . .

# Générer le client Prisma
RUN npx prisma generate

# Compiler l'application NestJS
RUN npm run build

EXPOSE 3001

# Lancer l'attente de MySQL, la synchronisation Prisma puis démarrer l'application
CMD node wait-for-db.js && npx prisma db push && node dist/main
