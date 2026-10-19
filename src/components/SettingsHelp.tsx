import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { SettingsHelpContext, useSettingsHelp } from './settingsHelpContext';
import HelpButton from './ui/HelpButton';
import './SettingsHelp.css';

/**
 * Aides de la page Réglages : chaque réglage a son court texte sous un « ? »,
 * fermé par défaut, et une seule aide est ouverte à la fois sur la page (l'état
 * n'est pas mémorisé). Le fournisseur est posé par `SettingsPage` ; hors de lui
 * (carte des autorisations de l'accueil, mémoire des bibliothèques, bips d'un
 * parcours), les blocs communs gardent leurs textes à découvert.
 */

export function SettingsHelpProvider({ children }: { children: ReactNode }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(0);
  const toggle = useCallback((key: string) => setOpenKey((current) => (current === key ? null : key)), []);
  const collapseAll = useCallback(() => {
    setOpenKey(null);
    setCollapsed((n) => n + 1);
  }, []);
  const value = useMemo(() => ({ openKey, toggle, collapsed, collapseAll }), [openKey, toggle, collapsed, collapseAll]);
  return <SettingsHelpContext.Provider value={value}>{children}</SettingsHelpContext.Provider>;
}

/** Le « ? » de l'aide `helpKey`, nommé d'après ce qu'il explique ; rien hors de Réglages. */
export function HelpToggle({ helpKey, label, size = 'xs' }: { helpKey: string; label: string; size?: 'xs' | 's' }) {
  const help = useSettingsHelp(helpKey);
  if (help === null) return null;
  return <HelpButton size={size} open={help.open} onToggle={help.toggle} label={`Aide : ${label}`} />;
}

/** Le texte de l'aide `helpKey`, dans la page seulement une fois ouvert ; sur toute la largeur d'une ligne. */
export function HelpText({ helpKey, children }: { helpKey: string; children: ReactNode }) {
  const help = useSettingsHelp(helpKey);
  if (!help?.open) return null;
  return <p className="settings-help">{children}</p>;
}

/**
 * Ligne d'un réglage : son libellé et son « ? », le contrôle, puis l'aide, dépliée
 * sous la ligne. Le libellé garde son texte seul (le banc le lit au mot près).
 * `helpFirst` met l'aide juste sous le libellé, avant un grand contrôle (courbe des bips).
 */
export function SettingRow({ label, help, helpKey, sub = false, helpFirst = false, children }: {
  label: string;
  help: ReactNode;
  helpKey: string;
  sub?: boolean;
  helpFirst?: boolean;
  children: ReactNode;
}) {
  const text = <HelpText helpKey={helpKey}>{help}</HelpText>;
  return (
    <div className={sub ? 'settings-row settings-row--sub' : 'settings-row'}>
      <span className="settings-row__name">
        <span className="settings-row__label">{label}</span>
        <HelpToggle helpKey={helpKey} label={label} />
      </span>
      {helpFirst && text}
      {children}
      {!helpFirst && text}
    </div>
  );
}
