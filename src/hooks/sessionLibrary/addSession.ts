import { parseGpx } from '../../core/gpxParser';
import { decodeImuHeader } from '../../core/imuFile';
import { pruneImuFile } from '../../core/imuPrune';
import { keepsWholeCaptureForPumping } from '../../core/pumping';
import { pruneSurfImu } from '../../surfing/imuPrune';
import { getSportProfile, sportTreatment } from '../../core/sportProfiles';
import type { SportType } from '../../core/types';
import { sessionPath } from '../../library/folderLayout';
import { uniqueSessionFileName } from '../../library/naming';
import type { NewRecordOptions } from '../../library/newRecord';
import type { KeptRecordText } from '../../library/recordText';
import {
  completeRecord, imuFileName, isGpxFileName, recordFileName, serializeRecord, type RecordUnreadable,
  type SessionAnalysis, type SessionSource,
} from '../../library/record';
import { surfRides } from '../../library/summary';
import { summarizeGpxOptions } from '../../library/summarizeGpx';
import { summaryOptions, withSummary, type AnalyzedGpx } from '../../library/summaryOptions';
import { runInWorker } from '../../library/trackWorkerClient';
import { pendingFolder } from '../../platform/memoryFolder';
import { sessionFileName } from '../../recording/session';
import { effectivePumping } from '../useSportSettings';
import { errorMessage } from '../../core/basics';
import { setState } from './store';
import {
  findSession, findSessionAt, hasSessionMotion, hydrateSession, lib, rememberUnreadable, replaceSession,
  writableFolder,
} from './memory';
import { activityOfSession, activitySummarySettings, newRecord, recordFor, sessionSummarySettings } from './summarySettings';
import { noteRecordEdits, resummarize, scheduleRecordWrite, writeRecordFile } from './recordWrites';

/**
 * Entrée d'une session dans la mémoire (lot 113) : son GPX, sa fiche et ses capteurs, ou ce qui manque à une
 * session déjà là ; mise en attente d'un dossier pour un enregistrement.
 */

/**
 * GPX dont l'écriture dans le dossier en attente est en cours (`addGpx`) : la reprise des
 * temporaires (`planPendingTemps`) ne touche pas aux leurs.
 */
export const pendingWriting = new Set<string>();

export const countPending = async (): Promise<void> => {
  const pending = pendingFolder();
  if (!pending) return;
  try {
    const files = await pending.list('');
    setState({ pendingCount: files.filter((e) => e.kind === 'file' && isGpxFileName(e.name)).length });
  } catch {
    // Dossier privé illisible : le compte précédent reste affiché.
  }
};

export type AddStatus = 'added' | 'duplicate' | 'pending' | 'unsaved' | 'invalid';

export interface AddResult {
  status: AddStatus;
  /** Nom du GPX dans la mémoire : la session ajoutée, ou celle qui existait déjà. */
  file: string | null;
  message?: string;
  /** Session déjà présente, qui n'avait pas ses capteurs : ceux apportés lui ont été ajoutés. */
  motionAdded?: boolean;
  /** Session déjà présente dont la fiche a reçu ce qui lui manquait (`completeRecord`). */
  recordCompleted?: boolean;
  /** Session déjà présente, à compléter, dont la fiche du disque n'a pas pu être relue : rien n'y est ajouté. */
  recordNotRead?: boolean;
  /**
   * Session déjà présente en lecture seule (fiche non lue, illisible, d'une version plus récente), à qui
   * la fiche apportée donnerait quelque chose : rien n'y est ajouté.
   */
  recordReadOnly?: boolean;
}

/** Ce qu'une session apporte en entrant dans la mémoire : sa fiche (`NewRecordOptions`), et comment la ranger. */
export interface AddOptions extends NewRecordOptions {
  /** Support imposé ; absent : celui de la fiche importée, sinon deviné ; `null` : aucun (session à classer). */
  sport?: SportType | null;
  /** Champs illisibles de la fiche apportée à sa lecture, réécrits tels quels (`parseRecordWithRaw`). */
  unreadable?: RecordUnreadable;
  /** Fiche qui accompagne le GPX mais qu'on ne sait pas réécrire : rangée telle quelle (`KeptRecordText`). */
  keepRecordText?: KeptRecordText;
}

/**
 * Capteurs d'un enregistrement à leur entrée dans la mémoire : élagués autour
 * des vols si le calcul de la session mesure les sauts, autour des glisses en
 * surf (vols sur foil, vagues sinon, au seuil de la fiche ou de l'activité)
 * si son profil le demande (`pump.pruneCapture`), sinon gardés entiers. En
 * voile sur foil, Pumping coché (fiche, sinon activité), gardés entiers aussi :
 * le pumping se mesure sur tout le vol (décision du 28/10).
 * Une capture qui mesurait la cadence (déjà écrite dans le GPX) est gardée
 * entière tant que la mesure se règle (`cadence.keepCapture`) ; ensuite, sans
 * sauts mesurés, elle n'est pas rangée (`null`).
 * En cas d'échec, la capture complète : on ne perd jamais de mesure par erreur.
 */
const prunedMotion = async (
  motion: Uint8Array, sport: SportType | null, text: string, analysis?: SessionAnalysis | null, activityId?: string | null
): Promise<Uint8Array | null> => {
  if (!sport) return motion;
  const profile = getSportProfile(sport);
  try {
    const setup = decodeImuHeader(motion)?.setup;
    if (setup?.cadence && profile.cadence) {
      if (profile.cadence.keepCapture) return motion;
      if (setup.jumps === false) return null;
    }
    if (profile.surf) {
      if (!profile.pump?.pruneCapture) return motion;
      const rides = surfRides(parseGpx(text).rawPoints, sport, summaryOptions(sport, analysis, activitySummarySettings(activityId)(sport)));
      return rides ? await pruneSurfImu(motion, rides, profile.pump.pruneMarginS) : motion;
    }
    if (sportTreatment(sport) === 'voile') {
      const activity = activityOfSession(sport, activityId);
      const foil = analysis?.foil ?? setup?.foil ?? false;
      const pumping = analysis?.pumping ?? effectivePumping(activity) ?? false;
      if (keepsWholeCaptureForPumping(profile.pump, foil, pumping)) return motion;
    }
    const detection = profile.jumps?.detection;
    return detection ? await pruneImuFile(motion, detection) : motion;
  } catch {
    return motion;
  }
};

/** Range un GPX dans la mémoire, avec sa fiche. */
export const addGpx = async (text: string, source: SessionSource, options: AddOptions): Promise<AddResult> => {
  const kept = options.keepRecordText;
  // Fiche qui dit le calcul, les réglages et l'activité du résumé : celle qui accompagne le GPX, même gardée telle quelle.
  const from = options.record ?? kept?.parts ?? null;
  let analyzed: AnalyzedGpx | null;
  try {
    const sport = options.sport !== undefined ? options.sport : from?.sport ?? undefined;
    const fields = options.test ? { ...from, test: options.test } : from;
    // Hors du fil de l'affichage (lot 161) : « Rangement… » se peint et la page répond pendant le calcul. Réglages lus
    // avant l'envoi ; le GPX seul part, jamais les capteurs ; mêmes chiffres et mêmes erreurs qu'en ligne (`runTrackJob`).
    analyzed = await runInWorker('summarize', text, summarizeGpxOptions({ ...fields, sport }, sessionSummarySettings(from, options.activityId ?? from?.activityId)));
  } catch (err) {
    return { status: 'invalid', file: null, message: errorMessage(err, 'GPX illisible.') };
  }
  if (!analyzed) return { status: 'invalid', file: null, message: 'Pas assez de points horodatés.' };

  const startMs = analyzed.summary.startMs;
  let existing = findSessionAt(startMs);
  // Première lecture du dossier en cours : sa session n'est peut-être pas encore publiée, on l'attend (aucune attente sinon).
  if (!existing && lib.scanCompletion) {
    await lib.scanCompletion.then(() => undefined, () => undefined);
    existing = findSessionAt(startMs);
  }
  // Fiche qui accompagne la session, à défaut celle de l'enregistrement (activité, foil, séances, repères,
  // test) : une session déjà là en reçoit ce qui lui manque. Application tuée entre le GPX et sa fiche : le
  // balayage a donné à la session une fiche neuve, que l'enregistrement repris (journal, attente) complète.
  // Une fiche gardée telle quelle (`keepRecordText`) ne complète rien.
  const incoming = !existing || kept
    ? null
    : options.record ?? (source === 'enregistrement' ? recordFor(existing.file, analyzed, source, options) : null);
  // Fiche du cache allégé : relue en entier, pour ne pas croire absents ses sauts, ses voies ou son altitude.
  if (existing?.partial && incoming && lib.folder) {
    await hydrateSession(lib.folder, existing.file).catch(() => undefined);
    existing = findSession(existing.file) ?? existing;
  }
  if (existing) {
    // Fiche du disque toujours pas relue : rien n'est complété, et c'est dit (`recordNotRead`).
    const recordNotRead = incoming !== null && existing.partial === true;
    // Session en lecture seule (fiche non lue, illisible, d'une version plus récente) à qui la fiche apportée
    // donnerait quelque chose : rien n'y est ajouté, et c'est dit (`recordReadOnly`).
    const recordReadOnly = incoming !== null && existing.readOnly && !existing.partial
      && completeRecord(existing.record, incoming).record !== existing.record;
    // Session entrée sans sa fiche complète (GPX importé seul) : celle de la copie lui donne ce qui
    // lui manque, sans rien écraser ; de même ses capteurs, s'ils ne sont pas encore là.
    let recordCompleted = false;
    if (incoming && !existing.readOnly && !existing.partial) {
      const { record, resummarize: stale } = completeRecord(existing.record, incoming);
      if (record !== existing.record) {
        noteRecordEdits(existing.file, existing.record, record);
        replaceSession({ ...existing, record });
        scheduleRecordWrite(existing.file);
        recordCompleted = true;
        if (stale) void resummarize(existing.file);
      }
    }
    const duplicate: AddResult = {
      status: 'duplicate', file: existing.file, recordCompleted, ...(recordNotRead ? { recordNotRead } : {}), ...(recordReadOnly ? { recordReadOnly } : {}),
    };
    const f = writableFolder();
    if (!options.motion || !f || hasSessionMotion(existing.file)) return duplicate;
    const motion = source === 'enregistrement'
      ? await prunedMotion(options.motion, analyzed.sport, text, existing.record.analysis, existing.record.activityId)
      : options.motion;
    if (!motion) return duplicate;
    await f.writeBytes(sessionPath(imuFileName(existing.file)), motion);
    lib.knownNames.add(imuFileName(existing.file));
    // Publiée de nouveau : une analyse ouverte sur elle relit `hasSessionMotion` (onglets « sauts » et « pumping »).
    const withMotion = findSession(existing.file);
    if (withMotion) replaceSession({ ...withMotion });
    return { ...duplicate, motionAdded: true };
  }

  const f = writableFolder();
  const name = sessionFileName(startMs, analyzed.sport);
  if (!f) {
    // Seul un enregistrement attend un dossier ; un import sans dossier est refusé (décision du 27/10).
    const pending = source === 'enregistrement' ? pendingFolder() : null;
    if (!pending) return { status: 'unsaved', file: null };
    // Les capteurs, puis la fiche, avant le GPX : un GPX en attente a toujours les siens complets à côté de lui.
    // La fiche garde ce que le GPX ne dit pas (activité, foil, séances, repères, test), repris au rangement.
    pendingWriting.add(name);
    try {
      if (options.motion) await pending.writeBytes(imuFileName(name), options.motion);
      await pending.writeText(recordFileName(name), serializeRecord(recordFor(name, analyzed, source, options), options.record ? options.unreadable : undefined));
      await pending.writeText(name, text);
    } finally {
      pendingWriting.delete(name);
    }
    await countPending();
    return { status: 'pending', file: null };
  }

  const gpx = uniqueSessionFileName(name, lib.knownNames);
  // Fiche gardée telle quelle : la session la montre lue (version plus récente) ou sur une fiche neuve (illisible).
  const record = kept
    ? kept.parts ? withSummary({ ...kept.parts, gpx, sport: analyzed.sport }, analyzed.summary) : newRecord(gpx, analyzed, source)
    : recordFor(gpx, analyzed, source, options);
  // Un enregistrement est élagué en entrant ; un dossier importé est rangé tel quel.
  const motion = options.motion && source === 'enregistrement'
    ? await prunedMotion(options.motion, analyzed.sport, text, from?.analysis, options.activityId ?? from?.activityId)
    : options.motion;
  const written = [sessionPath(gpx), sessionPath(recordFileName(gpx)), ...(motion ? [sessionPath(imuFileName(gpx))] : [])];
  try {
    await f.writeText(sessionPath(gpx), text);
    await writeRecordFile(f, gpx, kept ? kept.text : serializeRecord(record, options.record ? options.unreadable : undefined));
    if (motion) await f.writeBytes(sessionPath(imuFileName(gpx)), motion);
  } catch (err) {
    // Rangée à moitié, la session reparaîtrait sans sa fiche ou ses capteurs, et un nouvel essai ferait un doublon :
    // ce qui a été écrit est retiré, et l'appelant garde de quoi recommencer (journal de l'enregistreur, fichiers choisis).
    for (const path of written) await f.remove(path).catch(() => undefined);
    throw err;
  }
  lib.knownNames.add(gpx);
  lib.knownNames.add(recordFileName(gpx));
  if (motion) lib.knownNames.add(imuFileName(gpx));
  rememberUnreadable(f, gpx, options.record && !kept ? options.unreadable : undefined);
  replaceSession({ file: gpx, record, readOnly: kept !== undefined, warning: kept?.warning ?? null });
  return { status: 'added', file: gpx };
};
