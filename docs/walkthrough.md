# 🚀 Walkthrough — Synchronisation Kanban / Gantt Réactive (Méthode OODA)

> **Posture** : Lead Software Architect / Senior Full-Stack Engineer  
> **Date** : 30 juin 2026

Nous avons implémenté les règles d'auto-synchronisation intelligente et bidirectionnelle réactive pour améliorer la synergie entre les vues Kanban et Gantt.

---

## 🛠️ Modifications Apportées

### [Backend]

- **Règles OODA intégrées dans [tasks.service.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/src/projects/tasks.service.ts) :**
  - **Règle 1** : Si une tâche passe au statut `IN_PROGRESS` et que ses dates globales de planification (`startDate` / `dueDate`) sont vides, le système lui affecte automatiquement la date actuelle comme date de début, et l'échéance à +2 jours. Elle apparaît ainsi directement sur le diagramme de Gantt.
  - **Règle 2** : Si une tâche a le statut `TODO` et que sa date de début (`startDate`) est planifiée à aujourd'hui ou dans le passé sur le Gantt, elle passe automatiquement à l'état `IN_PROGRESS` sur le Kanban.
- **Mise à jour des tests dans [tasks.service.spec.ts](file:///home/gaetan/Documents/GitHub/planner-pro/backend/tests/unit/projects/tasks.service.spec.ts) :**
  - Ajout de la validation unitaire pour la Règle 1.
  - Ajout de la validation unitaire pour la Règle 2.
  - Correction du typage TypeScript de l'objet de mock Prisma pour éviter les erreurs de self-referencing.

---

## 🧪 Plan de Validation

### Tests Automatisés

La suite de tests unitaires et d'intégration Jest a été exécutée sur le backend pour s'assurer du bon fonctionnement :

```bash
pnpm --filter backend test
```

### Validation Manuelle

1. Ouvrir le Kanban sur `http://localhost:3004`.
2. Glisser une tâche sans date (ex: _"Poser une question à l'Assistant IA"_) vers "En cours" : elle reçoit des dates et s'affiche sur le Gantt.
3. Programmer une tâche au statut "À faire" avec une date de début égale ou antérieure à aujourd'hui : elle bascule directement en "En cours".
