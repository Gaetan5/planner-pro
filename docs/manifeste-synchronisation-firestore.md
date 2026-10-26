# Manifeste de synchronisation Firebase / Firestore

**Mis à jour le :** 26 octobre 2026  
**État global :** chantier partiel — Firestore n’est pas la source de vérité et la
synchronisation de production est désactivée.

Ce manifeste distingue les actions vérifiées des travaux restant à faire. Le pilote
actuel est un miroir serveur MySQL → Firestore pour une partie des projets, tâches,
dépendances et blocs horaires ;
il ne constitue ni une migration complète, ni une garantie de fonctionnement hors ligne.

## État actuel vérifié

- L’application de production tourne sur Oracle dans `/opt/planner-pro`.
- Le dépôt de production est sur `main`, commit `7b52032`.
- La migration de base de données `20261107130000_firestore_sync_outbox` a été appliquée
  avec succès en production via Prisma.
- Les conteneurs backend et frontend ont été reconstruits et redémarrés avec succès.
- Le site et l’API répondent HTTP 200 sur leurs sous-domaines publics HTTPS :
  - Frontend : `https://planner-pro.boukarou-os.com` (HTTP 200 OK)
  - API Backend : `https://api.planner-pro.boukarou-os.com` (HTTP 200 OK)
- `FIRESTORE_SYNC_ENABLED=false` est maintenu en production ; aucune écriture non sollicitée
  n'est envoyée vers Firestore.
- La région Firestore de production précédemment vérifiée est `eur3`. Les règles
  présentées ici n’ont pas été déployées sur Firebase.
- L’utilisateur a confirmé la révocation de l’ancienne clé exposée dans Google Cloud
  IAM. Après cette révocation, l’authentification Firebase Admin a été vérifiée à
  nouveau depuis Oracle.
- Les fichiers `.env` sont ignorés par Git. Le JSON de compte de service transféré dans
  la racine du dépôt a été retiré après usage. Ne pas partager ni committer ces secrets.

## Tâches terminées

- [x] Ajouter une table d’outbox Prisma et une migration SQL versionnée pour enregistrer
      les événements du pilote : `FirestoreSyncOutbox`.
- [x] Ajouter un worker backend désactivé par défaut, avec authentification Firebase
      Admin, reprise exponentielle, leases, marquage idempotent des documents et protection
      contre l’écrasement d’un document par un événement de séquence plus ancienne.
- [x] Relier au pilote les mutations principales de création, mise à jour et suppression
      des projets et tâches ; inclure les affectations de tâches et les tâches modifiées par
      propagation d’échéance dans les chemins concernés.
- [x] Relier les créations/suppressions de dépendances et les créations, mises à jour
      et suppressions de blocs horaires à l’outbox dans la transaction métier.
- [x] Relier les commentaires (`comment`), pièces jointes (`attachment`), jalons (`milestone`),
      livrables (`deliverable`, `deliveryRecord`, `deliveryChecklistItem`), sprints (`sprint`),
      congés (`resourceLeave`) et notes (`note`) à l’outbox avec transactions atomiques MySQL.
- [x] Relier les invitations (`invitation`), adhésions d'espaces (`membership`), notifications
      (`notification`) et sessions de suivi du temps (`timeLog`) à l'outbox avec transactions
      atomiques MySQL et exclusion des données sensibles (tokens hashés, etc.).
- [x] Ajouter un mécanisme de purge automatique et configurable des événements traités
      (`cleanupProcessedEvents` déclenché chaque nuit via cron) selon `FIRESTORE_SYNC_RETENTION_DAYS`.
- [x] Ajouter des tests unitaires qui vérifient la publication des événements de ces
      opérations dans l’outbox pour chaque domaine métier raccordé.
- [x] Ajouter une supervision agrégée de la file dans la santé API et la console admin,
      sans exposer le contenu des erreurs ni les données de l’outbox.
- [x] Ajouter des règles Firestore locales « deny all » pour les clients directs, tant
      que l’autorisation par espace et la correspondance UID Firebase/utilisateur Planner
      Pro ne sont pas implémentées.
- [x] Documenter les limites, les variables de configuration et la prudence requise
      avant toute activation dans le guide de déploiement.
- [x] Mettre à jour les fichiers d’environnement locaux et Oracle avec le compte de
      service remplacé ; maintenir le miroir désactivé.
- [x] Vérifier l’authentification Firebase Admin depuis le backend Oracle sans afficher
      les identifiants.
- [x] Vérifier les builds frontend/backend, le schéma Prisma, Compose, les règles
      « deny all » et l’hygiène du diff.
- [x] Ajouter le service de reprise et d'audit de cohérence `FirestoreBackfillService`
      avec pagination par curseur, contrôle de débit (`delayMs`), détection des divergences
      sans secrets et protection contre l'écrasement des documents plus récents (`syncSequence > 0`).
- [x] Résultats des suites vérifiées : 29 suites et 172 tests backend réussis, 8 suites et 18 tests frontend réussis, compilation complète `pnpm build` validée.

## Limites connues du pilote

- Sont désormais reliés à l'outbox : projets, tâches, dépendances, blocs horaires,
  commentaires, pièces jointes, jalons, livrables, checklists, sprints, congés, notes,
  invitations, membres, notifications et suivi du temps (time tracking).
  Les finances sont calculées dynamiquement à la volée sur les entités synchronisées.
  Les domaines restant à arbitrer concernent les connecteurs tiers et flux IA externes.
- Les lectures de l’application restent faites par l’API NestJS et Prisma/MySQL.
- Un outil d'audit et de reprise paginé `FirestoreBackfillService` est désormais en place
  pour comparer et amorcer les données MySQL vers Firestore de manière idempotente.
- Les événements de suppression sont des marqueurs logiques. La politique de purge et
  de rétention des tombstones n’est pas définie.
- Les événements de séquence protègent l’ordre d’application dans Firestore ; ce
  mécanisme ne définit pas les conflits de modifications concurrentes venant de
  plusieurs clients.
- Les règles refusent les clients directs, et doivent le faire tant qu’un modèle
  complet d’autorisations Firebase n’est pas préparé.
- Le worker serveur utilise Firebase Admin et contourne les règles Firestore. Son accès
  doit rester limité aux identifiants et au code backend protégés.
- Un succès de test unitaire ou d’authentification Admin ne prouve pas une synchronisation
  métier complète ni une restauration testée.

## Travaux restant à faire

### 1. Sécurité et hygiène des identifiants — bloquant

- [x] Révoquer l’ancienne clé de service Firebase exposée dans Google Cloud IAM ;
      confirmer que Firebase Admin continue de fonctionner avec la nouvelle clé.
- [ ] Confirmer que la clé remplacée est la seule clé active utilisée par la production.
- [ ] Examiner les journaux et l’historique du dépôt pour vérifier qu’aucun autre secret
      ne doit être renouvelé. Ne jamais ajouter de fichiers `.env` ou de JSON de compte de
      service à Git.
- [ ] Définir et documenter le compte de service minimalement privilégié, la rotation
      périodique et la procédure de révocation d’urgence.

### 2. Modèle de données et mutations — en cours (couverture élargie)

- [x] Cartographier et relier les principaux modèles métier à l'outbox : `Project`, `Task`,
      `TaskDependency`, `TimeBlock`, `Comment`, `Attachment`, `Milestone`, `Deliverable`,
      `DeliveryRecord`, `DeliveryChecklistItem`, `Sprint`, `ResourceLeave`, `Note`.
- [x] Couvrir les domaines des invitations (`invitation`), adhésions (`membership`),
      notifications (`notification`) et suivi du temps (`timeLog`).
- [x] Exclure explicitement mots de passe, clés de hash, jetons OAuth, secrets d’intégration et
      autres données d’authentification de tous les payloads de synchronisation.
- [x] Valider que les transactions métier et l’outbox réussissent ou échouent ensemble via
      `prisma.$transaction` avec tests unitaires pour chaque domaine.
- [x] Prévoir rétention et purge des événements traités (`cleanupProcessedEvents` quotidien via cron) ;
      supervision opérationnelle en place via l'endpoint de santé et la console admin.
- [ ] Définir la politique pour les données restantes : finances (projections dynamiques)
      et connecteurs tiers.

### 3. Reprise initiale et cohérence — bloquant avant source Firestore

- [x] Construire un outil de reprise MySQL → Firestore avec pagination, reprise après
      interruption, limites de débit et journalisation sans secrets (`FirestoreBackfillService.backfill`).
- [x] Rendre la reprise idempotente et sûre à relancer sans écraser une mutation plus
      récente (préservation des séquences outbox `syncSequence > 0`).
- [x] Comparer les comptes, identifiants et empreintes des enregistrements par domaine
      (`FirestoreBackfillService.auditConsistency`).
- [x] Produire un rapport de divergences et une procédure de correction contrôlée
      (`ConsistencyAuditResult` structuré).
- [ ] Tester sauvegarde et restauration des deux côtés, et définir rétention, RPO et
      RTO acceptés.

### 4. Autorisation et règles Firestore — bloquant avant accès client

- [x] Établir la liaison fiable entre les UID Firebase vérifiés et les comptes Planner
      Pro ; traiter les comptes historiques et changements d’identité (`/api/auth/firebase/login`
      et `/api/auth/firebase/link` avec tests unitaires).
- [x] Concevoir des règles d’accès par espace/projet, rôle et propriétaire ; couvrir
      lecture, création, modification, suppression et requêtes de listes (`docs/conception-regles-firestore.md`).
- [ ] Ajouter des tests automatisés Firebase Emulator pour accès autorisé, accès refusé,
      escalade de rôle et isolation entre deux équipes.
- [ ] Déployer les règles seulement après revue et tests ; ne pas remplacer « deny all »
      par une règle générale permissive.

### 5. Lectures et autorité des données — bloquant avant bascule

- [ ] Choisir et documenter explicitement le modèle d’autorité : Firestore autoritaire,
      MySQL projection, ou période temporaire de double lecture contrôlée.
- [ ] Implémenter et tester les lectures Firestore avec conservation des contrôles
      d’accès, filtres, pagination, tri et comportements API actuels.
- [ ] Définir la cohérence, les délais de propagation, la gestion des indisponibilités
      et le comportement des fonctionnalités qui requièrent des transactions relationnelles.
- [ ] Préparer un déploiement canari et une procédure de retour à MySQL qui ne perde pas
      les écritures faites pendant la bascule.

### 6. Mode hors ligne et conflits — non implémenté

- [ ] Choisir une stratégie hors ligne adaptée aux données et aux appareils ; préciser
      les mutations acceptées sans réseau.
- [ ] Implémenter une file locale durable, son chiffrement si requis, la reprise après
      fermeture/crash et l’état visible des modifications en attente.
- [ ] Définir une politique de résolution de conflits par type de donnée et prévenir
      les écrasements silencieux entre deux membres.
- [ ] Tester hors ligne, reconnexion, doublons, ordre d’événements, modifications
      concurrentes, révocation d’accès et changement de compte.
- [ ] Valider le parcours avec deux utilisateurs d’une équipe sur un jeu de données
      isolé avant toute production.

### 7. Déploiement de production — en cours (pilote déployé)

- [x] Committer et livrer le code du pilote (`origin/main`, commit `7b52032`).
- [x] Appliquer la migration d’outbox en production (`20261107130000_firestore_sync_outbox`
      appliquée avec succès).
- [x] Déployer une version backend et frontend compatible, en maintenant `FIRESTORE_SYNC_ENABLED=false`.
- [x] Confirmer le bon fonctionnement des sous-domaines publics HTTPS (`planner-pro.boukarou-os.com`
      et `api.planner-pro.boukarou-os.com`).
- [ ] Tester en préproduction isolée avec des données non sensibles, puis comparer la
      file et les documents Firestore via `FirestoreBackfillService.auditConsistency`.
- [ ] Activer par canari seulement après validation des tâches précédentes, surveiller
      les métriques et journaux, et documenter la décision de bascule.
- [ ] Effectuer tests navigateur authentifiés et tests à deux utilisateurs ; confirmer
      les parcours d’administration et les permissions.
- [x] Ne pas modifier le reverse proxy ni redémarrer les autres projets hébergés sur la
      VM pendant le déploiement.

## Critères de clôture de la mission complète

La migration ne sera considérée comme terminée que lorsque toutes les tâches bloquantes
ci-dessus auront une preuve vérifiable, que la reprise et la comparaison des données
seront validées, que les règles et conflits auront des tests automatisés, et que le
parcours hors ligne à deux utilisateurs aura réussi en environnement isolé. La
production devra ensuite être déployée par étapes avec sauvegarde vérifiée, métriques,
tests authentifiés et retour arrière exercé.
