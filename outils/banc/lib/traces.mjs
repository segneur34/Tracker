// Banc de test : trace synthétique en ligne droite, pour les scripts du programme Windows (`exe-*.mjs`,
// `memoire-disque.mjs`). Rend le texte d'un GPX que `importGpx` de lib/cdp.mjs ou un `writeFileSync` posent tel quel ;
// ni aléa ni dépendance : un même appel donne les mêmes octets. Repris de la bibliothèque des traces de Gtracker.

/** Auteur des traces. */
export const CREATEUR = 'banc';
/** Début par défaut : une heure fixe d'une session d'automne, jamais « maintenant ». */
export const DEBUT_PAR_DEFAUT = Date.UTC(2026, 8, 20, 13, 0, 0);

const R = 6_371_000;
const RAD = Math.PI / 180;

/** L'en-tête commun et la fin : `type` null pour un GPX sans `<type>` (session à classer). */
export const enveloppeGpx = ({ nom = 'Banc', type = null }, points) => `<?xml version="1.0" encoding="UTF-8"?>\n`
  + `<gpx version="1.1" creator="${CREATEUR}" xmlns="http://www.topografix.com/GPX/1/1">`
  + `<trk><name>${nom}</name>${type ? `<type>${type}</type>` : ''}<trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;

/** Un point : position, instant (ms), vitesse (m/s), cap éventuel (degrés, `<course>`). */
export const pointGpx = ({ lat, lon, ms, vitesse, cap = null }) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">`
  + `<time>${new Date(ms).toISOString()}</time>`
  + `<extensions><speed>${vitesse.toFixed(2)}</speed>${cap === null ? '' : `<course>${cap}</course>`}</extensions></trkpt>`;

/** Ligne droite vers l'est, à vitesse fixe (m/s), `secondes` de long, à `hz` Hz ; `type` : calcul de base de la session. */
export const traceDroite = ({ debutMs = DEBUT_PAR_DEFAUT, secondes, vitesse, type = 'wingfoil', nom = 'Ligne', hz = 1, lat0 = 43.7, lon0 = 3.85 }) => {
  const pts = [];
  const mParDegreLon = RAD * R * Math.cos(lat0 * RAD);
  for (let k = 0; k <= secondes * hz; k++) {
    const t = k / hz;
    pts.push(pointGpx({ lat: lat0, lon: lon0 + (t * vitesse) / mParDegreLon, ms: debutMs + Math.round(t * 1000), vitesse, cap: 90 }));
  }
  return enveloppeGpx({ nom, type }, pts);
};
