import { IconRoute, IconShare } from './icons';
import Button from './ui/Button';

/**
 * Les deux entrées de partage du menu « … » d'une session (lot 207, 11/11), dans l'analyse
 * (`SessionNameEditor`) et sur les cartes de fin d'enregistrement (`SavedSessionShare`) : « Partager
 * l'image » (`ShareDialog`, absente si l'écran n'a pas d'image à proposer) et « Partager la trace (GPX) ».
 */
function SessionShareEntries({ onShareImage, onShareTrace }: { onShareImage?: () => void; onShareTrace: () => void }) {
  return (
    <>
      {onShareImage && (
        <Button onClick={onShareImage}>
          <IconShare size={18} />
          Partager l'image
        </Button>
      )}
      <Button onClick={onShareTrace}>
        <IconRoute size={18} />
        Partager la trace (GPX)
      </Button>
    </>
  );
}

export default SessionShareEntries;
