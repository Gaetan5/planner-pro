const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const http = require('http');

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
const WEBHOOK_PORT = 3009;
const WEBHOOK_URL = `http://127.0.0.1:${WEBHOOK_PORT}/webhook-test`;

async function runIntegrationsTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let tokenGaetan = '';
  let tokenAlice = '';
  let userIdGaetan = '';
  let userIdAlice = '';
  let workspaceId = '';
  let projectId = '';
  let taskId = '';
  let webhookReceived = false;
  let webhookPayload = null;

  // 1. Démarrer un serveur HTTP local temporaire pour recevoir le webhook Slack simulé
  const webhookServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      webhookReceived = true;
      try {
        webhookPayload = JSON.parse(body);
      } catch (err) {
        webhookPayload = body;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  });

  webhookServer.listen(WEBHOOK_PORT, '0.0.0.0', () => {
    console.log(`🌐 Serveur webhook temporaire démarré sur ${WEBHOOK_URL}`);
  });

  // 2. Authentification des deux utilisateurs mockés (Gaëtan et Alice)
  try {
    const loginResG = await fetch(`${BACKEND_URL}/auth/mock/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gaëtan' }),
    });
    const dataG = await loginResG.json();
    tokenGaetan = dataG.accessToken;
    userIdGaetan = dataG.user.id;

    const loginResA = await fetch(`${BACKEND_URL}/auth/mock/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    });
    const dataA = await loginResA.json();
    tokenAlice = dataA.accessToken;
    userIdAlice = dataA.user.id;

    console.log(`✅ Authentifié Gaëtan (ID: ${userIdGaetan})`);
    console.log(`✅ Authentifié Alice (ID: ${userIdAlice})`);
  } catch (err) {
    console.error('❌ Erreur de connexion mock :', err.message);
    webhookServer.close();
    process.exit(1);
  }

  const headersG = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenGaetan}`,
  };

  const headersA = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenAlice}`,
  };

  // 3. Récupérer ou créer un workspace et un projet
  try {
    // S'assurer que Gaëtan a un workspace
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
    console.log(`ℹ️ Workspace de Gaëtan utilisé : "${workRes.name}" (ID: ${workspaceId})`);

    // Nettoyer les intégrations existantes du workspace pour éviter les interférences
    await prisma.integration.deleteMany({
      where: { workspaceId },
    });
    console.log('🧹 Anciennes intégrations nettoyées.');

    // S'assurer qu'Alice est membre du workspace de Gaëtan
    const aliceMember = await prisma.membership.findFirst({
      where: { workspaceId, userId: userIdAlice },
    });
    if (!aliceMember) {
      await prisma.membership.create({
        data: {
          workspaceId,
          userId: userIdAlice,
          role: 'MEMBER',
        },
      });
      console.log(`✅ Alice ajoutée en tant que MEMBER au workspace de Gaëtan.`);
    }

    // Récupérer ou créer un projet dans le workspace
    let projRes = await prisma.project.findFirst({
      where: { workspaceId, deletedAt: null },
    });

    if (!projRes) {
      projRes = await prisma.project.create({
        data: {
          name: 'Projet Sync',
          workspaceId,
        },
      });
    }
    projectId = projRes.id;
    console.log(`ℹ️ Projet utilisé : "${projRes.name}" (ID: ${projectId})`);

  } catch (err) {
    console.error('❌ Erreur initialisation Workspace/Projet :', err.message);
    webhookServer.close();
    process.exit(1);
  }

  // 4. Tester la création d'intégrations (Slack & Google Calendar)
  let slackIntegrationId = '';
  let googleCalIntegrationId = '';

  try {
    console.log('\n➕ Création d\'une intégration Slack...');
    const createSlackRes = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/integrations`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        type: 'SLACK',
        name: 'Webhook Slack de Test',
        url: WEBHOOK_URL,
      }),
    });
    const slackIntegration = await createSlackRes.json();
    slackIntegrationId = slackIntegration.id;
    console.log(`✅ Intégration Slack créée avec succès (ID: ${slackIntegrationId})`);

    console.log('➕ Création d\'une intégration Google Calendar...');
    const createGoogleRes = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/integrations`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        type: 'GOOGLE_CALENDAR',
        name: 'Agenda Google de Test',
        calendarId: 'alice@test.com',
      }),
    });
    const googleIntegration = await createGoogleRes.json();
    googleCalIntegrationId = googleIntegration.id;
    console.log(`✅ Intégration Google Calendar créée avec succès (ID: ${googleCalIntegrationId})`);

  } catch (err) {
    console.error('❌ Erreur création d\'intégrations :', err.message);
    webhookServer.close();
    process.exit(1);
  }

  // 5. Tester la liste des intégrations et le masquage de l'URL
  try {
    console.log('\n📋 Liste des intégrations du workspace...');
    const listRes = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/integrations`, {
      headers: headersG,
    });
    const integrationsList = await listRes.json();
    console.log(`ℹ️ Nombre d'intégrations trouvées : ${integrationsList.length}`);

    const slackInt = integrationsList.find(i => i.id === slackIntegrationId);
    if (!slackInt) {
      throw new Error("L'intégration Slack créée n'apparaît pas dans la liste.");
    }
    console.log(`🕵️ URL brute retournée pour Slack : ${slackInt.url}`);
    if (slackInt.url === WEBHOOK_URL) {
      throw new Error("Sécurité violée ! L'URL du webhook a été renvoyée en clair !");
    }
    console.log('✅ L\'URL du webhook Slack a été correctement masquée par le backend.');

  } catch (err) {
    console.error('❌ Erreur lors du test de sécurité/liste :', err.message);
    webhookServer.close();
    process.exit(1);
  }

  // 6. Tester le déclenchement de webhook sur création de tâche
  try {
    console.log('\n🚀 Création d\'une tâche pour déclencher le webhook...');
    webhookReceived = false;
    webhookPayload = null;

    const createTaskRes = await fetch(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        title: 'Tâche de test pour Webhook',
        description: 'Vérifier la réception',
        priority: 'HIGH',
      }),
    });

    const newTask = await createTaskRes.json();
    taskId = newTask.id;
    console.log(`✅ Tâche créée (ID: ${taskId}). En attente du webhook (2s max)...`);

    // Attendre un peu que le webhook asynchrone non bloquant soit tiré
    await new Promise(resolve => setTimeout(resolve, 1500));

    if (!webhookReceived) {
      throw new Error("Le serveur webhook temporaire n'a reçu aucune notification.");
    }

    console.log('✅ Webhook reçu ! Payload reçu :', JSON.stringify(webhookPayload));
    if (!webhookPayload.text || !webhookPayload.text.includes('Tâche de test pour Webhook')) {
      throw new Error("Le payload reçu ne contient pas les détails de la tâche.");
    }
    console.log('✅ Webhook de création de tâche validé.');

  } catch (err) {
    console.error('❌ Erreur lors du webhook tâche :', err.message);
    webhookServer.close();
    process.exit(1);
  }

  // 7. Tester le déclenchement de webhook sur nouveau commentaire
  try {
    console.log('\n🚀 Ajout d\'un commentaire pour déclencher le webhook...');
    webhookReceived = false;
    webhookPayload = null;

    await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: headersA, // Ajouté par Alice
      body: JSON.stringify({
        content: 'Je m\'en occupe tout de suite ! @Gaëtan',
      }),
    });

    console.log(`✅ Commentaire ajouté. En attente du webhook (2s max)...`);

    await new Promise(resolve => setTimeout(resolve, 1500));

    if (!webhookReceived) {
      throw new Error("Le serveur webhook temporaire n'a reçu aucune notification pour le commentaire.");
    }

    console.log('✅ Webhook reçu ! Payload reçu :', JSON.stringify(webhookPayload));
    if (!webhookPayload.text || !webhookPayload.text.includes('Je m\'en occupe tout de suite')) {
      throw new Error("Le payload reçu ne contient pas le contenu du commentaire.");
    }
    console.log('✅ Webhook de commentaire validé.');

  } catch (err) {
    console.error('❌ Erreur lors du webhook commentaire :', err.message);
    webhookServer.close();
    process.exit(1);
  }

  // 8. Tester le toggle de l'intégration (Désactivation)
  try {
    console.log('\n🔀 Désactivation de l\'intégration Slack...');
    const toggleRes = await fetch(`${BACKEND_URL}/projects/integrations/${slackIntegrationId}/toggle`, {
      method: 'POST',
      headers: headersG,
    });
    const updatedSlack = await toggleRes.json();
    console.log(`ℹ️ Nouvel état actif de Slack : ${updatedSlack.active}`);
    if (updatedSlack.active) {
      throw new Error("L'intégration n'a pas été désactivée.");
    }

    console.log('🚀 Ajout d\'un commentaire alors que l\'intégration est inactive...');
    webhookReceived = false;

    await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        content: 'Ce message ne devrait pas notifier Slack car désactivé.',
      }),
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    if (webhookReceived) {
      throw new Error("Une notification a été reçue alors que le webhook Slack est désactivé.");
    }
    console.log('✅ L\'inactivité du webhook a été correctement respectée.');

  } catch (err) {
    console.error('❌ Erreur lors du test de toggle :', err.message);
    webhookServer.close();
    process.exit(1);
  }

  // 9. Tester l'exportation et les conflits de calendrier
  try {
    console.log('\n📅 Exportation des créneaux horaires vers Google Calendar...');
    const exportRes = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/integrations/${googleCalIntegrationId}/export`, {
      method: 'POST',
      headers: headersG,
    });
    const exportData = await exportRes.json();
    console.log(`✅ Créneaux exportés : ${exportData.exportedCount}`);

    console.log('📅 Création d\'un créneau local pour Alice en conflit (01 Juin 2026 de 11:00 à 13:00)...');
    // Mettre d'abord Alice comme assignée de la tâche
    await fetch(`${BACKEND_URL}/projects/tasks/${taskId}`, {
      method: 'PUT',
      headers: headersG,
      body: JSON.stringify({
        assigneeIds: [userIdAlice],
      }),
    });

    // Créer le timeblock
    const blockRes = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/timeblocks`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        startTime: '2026-06-01T11:00:00Z',
        endTime: '2026-06-01T13:00:00Z',
      }),
    });
    const timeBlock = await blockRes.json();
    console.log(`✅ Bloc horaire local créé (ID: ${timeBlock.id})`);

    console.log('🔍 Détection des conflits de calendrier...');
    const conflictsRes = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/calendar-conflicts`, {
      headers: headersG,
    });
    const conflicts = await conflictsRes.json();
    console.log(`ℹ️ Nombre de conflits détectés : ${conflicts.length}`);

    if (conflicts.length === 0) {
      throw new Error("Aucun conflit n'a été détecté alors qu'Alice a un chevauchement d'agenda.");
    }

    const aliceConflict = conflicts.find(c => c.userId === userIdAlice);
    if (!aliceConflict) {
      throw new Error("Le conflit détecté ne concerne pas Alice.");
    }
    console.log(`🕵️ Message de conflit : "${aliceConflict.message}"`);
    if (!aliceConflict.message.includes('Rendez-vous dentiste')) {
      throw new Error("Le message du conflit ne mentionne pas l'événement externe.");
    }
    console.log('✅ Détection de conflit de calendrier validée.');

  } catch (err) {
    console.error('❌ Erreur lors du test de calendrier :', err.message);
    webhookServer.close();
    process.exit(1);
  }

  // 10. Nettoyage
  try {
    console.log('\n🧹 Suppression des intégrations de test...');
    await fetch(`${BACKEND_URL}/projects/integrations/${slackIntegrationId}`, {
      method: 'DELETE',
      headers: headersG,
    });
    await fetch(`${BACKEND_URL}/projects/integrations/${googleCalIntegrationId}`, {
      method: 'DELETE',
      headers: headersG,
    });
    console.log('✅ Intégrations supprimées.');

    // Supprimer la tâche et le timeblock
    await prisma.timeBlock.deleteMany({
      where: { taskId },
    });
    await prisma.comment.deleteMany({
      where: { taskId },
    });
    await prisma.taskAssignee.deleteMany({
      where: { taskId },
    });
    await prisma.task.delete({
      where: { id: taskId },
    });
    console.log('✅ Tâche et données associées nettoyées.');

  } catch (err) {
    console.error('❌ Erreur lors du nettoyage :', err.message);
  }

  // Fermer le serveur webhook
  webhookServer.close();
  console.log('\n🎉 TOUS LES TESTS D\'INTÉGRATION CLI ONT RÉUSSI !');
}

runIntegrationsTest();
