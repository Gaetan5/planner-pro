import { configureTrustProxy, resolveTrustProxyHops } from '../../../src/common/trust-proxy';

/** S24 : réglage de `trust proxy` à partir de `TRUST_PROXY_HOPS`. */
describe('S24 : TRUST_PROXY_HOPS', () => {
  it('absent hors production : 0 (X-Forwarded-For ignoré)', () => {
    expect(resolveTrustProxyHops({})).toBe(0);
    expect(resolveTrustProxyHops({ NODE_ENV: 'development' })).toBe(0);
    expect(resolveTrustProxyHops({ NODE_ENV: 'test', TRUST_PROXY_HOPS: '  ' })).toBe(0);
  });

  it('absent en production : le démarrage est refusé (réglage obligatoire)', () => {
    expect(() => resolveTrustProxyHops({ NODE_ENV: 'production' })).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '' })).toThrow(
      /TRUST_PROXY_HOPS/,
    );
  });

  it.each([
    ['0', 0],
    ['1', 1],
    [' 2 ', 2],
    ['5', 5],
  ])('valeur %j acceptée : %i saut(s)', (raw, hops) => {
    expect(resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: raw })).toBe(hops);
  });

  it.each(['-1', '6', '1.5', 'true', 'loopback', '1e1', '0x2', '99999'])(
    'valeur %j refusée (jamais « true » ni liste d’adresses : n’importe quel client falsifierait son IP)',
    (raw) => {
      expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: raw })).toThrow(/TRUST_PROXY_HOPS/);
    },
  );

  it('configureTrustProxy applique le nombre de sauts à Express (false pour 0)', () => {
    const set = jest.fn();
    const app = { set } as never;
    expect(configureTrustProxy(app, { TRUST_PROXY_HOPS: '1' })).toBe(1);
    expect(set).toHaveBeenLastCalledWith('trust proxy', 1);
    expect(configureTrustProxy(app, { TRUST_PROXY_HOPS: '0' })).toBe(0);
    expect(set).toHaveBeenLastCalledWith('trust proxy', false);
  });
});
