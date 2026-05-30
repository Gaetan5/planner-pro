const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

async function runWebhookTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let token = '';
  let userId = '';

  // 1. Connexion Mock pour pouvoir créer les ressources de test
  try {
    const loginRes = await fetch(`${BACKEND_URL}/auth/mock/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gaëtan' }),
    });

    if (!loginRes.ok) {
      throw new Error(`Échec de connexion mock: ${loginRes.statusText}`);
    }

    const loginData = await loginRes.json();
    token = loginData.accessToken;
    userId = loginData.user.id;
    console.log(`✅ Authentifié (ID: ${userId})`);
  } catch (err) {
    console.error('❌ Erreur lors de la connexion mock :', err.message);
    process.exit(1);
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // 2. Création d'un projet de test
  let project = null;
  try {
    const projRes = await fetch(`${BACKEND_URL}/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Projet Test Webhook GitHub',
        description: 'Projet temporaire pour tester la fermeture automatique de tâche.',
        status: 'ACTIVE',
      }),
    });

    if (!projRes.ok) {
      throw new Error(`Échec de création du projet: ${projRes.statusText}`);
    }

    project = await projRes.json();
    console.log(`✅ Projet de test créé ! ID: ${project.id}`);
  } catch (err) {
    console.error('❌ Erreur de création de projet :', err.message);
    process.exit(1);
  }

  // 3. Création d'une tâche de test à l'état TODO
  let task = null;
  try {
    const taskRes = await fetch(`${BACKEND_URL}/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Tâche Test de Fermeture Automatique',
        description: 'Cette tâche doit être fermée à la fusion de la PR.',
        priority: 'HIGH',
      }),
    });

    if (!taskRes.ok) {
      throw new Error(`Échec de création de la tâche: ${taskRes.statusText}`);
    }

    task = await taskRes.json();
    console.log(`✅ Tâche créée avec succès ! ID: ${task.id}, Statut initial: ${task.status}`);
  } catch (err) {
    console.error('❌ Erreur de création de tâche :', err.message);
    process.exit(1);
  }

  // 4. Appel du webhook GitHub publiquement (SANS header d'autorisation)
  console.log(`📡 Simulation de l'appel du webhook GitHub (public)...`);
  try {
    const webhookRes = await fetch(`${BACKEND_URL}/projects/webhooks/github`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Pas de Authorization header pour valider que l'exemption JWT fonctionne !
      },
      body: JSON.stringify({
        action: 'closed',
        pull_request: {
          merged: true,
          title: 'Release/v1.0.0',
          body: `Cette Pull Request résout et fixes #${task.id} avec succès !`,
        },
      }),
    });

    if (!webhookRes.ok) {
      throw new Error(`Échec de l'appel du webhook: ${webhookRes.statusText}`);
    }

    const result = await webhookRes.json();
    console.log(`✅ Webhook GitHub appelé avec succès. Tâches fermées :`, result.closedTaskIds);
  } catch (err) {
    console.error('❌ Erreur d\'appel de webhook :', err.message);
    process.exit(1);
  }

  // 5. Récupération de la tâche via l'API pour vérifier si elle est passée à DONE
  try {
    const checkRes = await fetch(`${BACKEND_URL}/projects/${project.id}`, {
      headers,
    });

    if (!checkRes.ok) {
      throw new Error(`Échec de récupération du projet: ${checkRes.statusText}`);
    }

    const fullProject = await checkRes.json();
    const updatedTask = fullProject.tasks.find(t => t.id === task.id);

    console.log('\n🔍 --- VÉRIFICATION DE LA TÂCHE APRÈS WEBHOOK ---');
    console.log(`Tâche ID:     ${updatedTask.id}`);
    console.log(`Titre:        ${updatedTask.title}`);
    console.log(`Statut:       ${updatedTask.status} (Attendu: DONE)`);
    console.log(`Progression:  ${updatedTask.progress}% (Attendu: 100%)`);
    console.log('--------------------------------------------------\n');

    if (updatedTask.status === 'DONE' && updatedTask.progress === 100) {
      console.log('🎉 SUCCÈS COMPLET : La tâche a été fermée automatiquement via le Webhook GitHub !');
    } else {
      console.error('❌ ÉCHEC : Le statut de la tâche n\'est pas DONE ou la progression n\'est pas de 100% !');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Erreur lors de la vérification finale :', err.message);
    process.exit(1);
  }
}

runWebhookTest();
