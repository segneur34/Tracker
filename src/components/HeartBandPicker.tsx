import './HeartBandPicker.css';
import { useEffect, useRef, useState } from 'react';
import { zoneLabel } from './heartRateColors';
import SegmentedControl from './ui/SegmentedControl';
import {
  BAND_BPM_RANGE, BOUND_CHOICES, armableBand, bandLabel, boundBpm, outOfRangePick, picksBand,
  type BoundChoice, type BoundPick, type HeartBandPicks, type ZoneTarget,
} from '../recording/zoneAlert';

/** Zones et seuils du pratiquant pour l'activité ; `null` sans eux (seul « BPM » est alors proposé). */
type Zones = { bounds: readonly number[]; s1: number; s2: number } | null;

const SIDE_LABEL = { min: 'Mini', max: 'Maxi' } as const;

const choiceLabel = (choice: BoundChoice): string =>
  choice === 'aucune' ? 'aucune' : choice === 's1' ? 'S1' : choice === 's2' ? 'S2' : choice === 'bpm' ? 'BPM' : zoneLabel(Number(choice) as ZoneTarget);

/** Champ du BPM d'une borne : la valeur du choix, modifiable ; une frappe passe la borne en « BPM ». */
function BoundField({ side, bpm, onType }: { side: 'min' | 'max'; bpm: number | null; onType: (bpm: number | null) => void }) {
  const [draft, setDraft] = useState(bpm === null ? '' : String(bpm));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(bpm === null ? '' : String(bpm));
  }, [bpm]);
  return (
    <label className="heart-band__field">
      <input type="number" inputMode="numeric" step={1} value={draft} aria-label={`${SIDE_LABEL[side]} en bpm`}
        className="ui-field ui-field--s num"
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parseInt(e.target.value, 10);
          onType(Number.isNaN(parsed) ? null : parsed);
        }}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setDraft(bpm === null ? '' : String(bpm)); }} />
      <span>bpm</span>
    </label>
  );
}

/**
 * Bornes de la « course à bornes » (Entraînement, 05/11) : un mini et/ou un
 * maxi, chacun choisi par un bouton glissant « aucune · Z1 … Z5 · S1 · S2 ·
 * BPM » ; une zone remplit le BPM de son bord (mini : son bas ; maxi : son
 * haut), S1 et S2 le seuil du pratiquant, « BPM » se saisit, et le champ reste
 * modifiable. Le même sur Enregistrer, avant le départ, et dans la fenêtre
 * « Modifier » de l'enregistrement en cours.
 */
export default function HeartBandPicker({ picks, onChange, zones }: {
  picks: HeartBandPicks;
  onChange: (picks: HeartBandPicks) => void;
  zones: Zones;
}) {
  const band = picksBand(picks, zones);
  const row = (side: 'min' | 'max') => {
    const pick = picks[side];
    // Sans zones du pratiquant, ni zone ni seuil à proposer.
    const choices = BOUND_CHOICES[side].filter((c) => zones !== null || c === 'aucune' || c === 'bpm');
    const bpm = side === 'min' ? band.minBpm : band.maxBpm;
    const set = (next: BoundPick) => onChange({ ...picks, [side]: next });
    return (
      <div className="heart-band__row">
        <span className="heart-band__side">{SIDE_LABEL[side]}</span>
        <SegmentedControl label={SIDE_LABEL[side]} value={choices.includes(pick.choice) ? pick.choice : 'aucune'}
          items={choices.map((c) => ({ key: c, label: choiceLabel(c) }))}
          onChange={(choice) => set({ choice, bpm: choice === 'bpm' ? pick.bpm ?? bpm : boundBpm(choice, side, zones) })} />
        {pick.choice !== 'aucune' && (
          <BoundField side={side} bpm={pick.choice === 'bpm' ? pick.bpm : bpm} onType={(typed) => set({ choice: 'bpm', bpm: typed })} />
        )}
        {outOfRangePick(pick) && (
          <span className="heart-band__note heart-band__note--warn">entre {BAND_BPM_RANGE.min} et {BAND_BPM_RANGE.max}</span>
        )}
      </div>
    );
  };
  const armed = armableBand(picks, zones);
  const empty = picks.min.choice === 'aucune' && picks.max.choice === 'aucune';
  return (
    <div className="heart-band">
      {row('min')}
      {row('max')}
      <span className={armed || empty ? 'heart-band__note' : 'heart-band__note heart-band__note--warn'}>
        {armed
          ? `Bips hors de ${bandLabel(armed)} : deux bips au-dessus, trois en dessous, un au retour.`
          : empty
            ? 'Aucune borne : pas de bips.'
            : 'Le mini dépasse le maxi, ou un BPM manque ou est hors de portée : pas de bips.'}
      </span>
    </div>
  );
}
