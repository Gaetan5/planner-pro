import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
// Police auto-hébergée (S22) : aucune requête vers Google Fonts, `font-src 'self'`
import '@fontsource-variable/outfit/wght.css';
import './index.css';
import { installSessionFetch } from './api-session';

// Cookies de session httpOnly et rotation automatique (S7)
installSessionFetch();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
