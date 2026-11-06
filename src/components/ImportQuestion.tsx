import { answerImportQuestion, useLibraryFields } from '../hooks/useSessionLibrary';
import Button from './ui/Button';
import Dialog from './ui/Dialog';

/**
 * Question posée avant d'importer un dossier qui contient plusieurs activités de montre, dans le cadre de toutes les
 * pages : l'import peut partir du menu « … » d'une bibliothèque comme de Réglages. Fermer la fenêtre revient à refuser.
 */
function ImportQuestion() {
  const { importQuestion } = useLibraryFields('importQuestion');
  if (!importQuestion) return null;
  const refuse = () => answerImportQuestion(false);
  return (
    <Dialog title="Importer tout le dossier ?" onClose={refuse}>
      <p className="ui-hint">
        {importQuestion.watchActivities} activités de montre dans ce dossier, tout importer ?
        {' '}Pour n'en prendre que certaines, copiez d'abord ces fichiers dans un dossier à part, ou choisissez-les un par un avec « Importer des GPX ou FIT ».
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
        <Button variant="primary" onClick={() => answerImportQuestion(true)}>Tout importer</Button>
        <Button variant="ghost" onClick={refuse}>Annuler</Button>
      </div>
    </Dialog>
  );
}

export default ImportQuestion;
