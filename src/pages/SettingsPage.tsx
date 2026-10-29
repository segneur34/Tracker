import { Fragment, useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type ReactNode } from 'react';
import {
  FAMILY_ACCENT, FAMILY_LABEL, FAMILY_SHADES, activitiesOfFamily, activityFamily, isFamilyHidden, nextActivityColor, visibleActivities, visibleFamilies,
  type Activity,
} from '../core/activities';
import {
  LOOP_RETURN_RATIO_RANGE, SPORT_FAMILIES, SPORT_PROFILES, TERRAIN_STEP_CHOICES_M, familySports, hasActiveThreshold, hasPositions, isLandTreatment, sportFamily,
  sportTreatment, usesMarkCourse,
  type SportFamily, type SportProfile, type Treatment,
} from '../core/sportProfiles';
import { analysisTabs, isTabShown, toggleTabChoice, type TabChoices } from '../core/analysisTabs';
import type { SportType } from '../core/types';
import {
  DISTANCE_UNIT_LABEL, DISTANCE_UNIT_SYMBOL, SPEED_UNIT_LABEL, speedUnitLabel, speedUnitSymbol, editSpeedUnit, formatPace, formatSpeedValue, fromDisplaySpeed, kmhToMs, msToKmh, toDisplaySpeed,
  type DistanceUnit, type SpeedUnit,
} from '../core/units';
import { useFavoriteBackdrop } from '../hooks/useFavoriteBackdrop';
import { useOpenSections } from '../hooks/useOpenSections';
import { useTileCache } from '../hooks/useTileCache';
import { useThemedShade, useThemeSettings } from '../hooks/useTheme';
import { THEME_CHOICES } from '../theme/theme';
import { RUNNER_NAME_MAX, runnerHeartRateZones, runnerHrSource, useRunnerProfile, type RunnerNumberField, type RunnerProfile } from '../hooks/useRunnerProfile';
import { ROOT_GOAL } from '../library/rootGrowth';
import { zoneLabel } from '../components/heartRateColors';
import { hrSourceLabel } from '../components/heartRateOrigin';
import Button from '../components/ui/Button';
import MoreMenu from '../components/ui/MoreMenu';
import SegmentedControl from '../components/ui/SegmentedControl';
import { playPattern, setBeepPitch, type ClockTone } from '../platform/beeper';
import { BEEP_SOUNDS, beepSoundHz } from '../recording/beepSound';
import {
  DEFAULT_GEAR_LABELS, HR_OFFSET_RANGE, MAX_GEAR_LABEL_LENGTH, TREATMENT_UNITS, defaultBikeKg, defaultBikeType, defaultEnergyModelOf, defaultLiveFieldsFor, defaultMarkGuideOf,
  defaultNotificationFieldsFor, defaultPaceOf, defaultSpeedRangeOf, defaultFoil, defaultGradeRange, defaultHrOffsetOf, defaultTerrainStepOf, planningFamily,
  rangeFollowsPace, sanitizeGearLabels, thresholdFollowsPace, useAllSportSettings, type GearGroup, type SportSettingsView,
} from '../hooks/useSportSettings';
import GearGroupsEditor from '../components/GearGroupsEditor';
import { plural } from '../core/basics';
import { BIKE_TYPES, formatCrr, type BikeType } from '../cycling/energy';
import type { EnergyModel } from '../running/energy';
import {
  MAX_LIVE_FIELDS, MAX_NOTIFICATION_FIELDS, liveFieldLabel, liveFieldsOfTreatment,
  type LiveFieldKey, type LiveFieldTarget, type LiveFieldUnits,
} from '../recording/liveFields';
import { simulatedApproachMs } from '../recording/markGuide';
import {
  CUSTOM_FLAT_SPEED_BOUNDS_MS, LEVEL_CLIMB_POWER_WKG, LEVEL_FLAT_SPEED_MS, PACE_LEVELS, PACE_LEVEL_LABEL,
  climbPowerWkgForFlatSpeed, isPaceLevel, type PaceLevel, type PlanningFamily,
} from '../planning/duration';
import type { WayType } from '../planning/brouterProfile';
import { WAY_TYPE_LABEL } from '../planning/route';
import BeepCurveEditor from '../components/BeepCurveEditor';
import HeartRateBeltSettings from '../components/HeartRateBeltSettings';
import { CARD_STYLE } from '../components/styles';
import { FAMILY_ICON } from '../components/familyIcons';
import { IconChevronRight, IconEye, IconEyeOff } from '../components/icons';
import MemoryStatus from '../components/MemoryStatus';
import PageBackdrop from '../components/PageBackdrop';
import { PermissionsSettings } from '../components/PermissionsStatus';
import PanelTitle from '../components/PanelTitle';
import ShadePicker from '../components/ShadePicker';
import ActivityIcon from '../components/ActivityIcon';
import IconPicker from '../components/IconPicker';
import { activityIcon, guessActivityIcon, type ActivityIconId } from '../core/activityIcons';
import WayTypeTabs from '../components/WayTypeTabs';
import {
  JUMP_MIN_HEIGHT_RANGE, JUMP_PLACEMENTS, JUMP_PLACEMENT_LABEL, type JumpPlacement, type JumpSettings,
} from '../recording/jumpSettings';
import PageHeader from '../components/ui/PageHeader';
import { HelpText, HelpToggle, SettingRow, SettingsScope } from '../components/Help';
import { useHelpCollapseAll } from '../components/helpContext';
import './settingsPage.css';

/**
 * Sauts mesurés par les capteurs du téléphone (voile sauf bateau, course, vélo) : la case,
 * puis, cochée, l'emplacement du téléphone et la hauteur minimale montrée. Le
 * foil, juste au-dessus, est un réglage de l'activité à part entière.
 */
function JumpsSetting({ id, jumps, overridden, onChange }: {
  /** Identifiant de l'activité, qui préfixe les clés des aides. */
  id: string;
  jumps: JumpSettings;
  overridden: boolean;
  onChange: (next: JumpSettings) => void;
}) {
  return (
    <>
      <SettingRow label="Sauts" helpKey={`${id}:sauts`}
        help="Hauteur des sauts, par les capteurs du téléphone fixé au corps ; proposée à chaque enregistrement.">
        <label className="settings-sports__pair">
          <input type="checkbox" checked={jumps.enabled} onChange={(e) => onChange({ ...jumps, enabled: e.target.checked })} />
          <span>Mesurer les sauts</span>
          {!overridden && <span className="settings-sports__mark">défaut</span>}
        </label>
      </SettingRow>
      {jumps.enabled && (
        <>
          <SettingRow sub label="Emplacement du téléphone" helpKey={`${id}:sauts-emplacement`}
            help="Où il est fixé : la poitrine est conseillée ; le bras et le dos sont moins précis.">
            <select value={jumps.placement} className="ui-field ui-field--s"
              onChange={(e) => onChange({ ...jumps, placement: e.target.value as JumpPlacement })}>
              {JUMP_PLACEMENTS.map((p) => <option key={p} value={p}>{JUMP_PLACEMENT_LABEL[p]}</option>)}
            </select>
          </SettingRow>
          <SettingRow sub label="Hauteur minimale" helpKey={`${id}:sauts-hauteur`}
            help="Les sauts plus bas ne sont pas montrés ; tous restent mesurés.">
            <NumberField unit="m" step={0.1} min={JUMP_MIN_HEIGHT_RANGE.min} max={JUMP_MIN_HEIGHT_RANGE.max}
              value={jumps.minHeightM}
              onCommit={(v) => { if (v !== null && v >= JUMP_MIN_HEIGHT_RANGE.min && v <= JUMP_MIN_HEIGHT_RANGE.max) onChange({ ...jumps, minHeightM: v }); }} />
          </SettingRow>
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
    <SettingRow label="Types de voie" helpKey={`${view.activity.id}:voies`}
      help="Cochés d'office quand on planifie avec cette activité ; ils se changent ensuite pour chaque itinéraire.">
      <div className="settings-sports__pair">
        <WayTypeTabs compact checked={view.wayTypes} onToggle={toggle} label={`Types de voie de ${view.activity.name}`}
          style={{ '--tab-accent': FAMILY_ACCENT[activityFamily(view.activity)] } as CSSProperties} />
        {!view.isWayTypesOverridden && (
          <span className="settings-sports__mark">{treatment === 'velo' ? 'selon le vélo' : 'selon le terrain'}</span>
        )}
      </div>
    </SettingRow>
  );
}

/**
 * Onglets des analyses de l'activité : enfoncé, montré. Ceux du module le sont
 * d'office, un onglet générique (« tops » à pied et en surf) ne l'est qu'une
 * fois coché ; tous se cachent. « vols » n'est proposé que sur foil.
 */
function AnalysisTabsSetting({ view, profile, onChange }: {
  view: SportSettingsView;
  profile: SportProfile;
  onChange: (choices: TabChoices | null) => void;
}) {
  const tabs = analysisTabs(profile).filter((tab) => tab.key !== 'vols' || view.foil === true);
  return (
    <SettingRow label="Onglets" helpKey={`${view.activity.id}:onglets`}
      help="Enfoncé : montré dans les analyses. Ceux venus d'un autre module (« tops ») sont cachés d'office ; sans « réglages », l'activité et le seuil d'une session ne se changent plus depuis son analyse.">
      <div className="settings-sports__pair">
        <div className="ui-tabs ui-tabs--compact" role="group" aria-label={`Onglets des analyses de ${view.activity.name}`}
          style={{ '--tab-accent': FAMILY_ACCENT[activityFamily(view.activity)] } as CSSProperties}>
          {tabs.map((tab) => (
            <button key={tab.key} type="button" className="ui-tab" aria-pressed={isTabShown(tab, view.tabs)}
              onClick={() => onChange(toggleTabChoice(view.tabs, tab))}>
              {tab.label}
            </button>
          ))}
        </div>
        {!view.isTabsOverridden && <span className="settings-sports__mark">défaut</span>}
      </div>
    </SettingRow>
  );
}

/**
 * Partie repliable d'une carte d'activité (affichage, analyse, enregistrement…) :
 * une carte ouverte pour changer un nom reste courte.
 */
function ActivityPart({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="settings-part">
      <button type="button" className="settings-part__toggle" aria-expanded={open} onClick={onToggle}>
        <IconChevronRight size={14} className="settings-activity__chevron" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
        {label}
      </button>
      {open && <div className="settings-part__body">{children}</div>}
    </div>
  );
}

const cardStyle = { ...CARD_STYLE, marginBottom: '15px' } as const;

/** Blocs repliables de la page, tous fermés au départ ; l'état est mémorisé. */
type SettingsBlock = 'memoire' | 'autorisations' | 'activites' | 'enregistrement' | 'capteurs' | 'affichage' | 'cartes' | 'coureur';
const SETTINGS_BLOCK_DEFAULTS: Record<SettingsBlock, boolean> = {
  memoire: false, autorisations: false, activites: false, enregistrement: false, capteurs: false, affichage: false, cartes: false,
  coureur: false,
};
/** Plafonds proposés pour les cartes gardées, en Mo : une liste plutôt qu'un champ, qui effacerait des tuiles à chaque chiffre tapé. */
const TILE_CAP_CHOICES_MB = [100, 250, 500, 1000, 2000, 5000];
/** « Écouter » le son des bips : le signal d'un changement de phase du compteur, court, court, long, une seconde entre deux. */
const LISTEN_PATTERN: ClockTone[] = [{ delayMs: 0, tone: 'court' }, { delayMs: 1000, tone: 'court' }, { delayMs: 2000, tone: 'long' }];
const DISTANCE_UNITS = Object.keys(DISTANCE_UNIT_LABEL) as DistanceUnit[];
/** Modèles de dépense à pied (réglage « Dépense »). */
const ENERGY_MODEL_CHOICES: { key: EnergyModel; label: string }[] = [{ key: 'course', label: 'Course' }, { key: 'marche', label: 'Marche' }];
/** Activités ouvertes, par identifiant ; absente : fermée. */
const NO_ACTIVITY_OPEN: Record<string, boolean> = {};
/** Parties d'une carte d'activité, toutes fermées au départ ; l'état, mémorisé, vaut pour toutes les activités. */
// La notification est une sous-partie d'Enregistrement (19/10) ; la clé « itineraires » garde son nom pour l'état mémorisé.
type ActivityPartKey = 'affichage' | 'analyse' | 'materiel' | 'enregistrement' | 'itineraires' | 'balises';
const ACTIVITY_PART_DEFAULTS: Record<ActivityPartKey, boolean> = {
  affichage: false, analyse: false, materiel: false, enregistrement: false, itineraires: false, balises: false,
};
/** Familles de la liste des activités, toutes repliées au départ ; plusieurs s'ouvrent à la fois, l'état est mémorisé. */
const FAMILY_OPEN_DEFAULTS = Object.fromEntries(SPORT_FAMILIES.map((f) => [f, false])) as Record<SportFamily, boolean>;

/**
 * Champ numérique optionnel, en `type="number"` avec flèches ↕, même
 * principe que le seuil d'activité du module voile : la valeur s'applique
 * immédiatement. L'affichage suit un brouillon local tant que le champ a le
 * focus, pour ne pas effacer une frappe en cours (valeur hors bornes en
 * cours de saisie, "." d'un décimal) quand un commit sans effet redéclenche
 * un rendu ; à la sortie du champ, le brouillon revient à la valeur commise.
 */
function NumberField({
  label, help, helpKey, unit, value, onCommit, placeholder, step = 1, min, max,
}: {
  label?: string;
  /** Aide du champ à libellé, sous son « ? » (`helpKey` : sa clé). */
  help?: ReactNode;
  helpKey?: string;
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

  const field = (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: label ? '8px' : 0, fontSize: 'var(--text-s)' }}>
      {label && <span style={{ width: '190px' }}>{label}{helpKey && <HelpToggle helpKey={helpKey} label={label} />}</span>}
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
  if (!helpKey) return field;
  return (
    <>
      {field}
      <HelpText helpKey={helpKey}>{help}</HelpText>
    </>
  );
}

/** Seuils et zones de Pratiquant : ceux de la course, sans décalage (chaque activité décale les siens). */
const RUNNING_HEART_RATE = SPORT_PROFILES.running.heartRate;

const pct = (f: number): string => `${Math.round(f * 100)} %`;

/**
 * Seuils cardio du pratiquant, dans « Pratiquant » : S1 et S2 calculés
 * d'office (réserve cardiaque, sinon FC max, estimée par l'âge s'il le faut),
 * ou saisis à la main ; puis les zones calées dessus.
 */
function HeartRateThresholdsField({ profile, onChange }: { profile: RunnerProfile; onChange: (thresholds: number[] | null) => void }) {
  const zones = runnerHeartRateZones(profile, RUNNING_HEART_RATE, 0);
  const entered = zones?.method === 'saisis' ? zones : null;
  const model = RUNNING_HEART_RATE.zoneModel;
  const method = zones === null ? null
    : zones.method === 'saisis' ? 'S1 et S2 saisis, S2 au-dessus de S1 (test en laboratoire, par exemple).'
      : zones.method === 'reserve'
        ? `S1 à ${pct(model.reserveThresholds[0])} et S2 à ${pct(model.reserveThresholds[1])} de la réserve cardiaque, de la FC repos à la FC max${zones.estimated ? ` (estimée par l'âge : ${zones.hrMax} bpm)` : ''}.`
        : `Sans FC repos : S1 à ${pct(model.maxThresholds[0])} et S2 à ${pct(model.maxThresholds[1])} de la FC max${zones.estimated ? ` (estimée par l'âge : ${zones.hrMax} bpm)` : ''} ; avec elle, ils suivraient la réserve cardiaque, plus juste.`;
  return (
    <div style={{ marginBottom: '8px', fontSize: 'var(--text-s)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <span style={{ width: '190px' }}>Seuils cardio<HelpToggle helpKey="pratiquant:zones" label="Seuils cardio" /></span>
        {zones ? (
          <>
            <span><strong>S1</strong> {zones.s1} · <strong>S2</strong> {zones.s2} bpm</span>
            {entered
              ? <Button size="s" onClick={() => onChange(null)}>Revenir au calcul</Button>
              : <Button size="s" onClick={() => onChange([zones.s1, zones.s2])}>Personnaliser</Button>}
          </>
        ) : (
          <span style={{ color: 'var(--muted)' }}>FC max ou année de naissance à saisir</span>
        )}
      </div>
      {entered && (
        <>
          <NumberField label="S1, seuil aérobie" unit="bpm" min={60} max={230} value={entered.s1}
            onCommit={(next) => { if (next !== null) onChange([next, entered.s2]); }} />
          <NumberField label="S2, seuil anaérobie" unit="bpm" min={60} max={230} value={entered.s2}
            onCommit={(next) => { if (next !== null) onChange([entered.s1, next]); }} />
        </>
      )}
      {zones && (
        <div style={{ color: 'var(--muted)', marginBottom: '6px' }}>
          Zones : {zones.bounds.map((b, k) => (
            <span key={k}>{k > 0 && ' · '}<strong>{zoneLabel(k + 1)}</strong> ≥ {b}</span>
          ))}
        </div>
      )}
      <HelpText helpKey="pratiquant:zones">
        {method
          ? <>{method} Les zones sont calées dessus : Z1 et Z2 sous S1, Z3 commence à S1, Z4 aux deux tiers de S1 à S2, Z5 juste
            au-dessus de S2. Ces valeurs sont celles de la course ; chaque activité les décale (sa carte, partie « onglet analyse »).</>
          : "Pas de zones : l'onglet cardio montre la courbe et la FC moyenne seulement."}
      </HelpText>
    </div>
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
  const backdrop = useFavoriteBackdrop();
  const {
    activities, view, setFor, resetActivity, addActivity, updateActivity, removeActivity, longPressMs, setLongPressMs,
    stopHoldMs, setStopHoldMs, beepSound, setBeepSound, hiddenFamilies, setActivityHidden, setFamilyHidden,
  } = useAllSportSettings();
  const { profile, setName, setNumber, setSex, setThresholds, age } = useRunnerProfile();
  const shown = useThemedShade();
  const { open, toggle, closeAll: closeBlocks } = useOpenSections<SettingsBlock>('settings', SETTINGS_BLOCK_DEFAULTS);
  const { open: openActivity, toggle: toggleActivity, closeAll: closeActivities } = useOpenSections<string>('settings-activities', NO_ACTIVITY_OPEN);
  const { open: openPart, toggle: togglePart, closeAll: closeParts } = useOpenSections<ActivityPartKey>('settings-activity-parts', ACTIVITY_PART_DEFAULTS);
  const { open: openFamily, toggle: toggleFamily, closeAll: closeFamilies } = useOpenSections<SportFamily>('settings-families', FAMILY_OPEN_DEFAULTS);
  /** Activité dont le nom est en cours de saisie (« Renommer »), carte ouverte ; une seule à la fois. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** « Tout réduire » : blocs, familles, activités et leurs parties (les aides et le choix d'icône, par `CollapseAllButton`). */
  const collapseAll = () => {
    closeBlocks();
    closeFamilies();
    closeActivities();
    closeParts();
    setRenaming(null);
  };
  /**
   * Activités rangées par famille (Voile, À pied, Vélo, Fractionné, Surf), chacune dans l'ordre de
   * la liste, les cachées en bas de leur famille (§10, point 100).
   */
  const familyOrdered = SPORT_FAMILIES.flatMap((f) => {
    const own = activitiesOfFamily(activities, f);
    return [...own.filter((a) => !a.hidden), ...own.filter((a) => a.hidden)];
  });
  /** Familles visibles, proposées pour la barre du bas. */
  const shownFamilies = visibleFamilies(activities, hiddenFamilies);
  /** Il reste toujours une famille visible, et une activité visible : leur œil ne se ferme pas. */
  const lastFamily = shownFamilies.length <= 1;
  const lastActivity = visibleActivities(activities, hiddenFamilies).length <= 1;

  /** Case « Créer liste matériel » : cochée, une liste vide, éditée en ligne dessous ; décochée, la liste effacée, après confirmation si elle n'est pas vide. */
  const toggleGear = (a: Activity, groups: GearGroup[] | null, on: boolean) => {
    if (on) {
      if (groups === null) setFor(a.id, 'gearGroups', []);
      return;
    }
    const pieces = groups?.reduce((n, g) => n + g.items.length, 0) ?? 0;
    if (groups && groups.length > 0
      && !window.confirm(`Couper le matériel enregistré de « ${a.name} » ? Sa liste (${plural(groups.length, 'groupe')}, ${plural(pieces, 'pièce')}) est effacée ; les sessions gardent le matériel choisi.`)) {
      return;
    }
    setFor(a.id, 'gearGroups', null);
  };

  const askRemove = (a: Activity) => {
    if (window.confirm(`Supprimer l'activité « ${a.name} » ? Ses sessions restent, rangées sous « ${SPORT_PROFILES[a.base].label} », et ses réglages sont effacés.`)) {
      removeActivity(a.id);
    }
  };

  /** Une activité ajoutée s'ouvre, sa famille aussi, pour la régler aussitôt. */
  const addAndOpen = (name: string, base: SportType, color: string, icon?: ActivityIconId): string | null => {
    const id = addActivity(name, base, color, icon);
    if (id === null) return null;
    if (!openActivity[id]) toggleActivity(id);
    if (!openFamily[sportFamily(base)]) toggleFamily(sportFamily(base));
    return id;
  };

  const profileField = (field: RunnerNumberField) => (next: number | null) => setNumber(field, next);
  /** Unité d'une FC de Pratiquant, suivie de son origine : « bpm · test du 24/10 ». */
  const hrUnit = (field: 'hrMax' | 'hrRest'): string => {
    const source = runnerHrSource(profile, field);
    return source ? `bpm · ${hrSourceLabel(source)}` : 'bpm';
  };

  return (
    <SettingsScope>
    <div className="ui-page--backdrop" style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto', boxSizing: 'border-box' }}>
      <PageBackdrop variant={backdrop} />
      <div style={{ marginBottom: '15px' }}>
        <PageHeader title="Réglages" subtitle="Enregistrés sur cet appareil et dans le dossier mémoire."
          aside={<CollapseAllButton onCollapse={collapseAll} />} />
      </div>

      <div style={{ marginBottom: '15px' }}>
        <MemoryStatus detailed collapse={{ open: open.memoire, onToggle: () => toggle('memoire') }} />
      </div>

      <div style={cardStyle}>
        <BlockTitle label="Autorisations" open={open.autorisations} onToggle={() => toggle('autorisations')} helpKey="autorisations"
          help="Ce qu'il faut pour enregistrer écran éteint. Refusée deux fois, une autorisation ne se redemande plus : « Ouvrir les réglages » mène à celles de l'application." />
        {open.autorisations && <div className="settings-block__body"><PermissionsSettings /></div>}
      </div>

      <div style={cardStyle}>
        <BlockTitle label="Activités" open={open.activites} onToggle={() => toggle('activites')} helpKey="activites"
          help="Chaque activité part des valeurs de son calcul (wingfoil, course, vélo…) ; « Défaut » les lui rend. L'œil cache une famille ou une activité partout, sessions comprises, sans rien effacer." />
        {open.activites && (
          <>
            <div className="settings-activities">
              {familyOrdered.map((activity, k) => {
                const s = view(activity);
                const id = activity.id;
                const p = SPORT_PROFILES[activity.base];
                const family = sportFamily(activity.base);
                const treatment = sportTreatment(activity.base);
                const sailing = treatment === 'voile';
                /** À pied ou à vélo : pente, terrain, dénivelé. */
                const land = isLandTreatment(treatment);
                /** Sans position (muscu) : ni unités, ni seuil, ni couleurs de trace, ni pause automatique ; la ceinture d'office. */
                const positions = hasPositions(activity.base);
                /** Seuil d'activité réglable : pas en bateau, où toute la session compte en navigation. */
                const withThreshold = hasActiveThreshold(p) && positions;
                /** Nom du seuil, sous son titre : de vague ou de vol en surf. */
                const thresholdLabel = treatment === 'surf' ? (s.foil ? 'Seuil de vol' : 'Seuil de vague') : "Seuil d'activité";
                /** Famille du temps estimé des itinéraires, `null` en voile et en fractionné. */
                const paceFamily = planningFamily(activity);
                const units = TREATMENT_UNITS[treatment];
                const isOpen = openActivity[id] === true;
                const renamingThis = isOpen && renaming === id;
                const familyHidden = isFamilyHidden(activities, hiddenFamilies, family);
                /** Grisée : cachée elle-même, ou par sa famille. */
                const shownHidden = activity.hidden === true || familyHidden;
                const overridden =
                  s.isSpeedUnitOverridden || s.isDistanceUnitOverridden || (withThreshold && s.isThresholdOverridden) || s.isAutoPauseOverridden || s.speedRange !== null || s.gradeRange !== null ||
                  s.isLiveFieldsOverridden || s.isNotificationFieldsOverridden || s.isMarkGuideOverridden || s.terrainStepM !== defaultTerrainStepOf(activity) || s.bikeType !== defaultBikeType(activity) || s.bikeWeight !== null || s.carriedLoad !== null || s.isEnergyModelOverridden || s.isHrOffsetOverridden || s.gearLabels !== null || s.isTabsOverridden ||
                  s.paceLevel !== defaultPaceOf(activity).level || s.customFlatSpeedMs !== defaultPaceOf(activity).customFlatSpeedMs || s.isWayTypesOverridden ||
                  s.loopReturnRatio !== p.loopReturnMaxRatio || s.isFoilOverridden || s.pumping === true || s.isJumpsOverridden || s.isHeartRateOverridden || s.cadence === false;
                // Seuil : en voile dans l'unité choisie (rangé dans celle du calcul, les nœuds), en course en km/h.
                const thresholdUnit: SpeedUnit = sailing ? s.speedUnit : p.thresholdUnit;
                const thresholdShown = parseFloat(
                  toDisplaySpeed(fromDisplaySpeed(s.activeThreshold, p.thresholdUnit), thresholdUnit).toFixed(thresholdUnit === 'ms' ? 2 : 1)
                );
                // Voile sans réglage ni pré-réglage : champ vide, le seuil est suggéré par l'allure de chaque session.
                const thresholdEmpty = thresholdFollowsPace(activity) && !s.isThresholdOverridden;
                /** Seuil à 0 : aucun seuil réglé ; les pauses de l'enregistrement et les arrêts complets sont ôtés d'office. */
                const noThreshold = s.activeThreshold === 0;
                const setThreshold = (next: number | null) =>
                  setFor(id, 'activeThreshold', next === null ? null : toDisplaySpeed(fromDisplaySpeed(next, thresholdUnit), p.thresholdUnit));
                // Bornes de couleur, saisies en km/h quand l'unité est une allure (min/km).
                const rangeUnit = editSpeedUnit(s.speedUnit);
                const fallbackRange = defaultSpeedRangeOf(activity);
                const shownRange = s.speedRange ?? fallbackRange;
                // Voile sans réglage : champs vides, les bornes suivent l'allure de chaque session, sauf bornes fixes (pré-réglage, bateau).
                const followsPace = rangeFollowsPace(activity);
                const rangeEmpty = followsPace && s.speedRange === null;
                const displayBound = (ms: number) => parseFloat(formatSpeedValue(toDisplaySpeed(ms, rangeUnit), rangeUnit));
                const setRangeBound = (bound: 'minMs' | 'maxMs', next: number | null) => {
                  if (next === null) { setFor(id, 'speedRange', null); return; }
                  const candidate = { ...shownRange, [bound]: fromDisplaySpeed(next, rangeUnit) };
                  if (candidate.maxMs > candidate.minMs) setFor(id, 'speedRange', candidate);
                };
                // Couleur de pente de la courbe d'altitude (course, vélo), saisie en %, rangée en fraction.
                const fallbackGrades = defaultGradeRange(activity);
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
                    speedMs: field === 'speedKmh' ? kmhToMs(next) : s.autoPause.speedMs,
                    delayS: field === 'delayS' ? next : s.autoPause.delayS,
                  });
                };
                const heading = (k === 0 || sportFamily(familyOrdered[k - 1].base) !== family) && (
                  <FamilyHeading family={family} hidden={familyHidden} disabled={!familyHidden && lastFamily}
                    open={openFamily[family] === true} onOpen={() => toggleFamily(family)}
                    names={familyOrdered.filter((a) => sportFamily(a.base) === family).map((a) => a.name)}
                    onToggle={() => setFamilyHidden(family, !familyHidden)} />
                );
                // Famille repliée : son en-tête seul, ses activités ne sont pas montées.
                if (openFamily[family] !== true) return <Fragment key={id}>{heading}</Fragment>;
                const pauseKmh = parseFloat(msToKmh(s.autoPause.speedMs).toFixed(1));
                const summary = !positions ? 'sans GPS, ceinture cardio' : [
                  speedUnitLabel(s.speedUnit, s.distanceUnit),
                  DISTANCE_UNIT_SYMBOL[s.distanceUnit],
                  ...(!withThreshold ? [] : [
                    thresholdEmpty ? "seuil selon l'allure" : noThreshold ? 'sans seuil' : `seuil ${thresholdShown} ${SPEED_UNIT_LABEL[thresholdUnit]}`,
                  ]),
                  s.autoPause.speedMs > 0 ? `pause sous ${pauseKmh} km/h après ${s.autoPause.delayS} s` : 'sans pause automatique',
                  ...(s.foil ? ['foil'] : []),
                  ...(s.foil && s.pumping ? ['pumping'] : []),
                  ...(s.jumps?.enabled ? ['sauts'] : []),
                  ...(s.cadence ? ['cadence'] : []),
                  ...(treatment === 'velo' ? [BIKE_TYPES[s.bikeType].noun] : []),
                  ...(paceFamily ? [`voies : ${s.wayTypes.map((w) => WAY_TYPE_LABEL[w].toLowerCase()).join(' + ')}`] : []),
                  ...(paceFamily ? [`niveau ${PACE_LEVEL_LABEL[s.paceLevel].toLowerCase()}`] : []),
                ].join(' · ');
                return (
                  <Fragment key={id}>
                    {heading}
                    <div className={`settings-activity${shownHidden ? ' settings-activity--hidden' : ''}`}>
                      <div className="settings-activity__head">
                        {/* Le nom fait partie du bouton qui déplie et replie, ouvert comme fermé : seul « Renommer » (menu « … ») le met
                            dans un champ, pour ne pas le changer par mégarde en voulant replier la carte (demande du 20/10). */}
                        <button type="button" className="settings-activity__toggle" aria-expanded={isOpen}
                          onClick={() => {
                            toggleActivity(id);
                            if (renamingThis) setRenaming(null);
                          }}>
                          <IconChevronRight size={14} className="settings-activity__chevron" style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
                          {!renamingThis && <ActivityIcon activity={activity} size={18} className="settings-activity__icon" style={{ color: shown(activity.color) }} />}
                          {!renamingThis && <strong className="settings-activity__name">{activity.name}</strong>}
                          {!renamingThis && <span className="settings-sports__mark">{p.label}</span>}
                          {!isOpen && (
                            <span className="settings-activity__summary">
                              {summary}{overridden ? ' · modifié' : ''}
                            </span>
                          )}
                        </button>
                        {renamingThis && (
                          <>
                            <ActivityNameField activity={activity} onRename={(name) => updateActivity(id, { name })} onDone={() => setRenaming(null)} />
                            <span className="settings-sports__mark">{p.label}</span>
                          </>
                        )}
                        <MoreMenu label={`Plus d'actions sur ${activity.name}`}>
                          <Button onClick={() => {
                            if (!isOpen) toggleActivity(id);
                            setRenaming(id);
                          }}>Renommer</Button>
                          <Button onClick={() => askRemove(activity)}>Supprimer</Button>
                          <Button disabled={!overridden} onClick={() => resetActivity(id)}>Par défaut</Button>
                        </MoreMenu>
                        <EyeButton name={activity.name} hidden={activity.hidden === true}
                          disabled={!activity.hidden && !familyHidden && lastActivity}
                          onToggle={() => setActivityHidden(id, !activity.hidden)} />
                      </div>
                      {isOpen && (
                        <div className="settings-activity__body">
                          <SettingRow label="Couleur" helpKey={`${id}:couleur`}
                            help="Sa couleur dans les listes et les graphes, parmi les nuances de sa famille.">
                            <ShadePicker shades={FAMILY_SHADES[family]} value={activity.color} onChange={(color) => updateActivity(id, { color })}
                              label={`Couleur de ${activity.name}`} />
                          </SettingRow>
                          <SettingRow label="Icône" helpKey={`${id}:icone`} help="Son icône dans les listes ; sans choix, elle suit le nom.">
                            <IconPicker value={activityIcon(activity)} color={activity.color} onChange={(icon) => updateActivity(id, { icon })}
                              label={`Icône de ${activity.name}`} />
                          </SettingRow>
                          {positions && <ActivityPart label="Affichage" open={openPart.affichage} onToggle={() => togglePart('affichage')}>
                            <SettingRow label="Unité de vitesse" helpKey={`${id}:unite-vitesse`} help={UNIT_HELP}>
                              <select value={s.speedUnit} onChange={(e) => setFor(id, 'speedUnit', e.target.value as SpeedUnit)} className="ui-field ui-field--s">
                                {units.map((u) => <option key={u} value={u}>{speedUnitLabel(u, s.distanceUnit)}</option>)}
                              </select>
                            </SettingRow>
                            <SettingRow label="Unité de distance" helpKey={`${id}:unite-distance`} help={UNIT_HELP}>
                              <select value={s.distanceUnit} onChange={(e) => setFor(id, 'distanceUnit', e.target.value as DistanceUnit)} className="ui-field ui-field--s">
                                {DISTANCE_UNITS.map((u) => <option key={u} value={u}>{DISTANCE_UNIT_LABEL[u]}</option>)}
                              </select>
                            </SettingRow>
                            <SettingRow label="Colorisation de la trace" helpKey={`${id}:couleurs-trace`}
                              help="Grise sous la première vitesse, du bleu au rouge jusqu'à la seconde. Une trace peut avoir les siennes, dans son analyse ; en voile, sans valeur, elles suivent l'allure de la session.">
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
                                {s.speedRange === null && <span className="settings-sports__mark">{followsPace ? "selon l'allure" : 'défaut'}</span>}
                              </div>
                            </SettingRow>
                            {land && (
                              <SettingRow label="Colorisation pente" helpKey={`${id}:couleurs-pente`}
                                help="Couleur de la courbe d'altitude selon la pente, montée ou descente : grise sous la première valeur, la plus vive à la seconde.">
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
                              </SettingRow>
                            )}
                          </ActivityPart>}
                          <ActivityPart label="Onglet analyse" open={openPart.analyse} onToggle={() => togglePart('analyse')}>
                            {withThreshold && (
                            <SettingRow label={thresholdLabel} helpKey={`${id}:seuil`} help={thresholdHelp(treatment, s.foil === true)}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <NumberField unit={SPEED_UNIT_LABEL[thresholdUnit]} step={thresholdUnit === 'ms' ? 0.1 : 0.5} min={0}
                                  value={thresholdEmpty ? null : thresholdShown}
                                  placeholder={String(thresholdShown)}
                                  onCommit={setThreshold} />
                                {noThreshold && <span className="settings-sports__mark">aucun seuil</span>}
                                {!s.isThresholdOverridden && (
                                  <span className="settings-sports__mark">{thresholdEmpty ? "selon l'allure" : 'défaut'}</span>
                                )}
                              </span>
                            </SettingRow>
                            )}
                            {s.foil !== null && (
                              <SettingRow label="Foil" helpKey={`${id}:foil`} help={treatment === 'surf'
                                ? 'Vols entre les vagues, ratio et seuil de vol. Chaque session peut avoir le sien.'
                                : 'Ratio de vol, sauts, champs « Foil » et « Mât » du matériel. Chaque session peut avoir le sien.'}>
                                <label className="settings-sports__pair">
                                  <input type="checkbox" checked={s.foil} onChange={(e) => setFor(id, 'foil', e.target.checked === defaultFoil(activity) ? null : e.target.checked)} />
                                  <span>Support sur foil</span>
                                  {!s.isFoilOverridden && <span className="settings-sports__mark">défaut</span>}
                                </label>
                              </SettingRow>
                            )}
                            {s.foil && s.pumping !== null && (
                              <SettingRow label="Pumping" helpKey={`${id}:pumping`} help={treatment === 'voile'
                                ? "Coups, fréquence et décollage de chaque vol, dans l'onglet « pumping » de l'analyse, téléphone fixé sur la poitrine : « Mesurer le pumping » est alors proposé dans Enregistrer, et la capture des capteurs est gardée entière (quelques Mo par heure). Chaque session peut avoir le sien."
                                : 'Fréquence de pumping et décollage de chaque vol, téléphone fixé sur la poitrine : « Mesurer le pumping » est alors proposé dans Enregistrer.'}>
                                <label className="settings-sports__pair">
                                  <input type="checkbox" checked={s.pumping} onChange={(e) => setFor(id, 'pumping', e.target.checked)} />
                                  <span>Pumping foil</span>
                                </label>
                              </SettingRow>
                            )}
                            {treatment === 'course' && (
                              <SettingRow label="Dépense" helpKey={`${id}:depense`}
                                help="Modèle de l'énergie des sessions : la course (Minetti, selon l'économie de course) ou la marche (Pandolf, descentes corrigées par Santee), qui coûte environ moitié moins sur le plat.">
                                <div className="settings-sports__pair">
                                  <SegmentedControl label="Dépense" items={ENERGY_MODEL_CHOICES} value={s.energyModel}
                                    onChange={(model) => setFor(id, 'energyModel', model === defaultEnergyModelOf(activity) ? null : model)} />
                                  {!s.isEnergyModelOverridden && <span className="settings-sports__mark">défaut</span>}
                                </div>
                              </SettingRow>
                            )}
                            {treatment === 'course' && (
                              <SettingRow label="Charge portée" helpKey={`${id}:charge`}
                                help="Sac, eau, affaires : ils augmentent l'énergie des sessions. Chaque session peut avoir la sienne.">
                                <div className="settings-sports__pair">
                                  <NumberField unit="kg" step={0.5} min={0} max={50}
                                    value={s.carriedLoad} placeholder="0" onCommit={(kg) => setFor(id, 'carriedLoad', kg)} />
                                  {s.carriedLoad === null && <span className="settings-sports__mark">aucune</span>}
                                </div>
                              </SettingRow>
                            )}
                            <SettingRow label="Seuils cardio" helpKey={`${id}:seuils-cardio`}
                              help="S1, S2 et les zones cardio de cette activité, décalés par rapport à ceux de la course (Réglages › Pratiquant) : la FC y monte moins haut pour un même effort (vélo −7, marche −4, planche −5, wing et kite −8, surf −10 par défaut).">
                              <div className="settings-sports__pair">
                                <NumberField unit="bpm" step={1} min={HR_OFFSET_RANGE.min} max={HR_OFFSET_RANGE.max}
                                  value={s.isHrOffsetOverridden ? s.hrOffset : null} placeholder={String(defaultHrOffsetOf(activity))}
                                  onCommit={(bpm) => setFor(id, 'hrOffset', bpm === null ? null : Math.round(bpm))} />
                                {!s.isHrOffsetOverridden && <span className="settings-sports__mark">défaut</span>}
                              </div>
                            </SettingRow>
                            {s.terrainStepM !== null && (
                              <SettingRow label="Altitude IGN" helpKey={`${id}:altitude-ign`}
                                help="L'altitude du terrain est demandée à l'IGN, un point tous les tant de mètres le long de la trace.">
                                <div className="settings-sports__pair">
                                  <span className="settings-sports__mark">un point tous les</span>
                                  <select value={s.terrainStepM} onChange={(e) => setFor(id, 'terrainStepM', Number(e.target.value))} className="ui-field ui-field--s">
                                    {TERRAIN_STEP_CHOICES_M.map((m) => <option key={m} value={m}>{m} m</option>)}
                                  </select>
                                  {s.terrainStepM === defaultTerrainStepOf(activity) && <span className="settings-sports__mark">défaut</span>}
                                </div>
                              </SettingRow>
                            )}
                            <AnalysisTabsSetting view={s} profile={p} onChange={(choices) => setFor(id, 'tabs', choices)} />
                          </ActivityPart>
                          <ActivityPart label="Matériel" open={openPart.materiel} onToggle={() => togglePart('materiel')}>
                            <SettingRow label="Matériel enregistré" helpKey={`${id}:materiel-enregistre`}
                              help={`Des groupes (voile, aile avant, mât…) et leurs pièces, choisis en fin de session dans l'onglet ${sailing ? '« matos et conditions »' : '« matériel et notes »'} à la place des champs de texte ; Statistiques filtre alors par pièce. « Par défaut » garde la liste.`}>
                              <label className="settings-sports__pair">
                                <input type="checkbox" data-testid="gear-option" checked={s.gearGroups !== null}
                                  onChange={(e) => toggleGear(activity, s.gearGroups, e.target.checked)} />
                                <span>Créer liste matériel</span>
                              </label>
                            </SettingRow>
                            {s.gearGroups !== null && (
                              <GearGroupsEditor groups={s.gearGroups} onChange={(groups) => setFor(id, 'gearGroups', groups)} />
                            )}
                            {/* Champs de texte remplacés par les groupes dès qu'il y en a un (onglet du matériel). */}
                            {!sailing && !s.gearGroups?.length && (
                              <SettingRow label="Matériel" helpKey={`${id}:materiel`}
                                help="Noms des deux champs de matériel de l'onglet « matériel et notes » (chaussures, vélo…).">
                                <div className="settings-sports__pair">
                                  <GearLabelsField labels={s.gearLabels}
                                    onCommit={(labels) => setFor(id, 'gearLabels', labels)} />
                                  {s.gearLabels === null && <span className="settings-sports__mark">défaut</span>}
                                </div>
                              </SettingRow>
                            )}
                          </ActivityPart>
                          <ActivityPart label="Enregistrement" open={openPart.enregistrement} onToggle={() => togglePart('enregistrement')}>
                            {positions && <SettingRow label="Pause automatique" helpKey={`${id}:pause`}
                              help="La trace se met en pause seule sous cette vitesse, au bout de ce temps. 0 km/h la désactive.">
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
                            </SettingRow>}
                            {positions && <FieldsSetting label="Carte réduite à l'enregistrement" helpKey={`${id}:carte-reduite`}
                              help="Les chiffres en grand quand la carte est réduite, de haut en bas."
                              treatment={treatment} family={family} units={s} fields={s.liveFields} overridden={s.isLiveFieldsOverridden}
                              defaults={defaultLiveFieldsFor(activity)} max={MAX_LIVE_FIELDS}
                              onChange={(fields) => setFor(id, 'liveFields', fields)} />}
                            {s.jumps !== null && (
                              <JumpsSetting id={id} jumps={s.jumps} overridden={s.isJumpsOverridden} onChange={(next) => setFor(id, 'jumps', next)} />
                            )}
                            {positions ? (
                              <SettingRow label="Ceinture cardio" helpKey={`${id}:ceinture`}
                                help="La ceinture du bloc « Capteurs » est proposée, cochée, à chaque enregistrement ; la fréquence cardiaque est écrite dans la trace.">
                                <label className="settings-sports__pair">
                                  <input type="checkbox" checked={s.heartRate} onChange={(e) => setFor(id, 'heartRate', e.target.checked)} />
                                  <span>Proposer la ceinture cardio</span>
                                </label>
                              </SettingRow>
                            ) : (
                              <SettingRow label="Ceinture cardio" helpKey={`${id}:ceinture`}
                                help="Une session sans GPS se fait avec la ceinture du bloc « Capteurs » : « Démarrer » attend qu'elle soit connectée.">
                                <span className="settings-sports__mark">obligatoire</span>
                              </SettingRow>
                            )}
                            {s.cadence !== null && (
                              <SettingRow label="Cadence" helpKey={`${id}:cadence`}
                                help="Le téléphone, porté sur soi, compte les pas (Android) ; la cadence est écrite dans la trace.">
                                <label className="settings-sports__pair">
                                  <input type="checkbox" checked={s.cadence} onChange={(e) => setFor(id, 'cadence', e.target.checked ? null : false)} />
                                  <span>Mesurer la cadence</span>
                                </label>
                              </SettingRow>
                            )}
                            <div className="settings-part__sub">
                              <h4 className="settings-part__subtitle">Notification</h4>
                              <FieldsSetting label="Chiffres de la notification" helpKey={`${id}:notification`}
                                help="Deux chiffres au plus, lisibles écran verrouillé avec le nom de l'activité et la durée. « Étape » : la répétition du compteur en cours sur toutes celles de la séance (5/20), ou le palier d'un test. Le téléphone doit montrer le contenu des notifications sur l'écran verrouillé."
                                target="notification" treatment={treatment} family={family} units={s} fields={s.notificationFields} overridden={s.isNotificationFieldsOverridden}
                                defaults={defaultNotificationFieldsFor(activity)} max={MAX_NOTIFICATION_FIELDS}
                                onChange={(fields) => setFor(id, 'notificationFields', fields)} />
                            </div>
                          </ActivityPart>
                          {(treatment === 'velo' || paceFamily !== null || s.loopReturnRatio !== null) && (
                            <ActivityPart label={treatment === 'velo' ? (paceFamily ? 'Vélo et planification' : 'Vélo') : 'Planification'} open={openPart.itineraires} onToggle={() => togglePart('itineraires')}>
                              {treatment === 'velo' && (
                                <BikeSettings view={s}
                                  onBikeType={(t) => setFor(id, 'bikeType', t)}
                                  onBikeWeight={(kg) => setFor(id, 'bikeWeight', kg)} />
                              )}
                              {paceFamily && (
                                <WayTypesSetting view={s} treatment={treatment} onChange={(ways) => setFor(id, 'wayTypes', ways)} />
                              )}
                              {s.loopReturnRatio !== null && (
                                <SettingRow label="Retour de boucle" helpKey={`${id}:boucle`}
                                  help="En boucle, le retour évite les voies de l'aller tant qu'il n'est pas plus long que tant de fois l'aller ; au-delà, il prend le plus court.">
                                  <div className="settings-sports__pair">
                                    <span className="settings-sports__mark">au plus</span>
                                    <NumberField unit="× l'aller" step={0.1} min={LOOP_RETURN_RATIO_RANGE.min} max={LOOP_RETURN_RATIO_RANGE.max}
                                      value={s.loopReturnRatio} onCommit={(v) => setFor(id, 'loopReturnRatio', v)} />
                                    {s.loopReturnRatio === p.loopReturnMaxRatio && <span className="settings-sports__mark">défaut</span>}
                                  </div>
                                </SettingRow>
                              )}
                              {paceFamily && (
                                <PaceSettings family={paceFamily} view={s}
                                  onLevel={(level) => setFor(id, 'paceLevel', level)}
                                  onCustomSpeed={(ms) => setFor(id, 'customFlatSpeedMs', ms)} />
                              )}
                            </ActivityPart>
                          )}
                          {usesMarkCourse(family) && (
                            <ActivityPart label="Planification : balise sonore" open={openPart.balises} onToggle={() => togglePart('balises')}>
                                <SettingRow label="Bips d'approche des balises" helpKey={`${id}:bips`} helpFirst
                                  help="En navigation sur un parcours : bips de plus en plus rapprochés à l'approche de chaque balise, bip long à la validation. Tirez un point pour le déplacer, touchez le graphe pour en ajouter un.">
                                  <BeepCurveEditor value={s.markGuide} overridden={s.isMarkGuideOverridden} fallback={defaultMarkGuideOf(activity)}
                                    approachMs={simulatedApproachMs(family)} speedUnit={s.speedUnit}
                                    onChange={(guide) => setFor(id, 'markGuide', guide)} />
                                </SettingRow>
                            </ActivityPart>
                          )}
                        </div>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <AddActivityForm activities={activities} onAdd={addAndOpen} />
          </>
        )}
      </div>

      <div style={cardStyle}>
        <PanelTitle label="Enregistrement" open={open.enregistrement} onToggle={() => toggle('enregistrement')} />
        {open.enregistrement && (
          <div className="settings-block__body">
            <NumberField label="Appui long pour la pause" unit="s" step={0.5} min={0.5} max={10} helpKey="appui-pause"
              help="Pendant un enregistrement, tenir le bouton rond de la barre du bas met en pause ou relance, depuis n'importe quelle page."
              value={longPressMs / 1000}
              onCommit={(v) => setLongPressMs(v === null ? null : Math.round(v * 1000))} />
            <NumberField label="Appui long pour arrêter" unit="s" step={0.5} min={0} max={10} helpKey="appui-arret"
              help="Le bouton « Arrêter » se tient ce temps-là, pour ne pas couper la session par mégarde ; à 0, un appui suffit."
              value={stopHoldMs / 1000}
              onCommit={(v) => setStopHoldMs(v === null ? null : Math.round(v * 1000))} />
            <SettingRow label="Son des bips" helpKey="son-bips"
              help="Pour tous les bips : compteur d'intervalles, balises, tests. Un haut-parleur de téléphone porte le mieux vers l'aigu ; plus grave, le bip s'entend moins fort. « Écouter » joue le signal d'un changement de phase.">
              <div className="settings-inline">
                <SegmentedControl label="Son des bips" items={BEEP_SOUNDS.map((s) => ({ key: s.key, label: s.label }))} value={beepSound}
                  onChange={(next) => { setBeepSound(next); void setBeepPitch(beepSoundHz(next)).then(() => playPattern(LISTEN_PATTERN, false)); }} />
                <Button size="s" onClick={() => void setBeepPitch(beepSoundHz(beepSound)).then(() => playPattern(LISTEN_PATTERN, false))}>Écouter</Button>
              </div>
            </SettingRow>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <PanelTitle label="Capteurs" open={open.capteurs} onToggle={() => toggle('capteurs')} />
        {open.capteurs && <div className="settings-block__body"><HeartRateBeltSettings /></div>}
      </div>

      <div style={cardStyle}>
        <BlockTitle label="Affichage" open={open.affichage} onToggle={() => toggle('affichage')} helpKey="affichage"
          help="Propre à cet appareil : il n'est pas repris par un autre téléphone ni par le fichier de réglages." />
        {open.affichage && <div className="settings-block__body"><DisplaySettings /></div>}
      </div>

      <div style={cardStyle}>
        <BlockTitle label="Cartes hors ligne" open={open.cartes} onToggle={() => toggle('cartes')} helpKey="cartes"
          help="Chaque morceau de carte vu avec le réseau reste visible sans réseau. Pour préparer une sortie, parcourez la zone en ligne, de loin puis de près." />
        {open.cartes && <div className="settings-block__body"><OfflineMapsSettings /></div>}
      </div>

      <div style={cardStyle}>
        <BlockTitle label="Pratiquant" open={open.coureur} onToggle={() => toggle('coureur')} helpKey="pratiquant"
          help="Pour l'énergie des analyses à pied et à vélo, les zones cardiaques de toutes les activités, et la racine du Profil. Tout est facultatif." />
        {open.coureur && (
          <div className="settings-block__body">
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: 'var(--text-s)' }}>
              <span style={{ width: '190px' }}>Nom ou pseudo<HelpToggle helpKey="pratiquant:nom" label="Nom ou pseudo" /></span>
              <input type="text" value={profile.name ?? ''} maxLength={RUNNER_NAME_MAX} placeholder="ex. Tom" autoComplete="nickname"
                onChange={(e) => setName(e.target.value)} className="ui-field ui-field--s" style={{ width: '200px', maxWidth: '100%' }} />
            </label>
            <HelpText helpKey="pratiquant:nom">En titre de la page Profil et au pied des images partagées.</HelpText>
            <NumberField label="Poids" unit="kg" step={0.5} min={20} max={300} value={profile.weightKg} onCommit={profileField('weightKg')} placeholder="ex. 72"
              helpKey="pratiquant:poids" help="Pour l'énergie, et la puissance à vélo." />
            <NumberField label="Taille" unit="cm" min={100} max={250} value={profile.heightCm} onCommit={profileField('heightCm')} placeholder="ex. 178"
              helpKey="pratiquant:taille" help="Avec le poids, l'âge et le sexe, pour la dépense au repos." />
            <NumberField label="Année de naissance" unit={age !== null ? `${age} ans` : undefined} min={1900} max={2100} value={profile.birthYear} onCommit={profileField('birthYear')} placeholder="ex. 1985"
              helpKey="pratiquant:naissance" help="Pour la dépense au repos, et la FC max estimée quand elle n'est pas saisie." />
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: 'var(--text-s)' }}>
              <span style={{ width: '190px' }}>Sexe<HelpToggle helpKey="pratiquant:sexe" label="Sexe" /></span>
              <select value={profile.sex ?? ''} onChange={(e) => setSex(e.target.value === '' ? null : (e.target.value as 'f' | 'm'))} className="ui-field ui-field--s">
                <option value="">Non renseigné</option>
                <option value="f">Femme</option>
                <option value="m">Homme</option>
              </select>
            </label>
            <HelpText helpKey="pratiquant:sexe">Pour la dépense au repos.</HelpText>
            <NumberField label="Fréquence cardiaque max" unit={hrUnit('hrMax')} min={100} max={250} value={profile.hrMax} onCommit={profileField('hrMax')} placeholder="ex. 185"
              helpKey="pratiquant:fc-max" help="Pour les seuils et les zones cardiaques. Le test de FC max (Entraînement › Tests) la mesure ; sans elle, elle est estimée par l'âge." />
            <NumberField label="Fréquence cardiaque de repos" unit={hrUnit('hrRest')} min={25} max={120} value={profile.hrRest} onCommit={profileField('hrRest')} placeholder="ex. 55"
              helpKey="pratiquant:fc-repos" help="Avec la FC max, les seuils se calculent sur la réserve cardiaque, plus juste. Le test de FC repos (Entraînement › Tests) la mesure." />
            <HeartRateThresholdsField profile={profile} onChange={setThresholds} />
            <NumberField label="Économie de course" unit="ml O₂/kg/km" min={120} max={320} value={profile.economyMlKgKm} onCommit={profileField('economyMlKgKm')} placeholder="200"
              helpKey="pratiquant:economie" help="Oxygène pour courir 1 km sur le plat, donné par un test en laboratoire. Sans valeur, 200 : environ 1 kcal par kilo et par kilomètre." />
            <p className="ui-eyebrow" style={{ margin: '16px 0 8px' }}>Racine du Profil</p>
            <NumberField label="Objectif par semaine" unit="min" min={ROOT_GOAL.min} max={ROOT_GOAL.max} value={profile.rootWeeklyGoalMin} onCommit={profileField('rootWeeklyGoalMin')}
              placeholder={String(ROOT_GOAL.defaultMin)} helpKey="pratiquant:racine-objectif"
              help={`Temps d'activité, toutes activités confondues, à faire du lundi au dimanche (de ${ROOT_GOAL.min} min à ${ROOT_GOAL.max / 60} h) : la semaine tenue, la racine gagne une étape, et fait le tour du Profil en 26 semaines. Semaines manquées d'affilée : −3 étapes, puis −6, puis retour à la graine.`} />
          </div>
        )}
      </div>
    </div>
    </SettingsScope>
  );
}

/**
 * Thème de cet appareil (`theme/theme.ts`) : Clair, Sombre ou Auto, qui suit le téléphone, et la case Économe,
 * qui impose le sombre (le bouton glissant reste là, sans effet, et la ligne sous la case le dit).
 */
function DisplaySettings() {
  const [theme, setTheme] = useThemeSettings();
  return (
    <>
      <SettingRow label="Thème" helpKey="affichage:theme"
        help="Auto suit le réglage clair ou sombre du téléphone, ou de l'ordinateur, et change avec lui. La carte reste claire.">
        <SegmentedControl label="Thème" items={[...THEME_CHOICES]} value={theme.choice} onChange={(choice) => setTheme({ choice })} />
      </SettingRow>
      <SettingRow label="Économe" helpKey="affichage:econome"
        help="Noir pur et moins d'effets, pour l'écran et la batterie ; n'agit pas sur le GPS.">
        <label className="settings-sports__pair">
          <input type="checkbox" checked={theme.eco} onChange={(e) => setTheme({ eco: e.target.checked })} />
          <span>Noir pur, moins d'effets</span>
        </label>
        {theme.eco && <p className="settings-display__note">Cochée, elle garde l'interface en sombre, quel que soit le thème choisi.</p>}
      </SettingRow>
    </>
  );
}

/** « Tout réduire », en haut de la page : replie tout, aides et choix d'icône compris. */
function CollapseAllButton({ onCollapse }: { onCollapse: () => void }) {
  const collapseHelp = useHelpCollapseAll();
  return (
    <Button size="s" onClick={() => { onCollapse(); collapseHelp(); }}>Tout réduire</Button>
  );
}

/** Titre d'un bloc de la page, avec son « ? » une fois le bloc ouvert, et l'aide dépliée dessous. */
function BlockTitle({ label, open, onToggle, helpKey, help }: {
  label: string;
  open: boolean;
  onToggle: () => void;
  helpKey: string;
  help: ReactNode;
}) {
  return (
    <>
      <PanelTitle label={label} open={open} onToggle={onToggle}
        extra={open ? <HelpToggle helpKey={helpKey} label={label} size="s" /> : undefined} />
      {open && <HelpText helpKey={helpKey}>{help}</HelpText>}
    </>
  );
}

/** Aide des deux unités d'une activité. */
const UNIT_HELP = 'Utilisée partout pour cette activité : analyses, enregistrement, bibliothèque.';

/** Aide du seuil d'une activité, selon son calcul : en voile, à pied ou à vélo, en surf (vague ou vol). */
const thresholdHelp = (treatment: Treatment, foil: boolean): string => {
  if (treatment === 'surf') {
    return foil
      ? "Vitesse à laquelle votre aile décolle, de 10 à 15 km/h selon l'aile. Chaque session peut avoir le sien, dans son analyse."
      : 'Vitesse au-dessus de laquelle la planche est sur la vague. Chaque session peut avoir le sien, dans son analyse.';
  }
  if (treatment === 'voile') {
    return "Vitesse qui sépare « en action » de « à l'arrêt » : temps actif, manœuvres réussies, VMG. Vide, il suit l'allure de chaque session (8 nd d'office en wing et en planche) ; celui d'une session, réglé dans son analyse, prime.";
  }
  return "Sous cette vitesse, la session est comptée à l'arrêt. 0 : aucun seuil réglé ; les pauses de l'enregistrement et les arrêts complets sont ôtés d'office.";
};

/**
 * Chiffres de l'enregistrement, choisis dans le catalogue du direct : ceux en
 * grand de la carte réduite, ceux de la notification. Un menu par ligne, le
 * premier toujours rempli ; un chiffre déjà placé n'est pas proposé ailleurs.
 * La liste est rangée sans trou ; revenue au défaut, elle est effacée.
 */
function FieldsSetting({ label, help, helpKey, target = 'live', treatment, family, units, fields, overridden, defaults, max, onChange }: {
  label: string;
  help: string;
  helpKey: string;
  /** Carte réduite (par défaut) ou notification, qui a ses chiffres à elle. */
  target?: LiveFieldTarget;
  treatment: Treatment;
  family: SportFamily;
  units: LiveFieldUnits;
  fields: LiveFieldKey[];
  overridden: boolean;
  defaults: LiveFieldKey[];
  max: number;
  onChange: (fields: LiveFieldKey[] | null) => void;
}) {
  const options = liveFieldsOfTreatment(treatment, target, family);
  const slots = Array.from({ length: max }, (_, i) => fields[i] ?? null);
  const pick = (slot: number, key: LiveFieldKey | null) => {
    const next = slots.map((k, i) => (i === slot ? key : k)).filter((k): k is LiveFieldKey => k !== null);
    const isDefault = next.length === defaults.length && next.every((k, i) => k === defaults[i]);
    onChange(isDefault ? null : next);
  };
  return (
    <SettingRow label={label} helpKey={helpKey} help={help}>
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
        {!overridden && <span className="settings-sports__mark">défaut</span>}
      </div>
    </SettingRow>
  );
}

/** Vitesse en km/h, sans décimale inutile. */
const kmhLabel = (ms: number): string => `${parseFloat(msToKmh(ms).toFixed(1))} km/h`;

/** Ce que donne une vitesse sur le plat : l'allure en course, la puissance de montée à vélo. */
const paceDetail = (family: PlanningFamily, speedMs: number, distanceUnit: DistanceUnit, climbWkg?: number): string =>
  family === 'course'
    ? `${kmhLabel(speedMs)}, ${formatPace(speedMs, distanceUnit)} ${speedUnitSymbol('minkm', distanceUnit)}`
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
      <SettingRow label="Niveau (temps estimé)" helpKey={`${view.activity.id}:niveau`} help={family === 'course'
        ? 'Vitesse sur le plat du temps estimé ; chaque 100 m de D+ compte comme 1 km de plus.'
        : 'Vitesse sur le plat du temps estimé, et puissance tenue en montée, par kilo de votre poids ; en descente, roue libre.'}>
        <select value={view.paceLevel} onChange={(e) => isPaceLevel(e.target.value) && onLevel(e.target.value)} className="ui-field ui-field--s">
          {PACE_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level === 'perso'
                ? PACE_LEVEL_LABEL.perso
                : `${PACE_LEVEL_LABEL[level]} · ${paceDetail(family, LEVEL_FLAT_SPEED_MS[family][level], view.distanceUnit, family === 'velo' ? LEVEL_CLIMB_POWER_WKG[level] : undefined)}`}
            </option>
          ))}
        </select>
      </SettingRow>
      {view.paceLevel === 'perso' && (
        <SettingRow label="Vitesse sur le plat" helpKey={`${view.activity.id}:vitesse-plat`} help="Votre vitesse sur le plat, pour le temps estimé.">
          <div className="settings-sports__pair">
            <NumberField unit="km/h" step={0.5}
              min={parseFloat(msToKmh(lo).toFixed(1))} max={parseFloat(msToKmh(hi).toFixed(1))}
              value={custom === null ? null : parseFloat(msToKmh(custom).toFixed(1))}
              onCommit={(kmh) => onCustomSpeed(kmh === null ? null : kmhToMs(kmh))} />
            <span className="settings-sports__mark">
              {custom === null ? 'sans vitesse saisie, le niveau moyen' : `soit ${paceDetail(family, custom, view.distanceUnit)}`}
            </span>
          </div>
        </SettingRow>
      )}
    </>
  );
}

/**
 * En-tête d'une famille dans la liste des activités, comme dans le choix d'une activité, avec son œil :
 * cachée, elle est grisée, ses activités aussi. Le bandeau replie la famille ; repliée, il nomme ses
 * activités. L'œil, à côté du bandeau et pas dedans, ne la replie pas.
 */
function FamilyHeading({ family, hidden, disabled, open, names, onOpen, onToggle }: {
  family: SportFamily;
  hidden: boolean;
  disabled: boolean;
  open: boolean;
  names: string[];
  onOpen: () => void;
  onToggle: () => void;
}) {
  const Icon = FAMILY_ICON[family];
  return (
    <div className={`settings-activities__family${open ? ' settings-activities__family--open' : ''}`}
      style={{ color: hidden ? 'var(--muted)' : FAMILY_ACCENT[family] }}>
      <button type="button" className="settings-activities__family-toggle" aria-expanded={open} onClick={onOpen}>
        <IconChevronRight size={14} className="settings-activity__chevron" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
        <Icon size={18} />
        <span className="settings-activities__family-name">{FAMILY_LABEL[family]}</span>
        {!open && <span className="settings-activities__family-summary">{names.join(' · ')}</span>}
      </button>
      <EyeButton name={FAMILY_LABEL[family]} hidden={hidden} disabled={disabled} onToggle={onToggle} />
    </div>
  );
}

/**
 * Œil qui cache ou ré-affiche une famille ou une activité (§10, point 100). Fermé (désactivé) sur la
 * dernière visible : il en reste toujours une.
 */
function EyeButton({ name, hidden, disabled, onToggle }: { name: string; hidden: boolean; disabled: boolean; onToggle: () => void }) {
  const label = disabled ? `${name} : la dernière visible, elle ne se cache pas` : hidden ? `Afficher ${name}` : `Cacher ${name}`;
  return (
    <button type="button" className="settings-eye" aria-pressed={hidden} aria-label={label} title={label} disabled={disabled} onClick={onToggle}>
      {hidden ? <IconEyeOff size={18} /> : <IconEye size={18} />}
    </button>
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
      <SettingRow label="Type de vélo" helpKey={`${view.activity.id}:type-velo`}
        help="Pneus et position : ils fixent le roulement sur chaque revêtement et la prise au vent, pour la puissance, l'énergie et le temps estimé.">
        <div className="settings-sports__pair">
          <select value={view.bikeType} onChange={(e) => onBikeType(e.target.value as BikeType)} className="ui-field ui-field--s">
            {(Object.keys(BIKE_TYPES) as BikeType[]).map((t) => <option key={t} value={t}>{BIKE_TYPES[t].label}</option>)}
          </select>
          <span className="settings-sports__mark">
            roulement {formatCrr(spec.crrBySurface.asphalte ?? spec.crr)} sur asphalte, {formatCrr(spec.crrBySurface.terre ?? spec.crr)} sur terre
            (moyen {formatCrr(spec.crr)}), traînée {formatCrr(spec.cdaM2)} m²
          </span>
        </div>
      </SettingRow>
      <SettingRow label="Poids du vélo" helpKey={`${view.activity.id}:poids-velo`}
        help="Avec le vôtre (Pratiquant), pour la puissance et l'énergie. Vide : celui de l'activité, ou du type de vélo s'il a changé.">
        <NumberField unit="kg" step={0.5} min={3} max={60}
          value={view.bikeWeight} placeholder={String(defaultBikeKg(view.activity, view.bikeType))} onCommit={onBikeWeight} />
      </SettingRow>
    </>
  );
}

/**
 * Nom d'une activité en cours de saisie, ouvert par « Renommer », après son
 * icône. Le nom s'enregistre en quittant le champ ou sur Entrée ; vide, ou
 * sur Échap, le précédent reste. Dans les deux cas le champ se referme
 * (`onDone`).
 */
function ActivityNameField({
  activity, onRename, onDone,
}: {
  activity: Activity;
  onRename: (name: string) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(activity.name);
  const shown = useThemedShade();
  // Entrée et Échap ferment le champ eux-mêmes, sans attendre la perte du focus : la sortie qui suit ne refait rien.
  const closed = useRef(false);
  const close = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    if (save && draft.trim() !== '' && draft.trim() !== activity.name) onRename(draft);
    onDone();
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <ActivityIcon activity={activity} size={18} className="settings-activity__icon" style={{ color: shown(activity.color) }} />
      <input value={draft} maxLength={40} aria-label="Nom de l'activité" className="ui-field ui-field--s"
        style={{ width: '120px', fontWeight: 600 }}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => close(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') close(true);
          else if (e.key === 'Escape') close(false);
        }} />
    </span>
  );
}

/** Intitulés des deux champs de matériel d'une activité, rangés quand on quitte un champ ; vides, ceux par défaut. */
function GearLabelsField({
  labels, onCommit,
}: {
  labels: [string, string] | null;
  onCommit: (labels: [string, string] | null) => void;
}) {
  const first = labels?.[0] ?? '';
  const second = labels?.[1] ?? '';
  const [draft, setDraft] = useState<[string, string]>([first, second]);
  const [shown, setShown] = useState(`${first}|${second}`);
  // Changés d'ailleurs (remise au défaut de l'activité, fichier de réglages repris) : relus, pendant le rendu.
  if (shown !== `${first}|${second}`) {
    setShown(`${first}|${second}`);
    setDraft([first, second]);
  }
  const commit = () => {
    const next = sanitizeGearLabels(draft);
    if ((next?.[0] ?? '') !== first || (next?.[1] ?? '') !== second) onCommit(next);
    setDraft([next?.[0] ?? '', next?.[1] ?? '']);
  };
  return (
    <>
      {([0, 1] as const).map((k) => (
        <input key={k} value={draft[k]} maxLength={MAX_GEAR_LABEL_LENGTH} placeholder={DEFAULT_GEAR_LABELS[k]}
          aria-label={`Intitulé du matériel ${k + 1}`} className="ui-field ui-field--s" style={{ width: '110px' }}
          onChange={(e) => setDraft(k === 0 ? [e.target.value, draft[1]] : [draft[0], e.target.value])}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      ))}
    </>
  );
}

/** Ajout d'une activité : nom, famille, calcul (en voile et en fractionné), nuance de la famille, icône (devinée du nom tant qu'on n'en choisit pas). */
function AddActivityForm({
  activities, onAdd,
}: {
  activities: Activity[];
  onAdd: (name: string, base: SportType, color: string, icon?: ActivityIconId) => string | null;
}) {
  const [name, setName] = useState('');
  const [family, setFamily] = useState<SportFamily>('voile');
  const [base, setBase] = useState<SportType>(familySports('voile')[0]);
  const [color, setColor] = useState(() => nextActivityColor(activities, 'voile'));
  const [icon, setIcon] = useState<ActivityIconId | null>(null);
  const pickFamily = (next: SportFamily) => {
    setFamily(next);
    setBase(familySports(next)[0]);
    setColor(nextActivityColor(activities, next));
    setIcon(null);
  };
  const submit = () => {
    if (onAdd(name, base, color, icon ?? undefined) === null) return;
    setName('');
    setIcon(null);
    setColor(nextActivityColor([...activities, { id: '', name, base, color }], family));
  };
  return (
    <div className="settings-add">
      <strong className="settings-add__title">Ajouter une activité<HelpToggle helpKey="ajout" label="Ajouter une activité" /></strong>
      <input value={name} maxLength={40} placeholder="Nom, ex. Moth à foil" aria-label="Nom de la nouvelle activité"
        className="ui-field ui-field--s" style={{ width: '180px' }}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      <select value={family} onChange={(e) => pickFamily(e.target.value as SportFamily)} aria-label="Famille" className="ui-field ui-field--s">
        {SPORT_FAMILIES.map((f) => <option key={f} value={f}>{FAMILY_LABEL[f]}</option>)}
      </select>
      {familySports(family).length > 1 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>calcul</span>
          <select value={base} onChange={(e) => setBase(e.target.value as SportType)} className="ui-field ui-field--s">
            {familySports(family).map((b) => <option key={b} value={b}>{SPORT_PROFILES[b].label}</option>)}
          </select>
        </label>
      )}
      <ShadePicker shades={FAMILY_SHADES[family]} value={color} onChange={setColor} label="Couleur de la nouvelle activité" />
      <IconPicker value={icon ?? guessActivityIcon(name, base)} color={color} onChange={setIcon} label="Icône de la nouvelle activité" />
      <button onClick={submit} disabled={name.trim() === ''} className="ui-btn ui-btn--secondary ui-btn--s">Ajouter</button>
      <HelpText helpKey="ajout">Elle part des valeurs de son calcul ; tout se règle ensuite dans sa carte.</HelpText>
    </div>
  );
}

const megabytes = (bytes: number): string => (bytes / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/**
 * Cartes gardées sur l'appareil (plan et satellite) : place occupée, plafond, vidage. Monté
 * seulement bloc ouvert, parce que compter les tuiles lit tout leur dossier.
 */
function OfflineMapsSettings() {
  const { usage, satellite, capMb, setCapMb, clear } = useTileCache();
  const choices = TILE_CAP_CHOICES_MB.includes(capMb) ? TILE_CAP_CHOICES_MB : [...TILE_CAP_CHOICES_MB, capMb].sort((a, b) => a - b);

  const askClear = () => {
    if (window.confirm("Effacer toutes les cartes gardées sur cet appareil ? Sans réseau, les cartes resteront vides jusqu'à ce qu'elles soient revues en ligne.")) {
      void clear();
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: 'var(--text-s)' }}>
        <span style={{ width: '190px' }}>Place occupée</span>
        <span className="num">
          {usage === null ? '…' : `${megabytes(usage.bytes)} Mo (${usage.tiles.toLocaleString('fr-FR')} morceaux)`}
          {satellite && satellite.tiles > 0 && `, dont satellite ${megabytes(satellite.bytes)} Mo`}
        </span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: 'var(--text-s)' }}>
        <span style={{ width: '190px' }}>Plafond<HelpToggle helpKey="cartes:plafond" label="Plafond" /></span>
        <select value={capMb} onChange={(e) => void setCapMb(Number(e.target.value))} className="ui-field ui-field--s">
          {choices.map((mb) => <option key={mb} value={mb}>{mb >= 1000 ? `${mb / 1000} Go` : `${mb} Mo`}</option>)}
        </select>
      </label>
      <HelpText helpKey="cartes:plafond">Au-delà, les plus anciens morceaux sont effacés. Les photos du fond satellite pèsent plus que le plan.</HelpText>
      <button type="button" onClick={askClear} disabled={usage?.tiles === 0} className="ui-btn ui-btn--secondary ui-btn--s">
        Vider
      </button>
    </>
  );
}

export default SettingsPage;
