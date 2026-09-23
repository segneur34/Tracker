import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { isRecordingActive, recoverInterruptedRecording } from './hooks/useRecorder';
import { installBackButton } from './platform/backButton';
import { initStorage } from './platform/storage';

// Le stockage natif doit être en mémoire avant le premier rendu : les hooks
// le lisent pendant le rendu (`platform/storage.ts`).
void initStorage().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  void installBackButton(isRecordingActive);
  // Un enregistrement coupé par un arrêt brutal devient une session.
  void recoverInterruptedRecording();
});
