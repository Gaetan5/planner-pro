const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3002';

async function runVoiceTest() {
  console.log(`📡 Connexion au backend sur ${BACKEND_URL}...`);

  let tokenGaetan = '';
  let tokenAlice = '';
  let userIdGaetan = '';
  let userIdAlice = '';
  let workspaceId = '';
  let projectId = '';

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
    'Authorization': `Bearer ${tokenGaetan}`,
  };

  // 2. Récupérer ou créer un workspace et un projet
  try {
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

    let projRes = await prisma.project.findFirst({
      where: { workspaceId, deletedAt: null },
    });

    if (!projRes) {
      const pRes = await fetch(`${BACKEND_URL}/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headersG
        },
        body: JSON.stringify({
          name: 'Projet Vocale',
          description: 'Pour tester les fonctionnalités vocales.',
          workspaceId,
        }),
      });
      projRes = await pRes.json();
    }
    projectId = projRes.id;
    console.log(`ℹ️ Projet utilisé : "${projRes.name}" (ID: ${projectId})`);
  } catch (err) {
    console.error('❌ Erreur de configuration de départ :', err.message);
    process.exit(1);
  }

  // 3. Test d'upload audio multipart avec bypass mock
  try {
    console.log('\n🎙️ --- TEST UPLOAD AUDIO ET SPEECH-TO-TEXT ---');
    
    // Création du FormData avec les méta-données et le fichier factice
    const formData = new FormData();
    const mockAudioBlob = new Blob([Buffer.from('fake-audio-content')], { type: 'audio/webm' });
    formData.append('file', mockAudioBlob, 'mock-voice.webm');
    formData.append('workspaceId', workspaceId);
    if (projectId) {
      formData.append('projectId', projectId);
    }
    formData.append('isMock', 'true');

    const voiceRes = await fetch(`${BACKEND_URL}/projects/ai/voice`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenGaetan}`
      },
      body: formData
    });

    if (!voiceRes.ok) {
      const errorText = await voiceRes.text();
      throw new Error(`Échec de l'appel d'API voix: ${errorText}`);
    }

    const data = await voiceRes.json();
    console.log('Réponse vocale reçue :', JSON.stringify(data, null, 2));

    if (!data.transcription) {
      throw new Error('La transcription est vide ou absente.');
    }

    if (data.transcription !== 'MOCK: créer tâche Configurer la sécurité globale pour Alice') {
      throw new Error(`Transcription incorrecte : reçu "${data.transcription}"`);
    }

    if (!Array.isArray(data.actions) || data.actions.length === 0) {
      throw new Error("Aucune action n'a été résolue.");
    }

    const action = data.actions[0];
    if (action.type !== 'CREATE_TASK') {
      throw new Error(`Type d'action incorrect : attendu CREATE_TASK, reçu ${action.type}`);
    }

    if (action.assigneeId !== userIdAlice) {
      throw new Error(`Assigné non résolu : attendu l'ID d'Alice (${userIdAlice}), reçu ${action.assigneeId}`);
    }

    console.log('✅ Transcription réussie : ' + data.transcription);
    console.log('✅ Résolution d\'entités sur Alice réussie !');
    console.log('\n🎉 TOUS LES TESTS D\'INTEGRATION VOCALE EN CLI SONT AU VERT !');

  } catch (err) {
    console.error('❌ Erreur lors du test d\'intégration vocale :', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runVoiceTest();
