import { Fragment } from 'react';

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
