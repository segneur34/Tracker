import { BRIEF_SPACING_MS } from '../core/beepDurations';
import type { ClockTone } from '../platform/beeper';

/**
 * Signaux sonores d'un guidage (lot 187, sortis de `recording/fitnessTest.ts`) : les sons que jouent le test guidé,
 * l'alerte de zone cardiaque et le test de FC de repos, les mêmes partout pour que l'oreille les reconnaisse.
 */

/** Un signal du guidage : départ, allure bonne, trop vite, accélérer, palier, fin de rampe, fin du test. */
export type TestSignal = 'debut' | 'bien' | 'trop' | 'accelere' | 'palier' | 'finRampe' | 'finTest';

/** Écart entre les débuts des sons de la fin de rampe, comme la fin de séance du compteur. */
export const END_SPACING_MS = 1000;

/** Un bip court seul, ou n bips brefs rapprochés (« bip-bip ») pour trop vite et trop lent. */
const briefs = (n: number): ClockTone[] => Array.from({ length: n }, (_, i) => ({ delayMs: i * BRIEF_SPACING_MS, tone: 'bref' as const }));

export const TEST_SIGNAL_TONES: Record<TestSignal, ClockTone[]> = {
  debut: [{ delayMs: 0, tone: 'court' }],
  bien: [{ delayMs: 0, tone: 'court' }],
  trop: briefs(2),
  accelere: briefs(3),
  palier: [{ delayMs: 0, tone: 'long' }],
  finRampe: [{ delayMs: 0, tone: 'court' }, { delayMs: END_SPACING_MS, tone: 'long' }, { delayMs: 2 * END_SPACING_MS, tone: 'final' }],
  finTest: [{ delayMs: 0, tone: 'long' }],
};
