import {
  canChooseMemoryFolder,
  chooseFolder,
  dismissLibraryMessage,
  reconnectFolder,
  switchToBrowserMemory,
  useSessionLibrary,
} from '../hooks/useSessionLibrary';
import { isNativeApp } from '../platform/runtime';
import PanelTitle from './PanelTitle';
import Button from './ui/Button';
import Card from './ui/Card';

/**
 * État de la mémoire : où elle est, combien de sessions, ce qu'il faut faire
 * si elle est inaccessible. En tête des bibliothèques en version courte, dans
 * Réglages en version détaillée (changer de dossier, réglages, mode d'emploi
 * du copier-coller). Avec `collapse`, la carte se replie par son titre et ne
 * garde, fermée, que sa ligne d'état et ses alertes.
 */

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

const formatDateTime = (ms: number): string =>
  new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const mutedStyle = { margin: 0, color: 'var(--muted)', fontSize: 'var(--text-s)', lineHeight: 1.5 } as const;
const rowStyle = { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' } as const;

function MemoryStatus({
  detailed = false, collapse,
}: {
  detailed?: boolean;
  collapse?: { open: boolean; onToggle: () => void };
}) {
  const library = useSessionLibrary();
  const { status, folderKind, folderLabel } = library;
  const canChoose = canChooseMemoryFolder();
  const native = isNativeApp();

  const headline = (() => {
    switch (status) {
      case 'opening':
        return 'Ouverture de la mémoire…';
      case 'ready':
        return `${plural(library.sessions.length, 'session')} · ${folderLabel ?? 'mémoire'}`;
      case 'needs-permission':
        return native
          ? `Android a retiré l'accès au ${folderLabel ?? 'dossier choisi'}.`
          : `Le ${folderLabel ?? 'dossier choisi'} attend votre autorisation.`;
      default:
        return library.reason ?? 'Aucune mémoire accessible.';
    }
  })();

  const alert = (library.message || library.error) && (
    <div className={`ui-alert ${library.error ? 'ui-alert--danger' : 'ui-alert--success'}`}>
      {library.error ?? library.message}{' '}
      <Button size="s" variant="ghost" onClick={dismissLibraryMessage}>Fermer</Button>
    </div>
  );

  const heading = collapse ? <PanelTitle label="Mémoire" open={collapse.open} onToggle={collapse.onToggle} /> : detailed ? 'Mémoire' : undefined;

  if (collapse && !collapse.open) {
    return (
      <Card heading={heading}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-m)', fontWeight: 600 }}>{headline}</p>
          {alert}
        </div>
      </Card>
    );
  }

  return (
    <Card heading={heading}>
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

        {status === 'unavailable' && native && (
          <>
            <p style={mutedStyle}>
              Tracker garde vos sessions dans un dossier du téléphone, que vous pouvez copier sur le PC pour les
              sauvegarder ou les retrouver. Dans le sélecteur qui va s'ouvrir : Documents, puis le dossier Tracker
              (créez-le s'il n'existe pas), « Utiliser ce dossier », et « Autoriser ».
            </p>
            <div style={rowStyle}>
              <Button variant="primary" onClick={() => void chooseFolder()}>Choisir le dossier</Button>
            </div>
          </>
        )}

        {status === 'needs-permission' && (
          <div style={rowStyle}>
            <Button variant="primary" onClick={() => void reconnectFolder()}>
              {native ? 'Choisir à nouveau le dossier' : 'Reconnecter le dossier'}
            </Button>
            {detailed && !native && <Button onClick={() => void switchToBrowserMemory()}>Revenir à la mémoire du navigateur</Button>}
          </div>
        )}

        {status === 'ready' && folderKind === 'browser' && (
          <>
            <p style={mutedStyle}>
              {detailed ? 'Emplacement : la mémoire interne de ce navigateur. ' : ''}
              Les sessions sont gardées dans ce navigateur : aucun dossier sur le PC, l'explorateur de fichiers ne
              les voit pas.
              {canChoose
                ? ' Choisissez un dossier pour les sauvegarder, les copier ou les passer au téléphone : elles y seront recopiées. Conseil : créez-le dans Documents, sous le nom Tracker, dans la fenêtre qui va s\'ouvrir.'
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
          <>
            <p style={mutedStyle}>
              Emplacement : {folderLabel}, sur ce PC. Le navigateur ne donne que le nom du dossier, pas son chemin
              complet : « Voir ou changer le dossier » ouvre la fenêtre de choix sur ce dossier, et son chemin
              s'affiche dans la barre d'adresse de la fenêtre. Annuler le laisse tel quel.
            </p>
            <div style={rowStyle}>
              <Button onClick={() => void chooseFolder()}>Voir ou changer le dossier</Button>
              <Button onClick={() => void switchToBrowserMemory()}>Revenir à la mémoire du navigateur</Button>
            </div>
          </>
        )}

        {detailed && status === 'ready' && folderKind === 'device' && (
          <>
            <p style={mutedStyle}>Emplacement : {folderLabel}, dans le stockage interne du téléphone.</p>
            <div style={rowStyle}>
              <Button onClick={() => void chooseFolder()}>Changer de dossier</Button>
            </div>
          </>
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
            {native
              ? ' Sur ce téléphone, il se trouve dans Stockage interne › Documents › Tracker.'
              : ' Sur le téléphone, il se trouve dans Stockage interne › Documents › Tracker : copiez-le sur le PC par câble USB, puis choisissez-le ici.'}
          </p>
        )}

        {alert}
      </div>
    </Card>
  );
}

export default MemoryStatus;
