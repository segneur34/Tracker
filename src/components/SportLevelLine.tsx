import { Link } from 'react-router-dom';
import { HelpText, HelpToggle } from './Help';
import { IconChevronRight } from './icons';
import { formatDecimal } from '../core/units';
import { useOpenSections } from '../hooks/useOpenSections';
import { LEVEL_PART_LABEL, LEVEL_RULES, type LevelPart, type SportLevel } from '../library/sportLevel';
import './SportLevelLine.css';

/**
 * Ligne « Niveau » du Profil (lot 230, présentation B de l'étude) : premier
 * cadre de la page, entre l'en-tête et la période, que la racine entoure.
 * Repliée, une ligne de hauteur constante (dans tous les états : lecture de la
 * mémoire, profil incomplet, note) : le chiffre, le palier et l'échelle des six
 * paliers. Dépliée, une part par bloc (sa note en barre, son poids effectif, sa
 * preuve ou ce qui la donnerait), la phrase du plafond. Pliage retenu sur
 * l'appareil, replié au départ.
 */

const OPEN_DEFAULT = { niveau: false };
const HELP_KEY = 'profil:niveau';
const BODY_ID = 'profile-level-body';

/** Pourcentage court : « 50 % », « 62,5 % ». */
const percent = (share: number): string => `${formatDecimal(share * 100, 1).replace(/,0$/, '')} %`;

/** Une part dépliée : nom et note, barre, poids, preuve ou invite. */
function LevelPartBlock({ part }: { part: LevelPart }) {
  const present = part.points !== null;
  return (
    <div className={`profile-level__part${present ? '' : ' profile-level__part--absent'}`}>
      <div className="profile-level__part-head">
        <span className="profile-level__part-name">{LEVEL_PART_LABEL[part.id]}</span>
        <span className="profile-level__part-points num">{present ? Math.round(part.points!) : '—'}</span>
      </div>
      <svg className="profile-level__bar" aria-hidden="true">
        <rect className="profile-level__bar-track" width="100%" height="100%" rx="4" />
        {present && <rect className="profile-level__bar-fill" width={`${Math.max(0, Math.min(100, part.points!))}%`} height="100%" rx="4" />}
      </svg>
      <span className="profile-level__weight">{present ? `compte pour ${percent(part.weight)}` : 'pas comptée'}</span>
      <p className="profile-level__proof">{present ? part.proof : part.missingHint}</p>
    </div>
  );
}

export default function SportLevelLine({ level, loading }: {
  /** La note, `null` sans année de naissance ou sans sexe. */
  level: SportLevel | null;
  /** Mémoire en cours de lecture : ni note ni invite. */
  loading: boolean;
}) {
  const { open, toggle } = useOpenSections('profil', OPEN_DEFAULT);
  const expanded = open.niveau;
  const note = !loading && level ? level.note : null;
  const caption = loading
    ? 'Lecture de la mémoire…'
    : !level
      ? 'Profil à compléter'
      : level.palier?.label ?? 'Pas encore de session';
  const palierIndex = !loading && level?.palier ? LEVEL_RULES.paliers.indexOf(level.palier) : -1;
  const forme = level?.parts.find((p) => p.id === 'forme');

  return (
    <section className="profile-level" aria-label="Niveau sportif">
      <div className="profile-level__row">
        <button type="button" className="profile-level__toggle" aria-expanded={expanded} aria-controls={BODY_ID} onClick={() => toggle('niveau')}>
          <span className="ui-eyebrow profile-level__eyebrow">Niveau</span>
          <span className="profile-level__note num">{note ?? '—'}</span>
          <span className="profile-level__palier">
            <span className="profile-level__caption">{caption}</span>
            <span className="profile-level__scale" aria-hidden="true">
              {LEVEL_RULES.paliers.map((p, k) => (
                <span key={p.label} className={`profile-level__step${k <= palierIndex ? ' is-on' : ''}${k === palierIndex ? ' is-current' : ''}`} />
              ))}
            </span>
          </span>
          <IconChevronRight size={16} className="profile-level__chevron" />
        </button>
        <HelpToggle helpKey={HELP_KEY} label="Niveau sportif" />
      </div>
      <HelpText helpKey={HELP_KEY} note>
        Ta note va de 0 à 100 et compare ce que tu fais aux repères des gens de ton âge. Les efforts comptent ton temps
        de sport des 6 dernières semaines, une minute intense valant deux minutes tranquilles. La régularité regarde si
        tu bouges au moins 3 jours par semaine, sur 12 semaines. La forme te situe parmi les gens de ton âge et de ton
        sexe, d'après un 5 km, un 10 km, une sortie vélo ou ta FC de repos. Une part sans mesure n'est pas comptée, elle
        n'est jamais mise à zéro.
      </HelpText>
      {expanded && (
        <div className="profile-level__body" id={BODY_ID}>
          {loading ? (
            <p className="ui-hint">Lecture de la mémoire…</p>
          ) : !level ? (
            <p className="ui-hint">
              Renseigne ton année de naissance et ton sexe dans <Link to="/parametres">Réglages › Pratiquant</Link> pour
              avoir ta note.
            </p>
          ) : (
            <>
              <p className="ui-hint">Face aux repères de ton âge, sur des fenêtres fixes, quelle que soit la période choisie plus bas.</p>
              <div className="profile-level__parts">
                {level.parts.map((part) => <LevelPartBlock key={part.id} part={part} />)}
              </div>
              {forme?.points === null && (
                <p className="ui-hint">Sans forme mesurée, la note s'arrête à {LEVEL_RULES.capWithoutForme}.</p>
              )}
              {level.uncounted.length > 0 && (
                <p className="ui-hint">
                  {level.uncounted.length === 1 ? 'Une session n\'est pas comptée' : `${level.uncounted.length} sessions ne sont pas comptées`} :
                  {' '}les tests de FC de repos et de nuit ne sont pas des efforts.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
