import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  signOut,
  type Auth,
} from 'firebase/auth';
import { firebaseConfig, isFirebaseAuthConfigured } from './firebase-config';

let firebaseAuth: Auth | undefined;

export function getFirebaseAuth(): Auth {
  if (!isFirebaseAuthConfigured) {
    throw new Error('Firebase Auth nécessite les variables VITE_FIREBASE_* dans le frontend.');
  }

  if (!firebaseAuth) {
    const appName = 'planner-pro-auth';
    const app = getApps().some((registeredApp) => registeredApp.name === appName)
      ? getApp(appName)
      : initializeApp(firebaseConfig, appName);
    // Pas de `getAuth()` : il branche le résolveur popup/redirection, qui charge de lui-même
    // `apis.google.com/js/api.js` et l'iframe `<authDomain>/__/auth/iframe` sur mobile et Safari
    // (r42-m1). Seul `signInWithEmailAndPassword` est utilisé. La persistance reprend celle de
    // `getAuth()` (même stockage, sessions existantes conservées). Ne pas réintroduire de
    // `popupRedirectResolver` sans compléter la CSP (docs/security/en-tetes-frontend.md).
    firebaseAuth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
    });
  }

  return firebaseAuth;
}

export async function signOutFirebase(): Promise<void> {
  if (isFirebaseAuthConfigured) {
    await signOut(getFirebaseAuth());
  }
}
