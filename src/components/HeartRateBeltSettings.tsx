import { useEffect, useRef, useState } from 'react';
import { useBeltLive } from '../hooks/useBeltLive';
import {
  RECORDING_BELT_HOLDER, beltHeldBy, bluetoothReady, heartRateSupported, holdBelt, releaseBelt, saveBelt, savedBelt, scanBelts,
  type FoundBelt, type HeartRateBelt,
} from '../platform/heartRate';
import BeltStatus from './BeltStatus';
import { SettingRow } from './Help';

/** Nom de la connexion prise par l'essai, rendue en quittant la page. */
const HOLDER = 'reglages';

/** Force du signal, en dBm, au-dessus de laquelle un appareil est dit « proche », puis « à portée » ; en dessous, « loin ». */
const SIGNAL_NEAR_DBM = -60;
const SIGNAL_IN_RANGE_DBM = -80;
const signalLabel = (rssi: number): string => (rssi >= SIGNAL_NEAR_DBM ? 'proche' : rssi >= SIGNAL_IN_RANGE_DBM ? 'à portée' : 'loin');

const errorText = (err: unknown): string => (err instanceof Error && err.message ? err.message : 'erreur inconnue');

/**
 * Bloc « Capteurs » de Réglages : la ceinture cardio de ce téléphone, cherchée,
 * choisie, essayée (fréquence en direct) ou oubliée. Retenue sur l'appareil
 * (`platform/heartRate.ts`) ; chaque activité de course, de vélo ou de
 * fractionné la propose ensuite à l'enregistrement, si sa case est cochée.
 * L'état de la connexion se lit toujours, essai ou enregistrement en cours ;
 * une recherche montre la ceinture retenue à part des autres appareils à portée.
 */
function HeartRateBeltSettings() {
  const [belt, setBelt] = useState<HeartRateBelt | null>(savedBelt);
  const [found, setFound] = useState<FoundBelt[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const live = useBeltLive();
  const { state } = live;
  const [bluetoothOff, setBluetoothOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (heartRateSupported()) {
      bluetoothReady().then((ready) => { if (alive.current) setBluetoothOff(!ready); }).catch(() => undefined);
    }
    return () => {
      alive.current = false;
      releaseBelt(HOLDER);
    };
  }, []);

  if (!heartRateSupported()) {
    return <p className="settings-block__intro">Sur l'application Android seulement.</p>;
  }

  const search = async () => {
    setScanning(true);
    setError(null);
    setFound(null);
    try {
      const list = await scanBelts();
      if (alive.current) {
        setFound(list);
        setBluetoothOff(false);
      }
    } catch (err) {
      if (alive.current) setError(`Recherche impossible : ${errorText(err)}.`);
    } finally {
      if (alive.current) setScanning(false);
    }
  };

  const choose = (next: FoundBelt) => {
    const chosen: HeartRateBelt = { address: next.address, name: next.name, ...(next.random !== undefined && { random: next.random }) };
    stopTest();
    saveBelt(chosen);
    setBelt(chosen);
    setFound(null);
  };

  const startTest = async () => {
    if (!belt) return;
    setError(null);
    try {
      const release = await holdBelt(HOLDER, belt);
      // Page quittée pendant la connexion : son nettoyage est déjà passé, la ceinture est rendue tout de suite.
      if (!alive.current) {
        release();
        return;
      }
      setTesting(true);
      setBluetoothOff(false);
    } catch (err) {
      if (alive.current) setError(`Connexion impossible : ${errorText(err)}.`);
    }
  };

  const stopTest = () => {
    releaseBelt(HOLDER);
    setTesting(false);
  };

  const forget = () => {
    stopTest();
    saveBelt(null);
    setBelt(null);
  };

  const recording = beltHeldBy(RECORDING_BELT_HOLDER);
  const mine = belt && found ? found.find((f) => f.address === belt.address) ?? null : null;
  const others = found ? found.filter((f) => f.address !== belt?.address) : [];

  return (
    <>
      <SettingRow label="Ceinture" helpKey="capteurs:ceinture"
        help="Ceinture Bluetooth Smart, sans appairage ni application de sa marque : portez-la, électrodes humidifiées, puis cherchez-la. Elle est proposée à l'enregistrement des activités où « Ceinture cardio » est cochée.">
        <div className="settings-sports__pair">
          <span>{belt ? belt.name : 'aucune'}</span>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--s" disabled={scanning} onClick={() => void search()}>
            {scanning ? 'Recherche…' : belt ? 'En chercher une autre' : 'Chercher'}
          </button>
          {belt && (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--s" onClick={() => (testing ? stopTest() : void startTest())}>
              {testing ? "Arrêter l'essai" : 'Essayer'}
            </button>
          )}
          {belt && <button type="button" className="ui-btn ui-btn--secondary ui-btn--s" onClick={forget}>Oublier</button>}
        </div>
      </SettingRow>
      {belt && (
        <SettingRow sub label="État" helpKey="capteurs:etat"
          help="Connectée par l'essai ou par un enregistrement ; une recherche montre aussi les autres ceintures à portée.">
          <BeltStatus state={state} bpm={live.bpm} offText={bluetoothOff ? 'Bluetooth éteint' : null}>
            {recording && <span className="settings-sports__mark">utilisée par l'enregistrement</span>}
          </BeltStatus>
        </SettingRow>
      )}
      {found && belt && (
        <div className="settings-row settings-row--sub">
          <span className="settings-row__label">La vôtre</span>
          <span className="settings-sports__mark" title={mine ? `${mine.rssi} dBm` : undefined}>
            {mine ? `trouvée, ${signalLabel(mine.rssi)}`
              : state === 'connected' ? 'connectée, donc absente de la recherche : une ceinture connectée ne s\'annonce plus'
                : 'pas trouvée : est-elle portée ?'}
          </span>
        </div>
      )}
      {found && (
        <div className="settings-row settings-row--sub">
          <span className="settings-row__label">{belt ? 'Autres appareils à portée' : 'Trouvées'}</span>
          <div className="settings-sports__pair">
            {others.length === 0
              ? <span className="settings-sports__mark">{belt ? 'aucun' : 'aucune : la ceinture est-elle portée, et le Bluetooth allumé ?'}</span>
              : others.map((f) => (
                <button key={f.address} type="button" className="ui-btn ui-btn--secondary ui-btn--s"
                  title={`${f.rssi} dBm : la choisir`} onClick={() => choose(f)}>
                  {f.name} · {signalLabel(f.rssi)}
                </button>
              ))}
          </div>
        </div>
      )}
      {error && <div className="ui-alert ui-alert--warning">{error}</div>}
    </>
  );
}

export default HeartRateBeltSettings;
