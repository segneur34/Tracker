import { plainError } from '../platform/errorText';
import { useState } from 'react';
import { FAMILY_LABEL, sessionActivity } from '../core/activities';
import type { ShareStat } from '../core/shareImage';
import type { SportFamily } from '../core/sportProfiles';
import { librarySession, updateSessionRecord, useSessionName } from '../hooks/useSessionLibrary';
import { readStoredActivities } from '../hooks/useSportSettings';
import { useTransientValue } from '../hooks/useTransientValue';
import { shareLabels } from '../library/shareStats';
import { safeFileName, saveToDownloads } from '../platform/files';
import { IconDownload } from './icons';
import SessionDiscardEntry from './SessionDiscardEntry';
import SessionRenameField from './SessionRenameField';
import SessionShareEntries from './SessionShareEntries';
import { sessionGpxExport, shareGpxText } from './sessionGpxShare';
import ShareDialog from './ShareDialog';
import type { TrackSegment } from './TrackSegmentsLayer';
import Button from './ui/Button';
import MoreMenu from './ui/MoreMenu';

/** Ce que l'image de partage montre : la trace colorée de l'analyse et les chiffres de son onglet « général ». */
export interface SessionShare {
  family: SportFamily;
  segments: ReadonlyArray<TrackSegment>;
  stats: ReadonlyArray<ShareStat>;
}

/** Où repartir, et que défaire avant, quand « Jeter la session » a réussi (`SessionDiscardEntry`). */
export interface SessionDiscard {
  /** Bibliothèque où revenir. */
  backTo: string;
  /** Abandonne le brouillon de la session jetée. */
  onGone: () => void;
}

/** Durée d'affichage du compte rendu d'un téléchargement. */
const DOWNLOAD_NOTE_MS = 4000;

/**
 * Nom d'une session de la mémoire, en tête de son analyse, son bouton
 * « Renommer » et son menu « … » (« Partager l'image », qui ouvre `ShareDialog` avec
 * ce que l'analyse passe dans `share` ; « Partager la trace (GPX) », le GPX de
 * « Télécharger la session » confié au partage du système ; « Télécharger la session », dans
 * Téléchargements : un GPX complet, fiche et capteurs compris, que « Importer
 * des GPX » range tout entier sur un autre appareil). Le nom est écrit dans la fiche dès sa validation, comme un
 * changement de support (la bibliothèque offre le même renommage). Rien pour
 * un GPX ouvert hors de la mémoire ; pas de renommage pour une fiche en
 * lecture seule, qui se télécharge quand même.
 */
function SessionNameEditor({ file, share, discard }: { file: string | null; share?: SessionShare; discard?: SessionDiscard }) {
  const name = useSessionName(file);
  const [sharing, setSharing] = useState(false);
  /** Nom en cours de saisie ; `null` hors renommage. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Compte rendu du dernier téléchargement, effacé après quelques secondes. */
  const [note, setNote] = useTransientValue<{ text: string; error: boolean }>(DOWNLOAD_NOTE_MS);
  const session = file === null ? undefined : librarySession(file);
  if (!session || file === null) return null;

  const { record } = session;
  const activityName = sessionActivity(readStoredActivities(), record.activityId, record.sport)?.name ?? null;

  const save = () => {
    if (draft === null) return;
    updateSessionRecord(file, { name: draft });
    setDraft(null);
  };

  /**
   * Le GPX tel que rangé, avec sa fiche et ses capteurs. Une session nommée part sous
   * `AAAA-MM-JJ Activité - Nom.gpx`, son nom écrit dans le GPX ; les autres, sous leur nom de fichier.
   */
  const download = async () => {
    try {
      const { fileName, text } = await sessionGpxExport(file, name, activityName);
      await saveToDownloads(fileName, text);
      setNote({ text: 'Session enregistrée dans Téléchargements.', error: false });
    } catch (err) {
      setNote({ text: `Téléchargement impossible : ${plainError(err, 'erreur inconnue')}`, error: true });
    }
  };

  /** Le même GPX, confié au partage du système (lot 207). */
  const shareTrace = async () => {
    setNote(null);
    try {
      const { fileName, text } = await sessionGpxExport(file, name, activityName);
      const fallback = await shareGpxText(fileName, text);
      if (fallback) setNote({ text: fallback, error: false });
    } catch (err) {
      setNote({ text: `Partage impossible : ${plainError(err, 'erreur inconnue')}`, error: true });
    }
  };

  if (draft !== null) {
    return (
      <span className="an-name-row">
        <SessionRenameField value={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)}
          className="an-name-input" />
      </span>
    );
  }

  return (
    // Une seule ligne : un nom long se tronque, « Renommer » et « … » restent à droite (le menu s'ouvre à l'écran).
    <span className="ui-stack ui-min-w-0">
      <span className="an-name-line">
        <span
          title={name ?? undefined}
          style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(name ? { color: 'var(--ink)', fontWeight: 600 } : {}) }}>
          {name ?? 'Sans nom'}
        </span>
        <span className="ui-row-s2 ui-center ui-no-shrink">
          {!session.readOnly && (
            <Button size="s" variant="ghost" onClick={() => setDraft(name ?? '')}>Renommer</Button>
          )}
          <MoreMenu label="Plus d'actions sur la session">
            <SessionShareEntries onShareImage={share ? () => setSharing(true) : undefined} onShareTrace={() => void shareTrace()} />
            <Button onClick={() => void download()}>
              <IconDownload size={18} />
              Télécharger la session
            </Button>
            {discard && !session.readOnly && <SessionDiscardEntry file={file} backTo={discard.backTo} onGone={discard.onGone} />}
          </MoreMenu>
        </span>
      </span>
      {sharing && share && (() => {
        const labels = shareLabels(name, activityName, FAMILY_LABEL[share.family], record.summary.startMs, file);
        return (
          <ShareDialog
            family={share.family}
            file={file}
            activityId={record.activityId ?? record.sport ?? share.family}
            title={labels.title}
            subtitle={labels.subtitle}
            fileName={safeFileName(labels.baseName)}
            segments={share.segments}
            stats={share.stats}
            onClose={() => setSharing(false)} />
        );
      })()}
      {note && (
        <span role="status" style={{ fontSize: 'var(--text-s)', color: note.error ? 'var(--recording)' : 'var(--muted)' }}>
          {note.text}
        </span>
      )}
    </span>
  );
}

export default SessionNameEditor;
