const { PrismaClient } = require('@prisma/client');
const { createInterface } = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

async function main() {
  const prisma = new PrismaClient();
  const terminal = createInterface({ input: stdin, output: stdout });

  try {
    const email = (await terminal.question('E-mail du compte Firebase vérifié à promouvoir : '))
      .trim()
      .toLowerCase();

    if (!email) {
      throw new Error('Une adresse e-mail est requise.');
    }

    const admin = await prisma.$transaction(async (transaction) => {
      const existingAdmins = await transaction.user.count({
        where: { platformRole: { not: null } },
      });
      if (existingAdmins > 0) {
        throw new Error("Un administrateur de plateforme existe déjà; utilisez l'interface admin.");
      }

      const user = await transaction.user.findUnique({
        where: { email },
        select: { id: true, email: true, firebaseUid: true },
      });
      if (!user?.firebaseUid) {
        throw new Error(
          "Compte introuvable ou non vérifié par Firebase. Connectez-vous d'abord avec Firebase.",
        );
      }

      await transaction.user.update({
        where: { id: user.id },
        data: { platformRole: 'SUPER_ADMIN' },
      });
      await transaction.platformAuditLog.create({
        data: {
          actorId: user.id,
          action: 'platform.admin.bootstrap',
          targetType: 'User',
          targetId: user.id,
          metadata: { source: 'operator_cli' },
        },
      });

      return user;
    });
    stdout.write(`Rôle SUPER_ADMIN attribué à ${admin.email}.\n`);
  } finally {
    terminal.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Échec du bootstrap administrateur.');
  process.exitCode = 1;
});
