import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './theme/tokens.css';
import './theme/base.css';
import './components/ui/ui.css';
import './components/AppShell.css';
import { isRecordingActive, recoverInterruptedRecording } from './hooks/useRecorder';
import { openLibrary, startLibraryUi } from './hooks/useSessionLibrary';
import { installBackButton } from './platform/backButton';
import { initStorage } from './platform/storage';

/**
 * Attente maximale de la mémoire avant le premier rendu. Au-delà, l'interface
 * s'affiche quand même et la liste des sessions arrive ensuite.
 */
const LIBRARY_OPEN_WAIT_MS = 1500;

// Le stockage natif doit être en mémoire avant le premier rendu : les hooks
// le lisent pendant le rendu (`platform/storage.ts`). La mémoire aussi, si
// possible : les réglages repris de son `reglages.json` sont alors en place.
void initStorage()
  .then(() => Promise.race([openLibrary(), new Promise((resolve) => setTimeout(resolve, LIBRARY_OPEN_WAIT_MS))]))
  .then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    startLibraryUi(isRecordingActive);
    void installBackButton(isRecordingActive);
    // Un enregistrement coupé par un arrêt brutal devient une session.
    void recoverInterruptedRecording();
  });
