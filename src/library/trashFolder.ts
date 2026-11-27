import { ROUTES_DIR, SESSIONS_DIR } from './folderLayout';
import type { MemoryFolder } from '../platform/memoryFolder';
import {
  DEPOSIT_FILE, TRASH_DIR, TRASH_INDEX_PATH, TRASH_KEEP_MS, depositAdoption, depositEntry, depositMissing, expiredTrashEntries, isTrashDirName,
  isWritableTrash, orphanTrashDirs, parseDeposit, parseTrashIndex, rebuiltEntryRecord, rebuiltTrashEntry, reusableRouteEntry, reusableTrashEntry,
  serializeTrashIndex, trashDirName, trashFilePath, withoutTrashEntries, type TrashCopy, type TrashEntry, type TrashFile, type TrashIndex,
  type TrashKind, type TrashOrigin,
} from './trash';

/**
 * Gestes de la corbeille sur le dossier mémoire (`trash.ts` pour ce qu'elle range) : y mettre, purger, vider,
 * retirer une entrée, recopier les fichiers d'une entrée, adopter les dépôts de l'ordinateur (téléphone). Une seule
 * opération à la fois (`inTrashQueue`) : une purge qui listerait la corbeille pendant une mise à la corbeille prendrait
 * son sous-dossier, pas encore dans l'index, pour un reste à effacer. Un dépôt de l'ordinateur (sous-dossier qui tient
 * `depose.json`, écrit avant tout déplacement) n'est jamais effacé ni refait en entrée par ces gestes : seule son
 * adoption le fait entrer dans l'index (`adoptDeposits`).
 */

export type TrashFolder = Pick<MemoryFolder, 'list' | 'readText' | 'readBytes' | 'writeText' | 'writeBytes' | 'remove' | 'removeDir' | 'stat'>;

/** Refus d'écrire dans une corbeille dont l'index ne se lit pas : ses entrées seraient perdues. */
export const TRASH_LOCKED_MESSAGE = "La corbeille ne se lit pas (corbeille/corbeille.json) : rien n'y est rangé, et rien n'est supprimé.";

let queue: Promise<unknown> = Promise.resolve();

/** Lance `action` après les opérations de corbeille en cours, une à la fois. */
export const inTrashQueue = <T,>(action: () => Promise<T>): Promise<T> => {
  const next = queue.then(action, action);
  queue = next.then(() => undefined, () => undefined);
  return next;
};

export const readTrashIndex = async (f: Pick<MemoryFolder, 'readText'>): Promise<TrashIndex> =>
  parseTrashIndex(await f.readText(TRASH_INDEX_PATH));

const writeIndex = (f: TrashFolder, entries: readonly TrashEntry[]): Promise<void> =>
  f.writeText(TRASH_INDEX_PATH, serializeTrashIndex(entries));

/** Nom lu dans une fiche (session ou itinéraire), `null` sans fiche lisible ni nom. */
const nameInRecord = async (f: TrashFolder, path: string): Promise<string | null> => {
  try {
    const value: unknown = JSON.parse((await f.readText(path)) ?? 'null');
    const name = typeof value === 'object' && value !== null ? (value as { name?: unknown }).name : null;
    return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
  } catch {
    return null;
  }
};

/** Parmi les sous-dossiers `dirs` de la corbeille, les dépôts de l'ordinateur : ceux qui tiennent `depose.json`. */
const pendingDeposits = async (f: Pick<MemoryFolder, 'stat'>, dirs: readonly string[]): Promise<string[]> => {
  const pending: string[] = [];
  for (const dir of dirs) if ((await f.stat(trashFilePath(dir, DEPOSIT_FILE))) !== null) pending.push(dir);
  return pending;
};

/**
 * Index de la corbeille, à lire dans la file avant tout geste qui l'écrit ou la purge. Index absent alors que des
 * sous-dossiers de la corbeille sont là (index effacé à la main, synchronisation de OneDrive) : ils ne sont pas des
 * restes à effacer, leurs entrées sont refaites depuis leurs fichiers (`rebuiltTrashEntry`, date tirée du nom du
 * sous-dossier) et l'index réécrit ; la corbeille les montre de nouveau et les garde 30 jours comme les autres.
 */
const readRepairedIndex = async (f: TrashFolder): Promise<TrashIndex> => {
  const index = await readTrashIndex(f);
  if (index.state !== 'absent') return index;
  const dirs = (await f.list(TRASH_DIR)).filter((e) => e.kind === 'directory' && isTrashDirName(e.name));
  if (dirs.length === 0) return index;
  const pending = new Set(await pendingDeposits(f, dirs.map((d) => d.name)));
  const entries: TrashEntry[] = [];
  for (const { name: dir } of dirs) {
    // Un dépôt de l'ordinateur n'est pas une entrée perdue : il attend son adoption.
    if (pending.has(dir)) continue;
    const files: TrashFile[] = (await f.list(`${TRASH_DIR}/${dir}`)).filter((e) => e.kind === 'file').map((e) => ({ name: e.name, size: e.size }));
    const record = rebuiltEntryRecord(dir, files);
    const entry = rebuiltTrashEntry(dir, files, record ? await nameInRecord(f, trashFilePath(dir, record)) : null);
    if (entry) entries.push(entry);
  }
  // Sous-dossiers vides seulement : rien à garder, l'index reste absent et la purge les efface.
  if (entries.length === 0) return index;
  await writeIndex(f, entries);
  return { state: 'ok', entries };
};

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.byteLength !== b.byteLength) return false;
  for (let k = 0; k < a.byteLength; k++) if (a[k] !== b[k]) return false;
  return true;
};

/**
 * Première des entrées `candidates` qui tient chacun de ces fichiers à l'identique, octet pour octet. La taille ne
 * suffit pas : une fiche de session ou un itinéraire a plusieurs versions sous la même identité, et une version
 * différente de même taille, tenue pour déjà rangée, serait perdue. Une lecture en échec vaut une différence.
 */
const entryHoldingSameBytes = async (
  f: TrashFolder, candidates: readonly TrashEntry[], files: readonly { name: string; bytes: Uint8Array }[],
): Promise<TrashEntry | null> => {
  for (const entry of candidates) {
    let same = true;
    for (const file of files) {
      const kept = entry.files.find((g) => g.name.toLowerCase() === file.name.toLowerCase());
      const theirs = kept ? await f.readBytes(trashFilePath(entry.dir, kept.name)).catch(() => null) : null;
      if (!theirs || !sameBytes(theirs, file.bytes)) {
        same = false;
        break;
      }
    }
    if (same) return entry;
  }
  return null;
};

/** Profondeur au-delà de laquelle un sous-dossier imbriqué dans une entrée n'est plus parcouru. */
const MAX_DEPTH = 8;

/**
 * Efface le contenu d'un dossier de la corbeille (`path` depuis la racine), sous-dossiers imbriqués compris, puis lui.
 * `spareDeposit` : rien n'est effacé si le dossier tient `depose.json` quand on le liste (un dépôt de l'ordinateur
 * commencé depuis qu'on l'a jugé à effacer : l'ordinateur écrit `depose.json` avant d'y déplacer quoi que ce soit).
 */
const eraseDir = async (f: TrashFolder, path: string, depth: number, spareDeposit = false): Promise<void> => {
  const listed = await f.list(path);
  if (spareDeposit && listed.some((e) => e.kind === 'file' && e.name.toLowerCase() === DEPOSIT_FILE)) return;
  for (const e of listed) {
    if (e.kind === 'file') await f.remove(`${path}/${e.name}`);
    else if (depth < MAX_DEPTH) await eraseDir(f, `${path}/${e.name}`, depth + 1);
  }
  await f.removeDir?.(path);
};

/**
 * Efface les fichiers d'un sous-dossier de la corbeille, et ceux d'un dossier posé dedans, puis le sous-dossier s'il
 * le sait : sans cela, un dossier imbriqué ferait échouer son effacement à chaque purge.
 */
const eraseTrashDir = (f: TrashFolder, dir: string, spareDeposit = false): Promise<void> => eraseDir(f, `${TRASH_DIR}/${dir}`, 0, spareDeposit);

/** Ce qu'on met à la corbeille. */
export interface TrashRequest {
  kind: Exclude<TrashKind, 'restes'>;
  /** Fichiers, chemins depuis la racine, dans l'ordre où on les retire de la mémoire (GPX d'abord pour une session). */
  paths: string[];
  /** Le fichier qui fait l'entrée (GPX de la session, fiche de l'itinéraire) ; parmi `paths`. */
  main: string;
  /** Session : `summary.startMs`. */
  startMs?: number;
  /** Itinéraire : base des noms et création. */
  routeBase?: string;
  createdAt?: string;
  /** Nom montré. */
  name: string;
}

/**
 * Range dans la corbeille une copie des fichiers de `request` : recopiés dans l'ordre inverse de leur retrait (pour
 * une session : capteurs, fiche, GPX en dernier), puis l'entrée écrite dans l'index. Les originaux ne sont pas
 * retirés ici : l'appelant les retire ensuite, comme il le faisait sans corbeille. Une entrée déjà faite pour la même
 * session ou le même itinéraire (suppression coupée après l'index), qui tient ces fichiers à l'identique, octet pour
 * octet, est reprise sans rien recopier. Fichier absent : sauté ; fichier principal absent : rien n'est rangé
 * (`null`). Lève sans rien changer si l'index ne se lit pas (`TRASH_LOCKED_MESSAGE`) ; une copie coupée laisse un
 * sous-dossier hors de l'index, effacé à la purge suivante.
 */
export const stashInTrash = (f: TrashFolder, request: TrashRequest, nowMs: number): Promise<TrashEntry | null> =>
  inTrashQueue(async () => {
    const index = await readRepairedIndex(f);
    if (!isWritableTrash(index)) throw new Error(TRASH_LOCKED_MESSAGE);
    const mainStat = await f.stat(request.main);
    if (mainStat === null) return null;
    const mainName = baseName(request.main);
    const read: { name: string; bytes: Uint8Array }[] = [];
    for (const path of request.paths) {
      const bytes = await f.readBytes(path);
      if (bytes !== null) read.push({ name: baseName(path), bytes });
    }
    const files: TrashFile[] = read.map((file) => ({ name: file.name, size: file.bytes.byteLength }));
    const candidates = index.entries.filter((e) => (request.kind === 'session'
      ? reusableTrashEntry([e], request.startMs ?? NaN, mainName, files)
      : reusableRouteEntry([e], request.routeBase ?? '', request.createdAt ?? '', mainStat.size)) !== null);
    const reused = await entryHoldingSameBytes(f, candidates, read);
    if (reused) return reused;
    const listed = await f.list(TRASH_DIR);
    const identity = request.kind === 'session' ? String(request.startMs) : request.routeBase ?? mainName;
    const dir = trashDirName(nowMs, identity, [...listed.map((e) => e.name), ...index.entries.map((e) => e.dir)]);
    for (const file of [...read].reverse()) await f.writeBytes(trashFilePath(dir, file.name), file.bytes);
    const entry: TrashEntry = {
      dir,
      kind: request.kind,
      startMs: request.kind === 'session' ? request.startMs ?? null : null,
      routeBase: request.kind === 'itineraire' ? request.routeBase ?? null : null,
      createdAt: request.kind === 'itineraire' ? request.createdAt ?? null : null,
      name: request.name,
      deletedAtMs: nowMs,
      origin: 'ordinateur',
      reason: 'supprimee',
      main: mainName,
      files,
    };
    await writeIndex(f, [...index.entries, entry]);
    return entry;
  });

/**
 * Purge : les entrées de plus de `keepMs` (par défaut `TRASH_KEEP_DAYS` jours), fichiers d'abord, entrées ensuite ;
 * puis les sous-dossiers absents de l'index. Rien si l'index ne se lit pas. Rend les entrées restantes. Une erreur
 * sur un sous-dossier n'arrête pas les autres ; l'entrée dont les fichiers n'ont pas tous été effacés reste, pour la
 * purge suivante.
 */
export const purgeTrash = (f: TrashFolder, nowMs: number, keepMs: number = TRASH_KEEP_MS): Promise<TrashIndex> =>
  inTrashQueue(async () => {
    const index = await readRepairedIndex(f);
    if (!isWritableTrash(index)) return index;
    const purged: string[] = [];
    for (const entry of expiredTrashEntries(index.entries, nowMs, keepMs)) {
      try {
        await eraseTrashDir(f, entry.dir);
        purged.push(entry.dir);
      } catch {
        // Laissée : reprise à la purge suivante.
      }
    }
    const entries = withoutTrashEntries(index.entries, purged);
    if (purged.length > 0) await writeIndex(f, entries);
    const listing = await f.list(TRASH_DIR);
    const candidates = orphanTrashDirs(entries, listing);
    for (const dir of orphanTrashDirs(entries, listing, await pendingDeposits(f, candidates))) {
      await eraseTrashDir(f, dir, true).catch(() => undefined);
    }
    return { state: index.state === 'absent' && entries.length === 0 ? 'absent' : 'ok', entries };
  });

/**
 * Retire de la corbeille les entrées `dirs` (restaurées, revenues par un import, ou supprimées définitivement) :
 * l'index d'abord, puis leurs fichiers. Une coupure entre les deux laisse un sous-dossier hors de l'index, effacé à
 * la purge suivante, jamais une entrée sans ses fichiers. Rend les entrées restantes.
 */
export const dropTrashEntries = (f: TrashFolder, dirs: readonly string[]): Promise<TrashEntry[]> =>
  inTrashQueue(async () => {
    const index = await readRepairedIndex(f);
    if (!isWritableTrash(index)) throw new Error(TRASH_LOCKED_MESSAGE);
    const known = new Set(index.entries.map((e) => e.dir.toLowerCase()));
    const gone = dirs.filter((d) => known.has(d.toLowerCase()));
    if (gone.length === 0) return index.entries;
    const entries = withoutTrashEntries(index.entries, gone);
    await writeIndex(f, entries);
    for (const dir of gone) await eraseTrashDir(f, dir).catch(() => undefined);
    return entries;
  });

/**
 * « Vider la corbeille » : l'index vidé, puis chaque sous-dossier de la corbeille, entrées et restes compris ; un dépôt
 * de l'ordinateur pas encore adopté reste (il n'est pas encore dans la corbeille de cet appareil).
 */
export const emptyTrash = (f: TrashFolder): Promise<void> =>
  inTrashQueue(async () => {
    const index = await readTrashIndex(f);
    if (!isWritableTrash(index)) throw new Error(TRASH_LOCKED_MESSAGE);
    const known = new Set(index.entries.map((e) => e.dir.toLowerCase()));
    const dirs = (await f.list(TRASH_DIR)).filter((e) => e.kind === 'directory' && isTrashDirName(e.name)).map((e) => e.name);
    const pending = new Set(await pendingDeposits(f, dirs.filter((d) => !known.has(d.toLowerCase()))));
    await writeIndex(f, []);
    // Un sous-dossier qui ne s'efface pas n'arrête pas les autres : hors de l'index, il part à la purge suivante.
    for (const dir of dirs) {
      if (pending.has(dir)) continue;
      await eraseTrashDir(f, dir, !known.has(dir.toLowerCase())).catch(() => undefined);
    }
  });

/**
 * Adopte les dépôts de l'ordinateur (sous-dossiers de la corbeille qui tiennent `depose.json`, hors de l'index) : un
 * dépôt complet, ou partiel une fois qu'aucun fichier manquant n'est plus à sa place d'origine (`depositAdoption`),
 * est inscrit à l'index (`depositEntry`, entré dans la corbeille à `nowMs`), puis son `depose.json` effacé ; un dépôt
 * dont la liste a changé pendant les contrôles attend la passe suivante ; un dépôt
 * où rien n'est arrivé est effacé. Un `depose.json` illisible : l'entrée est refaite depuis les fichiers
 * (`rebuiltTrashEntry`). Sans effet si l'index ne se lit pas. Se rejoue sans dommage : une coupure entre l'index et
 * l'effacement de `depose.json` laisse un dépôt déjà dans l'index, que les gestes de la corbeille traitent comme une
 * entrée. Rend les entrées ajoutées.
 */
export const adoptDeposits = (f: TrashFolder, nowMs: number): Promise<TrashEntry[]> =>
  inTrashQueue(async () => {
    const index = await readRepairedIndex(f);
    if (!isWritableTrash(index)) return [];
    const known = new Set(index.entries.map((e) => e.dir.toLowerCase()));
    const dirs = (await f.list(TRASH_DIR)).filter((e) => e.kind === 'directory' && isTrashDirName(e.name) && !known.has(e.name.toLowerCase()));
    const adopted: TrashEntry[] = [];
    const settled: string[] = [];
    const filesIn = async (dir: string): Promise<TrashFile[]> => (await f.list(`${TRASH_DIR}/${dir}`))
      .filter((e) => e.kind === 'file' && e.name.toLowerCase() !== DEPOSIT_FILE)
      .map((e) => ({ name: e.name, size: e.size }));
    const sameFiles = (a: readonly TrashFile[], b: readonly TrashFile[]): boolean =>
      a.length === b.length && a.every((x) => b.some((y) => y.name === x.name && y.size === x.size));
    for (const dir of await pendingDeposits(f, dirs.map((d) => d.name))) {
      const files = await filesIn(dir);
      const deposit = parseDeposit(await f.readText(trashFilePath(dir, DEPOSIT_FILE)));
      let entry: TrashEntry | null;
      if (deposit) {
        const origin = deposit.kind === 'itineraire' ? ROUTES_DIR : SESSIONS_DIR;
        const missing = depositMissing(deposit, files.map((e) => e.name));
        const atOrigin: string[] = [];
        for (const name of missing) if ((await f.stat(`${origin}/${name}`)) !== null) atOrigin.push(name);
        if (depositAdoption(deposit, files.map((e) => e.name), atOrigin) === 'wait') continue;
        // Un déplacement est un renommage d'un seul coup : un fichier absent du listage et de sa place d'origine est
        // arrivé entre-temps. Relu après les contrôles, le dépôt doit être celui du listage ; sinon il attend la passe
        // suivante, pour que rien n'y reste hors de l'entrée.
        if (!sameFiles(files, await filesIn(dir))) continue;
        entry = depositEntry(dir, deposit, files, nowMs);
      } else {
        const record = rebuiltEntryRecord(dir, files);
        entry = rebuiltTrashEntry(dir, files, record ? await nameInRecord(f, trashFilePath(dir, record)) : null);
        if (entry) entry = { ...entry, deletedAtMs: nowMs };
      }
      if (entry) adopted.push(entry);
      settled.push(dir);
    }
    if (adopted.length > 0) await writeIndex(f, [...index.entries, ...adopted]);
    for (const dir of settled) {
      await f.remove(trashFilePath(dir, DEPOSIT_FILE));
      // Rien d'arrivé : le sous-dossier vide part ; un échec le laisse à la purge, qui n'y voit plus de dépôt.
      if (!adopted.some((e) => e.dir === dir)) await f.removeDir?.(`${TRASH_DIR}/${dir}`).catch(() => undefined);
    }
    return adopted;
  });

/**
 * Fichiers à ranger tels quels, lus ailleurs (la synchronisation : de l'ordinateur ou du téléphone) : ceux d'une
 * session (par défaut), ses restes, ou ceux d'un itinéraire (`itineraire` : sa fiche et son GPX).
 */
export type TrashBytesRequest = {
  name: string;
  origin: TrashOrigin;
  /**
   * Session : nom de son GPX ; il peut manquer parmi `files` (restes d'une suppression coupée : fiche, capteurs).
   * Itinéraire : nom de sa fiche.
   */
  main: string;
  /** Les fichiers, dans l'ordre de leur retrait (GPX d'abord pour une session, fiche d'abord pour un itinéraire), sous leurs noms d'origine. */
  files: { name: string; bytes: Uint8Array }[];
} & (
  /** `restes` : fiche ou capteurs sans leur GPX, jamais montrés comme une session ; par défaut `session`. */
  | { kind?: 'session' | 'restes'; startMs: number }
  /** Itinéraire : base de ses noms de fichiers, et création (`null` : fiche sans date, reconnue à sa base). */
  | { kind: 'itineraire'; routeBase: string; createdAt: string | null }
);

/** Vrai si `e` peut tenir ces fichiers d'un itinéraire : même base, même création, même origine, mêmes tailles. */
const routeBytesCandidate = (
  e: TrashEntry, request: Extract<TrashBytesRequest, { kind: 'itineraire' }>, files: readonly TrashFile[],
): boolean =>
  e.kind === 'itineraire' && e.origin === request.origin && e.createdAt === request.createdAt
    && e.routeBase?.toLowerCase() === request.routeBase.toLowerCase() && e.main.toLowerCase() === request.main.toLowerCase()
    && files.every((file) => e.files.some((g) => g.name.toLowerCase() === file.name.toLowerCase() && g.size === file.size));

/**
 * Range dans une entrée neuve de la corbeille des fichiers déjà lus (la synchronisation), dans l'ordre inverse de leur
 * retrait (pour une session : capteurs, fiche, puis GPX en dernier), puis l'entrée de l'index. Une entrée de même
 * identité, même origine, même fichier principal, qui tient déjà chacun de ces fichiers à l'identique, octet pour
 * octet (reprise après une coupure), est rendue sans rien recopier ; une autre version de même taille entre dans une
 * entrée neuve. Lève sans rien changer si l'index ne se lit pas.
 */
export const stashFilesInTrash = (f: TrashFolder, request: TrashBytesRequest, nowMs: number): Promise<TrashEntry> =>
  inTrashQueue(async () => {
    const index = await readTrashIndex(f);
    if (!isWritableTrash(index)) throw new Error(TRASH_LOCKED_MESSAGE);
    const sizes = request.files.map((file) => ({ name: file.name, size: file.bytes.byteLength }));
    const route = request.kind === 'itineraire' ? request : null;
    const session = request.kind === 'itineraire' ? null : request;
    const candidates = index.entries.filter((e) => (route
      ? routeBytesCandidate(e, route, sizes)
      : reusableTrashEntry([e], session?.startMs ?? NaN, request.main, sizes, request.origin, session?.kind ?? 'session') !== null));
    const reused = await entryHoldingSameBytes(f, candidates, request.files);
    if (reused) return reused;
    const listed = await f.list(TRASH_DIR);
    const identity = route ? route.routeBase : String(session?.startMs);
    const dir = trashDirName(nowMs, identity, [...listed.map((e) => e.name), ...index.entries.map((e) => e.dir)]);
    for (const file of [...request.files].reverse()) await f.writeBytes(trashFilePath(dir, file.name), file.bytes);
    const entry: TrashEntry = {
      dir, kind: route ? 'itineraire' : session?.kind ?? 'session', startMs: session ? session.startMs : null,
      routeBase: route ? route.routeBase : null, createdAt: route ? route.createdAt : null, name: request.name, deletedAtMs: nowMs,
      origin: request.origin, reason: 'supprimee', main: request.main, files: sizes,
    };
    await writeIndex(f, [...index.entries, entry]);
    return entry;
  });

/**
 * Ajoute des fichiers à une entrée existante (les restes d'une session, rangés avec elle), sans rien y écraser : un
 * fichier déjà là à l'identique, octet pour octet, est tenu pour gardé ; déjà là avec un autre contenu (même de même
 * taille) ou illisible, rien n'est ajouté et la réponse est `false`, pour que l'appelant les range ailleurs. Lève si
 * l'index ne se lit pas. Les fichiers ajoutés sont écrits avant l'index : une coupure laisse au pire un fichier hors
 * de l'index, effacé avec l'entrée.
 */
export const addFilesToTrashEntry = (f: TrashFolder, dir: string, files: readonly { name: string; bytes: Uint8Array }[]): Promise<boolean> =>
  inTrashQueue(async () => {
    const index = await readTrashIndex(f);
    if (!isWritableTrash(index)) throw new Error(TRASH_LOCKED_MESSAGE);
    const entry = index.entries.find((e) => e.dir === dir);
    if (!entry) return false;
    const added: TrashFile[] = [];
    for (const file of files) {
      const at = await f.stat(trashFilePath(dir, file.name));
      if (at) {
        const theirs = at.size === file.bytes.byteLength ? await f.readBytes(trashFilePath(dir, file.name)).catch(() => null) : null;
        if (!theirs || !sameBytes(theirs, file.bytes)) return false;
      }
      const listed = entry.files.some((e) => e.name.toLowerCase() === file.name.toLowerCase());
      if (!at || !listed) added.push({ name: file.name, size: file.bytes.byteLength });
    }
    for (const file of files) {
      if (!(await f.stat(trashFilePath(dir, file.name)))) await f.writeBytes(trashFilePath(dir, file.name), file.bytes);
    }
    if (added.length === 0) return true;
    const known = new Set(entry.files.map((e) => e.name.toLowerCase()));
    const merged = [...entry.files, ...added.filter((a) => !known.has(a.name.toLowerCase()))];
    await writeIndex(f, index.entries.map((e) => (e === entry ? { ...e, files: merged } : e)));
    return true;
  });

/**
 * Réécrit un fichier texte d'une entrée (une fiche de la corbeille dans laquelle on a fondu ce que le téléphone y
 * ajoutait), puis sa taille dans l'index. Lève si l'index ne se lit pas ou si l'entrée n'y est plus ; une coupure
 * entre les deux laisse l'ancienne taille dans l'index, sans autre effet.
 */
export const rewriteTrashText = (f: TrashFolder, dir: string, name: string, text: string): Promise<void> =>
  inTrashQueue(async () => {
    const index = await readTrashIndex(f);
    if (!isWritableTrash(index)) throw new Error(TRASH_LOCKED_MESSAGE);
    const entry = index.entries.find((e) => e.dir === dir);
    if (!entry) throw new Error(`${dir}/${name} manque dans la corbeille.`);
    const bytes = new TextEncoder().encode(text);
    await f.writeBytes(trashFilePath(dir, name), bytes);
    const files = entry.files.map((file) => (file.name === name ? { ...file, size: bytes.byteLength } : file));
    await writeIndex(f, index.entries.map((e) => (e === entry ? { ...e, files } : e)));
  });

/**
 * Vrai si chaque fichier à recopier est encore dans la corbeille, et s'il y en a : à vérifier avant une restauration
 * faite sans que l'utilisateur ait désigné l'entrée, pour ne pas la commencer sur une entrée dont un fichier manque.
 */
export const trashHoldsCopies = async (f: Pick<MemoryFolder, 'stat'>, copies: readonly TrashCopy[]): Promise<boolean> => {
  for (const { from } of copies) if (!(await f.stat(from))) return false;
  return copies.length > 0;
};

/**
 * Parmi les fichiers `names` du dossier `dir` de la mémoire, ceux qui sont déjà, sous le même nom et au même contenu,
 * octet pour octet, des fichiers de l'entrée, alors que son fichier principal n'y est pas : les restes d'une
 * restauration ou d'une suppression coupée. La restauration peut les reprendre en place (elle y réécrit le même
 * contenu) au lieu de prendre un nom de plus à côté. Un reste d'un autre contenu n'en est pas : il n'est pas écrasé.
 */
export const trashLeftoversIn = async (
  f: Pick<MemoryFolder, 'readBytes'>, entry: TrashEntry, dir: string, names: readonly string[],
): Promise<string[]> => {
  if (names.some((name) => name.toLowerCase() === entry.main.toLowerCase())) return [];
  const leftovers: string[] = [];
  for (const name of names) {
    const kept = entry.files.find((file) => file.name.toLowerCase() === name.toLowerCase());
    if (!kept) continue;
    const mine = await f.readBytes(`${dir}/${name}`).catch(() => null);
    const theirs = await f.readBytes(trashFilePath(entry.dir, kept.name)).catch(() => null);
    if (mine && theirs && sameBytes(mine, theirs)) leftovers.push(name);
  }
  return leftovers;
};

/** Recopie les fichiers d'une entrée vers la mémoire, dans l'ordre du plan (`sessionRestorePlan`, `routeRestorePlan`). */
export const copyFromTrash = (f: TrashFolder, copies: readonly TrashCopy[]): Promise<void> =>
  inTrashQueue(async () => {
    for (const { from, to } of copies) {
      const bytes = await f.readBytes(from);
      if (bytes === null) throw new Error(`${from} manque dans la corbeille.`);
      await f.writeBytes(to, bytes);
    }
  });
