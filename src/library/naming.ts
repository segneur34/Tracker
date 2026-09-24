import type { SportType } from '../core/types';
import { isSportType } from '../recording/session';
import { recordFileName } from './record';

/**
 * Nom et support d'un GPX qui entre dans la mémoire.
 *
 * Un GPX importé est renommé comme une session enregistrée
 * (`sessionFileName`) : la liste des fichiers se lit alors dans l'ordre des
 * dates. Son support vient de la balise `<type>` de la trace quand on la
 * reconnaît ; sinon il reste inconnu et la session attend d'être classée.
 */

/**
 * Nom libre pour une session dans `sessions/` : `nom.gpx`, sinon `nom-2.gpx`,
 * `nom-3.gpx`… Le nom n'est libre que si sa fiche l'est aussi. La comparaison
 * ignore la casse, comme le système de fichiers de Windows.
 */
export const uniqueSessionFileName = (gpxName: string, taken: Iterable<string>): string => {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const isFree = (name: string) => !used.has(name.toLowerCase()) && !used.has(recordFileName(name).toLowerCase());
  if (isFree(gpxName)) return gpxName;
  const base = gpxName.replace(/\.gpx$/i, '');
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}.gpx`;
    if (isFree(candidate)) return candidate;
  }
};

/**
 * Types d'activité des autres applications, ramenés à nos supports. Les clés
 * sont en minuscules, sans espace ni tiret ni souligné : `Trail Running`,
 * `trail_running` et `trail-running` se lisent `trailrunning`.
 */
const FOREIGN_TYPES: Record<string, SportType> = {
  running: 'running',
  run: 'running',
  trailrunning: 'running',
  treadmillrunning: 'running',
  course: 'running',
  windsurfing: 'windsurf',
  windsurf: 'windsurf',
  kitesurfing: 'kite',
  kitesurf: 'kite',
  kiteboarding: 'kite',
  sailing: 'bateau',
  sail: 'bateau',
  voile: 'bateau',
  wingfoiling: 'wingfoil',
  wingfoil: 'wingfoil',
};

/** Support deviné depuis la balise `<type>` d'un GPX, ou `null`. */
export const guessSport = (gpxType: string | undefined): SportType | null => {
  if (!gpxType) return null;
  const raw = gpxType.trim();
  if (isSportType(raw)) return raw;
  return FOREIGN_TYPES[raw.toLowerCase().replace(/[\s_-]/g, '')] ?? null;
};
