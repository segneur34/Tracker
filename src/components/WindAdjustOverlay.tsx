import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { pointerWindDeg, windDegFromText, type PolarBin } from '../sailing/wind';
import SpeedPolarChart from './SpeedPolarChart';
import Button from './ui/Button';

/** Côté du dessin de la grande boussole, en unités de son `viewBox`. */
const DIAL = 200;
const C = DIAL / 2;
/** Rayon du cercle où se tient la poignée de la flèche. */
const HANDLE_R = 78;

interface WindAdjustOverlayProps {
  /** Vent retenu, en degrés (d'où il vient) ; `null` tant qu'aucun n'est connu. */
  windDeg: number | null;
  /** Vent calculé, et sa confiance de 0 à 1, pour mémoire ; `null` sans estimation. */
  autoWind: number | null;
  confidence: number | null;
  /** Vrai quand le vent retenu est saisi, faux quand c'est le calculé. */
  manual: boolean;
  /** Écrit le vent saisi dans le brouillon ; `null` revient au calculé. */
  onChange: (deg: number | null) => void;
  onClose: () => void;
  /** Polaire de vitesse à un vent donné, dans l'unité de l'activité. */
  polarAt: (deg: number) => PolarBin[];
  unitSymbol: string;
}

/**
 * Réglage du vent posé sur la carte d'une analyse de voile (bouton « Régler »
 * de l'onglet « général », demande du 22/10) : une grande boussole
 * translucide, la trace visible dessous, dont on tire la flèche à la souris ou
 * au doigt ; un bandeau pour saisir l'angle, l'inverser ou revenir au calculé ;
 * la polaire à la demande, qui suit la flèche. Le vent n'est écrit qu'au
 * lâcher de la flèche, et à Entrée ou en quittant le champ de l'angle :
 * manœuvres, VMG et vent ne se recalculent qu'une fois, pas à chaque chiffre.
 * Hors de la boussole et du bandeau, la carte reste maniable.
 */
function WindAdjustOverlay({ windDeg, autoWind, confidence, manual, onChange, onClose, polarAt, unitSymbol }: WindAdjustOverlayProps) {
  /** Angle pendant qu'on tire la flèche, avant d'être écrit. */
  const [dragDeg, setDragDeg] = useState<number | null>(null);
  const [polarShown, setPolarShown] = useState(false);
  const dialRef = useRef<SVGSVGElement>(null);
  const shownDeg = dragDeg ?? windDeg ?? autoWind ?? 0;
  const polar = useMemo(() => (polarShown ? polarAt(shownDeg) : []), [polarShown, polarAt, shownDeg]);
  /** Texte du champ de l'angle, à part du vent retenu : il se vide et se retape sans être réécrit. */
  const fieldValue = dragDeg ?? windDeg;
  const [text, setText] = useState(() => (fieldValue === null ? '' : String(fieldValue)));
  const [prevFieldValue, setPrevFieldValue] = useState(fieldValue);
  if (fieldValue !== prevFieldValue) {
    setPrevFieldValue(fieldValue);
    setText(fieldValue === null ? '' : String(fieldValue));
  }
  const commitText = () => {
    const deg = windDegFromText(text);
    if (deg === null) {
      setText(fieldValue === null ? '' : String(fieldValue));
      return;
    }
    setText(String(deg));
    if (deg !== windDeg) onChange(deg);
  };

  const degAt = (e: PointerEvent<SVGSVGElement>): number | null => {
    const rect = dialRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    // Trop près du centre, l'angle n'est que du bruit.
    if (Math.hypot(dx, dy) < rect.width * 0.08) return null;
    return pointerWindDeg(dx, dy);
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const deg = degAt(e);
    setDragDeg(deg ?? shownDeg);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (dragDeg === null) return;
    const deg = degAt(e);
    if (deg !== null && deg !== dragDeg) setDragDeg(deg);
  };
  const onPointerUp = () => {
    if (dragDeg === null) return;
    if (dragDeg !== windDeg) onChange(dragDeg);
    setDragDeg(null);
  };

  const rad = (shownDeg * Math.PI) / 180;
  const hx = C + HANDLE_R * Math.sin(rad);
  const hy = C - HANDLE_R * Math.cos(rad);
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);

  return (
    <div className="an-map-tool an-wind">
      <div className="an-wind__bar">
        <strong className="an-wind__value num">Vent {shownDeg}°</strong>
        <span className="an-wind__source">
          {manual ? 'saisi' : 'calculé'}
          {autoWind !== null && manual && ` · calculé ${autoWind}°`}
          {confidence !== null && !manual && ` · confiance ${Math.round(confidence * 100)} %`}
        </span>
        <label className="an-wind__field">
          <input type="number" min={0} max={359} className="ui-field ui-field--s num" aria-label="Vent en degrés"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText(); } }} />°
        </label>
        <Button size="s" onClick={() => onChange((shownDeg + 180) % 360)}>Inverser</Button>
        {manual && <Button size="s" onClick={() => onChange(null)} title="Revenir au vent calculé">Calculé</Button>}
        <Button size="s" aria-pressed={polarShown} onClick={() => setPolarShown(!polarShown)}>Polaire</Button>
        <Button size="s" variant="primary" onClick={onClose}>Terminé</Button>
      </div>

      <svg ref={dialRef} className="an-wind__dial" viewBox={`0 0 ${DIAL} ${DIAL}`} role="slider"
        aria-label="Direction du vent" aria-valuemin={0} aria-valuemax={359} aria-valuenow={shownDeg}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDragDeg(null)}>
        <circle cx={C} cy={C} r={C - 2} fill="rgba(255,255,255,0.45)" stroke="#333" strokeWidth={2} />
        {ticks.map((t) => {
          const a = (t * Math.PI) / 180;
          const inner = t % 90 === 0 ? C - 16 : C - 10;
          return <line key={t} x1={C + inner * Math.sin(a)} y1={C - inner * Math.cos(a)} x2={C + (C - 3) * Math.sin(a)} y2={C - (C - 3) * Math.cos(a)} stroke="#333" strokeWidth={t % 90 === 0 ? 2 : 1} />;
        })}
        {(['N', 'E', 'S', 'O'] as const).map((l, i) => {
          const a = (i * 90 * Math.PI) / 180;
          return <text key={l} x={C + (C - 26) * Math.sin(a)} y={C - (C - 26) * Math.cos(a) + 5} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#333">{l}</text>;
        })}
        {/* Flèche du vent, du bord vers le centre ; la poignée au bout se tire. */}
        <line x1={hx} y1={hy} x2={C + 12 * Math.sin(rad)} y2={C - 12 * Math.cos(rad)} stroke="#d32f2f" strokeWidth={4} strokeLinecap="round" />
        <polygon fill="#d32f2f"
          points={`${C},${C} ${C + 16 * Math.sin(rad) - 7 * Math.cos(rad)},${C - 16 * Math.cos(rad) - 7 * Math.sin(rad)} ${C + 16 * Math.sin(rad) + 7 * Math.cos(rad)},${C - 16 * Math.cos(rad) + 7 * Math.sin(rad)}`} />
        <circle cx={hx} cy={hy} r={11} fill="#d32f2f" stroke="#fff" strokeWidth={3} style={{ cursor: 'grab' }} />
      </svg>

      {polarShown && (
        <div className="an-wind__polar">
          <SpeedPolarChart data={polar} unitSymbol={unitSymbol} compact />
        </div>
      )}
    </div>
  );
}

export default WindAdjustOverlay;
