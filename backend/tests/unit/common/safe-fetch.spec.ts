import { CALENDAR_FEED_CONTENT_TYPES } from '../../../src/projects/integration-url';
import { constants as osConstants } from 'node:os';
import {
  isForbiddenAddress,
  RETRYABLE_CODES,
  PinnedRequest,
  RawResponse,
  safeFetch,
  SafeFetchError,
} from '../../../src/common/safe-fetch';

const ok = (body = 'BEGIN:VCALENDAR', type = 'text/calendar'): RawResponse => ({
  status: 200,
  headers: { 'content-type': type },
  body: Buffer.from(body),
});

describe('safeFetch (S19)', () => {
  const resolvePublic = jest.fn<Promise<string[]>, [string]>();
  const transport = jest.fn<Promise<RawResponse>, [PinnedRequest]>();

  beforeEach(() => {
    jest.clearAllMocks();
    resolvePublic.mockResolvedValue(['93.184.216.34']);
    transport.mockResolvedValue(ok());
  });

  const run = (url: string, extra = {}) =>
    safeFetch(url, { resolve: resolvePublic, transport, ...extra });

  it.each([
    'http://127.0.0.1/',
    'https://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'https://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[fd00::1]/',
    'http://cache:6379',
    'https://cache/',
    'https://cache:6379/',
    'https://example.com:8443/',
    'https://user:pass@example.com/',
    'ftp://example.com/',
    'file:///etc/passwd',
    'pas une url',
  ])('rejette %s sans aucune connexion', async (url) => {
    await expect(run(url)).rejects.toBeInstanceOf(SafeFetchError);
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejette un domaine qui résout vers une adresse privée (DNS mocké)', async () => {
    resolvePublic.mockResolvedValue(['10.0.0.1']);
    await expect(run('https://evil.example/feed.ics')).rejects.toThrow(/non autorisée/);
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejette si une seule des adresses résolues est interdite', async () => {
    resolvePublic.mockResolvedValue(['93.184.216.34', '192.168.1.5']);
    await expect(run('https://mixte.example/')).rejects.toBeInstanceOf(SafeFetchError);
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejette une redirection 302 vers 127.0.0.1', async () => {
    transport.mockResolvedValueOnce({
      status: 302,
      headers: { location: 'https://127.0.0.1/secret' },
      body: Buffer.alloc(0),
    });
    await expect(run('https://example.com/feed.ics')).rejects.toBeInstanceOf(SafeFetchError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejette une redirection vers un hôte qui résout en privé', async () => {
    transport.mockResolvedValueOnce({
      status: 301,
      headers: { location: 'https://interne.example/' },
      body: Buffer.alloc(0),
    });
    resolvePublic.mockImplementation(async (host: string) =>
      host === 'interne.example' ? ['172.16.0.9'] : ['93.184.216.34'],
    );
    await expect(run('https://example.com/feed.ics')).rejects.toBeInstanceOf(SafeFetchError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('revalide la liste blanche à chaque saut', async () => {
    transport.mockResolvedValueOnce({
      status: 302,
      headers: { location: 'https://autre.example/' },
      body: Buffer.alloc(0),
    });
    await expect(
      run('https://hooks.slack.com/x', { allowHost: (h: string) => h === 'hooks.slack.com' }),
    ).rejects.toThrow(/Hôte non autorisé/);
  });

  it('suit au plus 3 redirections', async () => {
    transport.mockResolvedValue({
      status: 302,
      headers: { location: 'https://example.com/suite' },
      body: Buffer.alloc(0),
    });
    await expect(run('https://example.com/')).rejects.toThrow(/Redirection refusée/);
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('ne suit aucune redirection avec maxRedirects: 0', async () => {
    transport.mockResolvedValue({
      status: 302,
      headers: { location: 'https://example.com/ailleurs' },
      body: Buffer.alloc(0),
    });
    await expect(run('https://example.com/', { maxRedirects: 0 })).rejects.toBeInstanceOf(
      SafeFetchError,
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("épingle la connexion sur l'adresse validée (une seule résolution par saut)", async () => {
    const res = await run('https://example.com/feed.ics');
    expect(res).toMatchObject({ ok: true, status: 200, contentType: 'text/calendar' });
    expect(resolvePublic).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toMatchObject({
      address: '93.184.216.34',
      timeoutMs: 5000,
      maxBytes: 1024 * 1024,
    });
  });

  it('refuse un type de contenu hors liste, accepte avec paramètres', async () => {
    transport.mockResolvedValueOnce(ok('<html>', 'text/html'));
    await expect(
      run('https://example.com/', { allowedContentTypes: ['text/calendar'] }),
    ).rejects.toThrow(/Type de contenu/);

    transport.mockResolvedValueOnce(ok('x', 'Text/Calendar; charset=utf-8'));
    await expect(
      run('https://example.com/', { allowedContentTypes: ['text/calendar'] }),
    ).resolves.toMatchObject({ contentType: 'text/calendar' });
  });

  it('renvoie un statut en erreur sans lever (le corps reste à la discrétion du appelant)', async () => {
    transport.mockResolvedValueOnce({ status: 503, headers: {}, body: Buffer.from('x') });
    await expect(
      run('https://example.com/', { allowedContentTypes: ['text/calendar'] }),
    ).resolves.toMatchObject({ ok: false, status: 503 });
  });

  it('r37-m3 : accepte text/plain, refuse text/html et application/octet-stream (liste des flux ICS)', async () => {
    const allowedContentTypes = CALENDAR_FEED_CONTENT_TYPES;
    transport.mockResolvedValueOnce(ok('BEGIN:VCALENDAR', 'text/plain; charset=utf-8'));
    await expect(run('https://example.com/', { allowedContentTypes })).resolves.toMatchObject({
      contentType: 'text/plain',
    });
    for (const type of ['text/html', 'application/octet-stream']) {
      transport.mockResolvedValueOnce(ok('x', type));
      await expect(run('https://example.com/', { allowedContentTypes })).rejects.toThrow(
        /Type de contenu/,
      );
    }
  });

  describe('r37-m2 : adresses essayées à tour de rôle', () => {
    const unreachable = (code = 'ENETUNREACH') =>
      Object.assign(new Error(code), { code }) as NodeJS.ErrnoException;

    it('essaie IPv4 avant IPv6, puis bascule sur la suivante après une erreur de connexion', async () => {
      resolvePublic.mockResolvedValue(['2606:4700:4700::1111', '93.184.216.34', '8.8.8.8']);
      transport.mockRejectedValueOnce(unreachable('ECONNREFUSED'));
      transport.mockResolvedValueOnce(ok());
      await expect(run('https://example.com/')).resolves.toMatchObject({ ok: true });
      expect(transport.mock.calls.map((c) => c[0].address)).toEqual(['93.184.216.34', '8.8.8.8']);
    });

    it.each(['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL', 'ETIMEDOUT'])(
      'bascule sur la seconde adresse après %s (exactement 2 appels)',
      async (code) => {
        resolvePublic.mockResolvedValue(['93.184.216.34', '8.8.8.8']);
        transport.mockRejectedValueOnce(unreachable(code));
        transport.mockResolvedValueOnce(ok());
        await expect(run('https://example.com/')).resolves.toMatchObject({ ok: true });
        expect(transport).toHaveBeenCalledTimes(2);
      },
    );

    it('le jeu des codes de bascule est exactement celui attendu', () => {
      expect([...RETRYABLE_CODES].sort()).toEqual(
        ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL', 'ETIMEDOUT'].sort(),
      );
    });

    it('chaque code de bascule est un errno réel (garde-fou contre les fautes de frappe)', () => {
      const known = Object.keys(osConstants.errno);
      for (const code of RETRYABLE_CODES) expect(known).toContain(code);
    });

    it('bascule sur IPv6 quand toutes les IPv4 échouent', async () => {
      resolvePublic.mockResolvedValue(['2606:4700:4700::1111', '93.184.216.34']);
      transport.mockRejectedValueOnce(unreachable('EHOSTUNREACH'));
      transport.mockResolvedValueOnce(ok());
      await run('https://example.com/');
      expect(transport.mock.calls.map((c) => c[0].address)).toEqual([
        '93.184.216.34',
        '2606:4700:4700::1111',
      ]);
    });

    it('relève la dernière erreur quand toutes les adresses échouent', async () => {
      resolvePublic.mockResolvedValue(['93.184.216.34', '8.8.8.8']);
      transport.mockRejectedValue(unreachable());
      await expect(run('https://example.com/')).rejects.toMatchObject({ code: 'ENETUNREACH' });
      expect(transport).toHaveBeenCalledTimes(2);
    });

    it('ne bascule pas sur une erreur autre que de connexion (réponse trop grande, délai, reset)', async () => {
      resolvePublic.mockResolvedValue(['93.184.216.34', '8.8.8.8']);
      transport.mockRejectedValueOnce(new SafeFetchError('Réponse trop volumineuse.'));
      await expect(run('https://example.com/')).rejects.toBeInstanceOf(SafeFetchError);
      transport.mockRejectedValueOnce(unreachable('ECONNRESET'));
      await expect(run('https://example.com/')).rejects.toMatchObject({ code: 'ECONNRESET' });
      expect(transport).toHaveBeenCalledTimes(2);
    });

    it("n'essaie jamais une adresse non validée (une adresse interdite refuse tout l'hôte)", async () => {
      resolvePublic.mockResolvedValue(['93.184.216.34', '::1']);
      await expect(run('https://example.com/')).rejects.toThrow(/non autorisée/);
      expect(transport).not.toHaveBeenCalled();
    });

    it('borne la résolution DNS par le délai', async () => {
      resolvePublic.mockReturnValue(new Promise(() => undefined));
      const started = Date.now();
      await expect(run('https://example.com/', { timeoutMs: 100 })).rejects.toThrow(/Délai/);
      expect(Date.now() - started).toBeLessThan(1500);
      expect(transport).not.toHaveBeenCalled();
    });
  });

  describe('isForbiddenAddress', () => {
    it.each([
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '64:ff9b::7f00:1',
      '64:ff9b:1::1',
      '64:ff9b:1:ffff::1',
      'fec0::1',
      'febf::1',
      '192.88.99.1',
      '192.88.99.255',
      'pas-une-ip',
    ])('%s est interdite', (ip) => {
      expect(isForbiddenAddress(ip)).toBe(true);
    });

    it.each([
      '93.184.216.34',
      '8.8.8.8',
      '172.32.0.1',
      '192.88.98.255',
      '192.88.100.0',
      '2606:4700:4700::1111',
    ])('%s est publique', (ip) => {
      expect(isForbiddenAddress(ip)).toBe(false);
    });
  });
});
