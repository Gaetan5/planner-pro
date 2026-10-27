/**
 * Suite de tests automatisés des règles Firestore sur émulateur.
 *
 * Valide les 4 scénarios de la spécification docs/conception-regles-firestore.md :
 *  1. Accès autorisé (OWNER, ADMIN, MEMBER, VIEWER)
 *  2. Isolation inter-équipes (workspace A vs workspace B)
 *  3. Escalade de privilèges (VIEWER/MEMBER ne peuvent pas supprimer ni gérer les rôles)
 *  4. Espace personnel (accès restreint au propriétaire Firebase)
 *
 * Prérequis :
 *  - Java 11+ installé (pour l'émulateur Firestore)
 *  - firebase-tools installé globalement ou via npx
 *  - @firebase/rules-unit-testing installé dans le backend
 *
 * Exécution :
 *  pnpm --filter backend jest --testPathPattern firestore-rules
 *
 * L'émulateur est démarré et arrêté automatiquement par initializeTestEnvironment.
 */
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Constantes de test ───────────────────────────────────────────────

const WORKSPACE_ALPHA = 'workspace-alpha';
const WORKSPACE_BETA = 'workspace-beta';
const PROJECT_ID = 'project-1';
const TASK_ID = 'task-1';

const USERS = {
  owner: { uid: 'uid-owner', email: 'owner@planner.pro', email_verified: true },
  admin: { uid: 'uid-admin', email: 'admin@planner.pro', email_verified: true },
  member: { uid: 'uid-member', email: 'member@planner.pro', email_verified: true },
  viewer: { uid: 'uid-viewer', email: 'viewer@planner.pro', email_verified: true },
  outsider: { uid: 'uid-outsider', email: 'outsider@evil.com', email_verified: true },
  unverified: { uid: 'uid-unverified', email: 'unverified@planner.pro', email_verified: false },
} as const;

// ─── Environnement de test ────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rulesPath = resolve(__dirname, '../../../firestore.rules');
  const rules = readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: 'planner-pro-test',
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8181,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

// ─── Helper : amorcer les adhésions d'un workspace ────────────────────

async function seedMemberships(workspaceId: string) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();

    // Document workspace racine
    batch.set(db.doc(`workspaces/${workspaceId}`), {
      name: `Équipe ${workspaceId}`,
      createdAt: new Date().toISOString(),
    });

    // Adhésions avec rôles
    batch.set(db.doc(`workspaces/${workspaceId}/entities/membership:${USERS.owner.uid}`), {
      role: 'OWNER',
      userId: USERS.owner.uid,
      joinedAt: new Date().toISOString(),
    });
    batch.set(db.doc(`workspaces/${workspaceId}/entities/membership:${USERS.admin.uid}`), {
      role: 'ADMIN',
      userId: USERS.admin.uid,
      joinedAt: new Date().toISOString(),
    });
    batch.set(db.doc(`workspaces/${workspaceId}/entities/membership:${USERS.member.uid}`), {
      role: 'MEMBER',
      userId: USERS.member.uid,
      joinedAt: new Date().toISOString(),
    });
    batch.set(db.doc(`workspaces/${workspaceId}/entities/membership:${USERS.viewer.uid}`), {
      role: 'VIEWER',
      userId: USERS.viewer.uid,
      joinedAt: new Date().toISOString(),
    });

    // Projet et tâche de test
    batch.set(db.doc(`workspaces/${workspaceId}/projects/${PROJECT_ID}`), {
      name: 'Projet Alpha',
      status: 'ACTIVE',
    });
    batch.set(db.doc(`workspaces/${workspaceId}/projects/${PROJECT_ID}/tasks/${TASK_ID}`), {
      title: 'Tâche de test',
      status: 'TODO',
    });

    // Entité diverse (commentaire)
    batch.set(db.doc(`workspaces/${workspaceId}/entities/comment:comment-1`), {
      text: 'Premier commentaire',
      authorId: USERS.member.uid,
    });

    await batch.commit();
  });
}

// ─── Helper : contexte authentifié ────────────────────────────────────

function authedDb(user: (typeof USERS)[keyof typeof USERS]) {
  return testEnv
    .authenticatedContext(user.uid, {
      email: user.email,
      email_verified: user.email_verified,
    })
    .firestore();
}

function unauthDb() {
  return testEnv.unauthenticatedContext().firestore();
}

// ═══════════════════════════════════════════════════════════════════════
// SCÉNARIO 1 : Accès autorisé — droits par rôle
// ═══════════════════════════════════════════════════════════════════════

describe('Scénario 1 : Accès autorisé par rôle', () => {
  beforeAll(async () => {
    await testEnv.clearFirestore();
    await seedMemberships(WORKSPACE_ALPHA);
  });

  // ─── Lecture ─────────────────────────────────────────────────────

  describe('Lecture workspace / projets / tâches', () => {
    it.each([
      ['OWNER', USERS.owner],
      ['ADMIN', USERS.admin],
      ['MEMBER', USERS.member],
      ['VIEWER', USERS.viewer],
    ])('%s peut lire le workspace', async (_role, user) => {
      const db = authedDb(user);
      await assertSucceeds(db.doc(`workspaces/${WORKSPACE_ALPHA}`).get());
    });

    it.each([
      ['OWNER', USERS.owner],
      ['ADMIN', USERS.admin],
      ['MEMBER', USERS.member],
      ['VIEWER', USERS.viewer],
    ])('%s peut lire un projet', async (_role, user) => {
      const db = authedDb(user);
      await assertSucceeds(db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/${PROJECT_ID}`).get());
    });

    it.each([
      ['OWNER', USERS.owner],
      ['ADMIN', USERS.admin],
      ['MEMBER', USERS.member],
      ['VIEWER', USERS.viewer],
    ])('%s peut lire une tâche', async (_role, user) => {
      const db = authedDb(user);
      await assertSucceeds(
        db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/${PROJECT_ID}/tasks/${TASK_ID}`).get(),
      );
    });

    it.each([
      ['OWNER', USERS.owner],
      ['ADMIN', USERS.admin],
      ['MEMBER', USERS.member],
      ['VIEWER', USERS.viewer],
    ])('%s peut lire une entité (commentaire)', async (_role, user) => {
      const db = authedDb(user);
      await assertSucceeds(
        db.doc(`workspaces/${WORKSPACE_ALPHA}/entities/comment:comment-1`).get(),
      );
    });
  });

  // ─── Écriture workspace ──────────────────────────────────────────

  describe('Écriture du document workspace', () => {
    it('OWNER peut modifier le workspace', async () => {
      const db = authedDb(USERS.owner);
      await assertSucceeds(
        db.doc(`workspaces/${WORKSPACE_ALPHA}`).update({ name: 'Équipe renommée' }),
      );
    });

    it('ADMIN peut modifier le workspace', async () => {
      const db = authedDb(USERS.admin);
      await assertSucceeds(
        db.doc(`workspaces/${WORKSPACE_ALPHA}`).update({ name: 'Équipe admin' }),
      );
    });

    it('MEMBER ne peut PAS modifier le workspace', async () => {
      const db = authedDb(USERS.member);
      await assertFails(
        db.doc(`workspaces/${WORKSPACE_ALPHA}`).update({ name: 'Tentative membre' }),
      );
    });

    it('VIEWER ne peut PAS modifier le workspace', async () => {
      const db = authedDb(USERS.viewer);
      await assertFails(
        db.doc(`workspaces/${WORKSPACE_ALPHA}`).update({ name: 'Tentative viewer' }),
      );
    });
  });

  // ─── Création / Mise à jour de projets ───────────────────────────

  describe('Création et mise à jour de projets', () => {
    it('OWNER peut créer un projet', async () => {
      const db = authedDb(USERS.owner);
      await assertSucceeds(
        db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/p-new-owner`).set({
          name: 'Projet Owner',
          status: 'DRAFT',
        }),
      );
    });

    it('ADMIN peut créer un projet', async () => {
      const db = authedDb(USERS.admin);
      await assertSucceeds(
        db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/p-new-admin`).set({
          name: 'Projet Admin',
          status: 'DRAFT',
        }),
      );
    });

    it('MEMBER peut créer un projet', async () => {
      const db = authedDb(USERS.member);
      await assertSucceeds(
        db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/p-new-member`).set({
          name: 'Projet Member',
          status: 'DRAFT',
        }),
      );
    });

    it('VIEWER ne peut PAS créer de projet', async () => {
      const db = authedDb(USERS.viewer);
      await assertFails(
        db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/p-new-viewer`).set({
          name: 'Tentative Viewer',
          status: 'DRAFT',
        }),
      );
    });
  });

  // ─── Création / Mise à jour de tâches ────────────────────────────

  describe('Création et mise à jour de tâches', () => {
    it('MEMBER peut créer une tâche', async () => {
      const db = authedDb(USERS.member);
      await assertSucceeds(
        db
          .doc(`workspaces/${WORKSPACE_ALPHA}/projects/${PROJECT_ID}/tasks/t-new-member`)
          .set({ title: 'Nouvelle tâche', status: 'TODO' }),
      );
    });

    it('VIEWER ne peut PAS créer de tâche', async () => {
      const db = authedDb(USERS.viewer);
      await assertFails(
        db
          .doc(`workspaces/${WORKSPACE_ALPHA}/projects/${PROJECT_ID}/tasks/t-new-viewer`)
          .set({ title: 'Tentative viewer', status: 'TODO' }),
      );
    });

    it('MEMBER peut mettre à jour une tâche existante', async () => {
      const db = authedDb(USERS.member);
      await assertSucceeds(
        db
          .doc(`workspaces/${WORKSPACE_ALPHA}/projects/${PROJECT_ID}/tasks/${TASK_ID}`)
          .update({ status: 'IN_PROGRESS' }),
      );
    });
  });

  // ─── Création / Mise à jour d'entités ────────────────────────────

  describe("Création et mise à jour d'entités (commentaires, notes...)", () => {
    it('MEMBER peut créer un commentaire', async () => {
      const db = authedDb(USERS.member);
      await assertSucceeds(
        db
          .doc(`workspaces/${WORKSPACE_ALPHA}/entities/comment:c-new`)
          .set({ text: 'Nouveau commentaire', authorId: USERS.member.uid }),
      );
    });

    it('VIEWER ne peut PAS créer de commentaire', async () => {
      const db = authedDb(USERS.viewer);
      await assertFails(
        db
          .doc(`workspaces/${WORKSPACE_ALPHA}/entities/comment:c-viewer`)
          .set({ text: 'Interdit', authorId: USERS.viewer.uid }),
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SCÉNARIO 2 : Isolation inter-équipes
// ═══════════════════════════════════════════════════════════════════════

describe('Scénario 2 : Isolation inter-équipes', () => {
  beforeAll(async () => {
    await testEnv.clearFirestore();
    // Alpha : owner, admin, member, viewer sont membres
    await seedMemberships(WORKSPACE_ALPHA);

    // Beta : seul outsider est membre
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const batch = db.batch();
      batch.set(db.doc(`workspaces/${WORKSPACE_BETA}`), { name: 'Équipe Beta' });
      batch.set(db.doc(`workspaces/${WORKSPACE_BETA}/entities/membership:${USERS.outsider.uid}`), {
        role: 'OWNER',
        userId: USERS.outsider.uid,
      });
      batch.set(db.doc(`workspaces/${WORKSPACE_BETA}/projects/proj-beta`), {
        name: 'Projet secret Beta',
      });
      batch.set(db.doc(`workspaces/${WORKSPACE_BETA}/entities/note:note-beta`), {
        content: 'Note confidentielle Beta',
      });
      await batch.commit();
    });
  });

  it('OWNER de Alpha ne peut PAS lire le workspace Beta', async () => {
    const db = authedDb(USERS.owner);
    await assertFails(db.doc(`workspaces/${WORKSPACE_BETA}`).get());
  });

  it('OWNER de Alpha ne peut PAS lire un projet de Beta', async () => {
    const db = authedDb(USERS.owner);
    await assertFails(db.doc(`workspaces/${WORKSPACE_BETA}/projects/proj-beta`).get());
  });

  it('OWNER de Alpha ne peut PAS lire une entité de Beta', async () => {
    const db = authedDb(USERS.owner);
    await assertFails(db.doc(`workspaces/${WORKSPACE_BETA}/entities/note:note-beta`).get());
  });

  it('MEMBER de Alpha ne peut PAS écrire dans Beta', async () => {
    const db = authedDb(USERS.member);
    await assertFails(
      db.doc(`workspaces/${WORKSPACE_BETA}/entities/comment:hack`).set({ text: 'Intrusion' }),
    );
  });

  it('outsider (membre de Beta) peut lire le workspace Beta', async () => {
    const db = authedDb(USERS.outsider);
    await assertSucceeds(db.doc(`workspaces/${WORKSPACE_BETA}`).get());
  });

  it('outsider ne peut PAS lire le workspace Alpha', async () => {
    const db = authedDb(USERS.outsider);
    await assertFails(db.doc(`workspaces/${WORKSPACE_ALPHA}`).get());
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SCÉNARIO 3 : Escalade de privilèges
// ═══════════════════════════════════════════════════════════════════════

describe('Scénario 3 : Escalade de privilèges', () => {
  beforeAll(async () => {
    await testEnv.clearFirestore();
    await seedMemberships(WORKSPACE_ALPHA);
  });

  // ─── Suppression de projets ──────────────────────────────────────

  it('MEMBER ne peut PAS supprimer un projet', async () => {
    const db = authedDb(USERS.member);
    await assertFails(db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/${PROJECT_ID}`).delete());
  });

  it('VIEWER ne peut PAS supprimer un projet', async () => {
    const db = authedDb(USERS.viewer);
    await assertFails(db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/${PROJECT_ID}`).delete());
  });

  it('OWNER peut supprimer un projet', async () => {
    // Créer un projet jetable pour le test de suppression
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(`workspaces/${WORKSPACE_ALPHA}/projects/p-disposable`).set({
        name: 'Jetable',
      });
    });
    const db = authedDb(USERS.owner);
    await assertSucceeds(db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/p-disposable`).delete());
  });

  it('ADMIN peut supprimer un projet', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(`workspaces/${WORKSPACE_ALPHA}/projects/p-disposable-2`).set({
        name: 'Jetable 2',
      });
    });
    const db = authedDb(USERS.admin);
    await assertSucceeds(db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/p-disposable-2`).delete());
  });

  // ─── Suppression de tâches ───────────────────────────────────────

  it('MEMBER ne peut PAS supprimer une tâche', async () => {
    const db = authedDb(USERS.member);
    await assertFails(
      db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/${PROJECT_ID}/tasks/${TASK_ID}`).delete(),
    );
  });

  it('VIEWER ne peut PAS supprimer une tâche', async () => {
    const db = authedDb(USERS.viewer);
    await assertFails(
      db.doc(`workspaces/${WORKSPACE_ALPHA}/projects/${PROJECT_ID}/tasks/${TASK_ID}`).delete(),
    );
  });

  // ─── Manipulation des adhésions (escalade de rôle) ───────────────

  it('MEMBER ne peut PAS modifier son propre rôle (escalade)', async () => {
    const db = authedDb(USERS.member);
    await assertFails(
      db
        .doc(`workspaces/${WORKSPACE_ALPHA}/entities/membership:${USERS.member.uid}`)
        .update({ role: 'OWNER' }),
    );
  });

  it('VIEWER ne peut PAS modifier son propre rôle (escalade)', async () => {
    const db = authedDb(USERS.viewer);
    await assertFails(
      db
        .doc(`workspaces/${WORKSPACE_ALPHA}/entities/membership:${USERS.viewer.uid}`)
        .update({ role: 'ADMIN' }),
    );
  });

  it('VIEWER ne peut PAS créer une adhésion pour un autre utilisateur', async () => {
    const db = authedDb(USERS.viewer);
    await assertFails(
      db.doc(`workspaces/${WORKSPACE_ALPHA}/entities/membership:uid-hacker`).set({
        role: 'ADMIN',
        userId: 'uid-hacker',
      }),
    );
  });

  it('OWNER peut supprimer une entité (commentaire)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context
        .firestore()
        .doc(`workspaces/${WORKSPACE_ALPHA}/entities/comment:c-to-delete`)
        .set({ text: 'À supprimer' });
    });
    const db = authedDb(USERS.owner);
    await assertSucceeds(
      db.doc(`workspaces/${WORKSPACE_ALPHA}/entities/comment:c-to-delete`).delete(),
    );
  });

  it('MEMBER ne peut PAS supprimer une entité', async () => {
    const db = authedDb(USERS.member);
    await assertFails(db.doc(`workspaces/${WORKSPACE_ALPHA}/entities/comment:comment-1`).delete());
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SCÉNARIO 4 : Espace personnel
// ═══════════════════════════════════════════════════════════════════════

describe('Scénario 4 : Espace personnel', () => {
  const personalWs = `personal-${USERS.owner.uid}`;

  beforeAll(async () => {
    await testEnv.clearFirestore();
    // Créer un espace personnel pour owner
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const batch = db.batch();
      batch.set(db.doc(`workspaces/${personalWs}`), { name: 'Mon espace' });
      batch.set(db.doc(`workspaces/${personalWs}/projects/p-perso`), {
        name: 'Projet perso',
      });
      batch.set(db.doc(`workspaces/${personalWs}/entities/note:n-perso`), {
        content: 'Note privée',
      });
      await batch.commit();
    });
  });

  it('le propriétaire peut lire son espace personnel', async () => {
    const db = authedDb(USERS.owner);
    await assertSucceeds(db.doc(`workspaces/${personalWs}`).get());
  });

  it('le propriétaire peut écrire dans son espace personnel', async () => {
    const db = authedDb(USERS.owner);
    await assertSucceeds(db.doc(`workspaces/${personalWs}`).update({ name: 'Mon espace renommé' }));
  });

  it('le propriétaire peut créer un projet dans son espace personnel', async () => {
    const db = authedDb(USERS.owner);
    await assertSucceeds(
      db.doc(`workspaces/${personalWs}/projects/p-perso-new`).set({ name: 'Nouveau projet' }),
    );
  });

  it('le propriétaire peut supprimer une entité de son espace', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(`workspaces/${personalWs}/entities/note:n-delete`).set({
        content: 'À supprimer',
      });
    });
    const db = authedDb(USERS.owner);
    await assertSucceeds(db.doc(`workspaces/${personalWs}/entities/note:n-delete`).delete());
  });

  it("un autre utilisateur authentifié ne peut PAS lire l'espace personnel", async () => {
    const db = authedDb(USERS.member);
    await assertFails(db.doc(`workspaces/${personalWs}`).get());
  });

  it("un autre utilisateur ne peut PAS lire un projet de l'espace personnel", async () => {
    const db = authedDb(USERS.outsider);
    await assertFails(db.doc(`workspaces/${personalWs}/projects/p-perso`).get());
  });

  it("un autre utilisateur ne peut PAS écrire dans l'espace personnel", async () => {
    const db = authedDb(USERS.admin);
    await assertFails(
      db.doc(`workspaces/${personalWs}/entities/note:n-hack`).set({ content: 'Intrusion' }),
    );
  });

  it("un utilisateur non authentifié ne peut PAS accéder à l'espace personnel", async () => {
    const db = unauthDb();
    await assertFails(db.doc(`workspaces/${personalWs}`).get());
  });

  it('un utilisateur avec email non vérifié ne peut PAS accéder à un espace personnel', async () => {
    const db = authedDb(USERS.unverified);
    await assertFails(db.doc(`workspaces/${personalWs}`).get());
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SCÉNARIO BONUS : Accès non authentifié et email non vérifié
// ═══════════════════════════════════════════════════════════════════════

describe('Accès non authentifié et email non vérifié', () => {
  beforeAll(async () => {
    await testEnv.clearFirestore();
    await seedMemberships(WORKSPACE_ALPHA);
  });

  it('un utilisateur non authentifié ne peut PAS lire un workspace', async () => {
    const db = unauthDb();
    await assertFails(db.doc(`workspaces/${WORKSPACE_ALPHA}`).get());
  });

  it('un utilisateur non authentifié ne peut PAS écrire dans un workspace', async () => {
    const db = unauthDb();
    await assertFails(
      db.doc(`workspaces/${WORKSPACE_ALPHA}/entities/comment:anon`).set({ text: 'Anon' }),
    );
  });

  it('un utilisateur avec email non vérifié ne peut PAS lire un workspace', async () => {
    // Même s'il a une adhésion, l'email non vérifié bloque
    const db = authedDb(USERS.unverified);
    await assertFails(db.doc(`workspaces/${WORKSPACE_ALPHA}`).get());
  });

  it('la protection globale deny-all bloque les chemins hors workspaces', async () => {
    const db = authedDb(USERS.owner);
    await assertFails(db.doc('some-random-collection/doc-1').get());
  });

  it("la protection globale deny-all bloque l'écriture sur les chemins hors workspaces", async () => {
    const db = authedDb(USERS.owner);
    await assertFails(db.doc('some-random-collection/doc-1').set({ hack: true }));
  });
});
