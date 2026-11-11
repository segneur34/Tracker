import { retryLeftCapture, useRecorderSelector, type LeftCapture } from '../hooks/useRecorder';
import Button from './ui/Button';

/** Ce que dit le message après un essai, selon son issue. */
const STATUS_TEXT: Record<LeftCapture['status'], string | null> = {
  waiting: null,
  retrying: null,
  unreadable: 'Toujours illisibles.',
  failed: 'Lues, mais la session n\'a pas pu les recevoir.',
  absent: 'Leur fichier n\'est plus sur l\'appareil : la session reste sans elles.',
};

/**
 * Message « Mesures des capteurs illisibles » d'une analyse (lot 212) : la session a été rangée à l'arrêt sans sa
 * capture, qui n'a pas pu être lue et reste sur l'appareil. « Réessayer » la relit et la donne à la session
 * (`retryLeftCapture`) ; réussi, le message disparaît et l'analyse relit la session avec ses capteurs. Rien pour une
 * autre session ; en mémoire seulement (perdu si l'application redémarre).
 */
function MotionLeftNotice({ file }: { file: string }) {
  const left = useRecorderSelector((s) => s.leftCaptures).find((c) => c.file === file);
  if (!left) return null;
  const outcome = STATUS_TEXT[left.status];
  const retrying = left.status === 'retrying';
  return (
    <div className="ui-alert ui-alert--warning ui-mb-10 ui-row-10 ui-wrap ui-center" role="status" data-testid="motion-left">
      <span className="ui-grow">
        <strong>Mesures des capteurs illisibles</strong> : la session a été rangée sans elles (ni sauts, ni pumping, ni
        cadence), leur fichier reste sur l'appareil.
        {outcome && <> {outcome}</>}
        {left.detail && <span className="ui-muted ui-text-s"> ({left.detail})</span>}
      </span>
      {left.status !== 'absent' && (
        <Button size="s" onClick={() => void retryLeftCapture(file)} disabled={retrying}>
          {retrying ? 'Lecture…' : 'Réessayer'}
        </Button>
      )}
    </div>
  );
}

export default MotionLeftNotice;
