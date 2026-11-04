# Matrice RBAC de Planner-Pro (P4)

Spécification des rôles et des permissions. Source de vérité du code : `backend/src/authz/permissions.ts`, appliquée par `PolicyService`. Le test matrice (`backend/tests/http/rbac-matrix.spec.ts`) vérifie chaque route contre cette matrice.

Décisions produit consignées :

| Décision | Valeur | Date |
| --- | --- | --- |
| P4 : un MEMBER ou VIEWER voit-il les projets dont il n'est pas membre ? | **Non.** Règle stricte, aucun accès implicite. Reprise optionnelle des accès existants par `backend/scripts/grant-legacy-project-access.ts` | 2026-11-03 |
| Invité « projet » | `VIEWER` du workspace (sans visibilité implicite) plus `ProjectMembership` au rôle choisi. Pas de rôle `GUEST` : un VIEWER est restreint (P11, § 2) | Décision de l'utilisateur du 2026-11-04 |
| Création d'un lien d'invitation anonyme | Projet obligatoire, rôle de projet ≤ CONTRIBUTOR, usage unique, sans `maxUses` | Décision de l'utilisateur du 2026-11-04 |
| Attribution du rôle de projet MANAGER | OWNER et ADMIN du workspace uniquement | Décision de l'utilisateur du 2026-11-04 |
| P12 : un MANAGER modifie ou retire un autre MANAGER | Non (OWNER/ADMIN seulement) ; chacun peut se rétrograder ou quitter, sauf le créateur du projet | Décision de l'utilisateur du 2026-11-04 |
| P10 : le créateur d'un projet reste MANAGER même rétrogradé VIEWER | Non : créateur MANAGER seulement s'il est au moins MEMBER ; sinon sa `ProjectMembership` éventuelle | Décision de l'utilisateur du 2026-11-04 |

## 1. Rôles

- **Workspace** : OWNER, ADMIN, MEMBER, VIEWER. Un rôle de workspace est la condition d'entrée : sans `Membership`, aucun accès à rien dans ce workspace, même avec une `ProjectMembership` (S12-a).
- **Projet** : MANAGER > CONTRIBUTOR > COMMENTER > CLIENT. Un rôle est accepté s'il est au moins égal au plus faible des rôles listés pour l'action.
- **Rôle effectif sur un projet de workspace** : OWNER ou ADMIN = MANAGER implicite de tous les projets ; créateur du projet = MANAGER s'il est au moins MEMBER du workspace (P10) ; sinon rôle de la `ProjectMembership` ; sinon aucun accès.
- **Plateforme** : `SUPER_ADMIN` et `PLATFORM_ADMIN` (console `/admin`). MFA obligatoire ; sessions limitées à 12 h ; `SUPER_ADMIN` seul change un rôle de plateforme ou impersonne (motif obligatoire, 15 min, jamais sur un compte de plateforme).

## 2. Actions de workspace

| Action | OWNER | ADMIN | MEMBER | VIEWER |
| --- | :-: | :-: | :-: | :-: |
| `workspace.read` (appartenance, nom) | oui | oui | oui | oui |
| `workspace.directory.read` (annuaire complet, capacité, intégrations en lecture), `sprint.read` | oui | oui | oui | non |
| `project.create`, `sprint.manage`, `ai.use`, `schedule.run` | oui | oui | oui | non |
| `workspace.integrations.manage` | oui | oui | non | non |
| `workspace.invitations.manage` | oui | oui | non | non |
| `workspace.audit.read`, `workspace.finances.read` | oui | oui | non | non |
| `workspace.resources.manage`, `milestone.manage` | oui | oui | non | non |

Annuaire d'un VIEWER (P11) : `GET /projects/workspaces/:id/members` et `GET /projects/workspaces` ne renvoient que lui-même, les OWNER/ADMIN et les personnes qui ont un accès à au moins un projet qu'il peut lire (`PolicyService.listVisibleWorkspaceMemberIds`). Le rapport de capacité, les sprints et les intégrations répondent 403 à un VIEWER. Un collaborateur interne doit être MEMBER.

## 3. Actions de projet

| Action | MANAGER | CONTRIBUTOR | COMMENTER | CLIENT |
| --- | :-: | :-: | :-: | :-: |
| `project.read`, `task.read`, `comment.read`, `attachment.read` | oui | oui | oui | oui |
| `comment.write`, `attachment.write` | oui | oui | oui | non |
| `project.write`, `task.write`, `timelog.read`, `timelog.write` | oui | oui | non | non |
| `project.manage`, `comment.delete`, `attachment.delete` | oui | non | non | non |

## 4. Invitations (S17)

- Rôle invité ≤ rôle de l'invitant ; OWNER jamais invitable (le transfert de propriété est un flux dédié, non livré). Seuls OWNER et ADMIN invitent.
- Invitation nominative : acceptée uniquement par le compte dont l'adresse est celle de l'invitation (comparaison insensible à la casse). Durée de 1 à 30 jours.
- Invitation à un projet : membership workspace `VIEWER` et `ProjectMembership` au `projectRole` choisi (CLIENT par défaut). Un membre existant n'est jamais rétrogradé.
- Lien anonyme : projet obligatoire, `projectRole` ≠ MANAGER, usage unique.
- L'invitation est revérifiée à l'acceptation : l'invitant doit toujours être OWNER/ADMIN du workspace, avec un rôle au moins égal à celui proposé.
- Attribution directe d'un rôle de projet (`POST /projects/:id/members`) : par un MANAGER du projet (ou OWNER/ADMIN) ; la cible doit être membre du workspace ; MANAGER n'est attribuable que par OWNER/ADMIN.
- Retrait ou rétrogradation d'un MANAGER (P12) : réservé à OWNER/ADMIN ; un MANAGER peut se rétrograder ou quitter le projet, sauf son créateur.
- À prévoir dans tout futur flux de changement de rôle de workspace (aucune route n'en change aujourd'hui) : un passage à VIEWER retire au créateur sa qualité de MANAGER ; recalculer les salons temps réel (`refreshUserRooms`).
- Suppression SCIM (`DELETE /scim/v2/Users/:id`) : retire la membership et toutes les `ProjectMembership` du workspace. Une suspension (`active=false`) conserve ces dernières.
