const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3009';

async function runFeaturesTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let token = '';
  let userId = '';

  // 1. Authentification Mock pour Gaëtan
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
    console.log(`✅ Authentifié : ${loginData.user.name} (ID: ${userId})`);
  } catch (err) {
    console.error('❌ Erreur d\'authentification :', err.message);
    process.exit(1);
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // 2. Récupération ou création du Projet
  let project = null;
  const projectName = 'SprintProjet';
  try {
    // Tenter de créer le projet
    const projRes = await fetch(`${BACKEND_URL}/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: projectName,
        description: 'Projet de démonstration des fonctionnalités intelligentes et planification.',
        status: 'PLANNING',
        startDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });

    if (projRes.ok) {
      project = await projRes.json();
      console.log(`✅ Projet "${projectName}" créé avec succès ! ID: ${project.id}`);
    } else {
      // Si déjà existant, récupérer la liste des projets et trouver celui qui correspond
      const listRes = await fetch(`${BACKEND_URL}/projects`, { headers });
      const projects = await listRes.json();
      project = projects.find(p => p.name === projectName);
      if (!project) throw new Error('Impossible de créer ou récupérer le projet.');
      console.log(`ℹ️ Projet "${projectName}" existant récupéré. ID: ${project.id}`);
    }
  } catch (err) {
    console.error('❌ Erreur de gestion de projet :', err.message);
    process.exit(1);
  }

  // 3. Création d'une Note Intelligente avec tâches automatisées
  let note = null;
  try {
    const noteContent = `# Notes de cadrage du projet\n\n` +
      `Voici les actions requises pour le lancement :\n` +
      `- [ ] Configurer la base de données de test #${projectName}\n` +
      `- [ ] Développer les maquettes de l'agenda #${projectName}\n` +
      `- [ ] Finaliser l'architecture dnd #${projectName}\n\n` +
      `À faire pour la suite : explorer les sockets.`;

    const noteRes = await fetch(`${BACKEND_URL}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Sprint 1 - Setup & Conception',
        content: noteContent,
      }),
    });

    if (!noteRes.ok) {
      throw new Error(`Échec de création de la note: ${noteRes.statusText}`);
    }

    note = await noteRes.json();
    console.log(`✅ Note intelligente créée avec succès ! ID: ${note.id}`);
  } catch (err) {
    console.error('❌ Erreur de création de la note :', err.message);
    process.exit(1);
  }

  // Attendre un peu que le parsing asynchrone des tâches s'exécute si nécessaire
  // (Le parser est appelé de manière synchrone avant le retour de createNote dans le service)

  // 4. Inspection des tâches extraites de la note intelligente
  let tasks = [];
  try {
    // Récupérer la note avec ses relations
    const fetchNoteRes = await fetch(`${BACKEND_URL}/notes/${note.id}`, { headers });
    const fullNote = await fetchNoteRes.json();
    
    console.log('\n📝 --- INSPECTION DE LA NOTE INTELLIGENTE APRES PARSING ---');
    console.log(`Titre : ${fullNote.title}`);
    console.log(`Contenu mis à jour avec les IDs de tâches :`);
    console.log(fullNote.content);
    console.log(`Tâches liées en BDD :`);
    fullNote.tasks?.forEach(t => {
      console.log(`  - [${t.status === 'DONE' ? 'x' : ' '}] ${t.title} (ID: ${t.id}, ProjetID: ${t.projectId})`);
      tasks.push(t);
    });
    console.log('----------------------------------------------------------\n');

    if (tasks.length === 0) {
      throw new Error('Aucune tâche n\'a été extraite de la note !');
    }
    console.log(`✅ Extraction des tâches validée (${tasks.length} tâches créées et liées).`);
  } catch (err) {
    console.error('❌ Erreur d\'inspection des tâches de la note :', err.message);
    process.exit(1);
  }

  // 5. Planification : Créer une dépendance de tâche (Gantt/Planification)
  // La tâche 2 dépend de la tâche 1
  const t1 = tasks[0];
  const t2 = tasks[1];
  try {
    console.log(`🔗 Création d'une dépendance : "${t2.title}" dépend de "${t1.title}"...`);
    const depRes = await fetch(`${BACKEND_URL}/projects/tasks/${t2.id}/dependencies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dependsOnTaskId: t1.id,
        type: 'FINISH_TO_START',
      }),
    });

    if (!depRes.ok) {
      throw new Error(`Échec de création de la dépendance: ${depRes.statusText}`);
    }

    console.log(`✅ Dépendance de planification créée avec succès !`);
  } catch (err) {
    console.error('❌ Erreur de création de la dépendance :', err.message);
    process.exit(1);
  }

  // 6. Gestion du Calendrier : Création d'un Timeblock (Time-blocking) pour la tâche 1
  let timeBlock = null;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const startTime = tomorrow.toISOString();
  const endTime = new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000).toISOString(); // 2 heures

  try {
    console.log(`📅 Planification d'un bloc horaire pour "${t1.title}"...`);
    const tbRes = await fetch(`${BACKEND_URL}/projects/tasks/${t1.id}/timeblocks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        startTime,
        endTime,
      }),
    });

    if (!tbRes.ok) {
      throw new Error(`Échec de création du Timeblock: ${tbRes.statusText}`);
    }

    timeBlock = await tbRes.json();
    console.log(`✅ Timeblock créé avec succès ! ID: ${timeBlock.id}, de ${startTime} à ${endTime}`);
  } catch (err) {
    console.error('❌ Erreur de création du Timeblock :', err.message);
    process.exit(1);
  }

  // 7. Gestion de l'Équipe : Chargement des membres du Workspace
  try {
    console.log(`👥 Récupération des membres de l'équipe du Workspace principal...`);
    const membersRes = await fetch(`${BACKEND_URL}/projects/members`, { headers });
    
    if (!membersRes.ok) {
      throw new Error(`Échec de récupération des membres: ${membersRes.statusText}`);
    }

    const members = await membersRes.json();
    console.log(`✅ Membres de l'équipe récupérés :`);
    members.forEach(m => {
      console.log(`  - ${m.user?.name || 'Inconnu'} (${m.user?.email}) - Rôle: ${m.role}`);
    });
  } catch (err) {
    console.error('❌ Erreur de récupération des membres :', err.message);
    process.exit(1);
  }

  // 8. Synchronisation Double Sens : Passer le statut de la tâche 1 à DONE
  // Et vérifier que la case à cocher correspondante dans la note est mise à jour en [x]
  try {
    console.log(`🔄 Mise à jour du statut de la tâche "${t1.title}" à DONE...`);
    const updateRes = await fetch(`${BACKEND_URL}/projects/tasks/${t1.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        status: 'DONE',
      }),
    });

    if (!updateRes.ok) {
      throw new Error(`Échec de mise à jour de la tâche: ${updateRes.statusText}`);
    }

    console.log(`✅ Statut de la tâche mis à jour en DONE.`);

    // Récupérer à nouveau la note pour observer la synchronisation
    const fetchNoteRes2 = await fetch(`${BACKEND_URL}/notes/${note.id}`, { headers });
    const fullNote2 = await fetchNoteRes2.json();

    console.log('\n📝 --- INSPECTION DE LA NOTE APRES SYNCHRONISATION ---');
    console.log(fullNote2.content);
    console.log('------------------------------------------------------\n');

    // Vérifier si la première case est cochée
    const lines = fullNote2.content.split('\n');
    const targetLine = lines.find(l => l.includes(t1.id));
    if (targetLine && targetLine.includes('- [x]')) {
      console.log('🎉 TOUS LES FLUX DE BOUT EN BOUT SONT VALIDÉS ET 100% FONCTIONNELS !');
      console.log('Calendrier (Timeblocks), Planification (Dépendances), Notes intelligentes et Équipes fonctionnent de concert.');
    } else {
      throw new Error('La note n\'a pas été synchronisée correctement (case non cochée).');
    }
  } catch (err) {
    console.error('❌ Erreur de synchronisation double sens :', err.message);
    process.exit(1);
  }
}

runFeaturesTest();
