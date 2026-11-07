import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HelpText } from './Help';
import { PanelHeading } from './PanelTitle';
import { IconChevronRight } from './icons';
import { formatDecimal, formatShortDuration } from '../core/units';
import { THRESHOLD_FROM_20MIN } from '../cycling/powerLevels';
import { AGE_GRADE_BELOW_LABEL, AGE_GRADE_CLASSES } from '../running/ageGradeTables';
import { VO2MAX_PERCENTILES, type Vo2maxStanding } from '../running/vo2maxNorms';
import type { RunnerProfile } from '../library/athleteProfile';
import type { StatSession } from '../library/stats';
import { cyclingLevel, levelProfileOf, runningLevel, type LevelProfile, type RaceLevel } from '../library/statsLevel';

/**
 * Onglet « niveau » des statistiques (lot 146), à pied et à vélo : les meilleurs efforts de la période situés par
 * rapport aux références publiées (`library/statsLevel.ts`), d'après l'année de naissance, le sexe et le poids de
 * Réglages › Pratiquant. Chaque meilleur ouvre sa session, comme les records.
 */

/** Jour et mois d'une session, « 12/10 ». */
const dayMonth = (ms: number): string => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

const SEX_WORD: Record<LevelProfile['sex'], string> = { h: 'hommes', f: 'femmes' };

/** Place d'une VO2max en clair : « au-dessus de 62 % des hommes de 40 à 49 ans ». */
const standingText = (standing: Vo2maxStanding, sex: LevelProfile['sex']): string => {
  const who = `des ${SEX_WORD[sex]} de ${standing.band.fromAge} à ${standing.band.toAge} ans`;
  const edge = VO2MAX_PERCENTILES[0];
  if (standing.kind === 'below') return `parmi les ${edge} % les plus bas ${who}`;
  if (standing.kind === 'above') return `parmi les ${100 - VO2MAX_PERCENTILES[VO2MAX_PERCENTILES.length - 1]} % les plus hauts ${who}`;
  return `au-dessus de ${Math.round(standing.percentile)} % ${who}`;
};

/** Une ligne : un bouton qui ouvre la session, ou un texte seul sans session. */
function LevelRow({ session, onOpen, children }: { session: StatSession | null; onOpen: (s: StatSession) => void; children: ReactNode }) {
  return (
    <li>
      {session ? (
        <button type="button" className="stats-row" onClick={() => onOpen(session)}>
          <span className="stats-level__text">{children}</span>
          <IconChevronRight size={16} className="stats-row__chevron" />
        </button>
      ) : (
        <div className="stats-row stats-row--static"><span className="stats-level__text">{children}</span></div>
      )}
    </li>
  );
}

const raceRow = (label: string, race: RaceLevel | null, onOpen: (s: StatSession) => void) => (
  <LevelRow key={label} session={race?.session ?? null} onOpen={onOpen}>
    {race ? (
      <>
        <strong className="num">{label} : {formatShortDuration(race.timeS)}</strong> ({dayMonth(race.session.startMs)})
        {' · '}{Math.round(race.percent)} % de la référence de votre âge : {race.classLabel}
      </>
    ) : (
      <><strong>{label}</strong> : —</>
    )}
  </LevelRow>
);

const SETTINGS_LINK = <Link to="/parametres">Réglages › Pratiquant</Link>;

/** Classes de la référence de l'âge, pour l'aide : « mondial dès 90 %, … ». */
const CLASSES_TEXT = `${AGE_GRADE_CLASSES.map((c) => `${c.label.replace('niveau ', '')} dès ${c.minPercent} %`).join(', ')}, ${AGE_GRADE_BELOW_LABEL.replace('niveau ', '')} en dessous`;

export default function StatsLevelPanel({ family, sessions, runner, open, onToggle, onOpen }: {
  family: 'course' | 'velo';
  /** Sessions de la sélection sur la période ; à pied, sans la marche. */
  sessions: readonly StatSession[];
  runner: RunnerProfile;
  open: boolean;
  onToggle: () => void;
  onOpen: (s: StatSession) => void;
}) {
  const profile = useMemo(() => levelProfileOf(runner), [runner]);
  const running = useMemo(() => (profile && family === 'course' ? runningLevel(sessions, profile) : null), [profile, family, sessions]);
  const cycling = useMemo(() => (profile && family === 'velo' ? cyclingLevel(sessions, profile) : null), [profile, family, sessions]);
  return (
    <>
      <PanelHeading label="Niveau" open={open} onToggle={onToggle} helpKey={profile ? 'stats:niveau' : undefined} />
      <HelpText helpKey="stats:niveau" note>
        {family === 'course' ? (
          <>
            <div>Référence de l'âge : tables WMA et USATF d'Alan Jones (2025, domaine public) ; 100 % est le record de l'âge ; {CLASSES_TEXT}.</div>
            <div>
              VO2max : estimée d'après la course (formule de Daniels et Gilbert), comparée au registre FRIEND 2022 (Mayo Clinic Proceedings) :
              VO2 de pointe mesurée en laboratoire sur tapis, population américaine ; ici une estimation d'après une course, à prendre comme un ordre de grandeur.
            </div>
          </>
        ) : (
          <>
            <div>Seuil : {formatDecimal(THRESHOLD_FROM_20MIN * 100, 0)} % de la meilleure puissance moyenne sur 20 min, puissance mécanique estimée par le modèle du vélo, sans capteur.</div>
            <div>Barème usuel dérivé des profils de puissance de Coggan (bikecalcs.uk) : des repères approximatifs, pas une table de la population.</div>
          </>
        )}
      </HelpText>
      {!profile ? (
        <p className="ui-hint stats-level__hint">Renseignez l'année de naissance et le sexe dans {SETTINGS_LINK} pour vous situer.</p>
      ) : (
        <ul className="stats-rows">
          {running && (
            <>
              {raceRow('Meilleur 5 km', running.d5km, onOpen)}
              {raceRow('Meilleur 10 km', running.d10km, onOpen)}
              <LevelRow session={running.vo2?.session ?? null} onOpen={onOpen}>
                {running.vo2 ? (
                  <>
                    <strong className="num">VO2max estimée : {Math.round(running.vo2.vo2)} ml/kg/min</strong>
                    {' '}(d'après votre {running.vo2.from === 'd5kmS' ? '5 km' : '10 km'}) · {standingText(running.vo2.standing, profile.sex)}
                  </>
                ) : (
                  <><strong>VO2max estimée</strong> : —</>
                )}
              </LevelRow>
            </>
          )}
          {cycling && (
            <LevelRow session={cycling.best?.session ?? null} onOpen={onOpen}>
              {cycling.best ? (
                <>
                  <strong className="num">Meilleurs 20 min : {cycling.best.watts} W estimés</strong> ({dayMonth(cycling.best.session.startMs)})
                  {' · '}
                  {cycling.wkg !== null && cycling.levelLabel !== null
                    ? `${formatDecimal(cycling.wkg, 1)} W/kg au seuil (× ${formatDecimal(THRESHOLD_FROM_20MIN, 2)}) : ${cycling.levelLabel}`
                    : 'poids à renseigner dans Réglages › Pratiquant'}
                </>
              ) : profile.weightKg === null ? (
                <><strong>Meilleurs 20 min</strong> : Poids à renseigner dans {SETTINGS_LINK}</>
              ) : (
                <><strong>Meilleurs 20 min</strong> : —</>
              )}
            </LevelRow>
          )}
        </ul>
      )}
    </>
  );
}
