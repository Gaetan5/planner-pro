# Plan d'implémentation — Extension Professionnelle & Sécurisation de Planner Pro

Ce document détaille le plan d'action pour sécuriser les logs de tracking et intégrer l'ensemble des modules métiers professionnels (phases 1 à 4) dans l'interface utilisateur de Planner Pro.

## User Review Required

> [!IMPORTANT]
> Les modifications proposées ajoutent deux nouveaux onglets dans le Header principal de l'application : **Gouvernance** (pour les jalons, livrables, dépendances et livraisons) et **Ressources** (pour les membres, profils de ressources, capacités de charge et allocations de projets).

> [!WARNING]
> La correction de sécurité sur le endpoint `GET /tracking/logs/:taskId` restreindra l'accès aux logs uniquement au créateur de la tâche ou aux membres du workspace lié.

## Proposed Changes

---

### [Component Backend] - Sécurisation du Time Tracking

#### [MODIFY] [tracking.controller.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/tracking/tracking.controller.ts)
- Ajouter l'injection de `@Req() req: any` dans l'endpoint `getTimeLogsForTask(@Param('taskId') taskId: string)` pour pouvoir passer `req.user.id`.

#### [MODIFY] [tracking.service.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/tracking/tracking.service.ts)
- Mettre à jour la méthode `startTracking(userId, taskId)` pour valider que la tâche appartient à l'utilisateur ou qu'il fait partie du workspace du projet de la tâche.
- Mettre à jour la méthode `getTimeLogsForTask(userId, taskId)` pour ajouter la même clause de garde d'autorisation (fail-fast avec `ForbiddenException` ou `BadRequestException` si non autorisé).

---

### [Component Frontend] - Contexte & Actions Globales

#### [MODIFY] [AppContext.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/context/AppContext.tsx)
- Mettre à jour l'interface `AppContextType` pour inclure :
  - Les états : `workspaces` (tableau) et `resourceCapacity` (tableau).
  - Les fonctions : `createMilestone`, `completeMilestone`, `createDeliverable`, `updateDeliverableStatus`, `createDelivery`, `updateDeliveryStatus`, `addTaskDependency`, `removeTaskDependency`, `updateResourceProfile`, `createResourceAllocation`.
- Implémenter les appels d'API correspondants dans le corps d' `AppProvider`.
- Mettre à jour `refreshData()` pour récupérer les workspaces (`/projects/workspaces`) et le rapport de capacité des ressources (`/projects/resources/capacity`) en parallèle des autres requêtes.

---

### [Component Frontend Components] - Nouvelles Vues Métiers

#### [NEW] [GovernanceView.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/GovernanceView.tsx)
- Créer une vue sémantique premium gérant :
  1. **Workspaces & Équipe** : Visualiser l'Espace de travail en cours, son propriétaire, et ses membres avec leurs rôles respectifs.
  2. **Jalons (Milestones)** : Afficher la liste des jalons par projet avec leurs échéances, leur état d'achèvement et un formulaire pour ajouter un jalon. Bouton d'action pour marquer un jalon comme terminé.
  3. **Livrables (Deliverables)** : Affichage interactif des livrables, filtre par statut, formulaire d'ajout, et dropdown pour changer leur statut (DRAFT -> READY_FOR_REVIEW -> ACCEPTED -> DELIVERED).
  4. **Validation de Livraison (Delivery Records)** : Formulaire de livraison d'un projet avec résumé et checklist d'acceptation. Liste des livraisons précédentes avec gestion dynamique de la checklist interactive et boutons de décision (Accepter / Rejeter la livraison).
  5. **Bilan & Clôture de Projet** : Afficher un rapport final quand toutes les tâches et tous les livrables sont validés (comparatif temps prévu/réel, retards, etc.).

#### [NEW] [GovernanceView.css](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/GovernanceView.css)
- Styles CSS vanilla premium respectant le design system de l'application (thème sombre/clair, Glassmorphism, animations douces et contrastes HSL).

#### [NEW] [CapacityView.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/CapacityView.tsx)
- Créer la vue de planification de charge de travail :
  1. **Tableau de Charge (Capacity Report)** : Cartes d'utilisateurs indiquant le rôle, la capacité hebdomadaire (en heures), les minutes planifiées (time-blocks) et le taux d'allocation projet global.
  2. **Alertes de Surcharge** : Badge rougeoyant d'avertissement si la capacité hebdomadaire ou l'allocation projet dépasse 100%.
  3. **Configuration du Profil (ResourceProfile)** : Formulaire pour mettre à jour la capacité hebdomadaire, les compétences et le coût horaire d'un membre.
  4. **Allocation de Projet (ResourceAllocation)** : Formulaire d'affectation d'un membre à un projet (dates d'allocation et taux de disponibilité %).

#### [NEW] [CapacityView.css](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/CapacityView.css)
- Styles CSS vanilla premium assortis à la charte graphique pour la visualisation des charges des membres.

---

### [Component Frontend Integration] - Intégration Générale

#### [MODIFY] [KanbanBoard.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/components/KanbanBoard.tsx)
- Dans la carte de tâche `DraggableCard` : afficher les dépendances actives s'il y en a.
- Dans le formulaire d'ajout/modification de tâche : ajouter des champs permettant de lier ou de supprimer des dépendances entre tâches (ex: "Dépend de...").

#### [MODIFY] [App.tsx](file:///home/gaetan/Documents/GitHub/planner-pro/frontend/src/App.tsx)
- Importer et déclarer les deux nouveaux onglets `governance` et `resources` dans le routeur local de `AppWithSession()`.
- Mettre à jour le Header de navigation de bureau et la barre de navigation mobile en ajoutant les boutons correspondants équipés des icônes Lucide (`ShieldCheck` et `Users`).

---

## Verification Plan

### Automated Tests
- Lancer la suite de tests backend pour s'assurer que les changements de sécurité n'ont pas altéré les fonctionnalités existantes.
  ```bash
  pnpm --filter backend test
  ```

### Manual Verification
1. Lancer l'application localement avec `pnpm dev` ou Docker.
2. Créer des jalons et des livrables sur un projet existant, puis vérifier leur affichage en temps réel.
3. Programmer des blocs de temps pour un utilisateur, et vérifier son taux de charge dans l'onglet **Ressources**.
4. Déclarer une livraison et changer le statut vers `ACCEPTED`, puis vérifier que le projet passe automatiquement au statut `DELIVERED`.
5. Valider que les modifications de sécurité renvoient bien une erreur 400/403 si un utilisateur tente de requêter les logs d'une tâche dont il n'est pas le propriétaire ni membre.
