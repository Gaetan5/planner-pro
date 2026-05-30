const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

async function runOptimizeTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let token = '';
  let userId = '';

  // 1. Connexion Mock (Gaëtan)
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
    console.log(`✅ Authentifié sous le nom de : ${loginData.user.name} (ID: ${userId})`);
  } catch (err) {
    console.error('❌ Erreur lors de la connexion mock :', err.message);
    process.exit(1);
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // 2. Récupérer les workspaces de l'utilisateur pour trouver l'activeWorkspaceId
  let workspaceId = '';
  try {
    const wsRes = await fetch(`${BACKEND_URL}/projects/workspaces`, { headers });
    if (!wsRes.ok) {
      throw new Error(`Échec de récupération des workspaces: ${wsRes.statusText}`);
    }
    const workspaces = await wsRes.json();
    if (workspaces.length === 0) {
      throw new Error('Aucun workspace disponible.');
    }
    workspaceId = workspaces[0].id;
    console.log(`✅ Espace de travail récupéré ! ID: ${workspaceId}`);
  } catch (err) {
    console.error('❌ Erreur lors de la récupération du workspace :', err.message);
    process.exit(1);
  }

  // 3. Récupérer un deuxième utilisateur pour tester la répartition
  let otherUserId = '';
  try {
    const membersRes = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/members`, { headers });
    if (!membersRes.ok) {
      throw new Error(`Échec de récupération des membres: ${membersRes.statusText}`);
    }
    const members = await membersRes.json();
    const otherMember = members.find(m => m.userId !== userId);
    if (!otherMember) {
      console.log('⚠️ Un seul membre dans le workspace. Le test d\'équilibrage se fera sur un seul membre (trivial).');
      otherUserId = userId; // Fallback
    } else {
      otherUserId = otherMember.userId;
      console.log(`✅ Deuxième membre identifié pour l'équilibrage ! ID: ${otherUserId}`);
    }
  } catch (err) {
    console.error('❌ Erreur lors de la récupération des membres :', err.message);
    process.exit(1);
  }

  // 4. Configurer les profils de capacité des deux membres
  // Dev 1 (Gaëtan) : Capacité de 1000 minutes (16.6h)
  // Dev 2 (Autre)  : Capacité de 2000 minutes (33.3h)
  try {
    const updateProfile = async (uId, hours) => {
      const res = await fetch(`${BACKEND_URL}/projects/resources/${uId}/profile`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          weeklyCapacityMinutes: Math.round(hours * 60),
          skills: 'React, Node, Test',
        }),
      });
      if (!res.ok) {
        throw new Error(`Échec de configuration du profil pour ${uId}: ${res.statusText}`);
      }
    };

    await updateProfile(userId, 16.6); // ~1000 mins
    if (otherUserId !== userId) {
      await updateProfile(otherUserId, 33.3); // ~2000 mins
    }
    console.log('✅ Profils de ressources configurés (Dev A : 1000m, Dev B : 2000m)');
  } catch (err) {
    console.error('❌ Erreur de configuration des profils :', err.message);
    process.exit(1);
  }

  // 5. Création d'un projet et de 3 tâches d'importance variable
  let project = null;
  try {
    const projRes = await fetch(`${BACKEND_URL}/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Projet Test Optimisation Gloutonne',
        description: 'Projet temporaire pour valider le répartiteur de charge.',
        status: 'ACTIVE',
        workspaceId,
      }),
    });
    project = await projRes.json();
    console.log(`✅ Projet de test créé ! ID: ${project.id}`);

    const createTask = async (title, priority, minutes) => {
      const res = await fetch(`${BACKEND_URL}/projects/${project.id}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title,
          priority,
          estimatedMinutes: minutes,
        }),
      });
      return res.json();
    };

    // Créer :
    // Task 1: 600 min, HIGH
    // Task 2: 400 min, HIGH
    // Task 3: 500 min, MEDIUM
    const t1 = await createTask('Tâche 1 (Lourde & Prioritaire)', 'HIGH', 600);
    const t2 = await createTask('Tâche 2 (Moyenne & Prioritaire)', 'HIGH', 400);
    const t3 = await createTask('Tâche 3 (Moyenne & Secondaire)', 'MEDIUM', 500);
    console.log('✅ 3 Tâches créées (T1: 600m HIGH, T2: 400m HIGH, T3: 500m MEDIUM)');
  } catch (err) {
    console.error('❌ Erreur lors de la préparation des tâches :', err.message);
    process.exit(1);
  }

  // 6. Lancer l'optimiseur glouton
  console.log(`📡 Lancement de l'optimiseur glouton sur le workspace...`);
  try {
    const optRes = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/resources/optimize`, {
      method: 'POST',
      headers,
    });

    if (!optRes.ok) {
      throw new Error(`Échec de l'optimisation: ${optRes.statusText}`);
    }

    const optResult = await optRes.json();
    console.log(`✅ Réallocation terminée avec succès ! Résultat :`, optResult);
  } catch (err) {
    console.error('❌ Erreur lors de la réallocation des ressources :', err.message);
    process.exit(1);
  }

  // 7. Vérifier que les tâches sont équitablement réparties
  // Si deux développeurs distincts existent, la T1 (600) doit aller au Dev A, et T2 (400) + T3 (500) au Dev B.
  if (otherUserId !== userId) {
    try {
      const checkRes = await fetch(`${BACKEND_URL}/projects/${project.id}`, { headers });
      const fullProject = await checkRes.json();
      const tasks = fullProject.tasks;

      const t1Updated = tasks.find(t => t.title.includes('Tâche 1'));
      const t2Updated = tasks.find(t => t.title.includes('Tâche 2'));
      const t3Updated = tasks.find(t => t.title.includes('Tâche 3'));

      const t1Assignee = t1Updated.assignees[0]?.userId;
      const t2Assignee = t2Updated.assignees[0]?.userId;
      const t3Assignee = t3Updated.assignees[0]?.userId;

      console.log('\n🔍 --- INSPECTION DES AFFECTATIONS FINALES ---');
      console.log(`Tâche 1 (600m) assignée à : ${t1Assignee === userId ? 'Dev A (Gaëtan)' : 'Dev B'}`);
      console.log(`Tâche 2 (400m) assignée à : ${t2Assignee === userId ? 'Dev A (Gaëtan)' : 'Dev B'}`);
      console.log(`Tâche 3 (500m) assignée à : ${t3Assignee === userId ? 'Dev A (Gaëtan)' : 'Dev B'}`);
      console.log('-----------------------------------------------\n');

      if (t1Assignee && t2Assignee && t3Assignee) {
        if (t1Assignee !== t2Assignee && t2Assignee === t3Assignee) {
          console.log('🎉 SUCCÈS COMPLET : L\'algorithme glouton a équilibré la charge de manière optimale !');
        } else {
          console.log('⚠️ Répartition faite mais possiblement sur un seul membre ou non conventionnelle (vérifier les profils).');
        }
      } else {
        console.error('❌ ÉCHEC : Certaines tâches n\'ont pas été assignées !');
        process.exit(1);
      }
    } catch (err) {
      console.error('❌ Erreur de vérification des affectations :', err.message);
      process.exit(1);
    }
  } else {
    console.log('🎉 Validation terminée. (Membre unique, pas d\'équilibrage possible).');
  }
}

runOptimizeTest();
