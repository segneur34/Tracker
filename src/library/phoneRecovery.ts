import { describeImport, type ImportReport } from './importReport';

/**
 * Récupération des sessions du téléphone branché au programme Windows (élément 217, lot 2) : quels fichiers de son
 * dossier lire, quelles sessions l'ordinateur a déjà sans les lire, et ce que Réglages › Mémoire en dit. Pur.
 */

/** Fichier d'un côté ou de l'autre : chemin (téléphone, relatif à son dossier) ou nom (ordinateur, dans `sessions/`), taille en octets. */
export interface SizedFile {
  path: string;
  size: number;
}

export interface PhoneRecoveryChoice {
  /** Fichiers du téléphone à passer à l'import, dans l'ordre reçu. */
  toImport: string[];
  /** GPX du téléphone dont la session est déjà sur l'ordinateur, laissés sans être lus. */
  alreadyHere: string[];
  /** Fichiers de `toImport` que l'import lira : GPX et FIT, et la fiche et les capteurs d'un GPX retenu. */
  toRead: number;
}

const extensionOf = (path: string): string => /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';

/** Chemin sans extension, en minuscules : ce qui rapproche un GPX de sa fiche et de ses capteurs. */
const keyOf = (path: string): string => path.replace(/\.[a-z0-9]+$/i, '').toLowerCase();

/** Dernier nom d'un chemin, en minuscules (le disque de Windows ignore la casse). */
const nameOf = (path: string): string => (path.split('/').pop() ?? path).toLowerCase();

/**
 * Choix des fichiers à lire sur le téléphone. `phone` : ses fichiers à importer (GPX, FIT, fiches, capteurs) ;
 * `pcSessions` : les fichiers du dossier `sessions/` de l'ordinateur.
 *
 * Une session est déjà là, et ni son GPX ni sa fiche ni ses capteurs ne sont lus, quand l'ordinateur a un GPX du même
 * nom et de la même taille, et que ses capteurs sont absents du téléphone ou de la même taille sur l'ordinateur. Tout
 * le reste passe à l'import, qui reconnaît encore une session déjà rangée sous un autre nom (heure de départ) : rien
 * n'est doublé.
 */
export const choosePhoneFiles = (phone: readonly SizedFile[], pcSessions: readonly SizedFile[]): PhoneRecoveryChoice => {
  const pc = new Map(pcSessions.map((f) => [nameOf(f.path), f.size]));
  const byKey = new Map<string, Map<string, SizedFile>>();
  for (const f of phone) {
    const key = keyOf(f.path);
    const group = byKey.get(key) ?? new Map<string, SizedFile>();
    group.set(extensionOf(f.path), f);
    byKey.set(key, group);
  }
  const skipped = new Set<string>();
  const alreadyHere: string[] = [];
  for (const [key, group] of byKey) {
    const gpx = group.get('gpx');
    if (!gpx || pc.get(nameOf(gpx.path)) !== gpx.size) continue;
    const imu = group.get('imu');
    if (imu && pc.get(nameOf(imu.path)) !== imu.size) continue;
    skipped.add(key);
    alreadyHere.push(gpx.path);
  }
  const toImport = phone.filter((f) => !skipped.has(keyOf(f.path))).map((f) => f.path);
  const toRead = toImport.filter((path) => {
    const ext = extensionOf(path);
    if (ext === 'gpx' || ext === 'fit') return true;
    return byKey.get(keyOf(path))?.has('gpx') === true;
  }).length;
  return { toImport, alreadyHere, toRead };
};

/** États du téléphone où il ne peut pas être lu, l'outil manquant mis à part. */
export type PhoneNotReady = 'absent' | 'autorisation' | 'horsLigne' | 'occupe' | 'plusieurs';

/** Issue d'une récupération, ou pourquoi elle n'a pas pu se faire. */
export type PhoneRecoveryOutcome =
  /** Le téléphone n'est pas prêt ; `count` : nombre d'appareils branchés, pour `plusieurs`. */
  | { kind: 'phone'; state: PhoneNotReady; count?: number }
  /** L'outil de Google qui lit le téléphone manque ; `folder` : où copier son dossier `platform-tools`. */
  | { kind: 'tool-missing'; folder: string }
  /** Pas de dossier `Documents/Tracker` sur le téléphone `phone`. */
  | { kind: 'no-phone-folder'; phone: string }
  /** La mémoire de l'ordinateur n'accepte pas d'import ; `text` dit pourquoi. */
  | { kind: 'memory'; text: string }
  /** Un autre import tourne. */
  | { kind: 'busy' }
  /** Panne imprévue ; `detail` : sa phrase. */
  | { kind: 'error'; detail: string }
  /**
   * Import fait, en entier ou jusqu'au débranchement (`unplugged`). `report` compte aussi, parmi les déjà présentes,
   * les sessions laissées sans être lues ; `sessionsOnPhone` : GPX et FIT trouvés sur le téléphone.
   */
  | { kind: 'done'; phone: string; report: ImportReport; sessionsOnPhone: number; unplugged: boolean };

/** Ce que Réglages › Mémoire montre d'une issue : ses phrases, un dossier à recopier, et s'il faut proposer « Réessayer ». */
export interface PhoneRecoveryText {
  paragraphs: string[];
  /** Chemin à montrer à part, sous les phrases, pour qu'on puisse le recopier. */
  folder: string | null;
  retry: boolean;
}

const say = (paragraphs: string[], retry = true, folder: string | null = null): PhoneRecoveryText => ({ paragraphs, folder, retry });

/** Phrases d'une issue, sans mot technique. */
export const describePhoneRecovery = (outcome: PhoneRecoveryOutcome): PhoneRecoveryText => {
  switch (outcome.kind) {
    case 'phone':
      switch (outcome.state) {
        case 'absent':
          return say([
            "Aucun téléphone n'est vu. Branchez votre téléphone à l'ordinateur par un câble USB, déverrouillez-le, puis cliquez sur « Réessayer ».",
            'La première fois, il faut aussi activer le « Débogage USB » du téléphone : dans Paramètres, À propos du téléphone, touchez sept fois « Version », puis activez « Débogage USB » dans les options pour les développeurs.',
          ]);
        case 'autorisation':
          return say([
            "Regardez l'écran du téléphone : il demande « Autoriser le débogage USB ? ». Cochez « Toujours autoriser cet ordinateur », touchez « Autoriser », puis cliquez ici sur « Réessayer ».",
          ]);
        case 'horsLigne':
          return say(['Le téléphone est branché mais ne répond pas. Déverrouillez son écran, débranchez puis rebranchez le câble, et cliquez sur « Réessayer ».']);
        case 'plusieurs':
          return say([
            `Plusieurs appareils sont branchés à l'ordinateur${outcome.count ? ` (${outcome.count})` : ''}. Ne laissez branché que le téléphone à lire, fermez un téléphone virtuel s'il y en a un d'ouvert, puis cliquez sur « Réessayer ».`,
          ]);
        default:
          return say(['Un autre programme utilise déjà la liaison avec le téléphone (Android Studio, par exemple). Fermez-le, puis cliquez sur « Réessayer ».']);
      }
    case 'tool-missing':
      return say([
        "Pour lire le téléphone, Tracker a besoin d'un outil gratuit de Google, « SDK Platform-Tools », absent de cet ordinateur.",
        "Téléchargez-le pour Windows sur developer.android.com/tools/releases/platform-tools, ouvrez le fichier .zip, copiez le dossier « platform-tools » qu'il contient dans le dossier ci-dessous, puis cliquez sur « Réessayer ».",
      ], true, outcome.folder);
    case 'no-phone-folder':
      return say([`Le téléphone ${outcome.phone} n'a pas de dossier « Documents/Tracker ». Tracker ne récupère que les sessions rangées dans ce dossier : sur le téléphone, ouvrez Tracker, Réglages, Mémoire, pour voir où il les range.`]);
    case 'memory':
      return say([outcome.text], false);
    case 'busy':
      return say(["Un import de sessions est déjà en cours. Attendez qu'il finisse, puis cliquez sur « Réessayer »."]);
    case 'error':
      return say([`Le téléphone n'a pas pu être lu (${outcome.detail.replace(/\.\s*$/, '')}). Vérifiez le câble, puis cliquez sur « Réessayer ».`]);
    case 'done': {
      const { report } = outcome;
      if (outcome.unplugged) {
        return say([
          "Le téléphone a été débranché pendant la récupération. Les sessions déjà rangées restent sur l'ordinateur, entières : aucune n'est rangée à moitié.",
          describeImport(report),
          'Rebranchez-le, puis cliquez sur « Réessayer » : seules les sessions qui manquent seront lues.',
        ]);
      }
      if (outcome.sessionsOnPhone === 0) {
        return say([`Aucune session dans le dossier « Documents/Tracker » du téléphone ${outcome.phone}.`], false);
      }
      const n = report.failed.length;
      if (n === 0) return say([describeImport(report)], false);
      const s = n > 1 ? 's' : '';
      return say([describeImport(report), `${n} fichier${s} non rangé${s} (${report.failed.join(' ; ')}).`], report.retryable.length > 0);
    }
  }
};
