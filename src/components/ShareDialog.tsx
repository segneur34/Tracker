import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { FAMILY_ACCENT } from '../core/activities';
import { pickShareStats, SHARE_IMAGE, type ShareStat } from '../core/shareImage';
import type { SportFamily } from '../core/sportProfiles';
import { readRunnerProfile, runnerName } from '../hooks/useRunnerProfile';
import { shareFile } from '../platform/share';
import { jsonStore } from '../platform/storage';
import { createTileImageLoader, drawShareImage } from './drawShareImage';
import { IconShare } from './icons';
import type { TrackSegment } from './TrackSegmentsLayer';
import Button from './ui/Button';
import './ShareDialog.css';

/** Choix retenus sur l'appareil, par activité : les chiffres de l'image et le fond de carte. */
const STORAGE_KEY = 'tracker.partage';

interface ShareChoice {
  /** Clés des chiffres retenus ; absent, les premiers de la synthèse (`pickShareStats`). */
  stats?: string[];
  map?: boolean;
}

const readChoice = (activityId: string): ShareChoice =>
  jsonStore.read<Record<string, ShareChoice>>(STORAGE_KEY)?.[activityId] ?? {};

const writeChoice = (activityId: string, choice: ShareChoice): void =>
  jsonStore.write(STORAGE_KEY, { ...jsonStore.read<Record<string, ShareChoice>>(STORAGE_KEY), [activityId]: choice });

interface ShareDialogProps {
  family: SportFamily;
  /** Activité de la session (ou son calcul, sans activité) : clé du choix retenu. */
  activityId: string;
  /** Titre de l'image : nom de la session, ou de l'activité. */
  title: string;
  /** Activité et date, sous le titre. */
  subtitle: string;
  /** Nom du fichier partagé, sans extension. */
  fileName: string;
  segments: ReadonlyArray<TrackSegment>;
  /** Chiffres de la synthèse de la session, parmi lesquels l'utilisateur choisit. */
  stats: ReadonlyArray<ShareStat>;
  onClose: () => void;
}

/**
 * Fenêtre « Partager la session » : l'aperçu de l'image (trace, fond de
 * carte, chiffres), les chiffres à y mettre et le fond, retenus par activité
 * sur l'appareil (six chiffres au plus), et le bouton qui ouvre le menu de partage du téléphone
 * (`platform/share.ts`). Ouverte depuis le « … » de l'analyse et des cartes de fin d'enregistrement.
 */
function ShareDialog({ family, activityId, title, subtitle, fileName, segments, stats, onClose }: ShareDialogProps) {
  const [choice, setChoice] = useState<ShareChoice>(() => readChoice(activityId));
  /** Nom ou pseudo de Réglages, au pied de l'image. */
  const [author] = useState(() => runnerName(readRunnerProfile()));
  /** Dernière image dessinée, et ce qu'elle montre (`drawKey`). */
  const [image, setImage] = useState<{ blob: Blob; url: string; key: string } | null>(null);
  /** Échec du dessin, pour ce qu'il devait montrer. */
  const [failure, setFailure] = useState<{ text: string; key: string } | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const tileImage = useMemo(() => createTileImageLoader(), []);
  const withMap = choice.map ?? true;
  const chosen = pickShareStats(stats, choice.stats ?? null);
  /** Ce que l'image montre, en texte : un rendu de l'analyse (survol d'un graphe) ne la redessine pas. */
  const drawKey = JSON.stringify([chosen, withMap]);
  const drawing = image?.key !== drawKey && failure?.key !== drawKey;

  const update = (next: ShareChoice) => {
    setChoice(next);
    writeChoice(activityId, next);
  };

  const toggleStat = (key: string) => {
    const current = choice.stats ?? chosen.map((s) => s.key);
    update({ ...choice, stats: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] });
  };

  useEffect(() => {
    let cancelled = false;
    const accent = getComputedStyle(document.documentElement).getPropertyValue(`--${family}`).trim() || '#1976d2';
    const [shown, map] = JSON.parse(drawKey) as [ShareStat[], boolean];
    drawShareImage({ title, subtitle, accent, segments, stats: shown, withMap: map, author }, tileImage)
      .then((blob) => {
        if (cancelled) return;
        setImage((previous) => {
          if (previous) URL.revokeObjectURL(previous.url);
          return { blob, url: URL.createObjectURL(blob), key: drawKey };
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailure({ text: err instanceof Error ? err.message : 'Image impossible à produire.', key: drawKey });
      });
    return () => {
      cancelled = true;
    };
  }, [family, title, subtitle, segments, drawKey, tileImage, author]);

  /** Aperçu libéré à la fermeture. */
  const imageRef = useRef(image);
  useEffect(() => {
    imageRef.current = image;
  });
  useEffect(() => () => {
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
  }, []);

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const share = async () => {
    if (!image) return;
    setNote(null);
    try {
      const outcome = await shareFile(image.blob, `${fileName}.png`, 'Partager la session');
      if (outcome === 'downloaded') setNote({ text: 'Ce navigateur ne partage pas d\'image : elle est téléchargée.', error: false });
    } catch (err) {
      setNote({ text: `Partage impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}`, error: true });
    }
  };

  return createPortal(
    <div className="share-dialog__backdrop" onClick={onClose}>
      <div className="share-dialog" role="dialog" aria-modal="true" aria-label="Partager la session" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog__head">
          <strong>Partager la session</strong>
          <button type="button" className="share-dialog__close" onClick={onClose} aria-label="Fermer">×</button>
        </div>

        <div className="share-dialog__preview" aria-busy={drawing}>
          {image
            ? <img src={image.url} alt="Aperçu de l'image partagée" style={{ opacity: drawing ? 0.5 : 1 }} />
            : <span className="share-dialog__wait">Préparation de l'image…</span>}
        </div>

        <label className="share-dialog__check">
          <input type="checkbox" checked={withMap} onChange={(e) => update({ ...choice, map: e.target.checked })} />
          Fond de carte
        </label>

        {stats.length > 0 && (
          <div>
            <div className="share-dialog__label">Chiffres sur l'image ({chosen.length} sur {SHARE_IMAGE.maxStats} au plus)</div>
            <div className="ui-tabs ui-tabs--compact" role="group" aria-label="Chiffres sur l'image"
              style={{ '--tab-accent': FAMILY_ACCENT[family] } as CSSProperties}>
              {stats.map((stat) => {
                const on = chosen.some((s) => s.key === stat.key);
                return (
                  <button key={stat.key} type="button" className="ui-tab" aria-pressed={on}
                    disabled={!on && chosen.length >= SHARE_IMAGE.maxStats} onClick={() => toggleStat(stat.key)}>
                    {stat.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {failure?.key === drawKey && <div role="status" className="ui-alert ui-alert--danger">{failure.text}</div>}
        {note && <div role="status" className={note.error ? 'ui-alert ui-alert--danger' : 'share-dialog__note'}>{note.text}</div>}

        <div className="share-dialog__actions">
          <Button variant="ghost" onClick={onClose}>Fermer</Button>
          <Button variant="primary" disabled={!image || image.key !== drawKey} onClick={() => void share()}>
            <IconShare size={18} />
            Partager
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ShareDialog;
