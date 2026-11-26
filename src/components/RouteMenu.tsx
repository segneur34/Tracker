import { useState } from 'react';
import type { Activity } from '../core/activities';
import type { SavedRoute } from '../hooks/routeFiles';
import { routeDisplayName } from '../library/routeName';
import { trashDeleteButton } from '../library/trash';
import { IconDownload, IconRoute, IconShare, IconTrash } from './icons';
import RouteImageShare from './RouteImageShare';
import { shareRouteGpx, type RouteShareNote } from './routeShare';
import Button from './ui/Button';
import MoreMenu from './ui/MoreMenu';

/**
 * Menu « … » d'un itinéraire (lot 236, d'après les lots 458 et 466 de Gtracker) : en haut de Planifier, à droite
 * du titre, et au bout de chaque ligne des listes d'itinéraires (`RouteRowActions`). « Partager l'image »,
 * « Partager le GPX », « Exporter le GPX » (Planifier, sur ordinateur), puis « Supprimer », confirmé par
 * « Supprimer définitivement » (ou « Mettre à la corbeille » dans le programme Windows) et « Garder » dans le menu
 * resté ouvert ; le refermer abandonne la confirmation.
 */

interface RouteMenuProps {
  label: string;
  /** Partages grisés, avec « Enregistrez d'abord les modifications » : itinéraire jamais rangé, ou modifié. */
  blocked?: boolean;
  onShareImage: () => void;
  onShareGpx: () => void;
  /** « Exporter le GPX » (ordinateur) ; absent : pas d'entrée. */
  exportGpx?: { run: () => void; disabled: boolean; title?: string };
  /** Suppression confirmée ; absente : pas d'entrée (itinéraire pas encore rangé). */
  onDelete?: () => void;
  /** La suppression part à la corbeille (programme Windows) : le bouton de confirmation le dit. */
  toTrash: boolean;
}

export function RouteMenu({ label, blocked = false, onShareImage, onShareGpx, exportGpx, onDelete, toTrash }: RouteMenuProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <MoreMenu label={label} onClose={() => setConfirming(false)}>
      <Button onClick={onShareImage} disabled={blocked}>
        <IconShare size={18} />
        Partager l'image
      </Button>
      <Button onClick={onShareGpx} disabled={blocked}>
        <IconRoute size={18} />
        Partager le GPX
      </Button>
      {blocked && <span className="ui-more__note">Enregistrez d'abord les modifications</span>}
      {exportGpx && (
        <Button onClick={exportGpx.run} disabled={exportGpx.disabled} title={exportGpx.title}>
          <IconDownload size={18} />
          Exporter le GPX
        </Button>
      )}
      {onDelete && (
        <>
          <span className="ui-more__sep" role="separator" />
          {confirming ? (
            <>
              <Button variant="danger" onClick={onDelete}>{trashDeleteButton(toTrash, 'Supprimer définitivement')}</Button>
              <span className="ui-more__keep" data-keep-open>
                <Button variant="ghost" onClick={() => setConfirming(false)}>Garder</Button>
              </span>
            </>
          ) : (
            <span className="ui-more__keep" data-keep-open>
              <Button variant="danger" onClick={() => setConfirming(true)}>
                <IconTrash size={18} />
                Supprimer
              </Button>
            </span>
          )}
        </>
      )}
    </MoreMenu>
  );
}

interface RouteRowActionsProps {
  saved: SavedRoute;
  activities: Activity[];
  toTrash: boolean;
  onDelete: (saved: SavedRoute) => void;
  /** Phrase d'un partage du GPX (téléchargé, échec) ; `null` l'efface. */
  onNote: (note: RouteShareNote | null) => void;
}

/**
 * Bout d'une ligne de la liste des itinéraires et du bloc « mes itinéraires » de Planifier : l'icône de partage,
 * raccourci vers le GPX, et le menu « … » (`RouteMenu`) ; « Partager l'image » ouvre sa fenêtre (`RouteImageShare`).
 */
export function RouteRowActions({ saved, activities, toTrash, onDelete, onNote }: RouteRowActionsProps) {
  const [sharingImage, setSharingImage] = useState(false);
  const name = routeDisplayName(saved.record);
  const shareGpx = async () => {
    onNote(null);
    onNote(await shareRouteGpx(saved));
  };
  return (
    <>
      <Button size="s" variant="ghost" className="route-list__icon-btn" title="Partager le GPX"
        onClick={() => void shareGpx()} aria-label={`Partager ${name}`}>
        <IconShare size={24} />
      </Button>
      <RouteMenu label={`Plus d'actions sur ${name}`} onShareImage={() => setSharingImage(true)} onShareGpx={() => void shareGpx()}
        onDelete={() => onDelete(saved)} toTrash={toTrash} />
      {sharingImage && <RouteImageShare saved={saved} activities={activities} onClose={() => setSharingImage(false)} />}
    </>
  );
}
