import { isObject, parseJson } from '../core/basics';
import { isSportType } from '../core/sportProfiles';
import { JOURNALS_DIR, RESTING_HR_FILE, settingsPath } from './folderLayout';
import {
  isNewerRestingHrFile, mergeRestingResults, parseRestingHrFile, restingHrFileText, sameRestingResults, type StoredRestingResult,
} from './restingHrStore';
import { SETTINGS_VERSION, parseSettingsFile, type SettingsFile } from './settingsFile';
import { SYNC_SIDES, otherSyncSide, syncFileRole, type SyncSideName, type SyncStamp } from './syncBase';

/**
 * Ce que la synchronisation transporte à côté des sessions et des itinéraires : les fichiers de réglages de chaque
 * appareil (`reglages/*.json`), les tests de FC repos (`fc-repos.json`) et les journaux d'enregistrement rendus à
 * l'utilisateur (`journaux/`). Plan pur, refait en entier à chaque synchronisation d'après ce que les deux dossiers
 * contiennent : une reprise après une coupure ne refait que ce qui manque, sans base à tenir. Rien n'est jamais
 * supprimé, d'aucun côté, et rien ne compte pour le garde-fou.
 *
 * Fichiers de réglages : recopiés comme des fichiers, jamais adoptés. Aucune valeur de réglage d'un appareil ne
 * change : chaque appareil garde les siens (DECISIONS §8), et ceux reçus ne s'adoptent que par « Reprendre ».
 * - Un fichier que l'autre côté n'a pas lui est recopié, sauf s'il ne se lit pas, s'il porte l'identifiant de
 *   l'appareil qui le recevrait (chaque appareil écrit seul son fichier), ou si ce côté a déjà, sous un autre nom,
 *   un fichier du même appareil au moins aussi récent (appareil renommé : l'ancien nom ne revient pas ; renommé sans
 *   autre changement, à même date, aucun des deux noms ne voyage avant le changement suivant de ses réglages).
 * - Même nom des deux côtés, appareils différents : rien n'est écrasé, c'est dit.
 * - Même nom, même appareil, contenus différents : le fichier d'un appareil n'est écrit que par cet appareil, la copie
 *   de l'autre côté ne fait que le suivre. Le fichier propre de l'ordinateur remplace toujours la copie du téléphone,
 *   et le fichier propre du téléphone relié (son identifiant, lu dans le marqueur de son dossier) celle de
 *   l'ordinateur, quelle que soit leur date : la date d'un fichier peut reculer (réglages repris d'un fichier plus
 *   ancien, horloge remise en arrière), et la comparer laisserait une copie ancienne écraser le fichier de son
 *   propriétaire. Pour le fichier d'un troisième appareil, la copie à la date la plus récente l'emporte, celle du
 *   téléphone à égalité : les deux dates viennent de l'horloge de cet appareil. Identifiant du téléphone inconnu (son
 *   marqueur ne le porte pas, ce qui est le cas de toutes les versions jusqu'ici) : tout fichier autre que celui de
 *   l'ordinateur est pris du téléphone.
 * - Même nom sans pouvoir dire quel appareil a écrit les deux copies (aucune ne porte d'identifiant d'appareil, ou
 *   l'identifiant de l'ordinateur est inconnu) : on ne conclut pas au même appareil, rien n'est écrasé, c'est dit.
 * - Un fichier qui ne se lit pas n'est ni recopié ni écrasé ; un fichier d'une version plus récente n'est jamais
 *   écrasé (il peut être recopié là où il manque : rien n'est réécrit).
 *
 * Tests de FC repos : fondus par la fonction de l'appareil (`mergeRestingResults`), l'ordinateur passant d'abord, et
 * écrits seulement du côté où le résultat diffère. Un fichier illisible ou d'une version plus récente, d'un côté,
 * n'est ni réécrit ni fondu : rien ne s'écrit d'aucun côté pour ce fichier, c'est dit.
 *
 * Journaux : copiés du téléphone vers l'ordinateur seulement, à l'octet, là où l'ordinateur n'a pas ce nom ; jamais
 * écrasés, jamais supprimés, jamais envoyés au téléphone. Un journal de même nom et d'une autre taille est laissé, et
 * c'est dit.
 */

/** Un fichier tel qu'un côté le montre : son nom, son texte (`null` s'il n'a pas pu être lu). */
export interface SyncNamedText {
  name: string;
  text: string | null;
}

export interface SyncExtrasInput {
  /** Fichiers de `reglages/` de chaque côté. */
  settings: Record<SyncSideName, readonly SyncNamedText[]>;
  /** Texte de `fc-repos.json` de chaque côté, `null` s'il manque. */
  restingHr: Record<SyncSideName, string | null>;
  /** Listage de `journaux/` de chaque côté (noms et tailles) ; absent : rien n'est copié. */
  journals?: Record<SyncSideName, readonly SyncStamp[]>;
  /** Identifiant de l'ordinateur (`device.id` de son fichier de réglages) ; inconnu : aucun fichier de même nom des deux côtés n'est remplacé. */
  computerDeviceId?: string | null;
  /**
   * Identifiant du téléphone relié, lu dans le marqueur de son dossier (`readMarkerDevice`) : son fichier propre fait
   * foi. Inconnu : tout fichier autre que celui de l'ordinateur est pris du téléphone.
   */
  phoneDeviceId?: string | null;
}

/** Sorte de fichier transporté. */
export type SyncExtraKind = 'settings' | 'restingHr' | 'journal';

/**
 * Une écriture : `text` dans `path` (chemin depuis la racine du dossier) du côté `to`. `replaces` : le texte que le
 * fichier doit encore avoir au moment d'écrire (`null` : il ne doit pas exister) ; sinon l'écriture est abandonnée.
 * `added` : pour une fonte, le nombre d'entrées que ce côté n'avait pas.
 */
export interface SyncExtraOp {
  kind: Exclude<SyncExtraKind, 'journal'>;
  to: SyncSideName;
  path: string;
  text: string;
  replaces: string | null;
  added: number;
}

/**
 * Une copie à l'octet, du téléphone vers l'ordinateur : `path` (depuis la racine) lu sur le téléphone, à la taille de
 * `source`, et écrit sous le même chemin sur l'ordinateur, où rien ne doit encore porter ce nom.
 */
export interface SyncExtraCopy {
  kind: 'journal';
  to: 'computer';
  path: string;
  source: SyncStamp;
}

/**
 * Pourquoi un fichier est laissé : même nom et autre appareil (`otherDevice`), illisible (`unreadable`), d'une
 * version plus récente (`newer`), portant l'identifiant de l'appareil qui le recevrait (`ownFile`), déjà là sous un
 * autre nom dans une version au moins aussi récente (`outdated`), même nom sans qu'on puisse dire quel appareil a
 * écrit les deux copies (`unknownDevice`), journal de même nom et d'une autre taille (`sameName`). L'exécutant y
 * ajoute : changé depuis sa lecture (`changed`), erreur en l'écrivant (`failed`).
 */
export type SyncExtraLeftReason = 'otherDevice' | 'unreadable' | 'newer' | 'ownFile' | 'outdated' | 'unknownDevice' | 'sameName' | 'changed' | 'failed';

export interface SyncExtraLeft {
  kind: SyncExtraKind;
  path: string;
  /** Le côté du fichier en cause ; `null` : les deux. */
  side: SyncSideName | null;
  reason: SyncExtraLeftReason;
}

export interface SyncExtrasPlan {
  ops: SyncExtraOp[];
  copies: SyncExtraCopy[];
  left: SyncExtraLeft[];
}

interface SettingsCopy {
  name: string;
  text: string;
  file: SettingsFile | null;
}

/** Faux pour un fichier de réglages d'une version plus récente : jamais écrasé. */
const isWritableSettingsFile = (file: SettingsFile): boolean => file.version <= SETTINGS_VERSION;

/** Fichiers de réglages lisibles ou non d'un côté, rangés par nom sans majuscules (les deux systèmes de fichiers les confondent). */
const byLowerName = (files: readonly SyncNamedText[]): Map<string, SettingsCopy> => {
  const map = new Map<string, SettingsCopy>();
  for (const f of files) {
    if (f.text === null || syncFileRole(settingsPath(f.name)) !== 'settings') continue;
    map.set(f.name.toLowerCase(), { name: f.name, text: f.text, file: parseSettingsFile(f.text) });
  }
  return map;
};

const deviceOf = (file: SettingsFile): string | null => file.device?.id ?? null;

/**
 * Côté dont la copie d'un même fichier de réglages l'emporte : celui de son propriétaire quand il est l'un des deux
 * appareils (ou quand le téléphone ne dit pas qui il est), sinon la date la plus récente, le téléphone à égalité.
 */
const settingsWinner = (device: string | null, own: string, phoneDevice: string | null, computerSavedAt: number, phoneSavedAt: number): SyncSideName => {
  if (device === own) return 'computer';
  if (phoneDevice === null || device === phoneDevice) return 'phone';
  return computerSavedAt > phoneSavedAt ? 'computer' : 'phone';
};

const planSettings = (input: SyncExtrasInput, plan: SyncExtrasPlan): void => {
  const own = input.computerDeviceId ?? null;
  const sides: Record<SyncSideName, Map<string, SettingsCopy>> = {
    computer: byLowerName(input.settings.computer), phone: byLowerName(input.settings.phone),
  };
  const names = [...new Set([...sides.computer.keys(), ...sides.phone.keys()])].sort();
  const leave = (path: string, side: SyncSideName | null, reason: SyncExtraLeftReason): void => {
    plan.left.push({ kind: 'settings', path, side, reason });
  };
  const write = (to: SyncSideName, name: string, source: SettingsCopy, replaces: string | null): void => {
    plan.ops.push({ kind: 'settings', to, path: settingsPath(name), text: source.text, replaces, added: 0 });
  };
  for (const key of names) {
    const copies = { computer: sides.computer.get(key) ?? null, phone: sides.phone.get(key) ?? null };
    if (copies.computer && copies.phone) {
      const c = copies.computer;
      const p = copies.phone;
      if (c.text === p.text) continue;
      if (!c.file || !p.file) {
        leave(settingsPath(c.name), !c.file && !p.file ? null : !c.file ? 'computer' : 'phone', 'unreadable');
        continue;
      }
      const device = deviceOf(c.file);
      const phoneDevice = deviceOf(p.file);
      if (device === null && phoneDevice === null) {
        leave(settingsPath(c.name), null, 'unknownDevice');
        continue;
      }
      if (device !== phoneDevice) {
        leave(settingsPath(c.name), null, 'otherDevice');
        continue;
      }
      // Sans l'identifiant de l'ordinateur, ce fichier peut être le sien comme celui du téléphone : aucun ne suit l'autre.
      if (own === null) {
        leave(settingsPath(c.name), null, 'unknownDevice');
        continue;
      }
      const winner = settingsWinner(device, own, input.phoneDeviceId ?? null, c.file.savedAt, p.file.savedAt);
      const loser = otherSyncSide(winner);
      const target = copies[loser] as SettingsCopy;
      if (!isWritableSettingsFile(target.file as SettingsFile)) {
        leave(settingsPath(target.name), loser, 'newer');
        continue;
      }
      write(loser, target.name, copies[winner] as SettingsCopy, target.text);
      continue;
    }
    const from: SyncSideName = copies.computer ? 'computer' : 'phone';
    const to = otherSyncSide(from);
    const source = copies[from] as SettingsCopy;
    if (!source.file) {
      leave(settingsPath(source.name), from, 'unreadable');
      continue;
    }
    const device = deviceOf(source.file);
    if (to === 'computer' && own !== null && device === own) {
      leave(settingsPath(source.name), from, 'ownFile');
      continue;
    }
    // Appareil renommé : l'autre côté a déjà, sous son nouveau nom, une version au moins aussi récente.
    const sameDevice = device !== null && [...sides[to].values()].some((f) => f.file && deviceOf(f.file) === device && f.file.savedAt >= (source.file as SettingsFile).savedAt);
    if (sameDevice) {
      leave(settingsPath(source.name), from, 'outdated');
      continue;
    }
    write(to, source.name, source, null);
  }
};

/** `fc-repos.json` relu d'un côté : absent, lisible (sa liste), illisible ou d'une version plus récente. */
type RestingReadable = { state: 'absent' | 'ok'; list: StoredRestingResult[]; text: string | null };
type RestingRead = RestingReadable | { state: 'unreadable' | 'newer' };

const readResting = (text: string | null): RestingRead => {
  if (text === null) return { state: 'absent', list: [], text };
  if (isNewerRestingHrFile(text)) return { state: 'newer' };
  const list = parseRestingHrFile(text);
  return list === null ? { state: 'unreadable' } : { state: 'ok', list, text };
};

const isReadable = (r: RestingRead): r is RestingReadable => r.state === 'absent' || r.state === 'ok';

const planResting = (texts: Record<SyncSideName, string | null>, plan: SyncExtrasPlan): void => {
  const computer = readResting(texts.computer);
  const phone = readResting(texts.phone);
  const read = { computer, phone };
  for (const side of SYNC_SIDES) {
    const r = read[side];
    if (r.state === 'unreadable' || r.state === 'newer') plan.left.push({ kind: 'restingHr', path: RESTING_HR_FILE, side, reason: r.state });
  }
  if (!isReadable(computer) || !isReadable(phone)) return;
  const sides: Record<SyncSideName, RestingReadable> = { computer, phone };
  const merged = mergeRestingResults(sides.computer.list, sides.phone.list);
  for (const side of SYNC_SIDES) {
    const r = sides[side];
    if (r.state === 'absent' ? merged.length === 0 : sameRestingResults(merged, r.list)) continue;
    const had = new Set(r.list.map((x) => x.startedAtMs));
    const added = merged.filter((x) => !had.has(x.startedAtMs)).length;
    plan.ops.push({ kind: 'restingHr', to: side, path: RESTING_HR_FILE, text: restingHrFileText(merged), replaces: r.text, added });
  }
};

/** Journaux du téléphone que l'ordinateur n'a pas, sous le même nom (sans égard à la casse). */
const planJournals = (journals: Record<SyncSideName, readonly SyncStamp[]>, plan: SyncExtrasPlan): void => {
  const onComputer = new Map(journals.computer.map((f) => [f.name.toLowerCase(), f]));
  for (const file of [...journals.phone].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = `${JOURNALS_DIR}/${file.name}`;
    if (syncFileRole(path) !== 'journal') continue;
    const there = onComputer.get(file.name.toLowerCase());
    if (!there) plan.copies.push({ kind: 'journal', to: 'computer', path, source: file });
    else if (there.size !== file.size) plan.left.push({ kind: 'journal', path, side: null, reason: 'sameName' });
  }
};

/** Plan des fichiers de réglages, des tests de FC repos et des journaux, d'après ce que les deux côtés tiennent. */
export const planSyncExtras = (input: SyncExtrasInput): SyncExtrasPlan => {
  const plan: SyncExtrasPlan = { ops: [], copies: [], left: [] };
  planSettings(input, plan);
  planResting(input.restingHr, plan);
  if (input.journals) planJournals(input.journals, plan);
  return plan;
};

/**
 * Activité d'une fiche que l'appareil qui la reçoit ne connaît pas : son identifiant, s'il n'est ni dans `known`
 * (les identifiants des activités de cet appareil) ni celui d'un calcul (toujours reconnu : l'activité de base) ;
 * `null` sinon, ou si la fiche ne nomme aucune activité.
 */
export const unknownSyncActivity = (recordText: string, known: readonly string[]): string | null => {
  const record = parseJson(recordText);
  const id = isObject(record) ? record.activityId : undefined;
  if (typeof id !== 'string' || id === '' || isSportType(id) || known.includes(id)) return null;
  return id;
};
