const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

async function runInvitationsTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let tokenGaetan = '';
  let tokenAlice = '';
  let userIdGaetan = '';
  let userIdAlice = '';
  let workspaceId = '';

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

  // 2. Récupérer un workspace appartenant à Gaëtan ou en créer un
  try {
    const workRes = await prisma.workspace.findFirst({
      where: { ownerId: userIdGaetan, deletedAt: null },
    });

    if (workRes) {
      workspaceId = workRes.id;
      console.log(`ℹ️ Workspace existant de Gaëtan utilisé : "${workRes.name}" (ID: ${workspaceId})`);
    } else {
      // Créer un workspace par API ou directement en base
      const newWorkspace = await prisma.workspace.create({
        data: {
          name: 'Workspace de Gaëtan',
          ownerId: userIdGaetan,
        },
      });
      // Créer aussi le membership correspondant
      await prisma.membership.create({
        data: {
          workspaceId: newWorkspace.id,
          userId: userIdGaetan,
          role: 'OWNER',
        },
      });
      workspaceId = newWorkspace.id;
      console.log(`✅ Nouveau Workspace créé pour Gaëtan : "${newWorkspace.name}" (ID: ${workspaceId})`);
    }

    // S'assurer qu'Alice n'est pas déjà membre pour que le test d'acceptation soit significatif
    await prisma.membership.deleteMany({
      where: {
        workspaceId,
        userId: userIdAlice,
      },
    });
    console.log(`🧹 Nettoyage : Alice retirée du workspace (si elle y était).`);
  } catch (err) {
    console.error('❌ Erreur d\'initialisation du Workspace :', err.message);
    process.exit(1);
  }

  // 3. Test de création d'une invitation par Gaëtan
  let invitationToken = '';
  let invitationId = '';
  try {
    console.log('\n✉️ --- TEST DE CRÉATION D\'INVITATION ---');
    const inviteRes = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/invitations`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        email: 'alice@plannerpro.com',
        role: 'MEMBER',
        durationDays: 2,
      }),
    });

    if (!inviteRes.ok) {
      const errorText = await inviteRes.text();
      throw new Error(`Échec création d'invitation: ${errorText}`);
    }

    const inviteData = await inviteRes.json();
    invitationToken = inviteData.rawToken;
    invitationId = inviteData.invitation.id;
    console.log(`✅ Invitation créée avec succès par Gaëtan !`);
    console.log(`   ID Invitation: ${invitationId}`);
    console.log(`   Token Brut (exposé une seule fois) : ${invitationToken}`);
  } catch (err) {
    console.error('❌ Erreur création invitation :', err.message);
    process.exit(1);
  }

  // 4. Test de listing des invitations par Gaëtan
  try {
    console.log('\n📋 --- TEST DE LISTING DES INVITATIONS ---');
    const listRes = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/invitations`, {
      headers: headersG,
    });

    if (!listRes.ok) {
      throw new Error(`Échec du listing: ${listRes.statusText}`);
    }

    const invitations = await listRes.json();
    const found = invitations.find(inv => inv.id === invitationId);
    if (!found) {
      throw new Error("L'invitation créée n'apparaît pas dans la liste des invitations en attente.");
    }
    console.log(`✅ L'invitation figure bien dans la liste des invitations actives.`);
  } catch (err) {
    console.error('❌ Erreur listing invitations :', err.message);
    process.exit(1);
  }

  // 5. Test de vérification du token (Endpoint Public)
  try {
    console.log('\n🔍 --- TEST DE VÉRIFICATION DU TOKEN (PUBLIC) ---');
    const checkRes = await fetch(`${BACKEND_URL}/projects/invitations/check/${invitationToken}`);

    if (!checkRes.ok) {
      const errorText = await checkRes.text();
      throw new Error(`Échec vérification token: ${errorText}`);
    }

    const checkData = await checkRes.json();
    console.log(`✅ Token valide ! Infos publiques récupérées :`);
    console.log(`   Workspace ciblé: ${checkData.workspaceName}`);
    console.log(`   Invité par : ${checkData.invitedByName}`);
    console.log(`   Rôle proposé : ${checkData.role}`);
  } catch (err) {
    console.error('❌ Erreur vérification token :', err.message);
    process.exit(1);
  }

  // 6. Test d'acceptation de l'invitation par Alice
  try {
    console.log('\n🤝 --- TEST D\'ACCEPTATION DE L\'INVITATION PAR ALICE ---');
    const acceptRes = await fetch(`${BACKEND_URL}/projects/invitations/accept/${invitationToken}`, {
      method: 'POST',
      headers: headersA,
    });

    if (!acceptRes.ok) {
      const errorText = await acceptRes.text();
      throw new Error(`Échec acceptation invitation: ${errorText}`);
    }

    const acceptData = await acceptRes.json();
    console.log(`✅ Invitation acceptée ! Message : "${acceptData.message}"`);

    // Vérifier en BDD qu'Alice est maintenant membre
    const membership = await prisma.membership.findFirst({
      where: {
        workspaceId,
        userId: userIdAlice,
      },
    });

    if (!membership || membership.role !== 'MEMBER') {
      throw new Error("Alice n'a pas été ajoutée correctement en base ou n'a pas le bon rôle.");
    }
    console.log(`✅ Validation BDD réussie : Alice est bien MEMBER du workspace.`);
  } catch (err) {
    console.error('❌ Erreur acceptation invitation :', err.message);
    process.exit(1);
  }

  // 7. Test de rejet de ré-acceptation
  try {
    console.log('\n🛡️ --- TEST DE DOUBLE ACCEPTATION ---');
    const acceptRes = await fetch(`${BACKEND_URL}/projects/invitations/accept/${invitationToken}`, {
      method: 'POST',
      headers: headersA,
    });

    if (acceptRes.ok) {
      throw new Error("L'API aurait dû rejeter la double acceptation d'une même invitation.");
    }

    const errData = await acceptRes.json();
    console.log(`✅ Double acceptation bloquée avec succès. Code : ${acceptRes.status}, Message : "${errData.message}"`);
  } catch (err) {
    console.error('❌ Erreur double acceptation :', err.message);
    process.exit(1);
  }

  // 8. Test de révocation d'une invitation
  try {
    console.log('\n🚫 --- TEST DE RÉVOCATION DE L\'INVITATION ---');
    
    // Créer une nouvelle invitation
    const inviteRes = await fetch(`${BACKEND_URL}/projects/workspaces/${workspaceId}/invitations`, {
      method: 'POST',
      headers: headersG,
      body: JSON.stringify({
        email: 'revoked@plannerpro.com',
        role: 'MEMBER',
      }),
    });
    const inviteData = await inviteRes.json();
    const tokenToRevoke = inviteData.rawToken;
    const inviteIdToRevoke = inviteData.invitation.id;

    console.log(`ℹ️ Nouvelle invitation créée pour révocation. ID: ${inviteIdToRevoke}`);

    // Révoquer l'invitation
    const revokeRes = await fetch(`${BACKEND_URL}/projects/invitations/${inviteIdToRevoke}`, {
      method: 'DELETE',
      headers: headersG,
    });

    if (!revokeRes.ok) {
      const errorText = await revokeRes.text();
      throw new Error(`Échec révocation invitation: ${errorText}`);
    }
    console.log(`✅ Invitation révoquée avec succès par l'administrateur.`);

    // Essayer de vérifier le token révoqué
    const checkRes = await fetch(`${BACKEND_URL}/projects/invitations/check/${tokenToRevoke}`);
    if (checkRes.ok) {
      throw new Error("L'API a validé un token qui a été révoqué.");
    }
    console.log(`✅ L'endpoint public rejette correctement l'invitation révoquée.`);

    // Essayer de l'accepter
    const acceptRes = await fetch(`${BACKEND_URL}/projects/invitations/accept/${tokenToRevoke}`, {
      method: 'POST',
      headers: headersA,
    });
    if (acceptRes.ok) {
      throw new Error("L'API a accepté une invitation révoquée.");
    }
    const errData = await acceptRes.json();
    console.log(`✅ Acceptation de l'invitation révoquée bloquée avec succès. Message : "${errData.message}"`);
  } catch (err) {
    console.error('❌ Erreur lors du test de révocation :', err.message);
    process.exit(1);
  }

  console.log('\n🎉 --- TOUS LES TESTS D\'INTÉGRATION CLI D\'INVITATION PASSENT AVEC SUCCÈS ! ---');
  process.exit(0);
}

runInvitationsTest();
