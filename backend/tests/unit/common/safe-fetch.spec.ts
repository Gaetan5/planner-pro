import {
  isForbiddenAddress,
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
      'pas-une-ip',
    ])('%s est interdite', (ip) => {
      expect(isForbiddenAddress(ip)).toBe(true);
    });

    it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])(
      '%s est publique',
      (ip) => {
        expect(isForbiddenAddress(ip)).toBe(false);
      },
    );
  });
});
