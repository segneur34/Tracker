import {
  MARKER_FILE, MEMORY_VERSION, README_FILE, markerText, readMarkerVersion, readmeText, sessionPath,
} from '../../library/folderLayout';
import { describeRefresh } from '../../library/importReport';
import { folderId } from '../../library/libraryCache';
import { imuFileName } from '../../library/record';
import {
  canChooseFolder, chooseMemoryFolder, FolderRefusedError, forgetChosenFolder, openMemoryFolder, readOnlyFolder,
  reconnectMemoryFolder, type MemoryFolder,
} from '../../platform/memoryFolder';
import { jsonStore, storageStartupFailure } from '../../platform/storage';
import { errorMessage } from '../../core/basics';
import { libraryState, reportError, setState } from './store';
import { holdUnwritten, lib, publish, takeUnwritten, writableFolder } from './memory';
import { noteSettingsGestures, readGestures, refreshFailed } from './summarySettings';
import { carryUnwritten, recordEdits } from './recordWrites';
import { cancelCacheUpdate } from './cache';
import { scan } from './scan';
import { completeScan } from './summaryQueue';
import {
  applySettingsChange, flushWrites, forgetSettingsEntries, libraryUiStarted, syncSettingsSafely, watchDeviceSettings,
} from './deviceSettings';
import { addGpx, countPending } from './addSession';
import { flushPending } from './pending';
import { recordToCopy } from './sessionRecords';

/**
 * Ouverture de la mémoire (lot 113) : le dossier mis en service ou quitté, le lancement, le choix d'un autre
 * dossier, le retour à la mémoire du navigateur et la relecture (« Mettre à jour »).
 */

/**
 * Le dossier désigné, en lecture seule si son marqueur dit une disposition plus récente : il pourrait
 * ne plus se ranger comme on le croit (`MEMORY_VERSION`). Marqueur illisible ou non lu : dossier ordinaire.
 */
const guardedFolder = async (f: MemoryFolder): Promise<MemoryFolder> => {
  const marker = await f.readText(MARKER_FILE).catch(() => null);
  return readMarkerVersion(marker) > MEMORY_VERSION ? readOnlyFolder(f) : f;
};

/** Marqueur écrit s'il manque ; mode d'emploi récrit s'il manque ou a changé. Rien en lecture seule. */
const ensureLayout = async (f: MemoryFolder): Promise<void> => {
  if (f.readOnly) return;
  if ((await f.readText(MARKER_FILE)) === null) await f.writeText(MARKER_FILE, markerText());
  if ((await f.readText(README_FILE)) !== readmeText()) await f.writeText(README_FILE, readmeText());
};

/**
 * Met un dossier en service. Rend vrai si des réglages du dossier ont
 * remplacé ceux de l'appareil. Seule la lecture de `sessions/` est
 * indispensable : marqueur, réglages et sessions en attente, s'ils échouent,
 * sont dits, et l'ouverture continue ; une fiche qu'on ne peut lire laisse
 * sa session en lecture seule (`NOT_READ_RECORD_WARNING`). Un dossier d'une
 * disposition plus récente est ouvert en lecture seule (`guardedFolder`). Dossier
 * fermé ou remplacé pendant la lecture de son marqueur : il n'est pas ouvert.
 */
const attach = async (opened: MemoryFolder): Promise<boolean> => {
  lib.generation += 1;
  cancelCacheUpdate();
  const gen = lib.generation;
  const f = await guardedFolder(opened);
  if (gen !== lib.generation) return false;
  // Fiches pas écrites de l'ancien dossier : mises de côté, pour le report dans un dossier désigné (`carryUnwritten`).
  holdUnwritten();
  lib.folder = f;
  lib.all = [];
  lib.publishPending = false;
  lib.knownNames = new Set();
  refreshFailed.clear();
  lib.diskStamps = new Map();
  recordEdits.clear();
  setState({
    status: 'opening',
    folderKind: f.kind,
    folderLabel: f.label,
    memoryReadOnly: f.readOnly === true,
    reason: null,
    sessions: [],
    duplicates: [],
    unreadable: [],
    tooLarge: [],
    scanning: null,
    toUpdate: 0,
    error: null,
  });
  try {
    await ensureLayout(f);
  } catch (err) {
    reportError(`Marqueur du dossier non écrit : ${errorMessage(err, 'erreur inconnue')}`);
  }
  const settingsChanged = await syncSettingsSafely(f);
  noteSettingsGestures(settingsChanged);
  const jobs = await scan(f, gen);
  if (gen !== lib.generation) return settingsChanged;
  setState({ status: 'ready' });
  // Le balayage d'abord : une session en attente déjà rangée, mais coupée avant sa fiche, est retrouvée
  // (`scanCompletion`, attendu par `addGpx`) au lieu d'être rangée une seconde fois sous un autre nom.
  void completeScan(f, gen, jobs).catch((err) =>
    setState({ scanning: null, toUpdate: 0, error: `Lecture du dossier interrompue : ${errorMessage(err, 'erreur inconnue')}` })
  );
  await flushPending();
  return settingsChanged;
};

const detach = (status: 'needs-permission' | 'unavailable', label: string | null, reason: string | null): void => {
  lib.generation += 1;
  cancelCacheUpdate();
  // Accès perdu (« needs-permission ») ou dossier inutilisable : les fiches pas écrites attendent le dossier désigné ensuite.
  holdUnwritten();
  lib.folder = null;
  lib.all = [];
  lib.publishPending = false;
  lib.knownNames = new Set();
  forgetSettingsEntries();
  refreshFailed.clear();
  lib.diskStamps = new Map();
  recordEdits.clear();
  setState({
    status,
    folderKind: null,
    folderLabel: label,
    memoryReadOnly: false,
    reason,
    sessions: [],
    duplicates: [],
    unreadable: [],
    tooLarge: [],
    scanning: null,
    toUpdate: 0,
    settingsFiles: [],
    settingsOffer: null,
  });
};

/**
 * Stockage de l'appareil illisible au démarrage (`storageStartupFailure`) : les réglages touchés valent par
 * défaut, en mémoire seulement. Dit dès l'interface affichée, et redit après l'ouverture de la mémoire, qui
 * efface les erreurs précédentes.
 */
const reportStorageStartupFailure = (): void => {
  const failure = storageStartupFailure();
  if (!failure) return;
  reportError(failure.all
    ? "Réglages de l'appareil illisibles au démarrage : les réglages par défaut valent jusqu'à la fermeture, et les changements faits d'ici là ne seront pas gardés. Relancez l'application"
    : "Une partie des réglages de l'appareil n'a pas pu être lue au démarrage : elle vaut par défaut jusqu'à la fermeture, et ses changements ne seront pas gardés. Relancez l'application");
};

/**
 * Ouvre la mémoire : le dossier choisi s'il est accessible, sinon celle du
 * navigateur. À lancer au démarrage, avant le premier rendu si possible : les
 * réglages repris du dossier sont alors en place pour les pages.
 */
export const openLibrary = (): Promise<void> => {
  // Première comparaison de l'appareil posée tout de suite, sur ses réglages d'avant : une mise à jour des pré-réglages,
  // faite au démarrage sans attendre une ouverture lente, y reste un geste au lieu de devenir la référence.
  if (readGestures() === null) noteSettingsGestures();
  lib.opening = (async () => {
    setState({ status: 'opening' });
    const access = await openMemoryFolder();
    if (access.state === 'ready') {
      const settingsChanged = await attach(access.folder);
      if (access.notice) reportError(access.notice);
      if (libraryUiStarted()) reportStorageStartupFailure();
      await applySettingsChange(settingsChanged);
      return;
    }
    detach(
      access.state,
      access.state === 'needs-permission' ? access.label : null,
      access.state === 'unavailable' ? access.reason : null
    );
    await countPending();
  })().catch((err) => {
    detach('unavailable', null, errorMessage(err, 'Ouverture de la mémoire impossible.'));
  });
  return lib.opening;
};

/**
 * À appeler une fois l'interface affichée. `isBusy` dit si un rechargement
 * interromprait quelque chose (un enregistrement).
 */
export const startLibraryUi = (isBusy: () => boolean): void => {
  watchDeviceSettings(isBusy);
  reportStorageStartupFailure();
  // Un réglage que l'appareil refuse de garder vaut jusqu'à la fermeture : dit une fois par lancement.
  let storageFailureShown = false;
  jsonStore.subscribeFailure(() => {
    if (storageFailureShown) return;
    storageFailureShown = true;
    reportError('Stockage de l\'appareil plein ou bloqué : les derniers changements de réglages valent jusqu\'à la fermeture de l\'application, sans être gardés');
  });
  // Écritures différées vidées dès que l'application passe en arrière-plan.
  const flushAll = () => void flushWrites();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  window.addEventListener('pagehide', flushAll);
};

/** Vrai si l'on peut désigner un vrai dossier comme mémoire (Chrome et Edge sur ordinateur). */
export const canChooseMemoryFolder = canChooseFolder;

/**
 * Désigne un dossier comme mémoire, depuis un clic. Les sessions de la
 * mémoire du navigateur y sont recopiées ; les changements qu'on n'avait pas
 * pu écrire dans l'ancien dossier sont reportés dans le nouveau.
 */
export const chooseFolder = async (): Promise<void> => {
  let picked: MemoryFolder | null;
  try {
    picked = await chooseMemoryFolder();
  } catch (err) {
    setState({ error: err instanceof FolderRefusedError ? err.message : `Dossier inaccessible : ${errorMessage(err, 'erreur inconnue')}` });
    return;
  }
  if (!picked) return;
  const previous = lib.folder;
  // Les saisies en attente partent dans l'ancienne mémoire avant qu'on la quitte.
  await flushWrites();
  const carried = takeUnwritten();
  const previousSessions = previous?.kind === 'browser' ? [...lib.all] : [];
  let settingsChanged: boolean;
  try {
    settingsChanged = await attach(picked);
  } catch (err) {
    detach('unavailable', picked.label, `Dossier inutilisable : ${errorMessage(err, 'erreur inconnue')}`);
    await carryUnwritten(carried);
    return;
  }

  // Dossier en lecture seule, ou remplacé pendant son ouverture : rien n'y entre, les sessions restent dans la mémoire du navigateur.
  const target = writableFolder();
  if (previous && previousSessions.length > 0 && target && folderId(target) === folderId(picked)) {
    let copied = 0;
    for (const session of previousSessions) {
      try {
        const text = await previous.readText(sessionPath(session.file));
        if (text === null) continue;
        const motion = await previous.readBytes(sessionPath(imuFileName(session.file)));
        const result = await addGpx(text, session.record.source, { ...await recordToCopy(previous, session), motion: motion ?? undefined });
        if (result.status === 'added') copied += 1;
      } catch (err) {
        reportError(`${session.file} non recopiée dans le dossier : ${errorMessage(err, 'erreur inconnue')}`);
      }
    }
    if (copied > 0) {
      setState({ message: `${copied} session${copied > 1 ? 's' : ''} de la mémoire du navigateur recopiée${copied > 1 ? 's' : ''} dans le dossier.` });
    }
  }
  // Après la recopie : une session de la mémoire du navigateur que le dossier n'avait pas y est maintenant.
  await carryUnwritten(carried);
  await applySettingsChange(settingsChanged);
};

/** Redonne l'autorisation au dossier choisi, depuis un clic. */
export const reconnectFolder = async (): Promise<void> => {
  let f: MemoryFolder | null;
  try {
    f = await reconnectMemoryFolder();
  } catch (err) {
    if (err instanceof FolderRefusedError) {
      // Dossier retenu écarté (un sous-dossier d'une mémoire) : retour à la mémoire du navigateur.
      const carried = takeUnwritten();
      await openLibrary();
      setState({ error: err.message });
      await carryUnwritten(carried);
      return;
    }
    setState({ error: `Dossier inaccessible : ${errorMessage(err, 'erreur inconnue')}` });
    return;
  }
  if (!f) {
    setState({ error: 'Autorisation refusée : le dossier reste inaccessible.' });
    return;
  }
  // Sur le téléphone, le dossier est désigné de nouveau : les changements pas encore écrits y sont reportés,
  // même mis de côté quand l'accès a été perdu (`detach` en « needs-permission »).
  const carried = takeUnwritten();
  let settingsChanged = false;
  try {
    settingsChanged = await attach(f);
  } catch (err) {
    detach('unavailable', f.label, `Dossier inutilisable : ${errorMessage(err, 'erreur inconnue')}`);
  }
  await carryUnwritten(carried);
  await applySettingsChange(settingsChanged);
};

/** Oublie le dossier choisi et revient à la mémoire du navigateur, où sont reportés les changements pas encore écrits. */
export const switchToBrowserMemory = async (): Promise<void> => {
  await flushWrites();
  const carried = takeUnwritten();
  await forgetChosenFolder();
  await openLibrary();
  await carryUnwritten(carried);
};

/**
 * Relit le dossier mémoire sans le refermer (« Mettre à jour ») : sessions et
 * itinéraires copiés depuis un autre appareil, réglages plus récents (qui
 * rechargent la page, comme au lancement). La liste reste affichée pendant la
 * relecture ; les écritures en attente partent d'abord, celles qui avaient
 * échoué comprises, pour qu'une fiche modifiée ne soit pas remplacée par
 * celle du disque (une fiche toujours pas écrite garde sa version en mémoire,
 * et son erreur reste dite). Le compte rendu dit combien de sessions sont
 * apparues.
 */
export const refreshLibrary = (): Promise<void> => {
  if (lib.refreshing) return lib.refreshing;
  const scanned = (async () => {
    await lib.opening;
    const f = lib.folder;
    if (!f || libraryState().status !== 'ready') return null;
    setState({ refreshing: true, message: null, error: null });
    // Balayage en cours : ce qu'il n'a pas encore publié compte parmi les sessions d'avant.
    if (lib.publishPending) publish();
    const before = new Set(libraryState().sessions.map((s) => s.record.summary.startMs));
    // Une saisie faite à partir d'ici garde sa version en mémoire (`keptInMemory`).
    const editsBefore = lib.editCount;
    await flushWrites();
    lib.generation += 1;
    cancelCacheUpdate();
    const gen = lib.generation;
    // Relecture voulue : les résumés qu'on n'avait pas su refaire sont retentés.
    refreshFailed.clear();
    const settingsChanged = await syncSettingsSafely(f);
    noteSettingsGestures(settingsChanged);
    const jobs = await scan(f, gen, editsBefore);
    if (gen !== lib.generation) return null;
    setState({ revision: libraryState().revision + 1 });
    // Le balayage avant les sessions en attente, comme à l'ouverture (`attach`) ; son échec est dit plus bas.
    const completion = completeScan(f, gen, jobs);
    completion.catch(() => undefined);
    await flushPending();
    return { gen, completion, before, settingsChanged };
  })();
  // Les écritures (enregistrement, import) attendent la lecture du dossier, pas le calcul des fiches.
  lib.opening = scanned.then(() => undefined, () => undefined);
  lib.refreshing = scanned
    .then(async (read) => {
      if (!read) return;
      await read.completion;
      if (read.gen !== lib.generation) return;
      const after = new Set(libraryState().sessions.map((s) => s.record.summary.startMs));
      setState({ message: describeRefresh(read.before, after) });
      await applySettingsChange(read.settingsChanged);
    })
    .catch((err: unknown) => {
      setState({ scanning: null, toUpdate: 0, error: `Relecture du dossier impossible : ${errorMessage(err, 'erreur inconnue')}` });
    })
    .finally(() => {
      lib.refreshing = null;
      setState({ refreshing: false });
    });
  return lib.refreshing;
};

/**
 * Dossier mémoire en service, une fois l'ouverture en cours terminée ; `null`
 * s'il n'y en a aucun d'accessible. Pour ce qui se range à côté des sessions :
 * les itinéraires (`useRouteLibrary`).
 */
export const currentMemoryFolder = async (): Promise<MemoryFolder | null> => {
  await lib.opening;
  return lib.folder;
};
