import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ELEVATION_PRESETS, SAILING_SPORTS, SPORT_PROFILES } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { SPEED_UNIT_LABEL, formatSpeedValue, fromDisplaySpeed, toDisplaySpeed, type SpeedUnit } from '../core/units';
import { useRunnerProfile, type RunnerProfile } from '../hooks/useRunnerProfile';
import {
  RUNNING_UNITS, SAILING_UNITS, TERRAIN_LABEL, TEXT_SCALE_FACTOR, TEXT_SCALE_LABEL, useAllSportSettings,
  type TerrainType, type TextScale,
} from '../hooks/useSportSettings';
import { DEFAULT_SPEED_RANGE_MS } from '../running/runningAnalytics';
import { DEFAULT_SAILING_SPEED_RANGE_MS } from '../sailing/sailingConfig';
import { CARD_STYLE } from '../components/styles';
import MemoryStatus from '../components/MemoryStatus';
import PageHeader from '../components/ui/PageHeader';
import './settingsPage.css';

const ALL_SPORTS: SportType[] = [...SAILING_SPORTS, 'running'];

const cardStyle = { ...CARD_STYLE, marginBottom: '15px' } as const;

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
 * Page Paramètres : mémoire, réglages par support, réglages propres à la
 * course, et caractéristiques du coureur. Tout est enregistré sur l'appareil
 * à la saisie, recopié dans le dossier mémoire (`reglages.json`), et relu par
 * chaque module à son ouverture.
 */
function SettingsPage() {
  const { view, setFor } = useAllSportSettings();
  const { profile, setNumber, setSex, age } = useRunnerProfile();

  const running = view('running');

  const profileField = (field: Exclude<keyof RunnerProfile, 'sex'>) => (next: number | null) => setNumber(field, next);

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: '15px' }}>
        <PageHeader
          title="Réglages"
          subtitle="Enregistrés sur cet appareil et dans le dossier mémoire, appliqués à l'ouverture de chaque module. Le bouton Défaut d'une ligne revient à la valeur du profil du support." />
      </div>

      <div style={{ marginBottom: '15px' }}>
        <MemoryStatus detailed />
      </div>

      <div style={cardStyle}>
        <strong style={{ display: 'block', marginBottom: '10px', fontSize: '16px' }}>Réglages par support</strong>
        <table className="settings-sports">
          <thead>
            <tr>
              <th>Support</th>
              <th>Unité de vitesse</th>
              <th title="Vitesse qui sépare « en action » de « à l'arrêt » : temps actif, réussite des manœuvres, VMG">Seuil d'activité</th>
              <th>Taille du texte</th>
              <th title="Bornes du dégradé de couleur, pour les traces qui n'ont pas les leurs">Couleur de trace</th>
              <th title="À l'enregistrement : immobilité qui coupe la trace toute seule">Pause automatique</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ALL_SPORTS.map((sport) => {
              const s = view(sport);
              const p = SPORT_PROFILES[sport];
              const units = sport === 'running' ? RUNNING_UNITS : SAILING_UNITS;
              const overridden =
                s.isSpeedUnitOverridden || s.isThresholdOverridden || s.textScale !== 'normal' || s.isAutoPauseOverridden || s.speedRange !== null;
              // Bornes de couleur, saisies en km/h quand l'unité est une allure (min/km).
              const rangeUnit: SpeedUnit = s.speedUnit === 'minkm' ? 'kmh' : s.speedUnit;
              const sailing = sport !== 'running';
              const fallbackRange = sailing ? DEFAULT_SAILING_SPEED_RANGE_MS : DEFAULT_SPEED_RANGE_MS;
              const shownRange = s.speedRange ?? fallbackRange;
              // Voile sans réglage : champs vides, les bornes suivent l'allure de chaque session.
              const rangeEmpty = sailing && s.speedRange === null;
              const displayBound = (ms: number) => parseFloat(formatSpeedValue(toDisplaySpeed(ms, rangeUnit), rangeUnit));
              const setRangeBound = (bound: 'minMs' | 'maxMs', next: number | null) => {
                if (next === null) { setFor(sport, 'speedRange', null); return; }
                const candidate = { ...shownRange, [bound]: fromDisplaySpeed(next, rangeUnit) };
                if (candidate.maxMs > candidate.minMs) setFor(sport, 'speedRange', candidate);
              };
              const setAutoPauseField = (field: 'speedKmh' | 'delayS', next: number | null) => {
                if (next === null) { setFor(sport, 'autoPause', null); return; }
                setFor(sport, 'autoPause', {
                  speedMs: field === 'speedKmh' ? next / 3.6 : s.autoPause.speedMs,
                  delayS: field === 'delayS' ? next : s.autoPause.delayS,
                });
              };
              return (
                <tr key={sport}>
                  <td className="settings-sports__name">{p.label}</td>
                  <td data-label="Unité de vitesse">
                    <select value={s.speedUnit} onChange={(e) => setFor(sport, 'speedUnit', e.target.value as SpeedUnit)} className="ui-field ui-field--s">
                      {units.map((u) => <option key={u} value={u}>{SPEED_UNIT_LABEL[u]}</option>)}
                    </select>
                  </td>
                  <td data-label="Seuil d'activité">
                    <ThresholdField
                      value={s.activeThreshold}
                      unit={SPEED_UNIT_LABEL[p.thresholdUnit]}
                      isDefault={!s.isThresholdOverridden}
                      onCommit={(v) => setFor(sport, 'activeThreshold', v)} />
                  </td>
                  <td data-label="Taille du texte">
                    <select value={s.textScale} onChange={(e) => setFor(sport, 'textScale', e.target.value as TextScale)} className="ui-field ui-field--s">
                      {(Object.keys(TEXT_SCALE_FACTOR) as TextScale[]).map((t) => <option key={t} value={t}>{TEXT_SCALE_LABEL[t]}</option>)}
                    </select>
                  </td>
                  <td data-label="Couleur de trace">
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
                  </td>
                  <td data-label="Pause automatique">
                    <div className="settings-sports__pair">
                      <NumberField unit="km/h" step={0.1} min={0}
                        value={parseFloat((s.autoPause.speedMs * 3.6).toFixed(1))}
                        onCommit={(v) => setAutoPauseField('speedKmh', v)} />
                      <NumberField unit="s" step={5} min={0}
                        value={s.autoPause.delayS}
                        onCommit={(v) => setAutoPauseField('delayS', v)} />
                      {!s.isAutoPauseOverridden && <span className="settings-sports__mark">défaut</span>}
                    </div>
                  </td>
                  <td className="settings-sports__reset">
                    {overridden && (
                      <button
                        onClick={() => {
                          setFor(sport, 'speedUnit', null); setFor(sport, 'activeThreshold', null); setFor(sport, 'textScale', null);
                          setFor(sport, 'autoPause', null); setFor(sport, 'speedRange', null);
                        }}
                        style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}>
                        Défaut
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '6px' }}>
          Le seuil d'activité est saisi dans l'unité du profil du support : nœuds pour la voile, km/h pour la course.
          En course, il sert aux temps de pause : reprise à seuil + 1, pause sous seuil − 1.
          <br />
          Couleur de trace : gris sous la borne lente, dégradé du bleu au rouge jusqu'à la borne rapide. En voile, sans
          réglage, les bornes suivent l'allure de chaque session. Une trace peut avoir les siennes, réglées depuis sa
          légende : elles ne changent qu'elle et priment sur celles-ci.
        </div>
      </div>

      <div style={cardStyle}>
        <strong style={{ display: 'block', marginBottom: '10px', fontSize: '16px' }}>Course à pied</strong>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '14px', flexWrap: 'wrap' }}>
          <span style={{ width: '190px' }}>Terrain par défaut</span>
          <select value={running.terrain} onChange={(e) => setFor('running', 'terrain', e.target.value as TerrainType)} className="ui-field ui-field--s">
            {(Object.keys(ELEVATION_PRESETS) as TerrainType[]).map((t) => <option key={t} value={t}>{TERRAIN_LABEL[t]}</option>)}
          </select>
          <span style={{ color: 'var(--muted)', fontSize: '12px' }}>
            lissage {ELEVATION_PRESETS[running.terrain].smoothingSeconds} s, seuil de dénivelé {ELEVATION_PRESETS[running.terrain].minGainM} m
          </span>
        </label>
      </div>

      <div style={cardStyle}>
        <strong style={{ display: 'block', marginBottom: '4px', fontSize: '16px' }}>Coureur</strong>
        <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '0 0 10px' }}>
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
      </div>
    </div>
  );
}

/** Seuil d'activité : champ numérique avec indication du défaut. */
function ThresholdField({
  value, unit, isDefault, onCommit,
}: {
  value: number;
  unit: string;
  isDefault: boolean;
  onCommit: (next: number | null) => void;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <NumberField unit={unit} step={0.5} min={0} value={value} onCommit={onCommit} />
      {isDefault && <span style={{ color: 'var(--muted)', fontSize: '11px' }}>défaut</span>}
    </span>
  );
}

export default SettingsPage;
