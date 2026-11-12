import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { exportJWK, generateKeyPair, JWK, jwtVerify, SignJWT } from 'jose';
import { OidcKeySource } from '../../../src/auth/sso/oidc';

jest.setTimeout(30_000);

/**
 * A9-b3 : `OidcKeySource` avec le vrai `createRemoteJWKSet` de `jose` 6 (transport `fetch`),
 * contre un serveur HTTP local. Aucune doublure de `jose`.
 */
describe('A9-b3 : OidcKeySource (JWKS distant, jose 6)', () => {
  let privateKey: CryptoKey;
  let jwk: JWK;
  let sockets: Set<import('net').Socket>;
  const servers: Server[] = [];

  const listen = async (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
    const server = createServer(handler);
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const serveJwks = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  };
  const token = () =>
    new SignJWT({ nonce: 'n' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://idp.test')
      .setAudience('client')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  const verify = async (jwksUri: string) =>
    jwtVerify(await token(), new OidcKeySource().getKeys(jwksUri), {
      issuer: 'https://idp.test',
      audience: 'client',
      algorithms: ['RS256'],
    });

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  });
  beforeEach(() => {
    sockets = new Set();
  });
  afterEach(async () => {
    sockets.forEach((socket) => socket.destroy());
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
    );
  });

  it('JWKS servi en 200 : jeton vérifié', async () => {
    const base = await listen(serveJwks);
    const { payload } = await verify(`${base}/jwks`);
    expect(payload.nonce).toBe('n');
  });

  it('getKeys met en cache un résolveur par URI', async () => {
    const source = new OidcKeySource();
    expect(source.getKeys('http://127.0.0.1:1/a')).toBe(source.getKeys('http://127.0.0.1:1/a'));
    expect(source.getKeys('http://127.0.0.1:1/a')).not.toBe(source.getKeys('http://127.0.0.1:1/b'));
  });

  it('jose 6 : une REDIRECTION du JWKS est refusée, la cible n’est jamais appelée', async () => {
    const target = jest.fn(serveJwks);
    const targetBase = await listen(target);
    const base = await listen((req, res) => {
      res.writeHead(302, { location: `${targetBase}/jwks` });
      res.end();
    });
    await expect(verify(`${base}/jwks`)).rejects.toThrow();
    expect(target).not.toHaveBeenCalled();
  });

  it('JWKS qui répond 500 ou un contenu qui n’est pas un JWKS : refusé', async () => {
    const down = await listen((req, res) => {
      res.writeHead(500);
      res.end();
    });
    await expect(verify(`${down}/jwks`)).rejects.toThrow();
    const junk = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"pas":"un jwks"}');
    });
    await expect(verify(`${junk}/jwks`)).rejects.toThrow();
  });

  it('JWKS injoignable (port fermé) : refusé', async () => {
    const closed = await listen(serveJwks);
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
    sockets.forEach((socket) => socket.destroy());
    await expect(verify(`${closed}/jwks`)).rejects.toThrow();
  });

  it('JWKS qui ne répond jamais : abandon au délai de 5 s (timeoutDuration)', async () => {
    const base = await listen(() => undefined);
    const started = Date.now();
    await expect(verify(`${base}/jwks`)).rejects.toThrow();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(9_000);
  });

  it('kid inconnu du JWKS : refusé', async () => {
    const base = await listen(serveJwks);
    const unknown = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'inconnu' })
      .setIssuer('https://idp.test')
      .setAudience('client')
      .setExpirationTime('5m')
      .sign(privateKey);
    await expect(
      jwtVerify(unknown, new OidcKeySource().getKeys(`${base}/jwks`), {
        issuer: 'https://idp.test',
        audience: 'client',
        algorithms: ['RS256'],
      }),
    ).rejects.toThrow();
  });
});
