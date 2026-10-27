import process from 'node:process';
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
import * as argon2 from 'argon2';

function createPrismaClient(): PrismaClient {
  const dbUrl = process.env.DATABASE_URL || 'mysql://root:root_password@localhost:3306/planner_pro';
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

const prisma = createPrismaClient();

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

async function main() {
  console.log('🌱 Amorçage de la base de données Planner Pro...');

  // ─── 1. Mots de passe par défaut ─────────────────────────────────────
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin123!Secure';
  const managerPassword = process.env.SEED_MANAGER_PASSWORD || 'Manager123!Secure';
  const userPassword = process.env.SEED_USER_PASSWORD || 'User123!Secure';

  const [adminHash, managerHash, userHash] = await Promise.all([
    hashPassword(adminPassword),
    hashPassword(managerPassword),
    hashPassword(userPassword),
  ]);

  // ─── 2. Utilisateurs ──────────────────────────────────────────────────
  // A. Administrateur plateforme
  const admin = await prisma.user.upsert({
    where: { email: 'admin@planner-pro.com' },
    update: {
      name: 'Administrateur Système',
      platformRole: PlatformRole.SUPER_ADMIN,
    },
    create: {
      email: 'admin@planner-pro.com',
      name: 'Administrateur Système',
      passwordHash: adminHash,
      platformRole: PlatformRole.SUPER_ADMIN,
    },
  });

  // B. Project Manager (Chef de projet)
  const manager = await prisma.user.upsert({
    where: { email: 'manager@planner-pro.com' },
    update: {
      name: 'Sarah Connor (Project Manager)',
    },
    create: {
      email: 'manager@planner-pro.com',
      name: 'Sarah Connor (Project Manager)',
      passwordHash: managerHash,
    },
  });

  // C. Utilisateur simple (Membre de l'équipe)
  const user = await prisma.user.upsert({
    where: { email: 'user@planner-pro.com' },
    update: {
      name: 'Alexandre Martin (Développeur)',
    },
    create: {
      email: 'user@planner-pro.com',
      name: 'Alexandre Martin (Développeur)',
      passwordHash: userHash,
    },
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
    update: { role: WorkspaceRole.OWNER },
    create: { workspaceId: workspace.id, userId: admin.id, role: WorkspaceRole.OWNER },
  });

  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: manager.id } },
    update: { role: WorkspaceRole.ADMIN },
    create: { workspaceId: workspace.id, userId: manager.id, role: WorkspaceRole.ADMIN },
  });

  await prisma.membership.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: { role: WorkspaceRole.MEMBER },
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
    update: { role: ProjectRole.MANAGER },
    create: { projectId: project.id, userId: manager.id, role: ProjectRole.MANAGER },
  });

  await prisma.projectMembership.upsert({
    where: { projectId_userId: { projectId: project.id, userId: user.id } },
    update: { role: ProjectRole.CONTRIBUTOR },
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
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔑 IDENTIFIANTS DE CONNEXION GÉNÉRÉS :');
  console.log(`   1. Compte Administrateur :`);
  console.log(`      Email : admin@planner-pro.com`);
  console.log(`      Mot de passe : ${adminPassword}`);
  console.log(`   2. Chef de Projet (Project Manager) :`);
  console.log(`      Email : manager@planner-pro.com`);
  console.log(`      Mot de passe : ${managerPassword}`);
  console.log(`   3. Utilisateur Simple (Développeur / Membre) :`);
  console.log(`      Email : user@planner-pro.com`);
  console.log(`      Mot de passe : ${userPassword}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors du seed :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
