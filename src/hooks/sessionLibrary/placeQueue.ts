import { applyRecordPatch, type LibrarySession } from '../../library/record';
import {
  PLACE_DEFAULTS, choosePlace, learnedPlace, learnedPlaceTargets, localPlace, needsArrival, needsPlaceSearch, placeSearchOf,
  type SessionPlace,
} from '../../library/sessionPlace';
import { fetchPlaceSearch, isPlaceNetworkError, type PlaceSearchResult } from '../../planning/placeQuery';
import type { Waypoint } from '../../planning/route';
import { findSession, lastEdit, lib, publish, replaceSession, writableFolder } from './memory';
import { noteRecordEdits, scheduleRecordWrite } from './recordWrites';

/**
 * Lieu des sessions (lot 215), cherché en fond : la plus récente d'abord, une
 * à la fois, au moins `PLACE_PAUSE_MS` entre deux requêtes. D'abord un lieu
 * corrigé tout près (`appris`), puis un lieu déjà trouvé tout près (recopié
 * sans requête), sinon le serveur d'OpenStreetMap ; le lieu est rangé dans la
 * fiche, comme une saisie (hors brouillon : ce n'en est pas une).
 *
 * Lancée à la fin de l'ouverture et de « Mettre à jour » (`lifecycle`), et
 * après chaque ajout (`addSession`), une fois l'interface affichée
 * (`startPlaceSearch`, qui seul donne la recherche réseau : les tests ne la
 * lancent pas sans le dire). Hors ligne ou serveur en échec : elle s'arrête
 * sans rien dire, et reprend à la prochaine occasion ; une session dont la
 * réponse n'a pas pu être lue n'est pas retentée avant le lancement suivant.
 * Rien pour une fiche en lecture seule, ni une session sans départ (muscu,
 * tests sans positions, nuit).
 */

/** Recherche sur le réseau, remplaçable par les tests. */
export type PlaceFetcher = (start: Waypoint, end: Waypoint | null, water: boolean, waterRadiusM: number) => Promise<PlaceSearchResult>;

/** Écart minimal entre deux requêtes, en millisecondes : le serveur public est partagé. */
export const PLACE_PAUSE_MS = 1000;

/** Recherche donnée par `startPlaceSearch` ; aucune tant qu'elle n'est pas lancée. */
let fetcher: PlaceFetcher | null = null;

/** Instant de la dernière requête. */
let lastRequestAt = -Infinity;

/** Passage en cours, et s'il faut repartir à sa fin (un ajout pendant qu'il finissait). */
let running: Promise<void> | null = null;
let again = false;

/** Départs (`startMs`) dont la réponse n'a pas pu être lue pendant ce lancement : pas retentés avant le suivant. */
const failed = new Set<number>();

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Range le lieu dans la fiche d'une session, comme une saisie (`updateSessionRecord`). `quiet` : la liste
 * sera publiée plus tard. Rend vrai si la fiche a changé.
 */
export const writeSessionPlace = (file: string, place: SessionPlace, quiet = false): boolean => {
  const session = findSession(file);
  if (!session || session.readOnly) return false;
  const { record } = applyRecordPatch(session.record, { place });
  if (record === session.record) return false;
  lib.editCount += 1;
  lastEdit.set(file, lib.editCount);
  noteRecordEdits(file, session.record, record);
  replaceSession({ ...session, record }, quiet);
  scheduleRecordWrite(file);
  return true;
};

/**
 * Lieu corrigé d'une session (`user`), repris par les sessions parties à moins de
 * `learnRadiusM`, sauf celles corrigées à la main (`learnedPlaceTargets`).
 */
export const spreadLearnedPlace = (file: string): void => {
  const source = findSession(file);
  const place = source?.record.place;
  const start = source?.record.summary.start;
  if (!source || !place || place.source !== 'user' || !start) return;
  const fetchedAt = new Date().toISOString();
  let changed = false;
  const sessions = lib.all.map((s) => ({ file: s.file, readOnly: s.readOnly, sport: s.record.sport, summary: s.record.summary, place: s.record.place }));
  for (const target of learnedPlaceTargets(start, sessions, PLACE_DEFAULTS)) {
    const search = placeSearchOf(target.sport);
    if (target.file === file || target.readOnly || search === null) continue;
    changed = writeSessionPlace(target.file, learnedPlace(place, search, fetchedAt), true) || changed;
  }
  if (changed) publish();
};

/** Prochaine session dont le lieu est à chercher : la plus récente, hors lecture seule et hors échecs du lancement. */
const nextSession = (): LibrarySession | null => {
  let best: LibrarySession | null = null;
  for (const s of lib.all) {
    if (s.readOnly || failed.has(s.record.summary.startMs) || !needsPlaceSearch(s.record)) continue;
    if (!best || s.record.summary.startMs > best.record.summary.startMs) best = s;
  }
  return best;
};

/** Un passage : une session après l'autre, jusqu'à ce qu'il n'y en ait plus, que la mémoire change ou qu'une requête échoue. */
const runPass = async (search: PlaceFetcher): Promise<void> => {
  const gen = lib.generation;
  let unpublished = false;
  try {
    for (;;) {
      if (gen !== lib.generation || !writableFolder()) return;
      const session = nextSession();
      if (!session) return;
      const { record } = session;
      const placeSearch = placeSearchOf(record.sport);
      const start = record.summary.start;
      if (!placeSearch || !start) return;
      const others = lib.all.filter((s) => s.file !== session.file).map((s) => s.record);
      const local = localPlace(record, others, PLACE_DEFAULTS, new Date().toISOString());
      if (local) {
        // Rien de changé (ne devrait pas arriver) : la session est écartée, pour ne pas tourner sur elle.
        if (writeSessionPlace(session.file, local, true)) unpublished = true;
        else failed.add(record.summary.startMs);
        continue;
      }
      if (unpublished) {
        publish();
        unpublished = false;
      }
      const pause = lastRequestAt + PLACE_PAUSE_MS - Date.now();
      if (pause > 0) await wait(pause);
      if (gen !== lib.generation) return;
      lastRequestAt = Date.now();
      const end = needsArrival(record, PLACE_DEFAULTS) ? record.summary.end ?? null : null;
      let found: PlaceSearchResult;
      try {
        found = await search(start, end, placeSearch === 'eau', PLACE_DEFAULTS.waterRadiusM);
      } catch (err) {
        // Pas de réseau, serveur occupé : retenté à la prochaine occasion ; réponse illisible ou refusée : au lancement suivant.
        if (!isPlaceNetworkError(err)) failed.add(record.summary.startMs);
        again = false;
        return;
      }
      if (gen !== lib.generation) return;
      // La session a pu changer pendant la requête (activité, lieu corrigé) : rangé seulement s'il est toujours à chercher.
      const now = findSession(session.file);
      if (!now || now.readOnly || !needsPlaceSearch(now.record) || placeSearchOf(now.record.sport) !== placeSearch) continue;
      if (!writeSessionPlace(session.file, choosePlace(found, placeSearch, start, new Date().toISOString()))) failed.add(record.summary.startMs);
    }
  } finally {
    if (unpublished && gen === lib.generation) publish();
  }
};

/**
 * Cherche le lieu des sessions qui n'en ont pas, en fond (voir l'en-tête). Sans effet tant que
 * `startPlaceSearch` n'a pas été appelé. Appelée pendant un passage, elle le prolonge.
 */
export const queuePlaces = (): void => {
  const search = fetcher;
  if (!search) return;
  if (running) {
    again = true;
    return;
  }
  const run = (async () => {
    do {
      again = false;
      await runPass(search);
    } while (again);
  })()
    .catch(() => undefined)
    .finally(() => {
      running = null;
    });
  running = run;
};

/**
 * Lance la recherche des lieux, une fois l'interface affichée : la file part tout de suite (ouverture déjà
 * finie), puis à chaque occasion. `search` : la recherche sur le réseau (les tests en donnent une fausse).
 */
export const startPlaceSearch = (search: PlaceFetcher = fetchPlaceSearch): void => {
  fetcher = search;
  queuePlaces();
};

/** Passage en cours, pour les tests ; `null` s'il n'y en a pas. */
export const placePass = (): Promise<void> | null => running;

/** Arrête la recherche et oublie l'état du lancement (tests). */
export const resetPlaceSearch = (): void => {
  fetcher = null;
  lastRequestAt = -Infinity;
  again = false;
  failed.clear();
};
