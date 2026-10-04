import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import './BeepCurveEditor.css';
import Button from './ui/Button';
import { knotsToMs } from '../core/units';
import { useRecorder } from '../hooks/useRecorder';
import { BEEP_LONG_MS, getBeeper } from '../platform/beeper';
import {
  BEEP_CURVE_LIMITS, MARK_GUIDE_DEFAULTS, SIMULATED_APPROACH_KN, beepIntervalMs, beepStartM, sanitizeMarkGuide, validationRadiusM,
  type BeepPoint, type MarkGuideSettings,
} from '../recording/markGuide';

/**
 * Réglage des bips d'approche des balises, pour une activité de voile
 * (Réglages) ou pour un parcours (Itinéraires) : une courbe à points, distance à la balise en abscisse, intervalle entre deux
 * bips en ordonnée (choix de l'utilisateur). On tire un point au doigt ou à
 * la souris ; un toucher ailleurs sur le graphe en ajoute un ; le point
 * choisi se retire. Le point le plus lointain fixe le début des bips, le plus
 * proche la validation. Les valeurs se lisent et se saisissent aussi sous le
 * graphe. « Écouter » joue une approche simulée.
 */

const L = BEEP_CURVE_LIMITS;

/** Géométrie du graphe, dans les unités de son `viewBox`. */
const W = 320;
const H = 170;
const PAD = { left: 40, right: 14, top: 10, bottom: 26 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
/** Déplacement du doigt, en unités du graphe, sous lequel un toucher n'est pas un glisser. */
const TAP_SLOP = 6;
/** Pas de l'approche simulée, en millisecondes. */
const LISTEN_STEP_MS = 100;

/** Couleurs de données du graphe (en dur, comme celles des autres graphes). */
const CURVE_COLOR = '#1565c0';
const VALIDATION_COLOR = '#e65100';

interface Axes {
  xMax: number;
  yMax: number;
}

/** Échelle du graphe : un peu au-delà du début des bips et de l'intervalle le plus long, pour pouvoir les tirer plus loin. */
const axesFor = (curve: BeepPoint[]): Axes => {
  const start = curve[curve.length - 1].distanceM;
  const longest = Math.max(...curve.map((p) => p.intervalMs));
  return {
    xMax: Math.min(L.maxDistanceM, Math.max(100, Math.ceil((start * 1.25) / 50) * 50)),
    yMax: Math.min(L.maxIntervalMs, Math.max(1000, Math.ceil((longest * 1.2) / 500) * 500)),
  };
};

const ticks = (max: number, step: number): number[] => Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
const xStep = (xMax: number): number => (xMax <= 300 ? 50 : xMax <= 600 ? 100 : xMax <= 1200 ? 250 : 500);
const yStep = (yMax: number): number => (yMax <= 3000 ? 500 : 1000);

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const seconds = (ms: number): string => `${parseFloat((ms / 1000).toFixed(2))} s`;
const sameGuide = (a: MarkGuideSettings, b: MarkGuideSettings): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Saisie d'un nombre, rangée à la sortie du champ ou sur Entrée : une valeur à moitié tapée ne réordonne pas la courbe. */
function CommitField({ value, unit, step, label, onCommit }: {
  value: number;
  unit: string;
  step: number;
  label: string;
  onCommit: (next: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const parsed = parseFloat(text.replace(',', '.'));
    setText(null);
    if (isFinite(parsed) && parsed !== value) onCommit(parsed);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };
  return (
    <label className="beep-editor__field">
      <input type="number" inputMode="decimal" step={step} aria-label={label} className="ui-field ui-field--s num"
        value={text ?? String(value)} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKey} />
      <span>{unit}</span>
    </label>
  );
}

function BeepCurveEditor({
  value, overridden, onChange, fallback = MARK_GUIDE_DEFAULTS, resetLabel = 'Par défaut', fallbackMark = 'défaut',
}: {
  value: MarkGuideSettings;
  overridden: boolean;
  /** Réglage nettoyé, ou `null` s'il revient à `fallback`. */
  onChange: (next: MarkGuideSettings | null) => void;
  /** Réglage qui vaut sans surcharge : le défaut dans Réglages, celui de l'activité pour un parcours. */
  fallback?: MarkGuideSettings;
  /** Bouton qui revient à `fallback`, et mention affichée quand il s'applique. */
  resetLabel?: string;
  fallbackMark?: string;
}) {
  const idle = useRecorder().status === 'idle';
  /** Courbe pendant un glisser, rangée au lâcher seulement. */
  const [draft, setDraft] = useState<BeepPoint[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  /** Échelle figée pendant un glisser : le point ne fuit pas sous le doigt. */
  const [frozenAxes, setFrozenAxes] = useState<Axes | null>(null);
  const drag = useRef<{ index: number | null; axes: Axes; x: number; y: number; moved: boolean } | null>(null);
  const listenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const curve = draft ?? value.curve;
  const axes = frozenAxes ?? axesFor(curve);
  const radiusM = curve[0].distanceM;
  const startM = curve[curve.length - 1].distanceM;
  const xOf = (d: number) => PAD.left + (d / axes.xMax) * PLOT_W;
  const yOf = (ms: number) => PAD.top + PLOT_H - (ms / axes.yMax) * PLOT_H;

  const commit = (next: Partial<MarkGuideSettings>) => {
    const guide = sanitizeMarkGuide({ ...value, ...next });
    if (!guide) return;
    onChange(sameGuide(guide, fallback) ? null : guide);
  };

  /** Position du pointeur, en unités du graphe et en valeurs. */
  const locate = (e: ReactPointerEvent<SVGSVGElement>, a: Axes) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    return { x, y, distanceM: ((x - PAD.left) / PLOT_W) * a.xMax, intervalMs: ((PAD.top + PLOT_H - y) / PLOT_H) * a.yMax };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const hit = (e.target as Element).closest('[data-point]');
    const index = hit ? Number(hit.getAttribute('data-point')) : null;
    const a = axesFor(curve);
    const { x, y } = locate(e, a);
    drag.current = { index, axes: a, x, y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (index !== null) {
      setSelected(index);
      setFrozenAxes(a);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.index === null) return;
    const p = locate(e, d.axes);
    if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < TAP_SLOP) return;
    d.moved = true;
    const i = d.index;
    // Un point reste entre ses voisins : l'ordre des distances ne change pas pendant le glisser.
    const lo = i > 0 ? curve[i - 1].distanceM + 1 : L.minDistanceM;
    const hi = i < curve.length - 1 ? curve[i + 1].distanceM - 1 : Math.min(L.maxDistanceM, d.axes.xMax);
    const moved: BeepPoint = {
      distanceM: Math.round(clamp(p.distanceM, lo, hi)),
      intervalMs: Math.round(clamp(p.intervalMs, L.minIntervalMs, Math.min(L.maxIntervalMs, d.axes.yMax)) / 10) * 10,
    };
    setDraft(curve.map((q, k) => (k === i ? moved : q)));
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.index !== null) {
      if (draft) commit({ curve: draft });
      setDraft(null);
      setFrozenAxes(null);
      return;
    }
    // Toucher sur le graphe, hors d'un point : un point de plus, s'il en reste la place.
    const p = locate(e, d.axes);
    if (Math.hypot(p.x - d.x, p.y - d.y) >= TAP_SLOP || curve.length >= L.maxPoints) return;
    const distanceM = Math.round(clamp(p.distanceM, L.minDistanceM, L.maxDistanceM));
    if (curve.some((q) => q.distanceM === distanceM)) return;
    const added = { distanceM, intervalMs: Math.round(clamp(p.intervalMs, L.minIntervalMs, L.maxIntervalMs) / 10) * 10 };
    const next = [...curve, added].sort((a, b) => a.distanceM - b.distanceM);
    commit({ curve: next });
    setSelected(next.indexOf(added));
  };

  const removeSelected = () => {
    if (selected === null || curve.length <= L.minPoints) return;
    commit({ curve: curve.filter((_, k) => k !== selected) });
    setSelected(null);
  };

  const setPoint = (index: number, patch: Partial<BeepPoint>) => {
    const next = curve.map((q, k) => (k === index ? { ...q, ...patch } : q));
    // Deux points à la même distance : le nettoyage n'en garderait qu'un, la saisie est refusée.
    if (new Set(next.map((q) => Math.round(clamp(q.distanceM, L.minDistanceM, L.maxDistanceM)))).size < next.length) return;
    commit({ curve: next });
    setSelected(null);
  };

  // --- Écouter : une approche simulée, du début des bips à la validation ---

  const stopListening = () => {
    if (listenTimer.current !== null) clearTimeout(listenTimer.current);
    listenTimer.current = null;
    void getBeeper().stop().catch(() => {});
    setPlaying(false);
  };

  const listen = () => {
    const beeper = getBeeper();
    const speedMs = knotsToMs(SIMULATED_APPROACH_KN);
    const settings = value;
    const from = beepStartM(settings);
    const to = validationRadiusM(settings);
    const startedAt = Date.now();
    setPlaying(true);
    const tick = () => {
      const distanceM = from - (speedMs * (Date.now() - startedAt)) / 1000;
      if (distanceM <= to) {
        void beeper.validated(settings.vibrate).catch(() => {});
        listenTimer.current = setTimeout(stopListening, BEEP_LONG_MS + 200);
        return;
      }
      void beeper.setInterval(beepIntervalMs(distanceM, settings), settings.vibrate).catch(() => {});
      listenTimer.current = setTimeout(tick, LISTEN_STEP_MS);
    };
    tick();
  };

  // Approche arrêtée en quittant la page.
  useEffect(() => () => {
    if (listenTimer.current !== null) {
      clearTimeout(listenTimer.current);
      void getBeeper().stop().catch(() => {});
    }
  }, []);

  const listenSeconds = Math.round((startM - radiusM) / knotsToMs(SIMULATED_APPROACH_KN));

  return (
    <div className="beep-editor">
      <svg className="beep-editor__chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Courbe des bips : intervalle entre deux bips selon la distance à la balise"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setDraft(null); setFrozenAxes(null); }}>
        {/* Zone de validation, à gauche de la distance la plus proche. */}
        <rect x={PAD.left} y={PAD.top} width={Math.max(0, xOf(radiusM) - PAD.left)} height={PLOT_H} fill={VALIDATION_COLOR} opacity={0.1} />
        {ticks(axes.xMax, xStep(axes.xMax)).map((d) => (
          <g key={`x${d}`}>
            <line className="beep-editor__grid" x1={xOf(d)} x2={xOf(d)} y1={PAD.top} y2={PAD.top + PLOT_H} />
            <text className="beep-editor__tick" x={xOf(d)} y={H - 8} textAnchor="middle">{d} m</text>
          </g>
        ))}
        {ticks(axes.yMax, yStep(axes.yMax)).map((ms) => (
          <g key={`y${ms}`}>
            <line className="beep-editor__grid" x1={PAD.left} x2={PAD.left + PLOT_W} y1={yOf(ms)} y2={yOf(ms)} />
            <text className="beep-editor__tick" x={PAD.left - 5} y={yOf(ms) + 3} textAnchor="end">{seconds(ms)}</text>
          </g>
        ))}
        <polyline points={curve.map((p) => `${xOf(p.distanceM)},${yOf(p.intervalMs)}`).join(' ')}
          fill="none" stroke={CURVE_COLOR} strokeWidth={2} />
        {curve.map((p, i) => (
          <g key={i} data-point={i} className="beep-editor__point">
            {/* Cible large et invisible : un doigt n'a pas à viser un rond de 6 px. */}
            <circle cx={xOf(p.distanceM)} cy={yOf(p.intervalMs)} r={14} fill="transparent" />
            <circle cx={xOf(p.distanceM)} cy={yOf(p.intervalMs)} r={selected === i ? 7 : 5.5}
              fill={selected === i ? CURVE_COLOR : '#ffffff'} stroke={i === 0 ? VALIDATION_COLOR : CURVE_COLOR} strokeWidth={2} />
          </g>
        ))}
      </svg>
      <p className="beep-editor__hint">
        Bips dès {startM} m de la balise, de plus en plus rapprochés ; validée à {radiusM} m, d'un bip long. Tirez un point pour le
        déplacer, touchez le graphe pour en ajouter un ({L.maxPoints} au plus).
      </p>

      <ol className="beep-editor__points">
        <li className="beep-editor__row beep-editor__row--head" aria-hidden="true">
          <span />
          <span>Distance</span>
          <span>Entre deux bips</span>
        </li>
        {curve.map((p, i) => (
          <li key={`${i}-${p.distanceM}-${p.intervalMs}`} className={selected === i ? 'beep-editor__row beep-editor__row--selected' : 'beep-editor__row'}>
            <button type="button" className="beep-editor__pick" onClick={() => setSelected(selected === i ? null : i)}
              aria-pressed={selected === i}>
              {i === 0 ? 'Validation' : i === curve.length - 1 ? 'Début' : `Point ${i + 1}`}
            </button>
            <CommitField value={p.distanceM} unit="m" step={5} label={`Distance du point ${i + 1}`}
              onCommit={(v) => setPoint(i, { distanceM: v })} />
            <CommitField value={parseFloat((p.intervalMs / 1000).toFixed(2))} unit="s" step={0.05} label={`Intervalle entre deux bips, point ${i + 1}`}
              onCommit={(v) => setPoint(i, { intervalMs: v * 1000 })} />
          </li>
        ))}
      </ol>

      <div className="beep-editor__actions">
        <label className="beep-editor__check">
          <input type="checkbox" checked={value.vibrate} onChange={(e) => commit({ vibrate: e.target.checked })} />
          Vibrer aussi
        </label>
        {playing ? (
          <Button size="s" onClick={stopListening}>Arrêter</Button>
        ) : (
          <Button size="s" onClick={listen} disabled={!idle}
            title={idle ? `Approche à ${SIMULATED_APPROACH_KN} nœuds, ${listenSeconds} s` : 'Pas pendant un enregistrement'}>
            Écouter
          </Button>
        )}
        <Button size="s" variant="ghost" onClick={removeSelected} disabled={selected === null || curve.length <= L.minPoints}>
          Retirer le point
        </Button>
        {overridden && <Button size="s" variant="ghost" onClick={() => { onChange(null); setSelected(null); }}>{resetLabel}</Button>}
        {!overridden && <span className="beep-editor__mark">{fallbackMark}</span>}
      </div>
    </div>
  );
}

export default BeepCurveEditor;
