import { readFileSync } from 'fs';
import { join } from 'path';
import { noStoreMiddleware } from '../../../src/common/no-store.middleware';

/** O16 : motifs de chemin du middleware `Cache-Control: no-store`. */
describe('O16 : noStoreMiddleware', () => {
  const run = (path: string) => {
    const headers: Record<string, string> = {};
    const next = jest.fn();
    noStoreMiddleware()(
      { path } as never,
      { setHeader: (k: string, v: string) => (headers[k] = v) } as never,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    return headers;
  };

  it.each([
    '/auth/mfa/setup',
    '/auth/github/sync',
    '/auth',
    '/AUTH/login',
    '/admin/overview',
    '/admin',
    '/projects/abc-1/webhooks/github/secret',
    '/projects/abc-1/webhooks/github/secret/',
  ])('%s : no-store et no-cache', (path) => {
    expect(run(path)).toEqual({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  });

  it.each([
    '/',
    '/projects',
    '/projects/abc-1/webhooks/github',
    '/projects/abc-1/webhooks/github/secretx',
    '/projects/a/b/webhooks/github/secret',
    '/authors',
    '/administrators',
    '/notes',
  ])('%s : aucun en-tête', (path) => {
    expect(run(path)).toEqual({});
  });

  it('main.ts branche le middleware (test HTTP et production restent alignés)', () => {
    const main = readFileSync(join(__dirname, '../../../src/main.ts'), 'utf8');
    // A9-b0 : le câblage HTTP est dans configure-http-app.ts, appelé par main.ts
    const wiring = readFileSync(
      join(__dirname, '../../../src/common/configure-http-app.ts'),
      'utf8',
    );
    expect(main).toContain('configureHttpApp(app)');
    expect(wiring).toContain('app.use(noStoreMiddleware())');
  });
});
