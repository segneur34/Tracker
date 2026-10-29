import type { ReactNode } from 'react';
import { HelpText } from './Help';
import { PanelHeading } from './PanelTitle';

/**
 * Tête de l'onglet réglages d'une analyse, la même dans les quatre modules :
 * le titre « Réglages de la session » (dont l'aide a pour clé `helpKey`) et
 * son texte d'aide, sur la vitesse et le cap de la trace (`children`).
 */
export default function SessionSettingsHeader({ helpKey, open, onToggle, children }: {
  helpKey: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <PanelHeading label="Réglages de la session" open={open} onToggle={onToggle} helpKey={helpKey} />
      <HelpText helpKey={helpKey} note>{children}</HelpText>
    </>
  );
}
