import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FAMILY_ACCENT, FAMILY_LABEL, activitiesOfFamily, type Activity } from '../core/activities';
import { SPORT_FAMILIES, type SportFamily } from '../core/sportProfiles';
import { FAMILY_ICON } from './familyIcons';
import { IconChevronRight } from './icons';
import './ActivitySelect.css';

/**
 * Choix d'une activité, groupées par famille (Voile, Course à pied, Vélo, Fractionné) :
 * planifier un itinéraire, classer une session, changer l'activité d'un
 * enregistrement en cours ou d'une session analysée. Passer d'une famille à
 * l'autre change le module qui analyse la session : c'est à l'appelant d'en
 * tirer les conséquences.
 *
 * Une liste dessinée par l'application plutôt qu'un menu natif : celui
 * d'Android range mal les groupes (traits entre les activités d'une même
 * famille, aucun entre les familles). Ici, la famille à gauche, ses activités
 * décalées dessous, un trait entre deux familles. La liste seule
 * (`ActivitySheet`) s'ouvre aussi sans bouton : demander l'activité d'une
 * session à classer avant de l'analyser.
 */

interface ActivitySheetProps {
  activities: Activity[];
  /** Identifiant de l'activité choisie, `null` si aucune. */
  value: string | null;
  /** Familles proposées ; toutes par défaut. */
  families?: SportFamily[];
  label?: string;
  /** Question posée en tête de la liste, et sa précision. */
  heading?: { title: string; hint?: string };
  onChoose: (activity: Activity) => void;
  onClose: () => void;
}

/** Liste des activités par famille, par-dessus la page ; Échap ou un appui à côté la ferme. */
export function ActivitySheet({ activities, value, families = SPORT_FAMILIES, label, heading, onChoose, onClose }: ActivitySheetProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const groups = families
    .map((family) => ({ family, items: activitiesOfFamily(activities, family) }))
    .filter((g) => g.items.length > 0);

  // Une fois à l'ouverture : la page dessous peut se redessiner (chaque seconde à l'enregistrement)
  // sans ramener le focus ; le dernier `onClose` est lu au moment d'Échap.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    selectedRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div className="activity-select__backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="activity-select__sheet" role="listbox" aria-label={heading?.title ?? label ?? 'Activité'} onClick={(e) => e.stopPropagation()}>
        {heading && (
          <div className="activity-select__heading">
            <strong>{heading.title}</strong>
            {heading.hint && <span>{heading.hint}</span>}
          </div>
        )}
        {groups.map(({ family, items }) => {
          const Icon = FAMILY_ICON[family];
          return (
            <div key={family} className="activity-select__group" role="group" aria-label={FAMILY_LABEL[family]}>
              <div className="activity-select__family" style={{ color: FAMILY_ACCENT[family] }}>
                <Icon size={20} />
                {FAMILY_LABEL[family]}
              </div>
              {items.map((a) => {
                const selected = a.id === value;
                return (
                  <button
                    key={a.id}
                    ref={selected ? selectedRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="activity-select__option"
                    onClick={() => onChoose(a)}>
                    <span className="activity-select__dot" style={{ backgroundColor: a.color }} />
                    <span className="activity-select__option-name">{a.name}</span>
                    <span className="activity-select__radio" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

interface ActivitySelectProps {
  activities: Activity[];
  /** Identifiant de l'activité choisie ; `null` : `placeholder`. */
  value: string | null;
  onChange: (activity: Activity) => void;
  /** Activité hors de la liste à proposer quand même (l'activité de base d'un calcul). */
  extra?: Activity | null;
  /** Familles proposées ; toutes par défaut. */
  families?: SportFamily[];
  placeholder?: string;
  disabled?: boolean;
  /** Classe du bouton, celle d'un champ (`ui-field`, petit par défaut). */
  className?: string;
  label?: string;
}

function ActivitySelect({
  activities, value, onChange, extra, families, placeholder, disabled, className = 'ui-field ui-field--s', label,
}: ActivitySelectProps) {
  const [open, setOpen] = useState(false);
  const list = extra && !activities.some((a) => a.id === extra.id) ? [...activities, extra] : activities;
  const current = list.find((a) => a.id === value) ?? null;

  const choose = (activity: Activity) => {
    setOpen(false);
    if (activity.id !== value) onChange(activity);
  };

  return (
    <>
      <button
        type="button"
        className={`${className} activity-select`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label ? `${label} : ${current?.name ?? placeholder ?? 'à choisir'}` : undefined}
        disabled={disabled}
        onClick={() => setOpen(true)}>
        {current && <span className="activity-select__dot" style={{ backgroundColor: current.color }} />}
        <span className={current ? 'activity-select__name' : 'activity-select__name activity-select__name--empty'}>
          {current?.name ?? placeholder ?? 'Choisir…'}
        </span>
        <IconChevronRight size={14} className="activity-select__chevron" />
      </button>

      {open && (
        <ActivitySheet activities={list} value={value} families={families} label={label} onChoose={choose} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

export default ActivitySelect;
