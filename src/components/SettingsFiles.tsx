import { useState } from 'react';
import { adoptSettingsFile, renameDevice, useSessionLibrary, type SettingsFileInfo } from '../hooks/useSessionLibrary';
import { DEVICE_NAME_MAX } from '../library/settingsFile';
import Button from './ui/Button';

/**
 * Réglages par appareil (§10, point 90), dans Réglages › Mémoire : le nom de
 * cet appareil, qui nomme son fichier dans `reglages/`, et la liste des
 * fichiers du dossier, avec « Reprendre » sur ceux des autres appareils.
 */

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

const formatDateTime = (ms: number): string =>
  new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const mutedStyle = { margin: 0, color: 'var(--muted)', fontSize: 'var(--text-s)', lineHeight: 1.5 } as const;

function SettingsFiles() {
  const { deviceName, settingsFiles } = useSessionLibrary();
  /** Nom en cours de saisie ; `null` : celui de l'appareil. */
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const commit = async () => {
    if (draft === null) return;
    const reason = await renameDevice(draft);
    setRefusal(reason);
    if (reason === null) setDraft(null);
  };

  const adopt = (file: SettingsFileInfo) => {
    const question = `Reprendre les réglages de « ${file.name} » ?\n\n`
      + 'Ils remplacent ceux de cet appareil : activités et leurs réglages, profil du pratiquant, séances du compteur, barre du bas. '
      + "Une session dont l'activité n'existe pas dans ces réglages s'affichera sous le nom de son calcul.";
    if (window.confirm(question)) void adoptSettingsFile(file.fileName);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <strong style={{ fontSize: 'var(--text-m)' }}>Réglages</strong>
      <p style={mutedStyle}>
        Chaque appareil range ses réglages dans le dossier, sous son nom (Tracker › reglages). Pour prendre ceux d'un
        autre appareil, ou de quelqu'un d'autre : copiez son fichier dans ce dossier, ou tout le dossier Tracker, puis
        « Mettre à jour » et « Reprendre ».
      </p>
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
    </div>
  );
}

export default SettingsFiles;
