import type { FolderEntry, MemoryFolder } from '../platform/memoryFolder';
import { MARKER_FILE, SESSIONS_DIR, markerText, sessionPath } from '../library/folderLayout';
import { isCompleteGpxText } from '../library/pendingTemps';
import { imuFileName, recordFileName, serializeRecord, type SessionRecord } from '../library/record';
import {
  SYNC_DIR, SYNC_SIDES, emptySyncBase, markerTextWithId, otherSyncSide, parseSyncBase, phoneTrashPaths, readMarkerId, readMarkerPass,
  serializeSyncBase, syncAncestorPath,
  syncBaseLine, syncBasePath, syncRefusal, withSyncDone, withSyncHeld, withSyncLine, withoutSyncLine,
  type SyncBase, type SyncFiles, type SyncRefusal, type SyncSideName, type SyncStamp,
} from '../library/syncBase';
import {
  planSync, restrictSyncPlan, syncListing, syncPair, syncRecordsToRead, syncSide,
  type SyncAncestors, type SyncGuardLimits, type SyncHeldChoice, type SyncItem, type SyncOp, type SyncPlan, type SyncScope, type SyncTargetNames, type SyncTrashed,
} from '../library/syncPlan';
import { mergeSyncRecords } from '../library/syncRecordMerge';
import { sessionRecord } from './record.fixture';

/** Fichier de test seulement : le code de l'application ne l'importe pas. */

/** Liaison coupée (câble débranché, programme fermé) : levée par toute opération d'un faux dossier après sa coupure. */
export class SyncCutError extends Error {}


/** Le téléphone écrit un fichier remplacé sous ce nom, à côté de l'original (`MemoryFolderPlugin.java`). */
export const REPLACE_SUFFIX = '.tracker-tmp';
/** Un fichier neuf, et tout ce qu'écrit le câble (lot 217-3c), le temps de l'écrire. */
export const NEW_SUFFIX = '.tracker-new';

/** Un nom tel que le téléphone le montre, et le nom que le fichier porte vraiment. */
interface VisibleName {
  name: string;
  actual: string;
}

/**
 * Les fichiers du téléphone tels que son application les voit après une coupure (`MemoryFolderPlugin.list`) : un
 * `.tracker-new` resté seul est caché ; un `.tracker-tmp` à côté de son original aussi ; un `.tracker-tmp` resté seul
 * reprend le nom de l'original (`finishInterruptedReplace`). Le lot 217-3c en fera une pièce de `library/`.
 */
const phoneVisibleNames = (names: readonly string[]): VisibleName[] => {
  const present = new Set(names);
  const visible: VisibleName[] = [];
  for (const actual of names) {
    if (actual.endsWith(NEW_SUFFIX)) continue;
    if (actual.endsWith(REPLACE_SUFFIX)) {
      const original = actual.slice(0, -REPLACE_SUFFIX.length);
      if (present.has(original)) continue;
      present.add(original);
      visible.push({ name: original, actual });
      continue;
    }
    visible.push({ name: actual, actual });
  }
  return visible;
};

export interface SyncFolder extends MemoryFolder {
  /**
   * Téléphone : déplace un fichier hors de la mémoire, sous `to` (chemin depuis `Documents/`, dans
   * `Tracker-corbeille/…`), sans jamais écraser ce qui y est ; une opération élémentaire, comptée dans la coupure.
   */
  moveAside(path: string, to: string): Promise<void>;
  /** Ce qui a été déplacé hors de la mémoire du téléphone, par chemin depuis `Documents/`. */
  aside(): Map<string, string>;
  /** Pose un fichier sans passer par le protocole d'écriture, ni compter dans la coupure : la mise en place d'un essai. */
  put(path: string, content: string | Uint8Array): void;
  /** Efface un fichier de même, comme le ferait l'application de l'appareil ou un gestionnaire de fichiers. */
  drop(path: string): void;
  /** Texte d'un fichier tel qu'il est rangé, `null` s'il manque. */
  text(path: string): string | null;
  /** Tous les chemins rangés, temporaires compris, triés. */
  paths(): string[];
  /** Coupe la liaison après `n` opérations élémentaires de plus (écriture, renommage, suppression) ; `null` : plus de coupure. */
  cutAfter(n: number | null): void;
  /** Le listage omet désormais ces chemins, que `stat` et la lecture voient encore : un canal qui liste en retard. */
  lag(paths: readonly string[]): void;
  /** Opérations élémentaires faites depuis la création. */
  steps(): number;
}

interface Stored {
  bytes: Uint8Array;
  mtimeMs: number;
}

/**
 * Faux dossier mémoire fidèle, en mémoire vive : octets gardés, date qui avance d'une seconde à chaque écriture,
 * sous-dossiers listés. `phone` : il écrit comme le câble écrira sur le téléphone (temporaire `.tracker-new`, puis
 * renommage qui remplace l'original d'un coup, `mv -f`), ne supprime jamais (`remove` y lève : seul `moveAside` retire
 * un fichier) et montre ses fichiers comme l'application du téléphone les verrait après une coupure : un
 * `.tracker-tmp` seul sous le nom de son fichier, les autres temporaires cachés.
 * `clockMs` : son horloge de départ, propre à chaque appareil.
 * `cable` : il répond comme le téléphone vu par le câble (`phoneMemoryFolder`) : `stat` et la lecture d'après le
 * dernier listage, refait par `list` (ou au premier besoin) et tenu à jour par ses propres écritures, jamais par ce
 * que l'appareil change de lui-même (`put`, `drop`) ; `remove` d'un fichier absent de ce listage ne fait rien.
 */
export const createSyncFolder = (
  { phone = false, clockMs = 1_800_000_000_000, cable = false }: { phone?: boolean; clockMs?: number; cable?: boolean } = {},
): SyncFolder => {
  const files = new Map<string, Stored>();
  const moved = new Map<string, string>();
  const lagging = new Set<string>();
  /** Le dernier listage du câble : nom vu, et taille et date à ce moment-là. */
  let listed: Map<string, { size: number; mtimeMs: number }> | null = null;
  let clock = clockMs;
  let remaining: number | null = null;
  let done = 0;
  const encode = (content: string | Uint8Array): Uint8Array => (typeof content === 'string' ? new TextEncoder().encode(content) : content);
  const store = (path: string, bytes: Uint8Array): void => {
    clock += 1000;
    files.set(path, { bytes, mtimeMs: clock });
  };
  const step = (action: () => void): void => {
    if (remaining === 0) throw new SyncCutError('liaison coupée');
    action();
    done += 1;
    if (remaining !== null) remaining -= 1;
  };
  /** Chemin rangé qui répond à ce nom : lui-même, ou sur le téléphone son remplacement resté seul. */
  const resolve = (path: string): string | null =>
    files.has(path) ? path : phone && files.has(path + REPLACE_SUFFIX) ? path + REPLACE_SUFFIX : null;
  /** Les chemins tels que l'application de l'appareil les voit, chacun avec celui qu'il porte vraiment. */
  const visible = (): VisibleName[] => (phone ? phoneVisibleNames([...files.keys()]) : [...files.keys()].map((path) => ({ name: path, actual: path })));
  const relist = (): Map<string, { size: number; mtimeMs: number }> => {
    listed = new Map(visible().filter(({ name }) => !lagging.has(name)).map(({ name, actual }) => {
      const file = files.get(actual) as Stored;
      return [name, { size: file.bytes.length, mtimeMs: file.mtimeMs }];
    }));
    return listed;
  };
  /** Au câble, un chemin que le dernier listage ne porte pas est absent. */
  const unlisted = (path: string): boolean => cable && !(listed ?? relist()).has(path);
  const noteWritten = (path: string): void => {
    const at = resolve(path);
    if (cable && listed && at) listed.set(path, { size: (files.get(at) as Stored).bytes.length, mtimeMs: (files.get(at) as Stored).mtimeMs });
  };
  const writeBytes = async (path: string, bytes: Uint8Array): Promise<void> => {
    await writeRaw(path, bytes);
    noteWritten(path);
  };
  const writeRaw = async (path: string, bytes: Uint8Array): Promise<void> => {
    if (!phone) return step(() => store(path, bytes));
    const temp = path + NEW_SUFFIX;
    step(() => store(temp, bytes));
    step(() => {
      const written = files.get(temp) as Stored;
      files.delete(temp);
      files.delete(path + REPLACE_SUFFIX);
      files.set(path, written);
    });
  };
  return {
    kind: phone ? 'device' : 'disk',
    label: phone ? 'Téléphone' : 'Ordinateur',
    list: async (dir) => {
      if (cable) relist();
      const prefix = dir === '' ? '' : `${dir}/`;
      const entries = new Map<string, FolderEntry>();
      for (const { name, actual } of visible()) {
        const file = files.get(actual) as Stored;
        if (lagging.has(name) || !name.startsWith(prefix)) continue;
        const rest = name.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash < 0) entries.set(rest, { name: rest, kind: 'file', size: file.bytes.length, mtimeMs: file.mtimeMs });
        else entries.set(rest.slice(0, slash), { name: rest.slice(0, slash), kind: 'directory', size: 0, mtimeMs: 0 });
      }
      return [...entries.values()];
    },
    readText: async (path) => {
      const at = unlisted(path) ? null : resolve(path);
      return at === null ? null : new TextDecoder().decode((files.get(at) as Stored).bytes);
    },
    readBytes: async (path) => {
      const at = unlisted(path) ? null : resolve(path);
      return at === null ? null : (files.get(at) as Stored).bytes;
    },
    stat: async (path) => {
      if (cable) return (listed ?? relist()).get(path) ?? null;
      const at = resolve(path);
      const file = at === null ? null : (files.get(at) as Stored);
      return file ? { size: file.bytes.length, mtimeMs: file.mtimeMs } : null;
    },
    writeText: (path, text) => writeBytes(path, encode(text)),
    writeBytes,
    remove: async (path) => {
      if (phone) throw new Error(`rien ne s'efface du téléphone : ${path}`);
      if (unlisted(path)) return;
      const at = resolve(path);
      if (at !== null) step(() => files.delete(at));
      listed?.delete(path);
    },
    moveAside: async (path, to) => {
      if (!phone) throw new Error('seul le téléphone met de côté');
      if (unlisted(path)) return;
      const at = resolve(path);
      if (at === null) return;
      if ([...moved.keys()].some((p) => p.toLowerCase() === to.toLowerCase())) throw new Error(`déjà pris : ${to}`);
      step(() => {
        moved.set(to, new TextDecoder().decode((files.get(at) as Stored).bytes));
        files.delete(at);
      });
      listed?.delete(path);
    },
    aside: () => new Map(moved),
    put: (path, content) => store(path, encode(content)),
    drop: (path) => void files.delete(path),
    text: (path) => {
      const file = files.get(path);
      return file ? new TextDecoder().decode(file.bytes) : null;
    },
    paths: () => [...files.keys()].sort(),
    cutAfter: (n) => {
      remaining = n;
    },
    lag: (paths) => {
      lagging.clear();
      for (const path of paths) lagging.add(path);
    },
    steps: () => done,
  };
};

/** Dossier mémoire vide, reconnu par son marqueur ; `id` : l'identifiant qu'une synchronisation passée y a laissé. */
export const syncMemoryFolder = (options: { phone?: boolean; clockMs?: number; id?: string; cable?: boolean } = {}): SyncFolder => {
  const folder = createSyncFolder(options);
  folder.put(MARKER_FILE, options.id ? (markerTextWithId(markerText(), options.id) as string) : markerText());
  return folder;
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** Nom du GPX d'une session partie à `startMs`, tel que l'écrirait un appareil décalé de `offsetH` heures de l'UTC. */
export const syncGpxName = (startMs: number, offsetH = 0): string => {
  const d = new Date(startMs + offsetH * 3_600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}_wingfoil.gpx`;
};

/** GPX synthétique parti à `startMs`, `hz` points par seconde pendant `seconds` secondes, cap à l'est. */
export const syncGpx = (startMs: number, { hz = 1, seconds = 20 }: { hz?: number; seconds?: number } = {}): string => {
  const points = Array.from({ length: seconds * hz + 1 }, (_, i) => {
    const time = new Date(startMs + (i * 1000) / hz).toISOString();
    return `<trkpt lat="43.5" lon="${(3.9 + i * 0.00002).toFixed(6)}"><time>${time}</time></trkpt>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="essai"><trk><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
};

export interface SyncSessionSetup {
  /** Nom du GPX ; par défaut celui de l'instant de départ en UTC. */
  file?: string;
  hz?: number;
  seconds?: number;
  record?: Partial<SessionRecord>;
  summary?: Partial<SessionRecord['summary']>;
  /** Champs de plus écrits bruts dans la fiche : ceux d'une version que celle-ci ne connaît pas. */
  extra?: Record<string, unknown>;
  /** Pose aussi des capteurs de cette taille en octets. */
  imuBytes?: number;
  /** Faux : GPX seul, sans sa fiche. */
  withRecord?: boolean;
}

/** Range une session dans `sessions/` d'un faux dossier ; rend le nom de son GPX. */
export const putSyncSession = (folder: SyncFolder, startMs: number, setup: SyncSessionSetup = {}): string => {
  const file = setup.file ?? syncGpxName(startMs);
  const seconds = setup.seconds ?? 20;
  const record = sessionRecord({ gpx: file, ...setup.record }, { startMs, endMs: startMs + seconds * 1000, ...setup.summary });
  if (setup.imuBytes) folder.put(sessionPath(imuFileName(file)), new Uint8Array(setup.imuBytes).fill(7));
  if (setup.withRecord !== false) folder.put(sessionPath(recordFileName(file)), serializeRecord({ ...record, ...setup.extra } as SessionRecord));
  folder.put(sessionPath(file), syncGpx(startMs, { hz: setup.hz, seconds }));
  return file;
};

/** Fiche d'une session d'un faux dossier, relue ; `null` si elle manque. */
export const readSyncRecord = (folder: SyncFolder, gpxFile: string): (SessionRecord & Record<string, unknown>) | null => {
  const text = folder.text(sessionPath(recordFileName(gpxFile)));
  return text === null ? null : (JSON.parse(text) as SessionRecord & Record<string, unknown>);
};

/** Réécrit la fiche d'une session comme le ferait l'application de l'appareil : sa date avance. */
export const editSyncRecord = (folder: SyncFolder, gpxFile: string, edit: (record: SessionRecord & Record<string, unknown>) => SessionRecord): void => {
  const record = readSyncRecord(folder, gpxFile);
  if (!record) throw new Error(`pas de fiche pour ${gpxFile}`);
  folder.put(sessionPath(recordFileName(gpxFile)), serializeRecord(edit(record)));
};

/** Supprime une session comme l'application du téléphone : GPX, fiche et capteurs, pour de bon. */
export const deleteSyncSession = (folder: SyncFolder, gpxFile: string): void => {
  for (const name of [gpxFile, recordFileName(gpxFile), imuFileName(gpxFile)]) folder.drop(sessionPath(name));
};

/**
 * Fausse corbeille de l'ordinateur : un sous-dossier par identité, qui tient les fichiers supprimés sur
 * l'ordinateur, et à part (`du-telephone/`) ceux qu'il a fallu sauver du téléphone avant de les en retirer.
 */
export const SYNC_TRASH_DIR = 'corbeille';
const FROM_PHONE_DIR = 'du-telephone';
const trashPath = (startMs: number, name: string): string => `${SYNC_TRASH_DIR}/${startMs}/${name}`;
const phoneTrashPath = (startMs: number, name: string): string => trashPath(startMs, `${FROM_PHONE_DIR}/${name}`);

/** Ce que tient la fausse corbeille, par identité : les fichiers des deux origines, avec leur taille. */
export const syncTrashOf = async (computer: SyncFolder): Promise<SyncTrashed[]> => {
  const entries = new Map<number, { name: string; size: number }[]>();
  for (const path of computer.paths().filter((p) => p.startsWith(`${SYNC_TRASH_DIR}/`))) {
    const [, start, ...rest] = path.split('/');
    const files = entries.get(Number(start)) ?? [];
    files.push({ name: rest[rest.length - 1], size: (await computer.stat(path))?.size ?? 0 });
    entries.set(Number(start), files);
  }
  return [...entries].map(([startMs, files]) => ({ startMs, files }));
};

/** Supprime une session comme l'application de l'ordinateur : ses fichiers passent à la corbeille. */
export const trashSyncSession = (computer: SyncFolder, startMs: number, gpxFile: string): void => {
  for (const name of [gpxFile, recordFileName(gpxFile), imuFileName(gpxFile)]) {
    const text = computer.text(sessionPath(name));
    if (text !== null) computer.put(trashPath(startMs, name), text);
    computer.drop(sessionPath(name));
  }
};

/** Restaure une session de la fausse corbeille sous ses noms d'origine. */
export const restoreSyncSession = (computer: SyncFolder, startMs: number): void => {
  const prefix = `${SYNC_TRASH_DIR}/${startMs}/`;
  for (const path of computer.paths().filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))) {
    computer.put(sessionPath(path.slice(prefix.length)), computer.text(path) as string);
    computer.drop(path);
  }
};

/** Noms des GPX de `sessions/`, tels que l'application de l'appareil les listerait, triés. */
export const syncSessionFiles = async (folder: SyncFolder): Promise<string[]> =>
  (await folder.list(SESSIONS_DIR)).map((e) => e.name).filter((name) => name.endsWith('.gpx')).sort();

/** Heure de l'ordinateur des essais, par défaut. */
export const SYNC_NOW_MS = Date.UTC(2026, 10, 25, 12, 0, 0);

export interface SyncRunOptions {
  /** Ce que la synchronisation a le droit de faire ; par défaut tout. */
  scope?: SyncScope;
  /** Vrai : l'utilisateur a confirmé les suppressions arrêtées par le garde-fou. */
  confirmDeletions?: boolean;
  phonePath?: string | null;
  nowMs?: number;
  /** Sort d'une session du téléphone que l'ordinateur a supprimée hors synchronisation ; par défaut celui du moteur. */
  heldOnPhone?: SyncHeldChoice;
  /** Identités que l'utilisateur a dit garder (`SyncInput.keep`). */
  keep?: readonly number[];
  /** Seuils du garde-fou (`SyncInput.guardLimits`). */
  guardLimits?: SyncGuardLimits;
}

export interface SyncRun {
  refusal: SyncRefusal | 'newerBase' | null;
  /** Le plan exécuté, restrictions comprises ; `null` après un refus. */
  plan: SyncPlan | null;
  /** Vrai si le garde-fou a retenu les suppressions. */
  held: boolean;
  /** Sessions dont toutes les opérations ont été faites, et celles abandonnées en route (fichier changé, listage en retard). */
  done: SyncItem[];
  skipped: SyncItem[];
  /** Vrai si la liaison a été coupée en route. */
  cut: boolean;
}

/** Une opération à laquelle l'exécutant renonce : l'état du moment n'est pas celui du plan. */
class StaleError extends Error {}

let idCount = 0;
/** Identifiant de dossier d'essai, différent à chaque appel. */
const nextSyncId = (): string => `dossier-essai-${String(++idCount).padStart(4, '0')}`;

/**
 * Exécutant minimal du plan sur deux faux dossiers, pour éprouver le moteur de bout en bout : il lit ce que le plan
 * demande, fait les opérations dans l'ordre sûr (capteurs, fiche, GPX en dernier ; à la suppression, GPX d'abord),
 * revérifie par `stat` avant de supprimer, et réécrit la base après chaque session menée au bout. La corbeille de
 * l'ordinateur y est un simple sous-dossier par identité.
 */
export const runFixtureSync = async (computer: SyncFolder, phone: SyncFolder, options: SyncRunOptions = {}): Promise<SyncRun> => {
  const folders: Record<SyncSideName, SyncFolder> = { computer, phone };
  const scope = options.scope ?? { computer: true, phone: true, deletions: true };
  const run: SyncRun = { refusal: null, plan: null, held: false, done: [], skipped: [], cut: false };
  try {
    const markers = { computer: await computer.readText(MARKER_FILE), phone: await phone.readText(MARKER_FILE) };
    run.refusal = syncRefusal(markers.computer, markers.phone);
    if (run.refusal) return run;
    const ids = { computer: readMarkerId(markers.computer), phone: readMarkerId(markers.phone) };
    const read = ids.phone ? parseSyncBase(await computer.readText(syncBasePath(ids.phone))) : { state: 'absent' as const };
    if (read.state === 'newer') return { ...run, refusal: 'newerBase' };
    const pair = syncPair(ids.computer, ids.phone, options.phonePath ?? null, read.state === 'ok' ? read.base : null, readMarkerPass(markers.phone));
    for (const side of SYNC_SIDES) {
      if (!pair.newId[side] || !scope[side]) continue;
      ids[side] = nextSyncId();
      await folders[side].writeText(MARKER_FILE, markerTextWithId(markers[side], ids[side] as string) as string);
    }

    const listings = { computer: syncListing(await computer.list(SESSIONS_DIR)), phone: syncListing(await phone.list(SESSIONS_DIR)) };
    const ancestors = new Map<number, SyncAncestors>();
    for (const line of pair.base?.sessions ?? []) {
      ancestors.set(line.startMs, {
        computer: await computer.readText(syncAncestorPath(pair.base?.phoneId as string, line.startMs, 'computer')),
        phone: await computer.readText(syncAncestorPath(pair.base?.phoneId as string, line.startMs, 'phone')),
      });
    }
    const sideOf = async (side: SyncSideName) => {
      const texts = new Map<string, string | null>();
      const names = syncRecordsToRead(listings[side], pair.base, side, (startMs, of) => (ancestors.get(startMs)?.[of] ?? null) !== null);
      for (const name of names) texts.set(name, await folders[side].readText(sessionPath(name)));
      const state = syncSide(listings[side], texts);
      // Un GPX que la base ne connaît pas est lu pour savoir s'il est fini : il faudra de toute façon le recopier.
      const known = new Set(pair.base?.sessions.map((s) => s[side].gpx.name));
      for (const session of state.sessions) {
        if (known.has(session.gpx.name)) continue;
        session.gpxComplete = isCompleteGpxText((await folders[side].readText(sessionPath(session.gpx.name))) ?? '');
      }
      return state;
    };
    const trashedNow = async (): Promise<Set<number>> => new Set((await syncTrashOf(computer)).map((entry) => entry.startMs));
    let plan = planSync({
      pair, computer: await sideOf('computer'), phone: await sideOf('phone'), ancestors, trash: await syncTrashOf(computer), heldOnPhone: options.heldOnPhone,
      keep: options.keep, nowMs: options.nowMs ?? SYNC_NOW_MS, guardLimits: options.guardLimits,
    });
    run.held = plan.guard.tripped && !options.confirmDeletions;
    plan = restrictSyncPlan(plan, { ...scope, deletions: scope.deletions && !run.held });
    run.plan = plan;

    let base: SyncBase = pair.base ?? emptySyncBase(ids.computer ?? '', ids.phone ?? '', options.phonePath ?? null);
    const saveBase = async (): Promise<void> => {
      if (plan.saveBase) await computer.writeText(syncBasePath(base.phoneId), serializeSyncBase(base));
    };
    const stamp = async (side: SyncSideName, name: string | null): Promise<SyncStamp | null> => {
      const stat = name === null ? null : await folders[side].stat(sessionPath(name));
      return stat && name !== null ? { name, ...stat } : null;
    };
    const filesOf = async (side: SyncSideName, names: SyncTargetNames): Promise<SyncFiles> => {
      const gpx = await stamp(side, names.gpx);
      if (!gpx) throw new StaleError(names.gpx);
      return { gpx, record: await stamp(side, names.record), imu: await stamp(side, names.imu) };
    };
    /** Renonce si le fichier n'est plus celui du plan. */
    const expect = async (side: SyncSideName, file: SyncStamp): Promise<void> => {
      const now = await folders[side].stat(sessionPath(file.name));
      if (!now || now.size !== file.size || now.mtimeMs !== file.mtimeMs) throw new StaleError(file.name);
    };
    const bytesOf = async (side: SyncSideName, name: string): Promise<Uint8Array> => {
      const bytes = await folders[side].readBytes(sessionPath(name));
      if (!bytes) throw new StaleError(name);
      return bytes;
    };

    const execute = async (op: SyncOp, item: SyncItem): Promise<void> => {
      switch (op.kind) {
        case 'copy': {
          const from = otherSyncSide(op.to);
          const gpx = await bytesOf(from, op.source.gpx.name);
          if (!isCompleteGpxText(new TextDecoder().decode(gpx))) throw new StaleError(op.source.gpx.name);
          if (op.source.imu && op.target.imu) await folders[op.to].writeBytes(sessionPath(op.target.imu), await bytesOf(from, op.source.imu.name));
          if (op.source.record && op.target.record) {
            const record = op.recordText === null ? await bytesOf(from, op.source.record.name) : new TextEncoder().encode(op.recordText);
            await folders[op.to].writeBytes(sessionPath(op.target.record), record);
          }
          await folders[op.to].writeBytes(sessionPath(op.target.gpx), gpx);
          return;
        }
        case 'writeRecord':
          await expect(op.on, op.file);
          await folders[op.on].writeText(sessionPath(op.file.name), op.text);
          return;
        case 'copyRecord':
          await expect(op.to, op.file);
          await folders[op.to].writeBytes(sessionPath(op.file.name), await bytesOf(otherSyncSide(op.to), op.source.name));
          return;
        case 'copyImu':
          await folders[op.to].writeBytes(sessionPath(op.target), await bytesOf(otherSyncSide(op.to), op.source.name));
          return;
        case 'trash': {
          if (op.absent !== null && (await phone.stat(sessionPath(op.absent)))) throw new StaleError(op.absent);
          for (const file of op.files) await computer.writeBytes(trashPath(item.startMs, file.name), await bytesOf('computer', file.name));
          for (const file of op.files) await computer.remove(sessionPath(file.name));
          return;
        }
        case 'removeFromPhone': {
          if (op.absent !== null && (await computer.stat(sessionPath(op.absent)))) throw new StaleError(op.absent);
          if (op.keep === 'all') {
            for (const file of op.files) await computer.writeBytes(phoneTrashPath(item.startMs, file.name), await bytesOf('phone', file.name));
          }
          const line = syncBaseLine(base, item.startMs);
          if (op.keep === 'record' && op.recordText !== null && line?.computer.record) {
            const inTrash = trashPath(item.startMs, line.computer.record.name);
            const kept = ancestors.get(item.startMs) ?? { computer: null, phone: null };
            const merged = mergeSyncRecords({ computer: (await computer.readText(inTrash)) ?? '', phone: op.recordText, computerAncestor: kept.computer, phoneAncestor: kept.phone });
            if (merged?.computer) await computer.writeText(inTrash, merged.computer);
          }
          // Rien ne part qui ait changé depuis le listage : taille et date relues.
          for (const file of op.files) await expect('phone', file);
          const paths = op.files.map((file) => sessionPath(file.name));
          const targets = phoneTrashPaths(op.moveTo, paths, phone.aside().keys());
          for (const path of paths) await phone.moveAside(path, targets.get(path) as string);
        }
      }
    };

    for (const item of plan.items) {
      try {
        for (const op of item.ops) await execute(op, item);
        if (item.base.kind === 'forget') {
          base = withoutSyncLine(base, item.startMs);
          for (const side of SYNC_SIDES) await computer.remove(syncAncestorPath(base.phoneId, item.startMs, side));
        } else if (item.base.kind === 'hold') {
          base = withSyncHeld(base, item.startMs);
        } else if (item.base.kind === 'set' && plan.saveBase) {
          for (const side of SYNC_SIDES) {
            const text = item.base.ancestors[side];
            if (text !== null) await computer.writeText(syncAncestorPath(base.phoneId, item.startMs, side), text);
          }
          base = withSyncLine(base, { startMs: item.startMs, computer: await filesOf('computer', item.base.computer), phone: await filesOf('phone', item.base.phone) });
        }
        if (item.base.kind !== 'keep') await saveBase();
        run.done.push(item);
      } catch (err) {
        if (!(err instanceof StaleError)) throw err;
        run.skipped.push(item);
      }
    }
    const complete = scope.computer && scope.phone && scope.deletions && !run.held && run.skipped.length === 0;
    if (complete) {
      base = withSyncDone(base, options.nowMs ?? SYNC_NOW_MS, await trashedNow());
      await saveBase();
    }
    return run;
  } catch (err) {
    if (!(err instanceof SyncCutError)) throw err;
    return { ...run, cut: true };
  }
};

/** La base gardée par l'ordinateur pour ce téléphone, relue ; `null` s'il n'y en a pas de lisible. */
export const readFixtureBase = (computer: SyncFolder, phone: SyncFolder): SyncBase | null => {
  const id = readMarkerId(phone.text(MARKER_FILE));
  const read = id ? parseSyncBase(computer.text(syncBasePath(id))) : null;
  return read?.state === 'ok' ? read.base : null;
};

/** Vrai si le dossier de l'ordinateur garde quelque chose sous `synchro/`. */
export const hasSyncFiles = (computer: SyncFolder): boolean => computer.paths().some((p) => p.startsWith(`${SYNC_DIR}/`));
