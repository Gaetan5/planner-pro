// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * S22 : en-têtes de sécurité du frontend. Le script exécuté au démarrage du conteneur nginx
 * produit le fichier d'en-têtes ; on l'exécute ici avec `sh` et on lit ce qu'il génère.
 */
const FRONTEND = resolve(process.cwd());
const SCRIPT = join(FRONTEND, 'docker-entrypoint.d', '40-security-headers.sh');
const work = mkdtempSync(join(tmpdir(), 'sec-headers-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

let counter = 0;
function generate(env: Record<string, string>) {
  const out = join(work, `headers-${counter++}.conf`);
  const result = spawnSync('sh', [SCRIPT], {
    env: { PATH: process.env.PATH ?? '', SECURITY_HEADERS_FILE: out, ...env },
    encoding: 'utf8',
  });
  let conf = '';
  try {
    conf = readFileSync(out, 'utf8');
  } catch {
    /* non généré */
  }
  return { status: result.status, stderr: result.stderr, conf };
}

const lineOf = (conf: string, name: string) =>
  conf.split('\n').find((l) => l.startsWith(`add_header ${name} `)) ?? '';
const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((d) =>
      d
        .trim()
        .replace(/^add_header \S+ "/, '')
        .replace(/" always$/, ''),
    )
    .find((d) => d === name || d.startsWith(`${name} `)) ?? '';

describe('S22 : CSP et en-têtes générés', () => {
  const API = { VITE_API_URL: 'https://api.exemple.test' };

  it('par défaut : CSP en Report-Only uniquement, jamais bloquante', () => {
    const { status, conf } = generate(API);
    expect(status).toBe(0);
    expect(lineOf(conf, 'Content-Security-Policy-Report-Only')).not.toBe('');
    expect(lineOf(conf, 'Content-Security-Policy')).toBe('');
  });

  it('CSP_MODE=enforce : en-tête bloquant, plus de Report-Only', () => {
    const { status, conf } = generate({ ...API, CSP_MODE: 'enforce' });
    expect(status).toBe(0);
    expect(lineOf(conf, 'Content-Security-Policy')).not.toBe('');
    expect(lineOf(conf, 'Content-Security-Policy-Report-Only')).toBe('');
  });

  it('CSP_MODE invalide : le conteneur refuse de démarrer, rien n’est généré', () => {
    const { status, conf, stderr } = generate({ ...API, CSP_MODE: 'enforced' });
    expect(status).not.toBe(0);
    expect(conf).toBe('');
    expect(stderr).toContain('CSP_MODE');
  });

  describe('directives', () => {
    const csp = lineOf(generate(API).conf, 'Content-Security-Policy-Report-Only');

    it("script-src : 'self' seul, sans unsafe-inline ni unsafe-eval ni data:", () => {
      expect(directive(csp, 'script-src')).toBe("script-src 'self'");
      expect(csp).not.toMatch(/script-src[^;]*unsafe/);
      expect(csp).not.toMatch(/default-src[^;]*(unsafe|data:)/);
    });

    it('directives de cloisonnement', () => {
      expect(directive(csp, 'default-src')).toBe("default-src 'self'");
      expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
      expect(directive(csp, 'frame-src')).toBe("frame-src 'none'");
      expect(directive(csp, 'object-src')).toBe("object-src 'none'");
      expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
      expect(directive(csp, 'form-action')).toBe("form-action 'self'");
    });

    it('data: limité à img-src', () => {
      const withData = csp.split(';').filter((d) => d.includes('data:'));
      expect(withData).toHaveLength(1);
      expect(withData[0].trim()).toMatch(/^img-src /);
    });

    it('police auto-hébergée : aucune source Google Fonts', () => {
      expect(directive(csp, 'font-src')).toBe("font-src 'self'");
      expect(csp).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    });

    it('connect-src : API en https et wss du même hôte, plus Firebase Auth', () => {
      expect(directive(csp, 'connect-src')).toBe(
        "connect-src 'self' https://api.exemple.test wss://api.exemple.test https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
      );
    });

    it('aucune source Firebase/Google inutile (pas de popup ni de redirection dans le code)', () => {
      expect(csp).not.toContain('apis.google.com');
      expect(csp).not.toContain('accounts.google.com');
      expect(csp).not.toContain('firebaseapp.com');
    });
  });

  describe('connect-src construit depuis VITE_API_URL', () => {
    it.each([
      ['http://localhost:13003', 'http://localhost:13003', 'ws://localhost:13003'],
      [
        'https://api.exemple.test:8443/v1/',
        'https://api.exemple.test:8443',
        'wss://api.exemple.test:8443',
      ],
      ['https://api.exemple.test:1', 'https://api.exemple.test:1', 'wss://api.exemple.test:1'],
      [
        'https://api.exemple.test:65535',
        'https://api.exemple.test:65535',
        'wss://api.exemple.test:65535',
      ],
      ['http://[::1]:8080', 'http://[::1]:8080', 'ws://[::1]:8080'],
    ])('%s', (url, http, ws) => {
      const conf = generate({ VITE_API_URL: url }).conf;
      const connect = directive(lineOf(conf, 'Content-Security-Policy-Report-Only'), 'connect-src');
      expect(connect).toContain(` ${http} `);
      expect(connect).toContain(` ${ws} `);
    });

    it.each([
      [''],
      ['api.exemple.test'],
      ['ftp://api.exemple.test'],
      ["https://api.exemple.test; script-src 'unsafe-inline'"],
      ['https://api.exemple.test"; add_header X-Evil 1; "'],
      ['https://a.example.test\nhttps://b.example.test'],
      ['https://a.example.test\n'],
      ['https://a.example.test\r\nX-Evil: 1'],
      ['https://a.example.test\t'],
      ['https://a.example.test\u0001'],
      ['https://a.example.test:0'],
      ['https://a.example.test:65536'],
      ['https://a.example.test:99999'],
      ['https://a.example.test:00080'],
      ['https://a.example.test:123456'],
      ['http://[::1]:70000'],
    ])('valeur invalide %j : refus de démarrer', (url) => {
      const { status, conf } = generate({ VITE_API_URL: url });
      expect(status).not.toBe(0);
      expect(conf).toBe('');
    });
  });

  describe('CSP_REPORT_URI', () => {
    it('absent par défaut', () => {
      expect(generate(API).conf).not.toContain('report-uri');
    });
    it('ajouté quand il est valide', () => {
      const conf = generate({ ...API, CSP_REPORT_URI: 'https://reports.exemple.test/csp' }).conf;
      expect(conf).toContain('; report-uri https://reports.exemple.test/csp"');
    });
    it.each([
      ['https://r.test/x\nhttps://evil.test'],
      ['https://r.test/x\r\nX-Evil: 1'],
      ['https://r.test/x\u0007'],
      ['https://r.test/x;script-src *'],
      ['https://r.test/"x'],
      ['https://r.test/$host'],
      ['ftp://r.test'],
    ])('%s : refusé (injection de directive ou d’en-tête)', (uri) => {
      expect(generate({ ...API, CSP_REPORT_URI: uri }).status).not.toBe(0);
    });
  });

  describe('autres en-têtes', () => {
    const conf = generate(API).conf;
    it('HSTS avec includeSubDomains, sans preload', () => {
      const hsts = lineOf(conf, 'Strict-Transport-Security');
      expect(hsts).toContain('max-age=31536000; includeSubDomains');
      expect(hsts).not.toMatch(/preload/i);
    });
    it('nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy', () => {
      expect(lineOf(conf, 'X-Content-Type-Options')).toContain('nosniff');
      expect(lineOf(conf, 'X-Frame-Options')).toContain('DENY');
      expect(lineOf(conf, 'Referrer-Policy')).toContain('strict-origin-when-cross-origin');
      expect(lineOf(conf, 'Permissions-Policy')).toContain('microphone=(self)');
    });
    it('chaque en-tête porte always', () => {
      for (const line of conf.trim().split('\n')) expect(line).toMatch(/ always;$/);
    });
  });
});

describe('S22 : configuration nginx et sources', () => {
  const nginx = readFileSync(join(FRONTEND, 'nginx.prod.conf'), 'utf8');

  it('le fichier d’en-têtes est inclus dans la page d’entrée ET dans le bloc des assets', () => {
    const includes = nginx.match(/include \/etc\/nginx\/snippets\/security-headers\.conf;/g) ?? [];
    expect(includes).toHaveLength(2);
    const assets = nginx.slice(nginx.indexOf('location ~*'));
    expect(assets).toContain('security-headers.conf');
  });

  it('r42-a2 : le bloc des assets émet un seul Cache-Control (pas d’expires en plus)', () => {
    const assets = nginx.slice(nginx.indexOf('location ~*'));
    expect(assets).not.toMatch(/^\s*expires\s/m);
    expect(assets.match(/add_header Cache-Control /g) ?? []).toHaveLength(1);
    expect(assets).toContain('add_header Cache-Control "public, max-age=31536000, immutable"');
  });

  it('aucun domaine de production codé en dur', () => {
    for (const file of [nginx, readFileSync(SCRIPT, 'utf8')]) {
      expect(file).not.toMatch(/boukarou/);
    }
  });

  it('plus d’import Google Fonts dans le CSS', () => {
    const css = readFileSync(join(FRONTEND, 'src', 'index.css'), 'utf8');
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(readFileSync(join(FRONTEND, 'src', 'main.tsx'), 'utf8')).toContain(
      '@fontsource-variable/outfit',
    );
  });

  it('index.html : aucun script ni style inline', () => {
    const html = readFileSync(join(FRONTEND, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});
