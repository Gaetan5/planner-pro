import { ServiceUnavailableException } from '@nestjs/common';
import { FirebaseIdentityService } from './firebase-identity.service';

describe('FirebaseIdentityService', () => {
  const originalConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  };
  let service: FirebaseIdentityService;

  beforeEach(() => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    service = new FirebaseIdentityService();
  });

  afterAll(() => {
    if (originalConfig.projectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = originalConfig.projectId;
    if (originalConfig.clientEmail === undefined) delete process.env.FIREBASE_CLIENT_EMAIL;
    else process.env.FIREBASE_CLIENT_EMAIL = originalConfig.clientEmail;
    if (originalConfig.privateKey === undefined) delete process.env.FIREBASE_PRIVATE_KEY;
    else process.env.FIREBASE_PRIVATE_KEY = originalConfig.privateKey;
  });

  it('reports missing Firebase Admin credentials instead of silently disabling verification', async () => {
    await expect(service.verifyIdToken('token')).rejects.toThrow(ServiceUnavailableException);
  });
});
