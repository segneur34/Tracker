import { sessionPath } from '../../library/folderLayout';
import { READ_ONLY_MEMORY_WARNING } from '../../library/recordText';
import { isBlankGpxText, recordFileName, serializeRecord } from '../../library/record';
import type { LibrarySession, RecordWithoutSummary } from '../../library/record';
import { summarizeGpxOptions, type SummarizeGpxOptions } from '../../library/summarizeGpx';
import { outdatedRefreshFiles, withSummary, type AnalyzedGpx } from '../../library/summaryOptions';
import { runInWorker } from '../../library/trackWorkerClient';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { errorMessage } from '../../core/basics';
import { libraryState, pause, reportError, setState } from './store';
import {
  findSession, hydrateSession, lib, publish, publishedFields, rememberUnreadable, removing, replaceSession,
  unreadableOf, unwritten,
} from './memory';
import {
  newRecord, noteSettingsGestures, refreshFailed, sessionSummarySettings, settleSettingsGestures, summaryOutdatedTest,
} from './summarySettings';
import { cancelRecordWrite, noteRecordEdits, writeRecordFile, writeRecordNow } from './recordWrites';
import { rebuildCache } from './cache';
import type { SummaryJob } from './scan';

/**
 * File des résumés (lot 113) : crée ou recalcule les fiches une trace à la fois, en laissant l'interface
 * répondre, au lancement, à « Mettre à jour » et après un réglage changé. Le calcul d'un résumé se fait hors du
 * fil de l'affichage (lot 126 B, `library/trackWorker.ts`), et reste remplaçable (`setSummaryRunner`).
 */

/** `stopped` : le dossier a changé, le balayage s'arrête ; `blank` : GPX vide, qui n'est pas une session (ignoré, pas effacé). */
type JobOutcome = 'done' | 'unreadable' | 'blank' | 'stopped';

/**
 * Calcul du résumé d'un GPX par la file (`runJob`) : le texte et les réglages résolus avant l'envoi
 * (`summarizeGpxOptions`), rendu de façon asynchrone ; `null` si la trace a moins de deux points, rejeté si le
 * XML est illisible.
 */
export type SummaryRunner = (text: string, options: SummarizeGpxOptions) => Promise<AnalyzedGpx | null>;

/** Calcul par le worker des traces (en ligne sans worker) : les chiffres d'`analyzeGpx`. */
const workerRunner: SummaryRunner = (text, options) => runInWorker('summarize', text, options);

/** Calcul en service, celui du worker sauf remplacement (`setSummaryRunner`). */
let summaryRunner: SummaryRunner = workerRunner;

/** Remplace le calcul des résumés de la file (`runJob`), `null` pour revenir à celui du worker : un faux calcul dans les tests. */
export const setSummaryRunner = (run: SummaryRunner | null): void => {
  summaryRunner = run ?? workerRunner;
};

/** Un résumé calculé sur une fiche dont une donnée du calcul a changé pendant qu'il tournait est refait, au plus ce nombre de fois. */
const MAX_SUMMARY_RETRIES = 2;

/**
 * Vrai si une donnée de la fiche qui change son résumé a changé (calcul, activité, analyse, altitude, test),
 * par identité : une saisie qui n'y touche pas (nom, notes) garde les mêmes objets.
 */
const summaryInputsChanged = (before: RecordWithoutSummary, after: RecordWithoutSummary): boolean =>
  before.sport !== after.sport
  || before.activityId !== after.activityId
  || before.analysis !== after.analysis
  || before.terrainElevation !== after.terrainElevation
  || before.elevationSource !== after.elevationSource
  || before.test !== after.test;

/**
 * Crée une fiche, ou refait le résumé d'une fiche existante. Pour celle-ci,
 * la session est prise au moment du calcul, pas au début du balayage, et
 * relue quand le calcul rend son résultat : une saisie faite entre-temps
 * (nom, notes) est gardée ; une qui change le résumé (activité, seuil,
 * allure, altitude) le fait refaire. Seul un GPX qu'on n'a pas su lire est
 * « illisible » ; un échec d'écriture est dit en clair.
 */
const runJob = async (f: MemoryFolder, gen: number, job: SummaryJob): Promise<JobOutcome> => {
  // Résumé refait entre-temps, ou réglage remis comme avant : la trace n'est pas relue.
  if (job.kind === 'refresh') {
    const listed = findSession(job.file);
    if (!listed || listed.readOnly || !summaryOutdatedTest()(listed.record)) return 'done';
  }
  let text: string | null;
  try {
    text = await f.readText(sessionPath(job.file));
  } catch {
    return 'unreadable';
  }
  // GPX vide ou blanc sans fiche (écriture interrompue) : ni session ni « illisible », laissé en place.
  // Avec une fiche, même illisible ou d'une version plus récente, il reste dit « illisible ».
  if (job.kind === 'create' && !job.base && !job.readOnly && text !== null && isBlankGpxText(text)) return 'blank';
  if (job.kind === 'refresh') {
    try {
      await hydrateSession(f, job.file, true);
    } catch (err) {
      reportError(`Fiche de ${job.file} non relue : ${errorMessage(err, 'erreur inconnue')}`);
      refreshFailed.add(job.file);
      return 'done';
    }
  }
  if (gen !== lib.generation) return 'stopped';
  const current = job.kind === 'refresh' ? findSession(job.file) : undefined;
  if (job.kind === 'refresh' && (!current || current.readOnly || current.partial)) {
    if (current?.partial) refreshFailed.add(job.file);
    return 'done';
  }
  /** Session dont le résumé est refait, relue après chaque calcul ; absente pour une fiche à créer. */
  let latest: LibrarySession | undefined = current;
  let analyzed: AnalyzedGpx | null = null;
  for (let attempt = 0; ; attempt++) {
    const from = latest?.record ?? job.base;
    try {
      analyzed = text === null ? null : await summaryRunner(text, summarizeGpxOptions(from, sessionSummarySettings(from)));
    } catch {
      return 'unreadable';
    }
    if (gen !== lib.generation) return 'stopped';
    if (!latest) break;
    // Pendant le calcul, la session a pu être supprimée, passer en lecture seule ou changer de réglages.
    const now = findSession(job.file);
    if (!now || now.readOnly || now.partial) {
      if (now?.partial) refreshFailed.add(job.file);
      return 'done';
    }
    const changed = summaryInputsChanged(latest.record, now.record);
    latest = now;
    if (!changed || attempt >= MAX_SUMMARY_RETRIES) break;
  }
  if (!analyzed) return 'unreadable';
  // Supprimée pendant le calcul : ni remise dans la liste, ni fiche réécrite.
  if (removing.has(job.file)) return 'done';

  if (latest) {
    const record = withSummary(latest.record, analyzed.summary);
    noteRecordEdits(job.file, latest.record, record);
    replaceSession({ ...latest, record }, true);
    cancelRecordWrite(job.file);
    await writeRecordNow(job.file);
    return 'done';
  }
  const record = job.base ? withSummary({ ...job.base, gpx: job.file }, analyzed.summary) : newRecord(job.file, analyzed, 'import');
  // Mémoire en lecture seule : la fiche se calcule pour l'affichage, sans s'écrire.
  const readOnly = job.readOnly || f.readOnly === true;
  if (!readOnly) {
    try {
      if (!job.base) rememberUnreadable(f, job.file, undefined);
      await writeRecordFile(f, job.file, serializeRecord(record, unreadableOf(f, job.file)));
      lib.knownNames.add(recordFileName(job.file));
      if (lib.folder === f) unwritten.delete(job.file);
    } catch (err) {
      // Dossier quitté pendant l'écriture : le balayage s'arrête juste après, rien à retenter ici.
      if (lib.folder === f) {
        unwritten.add(job.file);
        reportError(`Fiche de ${job.file} non enregistrée : ${errorMessage(err, 'erreur inconnue')}`);
      }
    }
  }
  if (gen !== lib.generation) return 'stopped';
  replaceSession({ file: job.file, record, readOnly, warning: job.warning ?? (readOnly ? READ_ONLY_MEMORY_WARNING : null) }, true);
  return 'done';
};

/** Le compteur du balayage est publié au plus à ce rythme : chaque publication redessine les pages qui le lisent. */
const SCAN_PROGRESS_INTERVAL_MS = 250;

/**
 * Crée ou recalcule les fiches, une trace à la fois, en laissant l'interface répondre. Un passage
 * qui ne fait que refaire des résumés n'est pas attendu par `addGpx` : il ne crée aucune session.
 * `keepUnreadable` : les GPX illisibles déjà signalés le restent (passage partiel).
 */
export const completeScan = (f: MemoryFolder, gen: number, jobs: SummaryJob[], keepUnreadable = false): Promise<void> => {
  const run = runCompleteScan(f, gen, jobs, keepUnreadable).finally(() => {
    if (lib.scanCompletion === run) lib.scanCompletion = null;
    if (lib.scanPass === run) lib.scanPass = null;
  });
  lib.scanPass = run;
  if (jobs.some((job) => job.kind === 'create')) lib.scanCompletion = run;
  return run;
};

/**
 * Les fiches créées ou recalculées entrent dans `all` tout de suite, mais ne
 * sont publiées qu'avec le compteur (au plus toutes les
 * `SCAN_PROGRESS_INTERVAL_MS`), puis une fois à la fin : chaque publication
 * redessine les pages qui lisent la liste. Un arrêt sur erreur publie ce qui
 * attendait.
 */
const runCompleteScan = async (f: MemoryFolder, gen: number, jobs: SummaryJob[], keepUnreadable: boolean): Promise<void> => {
  const unreadable: string[] = keepUnreadable ? [...libraryState().unreadable] : [];
  const createTotal = jobs.filter((job) => job.kind === 'create').length;
  let created = 0;
  let toUpdate = jobs.length - createTotal;
  let shownAt = -Infinity;
  try {
    for (let i = 0; i < jobs.length; i++) {
      if (gen !== lib.generation) return;
      if (Date.now() - shownAt >= SCAN_PROGRESS_INTERVAL_MS) {
        shownAt = Date.now();
        setState({
          scanning: { done: i, total: jobs.length, creating: { done: created, total: createTotal } },
          toUpdate,
          ...(lib.publishPending ? publishedFields() : {}),
        });
      }
      const job = jobs[i];
      const outcome = await runJob(f, gen, job);
      if (outcome === 'stopped') return;
      if (outcome === 'unreadable') {
        if (!unreadable.includes(job.file)) unreadable.push(job.file);
        // Un résumé qu'on n'a pas su refaire n'est retenté qu'à la prochaine ouverture ou à « Mettre à jour ».
        if (job.kind === 'refresh') refreshFailed.add(job.file);
      }
      if (job.kind === 'create') created += 1;
      else toUpdate -= 1;
      await pause();
    }
    if (gen !== lib.generation) return;
    setState({ scanning: null, toUpdate: 0, unreadable, ...(lib.publishPending ? publishedFields() : {}) });
    settleSettingsGestures(f);
  } finally {
    if (lib.publishPending && gen === lib.generation) publish();
  }
  await rebuildCache(f, gen);
};

/** Recalcul des résumés périmés en cours (`queueOutdatedRefresh`), et s'il faut réévaluer à sa fin. */
let outdatedRefresh: Promise<void> | null = null;

let outdatedAgain = false;

/**
 * Refait en tâche de fond les résumés périmés, dont ceux d'un geste dans Réglages (seuil ou foil d'une
 * activité changés, pré-réglage effacé), comparé ici (`noteSettingsGestures`), lot 37 : une trace à la
 * fois, par le même passage que les fiches du lancement (`completeScan`), la plus récente d'abord.
 * Attend la fin de l'ouverture, d'une relecture ou d'un passage en cours ; s'arrête avec lui si la
 * mémoire change (`generation`). Appelé de nouveau pendant qu'il tourne, il réévalue une fois à la
 * fin. Rien n'est relu ni écrit quand aucun résumé n'est périmé ; une trace déjà tentée sans succès
 * depuis l'ouverture n'est pas retentée (`refreshFailed`).
 */
export const queueOutdatedRefresh = (): Promise<void> => {
  if (outdatedRefresh) {
    outdatedAgain = true;
    return outdatedRefresh;
  }
  const run = (async () => {
    do {
      outdatedAgain = false;
      for (;;) {
        await lib.opening;
        if (lib.refreshing) await lib.refreshing;
        else if (lib.scanPass) await lib.scanPass.then(() => undefined, () => undefined);
        else break;
      }
      const f = lib.folder;
      if (!f || libraryState().status !== 'ready') return;
      noteSettingsGestures();
      const files = outdatedRefreshFiles(lib.all, summaryOutdatedTest(), refreshFailed);
      if (files.length === 0) {
        settleSettingsGestures(f);
        continue;
      }
      await completeScan(f, lib.generation, files.map((file): SummaryJob => ({ file, kind: 'refresh', readOnly: false, warning: null })), true);
    } while (outdatedAgain);
  })()
    .catch((err: unknown) => {
      setState({ scanning: null, toUpdate: 0, error: `Mise à jour des résumés interrompue : ${errorMessage(err, 'erreur inconnue')}` });
    })
    .finally(() => {
      outdatedRefresh = null;
    });
  outdatedRefresh = run;
  return run;
};

// La file des résumés vient après les écritures, qui la demandent par `lib.onOutdated` (`reconcileWithDisk`).
lib.onOutdated = () => void queueOutdatedRefresh();
