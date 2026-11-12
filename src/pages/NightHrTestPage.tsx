import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HelpText, HelpToggle } from '../components/Help';
import NightHrChart, { type NightPoint } from '../components/NightHrChart';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { IconPlay } from '../components/icons';
import { baseActivity } from '../core/activities';
import { nightSessionName } from '../core/nightHeartRate';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { useLibraryFields } from '../hooks/useSessionLibrary';
import type { LibrarySession } from '../library/record';
import { NIGHT_HR_TEST } from '../recording/nightHrTest';
import { WORKOUT_LISTS, recordPath } from '../recording/workoutLists';
import './TrainingPages.css';

const PROTOCOL = NIGHT_HR_TEST;
/** Calcul des nuits : leur session prend son activité de base (`baseActivity`), jamais une activité de la liste. */
const NIGHT_SPORT = 'night-hr' as const;
/** Nuits montrées dans la courbe, et dans la liste sous elle. */
const CHART_NIGHTS = 30;
const LISTED_NIGHTS = 10;

/** Une nuit gardée dans la mémoire, lue dans sa fiche (`summary.night`). */
interface StoredNight extends NightPoint {
  file: string;
  name: string;
  endMs: number;
}

/** Nuits du test dans les fiches des sessions, de la plus récente à la plus ancienne. */
const storedNights = (sessions: readonly LibrarySession[]): StoredNight[] =>
  sessions
    .flatMap(({ file, record }): StoredNight[] => {
      const night = record.sport === NIGHT_SPORT ? record.summary.night : undefined;
      if (!night) return [];
      const { startMs, endMs } = record.summary;
      return [{
        file, startMs, endMs, lowBpm: night.lowBpm, avgBpm: night.avgBpm,
        name: record.name ?? nightSessionName(startMs, endMs),
      }];
    })
    .sort((a, b) => b.startMs - a.startMs);

/**
 * Test « FC de nuit » (lot 213), depuis Tests : à quoi il sert, comment
 * s'installer, ce qui sera mesuré, et « Lancer », qui ouvre Enregistrer prêt
 * sur ce test (même adresse que le test de FC max, `recordPath`). Dessous, les
 * dernières nuits et leur courbe d'une nuit à l'autre, lues dans les fiches
 * des sessions (`summary.night`), sans magasin à part.
 */
function NightHrTestPage() {
  const navigate = useNavigate();
  const openSession = useOpenSession();
  const { sessions } = useLibraryFields('sessions');
  const nights = useMemo(() => storedNights(sessions), [sessions]);
  const chartNights = useMemo(() => nights.slice(0, CHART_NIGHTS).reverse(), [nights]);
  const launch = () => navigate(recordPath(baseActivity(NIGHT_SPORT).id, PROTOCOL.id));
  const lowMin = Math.round(PROTOCOL.lowWindowS / 60);

  return (
    <div className="ui-page train-page train-page--help">
      <PageHeader title={PROTOCOL.label} back={{ to: WORKOUT_LISTS.fractionne.listPath, label: WORKOUT_LISTS.fractionne.title }}
        subtitle="La ceinture portée toute la nuit, le téléphone posé près du lit, sans GPS : la FC la plus basse de la nuit, sa place, les sursauts, et la suite des nuits." />

      <div className="ui-alert ui-alert--warning">
        Ceinture cardio connectée avant de vous coucher : sans elle, ce test ne mesure rien.
      </div>

      <Card heading={<>Mise en place<HelpToggle helpKey="nuit:mise-en-place" label="Mise en place" size="s" /></>}>
        <HelpText helpKey="nuit:mise-en-place" note>
          Humidifiez les plots de la ceinture, serrez-la sans gêner, posez le téléphone en charge à moins de 3 mètres, Bluetooth allumé.
          Cette mesure ne dit rien du sommeil lui-même, ni de votre santé : elle sert à suivre votre récupération d'une nuit à l'autre.
        </HelpText>
        <ol className="fit-steps">
          <li><strong>Avant de vous coucher</strong> : humidifiez les plots de la ceinture et serrez-la sans gêner.</li>
          <li><strong>Le téléphone</strong> en charge près du lit, Bluetooth allumé.</li>
          <li><strong>« Lancer »</strong>, puis le bouton rond au coucher. La nuit est silencieuse : ni son ni vibration.</li>
          <li><strong>Au réveil</strong>, « Arrêter » (bouton tenu) : la session est rangée, son analyse montre l'onglet « test ».</li>
        </ol>
      </Card>

      <Card heading="Ce qui est mesuré">
        <ul className="fit-steps">
          <li><strong>FC la plus basse</strong> : la moyenne la plus basse sur {lowMin} minutes de suite, son heure, et sa place dans la nuit
            (en début, au milieu ou en fin de nuit) ; son écart à votre FC repos, si elle est saisie dans Pratiquant.</li>
          <li><strong>FC moyenne</strong> de la nuit, et la première moitié contre la seconde moitié.</li>
          <li><strong>Sursauts</strong> : les moments où le cœur accélère nettement (un mouvement, un demi-réveil, probablement).</li>
          <li><strong>Stabilisation</strong> : quand la FC se pose près de la plus basse, et le temps passé près d'elle.</li>
          <li><strong>Courbe de la nuit</strong> en heures d'horloge, et un tableau heure par heure.</li>
          <li><strong>Qualité de l'enregistrement</strong> : la part de la nuit mesurée, les trous de la ceinture, l'intervalle entre deux mesures.</li>
        </ul>
        <p className="ui-hint">Moins de {Math.round(PROTOCOL.shortNightS / 3600)} h : les chiffres sont montrés, avec la mention « nuit incomplète ».</p>
      </Card>

      <div className="train-actions">
        <Button variant="primary" onClick={launch}>
          <IconPlay size={18} />
          Lancer
        </Button>
        <span className="ui-hint">Ouvre Enregistrer, prêt ; le bouton rond démarre.</span>
      </div>

      <Card heading={<>Vos nuits<HelpToggle helpKey="nuit:historique" label="Vos nuits" size="s" /></>}>
        <HelpText helpKey="nuit:historique" note>
          Une nuit seule ne dit presque rien. Une FC de nuit plus haute de quelques battements sur plusieurs nuits va souvent avec fatigue,
          chaleur, alcool ou un repas tardif. En cas de doute, parlez-en à un médecin. Lues dans les sessions de la mémoire.
        </HelpText>
        {nights.length === 0 ? (
          <p className="ui-hint">
            Aucune nuit dans la mémoire pour l'instant. Elles se rangent dans la <Link to="/fractionne">bibliothèque de l'Entraînement</Link>.
          </p>
        ) : (
          <>
            {chartNights.length > 1 && <NightHrChart nights={chartNights} />}
            <p className="ui-muted ui-text-xs">Trait plein : la FC la plus basse de chaque nuit ; pointillé : sa moyenne.</p>
            <ul className="train-list">
              {nights.slice(0, LISTED_NIGHTS).map((n) => (
                <li key={n.file} className="train-item">
                  <button type="button" className="night-history__open" onClick={() => openSession(n.file, 'fractionne')}>
                    <span className="train-item__name">{n.name}</span>
                    <span className="train-item__detail">
                      {n.lowBpm !== null && `plus basse ${Math.round(n.lowBpm)} bpm · `}moyenne {Math.round(n.avgBpm)} bpm
                      {n.endMs - n.startMs < PROTOCOL.shortNightS * 1000 && ' · nuit incomplète'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

export default NightHrTestPage;
