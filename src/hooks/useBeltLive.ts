import { useEffect, useState } from 'react';
import { beltState, latestHeartRate, subscribeBeltState, subscribeHeartRate, type BeltState, type HeartRateSample } from '../platform/heartRate';

/** FC lisible d'une mesure : `null` hors contact de la peau ou sans valeur. */
const readableBpm = (sample: HeartRateSample | null): number | null =>
  sample === null || sample.contact === false || !(sample.bpm > 0) ? null : sample.bpm;

/**
 * État de la connexion à la ceinture et dernière FC, suivis en direct, quel
 * que soit celui qui tient la connexion (Réglages, page Enregistrer,
 * enregistrement).
 */
export function useBeltLive(): { state: BeltState; bpm: number | null } {
  const [state, setState] = useState<BeltState>(beltState);
  const [bpm, setBpm] = useState<number | null>(() => readableBpm(latestHeartRate()));
  useEffect(() => {
    const offState = subscribeBeltState((next) => {
      setState(next);
      if (next !== 'connected') setBpm(null);
    });
    const offSample = subscribeHeartRate((sample) => {
      setState(beltState());
      setBpm(readableBpm(sample));
    });
    return () => {
      offState();
      offSample();
    };
  }, []);
  return { state, bpm };
}
