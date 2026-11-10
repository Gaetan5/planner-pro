# En-têtes de sécurité du frontend (S22) et mise en cache des réponses sensibles (O16)

## Où sont servis les en-têtes

Le frontend de production est servi par le conteneur nginx (`frontend/Dockerfile.prod`,
`frontend/nginx.prod.conf`). Au démarrage, `frontend/docker-entrypoint.d/40-security-headers.sh`
génère `/etc/nginx/snippets/security-headers.conf` à partir de l'environnement du conteneur, et
`nginx.prod.conf` l'inclut dans la page d'entrée et dans le bloc des assets (nginx n'hérite pas
des `add_header` d'un bloc parent). Aucun domaine n'est codé en dur.

Un reverse proxy TLS devant le conteneur (hôte, `127.0.0.1:8080`) doit laisser passer ces
en-têtes sans les remplacer ni les dupliquer.

| Variable (conteneur `frontend`) | Rôle                                                                                                               | Défaut                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `VITE_API_URL`                  | obligatoire ; origine de l'API, source de `connect-src` (HTTP et `wss://` ou `ws://` du même hôte, pour socket.io) | aucun (le conteneur refuse de démarrer) |
| `CSP_MODE`                      | `report-only` (signale sans bloquer) ou `enforce` (bloque)                                                         | `report-only`                           |
| `CSP_REPORT_URI`                | facultatif ; URL qui reçoit les rapports de violation                                                              | vide                                    |

`VITE_API_URL` et `CSP_REPORT_URI` sont validés au démarrage : tout saut de ligne ou caractère de
contrôle est refusé, et le port de `VITE_API_URL` doit être compris entre 1 et 65535.

Exemples à vérifier par l'exploitation (non codés en dur) : frontend
`https://planner-pro.boukarou-os.com`, API `https://api.planner-pro.boukarou-os.com`.

## Politique

`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;
font-src 'self'; media-src 'self' https://assets.mixkit.co; connect-src 'self' <API> <WS de l'API>
https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src 'none';
object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`

| Source                                                                                   | Raison                                                                                                      |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `script-src 'self'`                                                                      | aucun script inline ni `eval` ; le build Vite ne produit que des fichiers `/assets/*.js`                    |
| `style-src 'unsafe-inline'`                                                              | les composants React posent des attributs `style="..."` (environ 150) ; limité aux styles                   |
| `img-src data: https:`                                                                   | icône de l'onglet et QR code MFA en `data:` URI ; avatars distants                                          |
| `font-src 'self'`                                                                        | police Outfit auto-hébergée (`@fontsource-variable/outfit` 5.3.0, licence OFL) ; aucune source Google Fonts |
| `media-src https://assets.mixkit.co`                                                     | son de notification de mention (`AppContext.tsx`) ; à supprimer si le son est hébergé localement            |
| `connect-src <API>` et WebSocket                                                         | `fetch` de l'API et socket.io (`io(BACKEND_URL)`)                                                           |
| `identitytoolkit.googleapis.com`                                                         | Firebase Auth, `signInWithEmailAndPassword`                                                                 |
| `securetoken.googleapis.com`                                                             | Firebase Auth, rafraîchissement du jeton Firebase                                                           |
| `frame-src 'none'`, pas de `apis.google.com`, `accounts.google.com`, `*.firebaseapp.com` | le code n'appelle ni `signInWithPopup` ni `signInWithRedirect` (voir ci-dessous)                            |

Autres en-têtes (tous avec `always`) : `Strict-Transport-Security: max-age=31536000;
includeSubDomains` (sans `preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
(enforcé même quand la CSP est en Report-Only, où `frame-ancestors` n'est pas appliqué),
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(),
geolocation=(), microphone=(self)`.

### Connexion Google et initialisation de Firebase Auth

Décision de l'utilisateur (2026-11-10) : pas de connexion Google par popup via Firebase ; le SSO
Google Workspace existant (redirection pleine page côté backend) suffit. Le frontend n'utilise que
`signInWithEmailAndPassword`.

`frontend/src/firebase-auth.ts` initialise donc Firebase Auth avec `initializeAuth(app, { persistence })`
et **sans résolveur popup/redirection** (r42-m1). `getAuth()` branchait `browserPopupRedirectResolver`,
qui sur mobile, Safari et iOS charge de lui-même `https://apis.google.com/js/api.js` et l'iframe
`https://<authDomain>/__/auth/iframe` (`_shouldInitProactively`, `@firebase/auth` 1.10.8). La
persistance est identique à celle de `getAuth()` (IndexedDB, puis localStorage, puis sessionStorage) :
les sessions existantes sont conservées. La chaîne `apis.google.com` reste présente dans le bundle
(enregistrement du chargeur du SDK) mais n'est jamais appelée ; un test le vérifie.

La CSP ci-dessus reste valable, sans `frame-src` ni `script-src` supplémentaires. Si une connexion
par popup est un jour ajoutée, elle devra réintroduire le résolveur et compléter la CSP, d'abord en
Report-Only : `frame-src https://<VITE_FIREBASE_AUTH_DOMAIN>`, `script-src https://apis.google.com`,
et `https://accounts.google.com` si Google le demande.

## Déploiement et bascule en blocage

1. Déployer avec `CSP_MODE=report-only` (valeur par défaut). `docker compose ... up -d --build frontend`.
2. Vérifier : `scripts/check-headers.sh https://<frontend>` (page d'entrée et un asset `.js`).
3. Parcourir l'application avec la console du navigateur ouverte (filtre « Content Security Policy ») :
   connexion e-mail/mot de passe Firebase, connexion locale, MFA (QR code), temps réel (socket.io),
   notification de mention, pages d'administration. À faire sur desktop **et** sur mobile/Safari
   (iOS), console ouverte : aucune violation attendue liée à `apis.google.com` ou à l'iframe d'authentification. Chaque violation signalée est soit une
   source légitime à ajouter, soit un défaut à corriger. Si `CSP_REPORT_URI` est renseigné, les
   rapports y sont aussi envoyés.
4. Après une période sans violation légitime (au moins la connexion réelle de chaque mode utilisé
   en production), passer `CSP_MODE=enforce` dans `.env.production`, redéployer le conteneur
   `frontend` et relancer `EXPECT_CSP_MODE=enforce scripts/check-headers.sh https://<frontend>`.
5. Retour arrière immédiat : `CSP_MODE=report-only` et redéploiement (sans reconstruction du code).

HSTS : `includeSubDomains` engage tous les sous-domaines à rester en HTTPS pendant un an. Ne pas
ajouter `preload` (inscription à la liste des navigateurs, quasi irréversible) sans décision explicite.

## O16 : `Cache-Control: no-store` côté API

`backend/src/common/no-store.middleware.ts`, branché dans `main.ts` : `Cache-Control: no-store`
et `Pragma: no-cache` sur `/auth/*`, `/admin/*` et `POST /projects/:projectId/webhooks/github/secret`
(y compris sur les réponses d'erreur). La réponse de `POST /auth/github/sync`, qui porte le secret de
webhook à la première liaison, est couverte par `/auth/*`.
