import React from 'react';
import { SecurityApiError, type IdentityProof } from '../security-api';

/** Saisie de la preuve de réauthentification (S31) : jamais conservée au-delà de l'écran. */
export interface ProofState {
  password: string;
  code: string;
  useRecovery: boolean;
}

export const emptyProof: ProofState = { password: '', code: '', useRecovery: false };

interface Flags {
  hasPassword: boolean;
  mfaEnabled: boolean;
}

/** Corps de requête : mot de passe si le compte en a un, second facteur si la MFA est active. */
export function buildProof(state: ProofState, { hasPassword, mfaEnabled }: Flags): IdentityProof {
  return {
    ...(hasPassword ? { password: state.password } : {}),
    ...(mfaEnabled
      ? state.useRecovery
        ? { recoveryCode: state.code }
        : { mfaCode: state.code }
      : {}),
  };
}

/** Message d'erreur ; un 403 sans mot de passe demande une reconnexion récente. */
export function describeIdentityError(err: unknown, hasPassword: boolean): string {
  if (err instanceof SecurityApiError) {
    if (err.status === 403 && !hasPassword) {
      return `Reconnectez-vous puis réessayez : cette action exige une connexion de moins de 5 minutes. (${err.message})`;
    }
    return err.message;
  }
  return err instanceof Error && err.message
    ? err.message
    : 'La demande a échoué. Réessayez plus tard.';
}

export const IdentityProofFields: React.FC<
  Flags & { value: ProofState; onChange: (next: ProofState) => void }
> = ({ hasPassword, mfaEnabled, value, onChange }) => (
  <>
    {!hasPassword && (
      <p className="security-hint">
        Votre compte n'a pas de mot de passe : l'action exige une connexion de moins de 5 minutes.
        Sinon, reconnectez-vous puis réessayez.
      </p>
    )}
    {hasPassword && (
      <label className="security-field">
        Mot de passe Planner-Pro
        <input
          className="form-input"
          type="password"
          autoComplete="current-password"
          value={value.password}
          onChange={(e) => onChange({ ...value, password: e.target.value })}
          required
        />
      </label>
    )}
    {mfaEnabled && (
      <>
        <label className="security-field">
          {value.useRecovery
            ? 'Code de récupération'
            : 'Code à 6 chiffres (double authentification)'}
          <input
            className="form-input"
            autoComplete="one-time-code"
            value={value.code}
            onChange={(e) => onChange({ ...value, code: e.target.value })}
            required
          />
        </label>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => onChange({ ...value, useRecovery: !value.useRecovery, code: '' })}
        >
          {value.useRecovery
            ? "Utiliser le code de l'application"
            : 'Utiliser un code de récupération'}
        </button>
      </>
    )}
  </>
);
