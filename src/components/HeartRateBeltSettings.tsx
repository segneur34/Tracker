import { useEffect, useRef, useState } from 'react';
import {
  BELT_STATE_LABEL, beltState, heartRateSupported, holdBelt, releaseBelt, saveBelt, savedBelt, scanBelts, subscribeBeltState, subscribeHeartRate,
  type BeltState, type FoundBelt, type HeartRateBelt,
} from '../platform/heartRate';

/** Nom de la connexion prise par l'essai, rendue en quittant la page. */
const HOLDER = 'reglages';

const errorText = (err: unknown): string => (err instanceof Error && err.message ? err.message : 'erreur inconnue');

/**
 * Bloc « Capteurs » de Réglages : la ceinture cardio de ce téléphone, cherchée,
 * choisie, essayée (fréquence en direct) ou oubliée. Retenue sur l'appareil
 * (`platform/heartRate.ts`) ; chaque activité de course, de vélo ou de
 * fractionné la propose ensuite à l'enregistrement, si sa case est cochée.
 */
function HeartRateBeltSettings() {
  const [belt, setBelt] = useState<HeartRateBelt | null>(savedBelt);
  const [found, setFound] = useState<FoundBelt[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [state, setState] = useState<BeltState>(beltState);
  const [bpm, setBpm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const offState = subscribeBeltState((next) => {
      setState(next);
      if (next !== 'connected') setBpm(null);
    });
    const offSample = subscribeHeartRate((sample) => setBpm(sample.contact === false || !(sample.bpm > 0) ? null : sample.bpm));
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
      if (alive.current) setFound(list);
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

  return (
    <>
      <p className="settings-block__intro">
        Ceinture cardio Bluetooth (« Bluetooth Smart ») : inutile de l'appairer dans Android ou d'installer l'application de
        sa marque. Portez-la, électrodes humidifiées, car elle n'émet qu'au contact de la peau, puis cherchez-la. Elle est
        ensuite proposée à l'enregistrement par les activités de course, de vélo et de fractionné dont la case « Ceinture
        cardio » est cochée (partie Enregistrement de leur carte) : la fréquence est écrite à chaque point de la trace.
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
      {testing && (
        <div className="settings-row settings-row--sub">
          <span className="settings-row__label">Essai</span>
          <span>
            {state === 'connected' && bpm !== null
              ? <strong className="num">{Math.round(bpm)} bpm</strong>
              : state === 'connected' ? "connectée, en attente d'une mesure (contact avec la peau ?)" : BELT_STATE_LABEL[state]}
          </span>
        </div>
      )}
      {found && (
        <div className="settings-row settings-row--sub">
          <span className="settings-row__label">Trouvées</span>
          <div className="settings-sports__pair">
            {found.length === 0
              ? <span className="settings-sports__mark">aucune : la ceinture est-elle portée, et le Bluetooth allumé ?</span>
              : found.map((f) => (
                <button key={f.address} type="button" className="ui-btn ui-btn--secondary ui-btn--s" onClick={() => choose(f)}>
                  {f.name}
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
