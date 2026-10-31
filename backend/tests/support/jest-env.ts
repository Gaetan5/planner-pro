/**
 * Environnement commun des tests (A7) : aucun test ne doit atteindre une vraie base. Sans
 * `E2E_DATABASE_URL` explicite (suite e2e dédiée), `DATABASE_URL` vise une adresse injoignable
 * (port 1) : une base de développement qui écoute sur localhost:3306 n'est jamais touchée, même
 * si un service est instancié par erreur ou si `DATABASE_URL` est exportée dans le shell.
 */
process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'mysql://test:test@127.0.0.1:1/planner_pro_test';
