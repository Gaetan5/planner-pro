import process from 'node:process';
import { createHash } from 'node:crypto';
import {
  PrismaClient,
  PlatformRole,
  WorkspaceRole,
  ProjectRole,
  ProjectStatus,
  TaskStatus,
  TaskPriority,
} from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import * as argon2 from 'argon2';

/**
 * S30 : le seed ne contient AUCUNE valeur par défaut et ne ré-élève jamais un compte existant.
 * Les mots de passe viennent obligatoirement de SEED_*_PASSWORD.
 */
const ALLOWED_NODE_ENVS = ['development', 'test', 'staging', 'production'];
const MIN_PASSWORD_LENGTH = 16;

/**
 * Empreintes SHA-256 des trois mots de passe publiés dans l'historique Git (compromis). Stockées
 * sous forme d'empreintes pour que le code source ne contienne plus les valeurs elles-mêmes.
 */
const PUBLISHED_PASSWORD_SHA256 = new Set([
  '304a85c3a748ef27b0a80e552bdc5b731302216146f59fbb42623fbabccd70ba',
  '8cfd7cac2428c24f23fe91426046622b86ec0d57c677f794d949a24c438e6120',
  'd4596660629ec702ff7464cb5f085a9e1628a6bd88ee2529487f4107e1f5c4ae',
]);

export class SeedConfigError extends Error {}

export interface SeedConfig {
  production: boolean;
  firebaseSync: boolean;
  passwords: { admin: string; manager: string; user: string };
}

type Env = Record<string, string | undefined>;

/** Valide l'environnement. Ne produit aucun effet de bord : appelée avant toute écriture. */
export function resolveSeedConfig(env: Env): SeedConfig {
  const nodeEnv = env.NODE_ENV?.trim();
  if (!nodeEnv) {
    throw new SeedConfigError('NODE_ENV est obligatoire (aucun mode développement implicite).');
  }
  if (!ALLOWED_NODE_ENVS.includes(nodeEnv)) {
    throw new SeedConfigError(`NODE_ENV inconnu : ${ALLOWED_NODE_ENVS.join(', ')} attendus.`);
  }

  const names = ['SEED_ADMIN_PASSWORD', 'SEED_MANAGER_PASSWORD', 'SEED_USER_PASSWORD'] as const;
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new SeedConfigError(`Variables obligatoires manquantes : ${missing.join(', ')}.`);
  }
  const values = names.map((name) => env[name] as string);
  names.forEach((name, i) => {
    const digest = createHash('sha256').update(values[i]).digest('hex');
    if (PUBLISHED_PASSWORD_SHA256.has(digest)) {
      throw new SeedConfigError(`${name} : valeur publiée dans le dépôt, refusée.`);
    }
    if (values[i].length < MIN_PASSWORD_LENGTH) {
      throw new SeedConfigError(`${name} : ${MIN_PASSWORD_LENGTH} caractères minimum.`);
    }
  });
  if (new Set(values).size !== values.length) {
    throw new SeedConfigError('Les trois mots de passe du seed doivent être différents.');
  }

  const production = nodeEnv === 'production';
  if (production && env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new SeedConfigError(
      'Refusé en production sans SEED_ALLOW_PRODUCTION=true (et les trois SEED_*_PASSWORD).',
    );
  }

  return {
    production,
    // Firebase est coupé en production sauf drapeau explicite
    firebaseSync: !production || env.SEED_ALLOW_FIREBASE_IN_PRODUCTION === 'true',
    passwords: { admin: values[0], manager: values[1], user: values[2] },
  };
}

function createPrismaClient(env: Env): PrismaClient {
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    throw new SeedConfigError('DATABASE_URL est obligatoire (aucune URL par défaut).');
  }
  const parsed = new URL(dbUrl);
  const adapter = new PrismaMariaDb({
    host: parsed.hostname,
    port: parseInt(parsed.port || '3306', 10),
    user: parsed.username,
    password: decodeURIComponent(parsed.password || ''),
    database: parsed.pathname.substring(1),
    allowPublicKeyRetrieval: true,
  });
  return new PrismaClient({ adapter });
}

function initFirebaseAuth(env: Env): Auth | null {
  const projectId = env.FIREBASE_PROJECT_ID;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.log('ℹ️ Firebase Auth non configuré (variables manquantes), seed MySQL uniquement.');
    return null;
  }

  const appName = 'planner-pro-seed-auth';
  const existingApp = getApps().find((a: App) => a.name === appName);
  const app =
    existingApp ??
    initializeApp(
      {
        credential: cert({ projectId, clientEmail, privateKey }),
      },
      appName,
    );

  return getAuth(app);
}

/**
 * Crée le compte Firebase s'il n'existe pas. Un compte existant n'est JAMAIS modifié (mot de
 * passe, e-mail vérifié) et n'est pas rattaché : on ne prend pas la main sur une identité déjà là.
 */
async function ensureFirebaseAuthUser(
  auth: Auth | null,
  email: string,
  password: string,
  displayName: string,
): Promise<string | null> {
  if (!auth) return null;

  try {
    try {
      await auth.getUserByEmail(email);
      console.log(`🔥 Compte Firebase Auth déjà présent, non modifié : ${email}`);
      return null;
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code !== 'auth/user-not-found') throw error;
    }
    const userRecord = await auth.createUser({
      email,
      password,
      displayName,
      emailVerified: true,
    });
    console.log(`🔥 Compte Firebase Auth créé : ${email}`);
    return userRecord.uid;
  } catch {
    // L'erreur brute peut contenir la requête : on ne journalise que l'adresse
    console.warn(`⚠️ Impossible de synchroniser ${email} avec Firebase Auth.`);
    return null;
  }
}

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/** Cœur du seed : toutes les entrées sont déjà validées, aucune lecture de l'environnement. */
export async function runSeed(prisma: PrismaClient, firebaseAuth: Auth | null, config: SeedConfig) {
  console.log('🌱 Amorçage de la base de données Planner Pro...');

  // ─── 1. Mots de passe (fournis obligatoirement par l'environnement) ───
  const adminPassword = config.passwords.admin;
  const managerPassword = config.passwords.manager;
  const userPassword = config.passwords.user;

  const [adminHash, managerHash, userHash] = await Promise.all([
    hashPassword(adminPassword),
    hashPassword(managerPassword),
    hashPassword(userPassword),
  ]);

  // ─── 2. Utilisateurs ──────────────────────────────────────────────────
  // Un compte existant n'est JAMAIS modifié (rôle, mot de passe, firebaseUid, suspension) :
  // le seed ne promeut, ne réactive et ne réinitialise rien. En production, aucun platformRole.
  const ensureUser = async (data: {
    email: string;
    name: string;
    passwordHash: string;
    password: string;
    platformRole?: PlatformRole;
  }) => {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) return existing;
    // Firebase seulement pour un compte MySQL créé ici : jamais pour un compte existant
    const firebaseUid = await ensureFirebaseAuthUser(
      firebaseAuth,
      data.email,
      data.password,
      data.name,
    );
    return prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash: data.passwordHash,
        ...(data.platformRole ? { platformRole: data.platformRole } : {}),
        ...(firebaseUid ? { firebaseUid } : {}),
      },
    });
  };

  const admin = await ensureUser({
    email: 'admin@planner-pro.com',
    name: 'Administrateur Système',
    passwordHash: adminHash,
    password: adminPassword,
    ...(config.production ? {} : { platformRole: PlatformRole.SUPER_ADMIN }),
  });
  const manager = await ensureUser({
    email: 'manager@planner-pro.com',
    name: 'Sarah Connor (Project Manager)',
    passwordHash: managerHash,
    password: managerPassword,
  });
  const user = await ensureUser({
    email: 'user@planner-pro.com',
    name: 'Alexandre Martin (Développeur)',
    passwordHash: userHash,
    password: userPassword,
  });

  console.log(`👤 Utilisateurs créés / vérifiés :`);
  console.log(`   - Admin : ${admin.email}`);
  console.log(`   - Project Manager : ${manager.email}`);
  console.log(`   - Utilisateur simple : ${user.email}`);

  // ─── 3. Workspace d'Organisation ──────────────────────────────────────
  let workspace = await prisma.workspace.findFirst({
    where: { name: 'Planner Pro Entreprise', ownerId: admin.id, deletedAt: null },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: 'Planner Pro Entreprise',
        ownerId: admin.id,
      },
    });
    console.log(`🏢 Workspace créé : ${workspace.name} (${workspace.id})`);
  }

  // ─── 4. Adhésions au Workspace (Memberships) ──────────────────────────
  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: admin.id } },
    update: {},
    create: { workspaceId: workspace.id, userId: admin.id, role: WorkspaceRole.OWNER },
  });

  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: manager.id } },
    update: {},
    create: { workspaceId: workspace.id, userId: manager.id, role: WorkspaceRole.ADMIN },
  });

  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: {},
    create: { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.MEMBER },
  });

  // ─── 5. Projet de Démonstration ───────────────────────────────────────
  const now = new Date();
  const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // il y a 7 jours
  const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // dans 30 jours

  let project = await prisma.project.findFirst({
    where: { name: 'Refonte Plateforme SaaS v2', workspaceId: workspace.id, deletedAt: null },
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        name: 'Refonte Plateforme SaaS v2',
        description:
          "Projet stratégique de refonte d'architecture, synchronisation temps réel et haute disponibilité.",
        status: ProjectStatus.ACTIVE,
        userId: admin.id,
        workspaceId: workspace.id,
        budgetCents: 4500000, // 45 000,00 €
        billingType: 'TIME_AND_MATERIALS',
        startDate,
        dueDate,
      },
    });
    console.log(`📁 Projet créé : ${project.name} (${project.id})`);
  }

  // Rôles au niveau du projet (ProjectMembership RBAC)
  await prisma.projectMembership.upsert({
    where: { projectId_userId: { projectId: project.id, userId: manager.id } },
    update: {},
    create: { projectId: project.id, userId: manager.id, role: ProjectRole.MANAGER },
  });

  await prisma.projectMembership.upsert({
    where: { projectId_userId: { projectId: project.id, userId: user.id } },
    update: {},
    create: { projectId: project.id, userId: user.id, role: ProjectRole.CONTRIBUTOR },
  });

  // ─── 6. Tâches de Démonstration ───────────────────────────────────────
  const existingTasks = await prisma.task.count({ where: { projectId: project.id } });

  if (existingTasks === 0) {
    const task1 = await prisma.task.create({
      data: {
        title: 'Définir la matrice de permissions RBAC et rôles projets',
        description:
          'Spécifier les permissions fines (MANAGER, CONTRIBUTOR, COMMENTER, CLIENT) et auditer les accès.',
        status: TaskStatus.DONE,
        priority: TaskPriority.HIGH,
        projectId: project.id,
        userId: manager.id,
        startDate: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
        dueDate: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
    });

    const task2 = await prisma.task.create({
      data: {
        title: 'Valider la synchronisation temps réel Firestore sur émulateur',
        description:
          'Exécuter la suite de 60 tests de sécurité des règles Firestore et promouvoir les règles validées.',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.HIGH,
        projectId: project.id,
        userId: user.id,
        startDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      },
    });

    const task3 = await prisma.task.create({
      data: {
        title: 'Rédiger la documentation technique et guide de déploiement',
        description:
          'Mettre à jour les manifestes et consigner le modèle CQRS dans le référentiel.',
        status: TaskStatus.TODO,
        priority: TaskPriority.MEDIUM,
        projectId: project.id,
        userId: manager.id,
        startDate: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000),
        dueDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
      },
    });

    const task4 = await prisma.task.create({
      data: {
        title: 'Tests de charge et audit de performance MySQL / Redis',
        description: 'Vérifier la latence sous charge et le bon fonctionnement du cache.',
        status: TaskStatus.TODO,
        priority: TaskPriority.LOW,
        projectId: project.id,
        userId: user.id,
        startDate: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000),
        dueDate: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
      },
    });

    // Commentaires collaboratifs de démonstration
    await prisma.comment.create({
      data: {
        content:
          'Les 60 tests sur émulateur Firestore sont validés à 100%. Aucune faille résiduelle !',
        taskId: task2.id,
        userId: manager.id,
      },
    });

    await prisma.comment.create({
      data: {
        content: 'Super nouvelle. Le modèle CQRS est acté et tout est propre.',
        taskId: task2.id,
        userId: user.id,
      },
    });

    console.log(`📋 4 tâches et commentaires créés avec succès pour le projet.`);
  }

  console.log('✅ Amorçage terminé avec succès !');
  console.log(
    `Comptes : ${admin.email}, ${manager.email}, ${user.email} (mots de passe : ceux fournis par SEED_*_PASSWORD).`,
  );
}

/** Point d'entrée : valide tout AVANT d'ouvrir la base ou Firebase. Lève en cas de refus. */
export async function main(env: Env = process.env): Promise<void> {
  const config = resolveSeedConfig(env);
  if (config.production) {
    console.warn(
      '⚠️ Seed exécuté en PRODUCTION (SEED_ALLOW_PRODUCTION=true) : aucun platformRole.',
    );
  }
  const prisma = createPrismaClient(env);
  try {
    await runSeed(prisma, config.firebaseSync ? initFirebaseAuth(env) : null, config);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error('❌ Erreur lors du seed :', e instanceof Error ? e.message : 'erreur inconnue');
    process.exit(1);
  });
}
