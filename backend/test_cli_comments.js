const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

async function runCommentsTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let tokenGaetan = '';
  let tokenAlice = '';
  let userIdGaetan = '';
  let userIdAlice = '';
  let workspaceId = '';
  let projectId = '';
  let taskId = '';

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

  const headersA = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenAlice}`,
  };

  // 2. Récupérer ou créer un workspace et un projet
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
      // Créer par API
      const pRes = await fetch(`${BACKEND_URL}/projects`, {
        method: 'POST',
        headers: headersG,
        body: JSON.stringify({
          name: 'Projet de Discussion',
          description: 'Pour tester les commentaires et mentions.',
          workspaceId,
        }),
      });
      projRes = await pRes.json();
    }
    projectId = projRes.id;
    console.log(`ℹ️ Projet utilisé : "${projRes.name}" (ID: ${projectId})`);

    // Créer une tâche sous le projet pour les commentaires
    const taskRes = await fetch(`${BACKEND_URL}/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        title: 'Tâche pour Commentaires',
        priority: 'MEDIUM',
      }),
    });
    const taskData = await taskRes.json();
    taskId = taskData.id;
    console.log(`✅ Tâche créée pour discussion (ID: ${taskId})`);
  } catch (err) {
    console.error('❌ Erreur de configuration de départ :', err.message);
    process.exit(1);
  }

  // 3. Test d'ajout de commentaire par Alice
  let aliceCommentId = '';
  try {
    console.log('\n💬 --- TEST D\'AJOUT DE COMMENTAIRE PAR ALICE ---');
    const commentRes = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        content: 'Je commence à travailler sur cette tâche.',
      }),
    });

    if (!commentRes.ok) {
      const errorText = await commentRes.text();
      throw new Error(`Échec ajout commentaire Alice: ${errorText}`);
    }

    const comment = await commentRes.json();
    aliceCommentId = comment.id;
    console.log(`✅ Commentaire d'Alice ajouté avec succès ! ID: ${aliceCommentId}`);
    console.log(`   Contenu : "${comment.content}"`);
  } catch (err) {
    console.error('❌ Erreur ajout commentaire Alice :', err.message);
    process.exit(1);
  }

  // 3b. Test de modification du commentaire par Alice (auteur)
  try {
    console.log('\n💬 --- TEST DE MODIFICATION DE COMMENTAIRE PAR L\'AUTEUR (ALICE) ---');
    const updateRes = await fetch(`${BACKEND_URL}/projects/comments/${aliceCommentId}`, {
      method: 'PUT',
      headers: headersA,
      body: JSON.stringify({
        content: 'Je commence à travailler sur cette tâche (commentaire mis à jour).',
      }),
    });

    if (!updateRes.ok) {
      const errorText = await updateRes.text();
      throw new Error(`Échec modification commentaire Alice: ${errorText}`);
    }

    const updatedComment = await updateRes.json();
    console.log(`✅ Commentaire d'Alice modifié avec succès ! ID: ${updatedComment.id}`);
    console.log(`   Nouveau contenu : "${updatedComment.content}"`);
    if (updatedComment.content !== 'Je commence à travailler sur cette tâche (commentaire mis à jour).') {
      throw new Error("Le contenu retourné après modification ne correspond pas !");
    }
  } catch (err) {
    console.error('❌ Erreur modification commentaire Alice :', err.message);
    process.exit(1);
  }

  // 3c. Test de modification interdite : Gaëtan tente de modifier le commentaire d'Alice (doit échouer)
  try {
    console.log('\n🛡️ --- TEST DE MODIFICATION NON AUTORISÉE (PAR UN AUTRE MEMBRE) ---');
    const updateRes = await fetch(`${BACKEND_URL}/projects/comments/${aliceCommentId}`, {
      method: 'PUT',
      headers: headersG, // Gaëtan
      body: JSON.stringify({
        content: 'Gaëtan pirate le commentaire d\'Alice.',
      }),
    });

    if (updateRes.ok) {
      throw new Error("Gaëtan a pu modifier le commentaire d'Alice alors qu'il n'en est pas l'auteur.");
    }

    const errData = await updateRes.json();
    console.log(`✅ Blocage réussi. Code : ${updateRes.status}, Message : "${errData.message}"`);
  } catch (err) {
    console.error('❌ Erreur test de modification interdite :', err.message);
    process.exit(1);
  }

  // 4. Test d'ajout de commentaire avec Mention par Gaëtan
  let gaetanCommentId = '';
  try {
    console.log('\n💬 --- TEST DE MENTION @ALICE PAR GAËTAN ---');
    const commentRes = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        content: 'Super merci @Alice, tiens-moi au courant.',
      }),
    });

    if (!commentRes.ok) {
      const errorText = await commentRes.text();
      throw new Error(`Échec ajout commentaire Gaëtan: ${errorText}`);
    }

    const comment = await commentRes.json();
    gaetanCommentId = comment.id;
    console.log(`✅ Commentaire de Gaëtan ajouté avec succès ! ID: ${gaetanCommentId}`);
    console.log(`   Contenu : "${comment.content}"`);
    console.log(`   (Une notification WebSocket "mention-notification" a été émise en tâche de fond pour Alice)`);
  } catch (err) {
    console.error('❌ Erreur mention Gaëtan :', err.message);
    process.exit(1);
  }

  // 5. Test de récupération des commentaires de la tâche
  try {
    console.log('\n📋 --- TEST DE LISTING DES COMMENTAIRES ---');
    const listRes = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/comments`, {
      headers: headersA,
    });

    if (!listRes.ok) {
      throw new Error(`Échec listing commentaires: ${listRes.statusText}`);
    }

    const comments = await listRes.json();
    console.log(`✅ Récupéré ${comments.length} commentaires pour la tâche.`);
    
    const first = comments.find(c => c.id === aliceCommentId);
    const second = comments.find(c => c.id === gaetanCommentId);

    if (!first || !second) {
      throw new Error("L'un des commentaires n'a pas été trouvé dans la liste.");
    }

    console.log(`   - [${first.user.name || first.user.email}] : ${first.content}`);
    console.log(`   - [${second.user.name || second.user.email}] : ${second.content}`);
  } catch (err) {
    console.error('❌ Erreur listing commentaires :', err.message);
    process.exit(1);
  }

  // 6. Test de sécurité de suppression : Alice tente de supprimer le commentaire de Gaëtan (doit échouer)
  try {
    console.log('\n🛡️ --- TEST DE SUPPRESSION NON AUTORISÉE (RBAC) ---');
    const deleteRes = await fetch(`${BACKEND_URL}/projects/comments/${gaetanCommentId}`, {
      method: 'DELETE',
      headers: headersA, // Alice
    });

    if (deleteRes.ok) {
      throw new Error("Alice a pu supprimer le commentaire de Gaëtan alors qu'elle n'est pas l'auteur et n'est pas Admin du workspace.");
    }

    const errData = await deleteRes.json();
    console.log(`✅ Blocage réussi. Code : ${deleteRes.status}, Message : "${errData.message}"`);
  } catch (err) {
    console.error('❌ Erreur test de suppression interdite :', err.message);
    process.exit(1);
  }

  // 7. Test de suppression autorisée : Gaëtan supprime le commentaire d'Alice (doit réussir car Gaëtan est OWNER)
  try {
    console.log('\n🚫 --- TEST DE SUPPRESSION AUTORISÉE (PAR LE WORKSPACE OWNER) ---');
    const deleteRes = await fetch(`${BACKEND_URL}/projects/comments/${aliceCommentId}`, {
      method: 'DELETE',
      headers: headersG, // Gaëtan
    });

    if (!deleteRes.ok) {
      const errorText = await deleteRes.text();
      throw new Error(`Échec de la suppression par Gaëtan : ${errorText}`);
    }

    console.log(`✅ Commentaire d'Alice supprimé par Gaëtan (Workspace OWNER) avec succès.`);

    // Vérifier qu'il ne reste plus que le commentaire de Gaëtan
    const listRes = await fetch(`${BACKEND_URL}/projects/tasks/${taskId}/comments`, {
      headers: headersG,
    });
    const comments = await listRes.json();
    const foundAlice = comments.find(c => c.id === aliceCommentId);
    if (foundAlice) {
      throw new Error("Le commentaire supprimé figure toujours dans la base de données.");
    }
    console.log(`✅ Validation : Le commentaire a bien disparu de la liste des commentaires actifs.`);
  } catch (err) {
    console.error('❌ Erreur suppression autorisée :', err.message);
    process.exit(1);
  }

  console.log('\n🎉 --- TOUS LES TESTS D\'INTÉGRATION CLI DES COMMENTAIRES PASSENT AVEC SUCCÈS ! ---');
  process.exit(0);
}

runCommentsTest();
