const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3009';

async function runImprovementsTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let tokenGaetan = '';
  let tokenAlice = '';
  let userIdGaetan = '';
  let userIdAlice = '';

  // 1. Authentification des deux utilisateurs mockés (Gaëtan = OWNER par défaut, Alice = simple membre)
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

  const headersA = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenAlice}`,
  };

  // 2. Création d'un projet par Gaëtan
  let project = null;
  try {
    const projRes = await fetch(`${BACKEND_URL}/projects`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        name: 'Projet Robustesse',
        description: 'Projet pour tester la détection de cycles et le contrôle RBAC.',
      }),
    });
    project = await projRes.json();
    console.log(`✅ Projet créé par Gaëtan. ID: ${project.id}, Workspace ID: ${project.workspaceId}`);
  } catch (err) {
    console.error('❌ Erreur lors de la création du projet :', err.message);
    process.exit(1);
  }

  // Ajouter Alice en tant que simple membre (MEMBER) du workspace de Gaëtan directement en BDD
  try {
    // Nettoyer si existant
    await prisma.membership.deleteMany({
      where: {
        workspaceId: project.workspaceId,
        userId: userIdAlice,
      }
    });

    await prisma.membership.create({
      data: {
        workspaceId: project.workspaceId,
        userId: userIdAlice,
        role: 'MEMBER',
      },
    });
    console.log(`✅ Alice a été ajoutée en tant que simple membre (MEMBER) au workspace de Gaëtan.`);
  } catch (err) {
    console.error('❌ Erreur lors de l\'ajout d\'Alice au workspace de Gaëtan :', err.message);
    process.exit(1);
  }

  // 3. Test de la détection de cycles de dépendances (DFS)
  try {
    console.log('\n🔗 --- TEST DE LA DETECTION DE CYCLES DE DEPENDANCES ---');
    
    // Créer la tâche A
    const tARes = await fetch(`${BACKEND_URL}/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({ title: 'Tâche A', priority: 'HIGH' }),
    });
    const taskA = await tARes.json();

    // Créer la tâche B
    const tBRes = await fetch(`${BACKEND_URL}/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({ title: 'Tâche B', priority: 'HIGH' }),
    });
    const taskB = await tBRes.json();

    // Créer la dépendance 1 : Task B dépend de Task A (A -> B)
    const dep1Res = await fetch(`${BACKEND_URL}/projects/tasks/${taskB.id}/dependencies`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({ dependsOnTaskId: taskA.id, type: 'FINISH_TO_START' }),
    });
    if (!dep1Res.ok) throw new Error('Échec création de la dépendance A -> B');
    console.log('✅ Dépendance A -> B créée avec succès.');

    // Tenter de créer la dépendance cyclique : Task A dépend de Task B (B -> A)
    console.log('Tentation de créer la dépendance cyclique B -> A...');
    const dep2Res = await fetch(`${BACKEND_URL}/projects/tasks/${taskA.id}/dependencies`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({ dependsOnTaskId: taskB.id, type: 'FINISH_TO_START' }),
    });

    if (dep2Res.status === 400) {
      const errData = await dep2Res.json();
      console.log(`✅ Détection de cycle réussie ! Code: 400. Message: "${errData.message}"`);
    } else {
      throw new Error(`Le backend a accepté une dépendance cyclique ! Status: ${dep2Res.status}`);
    }
  } catch (err) {
    console.error('❌ Échec du test de détection de cycles :', err.message);
    process.exit(1);
  }

  // 4. Test du Contrôle d'Accès par Rôles (RBAC)
  try {
    console.log('\n🔐 --- TEST DU CONTROLE D\'ACCES PAR ROLES (RBAC) ---');
    
    // Alice (MEMBER) tente de créer un jalon sur le projet de Gaëtan
    console.log('Alice tente de créer un jalon (Action ADMIN)...');
    const jalonRes = await fetch(`${BACKEND_URL}/projects/${project.id}/milestones`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        name: 'Jalon Fraudeur',
        dueDate: new Date().toISOString(),
      }),
    });

    if (jalonRes.status === 403) {
      const errData = await jalonRes.json();
      console.log(`✅ Tentative rejetée avec succès ! Code: 403 (Forbidden). Message: "${errData.message}"`);
    } else {
      throw new Error(`Le backend a autorisé un membre simple à créer un jalon ! Status: ${jalonRes.status}`);
    }
  } catch (err) {
    console.error('❌ Échec du test RBAC :', err.message);
    process.exit(1);
  }

  // 5. Test du filtrage temporel du calendrier
  try {
    console.log('\n📅 --- TEST DU FILTRAGE TEMPOREL DU CALENDRIER ---');
    
    // Créer deux timeblocks à des moments différents
    const tasksRes = await fetch(`${BACKEND_URL}/projects/${project.id}/tasks`, { headers: headersG });
    const projectTasks = await tasksRes.json();
    const task = projectTasks[0];

    // Créer un timeblock pour AUJOURD'HUI
    const todayStart = new Date();
    todayStart.setHours(10, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 1 * 60 * 60 * 1000);
    await fetch(`${BACKEND_URL}/projects/tasks/${task.id}/timeblocks`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({ startTime: todayStart.toISOString(), endTime: todayEnd.toISOString() }),
    });

    // Créer un timeblock pour DANS 10 JOURS
    const futureStart = new Date();
    futureStart.setDate(futureStart.getDate() + 10);
    futureStart.setHours(10, 0, 0, 0);
    const futureEnd = new Date(futureStart.getTime() + 1 * 60 * 60 * 1000);
    await fetch(`${BACKEND_URL}/projects/tasks/${task.id}/timeblocks`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({ startTime: futureStart.toISOString(), endTime: futureEnd.toISOString() }),
    });

    // Requêter le calendrier sans filtre
    const tbResAll = await fetch(`${BACKEND_URL}/projects/timeblocks/all`, { headers: headersG });
    const tbAll = await tbResAll.json();
    console.log(`Total de blocs de temps sans filtre : ${tbAll.length}`);

    // Requêter le calendrier avec filtre (uniquement aujourd'hui et demain)
    const filterEnd = new Date();
    filterEnd.setDate(filterEnd.getDate() + 2);
    const tbResFiltered = await fetch(
      `${BACKEND_URL}/projects/timeblocks/all?start=${new Date().toISOString()}&end=${filterEnd.toISOString()}`,
      { headers: headersG }
    );
    const tbFiltered = await tbResFiltered.json();
    console.log(`Total de blocs de temps filtrés (2 prochains jours) : ${tbFiltered.length}`);

    if (tbFiltered.length < tbAll.length) {
      console.log('✅ Le filtrage temporel fonctionne à la perfection !');
    } else {
      throw new Error('Le filtre temporel n\'a pas restreint le nombre de blocs de temps retournés.');
    }
  } catch (err) {
    console.error('❌ Échec du test du calendrier :', err.message);
    process.exit(1);
  }

  // 6. Test d'élimination des faux positifs dans les Notes
  try {
    console.log('\n📝 --- TEST DU PARSER DE NOTES SANS FAUX POSITIFS ---');
    
    const noteContent = `# Documentation technique\n\n` +
      `Voici un exemple de code à ne pas parseer :\n` +
      `\`\`\`markdown\n` +
      `- [ ] Tâche d'exemple dans un bloc de code #ProjetFaux\n` +
      `\`\`\`\n\n` +
      `Voici une vraie tâche :\n` +
      `- [ ] Configurer le déploiement réel #ProjetRobustesse\n`;

    const noteRes = await fetch(`${BACKEND_URL}/notes`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        title: 'Notes avec exemples de code',
        content: noteContent,
      }),
    });
    const noteData = await noteRes.json();

    // Inspecter la note
    const fetchNoteRes = await fetch(`${BACKEND_URL}/notes/${noteData.id}`, { headers: headersG });
    const fullNote = await fetchNoteRes.json();

    console.log(`Tâches extraites de la note :`);
    fullNote.tasks?.forEach(t => {
      console.log(`  - ${t.title}`);
    });

    const fakeTask = fullNote.tasks?.find(t => t.title.includes('Tâche d\'exemple'));
    const realTask = fullNote.tasks?.find(t => t.title.includes('Configurer le déploiement'));

    if (!fakeTask && realTask) {
      console.log('✅ Succès ! Les blocs de code Markdown ont été correctement ignorés.');
      console.log('🎉 TOUTES LES AMÉLIORATIONS SONT SUCCÈS À 100% !');
    } else {
      throw new Error('Le parser a extrait la tâche d\'exemple située dans le bloc de code.');
    }
  } catch (err) {
    console.error('❌ Échec du test du parseur de notes :', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runImprovementsTest();
