# Runbook de la Phase 4 : invitations et console d'administration

À exécuter au déploiement de la Phase 4, après les runbooks des Phases 0 à 3.

## 1. Migration

`backend/prisma/migrations/20261112000000_s17_invitation_project_role` :

- ajoute `Invitation.projectRole` (nullable) ;
- passe à `VIEWER` le rôle des invitations **en attente** liées à un projet ;
- passe à `REVOKED` les invitations **en attente** de rôle `OWNER`.

Aucun effet sur les invitations déjà acceptées. Une invitation de projet en attente sans `projectRole` donne `CLIENT` (le plus restreint) à l'acceptation. Contrôle après migration :

```sql
SELECT COUNT(*) FROM Invitation WHERE status = 'PENDING' AND projectId IS NOT NULL AND role <> 'VIEWER'; -- attendu : 0
SELECT COUNT(*) FROM Invitation WHERE status = 'PENDING' AND role = 'OWNER'; -- attendu : 0
```

Retour arrière : la colonne peut rester ; l'ancien code l'ignore.

## 2. Changements visibles par les utilisateurs

- Une invitation nominative n'est plus utilisable par un autre compte (message : se connecter avec le compte invité).
- Les liens sans adresse e-mail sont limités aux projets, à usage unique. Un lien « espace de travail » anonyme n'existe plus : inviter par adresse e-mail.
- Une invitation à un projet donne la visibilité du seul projet (membre VIEWER du workspace).
- `durationDays` ≤ 30.
- Un MANAGER de projet qui n'est ni OWNER ni ADMIN ne peut plus attribuer le rôle MANAGER.
- Console d'administration : voir § 3.

## 3. Comptes de plateforme (S18)

- **Avant le déploiement** : chaque compte `platformRole` doit avoir activé la MFA, sinon il perd l'accès à `/admin/*` (403 « authentification à deux facteurs obligatoire »). Liste à contrôler :

```sql
SELECT id, email, platformRole FROM User WHERE platformRole IS NOT NULL AND mfaEnabled = 0;
```

- Les sessions de ces comptes expirent 12 h après la connexion (reconnexion complète).
- Seul un `SUPER_ADMIN` change un rôle de plateforme ou impersonne. Le rôle `PLATFORM_ADMIN` conserve la lecture et la révocation de sessions.
- L'impersonation reste désactivée par défaut (`FEATURE_IMPERSONATION_ENABLED`). Elle exige un motif (10 à 500 caractères) consigné dans `PlatformAuditLog.metadata`, dure 15 min, ne peut viser un compte de plateforme, et révoque la session de l'administrateur (il se reconnecte à la fin).

## 4. SCIM

`DELETE /scim/v2/Users/:id` supprime désormais aussi les `ProjectMembership` de l'utilisateur dans les projets du workspace. Pour des déprovisionnements antérieurs, des lignes orphelines peuvent subsister (inoffensives, S12-a) ; nettoyage facultatif : voir `runbook-phase3.md` § 4.1.

## 5. Rôles restreints (P10, P11, P12)

- Les `VIEWER` perdent l'annuaire complet, les sprints, le rapport de capacité et les intégrations. Contrôle avant déploiement : lister les `VIEWER` internes à promouvoir en `MEMBER` :

```sql
SELECT w.name, u.email FROM Membership m JOIN User u ON u.id = m.userId JOIN Workspace w ON w.id = m.workspaceId WHERE m.role = 'VIEWER';
```

- Un créateur de projet de rôle `VIEWER` n'est plus MANAGER de son projet. Contrôle :

```sql
SELECT p.id, p.name, u.email FROM Project p JOIN Membership m ON m.workspaceId = p.workspaceId AND m.userId = p.userId JOIN User u ON u.id = p.userId
WHERE m.role = 'VIEWER' AND p.deletedAt IS NULL;
```

- Un MANAGER non OWNER/ADMIN ne modifie ni ne retire plus un autre MANAGER ; seul un OWNER/ADMIN le fait.
