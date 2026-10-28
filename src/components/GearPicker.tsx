import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { newId } from '../core/basics';
import { MAX_GEAR_LABEL_LENGTH, cleanGearName, sameGearName, type GearGroup, type GearItem } from '../hooks/useSportSettings';
import { pushBackLayer } from '../platform/backButton';
import type { GearChoice } from '../sailing/sessionNotes';
import Button from './ui/Button';
import { IconChevronRight } from './icons';
import './ActivitySelect.css';
import './Gear.css';

interface Props {
  /** Groupe du matériel enregistré ; celui d'un choix dont le groupe a disparu de la liste n'a pas de pièce. */
  group: GearGroup;
  /** Pièce choisie pour la session dans ce groupe, `null` : aucune. */
  choice: GearChoice | null;
  onChoose: (choice: GearChoice | null) => void;
  /** Range une pièce neuve dans la liste de l'activité, tout de suite ; absent : le groupe n'y est plus. */
  onAddToList?: (name: string) => GearItem | null;
}

/**
 * Choix d'une pièce d'un groupe du matériel enregistré, dans l'onglet du
 * matériel de l'analyse : un bouton au gabarit d'un champ, qui ouvre une
 * liste dessinée par l'application (jamais le menu natif, comme le choix
 * d'une activité) : « Aucun », les pièces du groupe, puis « Ajouter… », qui
 * crée une pièce rangée dans la liste ou gardée pour cette session seule.
 * Une pièce renommée dans Réglages s'affiche sous son nom du moment.
 */
function GearPicker({ group, choice, onChoose, onAddToList }: Props) {
  const [open, setOpen] = useState(false);
  /** Liste ouverte sur la saisie d'une pièce neuve. */
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const current = choice ? group.items.find((item) => item.id === choice.itemId) ?? null : null;
  const shownName = current?.name ?? choice?.itemName ?? null;

  const close = () => {
    setOpen(false);
    setAdding(false);
    setName('');
  };
  const pick = (item: GearItem | null) => {
    close();
    onChoose(item ? { groupId: group.id, groupName: group.name, itemId: item.id, itemName: item.name } : null);
  };
  const addForSession = () => {
    const clean = cleanGearName(name);
    if (clean === '') return;
    const same = group.items.find((item) => sameGearName(item.name, clean));
    pick(same ?? { id: newId(), name: clean });
  };
  const addToList = () => {
    if (!onAddToList || cleanGearName(name) === '') return;
    const item = onAddToList(name);
    if (item) pick(item);
  };

  return (
    <div className="gear-picker">
      <span className="gear-picker__label">{group.name}</span>
      <button type="button" className="ui-field ui-field--s activity-select gear-picker__button" data-testid={`gear-picker-${group.id}`}
        aria-haspopup="listbox" aria-expanded={open} aria-label={`${group.name} : ${shownName ?? 'aucun'}`}
        onClick={() => setOpen(true)}>
        <span className={shownName ? 'activity-select__name' : 'activity-select__name activity-select__name--empty'}>{shownName ?? 'Aucun'}</span>
        <IconChevronRight size={14} className="activity-select__chevron" />
      </button>
      {open && (
        <GearSheet title={group.name} onClose={close}>
          {adding ? (
            <div className="gear-picker__add">
              <input value={name} maxLength={MAX_GEAR_LABEL_LENGTH} placeholder="Nom de la pièce" aria-label={`Nouvelle pièce de ${group.name}`}
                className="ui-field" autoFocus data-testid="gear-add-name"
                onChange={(e) => setName(e.target.value)} />
              <div className="gear-picker__add-actions">
                {onAddToList && (
                  <Button size="s" variant="primary" disabled={cleanGearName(name) === ''} onClick={addToList} data-testid="gear-add-list">
                    Ajouter à la liste
                  </Button>
                )}
                <Button size="s" disabled={cleanGearName(name) === ''} onClick={addForSession} data-testid="gear-add-session">Pour cette session</Button>
                <Button size="s" variant="ghost" onClick={() => setAdding(false)}>Retour</Button>
              </div>
            </div>
          ) : (
            <>
              <Option label="Aucun" selected={choice === null} onClick={() => pick(null)} />
              {group.items.map((item) => (
                <Option key={item.id} label={item.name} selected={choice?.itemId === item.id} onClick={() => pick(item)} />
              ))}
              {/* Pièce gardée pour une session, ou retirée de la liste : montrée choisie, sous son nom de la fiche. */}
              {choice && !current && (
                <Option label={choice.itemName} selected onClick={() => close()} />
              )}
              <button type="button" className="activity-select__option gear-picker__option--add" data-testid="gear-add" onClick={() => setAdding(true)}>
                <span className="activity-select__option-name">Ajouter…</span>
              </button>
            </>
          )}
        </GearSheet>
      )}
    </div>
  );
}

function Option({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} className="activity-select__option" onClick={onClick}>
      <span className="activity-select__option-name">{label}</span>
      <span className="activity-select__radio" aria-hidden="true" />
    </button>
  );
}

/** Liste par-dessus la page, comme celle des activités : Échap, un appui à côté ou le retour d'Android la ferme. */
function GearSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const removeLayer = pushBackLayer(() => closeRef.current());
    return () => {
      window.removeEventListener('keydown', onKey);
      removeLayer();
    };
  }, []);
  return createPortal(
    <div className="activity-select__backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="activity-select__sheet gear-picker__sheet" role="listbox" aria-label={title} data-testid="gear-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="activity-select__heading"><strong>{title}</strong></div>
        {children}
      </div>
    </div>,
    document.body
  );
}

export default GearPicker;
