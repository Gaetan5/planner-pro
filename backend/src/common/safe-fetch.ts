import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * Appels sortants pilotés par une donnée utilisateur (URL d'intégration, flux d'agenda) : S19.
 * HTTPS seulement, résolution DNS préalable, refus des adresses privées ou réservées, connexion
 * épinglée sur l'adresse validée (aucune seconde résolution : pas de rebinding DNS), redirections
 * revalidées à chaque saut, délai et taille de réponse bornés.
 */

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

// Deux listes distinctes : Node confronte une IPv4 aux règles IPv6 sous sa forme mappée
const FORBIDDEN_V4 = new BlockList();
const FORBIDDEN_V6 = new BlockList();
const v4 = (net: string, prefix: number) => FORBIDDEN_V4.addSubnet(net, prefix, 'ipv4');
const v6 = (net: string, prefix: number) => FORBIDDEN_V6.addSubnet(net, prefix, 'ipv6');
v4('0.0.0.0', 8); // « ce réseau »
v4('10.0.0.0', 8);
v4('100.64.0.0', 10); // CGNAT
v4('127.0.0.0', 8);
v4('169.254.0.0', 16); // link-local, métadonnées cloud
v4('172.16.0.0', 12);
v4('192.0.0.0', 24);
v4('192.0.2.0', 24);
v4('192.88.99.0', 24); // relais 6to4 obsolète
v4('192.168.0.0', 16);
v4('198.18.0.0', 15);
v4('198.51.100.0', 24);
v4('203.0.113.0', 24);
v4('224.0.0.0', 4); // multicast
v4('240.0.0.0', 4); // réservé, diffusion
v6('::', 96); // non spécifiée, loopback, compatible IPv4
v6('::ffff:0:0', 96); // IPv4 mappée : refusée en bloc, une résolution DNS n'en renvoie jamais
v6('64:ff9b::', 96); // NAT64
v6('64:ff9b:1::', 48); // NAT64 à usage local
v6('100::', 64);
v6('2001::', 32); // Teredo
v6('2001:db8::', 32);
v6('2002::', 16); // 6to4
v6('fc00::', 7); // ULA
v6('fe80::', 10); // link-local
v6('fec0::', 10); // site-local obsolète
v6('ff00::', 8);

/** Vrai si l'adresse IP est privée, réservée ou non routable (ou n'est pas une IP). */
export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return family === 4 ? FORBIDDEN_V4.check(address, 'ipv4') : FORBIDDEN_V6.check(address, 'ipv6');
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export interface PinnedRequest {
  url: URL;
  /** Adresse validée sur laquelle la connexion doit être ouverte. */
  address: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  /** Autorités de certification supplémentaires : réservé aux tests (certificat local). */
  ca?: string | Buffer;
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Sauts de redirection suivis (0 : aucune redirection suivie). */
  maxRedirects?: number;
  /** Types de contenu acceptés (sans paramètres) ; absent : tous. */
  allowedContentTypes?: string[];
  /** Appliqué à l'URL initiale et à chaque redirection. */
  allowHost?: (hostname: string) => boolean;
  /** Points d'injection pour les tests. */
  resolve?: (hostname: string) => Promise<string[]>;
  transport?: (req: PinnedRequest) => Promise<RawResponse>;
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function defaultResolve(hostname: string): Promise<string[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

/** Connexion TLS sur l'adresse validée ; le nom d'hôte reste utilisé pour SNI et le certificat. */
export function defaultTransport(req: PinnedRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const hostname = req.url.hostname.replace(/^\[|\]$/g, '');
    const headers: Record<string, string> = { ...req.headers, Host: req.url.host };
    if (req.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(req.body));
    const request = httpsRequest({
      host: req.address,
      port: req.url.port ? Number(req.url.port) : 443,
      path: `${req.url.pathname}${req.url.search}`,
      method: req.method,
      headers,
      servername: isIP(hostname) ? undefined : hostname,
      timeout: req.timeoutMs,
      ca: req.ca,
    });
    const deadline = setTimeout(
      () => request.destroy(new SafeFetchError('Délai dépassé.')),
      req.timeoutMs,
    );
    const finish = (fn: () => void) => {
      clearTimeout(deadline);
      fn();
    };
    request.on('timeout', () => request.destroy(new SafeFetchError('Délai dépassé.')));
    request.on('error', (err) => finish(() => reject(err)));
    request.on('response', (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > req.maxBytes) {
          request.destroy(new SafeFetchError('Réponse trop volumineuse.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        finish(() =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        ),
      );
      res.on('error', (err) => finish(() => reject(err)));
    });
    if (req.body !== undefined) request.write(req.body);
    request.end();
  });
}

function parseTarget(raw: string, allowHost?: (hostname: string) => boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('URL invalide.');
  }
  if (url.protocol !== 'https:') throw new SafeFetchError('Seul HTTPS est autorisé.');
  if (url.username || url.password) throw new SafeFetchError('Identifiants dans l’URL refusés.');
  if (url.port && url.port !== '443') throw new SafeFetchError('Port non autorisé.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!isIP(hostname) && !hostname.includes('.')) {
    throw new SafeFetchError('Nom d’hôte non public.');
  }
  if (allowHost && !allowHost(hostname)) throw new SafeFetchError('Hôte non autorisé.');
  return url;
}

/** Erreurs de connexion après lesquelles l'adresse suivante peut être essayée (rien n'a été envoyé). */
export const RETRYABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EADDRNOTAVAIL',
  'ETIMEDOUT',
]);

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SafeFetchError('Délai dépassé.')), ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Adresses validées de l'hôte, IPv4 d'abord ; la résolution DNS est bornée par le délai. */
async function resolvePublicAddresses(
  url: URL,
  resolve: (hostname: string) => Promise<string[]>,
  timeoutMs: number,
): Promise<string[]> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [hostname] : await withTimeout(resolve(hostname), timeoutMs);
  if (addresses.length === 0) throw new SafeFetchError('Hôte introuvable.');
  // Une seule adresse interdite suffit à refuser : l'hôte ne doit viser que des adresses publiques
  if (addresses.some(isForbiddenAddress)) {
    throw new SafeFetchError('Adresse de destination non autorisée.');
  }
  return [...addresses.filter((a) => isIP(a) === 4), ...addresses.filter((a) => isIP(a) === 6)];
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? 3;
  const resolve = options.resolve ?? defaultResolve;
  const transport = options.transport ?? defaultTransport;
  const method = options.method ?? 'GET';

  let target = rawUrl;
  for (let hop = 0; ; hop++) {
    const url = parseTarget(target, options.allowHost);
    const addresses = await resolvePublicAddresses(url, resolve, timeoutMs);
    let res: RawResponse | undefined;
    for (let i = 0; !res; i++) {
      try {
        res = await transport({
          url,
          address: addresses[i],
          method,
          headers: options.headers ?? {},
          body: options.body,
          timeoutMs,
          maxBytes,
        });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const retryable = !(err instanceof SafeFetchError) && !!code && RETRYABLE_CODES.has(code);
        if (!retryable || i + 1 >= addresses.length) throw err;
      }
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.location;
      if (hop >= maxRedirects || typeof location !== 'string') {
        throw new SafeFetchError('Redirection refusée.');
      }
      target = new URL(location, url).toString();
      continue;
    }

    const rawType = res.headers['content-type'];
    const contentType = (Array.isArray(rawType) ? rawType[0] : (rawType ?? ''))
      .split(';')[0]
      .trim()
      .toLowerCase();
    const ok = res.status >= 200 && res.status < 300;
    if (ok && options.allowedContentTypes && !options.allowedContentTypes.includes(contentType)) {
      throw new SafeFetchError('Type de contenu non pris en charge.');
    }
    return { status: res.status, ok, contentType, text: res.body.toString('utf8') };
  }
}
