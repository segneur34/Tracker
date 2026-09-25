import type { GradientStop } from '../running/runningAnalytics';

/**
 * Dégradé horizontal d'une courbe d'altitude, selon la pente
 * (`gradeGradientStops`), à placer dans le graphe. Un par graphe :
 * l'identifiant doit être unique dans la page. Une fonction plutôt qu'un
 * composant : le graphe rend ses `<defs>` tels quels. Sert à l'analyse de
 * course et au profil d'un itinéraire.
 */
export const gradeGradientDefs = (id: string, stops: GradientStop[]) => (
  <defs>
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      {stops.map((stop, i) => <stop key={i} offset={stop.offset} stopColor={stop.color} />)}
    </linearGradient>
  </defs>
);
