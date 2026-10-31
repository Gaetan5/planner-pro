const net = require('net');
const fs = require('fs');
const mariadb = require('mariadb');

// Mêmes règles que PrismaService (audit S4) : TLS obligatoire en production, clé publique
// épinglée si DATABASE_RSA_PUBLIC_KEY, récupération de clé seulement en développement/test sans TLS.
const isLocalEnvironment = ['development', 'test'].includes(process.env.NODE_ENV || '');
const sslEnabled = process.env.DATABASE_SSL === 'true';
if (process.env.NODE_ENV === 'production' && !sslEnabled) {
  console.error('DATABASE_SSL=true est obligatoire en production (audit S4).');
  process.exit(1);
}
const pinnedPublicKey = process.env.DATABASE_RSA_PUBLIC_KEY
  ? fs.readFileSync(process.env.DATABASE_RSA_PUBLIC_KEY, 'utf8')
  : undefined;
const securityOptions = {
  allowPublicKeyRetrieval: isLocalEnvironment && !sslEnabled && !pinnedPublicKey,
  ...(sslEnabled
    ? {
        ssl: {
          rejectUnauthorized: true,
          ...(process.env.DATABASE_SSL_CA
            ? { ca: fs.readFileSync(process.env.DATABASE_SSL_CA, 'utf8') }
            : {}),
        },
      }
    : {}),
  ...(pinnedPublicKey ? { cachingRsaPublicKey: pinnedPublicKey } : {}),
};

// Extraire l'hôte de DATABASE_URL ou utiliser 'db' par défaut
let host = 'db';
if (process.env.DATABASE_URL) {
  try {
    // Remplacer mysql:// par http:// pour pouvoir utiliser le constructeur URL natif
    const url = new URL(process.env.DATABASE_URL.replace('mysql://', 'http://'));
    host = url.hostname;
  } catch {
    console.warn('Impossible de parser DATABASE_URL, repli sur host "db"');
  }
}

const port = 3306;
let credentials = { user: undefined, password: undefined, database: undefined };
try {
  const url = new URL((process.env.DATABASE_URL || '').replace('mysql://', 'http://'));
  credentials = {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
} catch {
  console.warn('Impossible de parser les identifiants DATABASE_URL.');
}
let retries = 30; // 30 tentatives (environ 60 secondes maximum)

function checkConnection() {
  const client = net.createConnection({ host, port }, () => {
    client.end();
    verifyDatabase();
  });

  const onError = () => {
    client.off('error', onError);
    client.destroy();
    retries--;
    if (retries === 0) {
      console.error("MySQL n'a pas démarré à temps. Abandon.");
      process.exit(1);
    }
    console.log(`En attente du démarrage de MySQL... (${retries} tentatives restantes)`);
    setTimeout(checkConnection, 2000);
  };

  client.on('error', onError);
}

async function verifyDatabase() {
  let connection;
  try {
    connection = await mariadb.createConnection({
      host,
      port,
      ...credentials,
      ...securityOptions,
      connectTimeout: 3000,
    });
    await connection.query('SELECT 1');
    console.log('MySQL est prêt et accepte les connexions !');
    await connection.end();
    process.exit(0);
  } catch {
    if (connection) await connection.end().catch(() => undefined);
    retries--;
    if (retries === 0) {
      console.error("MySQL n'a pas démarré à temps. Abandon.");
      process.exit(1);
    }
    console.log(`MySQL est joignable mais pas encore prêt... (${retries} tentatives restantes)`);
    setTimeout(checkConnection, 2000);
  }
}

checkConnection();
