import { JwtService } from '@nestjs/jwt';
import { TokenService } from '../../../src/auth/token.service';

/** S18.2 : jeton d'impersonation court, avec l'acteur réel dans `act` (RFC 8693). */
describe('S18.2 : jeton d’impersonation', () => {
  const secret = 'test-secret-impersonation-token-0123456789';
  const saved = process.env.JWT_SECRET;
  let tokens: TokenService;
  const jwt = new JwtService({ secret });

  beforeAll(() => {
    process.env.JWT_SECRET = secret;
    tokens = new TokenService(jwt);
  });
  afterAll(() => {
    process.env.JWT_SECRET = saved;
  });

  it('exp - iat <= 900 et act.sub est l’administrateur réel', () => {
    const token = tokens.signAccessToken({ sub: 'cible', sid: 's1', impersonatedBy: 'admin-1' });
    const payload = jwt.decode(token) as { exp: number; iat: number; act?: { sub: string } };
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(900);
    expect(payload.act).toEqual({ sub: 'admin-1' });
  });

  it('un jeton ordinaire n’a pas de claim act', () => {
    const token = tokens.signAccessToken({ sub: 'u', sid: 's1' });
    expect(jwt.decode(token)).not.toHaveProperty('act');
  });

  it('la vérification reconstruit impersonatedBy depuis act, même si le claim legacy est absent', async () => {
    const forged = jwt.sign(
      { sub: 'cible', sid: 's1', typ: 'access', act: { sub: 'admin-1' } },
      { expiresIn: 60 },
    );
    const verified = await tokens.verifyAccessToken(forged);
    expect(verified.impersonatedBy).toBe('admin-1');
  });
});
