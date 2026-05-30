const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

async function runCopilotTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let tokenGaetan = '';
  let userIdGaetan = '';
  let workspaceId = '';

  // 1. Authentification de l'utilisateur mocké (Gaëtan)
  try {
    const loginRes = await fetch(`${BACKEND_URL}/auth/mock/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gaëtan' }),
    });
    const data = await loginRes.json();
    tokenGaetan = data.accessToken;
    userIdGaetan = data.user.id;

    console.log(`✅ Authentifié Gaëtan (ID: ${userIdGaetan})`);
  } catch (err) {
    console.error('❌ Erreur de connexion mock :', err.message);
    process.exit(1);
  }

  const headers = {
    'Authorization': `Bearer ${tokenGaetan}`,
  };

  // 2. Récupérer ou créer le workspace
  try {
    let workRes = await prisma.workspace.findFirst({
      where: { ownerId: userIdGaetan, deletedAt: null },
    });

    if (!workRes) {
      workRes = await prisma.workspace.create({
        data: {
          name: 'Workspace de Gaëtan',
          ownerId: userIdGaetan,
        },
      });
      await prisma.membership.create({
        data: {
          workspaceId: workRes.id,
          userId: userIdGaetan,
          role: 'OWNER',
        },
      });
    }
    workspaceId = workRes.id;
    console.log(`ℹ️ Workspace utilisé : "${workRes.name}" (ID: ${workspaceId})`);
  } catch (err) {
    console.error('❌ Erreur de configuration Prisma :', err.message);
    process.exit(1);
  }

  // 3. Test de récupération des alertes prédictives
  try {
    console.log('\n🧠 --- TEST DES ALERTES PRÉDICTIVES ---');
    const alertsRes = await fetch(`${BACKEND_URL}/projects/ai/copilot/alerts?workspaceId=${workspaceId}`, {
      method: 'GET',
      headers,
    });

    if (!alertsRes.ok) {
      const errText = await alertsRes.text();
      throw new Error(`Échec de récupération des alertes: ${errText}`);
    }

    const alerts = await alertsRes.json();
    console.log(`Réponse reçue (${alerts.length} alertes actives) :`, JSON.stringify(alerts, null, 2));

    if (!Array.isArray(alerts)) {
      throw new Error("Le format des alertes doit être un tableau.");
    }

    console.log('✅ Endpoint des alertes prédictives validé !');
  } catch (err) {
    console.error('❌ Erreur lors du test des alertes :', err.message);
    process.exit(1);
  }

  // 4. Test du briefing matinal en mode mock
  try {
    console.log('\n📝 --- TEST DU BRIEFING MATINAL (MOCK) ---');
    const briefingRes = await fetch(`${BACKEND_URL}/projects/ai/copilot/briefing?workspaceId=${workspaceId}&isMock=true`, {
      method: 'GET',
      headers,
    });

    if (!briefingRes.ok) {
      const errText = await briefingRes.text();
      throw new Error(`Échec de récupération du briefing: ${errText}`);
    }

    const briefing = await briefingRes.json();
    console.log('Briefing reçu :\n');
    console.log(briefing.briefing);
    console.log('\n------------------');

    if (!briefing.briefing) {
      throw new Error("Le briefing est vide ou absent.");
    }

    if (!briefing.briefing.includes('Bonjour Gaëtan')) {
      throw new Error("Le briefing personnalisé n'est pas adressé à Gaëtan.");
    }

    if (!briefing.briefing.includes('Aperçu de votre journée') || !briefing.briefing.includes('Recommandations du Copilote')) {
      throw new Error("Le briefing mocké ne contient pas les sections attendues.");
    }

    console.log('\n✅ Briefing matinal validé !');
    console.log('\n🎉 TOUS LES TESTS D\'INTEGRATION DU COPILOTE EN CLI SONT AU VERT !');
  } catch (err) {
    console.error('❌ Erreur lors du test du briefing :', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runCopilotTest();
