import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FAMILY_ACCENT } from '../core/activities';
import { ACTIVITY_ICON_IDS, ACTIVITY_ICON_LABEL, type ActivityIconId } from '../core/activityIcons';
import type { SportFamily } from '../core/sportProfiles';
import { AVATAR_PHOTO_PX, type RunnerAvatar } from '../hooks/useRunnerProfile';
import { pushBackLayer } from '../platform/backButton';
import { readPickedImage } from '../platform/files';
import ActivityArt from './activityArt';
import { IconClose, IconImage, IconUser } from './icons';
import Button from './ui/Button';
import './ProfileAvatar.css';

/**
 * Photo ronde du Profil : une image importée, ou un dessin d'activité blanc
 * sur la couleur de sa famille. Sans choix, le dessin du sport préféré sur la
 * couleur de son activité (`fallback`), sinon une silhouette.
 */

/** Famille de chaque dessin : sa couleur de fond. */
const ICON_FAMILY: Record<ActivityIconId, SportFamily> = {
  bateau: 'voile', planche: 'voile', wingfoil: 'voile', kite: 'voile',
  course: 'course', marche: 'course',
  route: 'velo', vtt: 'velo', gravel: 'velo',
  surf: 'surf', 'surf-foil': 'surf', kayak: 'surf', paddle: 'surf', 'paddle-foil': 'surf',
  'fractionne-velo': 'fractionne', 'fractionne-pied': 'fractionne',
};

interface AvatarFallback {
  icon: ActivityIconId;
  color: string;
}

/** Disque d'un dessin : couleur de fond et dessin blanc, à 60 % du diamètre. */
const ArtDisc = ({ icon, color }: AvatarFallback) => (
  <span className="profile-avatar__disc" style={{ background: color }}>
    <ActivityArt icon={icon} size={100} className="profile-avatar__art" />
  </span>
);

export function ProfileAvatar({ avatar, fallback }: { avatar: RunnerAvatar | null; fallback: AvatarFallback | null }) {
  if (avatar?.kind === 'photo') return <img className="profile-avatar__photo" src={avatar.dataUrl} alt="" />;
  if (avatar?.kind === 'dessin') return <ArtDisc icon={avatar.icon} color={FAMILY_ACCENT[ICON_FAMILY[avatar.icon]]} />;
  if (fallback) return <ArtDisc {...fallback} />;
  return (
    <span className="profile-avatar__disc profile-avatar__disc--empty">
      <IconUser size={100} className="profile-avatar__art" />
    </span>
  );
}

/**
 * Choix de la photo : les seize dessins sur leur couleur, une image importée
 * (la galerie ou l'appareil photo sur le téléphone), ou aucun choix. Se ferme
 * une fois le choix fait.
 */
export function AvatarPicker({ avatar, onPick, onClose }: {
  avatar: RunnerAvatar | null;
  onPick: (avatar: RunnerAvatar | null) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // Le retour d'Android ferme le choix, sans quitter le Profil ; le dernier `onClose` est lu au moment du retour.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => pushBackLayer(() => closeRef.current()), []);

  const importImage = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      onPick({ kind: 'photo', dataUrl: await readPickedImage(file, AVATAR_PHOTO_PX) });
      onClose();
    } catch {
      setError('Cette image ne se lit pas : essayez une photo en JPEG ou PNG.');
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <section className="avatar-picker" aria-label="Choix de la photo">
      <div className="avatar-picker__head">
        <span className="avatar-picker__title">Photo de profil</span>
        <button type="button" className="avatar-picker__close" aria-label="Fermer" onClick={onClose}>
          <IconClose size={18} />
        </button>
      </div>
      <div className="avatar-picker__grid">
        {ACTIVITY_ICON_IDS.map((icon) => (
          <button key={icon} type="button" className="avatar-picker__choice" title={ACTIVITY_ICON_LABEL[icon]}
            aria-label={ACTIVITY_ICON_LABEL[icon]} aria-pressed={avatar?.kind === 'dessin' && avatar.icon === icon}
            style={{ '--choice-color': FAMILY_ACCENT[ICON_FAMILY[icon]] } as CSSProperties}
            onClick={() => { onPick({ kind: 'dessin', icon }); onClose(); }}>
            <ArtDisc icon={icon} color={FAMILY_ACCENT[ICON_FAMILY[icon]]} />
          </button>
        ))}
      </div>
      <div className="avatar-picker__actions">
        <label className={`ui-btn ui-btn--secondary avatar-picker__import${reading ? ' is-busy' : ''}`}>
          <IconImage size={18} /> {reading ? 'Lecture…' : 'Importer une image'}
          <input ref={input} type="file" accept="image/*" hidden disabled={reading}
            onChange={(e) => void importImage(e.target.files?.[0])} />
        </label>
        {avatar && (
          <Button variant="ghost" onClick={() => { onPick(null); onClose(); }}>Retirer</Button>
        )}
      </div>
      {error && <p className="avatar-picker__error" role="alert">{error}</p>}
    </section>
  );
}
