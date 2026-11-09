import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import * as https from 'node:https';
import { createServer, Server } from 'node:https';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TLSSocket } from 'node:tls';
import { defaultTransport, PinnedRequest, safeFetch } from '../../../src/common/safe-fetch';

/**
 * r37-m1 : `defaultTransport` exécuté pour de vrai contre un serveur TLS local.
 * Les certificats sont générés ici, éphémères, dans un dossier temporaire supprimé en fin de test
 * (aucun secret dans le dépôt). L'adresse épinglée est 127.0.0.1, le nom d'hôte de l'URL `localhost`.
 */

interface TestCert {
  cert: string;
  key: string;
}

function generateCert(dir: string, name: string, dnsName: string): TestCert {
  const keyFile = join(dir, `${name}.key`);
  const certFile = join(dir, `${name}.crt`);
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-days',
      '2',
      '-subj',
      `/CN=${dnsName}`,
      '-addext',
      `subjectAltName=DNS:${dnsName}`,
    ],
    { stdio: 'ignore' },
  );
  return { cert: readFileSync(certFile, 'utf8'), key: readFileSync(keyFile, 'utf8') };
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

describe('defaultTransport (S19, r37-m1) : serveur TLS local', () => {
  jest.setTimeout(15000);

  let dir: string;
  let good: TestCert; // valable pour « localhost » seulement (pas pour l'IP 127.0.0.1)
  let other: TestCert; // valable pour un autre nom
  const servers: Server[] = [];
  const timers: NodeJS.Timeout[] = [];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'safe-fetch-tls-'));
    good = generateCert(dir, 'good', 'localhost');
    other = generateCert(dir, 'other', 'autre.example');
  });

  afterAll(() => {
    for (const t of timers) clearInterval(t);
    for (const s of servers) {
      s.closeAllConnections();
      s.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  async function serve(
    handler: Handler,
    cert: TestCert = good,
    onSecure?: (socket: TLSSocket) => void,
  ): Promise<number> {
    const server = createServer({ cert: cert.cert, key: cert.key }, handler);
    if (onSecure) server.on('secureConnection', onSecure);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
  }

  const request = (port: number, over: Partial<PinnedRequest> = {}): PinnedRequest => ({
    url: new URL(`https://localhost:${port}/chemin?q=1`),
    address: '127.0.0.1',
    method: 'GET',
    headers: {},
    timeoutMs: 5000,
    maxBytes: 1024 * 1024,
    ca: good.cert,
    ...over,
  });

  it('vérifie le certificat contre le nom d’hôte (pas l’IP épinglée), envoie SNI et Host', async () => {
    let sni: string | false | undefined;
    let host: string | undefined;
    const port = await serve(
      (req, res) => {
        host = req.headers.host;
        res.writeHead(200, { 'content-type': 'text/calendar' });
        res.end('BEGIN:VCALENDAR');
      },
      good,
      (socket) => {
        sni = (socket as TLSSocket & { servername?: string | false }).servername;
      },
    );
    const res = await defaultTransport(request(port));
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('BEGIN:VCALENDAR');
    expect(sni).toBe('localhost');
    expect(host).toBe(`localhost:${port}`);
  });

  it('passe explicitement servername (nom d’hôte) à la requête épinglée, sans dépendre de l’en-tête Host', async () => {
    // Node déduit sinon le nom du certificat de l'en-tête Host : on fige le contrat explicite
    const spy = jest.spyOn(https, 'request');
    try {
      const port = await serve((_req, res) => res.end('ok'));
      await defaultTransport(request(port));
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ host: '127.0.0.1', servername: 'localhost' }),
      );
      spy.mockClear();
      await expect(
        defaultTransport(request(port, { url: new URL(`https://127.0.0.1:${port}/`) })),
      ).rejects.toBeDefined(); // certificat valable pour « localhost » seulement
      expect(spy.mock.calls[0][0]).toMatchObject({ servername: undefined });
    } finally {
      spy.mockRestore();
    }
  });

  it('refuse un certificat émis pour un autre nom que celui de l’URL', async () => {
    const port = await serve((_req, res) => res.end('ok'), other);
    await expect(defaultTransport(request(port, { ca: other.cert }))).rejects.toThrow(
      /altnames|Hostname\/IP/i,
    );
  });

  it('refuse un certificat non approuvé', async () => {
    const port = await serve((_req, res) => res.end('ok'), other);
    await expect(defaultTransport(request(port))).rejects.toMatchObject({
      code: expect.stringMatching(/SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/),
    });
  });

  it('interrompt une réponse qui dépasse maxBytes', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(Buffer.alloc(200 * 1024, 97));
    });
    await expect(defaultTransport(request(port, { maxBytes: 1000 }))).rejects.toThrow(
      /trop volumineuse/,
    );
  });

  it('accepte une réponse exactement à la limite', async () => {
    const port = await serve((_req, res) => res.end(Buffer.alloc(1000, 97)));
    const res = await defaultTransport(request(port, { maxBytes: 1000 }));
    expect(res.body.length).toBe(1000);
  });

  it('coupe au délai global une réponse qui ne se termine jamais, même si elle envoie des octets', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      // Un octet toutes les 50 ms : le délai d'inactivité de la socket ne se déclenche jamais
      timers.push(setInterval(() => res.write('x'), 50));
    });
    const started = Date.now();
    await expect(defaultTransport(request(port, { timeoutMs: 400 }))).rejects.toThrow(/Délai/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('échoue vite sur une connexion coupée par le serveur', async () => {
    const port = await serve(
      (_req, res) => res.end('jamais envoyé'),
      good,
      (socket) => socket.destroy(),
    );
    const started = Date.now();
    await expect(defaultTransport(request(port))).rejects.toMatchObject({
      code: expect.stringMatching(/ECONNRESET|ERR_|EPIPE/),
    });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('échoue sur une connexion coupée en cours de réponse', async () => {
    const port = await serve((req, res) => {
      res.writeHead(200, { 'content-length': '1000' });
      res.write('début');
      setTimeout(() => req.socket.destroy(), 50);
    });
    const started = Date.now();
    await expect(defaultTransport(request(port))).rejects.toMatchObject({
      code: expect.stringMatching(/ECONNRESET|ERR_|EPIPE/),
    });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('safeFetch de bout en bout : DNS simulé public, transport réel refusé car 127.0.0.1 est interdit', async () => {
    const port = await serve((_req, res) => res.end('ok'));
    await expect(
      safeFetch(`https://localhost:${port}/`, { resolve: async () => ['127.0.0.1'] }),
    ).rejects.toThrow();
  });
});
