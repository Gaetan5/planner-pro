const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

async function runAiTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let tokenGaetan = '';
  let tokenAlice = '';
  let userIdGaetan = '';
  let userIdAlice = '';
  let workspaceId = '';
  let projectId = '';
  let targetTaskId = '';

  // 1. Authentification des deux utilisateurs mockés (Gaëtan et Alice)
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
    process.exit(1);
  }

  const headersG = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenGaetan}`,
  };

  // 2. Récupérer ou créer un workspace, un projet et une tâche spécifique
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
    console.log(`ℹ️ Workspace utilisé : "${workRes.name}" (ID: ${workspaceId})`);

    // S'assurer qu'Alice est membre du workspace
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
      console.log(`✅ Alice ajoutée en tant que MEMBER.`);
    }

    // S'assurer qu'un projet existe
    let projRes = await prisma.project.findFirst({
      where: { workspaceId, deletedAt: null },
    });

    if (!projRes) {
      const pRes = await fetch(`${BACKEND_URL}/projects`, {
        method: 'POST',
        headers: headersG,
        body: JSON.stringify({
          name: 'Projet IA',
          description: 'Pour tester les fonctionnalités de command bar.',
          workspaceId,
        }),
      });
      projRes = await pRes.json();
    }
    projectId = projRes.id;
    console.log(`ℹ️ Projet utilisé : "${projRes.name}" (ID: ${projectId})`);

    // Créer une tâche cible "Configurer la sécurité globale" si elle n'existe pas
    let taskRes = await prisma.task.findFirst({
      where: { projectId, title: 'Configurer la sécurité globale', deletedAt: null },
    });

    if (!taskRes) {
      const tRes = await fetch(`${BACKEND_URL}/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: headersG,
        body: JSON.stringify({
          title: 'Configurer la sécurité globale',
          priority: 'HIGH',
        }),
      });
      taskRes = await tRes.json();
    }
    targetTaskId = taskRes.id;
    console.log(`ℹ️ Tâche existante : "${taskRes.title}" (ID: ${targetTaskId})`);
  } catch (err) {
    console.error('❌ Erreur de configuration de départ :', err.message);
    process.exit(1);
  }

  // 3. Test de parsing de la commande IA "MOCK: créer tâche Recruter développeur frontend pour Alice"
  let createAction = null;
  try {
    console.log('\n🤖 --- TEST PARSING IA : CREATION DE TACHE ET ASSIGNATION ---');
    const commandRes = await fetch(`${BACKEND_URL}/projects/ai/command`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        workspaceId,
        projectId,
        command: 'MOCK: créer tâche Recruter développeur frontend pour Alice',
      }),
    });

    if (!commandRes.ok) {
      const errorText = await commandRes.text();
      throw new Error(`Échec parsing création : ${errorText}`);
    }

    const actions = await commandRes.json();
    console.log('Actions résolues reçues :', JSON.stringify(actions, null, 2));

    if (!Array.isArray(actions) || actions.length === 0) {
      throw new Error('Aucune action retournée par le backend.');
    }

    createAction = actions[0];
    if (createAction.type !== 'CREATE_TASK') {
      throw new Error(`Type d'action incorrect : attendu CREATE_TASK, reçu ${createAction.type}`);
    }

    if (createAction.assigneeId !== userIdAlice) {
      throw new Error(`Assignation non résolue : attendu l'ID d'Alice (${userIdAlice}), reçu ${createAction.assigneeId}`);
    }

    if (!createAction.resolved) {
      throw new Error(`L'action n'est pas marquée comme résolue : ${createAction.warning}`);
    }

    console.log('✅ Parsing création de tâche réussi et assignation résolue sur Alice !');
  } catch (err) {
    console.error('❌ Erreur parsing création de tâche :', err.message);
    process.exit(1);
  }

  // 4. Test de parsing de la commande IA "MOCK: assigner Alice sur Secu" (Test diacritiques et fuzzy matching)
  let assignAction = null;
  try {
    console.log('\n🤖 --- TEST PARSING IA : AFFECTATION DE TACHE EXISTANTE (FUZZY + ACCENTS) ---');
    const commandRes = await fetch(`${BACKEND_URL}/projects/ai/command`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        workspaceId,
        projectId,
        command: 'MOCK: assigner Alice sur Secu',
      }),
    });

    if (!commandRes.ok) {
      const errorText = await commandRes.text();
      throw new Error(`Échec parsing affectation : ${errorText}`);
    }

    const actions = await commandRes.json();
    console.log('Actions résolues reçues :', JSON.stringify(actions, null, 2));

    if (!Array.isArray(actions) || actions.length === 0) {
      throw new Error('Aucune action retournée par le backend.');
    }

    assignAction = actions[0];
    if (assignAction.type !== 'ASSIGN_TASK') {
      throw new Error(`Type d'action incorrect : attendu ASSIGN_TASK, reçu ${assignAction.type}`);
    }

    if (assignAction.taskId !== targetTaskId) {
      throw new Error(`Tâche non résolue : attendu l'ID de la tâche sécurité (${targetTaskId}), reçu ${assignAction.taskId}`);
    }

    if (assignAction.assigneeId !== userIdAlice) {
      throw new Error(`Assignation non résolue : attendu l'ID d'Alice (${userIdAlice}), reçu ${assignAction.assigneeId}`);
    }

    if (!assignAction.resolved) {
      throw new Error(`L'action n'est pas marquée comme résolue : ${assignAction.warning}`);
    }

    console.log('✅ Parsing affectation de tâche réussi avec fuzzy matching insensible aux accents !');
  } catch (err) {
    console.error('❌ Erreur parsing affectation de tâche :', err.message);
    process.exit(1);
  }

  // 5. Test d'exécution des actions validées par l'utilisateur
  try {
    console.log('\n🚀 --- TEST EXECUTION DES ACTIONS IA ---');
    const executeRes = await fetch(`${BACKEND_URL}/projects/ai/execute`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        workspaceId,
        projectId,
        actions: [createAction, assignAction],
      }),
    });

    if (!executeRes.ok) {
      const errorText = await executeRes.text();
      throw new Error(`Échec exécution des actions : ${errorText}`);
    }

    const execResult = await executeRes.json();
    console.log('Résultat de l\'exécution :', execResult);

    if (!execResult.success || execResult.executedCount !== 2) {
      throw new Error(`Échec de l'exécution, attendu 2 actions exécutées, reçu : ${execResult.executedCount}`);
    }

    // 6. Validation finale en base de données
    console.log('\n📊 --- VALIDATION EN BASE DE DONNEES ---');

    // Vérifier la création de la nouvelle tâche "Recruter développeur frontend" assignée à Alice
    const createdTask = await prisma.task.findFirst({
      where: {
        projectId,
        title: 'Recruter développeur frontend',
        deletedAt: null,
      },
      include: {
        assignees: true,
      },
    });

    if (!createdTask) {
      throw new Error('La nouvelle tâche "Recruter développeur frontend" n\'a pas été créée en DB.');
    }

    const hasAliceAssignee = createdTask.assignees.some(a => a.userId === userIdAlice);
    if (!hasAliceAssignee) {
      throw new Error('La tâche créée n\'est pas assignée à Alice.');
    }
    console.log(`✅ Nouvelle tâche créée en DB avec ID ${createdTask.id} et assignée à Alice.`);

    // Vérifier que la tâche existante "Configurer la sécurité globale" a bien été assignée à Alice
    const targetTaskUpdated = await prisma.task.findUnique({
      where: { id: targetTaskId },
      include: { assignees: true },
    });

    const isAliceAssignedToTarget = targetTaskUpdated.assignees.some(a => a.userId === userIdAlice);
    if (!isAliceAssignedToTarget) {
      throw new Error('La tâche "Configurer la sécurité globale" n\'est toujours pas assignée à Alice.');
    }
    console.log(`✅ Tâche de sécurité mise à jour et assignée à Alice.`);

    console.log('\n🎉 TOUS LES TESTS D\'INTEGRATION IA SONT AU VERT !');
  } catch (err) {
    console.error('❌ Erreur exécution/validation des actions :', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runAiTest();
