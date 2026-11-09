import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; email: string },
  logout: vi.fn(),
  checkInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}));

vi.mock('../context/AppContext', () => ({ useApp: () => ctx }));
vi.mock('./Login', () => ({
  Login: (props: { invitation?: { workspaceName: string; maskedEmail?: string | null } }) => (
    <div>
      Écran Login
      {props.invitation && (
        <span>
          Invitation {props.invitation.workspaceName} / {props.invitation.maskedEmail}
        </span>
      )}
    </div>
  ),
}));

import { InvitationAcceptance } from './InvitationAcceptance';
import { InvitationApiError, PENDING_INVITE_KEY, savePendingInvite } from '../invitation-store';

const INFO = {
  workspaceName: 'Atelier',
  invitedByName: 'Grace',
  role: 'MEMBER',
  email: 'a***@c***.com',
};

const renderInvite = () => {
  const onClose = vi.fn();
  render(
    <InvitationAcceptance
      token="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      onClose={onClose}
    />,
  );
  return { onClose };
};

describe('InvitationAcceptance : réutilise Login (P13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    ctx.user = null;
    ctx.checkInvitation.mockResolvedValue(INFO);
    global.fetch = vi.fn();
    savePendingInvite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('non connecté : résumé, adresse masquée, bouton de connexion, aucun compte de démo', async () => {
    renderInvite();
    await screen.findByText('Se connecter ou créer un compte');
    expect(screen.getByText('a***@c***.com')).toBeInTheDocument();
    expect(screen.queryByText(/démo/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/prénom/i)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(ctx.acceptInvitation).not.toHaveBeenCalled();
  });

  it('« Se connecter ou créer un compte » affiche Login avec le bandeau d’invitation (adresse masquée)', async () => {
    renderInvite();
    fireEvent.click(await screen.findByText('Se connecter ou créer un compte'));
    expect(await screen.findByText('Écran Login')).toBeInTheDocument();
    expect(screen.getByText('Invitation Atelier / a***@c***.com')).toBeInTheDocument();
  });

  it('connecté : aucune acceptation automatique, puis « Accepter » appelle l’API et supprime l’entrée', async () => {
    ctx.user = { id: 'u1', name: 'Ada', email: 'ada@corp.com' };
    ctx.acceptInvitation.mockResolvedValue({ workspaceId: 'w1', message: 'ok' });
    renderInvite();
    const accept = await screen.findByRole('button', { name: /Accepter l'Invitation/ });
    expect(ctx.acceptInvitation).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).not.toBeNull();

    fireEvent.click(accept);
    await screen.findByText('Bienvenue à bord !');
    expect(ctx.acceptInvitation).toHaveBeenCalledWith(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('403 : message du serveur, adresse masquée et « Changer de compte » qui conserve l’invitation', async () => {
    ctx.user = { id: 'u1', name: 'Ada', email: 'ada@corp.com' };
    ctx.acceptInvitation.mockRejectedValue(
      new InvitationApiError('Cette invitation est destinée à une autre adresse e-mail.', 403),
    );
    renderInvite();
    fireEvent.click(await screen.findByRole('button', { name: /Accepter l'Invitation/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('destinée à une autre adresse');
    expect(screen.getByText('a***@c***.com')).toBeInTheDocument();
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Changer de compte' }));
    expect(ctx.logout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(PENDING_INVITE_KEY)!).token).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
  });

  it('autre erreur d’acceptation : l’entrée est supprimée', async () => {
    ctx.user = { id: 'u1', name: 'Ada', email: 'ada@corp.com' };
    ctx.acceptInvitation.mockRejectedValue(
      new InvitationApiError('Invitation déjà utilisée.', 409),
    );
    renderInvite();
    fireEvent.click(await screen.findByRole('button', { name: /Accepter l'Invitation/ }));
    await screen.findByText('Invitation Invalide');
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('jeton refusé par check : l’entrée en attente est supprimée (FM7)', async () => {
    ctx.checkInvitation.mockRejectedValue(new InvitationApiError('Invitation révoquée.', 404));
    renderInvite();
    await screen.findByText('Invitation Invalide');
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('retour OAuth en erreur alors que check échoue : Login sans bandeau d’invitation', async () => {
    ctx.checkInvitation.mockRejectedValue(new InvitationApiError('Invitation révoquée.', 404));
    render(
      <InvitationAcceptance
        token="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        onClose={vi.fn()}
        oauthError="Échec GitHub"
      />,
    );
    expect(await screen.findByText('Écran Login')).toBeInTheDocument();
    expect(screen.queryByText(/Invitation /)).not.toBeInTheDocument();
  });

  it('« Ignorer l’invitation » supprime l’entrée et ferme l’écran', async () => {
    const { onClose } = renderInvite();
    fireEvent.click(await screen.findByText("Ignorer l'invitation"));
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('retour OAuth avec défi MFA : Login est affiché directement', async () => {
    render(
      <InvitationAcceptance
        token="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        onClose={vi.fn()}
        initialMfaTicket="ticket"
      />,
    );
    await waitFor(() => expect(screen.getByText('Écran Login')).toBeInTheDocument());
  });
});
