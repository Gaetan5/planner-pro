const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Erreur HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function runAgileTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let tokenGaetan = '';
  let userIdGaetan = '';
  let workspaceId = '';
  let projectId = '';
  let sprintId = '';
  let taskIdA = '';
  let taskIdB = '';
  let taskIdC = '';

  // 1. Authentification
  try {
    const data = await request(`${BACKEND_URL}/auth/mock/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Gaëtan' }),
    });
    tokenGaetan = data.accessToken;
    userIdGaetan = data.user.id;
    console.log(`✅ Authentifié Gaëtan (ID: ${userIdGaetan})`);
  } catch (err) {
    console.error('❌ Erreur de connexion mock :', err.message);
    process.exit(1);
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenGaetan}`,
  };

  // 2. Workspace & Projet
  try {
    let workRes = await prisma.workspace.findFirst({
      where: { ownerId: userIdGaetan, deletedAt: null },
    });
    if (!workRes) {
      workRes = await prisma.workspace.create({
        data: { name: 'Espace principal', ownerId: userIdGaetan },
      });
      await prisma.membership.create({
        data: { workspaceId: workRes.id, userId: userIdGaetan, role: 'OWNER' },
      });
    }
    workspaceId = workRes.id;

    let projRes = await prisma.project.findFirst({
      where: { workspaceId, deletedAt: null },
    });
    if (!projRes) {
      projRes = await prisma.project.create({
        data: { name: 'Projet Agile Test', workspaceId },
      });
    }
    projectId = projRes.id;
    console.log(`ℹ️ Workspace ID : ${workspaceId} | Projet ID : ${projectId}`);
  } catch (err) {
    console.error('❌ Erreur initialisation Workspace/Projet :', err.message);
    process.exit(1);
  }

  // 3. Créer un Sprint
  try {
    console.log('\n📅 Création d\'un sprint...');
    const sprint = await request(`${BACKEND_URL}/projects/workspaces/${workspaceId}/sprints`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Sprint Test Agile',
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-06-03T23:59:59.000Z',
        status: 'PLANNED',
      }),
    });
    sprintId = sprint.id;
    console.log(`✅ Sprint créé : "${sprint.name}" (ID: ${sprintId}, Statut: ${sprint.status})`);
  } catch (err) {
    console.error('❌ Erreur création sprint :', err.message);
    process.exit(1);
  }

  // 4. Créer 3 tâches avec des Story Points
  try {
    console.log('\n➕ Création de 3 tâches avec Story Points...');
    const taskA = await request(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Tâche A - Init UI', storyPoints: 3 }),
    });
    taskIdA = taskA.id;

    const taskB = await request(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Tâche B - API Sprints', storyPoints: 5 }),
    });
    taskIdB = taskB.id;

    const taskC = await request(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Tâche C - Burndown SVG', storyPoints: 8 }),
    });
    taskIdC = taskC.id;

    console.log(`✅ Tâches créées : A (${taskIdA}, 3 SP), B (${taskIdB}, 5 SP), C (${taskIdC}, 8 SP)`);
  } catch (err) {
    console.error('❌ Erreur création tâches :', err.message);
    await cleanup();
    process.exit(1);
  }

  // 5. Associer les tâches au Sprint
  try {
    console.log('\n🔗 Association des tâches au sprint...');
    const assocData = await request(`${BACKEND_URL}/projects/sprints/${sprintId}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ taskIds: [taskIdA, taskIdB, taskIdC] }),
    });
    console.log('✅ Association effectuée :', assocData.success);
  } catch (err) {
    console.error('❌ Erreur association tâches :', err.message);
    await cleanup();
    process.exit(1);
  }

  // 6. Activer le Sprint
  try {
    console.log('\n🚀 Activation du sprint...');
    const sprintActif = await request(`${BACKEND_URL}/projects/sprints/${sprintId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    console.log(`✅ Sprint activé (Statut: ${sprintActif.status})`);
  } catch (err) {
    console.error('❌ Erreur activation sprint :', err.message);
    await cleanup();
    process.exit(1);
  }

  // 7. Terminer la Tâche A et la Tâche B par API, et ajuster completedAt en BDD pour le Burndown historique
  try {
    console.log('\n✔ Complétion de la Tâche A (3 SP) et de la Tâche B (5 SP)...');
    await request(`${BACKEND_URL}/projects/tasks/${taskIdA}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'DONE' }),
    });
    await request(`${BACKEND_URL}/projects/tasks/${taskIdB}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'DONE' }),
    });

    // Ajuster completedAt pour rendre le test de burndown déterministe
    // Tâche A terminée le Jour 2 (2026-06-02)
    await prisma.task.update({
      where: { id: taskIdA },
      data: { completedAt: new Date('2026-06-02T12:00:00.000Z') },
    });
    // Tâche B terminée le Jour 3 (2026-06-03)
    await prisma.task.update({
      where: { id: taskIdB },
      data: { completedAt: new Date('2026-06-03T15:00:00.000Z') },
    });

    console.log('✅ Tâches marquées complétées avec dates historiques définies.');
  } catch (err) {
    console.error('❌ Erreur complétion tâches :', err.message);
    await cleanup();
    process.exit(1);
  }

  // 8. Vérifier la génération du Burndown Chart (Pendant que le sprint est encore ACTIVE pour inclure toutes les tâches)
  try {
    console.log('\n📊 Vérification du Burndown Chart...');
    const burn = await request(`${BACKEND_URL}/projects/sprints/${sprintId}/burndown`, {
      method: 'GET',
      headers,
    });

    console.log(`- Points totaux planifiés : ${burn.totalPoints}`);
    console.log('- Courbe de Burndown :');
    burn.data.forEach((day, index) => {
      console.log(`  * Jour ${index + 1} (${day.date}) : Réel restants = ${day.real} SP | Idéal restants = ${day.ideal} SP`);
    });

    // Validations
    if (burn.totalPoints !== 16) {
      throw new Error(`Le total des points planifiés est incorrect (${burn.totalPoints} SP au lieu de 16 SP).`);
    }
    // Jour 1 (01 Juin) : Réel = 16 SP
    if (burn.data[0].real !== 16) {
      throw new Error(`Jour 1 : points réels restants incorrects (${burn.data[0].real} au lieu de 16).`);
    }
    // Jour 2 (02 Juin) : Réel = 16 - 3 = 13 SP
    if (burn.data[1].real !== 13) {
      throw new Error(`Jour 2 : points réels restants incorrects (${burn.data[1].real} au lieu de 13).`);
    }
    // Jour 3 (03 Juin) : Réel = 13 - 5 = 8 SP (car la Tâche C à 8 SP n'est pas faite)
    if (burn.data[2].real !== 8) {
      throw new Error(`Jour 3 : points réels restants incorrects (${burn.data[2].real} au lieu de 8).`);
    }

    console.log('✅ Calculs de burndown cohérents et précis.');
  } catch (err) {
    console.error('❌ Échec vérification Burndown Chart :', err.message);
    await cleanup();
    process.exit(1);
  }

  // 9. Clôturer le Sprint
  try {
    console.log('\n🔒 Clôture du sprint...');
    const sprintClos = await request(`${BACKEND_URL}/projects/sprints/${sprintId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'COMPLETED' }),
    });
    console.log(`✅ Sprint clôturé (Statut: ${sprintClos.status})`);

    // Vérifier que la Tâche C (non terminée) a été libérée vers le backlog (sprintId = null)
    const taskC = await prisma.task.findUnique({ where: { id: taskIdC } });
    if (taskC.sprintId !== null) {
      throw new Error(`La tâche non terminée C a toujours le sprintId ${taskC.sprintId} alors qu'il devrait être null.`);
    }
    console.log('✅ Tâche non terminée C correctement libérée vers le backlog.');
  } catch (err) {
    console.error('❌ Erreur clôture sprint :', err.message);
    await cleanup();
    process.exit(1);
  }

  // 10. Vérifier le calcul de la Vélocité Moyenne
  try {
    console.log('\n📈 Vérification de la vélocité moyenne de l\'espace...');
    const data = await request(`${BACKEND_URL}/projects/workspaces/${workspaceId}/velocity`, {
      method: 'GET',
      headers,
    });
    const velocity = data.velocity;
    console.log(`- Vélocité attendue : 8 SP | Réelle : ${velocity} SP`);

    if (velocity !== 8) {
      throw new Error(`La vélocité moyenne calculée est incorrecte (${velocity} SP au lieu de 8 SP).`);
    }
    console.log('✅ Vélocité moyenne correcte.');
  } catch (err) {
    console.error('❌ Erreur vérification vélocité :', err.message);
    await cleanup();
    process.exit(1);
  }

  // 11. Nettoyer
  await cleanup();
  console.log('\n🎉 TOUS LES TESTS D\'INTÉGRATION CLI AGILE ONT RÉUSSI AVEC SUCCÈS !');

  async function cleanup() {
    console.log('\n🧹 Nettoyage des données de test...');
    try {
      await prisma.taskAssignee.deleteMany({
        where: { taskId: { in: [taskIdA, taskIdB, taskIdC] } },
      });
      await prisma.task.deleteMany({
        where: { id: { in: [taskIdA, taskIdB, taskIdC] } },
      });
      if (sprintId) {
        await prisma.sprint.delete({
          where: { id: sprintId },
        });
      }
      console.log('✅ Nettoyage terminé.');
    } catch (err) {
      console.error('❌ Erreur lors du nettoyage :', err.message);
    }
  }
}

runAgileTest();
