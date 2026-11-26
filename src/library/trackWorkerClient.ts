import { isMissingTrace, type AnalyzeSailingOptions, type SailingAnalysisReply } from './analysisStore';
import {
  errorFromJob, resultFromWorker, runTrackJob, type TrackJobKind, type TrackJobs, type TrackRequest, type TrackResponse,
} from './trackWorkerProtocol';

/**
 * Client des workers des traces (lot 126 B, deux files au lot 235) : `runInWorker` envoie un calcul à un worker
 * (`trackWorker.ts`) et rend sa réponse. Deux files, chacune son worker, le même script lancé deux fois : « analyse »
 * pour la session qu'on ouvre (`prepare`, `analyzeSailing`, `release` : la mémoire de la session ouverte vit dans ce
 * worker-là), « fond » pour les résumés de la bibliothèque (`summarize`). Un worker traite ses demandes dans l'ordre
 * d'arrivée : sans cette séparation, l'analyse ouverte attendrait derrière tous les résumés déjà demandés.
 *
 * Chaque worker est créé à la première demande de sa file. S'il meurt, les demandes en cours de sa file sont refaites
 * en ligne et la suivante le recrée ; s'il meurt avant d'avoir répondu une fois (fichier introuvable, worker refusé),
 * sa file se calcule en ligne jusqu'au rechargement ; l'autre file n'en est pas touchée. Sans `Worker` (tests, vieux
 * WebView) ou si sa création lève, le calcul se fait en ligne, toujours de façon asynchrone : un seul chemin pour
 * l'appelant, mêmes chiffres (`runTrackJob`).
 */

interface PendingJob {
  /** Rend la réponse du worker. */
  answer(response: TrackResponse): void;
  /** Refait le calcul en ligne : le worker est mort sans répondre. */
  redo(): void;
}

/** Files des calculs, chacune servie par son worker. */
export type TrackQueue = 'analyse' | 'fond';

/** File de chaque calcul : l'analyse ouverte ne passe jamais derrière les résumés. */
export const TRACK_QUEUE: Readonly<Record<TrackJobKind, TrackQueue>> = {
  prepare: 'analyse',
  analyzeSailing: 'analyse',
  release: 'analyse',
  summarize: 'fond',
};

/** État d'une file : son worker, ses demandes en attente de réponse. */
interface QueueState {
  worker: Worker | null;
  /** Le worker courant a répondu au moins une fois : sa mort n'est pas celle d'un worker qui ne démarre pas. */
  answered: boolean;
  /** Plus de worker pour cette file jusqu'au rechargement : sa création a levé, ou il est mort avant toute réponse. */
  inlineOnly: boolean;
  pending: Map<number, PendingJob>;
}

const newQueueState = (): QueueState => ({ worker: null, answered: false, inlineOnly: false, pending: new Map() });

const queues: Record<TrackQueue, QueueState> = { analyse: newQueueState(), fond: newQueueState() };
let nextId = 1;

/**
 * Calcul en ligne, rendu par une promesse résolue au tour suivant : jamais par une minuterie (les tests de la
 * file des résumés comptent les leurs).
 */
const runInline = <K extends TrackJobKind>(kind: K, gpxText: string, options: TrackJobs[K]['options']): Promise<TrackJobs[K]['result']> =>
  Promise.resolve().then(() => runTrackJob(kind, gpxText, options));

/** Demandes en attente d'une file, retirées et refaites en ligne. */
const redoPending = (queue: QueueState): void => {
  const waiting = [...queue.pending.values()];
  queue.pending.clear();
  for (const job of waiting) job.redo();
};

/** Worker d'une file mort : oublié, et ce qu'il devait rendre refait en ligne. */
const fail = (queue: QueueState, dead: Worker): void => {
  if (queue.worker !== dead) return;
  queue.worker = null;
  dead.terminate();
  if (!queue.answered) queue.inlineOnly = true;
  redoPending(queue);
};

/** Le worker d'une file, créé à sa première demande ; `null` s'il n'y en a pas (en ligne). `Worker` est lu à ce moment-là. */
const currentWorker = (queue: QueueState): Worker | null => {
  if (queue.worker || queue.inlineOnly || typeof Worker === 'undefined') return queue.worker;
  let created: Worker;
  try {
    // D'un seul tenant : c'est cette forme que Vite reconnaît pour émettre le fichier du worker.
    created = new Worker(new URL('./trackWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    queue.inlineOnly = true;
    return null;
  }
  queue.worker = created;
  queue.answered = false;
  created.onmessage = (event: MessageEvent<TrackResponse>) => {
    if (queue.worker === created) queue.answered = true;
    const job = queue.pending.get(event.data.id);
    if (!job) return;
    queue.pending.delete(event.data.id);
    job.answer(event.data);
  };
  created.onerror = () => fail(queue, created);
  created.onmessageerror = () => fail(queue, created);
  return created;
};

/** Envoie un calcul au worker d'une file et rend sa réponse ; refait en ligne s'il meurt ou si les options ne se clonent pas. */
const send = <K extends TrackJobKind>(
  queue: QueueState, target: Worker, kind: K, gpxText: string, options: TrackJobs[K]['options']
): Promise<TrackJobs[K]['result']> =>
  new Promise<TrackJobs[K]['result']>((resolve, reject) => {
    const id = nextId++;
    const redo = () => {
      runInline(kind, gpxText, options).then(resolve, reject);
    };
    queue.pending.set(id, {
      answer: (response) => {
        if ('error' in response) reject(errorFromJob(response.error));
        // La réponse à la demande `id` est celle de son calcul : TypeScript ne relie pas l'identifiant au type.
        else resolve(resultFromWorker(response.result) as TrackJobs[K]['result']);
      },
      redo,
    });
    try {
      target.postMessage({ id, kind, gpxText, options } as TrackRequest);
    } catch {
      // Options qu'on ne sait pas cloner : ce calcul-là se fait en ligne.
      queue.pending.delete(id);
      redo();
    }
  });

/**
 * Lit et prépare un GPX (`prepare`, `core/prepareTrack.ts`), le résume (`summarize`, `summarizeGpx.ts`) ou analyse la
 * session ouverte (`analyzeSailing`, `analysisStore.ts`) hors du fil de l'affichage, dans la file du calcul
 * (`TRACK_QUEUE`). La promesse rend le même résultat que le calcul en ligne, ou est rejetée par une erreur de même nom
 * et même message. `release` vide la mémoire de la session quittée sans jamais créer de worker.
 */
export const runInWorker = <K extends TrackJobKind>(kind: K, gpxText: string, options: TrackJobs[K]['options']): Promise<TrackJobs[K]['result']> => {
  const queue = queues[TRACK_QUEUE[kind]];
  if (kind === 'release') {
    // La trace a pu être gardée des deux côtés (un `prepare` refait en ligne, worker mort) : la mémoire en ligne est
    // toujours vidée, celle du worker s'il vit ; jamais un worker créé pour être vidé.
    const inline = runInline(kind, gpxText, options);
    if (!queue.worker) return inline;
    return Promise.all([inline, send(queue, queue.worker, kind, gpxText, options)]).then(() => null as TrackJobs[K]['result']);
  }
  const target = currentWorker(queue);
  if (!target) return runInline(kind, gpxText, options);
  return send(queue, target, kind, gpxText, options);
};

/**
 * Analyse à voile de la session ouverte, sur la trace que le calcul garde déjà (lot 235) : la demande part sans le
 * texte du GPX, qui pèse plusieurs mégaoctets pour une longue session et serait recopié à chaque seuil ou vent
 * touché. Si le calcul ne tient plus cette trace (worker relancé, mémoire libérée, autre lecture depuis), il le dit
 * (`MISSING_TRACE`) et la demande repart une fois avec le texte. En ligne, de même.
 */
export const analyzeOnKeptTrace = (gpxText: string, options: AnalyzeSailingOptions): Promise<SailingAnalysisReply> =>
  runInWorker('analyzeSailing', '', options).catch((err: unknown) =>
    isMissingTrace(err) ? runInWorker('analyzeSailing', gpxText, options) : Promise.reject(err));

/** Oublie les workers des deux files (tests) : le prochain appel relit `Worker` et en crée un. Les demandes en cours sont refaites en ligne. */
export const resetTrackWorker = (): void => {
  for (const queue of Object.values(queues)) {
    const current = queue.worker;
    queue.worker = null;
    queue.inlineOnly = false;
    queue.answered = false;
    current?.terminate();
    redoPending(queue);
  }
};
