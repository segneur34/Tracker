import { useState, type ChangeEvent } from 'react';
import {
  adoptSettingsFile, dismissSettingsOffer, importSettingsFile, renameDevice, useSessionLibrary, type SettingsFileInfo,
} from '../hooks/useSessionLibrary';
import { DEVICE_NAME_MAX } from '../library/settingsFile';
import Button from './ui/Button';

/**
 * Réglages par appareil (§10, point 90), dans Réglages › Mémoire : le nom de
 * cet appareil, qui nomme son fichier dans `reglages/`, et la liste des
 * fichiers du dossier, avec « Reprendre » sur ceux des autres appareils.
 * « Importer un fichier de réglages » range un fichier choisi à la main, puis
 * propose de le reprendre : seul moyen là où l'on ne peut rien déposer dans
 * la mémoire (celle du navigateur, sous Firefox). `SettingsOfferBanner` propose, une fois, celui d'un autre appareil apparu
 * dans le dossier (carte Mémoire, en tête des bibliothèques comme dans
 * Réglages).
 */

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

const formatDateTime = (ms: number): string =>
  new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const mutedStyle = { margin: 0, color: 'var(--muted)', fontSize: 'var(--text-s)', lineHeight: 1.5 } as const;

/** « Reprendre », après confirmation : depuis la liste, le bandeau ou un import. Rend faux si l'on a renoncé. */
const adopt = (file: SettingsFileInfo): boolean => {
  const question = `Reprendre les réglages de « ${file.name} » ?\n\n`
    + 'Ils remplacent ceux de cet appareil : activités et leurs réglages, profil du pratiquant, séances du compteur, barre du bas. '
    + "Une session dont l'activité n'existe pas dans ces réglages s'affichera sous le nom de son calcul.";
  if (!window.confirm(question)) return false;
  void adoptSettingsFile(file.fileName);
  return true;
};

/** Bandeau « Nouveau fichier de réglages » : « Reprendre » ou « Fermer » ; le fichier reste dans la liste. */
export function SettingsOfferBanner() {
  const { settingsOffer } = useSessionLibrary();
  if (!settingsOffer) return null;
  return (
    <div className="ui-alert ui-alert--warning" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <span style={{ flex: '1 1 200px' }}>Nouveau fichier de réglages : <strong>{settingsOffer.name}</strong>.</span>
      <Button size="s" onClick={() => adopt(settingsOffer)}>Reprendre</Button>
      <Button size="s" variant="ghost" onClick={dismissSettingsOffer}>Fermer</Button>
    </div>
  );
}

function SettingsFiles() {
  const { deviceName, settingsFiles, folderKind } = useSessionLibrary();
  /** Nom en cours de saisie ; `null` : celui de l'appareil. */
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Compte rendu du dernier import d'un fichier de réglages. */
  const [importNote, setImportNote] = useState<{ text: string; failed: boolean } | null>(null);

  const commit = async () => {
    if (draft === null) return;
    const reason = await renameDevice(draft);
    setRefusal(reason);
    if (reason === null) setDraft(null);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    const result = await importSettingsFile(picked);
    if ('refusal' in result) {
      setImportNote({ text: result.refusal, failed: true });
      return;
    }
    if (adopt(result.file)) setImportNote(null);
    else setImportNote({ text: `« ${result.file.name} » est dans la liste : « Reprendre » quand vous voudrez.`, failed: false });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <strong style={{ fontSize: 'var(--text-m)' }}>Réglages</strong>
      {folderKind === 'browser' ? (
        <p style={mutedStyle}>
          Chaque appareil range ses réglages sous son nom (Tracker › reglages). Pour prendre ceux d'un autre appareil,
          ou de quelqu'un d'autre : « Importer un fichier de réglages », puis choisissez son fichier, pris dans le
          dossier Tracker › reglages de cet appareil.
        </p>
      ) : (
        <p style={mutedStyle}>
          Chaque appareil range ses réglages dans le dossier, sous son nom (Tracker › reglages). Pour prendre ceux d'un
          autre appareil, ou de quelqu'un d'autre : copiez son fichier dans ce dossier, ou tout le dossier Tracker, puis
          « Mettre à jour » et « Reprendre » ; ou « Importer un fichier de réglages ».
        </p>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: 'var(--text-s)' }}>
        <span>Nom de cet appareil</span>
        <input value={draft ?? deviceName} maxLength={DEVICE_NAME_MAX} className="ui-field ui-field--s" style={{ width: '180px' }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { setDraft(null); setRefusal(null); }
          }} />
      </label>
      {refusal && <p style={{ ...mutedStyle, color: 'var(--danger)' }}>{refusal}</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
        {settingsFiles.map((file) => (
          <li key={file.fileName} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap',
            padding: 'var(--space-2) 0', borderTop: '1px solid var(--line-soft)',
          }}>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <strong style={{ fontSize: 'var(--text-m)' }}>{file.name}</strong>
              <span className="num" style={mutedStyle}>
                {plural(file.activityCount, 'activité')} · modifiés le {formatDateTime(file.savedAt)}
              </span>
            </span>
            {file.own
              ? <span style={{ ...mutedStyle, fontWeight: 600 }}>cet appareil</span>
              : <Button size="s" onClick={() => adopt(file)}>Reprendre</Button>}
          </li>
        ))}
      </ul>
      <div>
        <label className="ui-btn ui-btn--secondary ui-btn--s">
          Importer un fichier de réglages
          <input type="file" accept=".json,application/json" hidden onChange={(e) => void handleImport(e)} />
        </label>
      </div>
      {importNote && <p style={{ ...mutedStyle, color: importNote.failed ? 'var(--danger)' : 'var(--muted)' }}>{importNote.text}</p>}
    </div>
  );
}

export default SettingsFiles;
