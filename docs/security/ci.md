# Intégration continue (A9)

Workflow : `.github/workflows/ci.yml`. Déclencheurs : `pull_request` (toutes les branches) et `push` sur `main` et `security/**`. Node 22 et pnpm 10 (épinglé par `packageManager`) partout, `--frozen-lockfile` partout, actions GitHub épinglées par SHA complet.

| Job                | Rôle                                                                                                                                                            | Échoue si                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `secrets-scan`     | gitleaks sur l'arbre et sur les commits de la PR (S30)                                                                                                          | un secret apparaît                                                                                                        |
| `audit`            | `pnpm audit --prod --audit-level=high`                                                                                                                          | un avis de gravité `high` ou `critical` touche une dépendance de production (les avis moindres : `audit-exceptions.md`)   |
| `build-and-test`   | build, absence de `mock/login` dans le bundle, lint, typecheck des tests, vitest, jest                                                                          | une régression unitaire ou HTTP                                                                                           |
| `e2e`              | MySQL 8 et Redis 7 en services, `prisma migrate deploy`, puis `jest --config jest-e2e.json`                                                                     | un test e2e échoue (dont S3 : un ticket MFA accepté comme jeton d'accès)                                                  |
| `migrations`       | `migrate deploy`, `migrate diff --from-config-datasource --to-schema --exit-code`, rejeu du SQL de la migration de dérive (`db execute`), second `migrate diff` | les migrations ne produisent pas le schéma de `schema/*.prisma`, ou la migration de dérive n'est pas idempotente (r47-m1) |
| `frontend-headers` | construit l'image `frontend/Dockerfile.prod`, la démarre, lance `scripts/check-headers.sh`                                                                      | un en-tête de sécurité manque sur `/` ou sur un asset `.js`                                                               |

## Exécuter la suite e2e en local

La suite crée et supprime des comptes : elle refuse toute base dont le nom ne se termine pas par `_test` ou `_e2e`.

```sh
docker run -d --name pp-mysql -e MYSQL_ROOT_PASSWORD=test_password -e MYSQL_DATABASE=planner_pro_e2e -p 127.0.0.1:33306:3306 mysql:8.0
docker run -d --name pp-redis -p 127.0.0.1:36379:6379 redis:7-alpine
cd backend
export DATABASE_URL=mysql://root:test_password@127.0.0.1:33306/planner_pro_e2e NODE_ENV=test
pnpm exec prisma migrate deploy
E2E_DATABASE_URL=$DATABASE_URL REDIS_HOST=127.0.0.1 REDIS_PORT=36379 pnpm exec jest --config jest-e2e.json --runInBand
docker rm -f pp-mysql pp-redis
```

Le test `o23-sigterm` lance `dist/main.js` : faire `pnpm --filter backend build` avant `jest-e2e` (il échoue si `dist` est absent ou plus ancien que `main.ts`, `shutdown-signals.ts`, `bounded-quit.ts`, `redis.service.ts` ou `tracking.gateway.ts`).

Les tests e2e se placent dans `backend/tests/e2e/**/*.e2e-spec.ts` (le `jest` par défaut, `pnpm test`, ne les exécute pas). `tests/e2e/support/e2e-app.ts` démarre l'`AppModule` réel.
