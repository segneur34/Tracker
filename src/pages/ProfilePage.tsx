import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ActivityChart from '../components/ActivityChart';
import ActivityArt from '../components/activityArt';
import PageBackdrop from '../components/PageBackdrop';
import { AvatarPicker, ProfileAvatar } from '../components/ProfileAvatar';
import ProfileRoot, { RootSlot } from '../components/ProfileRoot';
import { IconChevronRight } from '../components/icons';
import SegmentedControl from '../components/ui/SegmentedControl';
import { activityFamily, type Activity } from '../core/activities';
import { activityIcon } from '../core/activityIcons';
import { formatDuration, toDisplayDistance } from '../core/units';
import { libraryPath } from '../core/parentPage';
import { useFavoriteBackdrop } from '../hooks/useFavoriteBackdrop';
import { useOpenSections } from '../hooks/useOpenSections';
import { useProfileRoot } from '../hooks/useProfileRoot';
import { runnerAvatar, runnerName } from '../running/runnerProfile';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import { useLibraryFields } from '../hooks/useSessionLibrary';
import { useStoredRecord } from '../hooks/useStoredRecord';
import { useThemedShade } from '../hooks/useTheme';
import { useNow } from '../hooks/useNow';
import { useVisibility } from '../hooks/useSportSettings';
import { useVisibleStatSessions } from '../hooks/useVisibleStatSessions';
import { CHART_PERIODS, type ChartRange } from '../library/activityChart';
import { activityShares, favoriteActivity } from '../library/profile';
import { inBounds, isStatsPeriod, statsPeriodBounds, statsTotals } from '../library/stats';
import { OTHERS_COLOR } from '../components/chartStyle';
import './ProfilePage.css';

/**
 * Profil : une période en un coup d'œil (`library/profile.ts`), sur la
 * maquette du 22/10 et un fond de courbes de niveau. En tête, la photo ronde
 * (un dessin d'activité ou une image importée, choisis en la touchant ; sans
 * choix, le dessin du sport préféré de toutes les sessions) et le pseudo. Puis
 * la période, qui règle toute la page : semaine, 30 jours, 6 mois, année (les
 * bornes du graphe d'activités et des statistiques) ou depuis le début ; choix
 * retenu sur l'appareil. Puis, dans une seule bande : nombre d'activités (et
 * leur temps), kilomètres parcourus, D+, sport préféré (l'activité qui a le
 * plus de temps, avec son dessin) ; la répartition du temps par activité en
 * anneau (le total au centre ; « Autres » se déplie dans le détail), et le
 * graphe d'activités de la même période.
 * Mêmes sessions que les statistiques : ni celles d'une activité ou d'une
 * famille cachée, ni celles à classer. Distance en km quelle que soit l'unité
 * des activités : une somme de toutes les familles ne tient qu'en une unité.
 */

/** Espaces insécables, sauf après « Depuis » : sur un téléphone étroit, seul ce libellé passe sur deux lignes. */
const PROFILE_PERIODS: { id: ChartRange; label: string }[] = [...CHART_PERIODS, { id: 'tout' as const, label: 'Depuis le début' }]
  .map((p) => ({ ...p, label: p.label.replace(/ /g, '\u00a0').replace('Depuis\u00a0', 'Depuis ') }));

/** Période retenue sur l'appareil ; l'année au départ. */
interface ProfileView {
  periode: string;
}
const VIEW_NAMESPACE = 'tracker.profil';
const VIEW_KEY = 'affichage';
const VIEW_DEFAULTS: ProfileView = { periode: 'annee' };

/** Détail par activité sous l'anneau : replié au départ, état retenu sur l'appareil. */
const DETAIL_DEFAULT = { detail: false };

/** Cadres que la racine entoure (`ProfileRoot`), dans l'ordre de la page. */
const ROOT_CARDS = ['.profile-periods', '.profile-figures', '.profile-split', '.actchart'];

/** Au-delà, les plus petites parts se regroupent en « Autres » : un anneau ne se lit plus. */
const MAX_SLICES = 6;
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

const hoursText = (s: number): string => formatDuration(s * 1000);

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
  const { status, sessions, scanning } = useLibraryFields('status', 'sessions', 'scanning');
  const backdrop = useFavoriteBackdrop();
  const { activities } = useVisibility();
  /** Le nom ou pseudo de Réglages en titre, « Profil » sans lui. */
  const { profile, setAvatar } = useRunnerProfile();
  const name = runnerName(profile);
  const avatar = runnerAvatar(profile);
  /** Choix de la photo ouvert sous l'en-tête : non retenu. */
  const [picking, setPicking] = useState(false);
  const nowMs = useNow();
  const { value: view, update: rememberView } = useStoredRecord<ProfileView>(VIEW_NAMESPACE, VIEW_KEY, VIEW_DEFAULTS);
  const period: ChartRange = isStatsPeriod(view.periode) ? view.periode : 'annee';
  const [active, setActive] = useState<string | null>(null);
  /** Activités regroupées dans « Autres », dépliées sous sa ligne : non retenu. */
  const [othersOpen, setOthersOpen] = useState(false);
  const { open, toggle } = useOpenSections('profil', DETAIL_DEFAULT);

  // Sessions classées et visibles, avec les activités de base qu'elles emploient (nom et couleur).
  const { all, activityById } = useVisibleStatSessions();

  // Racine : toutes les sessions, quelle que soit la période ; son détail s'ouvre sous le carré, non retenu.
  const root = useProfileRoot(all, profile, nowMs);
  const [rootOpen, setRootOpen] = useState(false);
  const closeRoot = useCallback(() => setRootOpen(false), []);

  const inPeriod = useMemo(() => {
    const bounds = statsPeriodBounds(period, nowMs);
    return all.filter((s) => inBounds(s.startMs, bounds));
  }, [all, period, nowMs]);
  const totals = useMemo(() => statsTotals(inPeriod), [inPeriod]);
  const activityOrder = useMemo(() => activities.map((a) => a.id), [activities]);

  const shown = useThemedShade();
  const { slices, others } = useMemo((): { slices: Slice[]; others: Slice[] } => {
    const shares = activityShares(inPeriod, activityOrder).filter((s) => s.totals.durationS > 0);
    const ofShare = (s: (typeof shares)[number]): Slice => {
      const a = activityById.get(s.activityId) ?? null;
      return { key: s.activityId, label: a?.name ?? s.activityId, color: a ? shown(a.color) : OTHERS_COLOR, durationS: s.totals.durationS, share: s.share, activity: a };
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
  }, [inPeriod, activityOrder, activityById, shown]);
  const favoriteId = useMemo(() => favoriteActivity(inPeriod, activityOrder), [inPeriod, activityOrder]);
  const favorite = favoriteId ? activityById.get(favoriteId) ?? null : null;
  // Photo par défaut : le sport préféré de toutes les sessions, qui ne change pas avec la période.
  const overallFavoriteId = useMemo(() => favoriteActivity(all, activityOrder), [all, activityOrder]);
  const overallFavorite = overallFavoriteId ? activityById.get(overallFavoriteId) ?? null : null;
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
    <div className="ui-page ui-page--backdrop profile">
      <PageBackdrop variant={backdrop} />
      <header className="profile-head">
        <button type="button" className="profile-head__avatar" aria-label="Changer la photo de profil" aria-expanded={picking}
          onClick={() => setPicking(!picking)}>
          <ProfileAvatar avatar={avatar}
            fallback={overallFavorite ? { icon: activityIcon(overallFavorite), color: shown(overallFavorite.color) } : null} />
        </button>
        <h1 className="profile-head__title">{name ?? 'Profil'}</h1>
        <RootSlot growth={root.growth} open={rootOpen} onToggle={() => setRootOpen(!rootOpen)} />
      </header>
      {picking && <AvatarPicker avatar={avatar} onPick={setAvatar} onClose={() => setPicking(false)} />}

      <SegmentedControl fit className="profile-periods" label="Période" items={PROFILE_PERIODS.map((p) => ({ key: p.id, label: p.label }))}
        value={period} onChange={(key) => rememberView({ periode: key })} />

      {status === 'opening' ? (
        <p className="ui-hint">Lecture de la mémoire…</p>
      ) : (
        <>
          {scanning && <p className="ui-hint">Fiches en cours de calcul ({scanning.done} / {scanning.total}) : chiffres provisoires.</p>}

          <section className="profile-figures" aria-label="Totaux de la période">
            <div className="profile-figure">
              <span className="ui-eyebrow">Activités</span>
              <span className="profile-figure__value num">{totals.sessions.toLocaleString('fr-FR')}</span>
              <span className="profile-figure__caption">{totals.sessions > 0 ? `en ${hoursText(totals.durationS)}` : 'aucune session'}</span>
            </div>
            <div className="profile-figure">
              <span className="ui-eyebrow">Distance</span>
              <span className="profile-figure__value num">
                {km.toLocaleString('fr-FR', { maximumFractionDigits: km < 100 ? 1 : 0 })}<small>km</small>
              </span>
              <span className="profile-figure__caption">parcourus</span>
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
            {favorite ? (
              <button type="button" className="profile-figure profile-figure--link" onClick={() => openLibrary(favorite)}
                title={`${favorite.name} : voir ses sessions`}>
                <span className="ui-eyebrow">Sport préféré</span>
                <span className="profile-figure__value">
                  <ActivityArt icon={activityIcon(favorite)} className="profile-figure__art" style={{ color: shown(favorite.color) }} />
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
          </section>

          {slices.length > 0 && (
            <section className="profile-split ui-card-col" aria-label="Répartition par activité">
              <h2 className="profile-card__title">Répartition du temps</h2>
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
      <ProfileRoot growth={root.growth} goalMin={root.goalMin} cardSelectors={ROOT_CARDS}
        ready={status === 'ready' && !scanning} open={rootOpen} onClose={closeRoot} />
    </div>
  );
}

export default ProfilePage;
