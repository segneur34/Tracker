import { imuFileName, isGpxFileName } from './record';

/**
 * Temporaires laissés dans le dossier des sessions en attente (`en-attente/`,
 * dossier privé du téléphone). Chaque fichier y est écrit sous `<nom>.tmp`,
 * puis renommé (`platform/memoryFolder.ts`, `writeAtomically`) ; les capteurs
 * avant le GPX. Un plantage de l'application entre l'écriture et la fin du
 * renommage laisse un `.tmp` sans sa cible : complet, c'est une session
 * qu'il faut reprendre ; tronqué, un reste qu'il faut effacer. Ce module ne
 * fait que décider, d'après les noms et le texte ; la reprise lit et efface.
 */

/** Suffixe des temporaires, celui de `writeAtomically`. */
export const PENDING_TEMP_SUFFIX = '.tmp';

const isImuFileName = (name: string): boolean => /\.imu$/i.test(name);

/** GPX d'un nom de capteurs : même nom, extension `.gpx` (inverse d'`imuFileName`). */
const gpxOfImu = (imuName: string): string => imuName.replace(/\.imu$/i, '') + '.gpx';

/** GPX sans son `.gpx`, à lire : session à reprendre si elle est complète. */
export interface PendingTempSession {
  /** Le temporaire, `<nom>.gpx.tmp`. */
  temp: string;
  /** Le GPX qu'il devait devenir. */
  gpx: string;
  /** Ses capteurs, s'ils sont là sous leur nom. */
  imu: string | null;
  /** Ses capteurs encore temporaires (`.imu.tmp`), à défaut des précédents. */
  imuTemp: string | null;
}

export interface PendingTempPlan {
  /** Temporaires dont la cible est là : restes d'une écriture achevée, à effacer. */
  stale: string[];
  /** GPX temporaires sans leur `.gpx`. */
  sessions: PendingTempSession[];
  /** Capteurs temporaires d'un GPX en attente qui n'a pas les siens, par nom de GPX. */
  imuTemps: Record<string, string>;
  /** Capteurs temporaires sans capteurs ni GPX, même temporaire : rien à quoi les joindre. */
  orphanImuTemps: string[];
}

/**
 * Partage les fichiers du dossier en attente (`names`). `busy` : GPX dont
 * l'écriture est en cours dans ce lancement ; leurs temporaires ne sont pas
 * touchés. Un autre `.tmp` (ni GPX ni capteurs) est laissé de côté.
 */
export const planPendingTemps = (names: readonly string[], busy: ReadonlySet<string> = new Set()): PendingTempPlan => {
  const present = new Set(names);
  const plan: PendingTempPlan = { stale: [], sessions: [], imuTemps: {}, orphanImuTemps: [] };
  const temps = names.filter((name) => name.endsWith(PENDING_TEMP_SUFFIX)).sort();
  for (const temp of temps) {
    const target = temp.slice(0, -PENDING_TEMP_SUFFIX.length);
    const gpx = isGpxFileName(target) ? target : isImuFileName(target) ? gpxOfImu(target) : null;
    if (gpx === null || busy.has(gpx)) continue;
    if (present.has(target)) {
      plan.stale.push(temp);
    } else if (target === gpx) {
      const imu = imuFileName(gpx);
      const imuTemp = imu + PENDING_TEMP_SUFFIX;
      plan.sessions.push({
        temp,
        gpx,
        imu: present.has(imu) ? imu : null,
        imuTemp: !present.has(imu) && present.has(imuTemp) ? imuTemp : null,
      });
    } else if (present.has(gpx)) {
      plan.imuTemps[gpx] = temp;
    } else if (!present.has(gpx + PENDING_TEMP_SUFFIX)) {
      plan.orphanImuTemps.push(temp);
    }
  }
  return plan;
};

/** Vrai si le texte est un GPX écrit jusqu'au bout : il se termine par `</gpx>`. */
export const isCompleteGpxText = (text: string): boolean => /<\/gpx>\s*$/i.test(text);
