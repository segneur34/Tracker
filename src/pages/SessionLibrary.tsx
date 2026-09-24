import { useMemo, useState, type ChangeEvent } from 'react';
import MemoryStatus from '../components/MemoryStatus';
import { IconChevronRight, IconFile } from '../components/icons';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { SAILING_SPORTS, SPORT_PROFILES, sportFamily, type SportFamily } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { formatDuration, formatSpeed } from '../core/units';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { importFiles, importFromFolder, removeSession, updateSessionRecord, useSessionLibrary } from '../hooks/useSessionLibrary';
import type { LibrarySession } from '../library/record';
import { isNativeApp } from '../platform/runtime';
import './SessionLibrary.css';

/**
 * Bibliothèque d'une famille : les onglets Voile et Course. La liste des
 * sessions de la mémoire, filtrable par support en voile, les sessions à
 * classer, l'import de GPX ou d'un dossier entier, la suppression.
 */

const FAMILY: Record<SportFamily, { title: string; accent: string; sports: SportType[] }> = {
  voile: { title: 'Voile', accent: 'var(--voile)', sports: SAILING_SPORTS },
  course: { title: 'Course à pied', accent: 'var(--course)', sports: ['running'] },
};

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const formatKm = (m: number): string => `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;

/** Chiffres d'une ligne, selon la famille. */
const rowStats = (session: LibrarySession): string[] => {
  const { summary, sport } = session.record;
  const stats = [formatDuration(summary.endMs - summary.startMs), formatKm(summary.distanceM)];
  if (sport === null) return stats;
  if (sportFamily(sport) === 'voile') {
    stats.push(`max ${formatSpeed(summary.maxSpeedMs, SPORT_PROFILES[sport].speedUnit)}`);
    if (summary.maneuverCount !== undefined) stats.push(`${summary.maneuverCount} manœuvres`);
  } else {
    if (summary.movingTimeS && summary.distanceM > 0) {
      stats.push(formatSpeed(summary.distanceM / summary.movingTimeS, 'minkm'));
    }
    if (summary.elevationGainM !== null) stats.push(`D+ ${Math.round(summary.elevationGainM)} m`);
  }
  return stats;
};

function SessionRow({
  session, family, confirming, onAskDelete, onCancelDelete,
}: {
  session: LibrarySession;
  family: SportFamily;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
}) {
  const openSession = useOpenSession();
  const { record } = session;
  const { startMs } = record.summary;
  const unclassified = record.sport === null;

  return (
    <li className="lib-row">
      <button type="button" className="lib-row__main" onClick={() => openSession(session.file, family)}>
        <span className="lib-row__head">
          <span className="lib-row__sport">{record.sport ? SPORT_PROFILES[record.sport].label : 'À classer'}</span>
          <span className="lib-row__date">{formatDate(startMs)} · {formatTime(startMs)}</span>
        </span>
        <span className="lib-row__stats num">{rowStats(session).join(' · ')}</span>
        {record.notes?.comment && <span className="lib-row__note">{record.notes.comment}</span>}
        {session.warning && <span className="lib-row__warning">{session.warning}</span>}
        <IconChevronRight className="lib-row__chevron" />
      </button>

      <div className="lib-row__actions">
        {unclassified && !session.readOnly && (
          <select
            className="ui-field ui-field--s"
            value=""
            aria-label="Classer la session"
            onChange={(e) => updateSessionRecord(session.file, { sport: e.target.value as SportType })}>
            <option value="" disabled>Classer…</option>
            {[...SAILING_SPORTS, 'running' as const].map((s) => (
              <option key={s} value={s}>{SPORT_PROFILES[s].label}</option>
            ))}
          </select>
        )}
        {!session.readOnly && (confirming ? (
          <>
            <Button size="s" variant="danger" onClick={() => void removeSession(session.file)}>Confirmer</Button>
            <Button size="s" variant="ghost" onClick={onCancelDelete}>Annuler</Button>
          </>
        ) : (
          <Button size="s" variant="ghost" onClick={onAskDelete}>Supprimer</Button>
        ))}
      </div>
    </li>
  );
}

function SessionLibrary({ family }: { family: SportFamily }) {
  const library = useSessionLibrary();
  const { title, accent, sports } = FAMILY[family];
  const [filter, setFilter] = useState<SportType | 'all'>('all');
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const familySessions = useMemo(
    () => library.sessions.filter((s) => s.record.sport !== null && sports.includes(s.record.sport)),
    [library.sessions, sports]
  );
  const unclassified = useMemo(() => library.sessions.filter((s) => s.record.sport === null), [library.sessions]);
  const counts = useMemo(() => {
    const byS = new Map<SportType, number>();
    for (const s of familySessions) byS.set(s.record.sport!, (byS.get(s.record.sport!) ?? 0) + 1);
    return byS;
  }, [familySessions]);
  const shown = filter === 'all' ? familySessions : familySessions.filter((s) => s.record.sport === filter);
  const canImport = library.status === 'ready' || library.pendingCount > 0 || library.status === 'unavailable';

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? [...event.target.files] : [];
    event.target.value = '';
    if (files.length === 0) return;
    setImporting(true);
    try {
      await importFiles(files);
    } finally {
      setImporting(false);
    }
  };

  const handleNativeFolder = async () => {
    setImporting(true);
    try {
      await importFromFolder();
    } finally {
      setImporting(false);
    }
  };

  const native = isNativeApp();

  const row = (session: LibrarySession) => (
    <SessionRow
      key={session.file}
      session={session}
      family={family}
      confirming={confirmFile === session.file}
      onAskDelete={() => setConfirmFile(session.file)}
      onCancelDelete={() => setConfirmFile(null)} />
  );

  return (
    <div className="ui-page" style={{ '--lib-accent': accent } as React.CSSProperties}>
      <PageHeader title={title} subtitle={`${familySessions.length} session${familySessions.length > 1 ? 's' : ''}`} />

      <MemoryStatus />

      <div className="lib-actions">
        <label className={`ui-btn ui-btn--secondary${!canImport || importing ? ' lib-disabled' : ''}`}>
          <IconFile size={18} />
          {importing ? 'Import en cours…' : 'Importer des GPX'}
          <input type="file" accept=".gpx" multiple hidden disabled={!canImport || importing} onChange={handleImport} />
        </label>
        {native ? (
          <Button disabled={!canImport || importing} onClick={() => void handleNativeFolder()}>
            Ajouter les sessions d'un dossier
          </Button>
        ) : (
          <label
            className={`ui-btn ui-btn--secondary${!canImport || importing ? ' lib-disabled' : ''}`}
            title="Un dossier Tracker copié depuis le téléphone ou un autre PC : ses sessions et leurs notes sont ajoutées à celles-ci. Le dossier mémoire de ce PC, lui, se choisit dans Réglages › Mémoire.">
            Ajouter les sessions d'un dossier
            <input
              type="file"
              multiple
              hidden
              disabled={!canImport || importing}
              ref={(el) => el?.setAttribute('webkitdirectory', '')}
              onChange={handleImport} />
          </label>
        )}
      </div>
      <p className="lib-hint">
        {native
          ? "« Ajouter les sessions d'un dossier » reprend celles d'un dossier Tracker copié depuis le PC ou un autre téléphone, notes comprises. On peut aussi copier les fichiers directement dans Documents › Tracker › sessions : ils apparaissent au lancement suivant."
          : "« Ajouter les sessions d'un dossier » reprend celles d'un dossier Tracker copié depuis le téléphone ou un autre PC. Chrome demande alors s'il faut importer les fichiers « sur ce site » : ils restent sur ce PC, Tracker n'envoie rien sur internet."}
      </p>

      {family === 'voile' && familySessions.length > 0 && (
        <div className="ui-tabs" style={{ '--tab-accent': accent } as React.CSSProperties}>
          <button type="button" className="ui-tab" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            tous ({familySessions.length})
          </button>
          {sports.filter((s) => counts.has(s)).map((s) => (
            <button key={s} type="button" className="ui-tab" aria-pressed={filter === s} onClick={() => setFilter(s)}>
              {SPORT_PROFILES[s].label} ({counts.get(s)})
            </button>
          ))}
        </div>
      )}

      {unclassified.length > 0 && (
        <Card heading="À classer">
          <p className="lib-hint">
            Traces dont le support n'est pas connu : choisissez-le pour les ranger en voile ou en course.
          </p>
          <ul className="lib-list">{unclassified.map(row)}</ul>
        </Card>
      )}

      {shown.length > 0 ? (
        <ul className="lib-list">{shown.map(row)}</ul>
      ) : (
        library.status === 'ready' && !library.scanning && (
          <Card>
            <p className="lib-hint">
              Aucune session {family === 'voile' ? 'de voile' : 'de course'} pour l'instant. Enregistrez-en une, ou
              importez des GPX : ils sont rangés dans la mémoire et analysés ici.
            </p>
          </Card>
        )
      )}
    </div>
  );
}

export default SessionLibrary;
