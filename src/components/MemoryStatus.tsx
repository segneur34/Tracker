import {
  canChooseMemoryFolder,
  chooseFolder,
  dismissLibraryMessage,
  reconnectFolder,
  switchToBrowserMemory,
  useSessionLibrary,
} from '../hooks/useSessionLibrary';
import { isNativeApp } from '../platform/runtime';
import Button from './ui/Button';
import Card from './ui/Card';

/**
 * État de la mémoire : où elle est, combien de sessions, ce qu'il faut faire
 * si elle est inaccessible. En tête des bibliothèques en version courte, dans
 * Réglages en version détaillée (changer de dossier, réglages, mode d'emploi
 * du copier-coller).
 */

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

const formatDateTime = (ms: number): string =>
  new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const mutedStyle = { margin: 0, color: 'var(--muted)', fontSize: 'var(--text-s)', lineHeight: 1.5 } as const;
const rowStyle = { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' } as const;

function MemoryStatus({ detailed = false }: { detailed?: boolean }) {
  const library = useSessionLibrary();
  const { status, folderKind, folderLabel } = library;
  const canChoose = canChooseMemoryFolder();

  const headline = (() => {
    switch (status) {
      case 'opening':
        return 'Ouverture de la mémoire…';
      case 'ready':
        return `${plural(library.sessions.length, 'session')} · ${folderLabel ?? 'mémoire'}`;
      case 'needs-permission':
        return `Le ${folderLabel ?? 'dossier choisi'} attend votre autorisation.`;
      default:
        return library.reason ?? 'Aucune mémoire accessible.';
    }
  })();

  return (
    <Card heading={detailed ? 'Mémoire' : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <p style={{ margin: 0, fontSize: 'var(--text-m)', fontWeight: 600 }}>{headline}</p>

        {library.scanning && (
          <p style={mutedStyle}>
            Lecture des traces sans fiche : {library.scanning.done} / {library.scanning.total}
          </p>
        )}

        {library.pendingCount > 0 && (
          <p style={mutedStyle}>
            {plural(library.pendingCount, 'session enregistrée')} en attente d'un dossier mémoire, gardée
            {library.pendingCount > 1 ? 's' : ''} dans le dossier privé de l'application.
          </p>
        )}

        {status === 'needs-permission' && (
          <div style={rowStyle}>
            <Button variant="primary" onClick={() => void reconnectFolder()}>Reconnecter le dossier</Button>
            {detailed && <Button onClick={() => void switchToBrowserMemory()}>Revenir à la mémoire du navigateur</Button>}
          </div>
        )}

        {status === 'ready' && folderKind === 'browser' && (
          <>
            <p style={mutedStyle}>
              Les sessions sont gardées dans ce navigateur, où l'explorateur de fichiers ne les voit pas.
              {canChoose
                ? ' Choisissez un dossier pour les sauvegarder, les copier ou les passer au téléphone.'
                : ' Pour les garder dans un dossier du PC, ouvrez Tracker dans Chrome ou Edge.'}
            </p>
            {canChoose && (
              <div style={rowStyle}>
                <Button variant="primary" onClick={() => void chooseFolder()}>Choisir un dossier</Button>
              </div>
            )}
          </>
        )}

        {detailed && status === 'ready' && folderKind === 'picked' && (
          <div style={rowStyle}>
            <Button onClick={() => void chooseFolder()}>Changer de dossier</Button>
            <Button onClick={() => void switchToBrowserMemory()}>Revenir à la mémoire du navigateur</Button>
          </div>
        )}

        {library.duplicates.length > 0 && (
          <p style={mutedStyle}>
            {plural(library.duplicates.length, 'fichier')} en double ignoré{library.duplicates.length > 1 ? 's' : ''} : même
            trace sous un autre nom ({library.duplicates.join(', ')}).
          </p>
        )}
        {library.unreadable.length > 0 && (
          <p style={mutedStyle}>
            {plural(library.unreadable.length, 'GPX illisible')} dans le dossier : {library.unreadable.join(', ')}.
          </p>
        )}

        {detailed && status === 'ready' && library.settingsSource && (
          <p style={mutedStyle}>
            {library.settingsSource === 'folder'
              ? 'Réglages repris du fichier reglages.json du dossier'
              : library.settingsSource === 'local'
                ? 'Réglages de cet appareil, recopiés dans reglages.json'
                : 'Réglages identiques sur cet appareil et dans le dossier'}
            {library.settingsSavedAt !== null && ` (modifiés le ${formatDateTime(library.settingsSavedAt)})`}.
          </p>
        )}

        {detailed && (
          <p style={mutedStyle}>
            Le dossier contient chaque session (sa trace GPX et une fiche avec son résumé et vos notes) et vos
            réglages. Pour sauvegarder, ou pour passer d'un appareil à l'autre, copiez le dossier Tracker entier.
            {isNativeApp()
              ? ' Sur ce téléphone, il se trouve dans Stockage interne › Documents › Tracker.'
              : ' Sur le téléphone, il se trouve dans Stockage interne › Documents › Tracker : copiez-le sur le PC par câble USB, puis choisissez-le ici.'}
          </p>
        )}

        {(library.message || library.error) && (
          <div className={`ui-alert ${library.error ? 'ui-alert--danger' : 'ui-alert--success'}`}>
            {library.error ?? library.message}{' '}
            <Button size="s" variant="ghost" onClick={dismissLibraryMessage}>Fermer</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default MemoryStatus;
