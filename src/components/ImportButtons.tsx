import type { ChangeEvent } from 'react';
import { canImportSessions, importFiles, importFromFolder, useLibraryFields } from '../hooks/useSessionLibrary';
import { isNativeApp } from '../platform/runtime';
import { IconFile } from './icons';
import Button from './ui/Button';

/**
 * Import dans la mémoire : « Importer des GPX » (des fichiers choisis) et
 * « Ajouter les sessions d'un dossier » (un dossier Tracker copié d'un autre
 * appareil, fiches comprises). Dans le menu « … » des bibliothèques, et dans
 * Réglages › Mémoire pour le dossier seul (`gpx` à faux). Grisés pendant un
 * import, d'où qu'il parte, et sans dossier mémoire : un import n'est jamais
 * mis en attente (décision du 27/10).
 */
function ImportButtons({ gpx = true }: { gpx?: boolean }) {
  const library = useLibraryFields('status', 'importing');
  const off = !canImportSessions(library) || library.importing;
  /** Aucune mémoire accessible : on dit pourquoi les boutons sont grisés. */
  const noFolder = library.status === 'unavailable' || library.status === 'needs-permission';
  // Un `label` porte le sélecteur de fichiers : il ne connaît pas `disabled`, d'où la classe.
  const labelClass = `ui-btn ui-btn--secondary${off ? ' ui-btn--off' : ''}`;
  const folderText = !gpx && library.importing ? 'Import en cours…' : "Ajouter les sessions d'un dossier";

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? [...event.target.files] : [];
    event.target.value = '';
    if (files.length > 0) void importFiles(files);
  };

  return (
    <>
      {noFolder && <p style={{ margin: 0, color: 'var(--muted)', fontSize: 'var(--text-s)', lineHeight: 1.5 }}>Désignez d'abord le dossier mémoire (Réglages › Mémoire) pour importer des sessions.</p>}
      {gpx && (
        <label className={labelClass}>
          <IconFile size={18} />
          {library.importing ? 'Import en cours…' : 'Importer des GPX'}
          <input type="file" accept=".gpx" multiple hidden disabled={off} onChange={handleFiles} />
        </label>
      )}
      {isNativeApp() ? (
        <Button disabled={off} onClick={() => void importFromFolder()}>{folderText}</Button>
      ) : (
        <label className={labelClass}>
          {folderText}
          <input
            type="file"
            multiple
            hidden
            disabled={off}
            ref={(el) => el?.setAttribute('webkitdirectory', '')}
            onChange={handleFiles} />
        </label>
      )}
    </>
  );
}

export default ImportButtons;
