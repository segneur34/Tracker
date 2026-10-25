import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { HelpContext, SettingsScopeContext, useHelp } from './helpContext';
import HelpButton from './ui/HelpButton';
import './Help.css';

/**
 * Aides « ? » de toute l'application : une explication courte, fermée par
 * défaut, sous un « ? » posé à droite de ce qu'elle explique (réglage, titre
 * d'un panneau, nom d'un graphe). Une seule aide est ouverte à la fois sur la
 * page, rien n'est mémorisé ; changer de page les referme. Restent à découvert :
 * clés de données, avertissements, états vides et messages d'action.
 */

/** Fournisseur unique, posé par `AppShell` ; `resetKey` (l'adresse) qui change referme l'aide ouverte. */
export function HelpProvider({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(0);
  const [seenReset, setSeenReset] = useState(resetKey);
  if (seenReset !== resetKey) {
    setSeenReset(resetKey);
    setOpenKey(null);
  }
  const toggle = useCallback((key: string) => setOpenKey((current) => (current === key ? null : key)), []);
  const collapseAll = useCallback(() => {
    setOpenKey(null);
    setCollapsed((n) => n + 1);
  }, []);
  const value = useMemo(() => ({ openKey, toggle, collapsed, collapseAll }), [openKey, toggle, collapsed, collapseAll]);
  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

/** La page Réglages : les blocs communs (mémoire) y prennent leur disposition détaillée. */
export function SettingsScope({ children }: { children: ReactNode }) {
  return <SettingsScopeContext.Provider value={true}>{children}</SettingsScopeContext.Provider>;
}

/** Le « ? » de l'aide `helpKey`, nommé d'après ce qu'il explique ; `s` à droite d'un titre de panneau. */
export function HelpToggle({ helpKey, label, size = 'xs' }: { helpKey: string; label: string; size?: 'xs' | 's' }) {
  const help = useHelp(helpKey);
  if (help === null) return null;
  return <HelpButton size={size} open={help.open} onToggle={help.toggle} label={`Aide : ${label}`} />;
}

/**
 * Le texte de l'aide `helpKey`, dans la page seulement une fois ouvert. Par
 * défaut sur toute la largeur d'une ligne de réglage ; `note` : sous le titre
 * d'un panneau, au ton des notes des analyses.
 */
export function HelpText({ helpKey, note = false, children }: { helpKey: string; note?: boolean; children: ReactNode }) {
  const help = useHelp(helpKey);
  if (!help?.open) return null;
  return note ? <div className="help-note">{children}</div> : <p className="settings-help">{children}</p>;
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
