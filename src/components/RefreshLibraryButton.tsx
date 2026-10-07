import { refreshLibrary, useSessionLibrary } from '../hooks/useSessionLibrary';
import { IconRefresh } from './icons';
import Button from './ui/Button';

/**
 * « Mettre à jour » : relit le dossier mémoire sans relancer l'application
 * (`refreshLibrary`), pour voir les sessions et itinéraires copiés depuis un
 * autre appareil. Dans la rangée des imports des bibliothèques, et dans
 * Réglages › Mémoire. Absent tant que la mémoire n'est pas ouverte, grisé
 * pendant la relecture et le calcul des fiches.
 */
function RefreshLibraryButton() {
  const { status, refreshing, scanning } = useSessionLibrary();
  if (status !== 'ready') return null;
  return (
    <Button disabled={refreshing || scanning !== null} onClick={() => void refreshLibrary()}
      title="Relit le dossier mémoire : sessions et itinéraires copiés depuis un autre appareil, réglages plus récents">
      <IconRefresh size={18} />
      {refreshing ? 'Mise à jour…' : 'Mettre à jour'}
    </Button>
  );
}

export default RefreshLibraryButton;
