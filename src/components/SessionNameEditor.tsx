import { errorMessage } from '../core/basics';
import { useState } from 'react';
import { FAMILY_LABEL, sessionActivity } from '../core/activities';
import type { ShareStat } from '../core/shareImage';
import type { SportFamily } from '../core/sportProfiles';
import { librarySession, readSessionExport, updateSessionRecord, useSessionName } from '../hooks/useSessionLibrary';
import { readStoredActivities } from '../hooks/useSportSettings';
import { useTransientValue } from '../hooks/useTransientValue';
import { downloadBaseName } from '../library/naming';
import { bundleSessionGpx } from '../library/sessionBundle';
import { shareLabels } from '../library/shareStats';
import { safeFileName, saveToDownloads } from '../platform/files';
import { IconDownload, IconShare } from './icons';
import SessionRenameField from './SessionRenameField';
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

/** Durée d'affichage du compte rendu d'un téléchargement. */
const DOWNLOAD_NOTE_MS = 4000;

/**
 * Nom d'une session de la mémoire, en tête de son analyse, son bouton
 * « Renommer » et son menu « … » (« Partager », qui ouvre `ShareDialog` avec
 * ce que l'analyse passe dans `share` ; « Télécharger la session », dans
 * Téléchargements : un GPX complet, fiche et capteurs compris, que « Importer
 * des GPX » range tout entier sur un autre appareil). Le nom est écrit dans la fiche dès sa validation, comme un
 * changement de support (la bibliothèque offre le même renommage). Rien pour
 * un GPX ouvert hors de la mémoire ; pas de renommage pour une fiche en
 * lecture seule, qui se télécharge quand même.
 */
function SessionNameEditor({ file, share }: { file: string | null; share?: SessionShare }) {
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
      const session = await readSessionExport(file);
      if (session === null) throw new Error('GPX illisible dans la mémoire.');
      const named = name?.trim() ? safeFileName(downloadBaseName(name, activityName, session.record.summary.startMs, file)) : '';
      await saveToDownloads(named ? `${named}.gpx` : file, bundleSessionGpx(session.gpx, session.record, session.motion, session.unreadable));
      setNote({ text: 'Session enregistrée dans Téléchargements.', error: false });
    } catch (err) {
      setNote({ text: `Téléchargement impossible : ${errorMessage(err)}`, error: true });
    }
  };

  if (draft !== null) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-1)' }}>
        <SessionRenameField value={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)}
          style={{ flex: '1 1 180px', minWidth: 0, maxWidth: '360px' }} />
      </span>
    );
  }

  return (
    // Une seule ligne : un nom long se tronque, « Renommer » et « … » restent à droite (le menu s'ouvre à l'écran).
    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
        <span
          title={name ?? undefined}
          style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(name ? { color: 'var(--ink)', fontWeight: 600 } : {}) }}>
          {name ?? 'Sans nom'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
          {!session.readOnly && (
            <Button size="s" variant="ghost" onClick={() => setDraft(name ?? '')}>Renommer</Button>
          )}
          <MoreMenu label="Plus d'actions sur la session">
            {share && (
              <Button onClick={() => setSharing(true)}>
                <IconShare size={18} />
                Partager
              </Button>
            )}
            <Button onClick={() => void download()}>
              <IconDownload size={18} />
              Télécharger la session
            </Button>
          </MoreMenu>
        </span>
      </span>
      {sharing && share && (() => {
        const labels = shareLabels(name, activityName, FAMILY_LABEL[share.family], record.summary.startMs, file);
        return (
          <ShareDialog
            family={share.family}
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
