import { INestApplication } from '@nestjs/common';

/** Délai maximal de l'arrêt complet : au-delà, sortie en erreur plutôt qu'un SIGKILL du conteneur. */
export const SHUTDOWN_DEADLINE_MS = 8000;

/**
 * Arrêt ordonné sur SIGTERM et SIGINT (O23) : `app.close()` exécute les crochets de destruction
 * (Prisma, Redis, adaptateur Socket.IO), puis le processus sort en **code 0**.
 *
 * Pourquoi pas `app.enableShutdownHooks()` seul : après les crochets, NestJS se renvoie le signal
 * (`process.kill(process.pid, signal)`), donc le processus meurt « par signal » (143 sous Docker)
 * au lieu de sortir proprement. Node étant le PID 1 du conteneur, sans gestionnaire SIGTERM est
 * ignoré et `docker stop` finit en SIGKILL (137).
 */
export function installShutdownSignals(app: INestApplication): void {
  let closing = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} reçu : arrêt en cours.`);
    setTimeout(() => process.exit(1), SHUTDOWN_DEADLINE_MS).unref();
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error("Erreur pendant l'arrêt :", err);
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
