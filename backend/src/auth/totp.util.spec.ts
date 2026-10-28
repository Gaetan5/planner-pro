import {
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  base32Encode,
  base32Decode,
  getTotpAuthUri,
} from './totp.util';

describe('totp.util', () => {
  it('should encode and decode base32 reversibly', () => {
    const raw = Buffer.from('hello-planner-pro-totp-12345');
    const encoded = base32Encode(raw);
    const decoded = base32Decode(encoded);
    expect(decoded.toString()).toBe(raw.toString());
  });

  it('should generate a valid 6-digit TOTP code and verify it', () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThanOrEqual(16);

    const now = Date.now();
    const code = generateTotpCode(secret, now);
    expect(code).toMatch(/^[0-9]{6}$/);

    const isValid = verifyTotpCode(secret, code, 1, now);
    expect(isValid).toBe(true);

    const isInvalid = verifyTotpCode(secret, '000000', 1, now);
    expect(isInvalid).toBe(false);
  });

  it('should accept codes within the tolerance window of +-30s', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const pastCode = generateTotpCode(secret, now - 30000);
    expect(verifyTotpCode(secret, pastCode, 1, now)).toBe(true);

    const farPastCode = generateTotpCode(secret, now - 90000);
    expect(verifyTotpCode(secret, farPastCode, 1, now)).toBe(false);
  });

  it('should format correct otpauth URI', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const uri = getTotpAuthUri('user@example.com', secret);
    expect(uri).toContain('otpauth://totp/Planner-Pro:user%40example.com');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
  });
});
