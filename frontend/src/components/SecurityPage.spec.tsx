import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecurityPage } from './SecurityPage';
import { confirmLeaveUnsavedCodes } from '../unsaved-codes';
import { AppProvider, useApp } from '../context/AppContext';

global.fetch = vi.fn();

type Reply = { status?: number; body: unknown };

/** Réponses successives, dans l'ordre des appels. */
const reply = (...replies: Reply[]) => {
  const mock = vi.mocked(global.fetch);
  mock.mockReset();
  for (const { status = 200, body } of replies) {
    mock.mockResolvedValueOnce({
      ok: status < 400,
      status,
      json: async () => body,
    } as Response);
  }
};

const calls = () =>
  vi.mocked(global.fetch).mock.calls.map(([url, init]) => ({
    path: new URL(String(url)).pathname,
    method: (init as RequestInit | undefined)?.method,
    body: (init as RequestInit | undefined)?.body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
  }));

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const CODES = ['AAAA-1111', 'BBBB-2222', 'CCCC-3333', 'DDDD-4444', 'EEEE-5555'];

describe('SecurityPage : MFA (P9)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:codes');
    URL.revokeObjectURL = vi.fn();
  });

  it('active le MFA : QR local, secret en texte, codes affichés une seule fois', async () => {
    reply(
      { body: { mfaEnabled: false, hasPassword: true } },
      {
        body: {
          secret: 'JBSWY3DPEHPK3PXP',
          authUri: 'otpauth://totp/Planner:ada@x.com?secret=JBSWY3DPEHPK3PXP',
        },
      },
      { body: { mfaEnabled: true, recoveryCodes: CODES } },
    );
    render(<SecurityPage />);

    await screen.findByText("Activer l'authentification à deux facteurs");
    type('Mot de passe', 'Secret-12345');
    fireEvent.click(screen.getByText("Activer l'authentification à deux facteurs"));

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    const qr = screen.getByAltText("QR code d'activation TOTP") as HTMLImageElement;
    expect(qr.src.startsWith('data:image/')).toBe(true);

    type(/Code à 6 chiffres/, '123456');
    fireEvent.click(screen.getByText("Confirmer l'activation"));

    expect(await screen.findByText('AAAA-1111')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(CODES.length);
    // La clé secrète n'est plus affichée
    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument();

    const [, setup, confirm] = calls();
    expect(setup).toMatchObject({
      path: '/auth/mfa/setup',
      method: 'POST',
      body: { password: 'Secret-12345' },
    });
    expect(confirm).toMatchObject({
      path: '/auth/mfa/confirm',
      method: 'POST',
      body: { code: '123456' },
    });

    // Fermeture : confirmation explicite requise, puis les codes disparaissent
    const close = screen.getByText('Terminer') as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/J'ai conservé ces codes/));
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByText('AAAA-1111')).not.toBeInTheDocument());
    expect(screen.queryByText('Codes de récupération')).not.toBeInTheDocument();
    // Pas de nouvel appel qui redonnerait les codes
    expect(calls()).toHaveLength(3);
  });

  it("après l'activation, propose de fermer les autres sessions (POST sans corps), puis prévient l'écran", async () => {
    reply(
      { body: { mfaEnabled: false, hasPassword: true } },
      {
        body: {
          secret: 'JBSWY3DPEHPK3PXP',
          authUri: 'otpauth://totp/P:a@x.com?secret=JBSWY3DPEHPK3PXP',
        },
      },
      { body: { mfaEnabled: true, recoveryCodes: CODES } },
      { body: { revoked: 1 } },
    );
    const onSessionsClosed = vi.fn();
    render(<SecurityPage onSessionsClosed={onSessionsClosed} />);
    await screen.findByText("Activer l'authentification à deux facteurs");
    type('Mot de passe', 'Secret-12345');
    fireEvent.click(screen.getByText("Activer l'authentification à deux facteurs"));
    await screen.findByText('JBSWY3DPEHPK3PXP');
    type(/Code à 6 chiffres/, '123456');
    fireEvent.click(screen.getByText("Confirmer l'activation"));
    await screen.findByText('AAAA-1111');
    // L'invitation n'apparaît qu'une fois les codes enregistrés
    expect(screen.queryByText('Fermer les autres sessions ?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/J'ai conservé ces codes/));
    fireEvent.click(screen.getByText('Terminer'));

    fireEvent.click(await screen.findByRole('button', { name: 'Fermer les autres sessions' }));
    expect(await screen.findByText('1 session fermée.')).toBeInTheDocument();
    expect(calls()[3]).toMatchObject({
      path: '/auth/sessions/revoke-others',
      method: 'POST',
      body: undefined,
    });
    expect(onSessionsClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Fermer les autres sessions ?')).not.toBeInTheDocument();
  });

  it('propose le téléchargement des codes en .txt', async () => {
    reply(
      { body: { mfaEnabled: false, hasPassword: true } },
      { body: { secret: 'S', authUri: 'otpauth://totp/x?secret=S' } },
      { body: { mfaEnabled: true, recoveryCodes: CODES } },
    );
    render(<SecurityPage />);
    await screen.findByLabelText('Mot de passe');
    type('Mot de passe', 'pw');
    fireEvent.click(screen.getByText("Activer l'authentification à deux facteurs"));
    await screen.findByText('S');
    type(/Code à 6 chiffres/, '123456');
    fireEvent.click(screen.getByText("Confirmer l'activation"));
    await screen.findByText('AAAA-1111');

    fireEvent.click(screen.getByText(/Télécharger/));
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(await blob.text()).toContain('AAAA-1111');
  });

  it("affiche l'erreur 403 de réauthentification (mot de passe incorrect)", async () => {
    reply(
      { body: { mfaEnabled: false, hasPassword: true } },
      { status: 403, body: { message: 'Mot de passe incorrect.' } },
    );
    render(<SecurityPage />);
    await screen.findByLabelText('Mot de passe');
    type('Mot de passe', 'faux');
    fireEvent.click(screen.getByText("Activer l'authentification à deux facteurs"));
    expect(await screen.findByText('Mot de passe incorrect.')).toBeInTheDocument();
  });

  it('compte sans mot de passe : pas de champ, message « reconnectez-vous » sur 403', async () => {
    reply(
      { body: { mfaEnabled: false, hasPassword: false } },
      { status: 403, body: { message: 'Reconnectez-vous pour effectuer cette action.' } },
    );
    render(<SecurityPage />);
    fireEvent.click(await screen.findByText("Activer l'authentification à deux facteurs"));
    expect(screen.queryByLabelText('Mot de passe')).not.toBeInTheDocument();
    expect(await screen.findByText(/Reconnectez-vous puis réessayez/)).toBeInTheDocument();
    expect(calls()[1].body).toEqual({});
  });

  it("affiche l'erreur 400 d'un code TOTP invalide", async () => {
    reply(
      { body: { mfaEnabled: false, hasPassword: true } },
      { body: { secret: 'S', authUri: 'otpauth://totp/x?secret=S' } },
      { status: 400, body: { message: 'Code TOTP à 6 chiffres invalide.' } },
    );
    render(<SecurityPage />);
    await screen.findByLabelText('Mot de passe');
    type('Mot de passe', 'pw');
    fireEvent.click(screen.getByText("Activer l'authentification à deux facteurs"));
    await screen.findByText('S');
    type(/Code à 6 chiffres/, '000000');
    fireEvent.click(screen.getByText("Confirmer l'activation"));
    expect(await screen.findByText('Code TOTP à 6 chiffres invalide.')).toBeInTheDocument();
    expect(screen.queryByText('Codes de récupération')).not.toBeInTheDocument();
  });

  it('désactive le MFA avec un code de secours et le mot de passe', async () => {
    reply(
      { body: { mfaEnabled: true, hasPassword: true } },
      { body: { mfaEnabled: false } },
      { body: { mfaEnabled: false, hasPassword: true } },
    );
    render(<SecurityPage />);
    fireEvent.click(await screen.findByText('Désactiver'));
    fireEvent.click(screen.getByText('Utiliser un code de récupération'));
    type('Code de récupération', 'AAAA-1111');
    type('Mot de passe', 'pw');
    fireEvent.click(screen.getByText("Désactiver l'authentification à deux facteurs"));

    expect(await screen.findByText(/désactivée/)).toBeInTheDocument();
    expect(calls()[1]).toMatchObject({
      path: '/auth/mfa/disable',
      method: 'POST',
      body: { recoveryCode: 'AAAA-1111', password: 'pw' },
    });
  });

  it('désactive le MFA avec un code TOTP', async () => {
    reply(
      { body: { mfaEnabled: true, hasPassword: true } },
      { status: 400, body: { message: 'Code invalide.' } },
    );
    render(<SecurityPage />);
    fireEvent.click(await screen.findByText('Désactiver'));
    type('Code à 6 chiffres', '654321');
    type('Mot de passe', 'pw');
    fireEvent.click(screen.getByText("Désactiver l'authentification à deux facteurs"));
    expect(await screen.findByText('Code invalide.')).toBeInTheDocument();
    expect(calls()[1].body).toEqual({ code: '654321', password: 'pw' });
  });

  it('régénère les codes (code TOTP et mot de passe) et les affiche une fois', async () => {
    reply({ body: { mfaEnabled: true, hasPassword: true } }, { body: { recoveryCodes: CODES } });
    render(<SecurityPage />);
    fireEvent.click(await screen.findByText('Régénérer les codes de récupération'));
    type('Code à 6 chiffres', '111222');
    type('Mot de passe', 'pw');
    fireEvent.click(screen.getByText('Générer de nouveaux codes'));

    expect(await screen.findByText('EEEE-5555')).toBeInTheDocument();
    expect(calls()[1]).toMatchObject({
      path: '/auth/mfa/recovery-codes',
      method: 'POST',
      body: { code: '111222', password: 'pw' },
    });
    fireEvent.click(screen.getByLabelText(/J'ai conservé ces codes/));
    fireEvent.click(screen.getByText('Terminer'));
    await waitFor(() => expect(screen.queryByText('EEEE-5555')).not.toBeInTheDocument());
  });

  it("n'écrit ni secret ni code de secours (stockage, console) et les efface au démontage", async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    reply(
      { body: { mfaEnabled: false, hasPassword: true } },
      { body: { secret: 'JBSWY3DPEHPK3PXP', authUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' } },
      { body: { mfaEnabled: true, recoveryCodes: CODES } },
      { body: { recoveryCodes: ['ZZZZ-9999', ...CODES.slice(1)] } },
    );
    const { unmount } = render(<SecurityPage />);
    await screen.findByLabelText('Mot de passe');
    type('Mot de passe', 'pw');
    fireEvent.click(screen.getByText("Activer l'authentification à deux facteurs"));
    await screen.findByText('JBSWY3DPEHPK3PXP');
    type(/Code à 6 chiffres/, '123456');
    fireEvent.click(screen.getByText("Confirmer l'activation"));
    await screen.findByText('AAAA-1111');
    fireEvent.click(screen.getByLabelText(/J'ai conservé ces codes/));
    fireEvent.click(screen.getByText('Terminer'));
    fireEvent.click(await screen.findByText('Régénérer les codes de récupération'));
    type('Code à 6 chiffres', '111222');
    type('Mot de passe', 'pw');
    fireEvent.click(screen.getByText('Générer de nouveaux codes'));
    await screen.findByText('ZZZZ-9999');

    const secrets = ['JBSWY3DPEHPK3PXP', 'ZZZZ-9999', ...CODES];
    const written = JSON.stringify([
      ...setItem.mock.calls,
      ...logs.flatMap((spy) => spy.mock.calls),
    ]);
    for (const secret of secrets) expect(written).not.toContain(secret);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('ZZZZ-9999');

    unmount();
    for (const secret of secrets) expect(document.body.innerHTML).not.toContain(secret);
  });

  it('demande confirmation avant de quitter tant que les codes sont affichés', async () => {
    reply(
      { body: { mfaEnabled: false, hasPassword: true } },
      { body: { secret: 'S', authUri: 'otpauth://totp/x?secret=S' } },
      { body: { mfaEnabled: true, recoveryCodes: CODES } },
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { unmount } = render(<SecurityPage />);
    await screen.findByLabelText('Mot de passe');
    type('Mot de passe', 'pw');
    fireEvent.click(screen.getByText("Activer l'authentification à deux facteurs"));
    await screen.findByText('S');
    type(/Code à 6 chiffres/, '123456');
    fireEvent.click(screen.getByText("Confirmer l'activation"));
    await screen.findByText('AAAA-1111');

    expect(confirmLeaveUnsavedCodes()).toBe(false);
    expect(confirmSpy).toHaveBeenCalled();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    unmount();
    confirmSpy.mockClear();
    expect(confirmLeaveUnsavedCodes()).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("via AppProvider : le changement d'onglet est bloqué tant que les codes sont affichés (P9-MFA-h)", async () => {
    let ctx!: ReturnType<typeof useApp>;
    const Probe = () => {
      ctx = useApp();
      return null;
    };
    const answers: Record<string, unknown> = {
      '/auth/mfa/status': { mfaEnabled: false, hasPassword: true },
      '/auth/mfa/setup': { secret: 'S', authUri: 'otpauth://totp/x?secret=S' },
      '/auth/mfa/confirm': { mfaEnabled: true, recoveryCodes: CODES },
    };
    vi.mocked(global.fetch).mockReset();
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const body = answers[new URL(String(input)).pathname] ?? [];
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <AppProvider>
        <Probe />
        <SecurityPage />
      </AppProvider>,
    );
    act(() => ctx.setActiveTab('security'));
    await screen.findByLabelText('Mot de passe');
    type('Mot de passe', 'pw');
    fireEvent.click(screen.getByText("Activer l'authentification à deux facteurs"));
    await screen.findByText('S');
    type(/Code à 6 chiffres/, '123456');
    fireEvent.click(screen.getByText("Confirmer l'activation"));
    await screen.findByText('AAAA-1111');

    act(() => ctx.setActiveTab('kanban'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(ctx.activeTab).toBe('security');

    confirmSpy.mockReturnValue(true);
    act(() => ctx.setActiveTab('kanban'));
    expect(ctx.activeTab).toBe('kanban');
  });
});
