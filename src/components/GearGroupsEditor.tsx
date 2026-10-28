import { useState } from 'react';
import { newId, plural } from '../core/basics';
import { MAX_GEAR_LABEL_LENGTH, cleanGearName, withGearItem, type GearGroup } from '../hooks/useSportSettings';
import Button from './ui/Button';
import { IconChevronDown, IconChevronRight, IconClose } from './icons';
import './Gear.css';

/**
 * Nom d'un groupe ou d'une pièce, renommé à la sortie du champ (ou à Entrée) ;
 * un nom vidé reprend l'ancien : on supprime par la croix, pas en effaçant.
 */
function NameField({ value, label, className, onRename }: {
  value: string;
  label: string;
  className?: string;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  // Changé d'ailleurs (fichier de réglages repris) : relu, pendant le rendu.
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const commit = () => {
    const name = cleanGearName(draft);
    if (name !== '' && name !== value) onRename(name);
    setDraft(name === '' ? value : name);
  };
  return (
    <input value={draft} maxLength={MAX_GEAR_LABEL_LENGTH} aria-label={label} className={`ui-field ui-field--s${className ? ` ${className}` : ''}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

/** Champ et bouton d'ajout : le nom saisi, ajouté par le bouton ou par Entrée, puis le champ se vide. */
function AddField({ placeholder, button, testId, onAdd }: {
  placeholder: string;
  button: string;
  testId: string;
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const add = () => {
    if (cleanGearName(name) === '') return;
    onAdd(name);
    setName('');
  };
  return (
    <div className="gear-editor__row">
      <input value={name} maxLength={MAX_GEAR_LABEL_LENGTH} placeholder={placeholder} aria-label={placeholder} className="ui-field ui-field--s"
        data-testid={`${testId}-name`}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
      <Button size="s" disabled={cleanGearName(name) === ''} onClick={add} data-testid={testId}>{button}</Button>
    </div>
  );
}

/**
 * Matériel enregistré d'une activité (Réglages, partie « Matériel », fiche 18), posé en ligne
 * sous la case : « Créer matériel » ajoute un groupe (« Voile », « Aile avant », « Mât »…),
 * chaque groupe se déplie (chevron, replié par défaut, un groupe neuf s'ouvre) sur ses
 * lignes et le champ d'ajout d'une ligne. Groupes et lignes se renomment et se suppriment.
 * Chaque changement est écrit tout de suite (`onChange`). Une pièce supprimée reste dans
 * les sessions qui la portent : Statistiques la retrouve par son nom.
 */
function GearGroupsEditor({ groups, onChange }: {
  groups: readonly GearGroup[];
  onChange: (groups: GearGroup[]) => void;
}) {
  /** Groupes dépliés, propres à l'écran (repliés à la réouverture de Réglages). */
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (groupId: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    return next;
  });

  const update = (groupId: string, change: (group: GearGroup) => GearGroup) =>
    onChange(groups.map((g) => (g.id === groupId ? change(g) : g)));

  const removeGroup = (group: GearGroup) => {
    const pieces = group.items.length > 0 ? ` et ses ${plural(group.items.length, 'pièce')}` : '';
    if (window.confirm(`Supprimer le groupe « ${group.name} »${pieces} ? Les sessions qui les portent les gardent.`)) {
      onChange(groups.filter((g) => g.id !== group.id));
    }
  };

  const removeItem = (group: GearGroup, itemId: string, name: string) => {
    if (window.confirm(`Supprimer « ${name} » de « ${group.name} » ? Les sessions qui la portent la gardent.`)) {
      update(group.id, (g) => ({ ...g, items: g.items.filter((item) => item.id !== itemId) }));
    }
  };

  const addGroup = (name: string) => {
    const id = newId();
    onChange([...groups, { id, name: cleanGearName(name), items: [] }]);
    setOpen((prev) => new Set(prev).add(id));
  };

  const addItem = (groupId: string, name: string) => {
    const next = withGearItem(groups, groupId, name);
    if (next) onChange(next.groups);
  };

  return (
    <div className="gear-editor">
      <AddField placeholder="Nom du matériel (voile, mât…)" button="Créer matériel" testId="gear-group-add" onAdd={addGroup} />
      {groups.map((group) => {
        const isOpen = open.has(group.id);
        return (
          <div key={group.id} className="gear-editor__group" data-testid={`gear-group-${group.id}`}>
            <div className="gear-editor__row">
              <button type="button" className="gear-editor__icon" data-testid={`gear-group-toggle-${group.id}`}
                aria-expanded={isOpen} aria-label={`${isOpen ? 'Replier' : 'Déplier'} ${group.name}`}
                title={isOpen ? 'Replier' : 'Déplier'} onClick={() => toggle(group.id)}>
                {isOpen ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
              </button>
              <NameField value={group.name} label={`Nom du groupe ${group.name}`} className="gear-editor__name"
                onRename={(name) => update(group.id, (g) => ({ ...g, name }))} />
              {!isOpen && <span className="gear-editor__count">{plural(group.items.length, 'ligne')}</span>}
              <button type="button" className="gear-editor__icon" aria-label={`Supprimer le groupe ${group.name}`} title="Supprimer le groupe"
                onClick={() => removeGroup(group)}>
                <IconClose size={18} />
              </button>
            </div>
            {isOpen && (
              <div className="gear-editor__items">
                {group.items.map((item) => (
                  <div key={item.id} className="gear-editor__row">
                    <NameField value={item.name} label={`Nom de la ligne ${item.name}`}
                      onRename={(name) => update(group.id, (g) => ({ ...g, items: g.items.map((it) => (it.id === item.id ? { ...it, name } : it)) }))} />
                    <button type="button" className="gear-editor__icon" aria-label={`Supprimer ${item.name}`} title="Supprimer la ligne"
                      onClick={() => removeItem(group, item.id, item.name)}>
                      <IconClose size={16} />
                    </button>
                  </div>
                ))}
                <AddField placeholder="Nouvelle ligne" button="Ajouter une ligne" testId="gear-item-add" onAdd={(name) => addItem(group.id, name)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default GearGroupsEditor;
