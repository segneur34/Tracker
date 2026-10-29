/**
 * Pièces communes aux graphes du test guidé : le déroulé prévu de la page du
 * protocole (`FitnessTestPlanChart`) et les courbes de la session
 * (`FitnessTestCurves`) portent les mêmes phases, avec les mêmes noms et le
 * même fond en bandes alternées.
 */
import { ReferenceArea } from 'recharts';
import type { ReactElement } from 'react';
import { PHASE_FILL } from './chartStyle';

/** Les trois phases d'un test, dans l'ordre. */
export type TestChartPhase = 'echauffement' | 'rampe' | 'recuperation';

const PHASE_LABEL: Record<TestChartPhase, string> = { echauffement: 'Échauffement', rampe: 'Rampe', recuperation: 'Récup.' };

/** Nom d'une phase, tel qu'il s'écrit sur les graphes. */
export const phaseLabel = (phase: TestChartPhase): string => PHASE_LABEL[phase];

/**
 * Bandes de fond des phases (`x1`, `x2` en minutes), une sur deux plus
 * claire ; le nom dans le haut du graphe quand `labelled`. Une liste
 * d'éléments, pas un composant : Recharts ne voit pas un ReferenceArea rangé
 * dans un composant à lui.
 */
export const phaseAreas = (phases: ReadonlyArray<{ phase: TestChartPhase; x1: number; x2: number }>, labelled: boolean): ReactElement[] => phases.map((p, i) => (
  <ReferenceArea key={p.phase} x1={p.x1} x2={p.x2} fill={PHASE_FILL} fillOpacity={i % 2 === 0 ? 0.12 : 0.04} ifOverflow="hidden"
    label={labelled ? { value: phaseLabel(p.phase), position: 'insideTop', fill: 'var(--chart-axis)', fontSize: 11 } : undefined} />
));
