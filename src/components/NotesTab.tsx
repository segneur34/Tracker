import type { ComponentProps } from 'react';
import ResizablePanel from './ResizablePanel';
import SessionNotesPanel from './SessionNotesPanel';
import { NOTES_PANEL_STYLE } from './styles';

/**
 * Onglet du matériel et des notes d'une analyse, le même dans les quatre
 * modules : le `ResizablePanel` d'`id` donné (flex en ligne) et
 * `SessionNotesPanel`. Les notes sont celles du brouillon (`draft.edits.notes`).
 */
export default function NotesTab({ id, draft, ...panel }: Omit<ComponentProps<typeof SessionNotesPanel>, 'notes' | 'setNotes'> & {
  id: string;
  draft: ComponentProps<typeof SessionNotesPanel>['draft'] & {
    edits: { notes: ComponentProps<typeof SessionNotesPanel>['notes'] };
    updateNotes: ComponentProps<typeof SessionNotesPanel>['setNotes'];
  };
}) {
  return (
    <ResizablePanel id={id} style={NOTES_PANEL_STYLE}>
      <SessionNotesPanel {...panel} draft={draft} notes={draft.edits.notes} setNotes={draft.updateNotes} />
    </ResizablePanel>
  );
}
