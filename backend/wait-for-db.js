const net = require('net');

// Extraire l'hôte de DATABASE_URL ou utiliser 'db' par défaut
let host = 'db';
if (process.env.DATABASE_URL) {
  try {
    // Remplacer mysql:// par http:// pour pouvoir utiliser le constructeur URL natif
    const url = new URL(process.env.DATABASE_URL.replace('mysql://', 'http://'));
    host = url.hostname;
  } catch (e) {
    console.warn('Impossible de parser DATABASE_URL, repli sur host "db"');
  }
}

const port = 3306;
let retries = 30; // 30 tentatives (environ 60 secondes maximum)

function checkConnection() {
  const client = net.createConnection({ host, port }, () => {
    console.log('MySQL est prêt et accepte les connexions !');
    client.end();
    process.exit(0);
  });

  client.on('error', () => {
    retries--;
    if (retries === 0) {
      console.error('MySQL n\'a pas démarré à temps. Abandon.');
      process.exit(1);
    }
    console.log(`En attente du démarrage de MySQL... (${retries} tentatives restantes)`);
    setTimeout(checkConnection, 2000);
  });
}

checkConnection();
