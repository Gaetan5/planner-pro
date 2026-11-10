/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Build navigateur de @firebase/auth (voisin de `firebase` dans le store pnpm)
const firebaseAuthBrowser = join(
  dirname(createRequire(import.meta.url).resolve('firebase/package.json')),
  '..',
  '@firebase',
  'auth',
  'dist',
  'esm2017',
  'index.js',
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    testTimeout: 15000,
    // r42-m1 : le SDK Firebase est testé dans sa version navigateur (celle du build), pas Node
    alias: [{ find: /^firebase\/auth$/, replacement: firebaseAuthBrowser }],
  },
});
