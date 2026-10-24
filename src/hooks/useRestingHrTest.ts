import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playPattern } from '../platform/beeper';
import {
  beltState, heartRateSupported, holdBelt, latestHeartRate, savedBelt, subscribeBeltState, subscribeHeartRate, type BeltState,
} from '../platform/heartRate';
import { keepScreenOn } from '../platform/screen';
import {
  RESTING_HR_TEST, RESTING_SIGNAL_TONES, advanceRestingTest, exampleRestingHr, startRestingTest, type RestingHrProtocol, type RestingHrState,
  type RestingSample,
} from '../recording/restingHrTest';
import { restingHrResult, type RestingHrResult } from '../running/restingHrResults';

/**
 * Déroulé du test de FC repos (`recording/restingHrTest.ts`), tenu par la page
 * du test et rien d'autre : pas d'enregistreur, pas de GPS. La ceinture est
 * prise dès l'ouverture de la page (on voit sa FC avant de démarrer) et rendue
 * à la fermeture, qui annule un test en cours. Le téléphone reste allumé
 * pendant le test.
 *
 * Dans le navigateur, sans ceinture, « l'exemple » joue une FC d'exemple à la
 * vitesse `speed` : l'horloge du test est alors virtuelle, comme au rejeu
 * d'une trace.
 */

const HOLDER = 'test-fc-repos';
/** Pas de la minuterie : l'affichage et les instants de signal. */
const TICK_MS = 250;

export interface RestingRun {
  state: RestingHrState;
  /** Horloge du test à la dernière mise à jour (virtuelle pour l'exemple). */
  nowMs: number;
  /** Dernière FC lue depuis le départ, `null` sans contact. */
  bpm: number | null;
  /** Résultat, une fois le test fini. */
  result: RestingHrResult | null;
  simulated: boolean;
}

export interface RestingBelt {
  state: BeltState;
  bpm: number | null;
}

const errorMessage = (err: unknown, fallback: string): string => (err instanceof Error && err.message !== '' ? err.message : fallback);

const bpmOf = (sample: { bpm: number; contact: boolean | null }): number | null =>
  sample.contact === false || !(sample.bpm > 0) ? null : Math.round(sample.bpm);

export const useRestingHrTest = (
  onFinished: (result: RestingHrResult, startedAtMs: number) => void,
  options: { speed?: number; protocol?: RestingHrProtocol } = {}
) => {
  const protocol = options.protocol ?? RESTING_HR_TEST;
  const speed = options.speed ?? 1;
  const belt = useMemo(() => savedBelt(), []);
  const native = heartRateSupported();
  const [beltInfo, setBeltInfo] = useState<RestingBelt>(() => ({ state: beltState(), bpm: latestHeartRate() ? bpmOf(latestHeartRate()!) : null }));
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RestingRun | null>(null);

  const stateRef = useRef<RestingHrState | null>(null);
  const bpmRef = useRef<number | null>(null);
  /** Horloge virtuelle de l'exemple : départ à l'horloge réelle, et celle du premier instant virtuel. */
  const simRef = useRef<{ realStartMs: number; virtualStartMs: number; lastSecond: number } | null>(null);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    finishedRef.current = onFinished;
  });

  const publish = useCallback((state: RestingHrState, nowMs: number, simulated: boolean) => {
    const done = state.phase === 'fini';
    const result = done ? restingHrResult(state.samples, state.startMs, protocol) : null;
    setRun({ state, nowMs, bpm: bpmRef.current, result, simulated });
    return result;
  }, [protocol]);

  /** Un pas du test : l'horloge, une mesure peut-être ; joue les signaux, et finit s'il y a lieu. */
  const apply = useCallback((nowMs: number, sample?: RestingSample) => {
    const current = stateRef.current;
    if (!current || current.phase === 'fini') return;
    const step = advanceRestingTest(current, nowMs, sample);
    stateRef.current = step.state;
    for (const signal of step.signals) void playPattern(RESTING_SIGNAL_TONES[signal], true).catch(() => undefined);
    const result = publish(step.state, nowMs, simRef.current !== null);
    if (step.state.phase === 'fini') {
      keepScreenOn(false);
      simRef.current = null;
      if (result) finishedRef.current(result, step.state.startMs);
    }
  }, [publish]);

  // Ceinture : prise à l'ouverture, ses mesures suivies, rendue à la fermeture.
  useEffect(() => {
    if (!native || !belt) return;
    let alive = true;
    let release: (() => void) | null = null;
    const offSample = subscribeHeartRate((sample) => {
      const bpm = bpmOf(sample);
      bpmRef.current = bpm;
      setBeltInfo((b) => (b.bpm === bpm && b.state === beltState() ? b : { state: beltState(), bpm }));
      if (stateRef.current && simRef.current === null) apply(Date.now(), { timeMs: sample.timeMs, bpm });
    });
    const offState = subscribeBeltState((state) => setBeltInfo((b) => ({ state, bpm: state === 'connected' ? b.bpm : null })));
    holdBelt(HOLDER, belt).then(
      (rel) => (alive ? (release = rel) : rel()),
      (err) => alive && setError(`Ceinture cardio injoignable : ${errorMessage(err, 'erreur inconnue')}.`)
    );
    return () => {
      alive = false;
      offSample();
      offState();
      release?.();
    };
  }, [native, belt, apply]);

  // Minuterie : l'horloge du test (virtuelle pour l'exemple, qui produit alors ses mesures).
  const running = run !== null && run.state.phase !== 'fini';
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const sim = simRef.current;
      if (!sim) {
        apply(Date.now());
        return;
      }
      const nowMs = sim.virtualStartMs + (Date.now() - sim.realStartMs) * speed;
      const state = stateRef.current;
      // Une mesure par seconde virtuelle, la FC d'exemple selon le temps depuis le départ.
      while (state && sim.lastSecond * 1000 + sim.virtualStartMs <= nowMs) {
        const timeMs = sim.virtualStartMs + sim.lastSecond * 1000;
        const bpm = exampleRestingHr(Math.max(0, (timeMs - state.startMs) / 1000));
        bpmRef.current = bpm;
        apply(timeMs, { timeMs, bpm });
        sim.lastSecond++;
      }
      apply(nowMs);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, apply, speed]);

  // Fermer la page annule un test en cours.
  useEffect(() => () => {
    stateRef.current = null;
    simRef.current = null;
    keepScreenOn(false);
  }, []);

  /** « Démarrer » avec la ceinture ; `exemple` : avec la FC d'exemple, dans le navigateur. */
  const start = useCallback((exemple = false) => {
    setError(null);
    const nowMs = Date.now();
    if (exemple) simRef.current = { realStartMs: nowMs, virtualStartMs: nowMs, lastSecond: 0 };
    else simRef.current = null;
    const state = startRestingTest(nowMs, protocol);
    stateRef.current = state;
    keepScreenOn(true);
    if (!exemple && bpmRef.current !== null) {
      // La FC lue avant « Démarrer » tient jusqu'à la première mesure reçue.
      state.samples.push({ timeMs: nowMs, bpm: bpmRef.current });
    }
    publish(state, nowMs, exemple);
  }, [protocol, publish]);

  /** Arrête sans garder : la ceinture reste prise, la page prête à recommencer. */
  const cancel = useCallback(() => {
    stateRef.current = null;
    simRef.current = null;
    keepScreenOn(false);
    setRun(null);
  }, []);

  return { run, belt: beltInfo, beltChosen: belt, native, error, start, cancel };
};
