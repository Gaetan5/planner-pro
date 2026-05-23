FROM node:18-alpine

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Copier le reste du code source
COPY . .

EXPOSE 3000

# Démarrer le serveur de dev Vite sur le port 3000 en écoutant toutes les interfaces réseau
CMD npx vite --host 0.0.0.0 --port 3000
