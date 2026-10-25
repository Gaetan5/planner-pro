import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, signOut, type Auth } from 'firebase/auth';
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
    firebaseAuth = getAuth(app);
  }

  return firebaseAuth;
}

export async function signOutFirebase(): Promise<void> {
  if (isFirebaseAuthConfigured) {
    await signOut(getFirebaseAuth());
  }
}
