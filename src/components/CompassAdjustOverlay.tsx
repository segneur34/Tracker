import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { pointerWindDeg, windDegFromText } from '../sailing/wind';
import Button from './ui/Button';

/** Côté du dessin de la grande boussole, en unités de son `viewBox`. */
const DIAL = 200;
const C = DIAL / 2;
/** Marge du dessin autour du cadran, pour que la poignée à cheval sur le cercle ne soit pas rognée. */
const MARGIN = 28;
/** Rayon de la poignée de la flèche : son centre est sur le trait du cercle, le doigt ne cache pas la flèche. */
const HANDLE_R = 98;
/** Rayon de la pointe de la flèche des vagues, qui part du centre et s'arrête avant la poignée. */
const OUTWARD_TIP_R = 72;
/** Rayon où la flèche du vent commence, avant la poignée. */
const INWARD_START_R = 80;
const CARDINALS = ['N', 'E', 'S', 'O'] as const;

export interface CompassAdjustTexts {
  /** Titre en gras du bandeau, à partir de l'angle montré (« Vent 245° »). */
  value: (deg: number) => string;
  /** Nom du champ de l'angle. */
  field: string;
  /** Nom de la boussole pour les lecteurs d'écran. */
  dial: string;
  /** Infobulle du bouton « Calculé ». */
  reset: string;
}

interface CompassAdjustOverlayProps {
  /** Angle retenu, en degrés ; `null` tant qu'aucun n'est connu. */
  value: number | null;
  /** Angle calculé, pour la flèche tant que rien n'est retenu ; `null` sans estimation. */
  autoValue: number | null;
  /** Vrai quand « Calculé » doit être proposé (une valeur saisie remplace le calculé). */
  canReset: boolean;
  /** Écrit l'angle dans le brouillon ; `null` revient au calculé. */
  onChange: (deg: number | null) => void;
  onClose: () => void;
  /**
   * `versCentre` : le vent, flèche du bord vers le centre, pointe au centre.
   * `versBord` : un cap vers lequel on va, flèche du centre vers le bord, pointe au bord.
   */
  arrow: 'versCentre' | 'versBord';
  texts: CompassAdjustTexts;
  /** Origine de l'angle (« saisi », « calculé · confiance… »), à droite du titre. */
  source: ReactNode;
  /** Boutons en plus, entre « Calculé » et « Terminé ». */
  extraButtons?: ReactNode;
  /** Pièce posée sous le bandeau et la boussole, à partir de l'angle montré (la polaire du vent). */
  below?: (shownDeg: number) => ReactNode;
}

/**
 * Réglage d'un angle posé sur la carte d'une analyse : une grande boussole
 * translucide, la trace visible dessous, dont on tire la flèche à la souris ou
 * au doigt par sa poignée, à cheval sur le cercle ; un bandeau pour saisir
 * l'angle, l'inverser ou revenir au calculé. L'angle n'est écrit qu'au lâcher
 * de la flèche, et à Entrée ou en quittant le champ : les calculs qui en
 * dépendent ne se refont qu'une fois, pas à chaque chiffre. Hors de la
 * boussole et du bandeau, la carte reste maniable. Sert au vent (voile,
 * `WindAdjustOverlay`) et au sens des vagues (surf, `surf/WaveSenseOverlay`) ;
 * les classes `an-wind*` sont communes aux deux.
 */
function CompassAdjustOverlay({ value, autoValue, canReset, onChange, onClose, arrow, texts, source, extraButtons, below }: CompassAdjustOverlayProps) {
  /** Angle pendant qu'on tire la flèche, avant d'être écrit. */
  const [dragDeg, setDragDeg] = useState<number | null>(null);
  const dialRef = useRef<SVGSVGElement>(null);
  const shownDeg = dragDeg ?? value ?? autoValue ?? 0;
  /** Texte du champ de l'angle, à part de l'angle retenu : il se vide et se retape sans être réécrit. */
  const fieldValue = dragDeg ?? value;
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
    if (deg !== value) onChange(deg);
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
    if (dragDeg !== value) onChange(dragDeg);
    setDragDeg(null);
  };

  const rad = (shownDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const hx = C + HANDLE_R * sin;
  const hy = C - HANDLE_R * cos;
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
  /** Du bord vers le centre (vent) : trait de la poignée à 12 du centre, pointe au centre. Du centre vers le bord : l'inverse. */
  const outward = arrow === 'versBord';
  const lineStartR = outward ? 0 : INWARD_START_R;
  const lineEndR = outward ? OUTWARD_TIP_R - 16 : 12;
  const tipR = outward ? OUTWARD_TIP_R : 0;
  const baseR = outward ? OUTWARD_TIP_R - 16 : 16;
  const point = (r: number, side: number) => `${C + r * sin + side * cos},${C - r * cos + side * sin}`;
  const arrowHead = outward
    ? `${point(tipR, 0)} ${point(baseR, -7)} ${point(baseR, 7)}`
    : `${C},${C} ${C + 16 * sin - 7 * cos},${C - 16 * cos - 7 * sin} ${C + 16 * sin + 7 * cos},${C - 16 * cos + 7 * sin}`;

  return (
    <div className="an-map-tool an-wind">
      <div className="an-wind__bar">
        <strong className="an-wind__value num">{texts.value(shownDeg)}</strong>
        <span className="an-wind__source">{source}</span>
        <label className="an-wind__field">
          <input type="number" min={0} max={359} className="ui-field ui-field--s num" aria-label={texts.field}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText(); } }} />°
        </label>
        <Button size="s" onClick={() => onChange((shownDeg + 180) % 360)}>Inverser</Button>
        {canReset && <Button size="s" onClick={() => onChange(null)} title={texts.reset}>Calculé</Button>}
        {extraButtons}
        <Button size="s" variant="primary" onClick={onClose}>Terminé</Button>
      </div>

      <svg ref={dialRef} className="an-wind__dial" viewBox={`${-MARGIN} ${-MARGIN} ${DIAL + 2 * MARGIN} ${DIAL + 2 * MARGIN}`} role="slider"
        aria-label={texts.dial} aria-valuemin={0} aria-valuemax={359} aria-valuenow={shownDeg}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDragDeg(null)}>
        <circle cx={C} cy={C} r={C - 2} fill="rgba(255,255,255,0.45)" stroke="#333" strokeWidth={2} />
        {ticks.map((tick) => {
          const a = (tick * Math.PI) / 180;
          const inner = tick % 90 === 0 ? C - 16 : C - 10;
          return <line key={tick} x1={C + inner * Math.sin(a)} y1={C - inner * Math.cos(a)} x2={C + (C - 3) * Math.sin(a)} y2={C - (C - 3) * Math.cos(a)} stroke="#333" strokeWidth={tick % 90 === 0 ? 2 : 1} />;
        })}
        {CARDINALS.map((l, i) => {
          const a = (i * 90 * Math.PI) / 180;
          return <text key={l} x={C + (C - 26) * Math.sin(a)} y={C - (C - 26) * Math.cos(a) + 5} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#333">{l}</text>;
        })}
        {/* Flèche ; la poignée à cheval sur le cercle se tire. */}
        <line x1={C + lineStartR * sin} y1={C - lineStartR * cos} x2={C + lineEndR * sin} y2={C - lineEndR * cos} stroke="#d32f2f" strokeWidth={4} strokeLinecap="round" />
        <polygon fill="#d32f2f" points={arrowHead} />
        <circle cx={hx} cy={hy} r={11} fill="#d32f2f" stroke="#fff" strokeWidth={3} className="an-wind__handle" />
      </svg>

      {below?.(shownDeg)}
    </div>
  );
}

export default CompassAdjustOverlay;
