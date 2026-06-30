# 🛠️ Plan d'Implémentation — Synchronisation Kanban / Gantt Réactive (Méthode OODA)

> **Posture** : Lead Software Architect / Senior Full-Stack Engineer  
> **Date** : 30 juin 2026  
> **Objectif** : Implémenter les règles d'auto-synchronisation intelligente et réactive entre le Kanban (statuts fonctionnels) et le Gantt (planification temporelle globale).

---

## Proposed Changes

### [Backend]

#### [MODIFY] [tasks.service.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/tasks.service.ts)

- **Règle 1 (Kanban ➔ Gantt)** :
  Dans la méthode `updateTask` (ou juste avant de sauvegarder les modifications dans la transaction Prisma), si le nouveau statut de la tâche passe à `IN_PROGRESS` (En cours) et que la tâche ne possède pas encore de dates globales de planification (`startDate` ou `dueDate`), affecter automatiquement :
  - `startDate` = date/heure actuelle.
  - `dueDate` = date/heure actuelle + 2 jours (48 heures).

- **Règle 2 (Gantt ➔ Kanban)** :
  Dans la méthode `updateTask`, si la tâche reçoit ou modifie sa date globale de début (`startDate`) pour une date égale ou antérieure à la date actuelle (aujourd'hui ou dans le passé), et que son statut est encore à l'état `TODO`, basculer automatiquement son statut à `IN_PROGRESS`.

- **Propagation** :
  Veiller à ce que ces dates auto-calculées ou statuts modifiés soient correctement propagés en cascade vers les tâches dépendantes via la méthode existante `propagateScheduleUpdates`.

#### [MODIFY] [tasks.service.spec.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/tasks.service.spec.ts) (ou les tests unitaires associés)

- Ajouter des cas de tests unitaires pour valider les comportements attendus :
  - Tester que le passage d'une tâche sans dates à `IN_PROGRESS` remplit bien sa `startDate` et `dueDate` par défaut.
  - Tester que la planification d'une tâche `TODO` avec une `startDate` passée ou présente la fait basculer automatiquement en `IN_PROGRESS`.
  - S'assurer qu'aucune régression n'est introduite sur les 116 tests existants.

---

## Verification Plan

### Automated Tests

- Exécuter la suite complète de tests Jest sur le backend pour valider le comportement :

  ```bash
  pnpm --filter backend test
  ```

### Manual Verification

1. Lancer l'environnement Docker-Compose ou le serveur local.
2. Ouvrir le Kanban et déplacer une tâche non planifiée de "À faire" à "En cours".
3. Ouvrir le diagramme de Gantt et vérifier que la tâche y apparaît désormais sur un créneau de 2 jours débutant aujourd'hui.
4. Ouvrir le Gantt, déplacer la date de début d'une tâche au statut "À faire" vers aujourd'hui ou dans le passé, et vérifier qu'elle passe automatiquement à "En cours" sur le Kanban.
