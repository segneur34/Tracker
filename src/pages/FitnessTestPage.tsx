import { roundTo } from '../core/basics';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import FitnessTestPlanChart from '../components/FitnessTestPlanChart';
import { HelpText, HelpToggle } from '../components/Help';
import { zonesOriginText } from '../components/heartRateOrigin';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { IconPlay } from '../components/icons';
import { FAMILY_ACCENT, activitiesOfFamily } from '../core/activities';
import { isTestSport } from '../core/sportProfiles';
import { kmhToMs } from '../core/units';
import { fitnessTestRunner } from '../hooks/useFitnessTest';
import { useRunnerProfile, type RunnerProfile } from '../hooks/useRunnerProfile';
import { lastRecordedOrFirst, saveFitnessTestSettings, useFitnessTestSettings, useVisibility } from '../hooks/useSportSettings';
import { FITNESS_TESTS, FITNESS_TEST_LIMITS, resolveFitnessTestParams, type FitnessTestParams } from '../recording/fitnessTest';
import { WORKOUT_LISTS, recordPath } from './workoutLists';
import './TrainingPages.css';

const PROTOCOL = FITNESS_TESTS['fc-max'];
/** Rampe d'exemple du graphique, dite telle dans sa légende. */
const EXAMPLE_V0_MS = kmhToMs(8);
const EXAMPLE_STEPS = 10;

const range = (min: number, max: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(roundTo(v, 2));
  return out;
};
const WARMUP_CHOICES_S = range(FITNESS_TEST_LIMITS.warmupS.min, FITNESS_TEST_LIMITS.warmupS.max, FITNESS_TEST_LIMITS.warmupS.step);

/** D'où viennent les zones de l'échauffement, en clair. */
function ZonesSource({ params, runner }: { params: FitnessTestParams; runner: RunnerProfile }) {
  const { zones, age, ageSource } = params;
  return (
    <>
      Zones calées sur {zonesOriginText(zones, runner)}
      {zones.estimated && <> Âge : {age} ans{ageSource === 'defaut' ? " par défaut, faute d'année de naissance" : ''}.</>}
      {' '}À régler dans Pratiquant, dans <Link to="/parametres">Réglages</Link>.
    </>
  );
}

/**
 * Test de FC max (24/10), depuis Tests : le protocole (déroulé, bips,
 * ceinture, santé), son graphique annoté, ses réglages (durée de
 * l'échauffement ; sa bande vient des zones du cardio de Pratiquant), et « Lancer », qui ouvre Enregistrer
 * prêt (Entraînement › Tests › FC max, ceinture cochée). Le bouton rond démarre.
 */
function FitnessTestPage() {
  const navigate = useNavigate();
  const settings = useFitnessTestSettings('fc-max');
  const { profile } = useRunnerProfile();
  const { activities, isShown } = useVisibility();
  const activity = useMemo(
    () => lastRecordedOrFirst(activitiesOfFamily(activities.filter(isShown), 'fractionne').filter((a) => isTestSport(a.base))),
    [activities, isShown]
  );
  const params = useMemo(() => resolveFitnessTestParams(PROTOCOL, settings, fitnessTestRunner(profile, activity)), [settings, profile, activity]);
  const launch = () => {
    if (activity) navigate(recordPath(activity.id, 'fc-max'));
  };
  const warmupMin = Math.round(params.warmupS / 60);
  const { from, to } = PROTOCOL.warmupZones;

  return (
    <div className="ui-page train-page" style={{ '--help-accent': FAMILY_ACCENT.fractionne } as React.CSSProperties}>
      <PageHeader title="FC max" back={{ to: WORKOUT_LISTS.fractionne.listPath, label: WORKOUT_LISTS.fractionne.title }}
        subtitle="Test guidé par bips : un échauffement, une rampe de vitesse jusqu'à ne plus tenir, une récupération." />

      {!activity && (
        <div className="ui-alert ui-alert--warning">
          Aucune activité de test visible : ajoutez-en une, ou ré-affichez « Tests », dans <Link to="/parametres">Réglages</Link>.
        </div>
      )}

      <div className="ui-alert ui-alert--warning">
        Ceinture cardio (ou autre capteur de FC) connectée avant de commencer : sans elle, ni guidage de l'échauffement, ni FC max.
      </div>

      <Card heading={<>Déroulé<HelpToggle helpKey="test:deroule" label="Déroulé" size="s" /></>}>
        <HelpText helpKey="test:deroule" note>Résultats dans l'analyse de la session : FC max, vitesse du dernier palier tenu, vitesse max, récupération.</HelpText>
        <ol className="fit-steps">
          <li><strong>Échauffement, {warmupMin} min</strong>, la FC en zones {from} à {to} du cardio : de {params.warmupLowBpm} à
            {' '}{params.warmupHighBpm} bpm. En trottinant, ou en marchant vite.</li>
          <li><strong>Rampe</strong> : elle part à la vitesse moyenne de la dernière minute d'échauffement, arrondie au 0,5 km/h, puis
            la vitesse cible monte de 0,6 km/h chaque minute. Suivez-la le plus longtemps possible.</li>
          <li><strong>Fin de la rampe</strong> : quand la vitesse reste 0,5 km/h sous la cible pendant 20 s, ou par « Finir la rampe ».</li>
          <li><strong>Récupération, 2 min</strong>, en marchant : la baisse de la FC est mesurée.</li>
        </ol>
      </Card>

      <Card heading={<>Les bips<HelpToggle helpKey="test:bips" label="Les bips" size="s" /></>}>
        <HelpText helpKey="test:bips" note>
          Un bip court au départ. Les corrections viennent au plus toutes les 10 s, et toutes les 30 s quand la même revient trois fois de suite ; « bien » au plus toutes les 30 s ; rien dans les 10 s qui suivent un palier.
          Pendant l'échauffement, les bips suivent la FC ; pendant la rampe, la vitesse.
        </HelpText>
        <ul className="fit-beeps">
          <li><span className="fit-beeps__sound">1 court</span>bien</li>
          <li><span className="fit-beeps__sound">2 courts</span>trop vite</li>
          <li><span className="fit-beeps__sound">3 courts</span>accélère</li>
          <li><span className="fit-beeps__sound">1 long</span>début de la rampe, puis chaque palier</li>
          <li><span className="fit-beeps__sound">court, long, long double</span>fin de la rampe</li>
          <li><span className="fit-beeps__sound">1 long</span>fin du test, après la récupération</li>
        </ul>
      </Card>

      <Card heading="En image">
        <FitnessTestPlanChart params={params} v0Ms={EXAMPLE_V0_MS} steps={EXAMPLE_STEPS} />
      </Card>

      <Card heading="Réglages">
        <div className="fit-settings">
          <label className="fit-settings__row">
            <span>Échauffement</span>
            <select className="ui-field ui-field--s" value={params.warmupS}
              onChange={(e) => saveFitnessTestSettings('fc-max', { warmupS: Number(e.target.value) })}>
              {WARMUP_CHOICES_S.map((s) => <option key={s} value={s}>{s / 60} min</option>)}
            </select>
          </label>
          <p className="train-hint">
            Échauffement en zones {from} à {to} : {params.warmupLowBpm} à {params.warmupHighBpm} bpm. <ZonesSource params={params} runner={profile} />
          </p>
        </div>
      </Card>

      <div className="ui-alert ui-alert--danger">
        Effort maximal : à ne faire qu'en bonne santé, reposé, sans contre-indication médicale. Arrêtez-vous au moindre malaise :
        douleur dans la poitrine, vertige, essoufflement anormal.
      </div>

      <div className="train-actions">
        <Button variant="primary" disabled={!activity} onClick={launch}>
          <IconPlay size={18} />
          Lancer
        </Button>
        <span className="train-hint">Ouvre Enregistrer, prêt ; le bouton rond démarre.</span>
      </div>
    </div>
  );
}

export default FitnessTestPage;
