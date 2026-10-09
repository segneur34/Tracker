import { Fragment, useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import { FAMILY_ACCENT, FAMILY_LABEL, FAMILY_SHADES, activitiesOfFamily, activityFamily, nextActivityColor, type Activity } from '../core/activities';
import {
  ELEVATION_PRESETS, LOOP_RETURN_RATIO_RANGE, SPORT_FAMILIES, SPORT_PROFILES, TERRAIN_STEP_CHOICES_M, familySports, sportFamily, sportTreatment,
  type SportFamily, type Treatment,
} from '../core/sportProfiles';
import type { SportType } from '../core/types';
import {
  DISTANCE_UNIT_LABEL, DISTANCE_UNIT_SYMBOL, SPEED_UNIT_LABEL, formatPace, formatSpeedValue, fromDisplaySpeed, toDisplaySpeed,
  type DistanceUnit, type SpeedUnit,
} from '../core/units';
import { useOpenSections } from '../hooks/useOpenSections';
import { useTileCache } from '../hooks/useTileCache';
import { useRunnerProfile, type RunnerProfile } from '../hooks/useRunnerProfile';
import {
  TERRAIN_LABEL, TREATMENT_SPEED_RANGE_MS, TREATMENT_UNITS, defaultBikeType, defaultGradeRange, planningFamily,
  useAllSportSettings, type SportSettingsView, type TerrainType,
} from '../hooks/useSportSettings';
import { BIKE_TYPES, formatCrr, type BikeType } from '../cycling/energy';
import {
  DEFAULT_LIVE_FIELDS, MAX_LIVE_FIELDS, liveFieldLabel, liveFieldsOfTreatment, type LiveFieldKey,
} from '../recording/liveFields';
import {
  CUSTOM_FLAT_SPEED_BOUNDS_MS, DEFAULT_PACE_LEVEL, LEVEL_CLIMB_POWER_WKG, LEVEL_FLAT_SPEED_MS, PACE_LEVELS, PACE_LEVEL_LABEL,
  climbPowerWkgForFlatSpeed, isPaceLevel, type PaceLevel, type PlanningFamily,
} from '../planning/duration';
import type { WayType } from '../planning/brouterProfile';
import { WAY_TYPE_LABEL } from '../planning/route';
import BeepCurveEditor from '../components/BeepCurveEditor';
import { CARD_STYLE } from '../components/styles';
import { FAMILY_ICON } from '../components/familyIcons';
import { IconChevronRight } from '../components/icons';
import MemoryStatus from '../components/MemoryStatus';
import PanelTitle from '../components/PanelTitle';
import ShadePicker from '../components/ShadePicker';
import WayTypeTabs from '../components/WayTypeTabs';
import {
  JUMP_MIN_HEIGHT_RANGE, JUMP_PLACEMENTS, JUMP_PLACEMENT_HINT, JUMP_PLACEMENT_LABEL, type JumpPlacement, type JumpSettings,
} from '../recording/jumpSettings';
import PageHeader from '../components/ui/PageHeader';
import './settingsPage.css';

/**
 * Sauts mesurés par les capteurs du téléphone (voile, sauf bateau) : la case,
 * puis, cochée, l'emplacement du téléphone et la hauteur minimale montrée. Le
 * foil, juste au-dessus, est un réglage de l'activité à part entière.
 */
function JumpsSetting({ jumps, overridden, onChange }: {
  jumps: JumpSettings;
  overridden: boolean;
  onChange: (next: JumpSettings) => void;
}) {
  return (
    <>
      <div className="settings-row" title="Hauteur des sauts mesurée par l'accéléromètre et le gyroscope du téléphone, fixé au corps ; proposée à chaque enregistrement, sur le téléphone">
        <span className="settings-row__label">Sauts</span>
        <label className="settings-sports__pair">
          <input type="checkbox" checked={jumps.enabled} onChange={(e) => onChange({ ...jumps, enabled: e.target.checked })} />
          <span>Mesurer les sauts</span>
          {!overridden && <span className="settings-sports__mark">défaut</span>}
        </label>
      </div>
      {jumps.enabled && (
        <>
          <div className="settings-row settings-row--sub">
            <span className="settings-row__label">Emplacement du téléphone</span>
            <div className="settings-sports__pair">
              <select value={jumps.placement} className="ui-field ui-field--s"
                onChange={(e) => onChange({ ...jumps, placement: e.target.value as JumpPlacement })}>
                {JUMP_PLACEMENTS.map((p) => <option key={p} value={p}>{JUMP_PLACEMENT_LABEL[p]}</option>)}
              </select>
              <span className="settings-sports__mark">{JUMP_PLACEMENT_HINT[jumps.placement]}</span>
            </div>
          </div>
          <div className="settings-row settings-row--sub" title="Les sauts plus bas ne sont pas montrés ; tous restent mesurés">
            <span className="settings-row__label">Hauteur minimale</span>
            <NumberField unit="m" step={0.1} min={JUMP_MIN_HEIGHT_RANGE.min} max={JUMP_MIN_HEIGHT_RANGE.max}
              value={jumps.minHeightM}
              onCommit={(v) => { if (v !== null && v >= JUMP_MIN_HEIGHT_RANGE.min && v <= JUMP_MIN_HEIGHT_RANGE.max) onChange({ ...jumps, minHeightM: v }); }} />
          </div>
        </>
      )}
    </>
  );
}

/**
 * Types de voie cochés d'office quand on choisit l'activité en planification
 * (course, vélo) : proposés selon le vélo ou le terrain, tant qu'on ne les
 * change pas. Le dernier coché ne se décoche pas.
 */
function WayTypesSetting({ view, treatment, onChange }: { view: SportSettingsView; treatment: Treatment; onChange: (ways: WayType[]) => void }) {
  const toggle = (type: WayType) => {
    const next = view.wayTypes.includes(type) ? view.wayTypes.filter((w) => w !== type) : [...view.wayTypes, type];
    if (next.length > 0) onChange(next);
  };
  return (
    <div className="settings-row" title="Cochés d'office en planification quand on choisit cette activité ; ils se changent ensuite pour chaque itinéraire">
      <span className="settings-row__label">Types de voie</span>
      <div className="settings-sports__pair">
        <WayTypeTabs compact checked={view.wayTypes} onToggle={toggle} label={`Types de voie de ${view.activity.name}`}
          style={{ '--tab-accent': FAMILY_ACCENT[activityFamily(view.activity)] } as CSSProperties} />
        {!view.isWayTypesOverridden && (
          <span className="settings-sports__mark">{treatment === 'velo' ? 'selon le vélo' : 'selon le terrain'}</span>
        )}
      </div>
    </div>
  );
}

const cardStyle = { ...CARD_STYLE, marginBottom: '15px' } as const;

/** Blocs repliables de la page, tous fermés au départ ; l'état est mémorisé. */
type SettingsBlock = 'memoire' | 'activites' | 'enregistrement' | 'navigation' | 'cartes' | 'coureur';
const SETTINGS_BLOCK_DEFAULTS: Record<SettingsBlock, boolean> = {
  memoire: false, activites: false, enregistrement: false, navigation: false, cartes: false, coureur: false,
};
/** Plafonds proposés pour les cartes gardées, en Mo : une liste plutôt qu'un champ, qui effacerait des tuiles à chaque chiffre tapé. */
const TILE_CAP_CHOICES_MB = [100, 250, 500, 1000, 2000, 5000];
const DISTANCE_UNITS = Object.keys(DISTANCE_UNIT_LABEL) as DistanceUnit[];
/** Activités ouvertes, par identifiant ; absente : fermée. */
const NO_ACTIVITY_OPEN: Record<string, boolean> = {};

/**
 * Champ numérique optionnel, en `type="number"` avec flèches ↕, même
 * principe que le seuil d'activité du module voile : la valeur s'applique
 * immédiatement. L'affichage suit un brouillon local tant que le champ a le
 * focus, pour ne pas effacer une frappe en cours (valeur hors bornes en
 * cours de saisie, "." d'un décimal) quand un commit sans effet redéclenche
 * un rendu ; à la sortie du champ, le brouillon revient à la valeur commise.
 */
function NumberField({
  label, unit, value, onCommit, placeholder, step = 1, min, max,
}: {
  label?: string;
  unit?: string;
  value: number | null;
  onCommit: (next: number | null) => void;
  placeholder?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value === null ? '' : String(value));
  }, [value]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setDraft(text);
    if (text === '') { onCommit(null); return; }
    const parsed = parseFloat(text);
    if (!isNaN(parsed)) onCommit(parsed);
  };

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: label ? '8px' : 0, fontSize: '14px' }}>
      {label && <span style={{ width: '190px' }}>{label}</span>}
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setDraft(value === null ? '' : String(value)); }}
        className="ui-field ui-field--s num"
        style={{ width: '84px', textAlign: 'right' }} />
      {unit && <span style={{ color: 'var(--muted)' }}>{unit}</span>}
    </label>
  );
}

/**
 * Page Paramètres : mémoire, activités et tous leurs réglages (affichage,
 * enregistrement, terrain, vélo, temps estimé des itinéraires),
 * enregistrement, barre du bas, cartes hors ligne et caractéristiques du
 * pratiquant, en blocs repliables (chaque activité se replie aussi). Tout est enregistré sur l'appareil
 * à la saisie, recopié dans le dossier mémoire (`reglages.json`), et relu par
 * chaque module à son ouverture.
 */
function SettingsPage() {
  const {
    activities, view, setFor, resetActivity, addActivity, updateActivity, removeActivity, longPressMs, setLongPressMs,
    navFamily, setNavFamily, navSecondFamily, setNavSecondFamily, navHoldMs, setNavHoldMs,
  } = useAllSportSettings();
  const { profile, setNumber, setSex, age } = useRunnerProfile();
  const { open, toggle } = useOpenSections<SettingsBlock>('settings', SETTINGS_BLOCK_DEFAULTS);
  const { open: openActivity, toggle: toggleActivity } = useOpenSections<string>('settings-activities', NO_ACTIVITY_OPEN);
  /** Activités rangées par famille (Voile, Course à pied, Vélo, Fractionné), chacune dans l'ordre de la liste. */
  const familyOrdered = SPORT_FAMILIES.flatMap((f) => activitiesOfFamily(activities, f));

  const askRemove = (a: Activity) => {
    if (window.confirm(`Supprimer l'activité « ${a.name} » ? Ses sessions restent, rangées sous « ${SPORT_PROFILES[a.base].label} », et ses réglages sont effacés.`)) {
      removeActivity(a.id);
    }
  };

  /** Une activité ajoutée s'ouvre, pour la régler aussitôt. */
  const addAndOpen = (name: string, base: SportType, color: string): string | null => {
    const id = addActivity(name, base, color);
    if (id !== null && !openActivity[id]) toggleActivity(id);
    return id;
  };

  const profileField = (field: Exclude<keyof RunnerProfile, 'sex'>) => (next: number | null) => setNumber(field, next);

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: '15px' }}>
        <PageHeader
          title="Réglages"
          subtitle="Enregistrés sur cet appareil et dans le dossier mémoire, appliqués à l'ouverture de chaque module. Le bouton Défaut d'une activité revient aux valeurs de son calcul." />
      </div>

      <div style={{ marginBottom: '15px' }}>
        <MemoryStatus detailed collapse={{ open: open.memoire, onToggle: () => toggle('memoire') }} />
      </div>

      <div style={cardStyle}>
        <PanelTitle label="Activités" open={open.activites} onToggle={() => toggle('activites')} />
        {open.activites && (
          <>
            <p className="settings-block__intro">
              Celles proposées à l'enregistrement, dans les analyses et dans la bibliothèque. Chacune repose sur un calcul
              (wingfoil, planche, kite, bateau, course, vélo, fractionné à pied ou à vélo), qui fixe ses valeurs de départ ; ses réglages d'affichage et
              d'enregistrement lui sont propres.
            </p>
            <div className="settings-activities">
              {familyOrdered.map((activity, k) => {
                const s = view(activity);
                const id = activity.id;
                const p = SPORT_PROFILES[activity.base];
                const family = sportFamily(activity.base);
                const treatment = sportTreatment(activity.base);
                const sailing = treatment === 'voile';
                /** Famille du temps estimé des itinéraires, `null` en voile et en fractionné. */
                const paceFamily = planningFamily(activity);
                const units = TREATMENT_UNITS[treatment];
                const isOpen = openActivity[id] === true;
                const overridden =
                  s.isSpeedUnitOverridden || s.isDistanceUnitOverridden || s.isThresholdOverridden || s.isAutoPauseOverridden || s.speedRange !== null || s.gradeRange !== null ||
                  s.isLiveFieldsOverridden || s.isMarkGuideOverridden || s.terrain !== 'route' || s.terrainStepM !== p.terrainElevationStepM || s.bikeType !== defaultBikeType(id) || s.bikeWeight !== null ||
                  s.paceLevel !== DEFAULT_PACE_LEVEL || s.customFlatSpeedMs !== null || s.isWayTypesOverridden ||
                  s.loopReturnRatio !== p.loopReturnMaxRatio || s.isFoilOverridden || s.isJumpsOverridden;
                // Seuil : en voile dans l'unité choisie (rangé dans celle du calcul, les nœuds), en course en km/h.
                const thresholdUnit: SpeedUnit = sailing ? s.speedUnit : p.thresholdUnit;
                const thresholdShown = parseFloat(
                  toDisplaySpeed(fromDisplaySpeed(s.activeThreshold, p.thresholdUnit), thresholdUnit).toFixed(thresholdUnit === 'ms' ? 2 : 1)
                );
                // Voile sans réglage : champ vide, le seuil est suggéré par l'allure de chaque session.
                const thresholdEmpty = sailing && !s.isThresholdOverridden;
                const setThreshold = (next: number | null) =>
                  setFor(id, 'activeThreshold', next === null ? null : toDisplaySpeed(fromDisplaySpeed(next, thresholdUnit), p.thresholdUnit));
                // Bornes de couleur, saisies en km/h quand l'unité est une allure (min/km).
                const rangeUnit: SpeedUnit = s.speedUnit === 'minkm' ? 'kmh' : s.speedUnit;
                const fallbackRange = TREATMENT_SPEED_RANGE_MS[treatment];
                const shownRange = s.speedRange ?? fallbackRange;
                // Voile sans réglage : champs vides, les bornes suivent l'allure de chaque session.
                const rangeEmpty = sailing && s.speedRange === null;
                const displayBound = (ms: number) => parseFloat(formatSpeedValue(toDisplaySpeed(ms, rangeUnit), rangeUnit));
                const setRangeBound = (bound: 'minMs' | 'maxMs', next: number | null) => {
                  if (next === null) { setFor(id, 'speedRange', null); return; }
                  const candidate = { ...shownRange, [bound]: fromDisplaySpeed(next, rangeUnit) };
                  if (candidate.maxMs > candidate.minMs) setFor(id, 'speedRange', candidate);
                };
                // Couleur de pente de la courbe d'altitude (course, vélo), saisie en %, rangée en fraction.
                const fallbackGrades = defaultGradeRange(activity.base);
                const shownGrades = s.gradeRange ?? fallbackGrades;
                const percent = (fraction: number) => parseFloat((fraction * 100).toFixed(1));
                const setGradeBound = (bound: 'min' | 'max', next: number | null) => {
                  if (next === null) { setFor(id, 'gradeRange', null); return; }
                  const candidate = { ...shownGrades, [bound]: next / 100 };
                  if (candidate.max > candidate.min) setFor(id, 'gradeRange', candidate);
                };
                const setAutoPauseField = (field: 'speedKmh' | 'delayS', next: number | null) => {
                  if (next === null) { setFor(id, 'autoPause', null); return; }
                  setFor(id, 'autoPause', {
                    speedMs: field === 'speedKmh' ? next / 3.6 : s.autoPause.speedMs,
                    delayS: field === 'delayS' ? next : s.autoPause.delayS,
                  });
                };
                const pauseKmh = parseFloat((s.autoPause.speedMs * 3.6).toFixed(1));
                const summary = [
                  SPEED_UNIT_LABEL[s.speedUnit],
                  DISTANCE_UNIT_SYMBOL[s.distanceUnit],
                  thresholdEmpty ? "seuil selon l'allure" : `seuil ${thresholdShown} ${SPEED_UNIT_LABEL[thresholdUnit]}`,
                  s.autoPause.speedMs > 0 ? `pause sous ${pauseKmh} km/h après ${s.autoPause.delayS} s` : 'sans pause automatique',
                  ...(s.foil ? ['foil'] : []),
                  ...(s.jumps?.enabled ? ['sauts'] : []),
                  ...(treatment === 'velo' ? [BIKE_TYPES[s.bikeType].noun] : []),
                  ...(paceFamily ? [`voies : ${s.wayTypes.map((w) => WAY_TYPE_LABEL[w].toLowerCase()).join(' + ')}`] : []),
                  ...(paceFamily ? [`niveau ${PACE_LEVEL_LABEL[s.paceLevel].toLowerCase()}`] : []),
                ].join(' · ');
                return (
                  <Fragment key={id}>
                    {(k === 0 || sportFamily(familyOrdered[k - 1].base) !== family) && <FamilyHeading family={family} />}
                    <div className="settings-activity">
                      <div className="settings-activity__head">
                        <button type="button" className="settings-activity__toggle" aria-expanded={isOpen} onClick={() => toggleActivity(id)}>
                          <IconChevronRight size={14} className="settings-activity__chevron" style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
                          {!isOpen && <span className="settings-activity__dot" style={{ backgroundColor: activity.color }} />}
                          {!isOpen && <strong className="settings-activity__name">{activity.name}</strong>}
                          {!isOpen && <span className="settings-sports__mark">{p.label}</span>}
                          {!isOpen && (
                            <span className="settings-activity__summary">
                              {summary}{overridden ? ' · modifié' : ''}
                            </span>
                          )}
                        </button>
                        {isOpen && (
                          <>
                            <ActivityNameField key={activity.name} activity={activity} onRename={(name) => updateActivity(id, { name })} />
                            <span className="settings-sports__mark">{p.label}</span>
                          </>
                        )}
                      </div>
                      {isOpen && (
                        <div className="settings-activity__body">
                          <div className="settings-row" title="Couleur de l'activité dans le graphe de l'accueil et les listes, parmi les nuances de sa famille">
                            <span className="settings-row__label">Couleur</span>
                            <ShadePicker shades={FAMILY_SHADES[family]} value={activity.color} onChange={(color) => updateActivity(id, { color })}
                              label={`Couleur de ${activity.name}`} />
                          </div>
                          <div className="settings-row">
                            <span className="settings-row__label">Unité de vitesse</span>
                            <select value={s.speedUnit} onChange={(e) => setFor(id, 'speedUnit', e.target.value as SpeedUnit)} className="ui-field ui-field--s">
                              {units.map((u) => <option key={u} value={u}>{SPEED_UNIT_LABEL[u]}</option>)}
                            </select>
                          </div>
                          <div className="settings-row">
                            <span className="settings-row__label">Unité de distance</span>
                            <select value={s.distanceUnit} onChange={(e) => setFor(id, 'distanceUnit', e.target.value as DistanceUnit)} className="ui-field ui-field--s">
                              {DISTANCE_UNITS.map((u) => <option key={u} value={u}>{DISTANCE_UNIT_LABEL[u]}</option>)}
                            </select>
                          </div>
                          {s.foil !== null && (
                            <div className="settings-row" title="Support sur foil : sauts, champs « Foil » et « Mât » du matériel, « Ratio de vol ». Chaque session peut avoir le sien, dans l'onglet réglages de son analyse">
                              <span className="settings-row__label">Foil</span>
                              <label className="settings-sports__pair">
                                <input type="checkbox" checked={s.foil} onChange={(e) => setFor(id, 'foil', e.target.checked === p.foilDefault ? null : e.target.checked)} />
                                <span>Support sur foil</span>
                                {!s.isFoilOverridden && <span className="settings-sports__mark">défaut</span>}
                              </label>
                            </div>
                          )}
                          {s.jumps !== null && (
                            <JumpsSetting jumps={s.jumps} overridden={s.isJumpsOverridden} onChange={(next) => setFor(id, 'jumps', next)} />
                          )}
                          <div className="settings-row" title="Vitesse qui sépare « en action » de « à l'arrêt » : temps actif, réussite des manœuvres, VMG ; en course, temps de pause">
                            <span className="settings-row__label">Seuil d'activité</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <NumberField unit={SPEED_UNIT_LABEL[thresholdUnit]} step={thresholdUnit === 'ms' ? 0.1 : 0.5} min={0}
                                value={thresholdEmpty ? null : thresholdShown}
                                placeholder={String(thresholdShown)}
                                onCommit={setThreshold} />
                              {!s.isThresholdOverridden && (
                                <span className="settings-sports__mark">{sailing ? "selon l'allure" : 'défaut'}</span>
                              )}
                            </span>
                          </div>
                          <div className="settings-row" title="Bornes du dégradé de couleur, pour les traces qui n'ont pas les leurs">
                            <span className="settings-row__label">Couleur de trace</span>
                            <div className="settings-sports__pair">
                              <NumberField step={0.5} min={0}
                                value={rangeEmpty ? null : displayBound(shownRange.minMs)}
                                placeholder={String(displayBound(fallbackRange.minMs))}
                                onCommit={(v) => setRangeBound('minMs', v)} />
                              <span>à</span>
                              <NumberField unit={SPEED_UNIT_LABEL[rangeUnit]} step={0.5} min={0}
                                value={rangeEmpty ? null : displayBound(shownRange.maxMs)}
                                placeholder={String(displayBound(fallbackRange.maxMs))}
                                onCommit={(v) => setRangeBound('maxMs', v)} />
                              {s.speedRange === null && <span className="settings-sports__mark">{sailing ? "selon l'allure" : 'défaut'}</span>}
                            </div>
                          </div>
                          {!sailing && (
                            <div className="settings-row" title="Dégradé de la courbe d'altitude selon la raideur de la pente, montée ou descente ; gris sous la borne basse">
                              <span className="settings-row__label">Couleur de pente</span>
                              <div className="settings-sports__pair">
                                <NumberField step={1} min={0}
                                  value={s.gradeRange === null ? null : percent(shownGrades.min)}
                                  placeholder={String(percent(fallbackGrades.min))}
                                  onCommit={(v) => setGradeBound('min', v)} />
                                <span>à</span>
                                <NumberField unit="%" step={1} min={0}
                                  value={s.gradeRange === null ? null : percent(shownGrades.max)}
                                  placeholder={String(percent(fallbackGrades.max))}
                                  onCommit={(v) => setGradeBound('max', v)} />
                                {s.gradeRange === null && <span className="settings-sports__mark">défaut</span>}
                              </div>
                            </div>
                          )}
                          <div className="settings-row" title="À l'enregistrement : immobilité qui coupe la trace toute seule ; 0 km/h la désactive">
                            <span className="settings-row__label">Pause automatique</span>
                            <div className="settings-sports__pair">
                              <span className="settings-sports__mark">sous</span>
                              <NumberField unit="km/h" step={0.1} min={0}
                                value={pauseKmh}
                                onCommit={(v) => setAutoPauseField('speedKmh', v)} />
                              <span className="settings-sports__mark">pendant</span>
                              <NumberField unit="s" step={5} min={0}
                                value={s.autoPause.delayS}
                                onCommit={(v) => setAutoPauseField('delayS', v)} />
                              {!s.isAutoPauseOverridden && <span className="settings-sports__mark">défaut</span>}
                            </div>
                          </div>
                          {!sailing && (
                            <div className="settings-row" title="Lissage de l'altitude et seuil du dénivelé, dans les analyses et les itinéraires">
                              <span className="settings-row__label">Terrain</span>
                              <div className="settings-sports__pair">
                                <select value={s.terrain} onChange={(e) => setFor(id, 'terrain', e.target.value as TerrainType)} className="ui-field ui-field--s">
                                  {(Object.keys(ELEVATION_PRESETS) as TerrainType[]).map((t) => <option key={t} value={t}>{TERRAIN_LABEL[t]}</option>)}
                                </select>
                                <span className="settings-sports__mark">
                                  lissage {ELEVATION_PRESETS[s.terrain].smoothingSeconds} s, seuil de dénivelé {ELEVATION_PRESETS[s.terrain].minGainM} m
                                </span>
                              </div>
                            </div>
                          )}
                          {s.terrainStepM !== null && (
                            <div className="settings-row" title="Altitude du terrain demandée à l'IGN pour les sessions de cette activité : un point tous les … le long de la trace">
                              <span className="settings-row__label">Altitude IGN</span>
                              <div className="settings-sports__pair">
                                <span className="settings-sports__mark">un point tous les</span>
                                <select value={s.terrainStepM} onChange={(e) => setFor(id, 'terrainStepM', Number(e.target.value))} className="ui-field ui-field--s">
                                  {TERRAIN_STEP_CHOICES_M.map((m) => <option key={m} value={m}>{m} m</option>)}
                                </select>
                                {s.terrainStepM === p.terrainElevationStepM && <span className="settings-sports__mark">défaut</span>}
                              </div>
                            </div>
                          )}
                          {treatment === 'velo' && (
                            <BikeSettings view={s}
                              onBikeType={(t) => setFor(id, 'bikeType', t)}
                              onBikeWeight={(kg) => setFor(id, 'bikeWeight', kg)} />
                          )}
                          {paceFamily && (
                            <WayTypesSetting view={s} treatment={treatment} onChange={(ways) => setFor(id, 'wayTypes', ways)} />
                          )}
                          {s.loopReturnRatio !== null && (
                            <div className="settings-row"
                              title="Itinéraires en mode « Boucle » : le retour évite les voies de l'aller tant qu'il ne dépasse pas tant de fois sa longueur ; au-delà, c'est le retour le plus court">
                              <span className="settings-row__label">Retour de boucle</span>
                              <div className="settings-sports__pair">
                                <span className="settings-sports__mark">au plus</span>
                                <NumberField unit="× l'aller" step={0.1} min={LOOP_RETURN_RATIO_RANGE.min} max={LOOP_RETURN_RATIO_RANGE.max}
                                  value={s.loopReturnRatio} onCommit={(v) => setFor(id, 'loopReturnRatio', v)} />
                                {s.loopReturnRatio === p.loopReturnMaxRatio && <span className="settings-sports__mark">défaut</span>}
                              </div>
                            </div>
                          )}
                          {paceFamily && (
                            <PaceSettings family={paceFamily} view={s}
                              onLevel={(level) => setFor(id, 'paceLevel', level)}
                              onCustomSpeed={(ms) => setFor(id, 'customFlatSpeedMs', ms)} />
                          )}
                          <LiveFieldsSetting treatment={treatment} view={s} onChange={(fields) => setFor(id, 'liveFields', fields)} />
                          {sailing && (
                            <div className="settings-row" title="En navigation sur un parcours planifié : bips de plus en plus rapides à l'approche de chaque balise, bip long à la validation">
                              <span className="settings-row__label">Bips d'approche des balises</span>
                              <BeepCurveEditor value={s.markGuide} overridden={s.isMarkGuideOverridden}
                                onChange={(guide) => setFor(id, 'markGuide', guide)} />
                            </div>
                          )}
                          <div className="settings-activity__actions">
                            {overridden && (
                              <button type="button" onClick={() => resetActivity(id)} className="ui-btn ui-btn--secondary ui-btn--s">Défaut</button>
                            )}
                            <button type="button" onClick={() => askRemove(activity)} className="ui-btn ui-btn--secondary ui-btn--s">Supprimer</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <AddActivityForm activities={activities} onAdd={addAndOpen} />
            <div className="settings-block__note">
              Seuil d'activité, en voile (dans l'unité choisie) : la vitesse qui sépare « en action » de « à l'arrêt ».
              Il donne le temps et la distance actifs, dit si une manœuvre est réussie (sa vitesse la plus basse reste
              au-dessus) et ne garde que la navigation au-dessus pour la VMG. Celui d'une session, réglé dans son analyse,
              prime ; sinon celui saisi ici ; sinon il est suggéré par l'allure de la session (celui du support quand elle
              est rapide, 1 nœud quand elle est lente ou en bateau). En course, en km/h, il ne sert qu'aux temps de pause
              (reprise à seuil + 1, pause sous seuil − 1) ; à vélo de même (reprise à seuil + 1, pause sous seuil − 2).
              <br />
              Couleur de trace : gris sous la borne lente, dégradé du bleu au rouge jusqu'à la borne rapide. En voile, sans
              réglage, les bornes suivent l'allure de chaque session. Une trace peut avoir les siennes, réglées depuis sa
              légende : elles ne changent qu'elle et priment sur celles-ci.
              <br />
              Temps estimé des itinéraires : le niveau donne la vitesse sur le plat. En course, chaque 100 m de D+ compte
              comme 1 km de plus (règle du km-effort). À vélo, en montée, la puissance que tient un cycliste de ce niveau, en
              watts par kilo de votre poids (bloc Pratiquant) ; en descente, la roue libre, jamais moins vite que sur le
              plat, plafonnée selon le type de vélo. Le type de vélo, c'est-à-dire ses pneus et la position, fixe la
              résistance au roulement sur chaque revêtement et la prise au vent ; avec son poids et le vôtre, ils donnent la
              puissance et l'énergie de l'analyse, selon le revêtement des voies suivies (OpenStreetMap). Le temps estimé
              et l'enregistrement en direct prennent son roulement moyen.
            </div>
          </>
        )}
      </div>

      <div style={cardStyle}>
        <PanelTitle label="Enregistrement" open={open.enregistrement} onToggle={() => toggle('enregistrement')} />
        {open.enregistrement && (
          <>
            <p className="settings-block__intro">
              Pendant un enregistrement, tenir le bouton rond de la barre du bas met en pause ou relance, depuis n'importe
              quelle page. Un appui court ouvre la page d'enregistrement. La pause automatique se règle par activité, comme
              les chiffres affichés en grand quand la carte est réduite.
            </p>
            <NumberField label="Appui long pour la pause" unit="s" step={0.5} min={0.5} max={10}
              value={longPressMs / 1000}
              onCommit={(v) => setLongPressMs(v === null ? null : Math.round(v * 1000))} />
          </>
        )}
      </div>

      <div style={cardStyle}>
        <PanelTitle label="Barre du bas" open={open.navigation} onToggle={() => toggle('navigation')} />
        {open.navigation && (
          <>
            <p className="settings-block__intro">
              Sur téléphone, deux sports s'ouvrent directement depuis la barre du bas : le favori à gauche du bouton rond,
              le secondaire à sa droite. Tenir le sport secondaire déplie le menu des autres sports : celui qu'on y choisit
              devient le sport secondaire.
            </p>
            <div className="settings-row">
              <span className="settings-row__label">Sport favori</span>
              <select value={navFamily} onChange={(e) => setNavFamily(e.target.value as SportFamily)} className="ui-field ui-field--s">
                {SPORT_FAMILIES.map((f) => <option key={f} value={f}>{FAMILY_LABEL[f]}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Sport secondaire</span>
              <select value={navSecondFamily} onChange={(e) => setNavSecondFamily(e.target.value as SportFamily)} className="ui-field ui-field--s">
                {SPORT_FAMILIES.filter((f) => f !== navFamily).map((f) => <option key={f} value={f}>{FAMILY_LABEL[f]}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Appui long pour changer de sport</span>
              <NumberField unit="s" step={0.5} min={0.5} max={10}
                value={navHoldMs / 1000}
                onCommit={(v) => setNavHoldMs(v === null ? null : Math.round(v * 1000))} />
            </div>
          </>
        )}
      </div>

      <div style={cardStyle}>
        <PanelTitle label="Cartes hors ligne" open={open.cartes} onToggle={() => toggle('cartes')} />
        {open.cartes && <OfflineMapsSettings />}
      </div>

      <div style={cardStyle}>
        <PanelTitle label="Pratiquant" open={open.coureur} onToggle={() => toggle('coureur')} />
        {open.coureur && (
          <>
            <p className="settings-block__intro">
              Ces caractéristiques servent à l'onglet énergie des analyses de course et de vélo, et serviront aux zones d'effort. Tout est facultatif.
            </p>
            <NumberField label="Poids" unit="kg" step={0.5} min={20} max={300} value={profile.weightKg} onCommit={profileField('weightKg')} placeholder="ex. 72" />
            <NumberField label="Taille" unit="cm" min={100} max={250} value={profile.heightCm} onCommit={profileField('heightCm')} placeholder="ex. 178" />
            <NumberField label="Année de naissance" unit={age !== null ? `${age} ans` : undefined} min={1900} max={2100} value={profile.birthYear} onCommit={profileField('birthYear')} placeholder="ex. 1985" />
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '14px' }}>
              <span style={{ width: '190px' }}>Sexe</span>
              <select value={profile.sex ?? ''} onChange={(e) => setSex(e.target.value === '' ? null : (e.target.value as 'f' | 'm'))} className="ui-field ui-field--s">
                <option value="">Non renseigné</option>
                <option value="f">Femme</option>
                <option value="m">Homme</option>
              </select>
            </label>
            <NumberField label="Fréquence cardiaque max" unit="bpm" min={100} max={250} value={profile.hrMax} onCommit={profileField('hrMax')} placeholder="ex. 185" />
            <NumberField label="Fréquence cardiaque de repos" unit="bpm" min={25} max={120} value={profile.hrRest} onCommit={profileField('hrRest')} placeholder="ex. 55" />
            <NumberField label="Économie de course" unit="ml O₂/kg/km" min={120} max={320} value={profile.economyMlKgKm} onCommit={profileField('economyMlKgKm')} placeholder="200" />
            <p className="settings-block__intro">
              Oxygène consommé pour courir un kilomètre sur le plat, que donne un test d'effort en laboratoire. Sans valeur, 200 ml/kg/km : environ 1 kcal par kilo et par kilomètre.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Chiffres en grand de l'enregistrement quand la carte est réduite, de haut
 * en bas : un menu par ligne, le premier toujours rempli. Un chiffre déjà
 * placé n'est pas proposé ailleurs. La liste est rangée sans trou ; revenue
 * au défaut du traitement, elle est effacée.
 */
function LiveFieldsSetting({ treatment, view, onChange }: {
  treatment: Treatment;
  view: SportSettingsView;
  onChange: (fields: LiveFieldKey[] | null) => void;
}) {
  const options = liveFieldsOfTreatment(treatment);
  const units = { speedUnit: view.speedUnit, distanceUnit: view.distanceUnit };
  const slots = Array.from({ length: MAX_LIVE_FIELDS }, (_, i) => view.liveFields[i] ?? null);
  const pick = (slot: number, key: LiveFieldKey | null) => {
    const next = slots.map((k, i) => (i === slot ? key : k)).filter((k): k is LiveFieldKey => k !== null);
    const defaults = DEFAULT_LIVE_FIELDS[treatment];
    const isDefault = next.length === defaults.length && next.every((k, i) => k === defaults[i]);
    onChange(isDefault ? null : next);
  };
  return (
    <div className="settings-row" title="À l'enregistrement, quand la carte est réduite : les chiffres affichés en grand, de haut en bas">
      <span className="settings-row__label">Carte réduite à l'enregistrement</span>
      <div className="settings-sports__pair">
        {slots.map((key, i) => (
          <select key={i} value={key ?? ''} aria-label={`Ligne ${i + 1}`} className="ui-field ui-field--s"
            onChange={(e) => pick(i, e.target.value === '' ? null : (e.target.value as LiveFieldKey))}>
            {i > 0 && <option value="">—</option>}
            {options.map((k) => (
              <option key={k} value={k} disabled={k !== key && slots.includes(k)}>{liveFieldLabel(k, units)}</option>
            ))}
          </select>
        ))}
        {!view.isLiveFieldsOverridden && <span className="settings-sports__mark">défaut</span>}
      </div>
    </div>
  );
}

/** Vitesse en km/h, sans décimale inutile. */
const kmhLabel = (ms: number): string => `${parseFloat((ms * 3.6).toFixed(1))} km/h`;

/** Ce que donne une vitesse sur le plat : l'allure en course, la puissance de montée à vélo. */
const paceDetail = (family: PlanningFamily, speedMs: number, climbWkg?: number): string =>
  family === 'course'
    ? `${kmhLabel(speedMs)}, ${formatPace(speedMs)} /km`
    : `${kmhLabel(speedMs)}, ${parseFloat((climbWkg ?? climbPowerWkgForFlatSpeed(speedMs)).toFixed(1))} W/kg en montée`;

/**
 * Niveau du temps estimé des itinéraires d'une activité, dans sa carte : un
 * des niveaux, chacun avec sa vitesse, ou « Personnalisé » et une vitesse
 * saisie en km/h.
 */
function PaceSettings({ family, view, onLevel, onCustomSpeed }: {
  family: PlanningFamily;
  view: SportSettingsView;
  onLevel: (level: PaceLevel) => void;
  onCustomSpeed: (speedMs: number | null) => void;
}) {
  const [lo, hi] = CUSTOM_FLAT_SPEED_BOUNDS_MS[family];
  const custom = view.customFlatSpeedMs;
  return (
    <>
      <div className="settings-row" title="Vitesse du temps estimé des itinéraires, sur le plat (voir la note sous la liste)">
        <span className="settings-row__label">Niveau (temps estimé)</span>
        <select value={view.paceLevel} onChange={(e) => isPaceLevel(e.target.value) && onLevel(e.target.value)} className="ui-field ui-field--s">
          {PACE_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level === 'perso'
                ? PACE_LEVEL_LABEL.perso
                : `${PACE_LEVEL_LABEL[level]} · ${paceDetail(family, LEVEL_FLAT_SPEED_MS[family][level], family === 'velo' ? LEVEL_CLIMB_POWER_WKG[level] : undefined)}`}
            </option>
          ))}
        </select>
      </div>
      {view.paceLevel === 'perso' && (
        <div className="settings-row">
          <span className="settings-row__label">Vitesse sur le plat</span>
          <div className="settings-sports__pair">
            <NumberField unit="km/h" step={0.5}
              min={parseFloat((lo * 3.6).toFixed(1))} max={parseFloat((hi * 3.6).toFixed(1))}
              value={custom === null ? null : parseFloat((custom * 3.6).toFixed(1))}
              onCommit={(kmh) => onCustomSpeed(kmh === null ? null : kmh / 3.6)} />
            <span className="settings-sports__mark">
              {custom === null ? 'sans vitesse saisie, le niveau moyen' : `soit ${paceDetail(family, custom)}`}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

/** En-tête d'une famille dans la liste des activités, comme dans le choix d'une activité. */
function FamilyHeading({ family }: { family: SportFamily }) {
  const Icon = FAMILY_ICON[family];
  return (
    <div className="settings-activities__family" style={{ color: FAMILY_ACCENT[family] }}>
      <Icon size={18} />
      {FAMILY_LABEL[family]}
    </div>
  );
}

/** Type et poids du vélo d'une activité de vélo, dans sa carte. */
function BikeSettings({ view, onBikeType, onBikeWeight }: {
  view: SportSettingsView;
  onBikeType: (type: BikeType) => void;
  onBikeWeight: (kg: number | null) => void;
}) {
  const spec = BIKE_TYPES[view.bikeType];
  return (
    <>
      <div className="settings-row"
        title="Pneus et position : roulement selon le revêtement pour la puissance et l'énergie des sessions, roulement moyen pour le direct et le temps estimé ; prise au vent">
        <span className="settings-row__label">Type de vélo</span>
        <div className="settings-sports__pair">
          <select value={view.bikeType} onChange={(e) => onBikeType(e.target.value as BikeType)} className="ui-field ui-field--s">
            {(Object.keys(BIKE_TYPES) as BikeType[]).map((t) => <option key={t} value={t}>{BIKE_TYPES[t].label}</option>)}
          </select>
          <span className="settings-sports__mark">
            roulement {formatCrr(spec.crrBySurface.asphalte ?? spec.crr)} sur asphalte, {formatCrr(spec.crrBySurface.terre ?? spec.crr)} sur terre
            (moyen {formatCrr(spec.crr)}), traînée {formatCrr(spec.cdaM2)} m²
          </span>
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-row__label">Poids du vélo</span>
        <NumberField unit="kg" step={0.5} min={3} max={60}
          value={view.bikeWeight} placeholder={String(spec.bikeKg)} onCommit={onBikeWeight} />
      </div>
    </>
  );
}

/**
 * Nom d'une activité, après sa pastille de couleur (choisie dans la ligne
 * « Couleur »). Le nom s'enregistre en quittant le champ ou sur Entrée ;
 * vide, il revient au précédent. Le parent le remonte (clé : le nom) quand le
 * nom enregistré change, ce qui remet le brouillon à jour.
 */
function ActivityNameField({
  activity, onRename,
}: {
  activity: Activity;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(activity.name);
  const commit = () => {
    if (draft.trim() === '') setDraft(activity.name);
    else if (draft.trim() !== activity.name) onRename(draft);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span className="settings-activity__dot" style={{ backgroundColor: activity.color }} />
      <input value={draft} maxLength={40} aria-label="Nom de l'activité" className="ui-field ui-field--s"
        style={{ width: '120px', fontWeight: 600 }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </span>
  );
}

/** Ajout d'une activité : nom, famille, calcul (en voile et en fractionné), nuance de la famille. */
function AddActivityForm({
  activities, onAdd,
}: {
  activities: Activity[];
  onAdd: (name: string, base: SportType, color: string) => string | null;
}) {
  const [name, setName] = useState('');
  const [family, setFamily] = useState<SportFamily>('voile');
  const [base, setBase] = useState<SportType>(familySports('voile')[0]);
  const [color, setColor] = useState(() => nextActivityColor(activities, 'voile'));
  const pickFamily = (next: SportFamily) => {
    setFamily(next);
    setBase(familySports(next)[0]);
    setColor(nextActivityColor(activities, next));
  };
  const submit = () => {
    if (onAdd(name, base, color) === null) return;
    setName('');
    setColor(nextActivityColor([...activities, { id: '', name, base, color }], family));
  };
  return (
    <div className="settings-add">
      <strong className="settings-add__title">Ajouter une activité</strong>
      <input value={name} maxLength={40} placeholder="Nom, ex. Moth à foil" aria-label="Nom de la nouvelle activité"
        className="ui-field ui-field--s" style={{ width: '180px' }}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      <select value={family} onChange={(e) => pickFamily(e.target.value as SportFamily)} aria-label="Famille" className="ui-field ui-field--s">
        {SPORT_FAMILIES.map((f) => <option key={f} value={f}>{FAMILY_LABEL[f]}</option>)}
      </select>
      {familySports(family).length > 1 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: 'var(--muted)', fontSize: '12px' }}>calcul</span>
          <select value={base} onChange={(e) => setBase(e.target.value as SportType)} className="ui-field ui-field--s">
            {familySports(family).map((b) => <option key={b} value={b}>{SPORT_PROFILES[b].label}</option>)}
          </select>
        </label>
      )}
      <ShadePicker shades={FAMILY_SHADES[family]} value={color} onChange={setColor} label="Couleur de la nouvelle activité" />
      <button onClick={submit} disabled={name.trim() === ''} className="ui-btn ui-btn--secondary ui-btn--s">Ajouter</button>
    </div>
  );
}

/**
 * Cartes gardées sur l'appareil : place occupée, plafond, vidage. Monté
 * seulement bloc ouvert, parce que compter les tuiles lit tout leur dossier.
 */
function OfflineMapsSettings() {
  const { usage, capMb, setCapMb, clear } = useTileCache();
  const choices = TILE_CAP_CHOICES_MB.includes(capMb) ? TILE_CAP_CHOICES_MB : [...TILE_CAP_CHOICES_MB, capMb].sort((a, b) => a - b);

  const askClear = () => {
    if (window.confirm("Effacer toutes les cartes gardées sur cet appareil ? Sans réseau, les cartes resteront vides jusqu'à ce qu'elles soient revues en ligne.")) {
      void clear();
    }
  };

  return (
    <>
      <p className="settings-block__intro">
        Chaque morceau de carte affiché avec le réseau est gardé sur cet appareil et reste visible sans réseau, en mer
        par exemple. Pour préparer une sortie, parcourez la zone en ligne, une fois de loin et une fois de près : sans
        réseau, on peut encore zoomer de trois crans au-delà, en image agrandie. Les plus anciens morceaux sont effacés
        au-delà du plafond.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '14px' }}>
        <span style={{ width: '190px' }}>Place occupée</span>
        <span className="num">
          {usage === null ? '…' : `${(usage.bytes / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo (${usage.tiles.toLocaleString('fr-FR')} morceaux)`}
        </span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '14px' }}>
        <span style={{ width: '190px' }}>Plafond</span>
        <select value={capMb} onChange={(e) => void setCapMb(Number(e.target.value))} className="ui-field ui-field--s">
          {choices.map((mb) => <option key={mb} value={mb}>{mb >= 1000 ? `${mb / 1000} Go` : `${mb} Mo`}</option>)}
        </select>
      </label>
      <button type="button" onClick={askClear} disabled={usage?.tiles === 0} className="ui-btn ui-btn--secondary ui-btn--s">
        Vider
      </button>
    </>
  );
}

export default SettingsPage;
