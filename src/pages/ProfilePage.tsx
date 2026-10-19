import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ActivityChart from '../components/ActivityChart';
import { IconChevronRight } from '../components/icons';
import PageHeader from '../components/ui/PageHeader';
import { activityFamily, sessionActivity, type Activity } from '../core/activities';
import { toDisplayDistance } from '../core/units';
import { libraryPath } from '../hooks/useLibraryNavigation';
import { useSessionLibrary } from '../hooks/useSessionLibrary';
import { useVisibility } from '../hooks/useSportSettings';
import { activityShares, calendarYearBounds, profileYears } from '../library/profile';
import { inBounds, statSessionOf, statsTotals, type StatSession } from '../library/stats';
import './ProfilePage.css';

/**
 * Profil : l'année civile en un coup d'œil (`library/profile.ts`). Dans
 * l'ordre : kilomètres parcourus, temps en activité, D+, la répartition du
 * temps par activité en anneau, puis le graphe d'activités, avec ses propres
 * périodes. Flèches pour revoir les années passées, de celle de la plus vieille
 * session à l'année en cours ; la page s'ouvre toujours sur l'année en cours.
 * Mêmes sessions que les statistiques : ni celles d'une activité ou d'une
 * famille cachée, ni celles à classer. Distance en km quelle que soit l'unité
 * des activités : une somme de toutes les familles ne tient qu'en une unité.
 */

/** Au-delà, les plus petites parts se regroupent en « Autres » : un anneau ne se lit plus. */
const MAX_SLICES = 6;
const OTHERS_COLOR = '#9aa0a6';

/** Anneau : rayon médian et épaisseur, en unités du dessin (200 de côté). */
const RING_R = 78;
const RING_W = 26;
const RING_GAP = 2;

interface Slice {
  key: string;
  label: string;
  color: string;
  durationS: number;
  share: number;
  /** `null` : « Autres ». */
  activity: Activity | null;
}

const hoursText = (s: number): string => {
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h.toLocaleString('fr-FR')} h ${String(m).padStart(2, '0')}` : `${m} min`;
};

const percentText = (share: number): string =>
  share > 0 && share < 0.01 ? '< 1 %' : `${Math.round(share * 100)} %`;

function ProfilePage() {
  const navigate = useNavigate();
  const { status, sessions, scanning } = useSessionLibrary();
  const { activities, isShown } = useVisibility();
  const [nowMs] = useState(() => Date.now());
  const [year, setYear] = useState(() => new Date(nowMs).getFullYear());
  const [active, setActive] = useState<string | null>(null);

  // Sessions classées et visibles. Une session peut tenir d'une activité de base, hors de la liste : elle est
  // gardée, avec son nom et sa couleur.
  const { all, activityById } = useMemo(() => {
    const list: StatSession[] = [];
    const byId = new Map(activities.map((a) => [a.id, a]));
    for (const s of sessions) {
      const a = sessionActivity(activities, s.record.activityId, s.record.sport);
      if (!a || !isShown(a)) continue;
      if (!byId.has(a.id)) byId.set(a.id, a);
      list.push(statSessionOf(s.file, s.record, a));
    }
    return { all: list, activityById: byId };
  }, [sessions, activities, isShown]);

  const years = useMemo(() => profileYears(all, nowMs), [all, nowMs]);
  const inYear = useMemo(() => {
    const bounds = calendarYearBounds(year);
    return all.filter((s) => inBounds(s.startMs, bounds));
  }, [all, year]);
  const totals = useMemo(() => statsTotals(inYear), [inYear]);
  const activityOrder = useMemo(() => activities.map((a) => a.id), [activities]);

  const slices = useMemo((): Slice[] => {
    const shares = activityShares(inYear, activityOrder).filter((s) => s.totals.durationS > 0);
    const ofShare = (s: (typeof shares)[number]): Slice => {
      const a = activityById.get(s.activityId) ?? null;
      return { key: s.activityId, label: a?.name ?? s.activityId, color: a?.color ?? OTHERS_COLOR, durationS: s.totals.durationS, share: s.share, activity: a };
    };
    if (shares.length <= MAX_SLICES) return shares.map(ofShare);
    const rest = shares.slice(MAX_SLICES - 1);
    return [
      ...shares.slice(0, MAX_SLICES - 1).map(ofShare),
      {
        key: '__autres', label: `Autres (${rest.length})`, color: OTHERS_COLOR, activity: null,
        durationS: rest.reduce((n, s) => n + s.totals.durationS, 0), share: rest.reduce((n, s) => n + s.share, 0),
      },
    ];
  }, [inYear, activityOrder, activityById]);

  const yearIndex = years.indexOf(year);
  const km = toDisplayDistance(totals.distanceM, 'km');
  const activeSlice = slices.find((s) => s.key === active) ?? null;

  const yearSwitch = (
    <div className="profile-year" role="group" aria-label="Année">
      <button type="button" className="profile-year__arrow" aria-label="Année précédente"
        disabled={yearIndex <= 0} onClick={() => setYear(years[yearIndex - 1])}>
        <IconChevronRight style={{ transform: 'rotate(180deg)' }} />
      </button>
      <span className="profile-year__label num">{year}</span>
      <button type="button" className="profile-year__arrow" aria-label="Année suivante"
        disabled={yearIndex < 0 || yearIndex >= years.length - 1} onClick={() => setYear(years[yearIndex + 1])}>
        <IconChevronRight />
      </button>
    </div>
  );

  // Anneau : chaque part est un arc du même cercle, en trait épais, à partir du haut, dans le sens des aiguilles.
  const circumference = 2 * Math.PI * RING_R;
  const arcs = slices.map((s, i) => {
    const len = s.share * circumference;
    const gap = slices.length > 1 ? Math.min(RING_GAP, len / 2) : 0;
    const before = slices.slice(0, i).reduce((n, p) => n + p.share, 0) * circumference;
    return { slice: s, dash: `${Math.max(0, len - gap)} ${circumference}`, offset: -before };
  });

  return (
    <div className="ui-page profile">
      <PageHeader title="Profil" aside={yearSwitch} />

      {status === 'opening' ? (
        <p className="profile-hint">Lecture de la mémoire…</p>
      ) : (
        <>
          {scanning && <p className="profile-hint">Fiches en cours de calcul ({scanning.done} / {scanning.total}) : chiffres provisoires.</p>}

          <section className="profile-figures" aria-label={`Totaux ${year}`}>
            <div className="profile-figure">
              <span className="ui-eyebrow">Distance</span>
              <span className="profile-figure__value num">
                {km.toLocaleString('fr-FR', { maximumFractionDigits: km < 100 ? 1 : 0 })}<small>km</small>
              </span>
              <span className="profile-figure__caption">parcourus</span>
            </div>
            <div className="profile-figure">
              <span className="ui-eyebrow">Temps</span>
              <span className="profile-figure__value num">{hoursText(totals.durationS)}</span>
              <span className="profile-figure__caption">en activité</span>
            </div>
            <div className="profile-figure">
              <span className="ui-eyebrow">Dénivelé</span>
              <span className="profile-figure__value num">
                {totals.elevationSessions > 0 ? <>{Math.round(totals.elevationGainM).toLocaleString('fr-FR')}<small>m</small></> : '—'}
              </span>
              <span className="profile-figure__caption">
                D+{totals.elevationSessions > 0 && totals.elevationSessions < totals.sessions ? `, sur ${totals.elevationSessions} sessions` : ''}
              </span>
            </div>
          </section>
          <p className="profile-count">
            {totals.sessions === 0 ? `Aucune session en ${year}` : `${totals.sessions} session${totals.sessions > 1 ? 's' : ''} en ${year}`}
          </p>

          {slices.length > 0 && (
            <section className="profile-split" aria-label="Répartition par activité">
              <span className="ui-eyebrow">Répartition du temps</span>
              <div className="profile-split__body">
                <div className="profile-donut">
                  <svg viewBox="0 0 200 200" role="img" aria-label="Part de chaque activité dans le temps de l'année">
                    <g transform="rotate(-90 100 100)" onMouseLeave={() => setActive(null)}>
                      {arcs.map(({ slice, dash, offset: o }) => (
                        <circle key={slice.key} cx="100" cy="100" r={RING_R} fill="none" stroke={slice.color} strokeWidth={RING_W}
                          strokeDasharray={dash} strokeDashoffset={o}
                          opacity={active === null || active === slice.key ? 1 : 0.35}
                          onMouseEnter={() => setActive(slice.key)} onClick={() => setActive(active === slice.key ? null : slice.key)} />
                      ))}
                    </g>
                  </svg>
                  <div className="profile-donut__center">
                    <span className="profile-donut__label">{activeSlice ? activeSlice.label : 'Total'}</span>
                    <span className="profile-donut__value num">{hoursText(activeSlice ? activeSlice.durationS : totals.durationS)}</span>
                    {activeSlice && <span className="profile-donut__label num">{percentText(activeSlice.share)}</span>}
                  </div>
                </div>
                <ul className="profile-legend">
                  {slices.map((s) => {
                    const content = (
                      <>
                        <span className="profile-legend__dot" style={{ background: s.color }} />
                        <span className="profile-legend__name">{s.label}</span>
                        <span className="profile-legend__time num">{hoursText(s.durationS)}</span>
                        <span className="profile-legend__share num">{percentText(s.share)}</span>
                      </>
                    );
                    return (
                      <li key={s.key} onMouseEnter={() => setActive(s.key)} onMouseLeave={() => setActive(null)}
                        className={active === s.key ? 'is-active' : undefined}>
                        {s.activity ? (
                          <button type="button" className="profile-legend__row"
                            onClick={() => navigate(libraryPath(activityFamily(s.activity!), s.activity!.id))}>
                            {content}
                          </button>
                        ) : (
                          <div className="profile-legend__row">{content}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          )}
        </>
      )}

      {sessions.length > 0 && <ActivityChart />}
    </div>
  );
}

export default ProfilePage;
