import { readSessionExport } from '../hooks/useSessionLibrary';
import { downloadBaseName } from '../library/naming';
import { bundleSessionGpx } from '../library/sessionBundle';
import { safeFileName } from '../platform/files';
import { shareFile, type ShareOutcome } from '../platform/share';

/**
 * Nom du GPX d'une session de la mémoire, téléchargé (« Télécharger la session ») ou partagé (« Partager la
 * trace (GPX) », lot 207) : `AAAA-MM-JJ Activité - Nom.gpx` pour une session nommée, sinon son nom de fichier.
 */
export const sessionGpxFileName = (name: string | null, activityName: string | null, startMs: number | null, file: string): string => {
  const named = name?.trim() ? safeFileName(downloadBaseName(name, activityName, startMs, file)) : '';
  return named ? `${named}.gpx` : file;
};

/** Phrase montrée quand le navigateur ne sait pas partager un fichier : le GPX est téléchargé, comme pour un itinéraire. */
export const GPX_DOWNLOADED_NOTE = 'Ce navigateur ne partage pas de fichier : le GPX est téléchargé.';

/** Compte rendu d'un partage de GPX : rien s'il est parti ou abandonné, une phrase s'il a été téléchargé faute de partage. */
export const gpxShareNote = (outcome: ShareOutcome): string | null => (outcome === 'downloaded' ? GPX_DOWNLOADED_NOTE : null);

/**
 * Le GPX d'une session de la mémoire tel que « Télécharger la session » le dépose : fiche et capteurs compris,
 * sous `AAAA-MM-JJ Activité - Nom.gpx` si elle est nommée (`sessionGpxFileName`).
 */
export const sessionGpxExport = async (file: string, name: string | null, activityName: string | null): Promise<{ fileName: string; text: string }> => {
  const session = await readSessionExport(file);
  if (session === null) throw new Error('GPX illisible dans la mémoire.');
  return {
    fileName: sessionGpxFileName(name, activityName, session.record.summary.startMs, file),
    text: bundleSessionGpx(session.gpx, session.record, session.motion, session.unreadable),
  };
};

/**
 * Envoie un GPX par le partage du système (WhatsApp, messages, courriel…) ; dans un navigateur qui ne partage pas de
 * fichier, il est téléchargé, comme le GPX d'un itinéraire. Rend la phrase à montrer, ou `null`. Un échec est levé.
 */
export const shareGpxText = async (fileName: string, text: string): Promise<string | null> =>
  gpxShareNote(await shareFile(new Blob([text], { type: 'application/gpx+xml' }), fileName, 'Partager la trace'));
