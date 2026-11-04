/** Charge utile du miroir Firestore d'une invitation, partagée par les services qui la modifient. */
export function invitationSyncPayload(invitation: {
  id: string;
  email: string | null;
  role: string;
  workspaceId: string;
  projectId: string | null;
  invitedById: string;
  status: string;
  expiresAt: Date | string;
  acceptedAt?: Date | string | null;
  createdAt?: Date | string | null;
}) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    workspaceId: invitation.workspaceId,
    projectId: invitation.projectId,
    invitedById: invitation.invitedById,
    status: invitation.status,
    expiresAt: new Date(invitation.expiresAt).toISOString(),
    acceptedAt: invitation.acceptedAt ? new Date(invitation.acceptedAt).toISOString() : null,
    createdAt: invitation.createdAt
      ? new Date(invitation.createdAt).toISOString()
      : new Date().toISOString(),
  };
}
