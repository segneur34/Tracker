import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { activitiesOfFamily, nextActivityColor, type Activity } from '../core/activities';
import { ELEVATION_PRESETS, SAILING_SPORTS, SPORT_PROFILES, sportFamily, type SportFamily } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import {
  DISTANCE_UNIT_LABEL, DISTANCE_UNIT_SYMBOL, SPEED_UNIT_LABEL, formatSpeedValue, fromDisplaySpeed, toDisplaySpeed,
  type DistanceUnit, type SpeedUnit,
} from '../core/units';
import { useOpenSections } from '../hooks/useOpenSections';
import { useRunnerProfile, type RunnerProfile } from '../hooks/useRunnerProfile';
import {
  RUNNING_UNITS, SAILING_UNITS, TERRAIN_LABEL, TEXT_SCALE_FACTOR, TEXT_SCALE_LABEL, useAllSportSettings,
  type TerrainType, type TextScale,
} from '../hooks/useSportSettings';
import { DEFAULT_SPEED_RANGE_MS } from '../running/runningAnalytics';
import { DEFAULT_SAILING_SPEED_RANGE_MS } from '../sailing/sailingConfig';
import { CARD_STYLE } from '../components/styles';
import { IconChevronRight } from '../components/icons';
import MemoryStatus from '../components/MemoryStatus';
import PanelTitle from '../components/PanelTitle';
import PageHeader from '../components/ui/PageHeader';
import './settingsPage.css';

/** Calculs proposés à une nouvelle activité, par famille. */
const FAMILY_BASES: Record<SportFamily, SportType[]> = { voile: SAILING_SPORTS, course: ['running'] };
const FAMILY_LABEL: Record<SportFamily, string> = { voile: 'Voile', course: 'Course à pied' };

const cardStyle = { ...CARD_STYLE, marginBottom: '15px' } as const;

/** Blocs repliables de la page, tous fermés au départ ; l'état est mémorisé. */
type SettingsBlock = 'memoire' | 'activites' | 'enregistrement' | 'course' | 'coureur';
const SETTINGS_BLOCK_DEFAULTS: Record<SettingsBlock, boolean> = {
  memoire: false, activites: false, enregistrement: false, course: false, coureur: false,
};
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
 * Page Paramètres : mémoire, activités et leurs réglages, enregistrement,
 * réglages propres à la course, et caractéristiques du coureur, en blocs
 * repliables (chaque activité se replie aussi). Tout est enregistré sur l'appareil
 * à la saisie, recopié dans le dossier mémoire (`reglages.json`), et relu par
 * chaque module à son ouverture.
 */
function SettingsPage() {
  const {
    activities, view, setFor, resetActivity, addActivity, updateActivity, removeActivity, longPressMs, setLongPressMs,
  } = useAllSportSettings();
  const { profile, setNumber, setSex, age } = useRunnerProfile();
  const { open, toggle } = useOpenSections<SettingsBlock>('settings', SETTINGS_BLOCK_DEFAULTS);
  const { open: openActivity, toggle: toggleActivity } = useOpenSections<string>('settings-activities', NO_ACTIVITY_OPEN);

  const runningActivities = activitiesOfFamily(activities, 'course');

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
              (wingfoil, planche, kite, bateau ou course), qui fixe ses valeurs de départ ; ses réglages d'affichage et
              d'enregistrement lui sont propres.
            </p>
            <div className="settings-activities">
              {activities.map((activity) => {
                const s = view(activity);
                const id = activity.id;
                const p = SPORT_PROFILES[activity.base];
                const sailing = sportFamily(activity.base) === 'voile';
                const units = sailing ? SAILING_UNITS : RUNNING_UNITS;
                const isOpen = openActivity[id] === true;
                const overridden =
                  s.isSpeedUnitOverridden || s.isDistanceUnitOverridden || s.isThresholdOverridden || s.textScale !== 'normal' || s.isAutoPauseOverridden || s.speedRange !== null;
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
                const fallbackRange = sailing ? DEFAULT_SAILING_SPEED_RANGE_MS : DEFAULT_SPEED_RANGE_MS;
                const shownRange = s.speedRange ?? fallbackRange;
                // Voile sans réglage : champs vides, les bornes suivent l'allure de chaque session.
                const rangeEmpty = sailing && s.speedRange === null;
                const displayBound = (ms: number) => parseFloat(formatSpeedValue(toDisplaySpeed(ms, rangeUnit), rangeUnit));
                const setRangeBound = (bound: 'minMs' | 'maxMs', next: number | null) => {
                  if (next === null) { setFor(id, 'speedRange', null); return; }
                  const candidate = { ...shownRange, [bound]: fromDisplaySpeed(next, rangeUnit) };
                  if (candidate.maxMs > candidate.minMs) setFor(id, 'speedRange', candidate);
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
                ].join(' · ');
                return (
                  <div key={id} className="settings-activity">
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
                          <ActivityNameField key={activity.name} activity={activity} onRename={(name) => updateActivity(id, { name })} onColor={(color) => updateActivity(id, { color })} />
                          <span className="settings-sports__mark">{p.label}</span>
                        </>
                      )}
                    </div>
                    {isOpen && (
                      <div className="settings-activity__body">
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
                        <div className="settings-row">
                          <span className="settings-row__label">Taille du texte</span>
                          <select value={s.textScale} onChange={(e) => setFor(id, 'textScale', e.target.value as TextScale)} className="ui-field ui-field--s">
                            {(Object.keys(TEXT_SCALE_FACTOR) as TextScale[]).map((t) => <option key={t} value={t}>{TEXT_SCALE_LABEL[t]}</option>)}
                          </select>
                        </div>
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
                        <div className="settings-activity__actions">
                          {overridden && (
                            <button type="button" onClick={() => resetActivity(id)} className="ui-btn ui-btn--secondary ui-btn--s">Défaut</button>
                          )}
                          <button type="button" onClick={() => askRemove(activity)} className="ui-btn ui-btn--secondary ui-btn--s">Supprimer</button>
                        </div>
                      </div>
                    )}
                  </div>
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
              (reprise à seuil + 1, pause sous seuil − 1).
              <br />
              Couleur de trace : gris sous la borne lente, dégradé du bleu au rouge jusqu'à la borne rapide. En voile, sans
              réglage, les bornes suivent l'allure de chaque session. Une trace peut avoir les siennes, réglées depuis sa
              légende : elles ne changent qu'elle et priment sur celles-ci.
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
              quelle page. Un appui court ouvre la page d'enregistrement. La pause automatique se règle par activité.
            </p>
            <NumberField label="Appui long pour la pause" unit="s" step={0.5} min={0.5} max={10}
              value={longPressMs / 1000}
              onCommit={(v) => setLongPressMs(v === null ? null : Math.round(v * 1000))} />
          </>
        )}
      </div>

      {runningActivities.length > 0 && (
        <div style={cardStyle}>
          <PanelTitle label="Course à pied" open={open.course} onToggle={() => toggle('course')} />
          {open.course && (
            <div style={{ marginTop: '10px' }}>
              {runningActivities.map((a) => {
                const terrain = view(a).terrain;
                return (
                  <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '14px', flexWrap: 'wrap' }}>
                    <span style={{ width: '190px' }}>Terrain par défaut{runningActivities.length > 1 ? ` (${a.name})` : ''}</span>
                    <select value={terrain} onChange={(e) => setFor(a.id, 'terrain', e.target.value as TerrainType)} className="ui-field ui-field--s">
                      {(Object.keys(ELEVATION_PRESETS) as TerrainType[]).map((t) => <option key={t} value={t}>{TERRAIN_LABEL[t]}</option>)}
                    </select>
                    <span style={{ color: 'var(--muted)', fontSize: '12px' }}>
                      lissage {ELEVATION_PRESETS[terrain].smoothingSeconds} s, seuil de dénivelé {ELEVATION_PRESETS[terrain].minGainM} m
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={cardStyle}>
        <PanelTitle label="Coureur" open={open.coureur} onToggle={() => toggle('coureur')} />
        {open.coureur && (
          <>
            <p className="settings-block__intro">
              Ces caractéristiques serviront aux estimations de coût énergétique et aux zones d'effort. Tout est facultatif.
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
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Nom et couleur d'une activité. Le nom s'enregistre en quittant le champ ou
 * sur Entrée ; vide, il revient au précédent. Le parent le remonte (clé :
 * le nom) quand le nom enregistré change, ce qui remet le brouillon à jour.
 */
function ActivityNameField({
  activity, onRename, onColor,
}: {
  activity: Activity;
  onRename: (name: string) => void;
  onColor: (color: string) => void;
}) {
  const [draft, setDraft] = useState(activity.name);
  const commit = () => {
    if (draft.trim() === '') setDraft(activity.name);
    else if (draft.trim() !== activity.name) onRename(draft);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <input type="color" value={activity.color} aria-label={`Couleur de ${activity.name}`}
        onChange={(e) => onColor(e.target.value)} className="settings-sports__color" />
      <input value={draft} maxLength={40} aria-label="Nom de l'activité" className="ui-field ui-field--s"
        style={{ width: '120px', fontWeight: 600 }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </span>
  );
}

/** Ajout d'une activité : nom, famille, calcul (en voile), couleur. */
function AddActivityForm({
  activities, onAdd,
}: {
  activities: Activity[];
  onAdd: (name: string, base: SportType, color: string) => string | null;
}) {
  const [name, setName] = useState('');
  const [family, setFamily] = useState<SportFamily>('voile');
  const [base, setBase] = useState<SportType>(FAMILY_BASES.voile[0]);
  const [color, setColor] = useState(() => nextActivityColor(activities));
  const pickFamily = (next: SportFamily) => {
    setFamily(next);
    setBase(FAMILY_BASES[next][0]);
  };
  const submit = () => {
    if (onAdd(name, base, color) === null) return;
    setName('');
    setColor(nextActivityColor([...activities, { id: '', name, base, color }]));
  };
  return (
    <div className="settings-add">
      <strong className="settings-add__title">Ajouter une activité</strong>
      <input value={name} maxLength={40} placeholder="Nom, ex. Moth à foil" aria-label="Nom de la nouvelle activité"
        className="ui-field ui-field--s" style={{ width: '180px' }}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
      <select value={family} onChange={(e) => pickFamily(e.target.value as SportFamily)} aria-label="Famille" className="ui-field ui-field--s">
        {(Object.keys(FAMILY_BASES) as SportFamily[]).map((f) => <option key={f} value={f}>{FAMILY_LABEL[f]}</option>)}
      </select>
      {FAMILY_BASES[family].length > 1 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: 'var(--muted)', fontSize: '12px' }}>calcul</span>
          <select value={base} onChange={(e) => setBase(e.target.value as SportType)} className="ui-field ui-field--s">
            {FAMILY_BASES[family].map((b) => <option key={b} value={b}>{SPORT_PROFILES[b].label}</option>)}
          </select>
        </label>
      )}
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Couleur" className="settings-sports__color" />
      <button onClick={submit} disabled={name.trim() === ''} className="ui-btn ui-btn--secondary ui-btn--s">Ajouter</button>
    </div>
  );
}

export default SettingsPage;
