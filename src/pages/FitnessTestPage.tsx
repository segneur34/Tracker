import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import FitnessTestPlanChart from '../components/FitnessTestPlanChart';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { IconPlay } from '../components/icons';
import { FAMILY_ACCENT, activitiesOfFamily } from '../core/activities';
import { isTestSport } from '../core/sportProfiles';
import { kmhToMs } from '../core/units';
import { fitnessTestRunner } from '../hooks/useFitnessTest';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import { lastRecordActivity, saveFitnessTestSettings, useFitnessTestSettings, useVisibility } from '../hooks/useSportSettings';
import { FITNESS_TESTS, FITNESS_TEST_LIMITS, resolveFitnessTestParams, type FitnessTestParams } from '../recording/fitnessTest';
import './TrainingPages.css';

const PROTOCOL = FITNESS_TESTS['fc-max'];
/** Rampe d'exemple du graphique, dite telle dans sa légende. */
const EXAMPLE_V0_MS = kmhToMs(8);
const EXAMPLE_STEPS = 10;

const range = (min: number, max: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};
const WARMUP_CHOICES_S = range(FITNESS_TEST_LIMITS.warmupS.min, FITNESS_TEST_LIMITS.warmupS.max, FITNESS_TEST_LIMITS.warmupS.step);

/** D'où viennent les zones de l'échauffement, en clair. */
function ZonesSource({ params }: { params: FitnessTestParams }) {
  const { zones, age, ageSource } = params;
  const hrMax = zones.estimated
    ? <>{zones.hrMax} bpm, estimée par l'âge ({age} ans{ageSource === 'defaut' ? " par défaut, faute d'année de naissance" : ''})</>
    : <>{zones.hrMax} bpm</>;
  const pratiquant = <>Pratiquant, dans <Link to="/parametres">Réglages</Link></>;
  if (zones.method === 'perso') return <>Zones saisies dans {pratiquant}.</>;
  if (zones.method === 'reserve') return <>Zones de la réserve cardiaque, de la FC de repos à la FC max ({hrMax}) : {pratiquant}.</>;
  return <>Zones en part de la FC max ({hrMax}) ; avec la FC de repos, elles suivraient la réserve cardiaque : {pratiquant}.</>;
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
  const params = useMemo(() => resolveFitnessTestParams(PROTOCOL, settings, fitnessTestRunner(profile)), [settings, profile]);
  const { activities, isShown } = useVisibility();
  const activity = useMemo(() => {
    const tests = activitiesOfFamily(activities.filter(isShown), 'fractionne').filter((a) => isTestSport(a.base));
    const last = lastRecordActivity();
    return tests.find((a) => a.id === last?.id) ?? tests[0] ?? null;
  }, [activities, isShown]);
  const launch = () => {
    if (activity) navigate(`/enregistrer?activite=${encodeURIComponent(activity.id)}&test=fc-max`);
  };
  const warmupMin = Math.round(params.warmupS / 60);
  const { from, to } = PROTOCOL.warmupZones;

  return (
    <div className="ui-page train-page" style={{ '--help-accent': FAMILY_ACCENT.fractionne } as React.CSSProperties}>
      <PageHeader title="FC max" back={{ to: '/fractionne/tests', label: 'Tests' }}
        subtitle="Test guidé par bips : un échauffement, une rampe de vitesse jusqu'à ne plus tenir, une récupération." />

      {!activity && (
        <div className="ui-alert ui-alert--warning">
          Aucune activité de test visible : ajoutez-en une, ou ré-affichez « Tests », dans <Link to="/parametres">Réglages</Link>.
        </div>
      )}

      <div className="ui-alert ui-alert--warning">
        Ceinture cardio (ou autre capteur de FC) connectée avant de commencer : sans elle, ni guidage de l'échauffement, ni FC max.
      </div>

      <Card heading="Déroulé">
        <ol className="fit-steps">
          <li><strong>Échauffement, {warmupMin} min</strong>, la FC en zones {from} à {to} du cardio : de {params.warmupLowBpm} à
            {' '}{params.warmupHighBpm} bpm. En trottinant, ou en marchant vite.</li>
          <li><strong>Rampe</strong> : elle part à la vitesse moyenne de la dernière minute d'échauffement, arrondie au 0,5 km/h, puis
            la vitesse cible monte de 0,6 km/h chaque minute. Suivez-la le plus longtemps possible.</li>
          <li><strong>Fin de la rampe</strong> : quand la vitesse reste 0,5 km/h sous la cible pendant 20 s, ou par « Finir la rampe ».</li>
          <li><strong>Récupération, 2 min</strong>, en marchant : la baisse de la FC est mesurée.</li>
        </ol>
        <p className="train-hint">Résultats dans l'analyse de la session : FC max, vitesse du dernier palier tenu, vitesse max, récupération.</p>
      </Card>

      <Card heading="Les bips">
        <ul className="fit-beeps">
          <li><span className="fit-beeps__sound">1 court</span>bien</li>
          <li><span className="fit-beeps__sound">2 courts</span>trop vite</li>
          <li><span className="fit-beeps__sound">3 courts</span>accélère</li>
          <li><span className="fit-beeps__sound">1 long</span>début de la rampe, puis chaque palier</li>
          <li><span className="fit-beeps__sound">court, long, long double</span>fin de la rampe</li>
          <li><span className="fit-beeps__sound">1 long</span>fin du test, après la récupération</li>
        </ul>
        <p className="train-hint">Un bip court au départ. Les corrections viennent au plus toutes les 10 s, et toutes les 30 s quand la même revient trois fois de suite ; « bien » au plus toutes les 30 s ; rien dans les 10 s qui suivent un palier.
          Pendant l'échauffement, les bips suivent la FC ; pendant la rampe, la vitesse.</p>
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
            Échauffement en zones {from} à {to} : {params.warmupLowBpm} à {params.warmupHighBpm} bpm. <ZonesSource params={params} />
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
