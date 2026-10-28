import { useState } from 'react';
import { newId, plural } from '../core/basics';
import { MAX_GEAR_LABEL_LENGTH, cleanGearName, withGearItem, type GearGroup } from '../hooks/useSportSettings';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import { IconClose } from './icons';
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
 * Matériel enregistré d'une activité (Réglages, fiche 18) : ses groupes
 * (« Voile », « Aile avant », « Mât »…) et leurs pièces, à créer, renommer et
 * supprimer. Chaque changement est écrit tout de suite (`onChange`). Une pièce
 * supprimée reste dans les sessions qui la portent : Statistiques la retrouve
 * par son nom.
 */
function GearGroupsEditor({ activityName, groups, onChange, onClose }: {
  activityName: string;
  groups: readonly GearGroup[];
  onChange: (groups: GearGroup[]) => void;
  onClose: () => void;
}) {
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

  const addGroup = (name: string) => onChange([...groups, { id: newId(), name: cleanGearName(name), items: [] }]);

  const addItem = (groupId: string, name: string) => {
    const next = withGearItem(groups, groupId, name);
    if (next) onChange(next.groups);
  };

  return (
    <Dialog title={`Matériel de ${activityName}`} onClose={onClose}>
      <div data-testid="gear-editor" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <p className="gear-editor__hint">
          Des groupes (voile, aile avant, mât…) et leurs pièces : en fin de session, une pièce se choisit par groupe dans l'onglet du matériel de l'analyse.
        </p>
        {groups.map((group) => (
          <div key={group.id} className="gear-editor__group" data-testid={`gear-group-${group.id}`}>
            <div className="gear-editor__row">
              <NameField value={group.name} label={`Nom du groupe ${group.name}`} className="gear-editor__name"
                onRename={(name) => update(group.id, (g) => ({ ...g, name }))} />
              <button type="button" className="gear-editor__remove" aria-label={`Supprimer le groupe ${group.name}`} title="Supprimer le groupe"
                onClick={() => removeGroup(group)}>
                <IconClose size={18} />
              </button>
            </div>
            <div className="gear-editor__items">
              {group.items.length === 0 && <span className="gear-editor__empty">Aucune pièce.</span>}
              {group.items.map((item) => (
                <div key={item.id} className="gear-editor__row">
                  <NameField value={item.name} label={`Nom de la pièce ${item.name}`}
                    onRename={(name) => update(group.id, (g) => ({ ...g, items: g.items.map((it) => (it.id === item.id ? { ...it, name } : it)) }))} />
                  <button type="button" className="gear-editor__remove" aria-label={`Supprimer ${item.name}`} title="Supprimer la pièce"
                    onClick={() => removeItem(group, item.id, item.name)}>
                    <IconClose size={16} />
                  </button>
                </div>
              ))}
              <AddField placeholder="Nouvelle pièce" button="Ajouter" testId="gear-item-add" onAdd={(name) => addItem(group.id, name)} />
            </div>
          </div>
        ))}
        <AddField placeholder="Nouveau groupe" button="Ajouter un groupe" testId="gear-group-add" onAdd={addGroup} />
        <div className="gear-editor__foot">
          <Button onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </Dialog>
  );
}

export default GearGroupsEditor;
