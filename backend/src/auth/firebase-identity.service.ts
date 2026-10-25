import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

@Injectable()
export class FirebaseIdentityService {
  async verifyIdToken(idToken: string) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new ServiceUnavailableException(
        "Firebase Auth n'est pas configuré côté serveur (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).",
      );
    }

    const appName = 'planner-pro-firebase-auth';
    const app =
      getApps().find((registeredApp) => registeredApp.name === appName) ??
      initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, appName);

    try {
      return await getAuth(app).verifyIdToken(idToken, true);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code.startsWith('auth/')) {
        throw new UnauthorizedException('Le jeton Firebase est invalide ou a expiré.');
      }
      throw error;
    }
  }
}
