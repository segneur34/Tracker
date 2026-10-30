import type { ReactNode } from 'react';
import { BELT_STATE_LABEL, openBluetoothSettings, type BeltState } from '../platform/heartRate';
import './StatusLine.css';
import Button from './ui/Button';

/** Pastille de l'état : vert connectée, jaune en cours, introuvable ou perdue, gris sinon. */
const STATE_COLOR: Record<BeltState, string> = {
  off: 'var(--muted)',
  connecting: 'var(--warning-line)',
  connected: 'var(--success)',
  searching: 'var(--warning-line)',
  lost: 'var(--warning-line)',
  unsupported: 'var(--muted)',
};

/**
 * État de la ceinture cardio en une ligne : pastille, libellé, FC en direct.
 * Dans Réglages (bloc Capteurs) et sous la case « Ceinture cardio » de la page
 * Enregistrer. `offText` remplace « non connectée » (Bluetooth éteint,
 * permission refusée) ; `children` suit la ligne. Une ceinture introuvable
 * offre en secours les réglages Bluetooth d'Android.
 */
function BeltStatus({ state, bpm, offText, children }: {
  state: BeltState;
  bpm: number | null;
  offText?: string | null;
  children?: ReactNode;
}) {
  const text = state === 'off' && offText ? offText
    : state === 'connected' && bpm === null ? "connectée, en attente d'une mesure (contact avec la peau ?)"
      : BELT_STATE_LABEL[state];
  return (
    <span className="status-line">
      <span className="status-line__dot" style={{ backgroundColor: STATE_COLOR[state] }} />
      <span>{text}</span>
      {state === 'connected' && bpm !== null && <strong className="num">{Math.round(bpm)} bpm</strong>}
      {state === 'searching' && <BluetoothSettingsButton />}
      {children}
    </span>
  );
}

/** Bouton vers les réglages Bluetooth d'Android, en secours d'une ceinture introuvable. */
export function BluetoothSettingsButton() {
  return (
    <Button size="s"
      onClick={() => void openBluetoothSettings().catch(() => undefined)}>
      Réglages Bluetooth
    </Button>
  );
}

export default BeltStatus;
