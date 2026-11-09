import { isIP } from 'node:net';

export type IntegrationType = 'SLACK' | 'TEAMS' | 'GOOGLE_CALENDAR' | 'OUTLOOK';
export const INTEGRATION_TYPES: IntegrationType[] = [
  'SLACK',
  'TEAMS',
  'GOOGLE_CALENDAR',
  'OUTLOOK',
];

/** Types de contenu acceptés pour un flux d'agenda externe (S19). */
export const CALENDAR_FEED_CONTENT_TYPES = ['text/calendar', 'text/plain', 'application/json'];

const WEBHOOK_HOSTS: Partial<Record<IntegrationType, (host: string) => boolean>> = {
  SLACK: (host) => host === 'hooks.slack.com',
  TEAMS: (host) =>
    host.endsWith('.webhook.office.com') ||
    host.endsWith('.logic.azure.com') ||
    host.endsWith('.powerplatform.com'),
};

/**
 * Prédicat d'hôte autorisé pour une intégration : liste blanche pour les webhooks Slack et Teams,
 * hôte public quelconque (HTTPS) pour les flux d'agenda. Les IP littérales sont toujours refusées.
 */
export function integrationHostAllowed(type: string, hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host) || !host.includes('.')) return false;
  const rule = WEBHOOK_HOSTS[type as IntegrationType];
  return rule ? rule(host) : true;
}

/** Vrai si l'URL est en HTTPS et que son hôte est autorisé pour ce type d'intégration. */
export function isAllowedIntegrationUrl(type: string, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.port && url.port !== '443') return false;
    return integrationHostAllowed(type, url.hostname);
  } catch {
    return false;
  }
}
