import { useEffect, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { FAMILY_ACCENT, FAMILY_LABEL, activitiesOfFamily, type Activity } from '../core/activities';
import { SPORT_FAMILIES, type SportFamily } from '../core/sportProfiles';
import { IconBike, IconChevronRight, IconRun, IconSail } from './icons';
import './ActivitySelect.css';

/**
 * Choix d'une activité, groupées par famille (Voile, Course à pied, Vélo) :
 * planifier un itinéraire, classer une session, changer l'activité d'un
 * enregistrement en cours ou d'une session analysée. Passer d'une famille à
 * l'autre change le module qui analyse la session : c'est à l'appelant d'en
 * tirer les conséquences.
 *
 * Une liste dessinée par l'application plutôt qu'un menu natif : celui
 * d'Android range mal les groupes (traits entre les activités d'une même
 * famille, aucun entre les familles). Ici, la famille à gauche, ses activités
 * décalées dessous, un trait entre deux familles.
 */

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

const FAMILY_ICON: Record<SportFamily, ComponentType<{ size?: number }>> = { voile: IconSail, course: IconRun, velo: IconBike };

function ActivitySelect({
  activities, value, onChange, extra, families = SPORT_FAMILIES, placeholder, disabled, className = 'ui-field ui-field--s', label,
}: ActivitySelectProps) {
  const [open, setOpen] = useState(false);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const list = extra && !activities.some((a) => a.id === extra.id) ? [...activities, extra] : activities;
  const groups = families
    .map((family) => ({ family, items: activitiesOfFamily(list, family) }))
    .filter((g) => g.items.length > 0);
  const current = list.find((a) => a.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    selectedRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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

      {open && createPortal(
        <div className="activity-select__backdrop" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <div className="activity-select__sheet" role="listbox" aria-label={label ?? 'Activité'} onClick={(e) => e.stopPropagation()}>
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
                        onClick={() => choose(a)}>
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
      )}
    </>
  );
}

export default ActivitySelect;
