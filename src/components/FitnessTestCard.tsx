import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Button from './ui/Button';
import Card from './ui/Card';
import { FAMILY_ACCENT, type Activity } from '../core/activities';
import { formatSpeed } from '../core/units';
import { finishFitnessRamp, fitnessTestRunner, useFitnessTest, type FitnessTestView } from '../hooks/useFitnessTest';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import { effectiveSpeedUnit, useFitnessTestSettings } from '../hooks/useSportSettings';
import { FITNESS_TESTS, TEST_SIGNAL_LABEL, resolveFitnessTestParams, type FitnessTestId, type TestPhase } from '../recording/fitnessTest';
import { formatIntervalClock } from '../recording/intervalTimer';
import './IntervalCard.css';

/**
 * Carte « Test » de la page Enregistrer, à la place du compteur pour une
 * activité de test (24/10) : au repos, le résumé du protocole et sa cible ;
 * pendant l'enregistrement, la phase et son décompte, la cible et la valeur
 * lue (FC à l'échauffement, vitesse sur la rampe), le palier, le dernier bip
 * en clair, et « Finir la rampe ». Le guidage tourne hors de la page
 * (`useFitnessTest`) : la carte ne fait que le montrer.
 */

const PHASE_LABEL: Record<TestPhase, string> = {
  attente: 'En attente du GPS',
  echauffement: 'Échauffement',
  rampe: 'Rampe',
  recuperation: 'Récupération',
  fini: 'Test fini',
};

const bpm = (value: number | null): string => (value === null ? '—' : `${Math.round(value)} bpm`);

/** Résumé du protocole avant le départ. */
function TestPreview({ testId, activity }: { testId: FitnessTestId; activity: Activity | null }) {
  const protocol = FITNESS_TESTS[testId];
  const settings = useFitnessTestSettings(testId);
  const { profile } = useRunnerProfile();
  // Avec l'activité, comme le guidage : son décalage de seuil donne la même bande d'échauffement.
  const params = useMemo(
    () => resolveFitnessTestParams(protocol, settings, fitnessTestRunner(profile, activity)), [protocol, settings, profile, activity]
  );
  const { from, to } = protocol.warmupZones;
  return (
    <>
      <div className="ivl-live">
        <span className="ivl-live__phase">Test {protocol.label}</span>
        <span className="ivl-live__left">
          Échauffement {Math.round(params.warmupS / 60)} min en zones {from} à {to} ({params.warmupLowBpm} à {params.warmupHighBpm} bpm), puis la vitesse
          cible monte de 0,6 km/h chaque minute jusqu'à ne plus tenir, puis {Math.round(protocol.recoveryS / 60)} min de récupération.
        </span>
      </div>
      <p className="ivl-note">
        « Démarrer » lance l'enregistrement et le test ; les bips guident. <Link to={`/fractionne/tests/${testId}`}>Protocole et réglages</Link>
      </p>
    </>
  );
}

/** Test en cours. */
function TestLive({ view, activity }: { view: FitnessTestView; activity: Activity }) {
  const unit = effectiveSpeedUnit(activity);
  const { phase, params } = view;
  const title = phase === 'rampe' ? `${PHASE_LABEL.rampe} · palier ${view.step}` : PHASE_LABEL[phase];
  const reading = phase === 'echauffement'
    ? `Cible ${params ? `${params.warmupLowBpm} à ${params.warmupHighBpm}` : '—'} bpm · lue ${bpm(view.hrBpm)}`
    : phase === 'rampe'
      ? `Cible ${formatSpeed(view.targetMs, unit)} · lue ${formatSpeed(view.speedMs, unit)} · FC ${bpm(view.hrBpm)}`
      : phase === 'recuperation' || phase === 'fini' ? `FC ${bpm(view.hrBpm)}` : null;
  const askFinish = () => {
    if (window.confirm('Finir la rampe maintenant ? La récupération commence, et le dernier palier commencé ne compte pas.')) finishFitnessRamp();
  };
  return (
    <>
      <div className="ivl-live" aria-live="polite">
        <span className="ivl-live__phase">{title}</span>
        {view.remainingS !== null && <span className="ivl-live__clock num">{formatIntervalClock(view.remainingS)}</span>}
        {reading && <span className="ivl-live__left num">{reading}</span>}
        {view.lastSignal && <span className="ivl-live__left">Dernier bip : {TEST_SIGNAL_LABEL[view.lastSignal.signal].toLowerCase()}</span>}
      </div>
      {phase === 'rampe' && (
        <div className="ivl-actions">
          <Button variant="secondary" size="l" className="ivl-launch" onClick={askFinish}>Finir la rampe</Button>
        </div>
      )}
      {phase === 'fini' && <p className="ivl-note">Test fini : arrêtez l'enregistrement, puis « Analyser » pour les résultats.</p>}
    </>
  );
}

function FitnessTestCard({ testId, activity }: { testId: FitnessTestId; activity: Activity | null }) {
  const view = useFitnessTest();
  return (
    <Card>
      <div style={{ '--ivl-color': FAMILY_ACCENT.fractionne } as React.CSSProperties}>
        {view.active && activity ? <TestLive view={view} activity={activity} /> : <TestPreview testId={testId} activity={activity} />}
      </div>
    </Card>
  );
}

export default FitnessTestCard;
