import { errorMessage } from '../core/basics';
import { DEFAULT_RECORDING } from '../core/sportProfiles';
import { JOURNALS_DIR } from '../library/folderLayout';
import { recordingJournal, setAsideTimeMs } from '../platform/files';
import { findMotionCapture, readMotionCapture, removeMotionCapture } from '../platform/motion';
import { journalSessionActivity, parseJournal, type ParsedJournal } from '../recording/journal';
import { sessionFromJournal, type JournalSession } from '../recording/resume';
import { currentMemoryFolder, reportStartupError, saveRecordedSession } from './useSessionLibrary';
import { effectiveFoil, effectiveRecordingProfile, readStoredActivities } from './useSportSettings';

/**
 * Journaux d'enregistrement mis de côté par la reprise au lancement (illisibles, ou session impossible à
 * reconstruire), dans le dossier privé de l'application que l'utilisateur ne peut pas ouvrir (lot 232, d'après
 * Gtracker 396). À chaque lancement, chacun est retenté : une lecture qui a échoué une fois peut réussir.
 * Reconstruit (`sessionFromJournal`), il est rangé comme une session, sans l'écran de la session en attente
 * (« Continuer » n'a plus de sens après coup) ; toujours sans session, ou session refusée par la mémoire pour son
 * contenu, il est copié tel quel dans le sous-dossier `journaux/` du dossier mémoire, où l'utilisateur peut le
 * prendre. Un journal qui ne se lit pas du tout ne se copie pas non plus (la copie passe par son texte) : il reste,
 * retenté à chaque lancement. Rien n'est effacé du dossier privé tant que la session n'est pas rangée ou la copie
 * faite. Ce qui s'est passé est dit une fois, dans le bandeau du démarrage. La cadence à pied n'est pas jointe à une
 * session ainsi rangée : sa capture, si elle se retrouve, est rangée avec elle.
 */

/** Déjà lancé : une seule fois par lancement de l'application. */
let started = false;

/** Ce qui suit, quand le journal reste dans le dossier privé. */
const stillThere = (name: string): string =>
  `il reste dans le dossier privé de l'application (${name}), nouvel essai au prochain lancement.`;

/** Nom d'un journal sans son dossier : celui de sa copie. */
const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * Copie tel quel dans le dossier mémoire un journal dont aucune session ne se tire, puis le retire du dossier
 * privé ; sans dossier où écrire, ou copie en échec, il reste où il est. Rend la phrase à dire.
 */
const copyToMemory = async (name: string, text: string): Promise<string> => {
  const path = `${JOURNALS_DIR}/${fileNameOf(name)}`;
  const folder = await currentMemoryFolder().catch(() => null);
  if (!folder || folder.readOnly) {
    return `Journal d'une session interrompue illisible, faute de dossier mémoire où l'écrire : ${stillThere(name)}`;
  }
  try {
    await folder.writeText(path, text);
  } catch (err) {
    return `Journal d'une session interrompue illisible, non copié dans le dossier mémoire (${errorMessage(err, 'erreur inconnue')}) : ${stillThere(name)}`;
  }
  // Copie faite : un retrait en échec la refera au lancement suivant, au même nom.
  await recordingJournal.removeAside(name).catch(() => undefined);
  return `Journal d'une session interrompue illisible, copié tel quel dans le dossier mémoire : ${path}.`;
};

/**
 * Range la session reconstruite d'un journal mis de côté, avec ses capteurs s'ils se retrouvent et se lisent (sinon
 * sans eux, leur fichier laissé en place), puis retire le journal. Rend la phrase à dire.
 */
const rangeRebuilt = async (name: string, text: string, parsed: ParsedJournal, session: JournalSession): Promise<string> => {
  const startedAtMs = parsed.header?.startedAtMs;
  const capture = startedAtMs === undefined ? null : await findMotionCapture(startedAtMs).catch(() => null);
  const motion = capture ? await readMotionCapture(capture.path).catch(() => null) : null;
  const { activity } = session;
  let stored: { location: string; kept: boolean };
  try {
    stored = await saveRecordedSession(
      session.content, activity?.base ?? null, activity?.id ?? null, session.intervals, motion, session.marks,
      activity ? effectiveFoil(activity) : null, session.test
    );
  } catch (err) {
    // Refusée pour son contenu : la retenter à chaque lancement n'y changerait rien, le journal est rendu comme illisible.
    if ((err as { refused?: unknown } | null)?.refused === true) return copyToMemory(name, text);
    return `Session interrompue reconstruite mais non rangée (${errorMessage(err, 'erreur inconnue')}) : ${stillThere(name)}`;
  }
  if (!stored.kept) return `Session interrompue reconstruite, mais aucune mémoire n'est accessible pour la ranger : ${stillThere(name)}`;
  // Un retrait en échec laisse le journal : relu au lancement suivant, il retrouve la session déjà rangée, sans la doubler.
  await recordingJournal.removeAside(name).catch(() => undefined);
  if (capture && motion) await removeMotionCapture(capture.path).catch(() => undefined);
  return `Session interrompue retrouvée depuis son journal mis de côté, et rangée (${stored.location}).`;
};

/** Retente un journal mis de côté ; rend la phrase à dire, `null` s'il n'y a rien à dire (journal disparu ou vide). */
const retryJournal = async (name: string): Promise<string | null> => {
  let text: string | null;
  try {
    text = await recordingJournal.readAside(name);
  } catch (err) {
    return `Journal d'une session interrompue toujours illisible (${errorMessage(err, 'erreur inconnue')}) : ${stillThere(name)}`;
  }
  if (text === null) return null;
  const parsed = parseJournal(text);
  const activities = readStoredActivities();
  // L'intervalle du minuteur d'une muscu sans ceinture : celui de son activité, comme à l'arrêt.
  const activity = journalSessionActivity(parsed, activities);
  const tickMs = (activity ? effectiveRecordingProfile(activity) : DEFAULT_RECORDING).intervalMs;
  const session = sessionFromJournal(parsed, activities, tickMs);
  if (session) return rangeRebuilt(name, text, parsed, session);
  // Rien d'écrit dedans : rien à rendre.
  if (text.trim() === '') {
    await recordingJournal.removeAside(name).catch(() => undefined);
    return null;
  }
  return copyToMemory(name, text);
};

/** Vrai pour un journal mis de côté pendant ce lancement : son message promet un nouvel essai au suivant. */
const setAsideSince = (name: string, launchedAtMs: number): boolean => (setAsideTimeMs(name) ?? -Infinity) >= launchedAtMs;

/**
 * Retente les journaux mis de côté lors d'un lancement précédent (voir plus haut), une seule fois par lancement : à
 * appeler une fois la reprise de l'enregistrement tranchée. Un journal mis de côté pendant ce lancement-ci attend le
 * suivant, comme son message le dit. `busy` : vrai pendant un enregistrement, qui arrête la tournée avant le journal
 * suivant ; `launchedAtMs` : l'instant du lancement, à l'horloge.
 */
export const retrySetAsideJournals = async (busy: () => boolean, launchedAtMs: number): Promise<void> => {
  if (started) return;
  started = true;
  let names: string[];
  try {
    names = (await recordingJournal.listAside()).filter((name) => !setAsideSince(name, launchedAtMs));
  } catch (err) {
    console.warn(`[journaux] liste des journaux mis de côté illisible : ${errorMessage(err, 'erreur inconnue')}`);
    return;
  }
  const said: string[] = [];
  for (const name of names) {
    if (busy()) break;
    try {
      const sentence = await retryJournal(name);
      if (sentence) said.push(sentence);
    } catch (err) {
      said.push(`Journal d'une session interrompue non repris (${errorMessage(err, 'erreur inconnue')}) : ${stillThere(name)}`);
    }
  }
  if (said.length > 0) reportStartupError(said.join(' '));
};
