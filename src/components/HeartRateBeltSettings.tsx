import { useEffect, useRef, useState } from 'react';
import {
  BELT_STATE_LABEL, RECORDING_BELT_HOLDER, beltHeldBy, beltState, bluetoothReady, heartRateSupported, holdBelt, releaseBelt, saveBelt, savedBelt,
  scanBelts, subscribeBeltState, subscribeHeartRate,
  type BeltState, type FoundBelt, type HeartRateBelt,
} from '../platform/heartRate';

/** Nom de la connexion prise par l'essai, rendue en quittant la page. */
const HOLDER = 'reglages';

/** Force du signal, en dBm, au-dessus de laquelle un appareil est dit « proche », puis « à portée » ; en dessous, « loin ». */
const SIGNAL_NEAR_DBM = -60;
const SIGNAL_IN_RANGE_DBM = -80;
const signalLabel = (rssi: number): string => (rssi >= SIGNAL_NEAR_DBM ? 'proche' : rssi >= SIGNAL_IN_RANGE_DBM ? 'à portée' : 'loin');

/** Pastille de l'état : vert connectée, jaune en cours ou perdue, gris sinon. */
const STATE_COLOR: Record<BeltState, string> = {
  off: 'var(--muted)',
  connecting: 'var(--warning-line)',
  connected: 'var(--success)',
  lost: 'var(--warning-line)',
  unsupported: 'var(--muted)',
};

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
  const [state, setState] = useState<BeltState>(beltState);
  const [bpm, setBpm] = useState<number | null>(null);
  const [bluetoothOff, setBluetoothOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const offState = subscribeBeltState((next) => {
      setState(next);
      if (next !== 'connected') setBpm(null);
    });
    const offSample = subscribeHeartRate((sample) => setBpm(sample.contact === false || !(sample.bpm > 0) ? null : sample.bpm));
    if (heartRateSupported()) {
      bluetoothReady().then((ready) => { if (alive.current) setBluetoothOff(!ready); }).catch(() => undefined);
    }
    return () => {
      alive.current = false;
      offState();
      offSample();
      releaseBelt(HOLDER);
    };
  }, []);

  if (!heartRateSupported()) {
    return <p className="settings-block__intro">Sur l'application Android seulement : le navigateur ne parle pas aux ceintures cardio.</p>;
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
    const chosen = { address: next.address, name: next.name };
    stopTest();
    saveBelt(chosen);
    setBelt(chosen);
    setFound(null);
  };

  const startTest = async () => {
    if (!belt) return;
    setError(null);
    try {
      await holdBelt(HOLDER, belt);
      setState(beltState());
      setTesting(true);
      setBluetoothOff(false);
    } catch (err) {
      setError(`Connexion impossible : ${errorText(err)}.`);
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
  const stateText = state === 'off' && bluetoothOff ? 'Bluetooth éteint'
    : state === 'connected' && bpm === null ? "connectée, en attente d'une mesure (contact avec la peau ?)"
      : BELT_STATE_LABEL[state];
  const mine = belt && found ? found.find((f) => f.address === belt.address) ?? null : null;
  const others = found ? found.filter((f) => f.address !== belt?.address) : [];

  return (
    <>
      <p className="settings-block__intro">
        Ceinture cardio Bluetooth (« Bluetooth Smart ») : inutile de l'appairer dans Android ou d'installer l'application de
        sa marque. Portez-la, électrodes humidifiées, car elle n'émet qu'au contact de la peau, puis cherchez-la. Elle est
        ensuite proposée à l'enregistrement par les activités de course, de vélo et de fractionné dont la case « Ceinture
        cardio » est cochée (partie Enregistrement de leur carte) : la fréquence est écrite à chaque point de la trace.
        La ligne « État » dit si elle est connectée, par l'essai ou par un enregistrement ; une recherche montre aussi les
        autres ceintures à portée, de la plus proche à la plus loin.
      </p>
      <div className="settings-row">
        <span className="settings-row__label">Ceinture</span>
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
      </div>
      {belt && (
        <div className="settings-row settings-row--sub">
          <span className="settings-row__label">État</span>
          <span className="settings-belt__state">
            <span className="settings-belt__dot" style={{ backgroundColor: STATE_COLOR[state] }} />
            <span>{stateText}</span>
            {state === 'connected' && bpm !== null && <strong className="num">{Math.round(bpm)} bpm</strong>}
            {recording && <span className="settings-sports__mark">utilisée par l'enregistrement</span>}
          </span>
        </div>
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
