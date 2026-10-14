import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './theme/tokens.css';
import './theme/base.css';
import './components/ui/ui.css';
import './components/AppShell.css';
import { confirmLeave, installLeaveGuard } from './hooks/leaveGuard';
import { isIntervalTimerActive, startIntervalTimer } from './hooks/useIntervalTimer';
import { startLiveRecording } from './hooks/useLiveRecording';
import { startMarkGuide } from './hooks/useMarkGuide';
import { startRecordingNotification } from './hooks/recordingNotification';
import { isStopwatchRunning, startStopwatchStore } from './hooks/useStopwatch';
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
    // Pendant un enregistrement, une séance du compteur ou un chrono en marche, la touche retour met l'application en arrière-plan.
    void installBackButton(() => isRecordingActive() || isIntervalTimerActive() || isStopwatchRunning(), confirmLeave);
    // Un enregistrement coupé par un arrêt brutal, ou arrêté sans décision, revient en attente.
    void recoverInterruptedRecording();
    // Bips d'approche des balises, pendant un enregistrement de voile qui suit un parcours.
    startMarkGuide();
    // Compteur du fractionné : séance reprise si elle court encore, et confiée à l'enregistreur.
    startIntervalTimer();
    // Chronomètre de la carte du compteur, repris s'il était lancé.
    startStopwatchStore();
    // Statistiques du direct, lues par la page Enregistrer et par la notification.
    startLiveRecording();
    // Notification de l'enregistrement, écran verrouillé : chiffres choisis dans Réglages.
    startRecordingNotification();
  });
