import { useRecorderSelector } from '../hooks/useRecorder';
import { interruptedNotice } from '../recording/resume';

/**
 * « Enregistrement interrompu à … » en tête de l'analyse d'une session coupée par le téléphone ou l'application, puis
 * rangée d'office au lancement suivant (lot 232, d'après Gtracker 496) : la trace s'arrête là. Rien pour une autre
 * session, ni après « Arrêter » ; en mémoire seulement (perdu si l'application redémarre), comme `MotionLeftNotice`.
 */
function RecordingInterruptedNotice({ file }: { file: string }) {
  const interrupted = useRecorderSelector((s) => s.interruptions).find((c) => c.file === file);
  if (!interrupted) return null;
  return (
    <div className="ui-alert ui-alert--warning ui-mb-10" role="status" data-testid="recording-interrupted">
      {interruptedNotice(interrupted.atMs)}
    </div>
  );
}

export default RecordingInterruptedNotice;
