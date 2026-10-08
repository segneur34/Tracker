import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './theme/tokens.css';
import './theme/base.css';
import './components/ui/ui.css';
import './components/AppShell.css';
import { confirmLeave, installLeaveGuard } from './hooks/leaveGuard';
import { isIntervalTimerActive, startIntervalTimer } from './hooks/useIntervalTimer';
import { startMarkGuide } from './hooks/useMarkGuide';
import { isRecordingActive, recoverInterruptedRecording } from './hooks/useRecorder';
import { openLibrary, settingsUpgraded, startLibraryUi } from './hooks/useSessionLibrary';
import { upgradeStoredActivities } from './hooks/useSportSettings';
import { installBackButton } from './platform/backButton';
import { initStorage } from './platform/storage';

/**
 * Attente maximale de la mémoire avant le premier rendu. Au-delà, l'interface
 * s'affiche quand même et la liste des sessions arrive ensuite.
 */
const LIBRARY_OPEN_WAIT_MS = 1500;

// Le stockage natif doit être en mémoire avant le premier rendu : les hooks
// le lisent pendant le rendu (`platform/storage.ts`). La mémoire aussi, si
// possible : les réglages repris de son dossier `reglages/` sont alors en place.
void initStorage()
  .then(() => Promise.race([openLibrary(), new Promise((resolve) => setTimeout(resolve, LIBRARY_OPEN_WAIT_MS))]))
  .then(() => {
    // Liste d'activités d'une version d'avant mise à jour, une fois les réglages du dossier repris ; le fichier de l'appareil suit.
    if (upgradeStoredActivities()) void settingsUpgraded();
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    startLibraryUi(isRecordingActive);
    installLeaveGuard();
    // Pendant un enregistrement ou une séance du compteur, la touche retour met l'application en arrière-plan.
    void installBackButton(() => isRecordingActive() || isIntervalTimerActive(), confirmLeave);
    // Un enregistrement coupé par un arrêt brutal, ou arrêté sans décision, revient en attente.
    void recoverInterruptedRecording();
    // Bips d'approche des balises, pendant un enregistrement de voile qui suit un parcours.
    startMarkGuide();
    // Compteur du fractionné : séance reprise si elle court encore, et confiée à l'enregistreur.
    startIntervalTimer();
  });
