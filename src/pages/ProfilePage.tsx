import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ActivityChart from '../components/ActivityChart';
import ActivityArt from '../components/activityArt';
import { IconChevronRight } from '../components/icons';
import PageHeader from '../components/ui/PageHeader';
import SegmentedControl from '../components/ui/SegmentedControl';
import { activityFamily, sessionActivity, type Activity } from '../core/activities';
import { activityIcon } from '../core/activityIcons';
import { toDisplayDistance } from '../core/units';
import { libraryPath } from '../hooks/useLibraryNavigation';
import { useOpenSections } from '../hooks/useOpenSections';
import { runnerName, useRunnerProfile } from '../hooks/useRunnerProfile';
import { useSessionLibrary } from '../hooks/useSessionLibrary';
import { useStoredRecord } from '../hooks/useStoredRecord';
import { useVisibility } from '../hooks/useSportSettings';
import { CHART_PERIODS, type ChartRange } from '../library/activityChart';
import { activityShares, favoriteActivity } from '../library/profile';
import { inBounds, isStatsPeriod, statSessionOf, statsPeriodBounds, statsTotals, type StatSession } from '../library/stats';
import './ProfilePage.css';

/**
 * Profil : une période en un coup d'œil (`library/profile.ts`). En tête, la
 * période, qui règle toute la page : semaine, 30 jours, 6 mois, année (les
 * bornes du graphe d'activités et des statistiques) ou depuis le début ; choix
 * retenu sur l'appareil. Puis, dans l'ordre : kilomètres parcourus, sport
 * préféré (l'activité qui a le plus de temps, avec son dessin), D+, la
 * répartition du temps par activité en anneau (le total au centre ; « Autres »
 * se déplie dans le détail), et le graphe d'activités de la même période.
 * Mêmes sessions que les statistiques : ni celles d'une activité ou d'une
 * famille cachée, ni celles à classer. Distance en km quelle que soit l'unité
 * des activités : une somme de toutes les familles ne tient qu'en une unité.
 */

const PROFILE_PERIODS: { id: ChartRange; label: string }[] = [...CHART_PERIODS, { id: 'tout', label: 'Depuis le début' }];

/** Période retenue sur l'appareil ; l'année au départ. */
interface ProfileView {
  periode: string;
}
const VIEW_NAMESPACE = 'tracker.profil';
const VIEW_KEY = 'affichage';
const VIEW_DEFAULTS: ProfileView = { periode: 'annee' };

/** Détail par activité sous l'anneau : replié au départ, état retenu sur l'appareil. */
const DETAIL_DEFAULT = { detail: false };

/** Au-delà, les plus petites parts se regroupent en « Autres » : un anneau ne se lit plus. */
const MAX_SLICES = 6;
const OTHERS_COLOR = '#9aa0a6';
const OTHERS_KEY = '__autres';

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

/** Pastille, nom, temps et part d'une ligne du détail. */
const LegendContent = ({ slice: s }: { slice: Slice }) => (
  <>
    <span className="profile-legend__dot" style={{ background: s.color }} />
    <span className="profile-legend__name">{s.label}</span>
    <span className="profile-legend__time num">{hoursText(s.durationS)}</span>
    <span className="profile-legend__share num">{percentText(s.share)}</span>
  </>
);

function ProfilePage() {
  const navigate = useNavigate();
  const { status, sessions, scanning } = useSessionLibrary();
  const { activities, isShown } = useVisibility();
  /** Le nom ou pseudo de Réglages en titre, « Profil » sans lui. */
  const name = runnerName(useRunnerProfile().profile);
  const [nowMs] = useState(() => Date.now());
  const { value: view, update: rememberView } = useStoredRecord<ProfileView>(VIEW_NAMESPACE, VIEW_KEY, VIEW_DEFAULTS);
  const period: ChartRange = isStatsPeriod(view.periode) ? view.periode : 'annee';
  const [active, setActive] = useState<string | null>(null);
  /** Activités regroupées dans « Autres », dépliées sous sa ligne : non retenu. */
  const [othersOpen, setOthersOpen] = useState(false);
  const { open, toggle } = useOpenSections('profil', DETAIL_DEFAULT);

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

  const inPeriod = useMemo(() => {
    const bounds = statsPeriodBounds(period, nowMs);
    return all.filter((s) => inBounds(s.startMs, bounds));
  }, [all, period, nowMs]);
  const totals = useMemo(() => statsTotals(inPeriod), [inPeriod]);
  const activityOrder = useMemo(() => activities.map((a) => a.id), [activities]);

  const { slices, others } = useMemo((): { slices: Slice[]; others: Slice[] } => {
    const shares = activityShares(inPeriod, activityOrder).filter((s) => s.totals.durationS > 0);
    const ofShare = (s: (typeof shares)[number]): Slice => {
      const a = activityById.get(s.activityId) ?? null;
      return { key: s.activityId, label: a?.name ?? s.activityId, color: a?.color ?? OTHERS_COLOR, durationS: s.totals.durationS, share: s.share, activity: a };
    };
    if (shares.length <= MAX_SLICES) return { slices: shares.map(ofShare), others: [] };
    const rest = shares.slice(MAX_SLICES - 1);
    return {
      slices: [
        ...shares.slice(0, MAX_SLICES - 1).map(ofShare),
        {
          key: OTHERS_KEY, label: `Autres (${rest.length})`, color: OTHERS_COLOR, activity: null,
          durationS: rest.reduce((n, s) => n + s.totals.durationS, 0), share: rest.reduce((n, s) => n + s.share, 0),
        },
      ],
      others: rest.map(ofShare),
    };
  }, [inPeriod, activityOrder, activityById]);
  const favoriteId = useMemo(() => favoriteActivity(inPeriod, activityOrder), [inPeriod, activityOrder]);
  const favorite = favoriteId ? activityById.get(favoriteId) ?? null : null;
  const openLibrary = (a: Activity) => navigate(libraryPath(activityFamily(a), a.id));

  /** Toucher une part l'éclaire ; « Autres » ouvre aussi le détail et y déplie ses activités. */
  const pickSlice = (key: string) => {
    if (key === OTHERS_KEY && active !== key) {
      if (!open.detail) toggle('detail');
      setOthersOpen(true);
    }
    setActive(active === key ? null : key);
  };

  const km = toDisplayDistance(totals.distanceM, 'km');
  const activeSlice = slices.find((s) => s.key === active) ?? null;

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
      <PageHeader title={name ?? 'Profil'} />

      <SegmentedControl className="profile-periods" label="Période" items={PROFILE_PERIODS.map((p) => ({ key: p.id, label: p.label }))}
        value={period} onChange={(key) => rememberView({ periode: key })} />

      {status === 'opening' ? (
        <p className="profile-hint">Lecture de la mémoire…</p>
      ) : (
        <>
          {scanning && <p className="profile-hint">Fiches en cours de calcul ({scanning.done} / {scanning.total}) : chiffres provisoires.</p>}

          <section className="profile-figures" aria-label="Totaux de la période">
            <div className="profile-figure">
              <span className="ui-eyebrow">Distance</span>
              <span className="profile-figure__value num">
                {km.toLocaleString('fr-FR', { maximumFractionDigits: km < 100 ? 1 : 0 })}<small>km</small>
              </span>
              <span className="profile-figure__caption">parcourus</span>
            </div>
            {favorite ? (
              <button type="button" className="profile-figure profile-figure--link" onClick={() => openLibrary(favorite)}
                title={`${favorite.name} : voir ses sessions`}>
                <span className="ui-eyebrow">Sport préféré</span>
                <span className="profile-figure__value">
                  <ActivityArt icon={activityIcon(favorite)} className="profile-figure__art" style={{ color: favorite.color }} />
                </span>
                <span className="profile-figure__caption profile-figure__name">{favorite.name}</span>
              </button>
            ) : (
              <div className="profile-figure">
                <span className="ui-eyebrow">Sport préféré</span>
                <span className="profile-figure__value">—</span>
                <span className="profile-figure__caption">aucune session</span>
              </div>
            )}
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

          {slices.length > 0 && (
            <section className="profile-split" aria-label="Répartition par activité">
              <span className="ui-eyebrow">Répartition du temps</span>
              <div className="profile-split__body">
                <div className="profile-donut">
                  <svg viewBox="0 0 200 200" role="img" aria-label="Part de chaque activité dans le temps de la période">
                    <g transform="rotate(-90 100 100)" onMouseLeave={() => setActive(null)}>
                      {arcs.map(({ slice, dash, offset: o }) => (
                        <circle key={slice.key} cx="100" cy="100" r={RING_R} fill="none" stroke={slice.color} strokeWidth={RING_W}
                          strokeDasharray={dash} strokeDashoffset={o}
                          opacity={active === null || active === slice.key ? 1 : 0.35}
                          onMouseEnter={() => setActive(slice.key)} onClick={() => pickSlice(slice.key)} />
                      ))}
                    </g>
                  </svg>
                  <div className="profile-donut__center">
                    <span className="profile-donut__label">{activeSlice ? activeSlice.label : 'Total'}</span>
                    <span className="profile-donut__value num">{hoursText(activeSlice ? activeSlice.durationS : totals.durationS)}</span>
                    {activeSlice && <span className="profile-donut__label num">{percentText(activeSlice.share)}</span>}
                  </div>
                </div>
                <div className="profile-split__detail">
                  <button type="button" className="profile-fold" aria-expanded={open.detail} onClick={() => toggle('detail')}>
                    <span className="profile-fold__label">Par activité</span>
                    <span className="profile-fold__meta num">{slices.length} activité{slices.length > 1 ? 's' : ''}</span>
                    <IconChevronRight size={16} className="profile-fold__chevron" style={{ transform: `rotate(${open.detail ? -90 : 90}deg)` }} />
                  </button>
                  {open.detail && (
                    <ul className="profile-legend">
                      {slices.flatMap((s) => {
                        const row = (
                          <li key={s.key} onMouseEnter={() => setActive(s.key)} onMouseLeave={() => setActive(null)}
                            className={active === s.key ? 'is-active' : undefined}>
                            {s.activity ? (
                              <button type="button" className="profile-legend__row" onClick={() => openLibrary(s.activity!)}>
                                <LegendContent slice={s} />
                              </button>
                            ) : (
                              <button type="button" className="profile-legend__row" aria-expanded={othersOpen}
                                onClick={() => setOthersOpen(!othersOpen)}>
                                <LegendContent slice={s} />
                                <IconChevronRight size={14} className="profile-fold__chevron" style={{ transform: `rotate(${othersOpen ? -90 : 90}deg)` }} />
                              </button>
                            )}
                          </li>
                        );
                        if (s.key !== OTHERS_KEY || !othersOpen) return [row];
                        // Sous « Autres », ses activités en retrait ; leur survol éclaire sa part de l'anneau.
                        return [row, ...others.map((o) => (
                          <li key={o.key} className={`profile-legend__sub${active === OTHERS_KEY ? ' is-active' : ''}`}
                            onMouseEnter={() => setActive(OTHERS_KEY)} onMouseLeave={() => setActive(null)}>
                            {o.activity ? (
                              <button type="button" className="profile-legend__row" onClick={() => openLibrary(o.activity!)}>
                                <LegendContent slice={o} />
                              </button>
                            ) : (
                              <div className="profile-legend__row"><LegendContent slice={o} /></div>
                            )}
                          </li>
                        ))];
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {sessions.length > 0 && <ActivityChart key={period} period={period} nowMs={nowMs} />}
    </div>
  );
}

export default ProfilePage;
