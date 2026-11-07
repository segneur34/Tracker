import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync } from 'node:fs';

/** Version de l'application, lue de `package.json` (seule source), jamais recopiée ici. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Application Android : `dist/` emballé dans une WebView (`docs/ETAT_DU_PROJET.md` §12).
const config: CapacitorConfig = {
  // Identité de l'application sur le téléphone : la changer revient à en installer une autre.
  appId: 'io.github.segneur.tracker',
  appName: 'Tracker',
  webDir: 'dist',
  android: {
    // Exigé par `@capgo/background-geolocation` : sans lui, les positions
    // cessent d'arriver après 5 min en arrière-plan.
    useLegacyBridge: true,
    // Chromium 111 : la cible de construction de Vite (`baseline-widely-available`) ; en dessous, des écrans
    // blancs. Capacitor ne fait que journaliser le refus (pas d'écran d'erreur sans `server.errorPath`).
    minWebViewVersion: 111,
    // Ajouté à l'agent de la WebView, donc envoyé avec chaque tuile demandée : OpenStreetMap exige qu'une
    // application s'identifie, avec un contact. La page GitHub publique, jamais une adresse e-mail.
    appendUserAgent: `Tracker/${version} (+https://github.com/segneur34)`,
  },
  plugins: {
    // Icônes sombres dans les barres système au lancement ; le thème les règle
    // ensuite, claires en sombre (`platform/systemBars.ts`).
    // Les marges du bas passent par --safe-area-inset-bottom (tokens.css).
    SystemBars: {
      style: 'LIGHT',
    },
  },
};

export default config;
