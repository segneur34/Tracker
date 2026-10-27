import Button from './ui/Button';
import { IconArrowDown, IconArrowUp, IconClose } from './icons';
import {
  INTERVAL_FREE_LABELS, INTERVAL_LIMITS, formatIntervalClock, workoutDurationS, workoutFromBlocks, workoutLabel,
  type IntervalBlock, type IntervalFreeLabel,
} from '../recording/intervalTimer';
import './IntervalCard.css';

/**
 * Éditeur d'une séance du compteur, bloc par bloc (24/10) : chaque bloc se
 * règle, monte, descend ou se retire ; des ajouts d'un geste posent un
 * échauffement en tête (26/10), une série, une récupération ou un retour au
 * calme à la fin. Partagé par la page Séances
 * et la carte du compteur d'Enregistrer ; la séance se lit par `workoutFromBlocks`.
 */

const range = (from: number, to: number, step = 1): number[] =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

const REPS = range(INTERVAL_LIMITS.reps.min, INTERVAL_LIMITS.reps.max);
const MINUTES = range(0, Math.floor(INTERVAL_LIMITS.workS.max / 60));
/** Secondes proposées, de 5 en 5 : la précision d'une séance de fractionné. */
const SECONDS = range(0, 55, 5);

/** Une durée en minutes et secondes, deux listes. */
export function DurationField({ label, seconds, onChange }: { label: string; seconds: number; onChange: (s: number) => void }) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  // Une valeur gardée hors du pas de 5 s reste proposée telle quelle.
  const secondChoices = SECONDS.includes(rest) ? SECONDS : [...SECONDS, rest].sort((a, b) => a - b);
  return (
    <div className="ivl-field">
      <span className="ui-eyebrow">{label}</span>
      <span className="ivl-field__pair">
        <select value={minutes} aria-label={`${label}, minutes`} className="ui-field" onChange={(e) => onChange(Number(e.target.value) * 60 + rest)}>
          {MINUTES.map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
        <select value={rest} aria-label={`${label}, secondes`} className="ui-field" onChange={(e) => onChange(minutes * 60 + Number(e.target.value))}>
          {secondChoices.map((s) => <option key={s} value={s}>{String(s).padStart(2, '0')} s</option>)}
        </select>
      </span>
    </div>
  );
}

/**
 * Ajouts d'un geste : l'échauffement se pose en tête de la séance, les
 * autres à la fin (26/10 : « 3 × 3 min / 1 min » et « 10 × 30/30 » retirés).
 */
const QUICK_BLOCKS: { label: string; block: IntervalBlock; atStart?: boolean }[] = [
  { label: 'Échauffement 10 min', block: { kind: 'libre', label: 'Échauffement', durationS: 600 }, atStart: true },
  { label: 'Série', block: { kind: 'series', reps: 5, workS: 60, restS: 60 } },
  { label: 'Récupération 3 min', block: { kind: 'libre', label: 'Récupération', durationS: 180 } },
  { label: 'Retour au calme 10 min', block: { kind: 'libre', label: 'Retour au calme', durationS: 600 } },
];

/** Les blocs après un ajout d'un geste : en tête ou à la fin selon le bloc. */
const withQuickBlock = (blocks: IntervalBlock[], quick: { block: IntervalBlock; atStart?: boolean }): IntervalBlock[] =>
  quick.atStart ? [quick.block, ...blocks] : [...blocks, quick.block];

interface WorkoutBlocksEditorProps {
  blocks: IntervalBlock[];
  onChange: (blocks: IntervalBlock[]) => void;
}

function WorkoutBlocksEditor({ blocks, onChange }: WorkoutBlocksEditorProps) {
  const workout = workoutFromBlocks(blocks);
  const several = blocks.length > 1;
  const full = blocks.length >= INTERVAL_LIMITS.blocks.max;
  const update = (index: number, block: IntervalBlock) => onChange(blocks.map((b, i) => (i === index ? block : b)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...blocks];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };
  const remove = (index: number) => onChange(blocks.filter((_, i) => i !== index));
  // Rang de chaque bloc de séries, pour les nommer « Série 2 » quand il y en a plusieurs.
  const seriesCount = blocks.filter((b) => b.kind === 'series').length;
  let seriesRank = 0;

  return (
    <div className="ivl-blocks">
      <ol className="ivl-blocks__list" aria-label="Blocs de la séance">
        {blocks.map((block, index) => {
          if (block.kind === 'series') seriesRank++;
          const title = block.kind === 'series' ? (seriesCount > 1 ? `Série ${seriesRank}` : 'Série') : block.label;
          return (
            <li key={index} className={`ivl-block ivl-block--${block.kind}`}>
              {several && (
                <div className="ivl-block__head">
                  <span className="ivl-block__title">{title}</span>
                  <span className="ivl-block__tools">
                    <button type="button" className="ivl-block__tool" aria-label={`Monter : ${title}`} disabled={index === 0} onClick={() => move(index, -1)}>
                      <IconArrowUp size={16} />
                    </button>
                    <button type="button" className="ivl-block__tool" aria-label={`Descendre : ${title}`} disabled={index === blocks.length - 1} onClick={() => move(index, 1)}>
                      <IconArrowDown size={16} />
                    </button>
                    <button type="button" className="ivl-block__tool" aria-label={`Retirer : ${title}`} onClick={() => remove(index)}>
                      <IconClose size={16} />
                    </button>
                  </span>
                </div>
              )}
              {block.kind === 'series' ? (
                <div className="ivl-fields">
                  <div className="ivl-field">
                    <span className="ui-eyebrow">Répétitions</span>
                    <select value={block.reps} aria-label="Répétitions" className="ui-field" onChange={(e) => update(index, { ...block, reps: Number(e.target.value) })}>
                      {REPS.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <DurationField label="Travail" seconds={block.workS} onChange={(workS) => update(index, { ...block, workS })} />
                  <DurationField label="Repos" seconds={block.restS} onChange={(restS) => update(index, { ...block, restS })} />
                </div>
              ) : (
                <div className="ivl-fields">
                  <div className="ivl-field">
                    <span className="ui-eyebrow">Bloc</span>
                    <select value={block.label} aria-label="Nom du bloc" className="ui-field"
                      onChange={(e) => update(index, { ...block, label: e.target.value as IntervalFreeLabel })}>
                      {INTERVAL_FREE_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <DurationField label="Durée" seconds={block.durationS} onChange={(durationS) => update(index, { ...block, durationS })} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="ivl-quick" aria-label="Ajouter un bloc">
        <span className="ui-eyebrow">Ajouter</span>
        {QUICK_BLOCKS.map((quick) => (
          <Button key={quick.label} size="s" disabled={full} onClick={() => onChange(withQuickBlock(blocks, quick))}>+ {quick.label}</Button>
        ))}
      </div>
      <p className="ivl-summary">
        {workout
          ? <>{workoutLabel(workout)} · {formatIntervalClock(workoutDurationS(workout))} en tout</>
          : !blocks.some((b) => b.kind === 'series')
            ? 'Une séance compte au moins un bloc de séries.'
            : `Travail de ${INTERVAL_LIMITS.workS.min} s à ${INTERVAL_LIMITS.workS.max / 60} min, repos de ${INTERVAL_LIMITS.restS.max / 60} min au plus, ${INTERVAL_LIMITS.blocks.max} blocs au plus.`}
      </p>
    </div>
  );
}

export default WorkoutBlocksEditor;
