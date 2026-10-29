import { Fragment } from 'react';
import { useHoveredIndex, useHoverStore, type HoverStore } from '../hooks/useChartHover';

/** Une valeur lue, dans la couleur de sa série. */
export interface ReadoutValue {
  text: string;
  color?: string;
}

/** Ce qu'un graphe lit au point survolé : ses valeurs, puis l'abscisse (distance ou heure). */
export interface Readout {
  values: ReadoutValue[];
  at: string;
}

/**
 * Lecture d'un graphe, posée au-dessus de lui, à droite de son nom (23/10) :
 * elle remplace l'infobulle de Recharts, qui flottait sur la courbe et gênait
 * le zoom au doigt. Les valeurs du point survolé dans la couleur de leur
 * série, puis l'abscisse en gris ; rien quand rien n'est survolé. Une seule
 * ligne, sans retour, coupée par des points de suspension : sa hauteur ne
 * change jamais, et le graphe ne bouge pas sous le doigt.
 */
export default function ChartReadout({ readout, label, color, line = false }: {
  readout: Readout | null;
  /** Nom du graphe quand rien ne le porte au-dessus de lui (cardio, énergie, graphe seul). */
  label?: string;
  /** Couleur de `label`, celle de la série. */
  color?: string;
  /** Sur sa propre ligne, à la hauteur d'une ligne même vide, plutôt qu'à droite d'un nom. */
  line?: boolean;
}) {
  return (
    <span className={line ? 'chart-readout chart-readout--line' : 'chart-readout'} data-chart-readout="">
      {label && <span className="chart-readout__label" style={{ color }}>{label}</span>}
      {readout && (
        <>
          {readout.values.map((v, k) => (
            <Fragment key={k}>
              {k > 0 && ' · '}
              <span className="chart-readout__value" style={{ color: v.color }}>{v.text}</span>
            </Fragment>
          ))}
          <span className="chart-readout__at"> · {readout.at}</span>
        </>
      )}
    </span>
  );
}

/**
 * Lecture au point survolé, lue dans le magasin du survol (`useChartHover`) :
 * `read` donne la lecture d'un indice de trace, ou `null` hors de la plage
 * zoomée. Seule cette lecture se redessine quand le doigt glisse sur un
 * graphe ; le graphe et le module n'en savent rien.
 */
export function HoverReadout({ read, label, color, line = false }: {
  read: (index: number) => Readout | null;
  label?: string;
  color?: string;
  line?: boolean;
}) {
  const index = useHoveredIndex();
  return <ChartReadout readout={index === null ? null : read(index)} label={label} color={color} line={line} />;
}

/**
 * Lecture d'un graphe qui tient son survol dans un magasin à lui
 * (`createHoverStore`) : `read` donne la lecture de la ligne survolée, ou
 * `null`. Comme `HoverReadout`, seule elle se redessine sous le doigt.
 */
export function RowReadout<T>({ store, read, label, color, line = false }: {
  store: HoverStore<T>;
  read: (row: T) => Readout | null;
  label?: string;
  color?: string;
  line?: boolean;
}) {
  const row = useHoverStore(store);
  return <ChartReadout readout={row === null ? null : read(row)} label={label} color={color} line={line} />;
}
