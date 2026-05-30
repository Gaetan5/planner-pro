const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';

async function runAutoSchedulingTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let tokenGaetan = '';
  let userIdGaetan = '';
  let workspaceId = '';
  let projectId = '';
  let taskIdA = '';
  let taskIdB = '';
  let taskIdC = '';

  // 1. Authentification
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
        data: { name: 'Projet Auto-Scheduling', workspaceId },
      });
    }
    projectId = projRes.id;
    console.log(`ℹ️ Projet utilisé : "${projRes.name}" (ID: ${projectId})`);
  } catch (err) {
    console.error('❌ Erreur initialisation Workspace/Projet :', err.message);
    process.exit(1);
  }

  // 3. Création des Tâches A, B et C
  try {
    console.log('\n➕ Création de la Tâche A (08:00 - 10:00)...');
    const resA = await fetch(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Tâche A',
        startDate: '2026-06-01T08:00:00.000Z',
        dueDate: '2026-06-01T10:00:00.000Z',
      }),
    });
    const taskA = await resA.json();
    taskIdA = taskA.id;

    console.log('➕ Création de la Tâche B (10:00 - 12:00)...');
    const resB = await fetch(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Tâche B',
        startDate: '2026-06-01T10:00:00.000Z',
        dueDate: '2026-06-01T12:00:00.000Z',
      }),
    });
    const taskB = await resB.json();
    taskIdB = taskB.id;

    console.log('➕ Création de la Tâche C (12:00 - 14:00)...');
    const resC = await fetch(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Tâche C',
        startDate: '2026-06-01T12:00:00.000Z',
        dueDate: '2026-06-01T14:00:00.000Z',
      }),
    });
    const taskC = await resC.json();
    taskIdC = taskC.id;

    console.log(`✅ Tâches créées : A (${taskIdA}), B (${taskIdB}), C (${taskIdC})`);
  } catch (err) {
    console.error('❌ Erreur création des tâches :', err.message);
    process.exit(1);
  }

  // 4. Création des dépendances : B dépend de A, C dépend de B
  try {
    console.log('\n🔗 Liaison de dépendances...');
    await fetch(`${BACKEND_URL}/projects/tasks/${taskIdB}/dependencies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ dependsOnTaskId: taskIdA, type: 'FINISH_TO_START' }),
    });
    console.log('✅ Dépendance Tâche B -> Tâche A créée.');

    await fetch(`${BACKEND_URL}/projects/tasks/${taskIdC}/dependencies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ dependsOnTaskId: taskIdB, type: 'FINISH_TO_START' }),
    });
    console.log('✅ Dépendance Tâche C -> Tâche B créée.');
  } catch (err) {
    console.error('❌ Erreur création dépendances :', err.message);
    await cleanup();
    process.exit(1);
  }

  // 5. Test d'effet domino : Décaler la fin de Tâche A à 11:00
  try {
    console.log('\n🚀 Décalage de la date de fin de la Tâche A à 11:00 (anciennement 10:00)...');
    const updateRes = await fetch(`${BACKEND_URL}/projects/tasks/${taskIdA}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        dueDate: '2026-06-01T11:00:00.000Z',
      }),
    });
    const updateData = await updateRes.json();
    console.log('ℹ️ Identifiants des tâches impactées rapportés par le backend :', updateData.impactedTaskIds);

    if (!updateData.impactedTaskIds || updateData.impactedTaskIds.length === 0) {
      throw new Error("Aucun identifiant de tâche décalée n'a été retourné par le backend.");
    }

    // Récupérer les états finaux des tâches B et C en BDD
    const finalB = await prisma.task.findUnique({ where: { id: taskIdB } });
    const finalC = await prisma.task.findUnique({ where: { id: taskIdC } });

    console.log(`\n🕵️ Analyse des nouvelles dates de la Tâche B :`);
    console.log(`- Début attendu : 11:00 | Réel : ${finalB.startDate.toISOString()}`);
    console.log(`- Fin attendue   : 13:00 | Réelle : ${finalB.dueDate.toISOString()}`);

    console.log(`\n🕵️ Analyse des nouvelles dates de la Tâche C :`);
    console.log(`- Début attendu : 13:00 | Réel : ${finalC.startDate.toISOString()}`);
    console.log(`- Fin attendue   : 15:00 | Réelle : ${finalC.dueDate.toISOString()}`);

    const expectedBStart = new Date('2026-06-01T11:00:00.000Z').getTime();
    const expectedBEnd = new Date('2026-06-01T13:00:00.000Z').getTime();
    const expectedCStart = new Date('2026-06-01T13:00:00.000Z').getTime();
    const expectedCEnd = new Date('2026-06-01T15:00:00.000Z').getTime();

    if (finalB.startDate.getTime() !== expectedBStart || finalB.dueDate.getTime() !== expectedBEnd) {
      throw new Error("La Tâche B n'a pas été correctement décalée par effet domino.");
    }

    if (finalC.startDate.getTime() !== expectedCStart || finalC.dueDate.getTime() !== expectedCEnd) {
      throw new Error("La Tâche C n'a pas été correctement décalée par effet domino (propagation récursive).");
    }

    console.log('\n✅ L\'AUTO-SCHEDULING ET L\'EFFET DOMINO ONT PASSÉ LES TESTS AVEC SUCCÈS !');

  } catch (err) {
    console.error('❌ Échec du test d\'auto-scheduling :', err.message);
    await cleanup();
    process.exit(1);
  }

  // 6. Nettoyage
  await cleanup();
  console.log('🎉 Test d\'auto-scheduling CLI terminé avec succès !');

  async function cleanup() {
    console.log('\n🧹 Nettoyage des données de test...');
    try {
      await prisma.taskDependency.deleteMany({
        where: { taskId: { in: [taskIdA, taskIdB, taskIdC] } },
      });
      await prisma.taskAssignee.deleteMany({
        where: { taskId: { in: [taskIdA, taskIdB, taskIdC] } },
      });
      await prisma.task.deleteMany({
        where: { id: { in: [taskIdA, taskIdB, taskIdC] } },
      });
      console.log('✅ Nettoyage terminé.');
    } catch (err) {
      console.error('❌ Erreur lors du nettoyage :', err.message);
    }
  }
}

runAutoSchedulingTest();
