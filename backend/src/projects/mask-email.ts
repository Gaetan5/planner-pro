/**
 * Masque une adresse e-mail pour une réponse publique (S27) : `jean.dupont@exemple.com`
 * devient `j***@e***.com`. Conserve juste de quoi la reconnaître pour son titulaire.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const lastDot = domain.lastIndexOf('.');
  const tld = lastDot > 0 ? domain.slice(lastDot) : '';
  return `${[...local][0]}***@${[...domain][0]}***${tld}`;
}
