import { divIcon } from 'leaflet';
import { Marker, Popup } from 'react-leaflet';
import type { LocatedMark } from '../core/sessionMarks';
import { formatDistance, formatTimeOfDay, type DistanceUnit } from '../core/units';
import type { SessionMarksView } from '../hooks/useSessionMarks';
import { HIGHLIGHT_SHOWN_COLOR, MARK_FLAG_COLOR } from './highlightColors';
import { IconClose, IconFlag } from './icons';
import Button from './ui/Button';

/**
 * Repères du bouton « Note » dans une analyse (voile, course, vélo, surf) :
 * fanions numérotés sur la carte, toujours visibles, liste de l'onglet
 * « Général » (nommer, supprimer, montrer) ; leur trait sur les graphes est
 * dans `markReferenceLines.tsx`. Le repère montré passe au violet des
 * surbrillances (`useMapHighlight`, une seule à la fois).
 */

const FLAG_W = 24;
const FLAG_H = 32;

/** Fanions gardés d'un rendu à l'autre : Leaflet ne les redessine que s'ils changent. */
const flagIcons = new Map<string, ReturnType<typeof divIcon>>();
const flagIcon = (n: number, shown: boolean) => {
  const key = `${n}|${shown}`;
  let icon = flagIcons.get(key);
  if (!icon) {
    const color = shown ? HIGHLIGHT_SHOWN_COLOR : MARK_FLAG_COLOR;
    icon = divIcon({
      className: '',
      iconSize: [FLAG_W, FLAG_H],
      // Le pied du mât sur le point.
      iconAnchor: [1, FLAG_H],
      popupAnchor: [10, -FLAG_H],
      html: `<div style="position:relative;width:${FLAG_W}px;height:${FLAG_H}px">`
        + `<div style="position:absolute;left:0;top:0;min-width:${FLAG_W - 2}px;height:20px;box-sizing:border-box;padding:0 4px;`
        + `border-radius:4px 4px 4px 0;background:${color};color:#ffffff;border:2px solid #ffffff;font-weight:700;font-size:11px;`
        + `line-height:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.35)">${n}</div>`
        + `<div style="position:absolute;left:0;top:18px;width:2px;height:${FLAG_H - 18}px;background:${color}"></div></div>`,
    });
    flagIcons.set(key, icon);
  }
  return icon;
};

/** Repère numéroté, ce qu'il faut aux fanions : l'analyse les situe sur la trace, la carte du direct non. */
type NumberedMark = Pick<LocatedMark, 'mark' | 'n'>;

const markTitle = (m: NumberedMark): string => m.mark.label ?? `Note ${m.n}`;

/**
 * Fanions de la carte, dans les analyses et sur la carte du direct ; `shownMs` :
 * le repère montré (par son heure), en violet, au-dessus des autres.
 */
export function SessionMarksLayer({ located, shownMs }: { located: ReadonlyArray<NumberedMark>; shownMs: number | null }) {
  return (
    <>
      {located.map((m) => (
        <Marker key={`note-${m.mark.timeMs}`} position={[m.mark.lat, m.mark.lon]} icon={flagIcon(m.n, m.mark.timeMs === shownMs)}
          zIndexOffset={m.mark.timeMs === shownMs ? 1000 : 0}>
          <Popup>{markTitle(m)} · {formatTimeOfDay(m.mark.timeMs)}</Popup>
        </Marker>
      ))}
    </>
  );
}

/**
 * Liste des repères, pour l'onglet « Général » : n°, heure, distance depuis
 * le départ, nom à saisir, « Voir » et supprimer. Rien sans repère.
 */
export function SessionMarksList({ view, distanceUnit, shownMs, onShow, accent }: {
  view: SessionMarksView;
  distanceUnit: DistanceUnit;
  shownMs: number | null;
  /** Montre un repère sur la carte, par son heure ; `null` le masque. */
  onShow: (timeMs: number | null) => void;
  /** Couleur du bouton « Voir » enfoncé, celle du module. */
  accent: string;
}) {
  const { located, rename, remove, editable } = view;
  if (located.length === 0) return null;
  return (
    <div className="an-marks" style={{ marginTop: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, marginBottom: '6px' }}>
        <IconFlag size={16} />
        Notes posées pendant l'enregistrement
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {located.map((m) => {
          const shown = m.mark.timeMs === shownMs;
          return (
            <div key={`note-${m.mark.timeMs}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <strong style={{ minWidth: '1.5em' }}>{m.n}</strong>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTimeOfDay(m.mark.timeMs)}</span>
              <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{formatDistance(m.distanceM, distanceUnit)}</span>
              <input type="text" className="ui-field ui-field--s" style={{ flex: '1 1 8em', minWidth: 0 }}
                value={m.mark.label ?? ''} placeholder={`Note ${m.n}`} disabled={!editable} aria-label={`Nom de la note ${m.n}`}
                onChange={(e) => rename(m.mark, e.target.value)} />
              <Button size="s" aria-pressed={shown} onClick={() => onShow(shown ? null : m.mark.timeMs)}
                style={shown ? { backgroundColor: accent, color: 'var(--on-accent)', borderColor: accent } : undefined}>
                {shown ? 'Masquer' : 'Voir'}
              </Button>
              {editable && (
                <Button size="s" variant="ghost" onClick={() => remove(m.mark)} aria-label={`Supprimer la note ${m.n}`} title="Supprimer">
                  <IconClose size={16} />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
