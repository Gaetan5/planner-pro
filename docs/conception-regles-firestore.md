# Spécification et conception des règles d'accès Firestore

**Date :** 26 octobre 2026  
**Statut :** Spécification préparatoire — Règles déployées actuelles : « deny all » (`firestore.rules`).

Ce document définit le modèle de sécurité et d'autorisation d'accès direct pour Firestore, conformément à la **Section 4 du Manifeste de synchronisation Firebase / Firestore**.

---

## 1. Modèle d'identité et de correspondance

Pour qu'un client direct (application Web, mobile) puisse interagir avec Firestore de manière sécurisée :

1. **Authentification obligatoire** : `request.auth != null`.
2. **Adresse e-mail vérifiée** : `request.auth.token.email_verified == true`.
3. **Liaison d'identité** : Le compte MySQL Planner Pro détient le `firebaseUid` correspondant. L'endpoint `/api/auth/firebase/link` et la connexion `/api/auth/firebase/login` garantissent cette correspondance univoque.

---

## 2. Partitionnement des données dans Firestore

Les données sont partitionnées par espace de travail (`workspaceId`) :

```text
/workspaces/{workspaceId}
    ├── /projects/{projectId}
    │       └── /tasks/{taskId}
    └── /entities/{entityType}:{entityId}
            ├── membership:{userId}
            ├── comment:{commentId}
            ├── timeLog:{timeLogId}
            ├── milestone:{milestoneId}
            ├── sprint:{sprintId}
            └── note:{noteId}
```

### Espaces personnels (`personal-{userId}`)

- Un utilisateur accède en lecture et écriture complètes à son espace personnel :

  ```firestore
  function isPersonalSpace(workspaceId) {
    return request.auth != null && workspaceId == ('personal-' + request.auth.uid);
  }
  ```

### Espaces partagés (`workspaceId` standard)

- La vérification d'appartenance s'appuie sur la présence de l'adhésion :

  ```firestore
  function getMembership(workspaceId) {
    return get(/databases/$(database)/documents/workspaces/$(workspaceId)/entities/$('membership:' + request.auth.uid));
  }

  function isMember(workspaceId) {
    return isPersonalSpace(workspaceId) || (
      request.auth != null &&
      exists(/databases/$(database)/documents/workspaces/$(workspaceId)/entities/$('membership:' + request.auth.uid))
    );
  }

  function getRole(workspaceId) {
    return isPersonalSpace(workspaceId) ? 'OWNER' : getMembership(workspaceId).data.role;
  }

  function isOwnerOrAdmin(workspaceId) {
    return isMember(workspaceId) && (getRole(workspaceId) in ['OWNER', 'ADMIN']);
  }
  ```

---

## 3. Matrice des droits par rôle

| Rôle | Lecture (Projets/Tâches/Notes) | Création/Édition Tâche & Note | Suppression Projets/Tâches | Gestion Membres & Rôles |
| :--- | :---: | :---: | :---: | :---: |
| **OWNER** | Oui | Oui | Oui | Oui |
| **ADMIN** | Oui | Oui | Oui | Oui (sauf OWNER) |
| **MEMBER** | Oui | Oui | Non | Non |
| **VIEWER** | Oui (lecture seule) | Non | Non | Non |
| **Non-membre** | Refusé | Refusé | Refusé | Refusé |

---

## 4. Règles Firestore prêtes pour tests sur émulateur

Ces règles sont destinées à être validées sur l'émulateur Firebase (`firebase emulators:start`) avec la suite de tests automatisés avant tout remplacement de la règle de production actuelle (« deny all ») :

```firestore
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthenticated() {
      return request.auth != null && request.auth.token.email_verified == true;
    }

    function isPersonalSpace(workspaceId) {
      return isAuthenticated() && workspaceId == ('personal-' + request.auth.uid);
    }

    function isMember(workspaceId) {
      return isPersonalSpace(workspaceId) || (
        isAuthenticated() &&
        exists(/databases/$(database)/documents/workspaces/$(workspaceId)/entities/$('membership:' + request.auth.uid))
      );
    }

    function getRole(workspaceId) {
      return isPersonalSpace(workspaceId)
        ? 'OWNER'
        : get(/databases/$(database)/documents/workspaces/$(workspaceId)/entities/$('membership:' + request.auth.uid)).data.role;
    }

    function isOwnerOrAdmin(workspaceId) {
      return isMember(workspaceId) && (getRole(workspaceId) in ['OWNER', 'ADMIN']);
    }

    // Protection globale par défaut
    match /{document=**} {
      allow read, write: if false;
    }

    // Gestion des workspaces
    match /workspaces/{workspaceId} {
      allow read: if isMember(workspaceId);
      allow write: if isOwnerOrAdmin(workspaceId);

      // Projets
      match /projects/{projectId} {
        allow read: if isMember(workspaceId);
        allow create, update: if isOwnerOrAdmin(workspaceId) || getRole(workspaceId) == 'MEMBER';
        allow delete: if isOwnerOrAdmin(workspaceId);

        // Tâches du projet
        match /tasks/{taskId} {
          allow read: if isMember(workspaceId);
          allow create, update: if isMember(workspaceId) && getRole(workspaceId) != 'VIEWER';
          allow delete: if isOwnerOrAdmin(workspaceId);
        }
      }

      // Entités diverses (commentaires, jalons, livrables, notes, etc.)
      match /entities/{entityKey} {
        allow read: if isMember(workspaceId);
        // Seuls OWNER et ADMIN peuvent créer/modifier une adhésion (membership:*)
        // Les autres entités sont modifiables par tout membre non-VIEWER
        allow create, update: if isMember(workspaceId) && (
          entityKey.matches('^membership:.*')
            ? isOwnerOrAdmin(workspaceId)
            : getRole(workspaceId) != 'VIEWER'
        );
        allow delete: if isOwnerOrAdmin(workspaceId);
      }
    }
  }
}
```

---

## 5. Plan de validation sur Firebase Emulator

Avant déploiement en production :

1. **Scénario 1 : Accès autorisé** — Un utilisateur `MEMBER` accède aux projets et tâches de son workspace.
2. **Scénario 2 : Isolation inter-équipes** — L'utilisateur d'un workspace A ne peut ni lire ni lister les documents du workspace B.
3. **Scénario 3 : Escalade de privilèges** — Un `VIEWER` ou un `MEMBER` ne peut pas modifier un rôle `membership` ni supprimer un projet.
4. **Scénario 4 : Espace personnel** — Un utilisateur non authentifié ou avec un UID différent ne peut pas accéder à `personal-{userId}`.
