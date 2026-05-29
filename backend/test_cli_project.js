const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002'; // Port mapped on host for Docker

async function runTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let token = '';
  let userId = '';

  // 1. Connexion Mock
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

  // 2. Création du projet
  let project = null;
  try {
    const projRes = await fetch(`${BACKEND_URL}/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Projet Test CLI (Expert Mode)',
        description: 'Projet professionnel créé directement en ligne de commande.',
        status: 'ACTIVE',
        startDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });

    if (!projRes.ok) {
      throw new Error(`Échec de création du projet: ${projRes.statusText}`);
    }

    project = await projRes.json();
    console.log(`✅ Projet créé avec succès ! ID: ${project.id}, Workspace ID: ${project.workspaceId}`);
  } catch (err) {
    console.error('❌ Erreur lors de la création du projet :', err.message);
    process.exit(1);
  }

  // 3. Création d'un Jalon
  try {
    const milestoneRes = await fetch(`${BACKEND_URL}/projects/${project.id}/milestones`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Jalon de Conception',
        description: 'Validation de l\'architecture et du design system.',
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });

    if (!milestoneRes.ok) {
      throw new Error(`Échec de création du jalon: ${milestoneRes.statusText}`);
    }

    const milestone = await milestoneRes.json();
    console.log(`✅ Jalon créé avec succès ! ID: ${milestone.id}, Nom: "${milestone.name}"`);
  } catch (err) {
    console.error('❌ Erreur lors de la création du jalon :', err.message);
    process.exit(1);
  }

  // 4. Création d'un Livrable
  try {
    const delRes = await fetch(`${BACKEND_URL}/projects/${project.id}/deliverables`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Spécifications Techniques',
        description: 'Document de conception complet rédigé.',
        status: 'READY_FOR_REVIEW',
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });

    if (!delRes.ok) {
      throw new Error(`Échec de création du livrable: ${delRes.statusText}`);
    }

    const deliverable = await delRes.json();
    console.log(`✅ Livrable créé avec succès ! ID: ${deliverable.id}, Titre: "${deliverable.title}", Statut: "${deliverable.status}"`);
  } catch (err) {
    console.error('❌ Erreur lors de la création du livrable :', err.message);
    process.exit(1);
  }

  // 5. Récupération complète du projet avec toutes ses relations professionnelles
  try {
    const fetchRes = await fetch(`${BACKEND_URL}/projects/${project.id}`, {
      headers,
    });

    if (!fetchRes.ok) {
      throw new Error(`Échec de récupération du projet: ${fetchRes.statusText}`);
    }

    const fullProject = await fetchRes.json();
    console.log('\n🔍 --- INSPECTION DU PROJET CRÉÉ ---');
    console.log(`Nom:          ${fullProject.name}`);
    console.log(`Description:  ${fullProject.description}`);
    console.log(`Statut:       ${fullProject.status}`);
    console.log(`Workspace:    ${fullProject.workspace?.name || 'Inconnu'}`);
    console.log(`Jalons:       [${fullProject.milestones?.map(m => m.name).join(', ')}]`);
    console.log(`Livrables:    [${fullProject.deliverables?.map(d => d.title).join(', ')}]`);
    console.log('-------------------------------------\n');
    console.log('🎉 TOUT PASSE CORRECTEMENT EN LIGNE DE COMMANDE ! 100% SUCCÈS.');
  } catch (err) {
    console.error('❌ Erreur lors de la récupération du projet :', err.message);
    process.exit(1);
  }
}

runTest();
