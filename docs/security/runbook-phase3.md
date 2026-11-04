# Runbook Phase 3 : autorisation centralisée, IDOR, temps réel

Ce document accompagne la livraison de la Phase 3 (A1, A2, A4, S12 à S12-e, S13, S14, S15, S16, S16-a, S16-b, A2-b ; reprise r11). Rien ici ne s'exécute automatiquement.

## 1. Migration

`backend/prisma/migrations/20261111000000_s12_attachment_uploader/migration.sql`

- Ajoute `Attachment.uploadedById` (nullable, index, clé étrangère vers `User` en `ON DELETE SET NULL`).
- Reprise de données incluse : une pièce jointe liée à un commentaire reçoit l'auteur du commentaire. Les pièces jointes posées directement sur une tâche restent à `NULL` : seul un MANAGER du projet (ou OWNER/ADMIN du workspace) peut les supprimer.
- Ordre : appliquer d'abord sur une base jetable (`prisma migrate deploy`), puis en production. Aucune suppression de données.
- Retour arrière : `ALTER TABLE Attachment DROP FOREIGN KEY Attachment_uploadedById_fkey, DROP INDEX Attachment_uploadedById_idx, DROP COLUMN uploadedById;` (le code Phase 3 doit alors être retiré aussi, car il écrit cette colonne).

## 2. Changements visibles par les utilisateurs (décision produit P4 tranchée par l'utilisateur le 2026-11-03 : règle stricte)

Règle par défaut de S12 appliquée : **un MEMBER ou un VIEWER du workspace sans rôle sur un projet ne voit plus ce projet** (liste des projets, tâches, commentaires, pièces jointes, minuteur, créneaux, alertes du copilote, flux temps réel). OWNER et ADMIN du workspace gardent l'accès à tous les projets. Le créateur d'un projet et les personnes ayant un rôle projet (MANAGER, CONTRIBUTOR, COMMENTER, CLIENT) y accèdent.

Avant la mise en production, vérifier qui perdrait la visibilité de projets :

```sql
SELECT m.userId, m.workspaceId, m.role, COUNT(p.id) AS projets_sans_role
FROM Membership m
JOIN Project p ON p.workspaceId = m.workspaceId AND p.deletedAt IS NULL
LEFT JOIN ProjectMembership pm ON pm.projectId = p.id AND pm.userId = m.userId
WHERE m.role IN ('MEMBER', 'VIEWER') AND pm.id IS NULL AND p.userId <> m.userId
GROUP BY m.userId, m.workspaceId, m.role;
```

**Décision P4 (utilisateur, 2026-11-03) : règle stricte confirmée, aucun accès implicite.** Pour préserver les accès existants, le script `backend/scripts/grant-legacy-project-access.ts` accorde CONTRIBUTOR aux MEMBER et CLIENT (lecture seule) aux VIEWER sur les projets existants de leur workspace où ils n'ont pas de `ProjectMembership`. Il ne s'exécute **jamais** automatiquement ; l'utilisateur choisit de le lancer ou non, après sauvegarde :

```
cd backend
npx tsx --env-file=.env scripts/grant-legacy-project-access.ts          # rapport seul (dry-run), aucune écriture
npx tsx --env-file=.env scripts/grant-legacy-project-access.ts --apply  # application, en transaction
# option : --csv=<chemin> (défaut : reprise-phase0/grant-legacy-project-access-<mode>-<date>.csv)
```

- Par défaut, rapport seul. Le CSV ne contient que des identifiants (workspace, projet, utilisateur, rôles), aucune adresse e-mail.
- Ignorés : OWNER et ADMIN (MANAGER implicites), **le créateur du projet** (reconnu par `project.userId`, comme dans la requête SQL ci-dessus : les décomptes du rapport et de la requête concordent), comptes sans `Membership` (désactivés par SCIM), projets supprimés ou personnels, workspaces supprimés, et toute personne ayant déjà une `ProjectMembership` sur le projet (son rôle n'est jamais modifié).
- Idempotent : une seconde exécution ne trouve plus rien à accorder (`createMany` avec `skipDuplicates`).
- Revue du rapport recommandée avant `--apply` : accorder CONTRIBUTOR à tous les MEMBER sur tous les projets rétablit l'ancien périmètre, ce qui est plus large que le besoin réel de certains projets. Les rôles peuvent ensuite être resserrés projet par projet.

Autres effets :

- Les sprints ne sont plus modifiables par un VIEWER (lecture seule).
- `POST /projects/sprints/:id/tasks` refuse (403) toute liste contenant une tâche absente, d'un autre workspace ou d'un projet sans `task.write`. Le corps est validé : 200 identifiants UUID v4 au plus.
- `POST /projects/ai/execute` : 50 actions au plus, types d'action validés.
- Intégrations : `toggle` et `delete` répondent 404 pour une intégration d'un workspace dont l'appelant n'est pas membre.
- Temps réel : une seule gateway Socket.IO ; les données de tâches ne passent que par `project:<id>`. Les clients n'ont rien à changer (mêmes noms d'événements).

## 3. Exploitation

- Deux processus Socket.IO derrière un répartiteur : l'adaptateur Redis est désormais configuré une seule fois ; la révocation de salons (`socketsLeave`, `fetchSockets`) repose sur lui. Sans Redis, la révocation ne vaut que pour l'instance courante.
- Limites par socket : 300 messages par 10 s, 64 Ko par morceau audio, 10 Mo par session vocale.
- Si le recalcul des salons échoue (Redis ou base indisponible), les sockets de la personne concernée sont fermées (échec fermé) ; elles se reconnectent avec leurs droits à jour.

## 4. Effets de la reprise r11

### 4.1 S12-a : comptes désactivés ou retirés du workspace

Désormais, **aucun rôle de projet n'est accordé sans `Membership` non supprimée dans le workspace du projet** : ni le créateur, ni une `ProjectMembership` (même MANAGER), ni OWNER/ADMIN. Conséquences à connaître :

- Un compte désactivé par SCIM (`active=false` supprime sa `Membership`) perd immédiatement l'accès REST aux projets qu'il a créés ou où il avait un rôle, et `refreshUserRooms` le retire de `project:<id>` **et** de `task:<id>`. Si l'IdP le réactive, la `Membership` est recréée : ses `ProjectMembership` encore présentes lui rendent alors l'accès (elles ne sont pas supprimées par la désactivation).
- Les projets **personnels** (sans workspace) restent réservés à leur créateur.
- Avant production, repérer les lignes qui n'ouvrent plus aucun accès (orphelines) :

```sql
SELECT pm.userId, pm.projectId, pm.role
FROM ProjectMembership pm
JOIN Project p ON p.id = pm.projectId AND p.workspaceId IS NOT NULL
LEFT JOIN Membership m ON m.workspaceId = p.workspaceId AND m.userId = pm.userId
WHERE m.id IS NULL;
```

Aucune suppression n'est faite par le code : le nettoyage éventuel de ces lignes est une décision d'exploitation (voir `assignProjectRole` et S17, Phase 4).

### 4.2 Autres changements visibles

- Livrables, livraisons, jalons et rapport de livraison : lecture (`GET /projects/:id/delivery-report`) pour tout rôle de projet (dont CLIENT) ; création et changement d'état pour un MANAGER du projet ; cocher un élément de checklist pour CONTRIBUTOR et plus. **Un MEMBER ou un VIEWER sans rôle sur le projet n'y a plus accès.** Un projet inexistant répond 404 (et non plus 500).
- Mentions `@nom` et assignations : seules les personnes ayant accès au projet de la tâche (`comment.read` pour les mentions, `task.read` pour les assignations) sont notifiées ou assignées ; les autres sont ignorées sans erreur.
- `GET /projects/resources/capacity` : les champs `costRateCents` et `billingRateCents` du profil ne sont renvoyés qu'aux OWNER et ADMIN.
- `POST /projects/sprints/:id/tasks` avec un sprint inexistant répond 403 (comme une tâche interdite), plus 404.
- Temps réel : à la création d'un projet, le créateur et les OWNER/ADMIN connectés rejoignent `project:<id>` sans se reconnecter ; idem pour un membre déjà présent qui accepte une invitation à un projet. Un retrait de rôle ou une désactivation coupe aussi les salons `task:<id>` ouverts.
- `POST /projects/ai/command|voice|vision` : les actions renvoyées sont normalisées (champs connus uniquement, `null` retirés, `estimatedMinutes` entier entre 0 et 100000) pour être renvoyées telles quelles à `POST /projects/ai/execute`, dont le DTO reste strict.
- **Reprise r12 et r13 (notes et tâches issues des notes)** :
  - Un tag `#Projet` dans une note ne vise que les projets **de l'auteur** où il peut écrire des tâches (`task.write`) ; sinon la tâche va dans un projet **personnel** du même nom, créé au besoin. Une personne qui a perdu l'accès à un projet de workspace voit donc apparaître un projet personnel homonyme (effet idempotent : les lignes suivantes le retrouvent).
  - Une tâche dont l'auteur n'a plus `task.write` (accès perdu), ou dont le projet est **supprimé**, n'est plus modifiée par sa note : la ligne est conservée telle quelle, sans erreur. Une tâche d'un projet supprimé ne peut pas être ressuscitée ni déplacée par une note.
  - **Une tâche ne change plus de workspace par une note** (r13, S12-h) : le déplacement n'est permis qu'entre deux projets du même workspace, ou entre deux projets personnels de l'auteur. Si le tag vise un autre workspace (ou un projet personnel depuis un projet de workspace, ou l'inverse), `projectId` reste inchangé et les autres champs (titre, statut, échéance) sont mis à jour normalement, sans message d'erreur. Une ligne sans tag (« Inbox ») ne sort donc plus une tâche de son projet.
  - **La note d'un auteur sans accès n'est plus synchronisée** (r13, S12-g) : si l'auteur de la note n'a plus `task.read` sur le projet de la tâche (désactivé par SCIM, retiré du projet), le renommage ou le changement de statut de la tâche n'est plus recopié dans sa note. La dernière ligne connue y reste.
  - Un assigné proposé par l'IA est vérifié contre le projet **où reste la tâche** (r14, S12-i) : si le déplacement est refusé, c'est le projet d'origine qui compte, et un assigné valide seulement dans le projet visé (par exemple d'un autre workspace) est ignoré sans toucher aux assignés existants. Un assigné proposé par l'IA qui n'a pas accès au projet est ignoré (aucune assignation). L'optimisation de charge (`optimizeWorkspaceResources`) ne réassigne qu'aux personnes ayant accès au projet ; si aucun candidat n'est autorisé, la tâche garde son assigné.
  - **Supprimer une note ne supprime que les tâches des projets où l'auteur peut encore écrire** (r15, S12-j) : la note est toujours supprimée, mais les tâches qu'elle a créées dans un projet où l'auteur n'a plus `task.write` (rétrogradé COMMENTER ou CLIENT, retiré du projet, désactivé par SCIM) restent en place. Ses tâches de projets personnels sont supprimées comme avant. Aucun message d'erreur.
  - Éviction temps réel : une tâche déplacée entre deux projets du même workspace fait quitter le salon `task:<id>` à tous ses abonnés ; les clients autorisés le rejoignent de nouveau par `join-task`.

### 4.3 Dépendance de test

`socket.io-client@4.7.5` ajouté en `devDependencies` du backend (version déjà verrouillée pour le frontend ; test d'intégration Socket.IO réel, S16-a). `pnpm-lock.yaml` : 3 lignes ajoutées, aucun autre paquet. Aucune dépendance d'exécution.

## 5. Décisions produit tranchées par l'utilisateur le 2026-11-03

L'utilisateur applique les recommandations de l'architecte (rapport, section « Recommandations sur les décisions produit », r11). Ces décisions ne valent pas validation de la phase : la Phase 3 reste soumise à la revue de l'architecte.

| Décision | État | Conséquence |
| --- | --- | --- |
| P4 : MEMBER ou VIEWER sans `ProjectMembership` | **Tranchée (2026-11-03) : règle stricte, aucun accès implicite.** | Aucun changement de code de la politique. Script de reprise optionnel `backend/scripts/grant-legacy-project-access.ts` (voir § 2) : dry-run par défaut, `--apply` à la seule initiative de l'utilisateur, jamais exécuté par le projet. Tests unitaires sur Prisma simulé. |
| `timelog.read` réservé à MANAGER et CONTRIBUTOR | **Tranchée (2026-11-03) : confirmé.** | Aucun changement de code. Option plus stricte ultérieure : CONTRIBUTOR ne voit que ses propres relevés. |
| DTO strict de `ai/execute` | **Tranchée (2026-11-03) : DTO strict confirmé.** | Aucun changement de code ; normalisation côté serveur déjà en place (§ 4.2). |
