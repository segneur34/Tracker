import { plainError } from '../platform/errorText';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FAMILY_ACCENT } from '../core/activities';
import { pickShareStats, SHARE_IMAGE, type ShareStat } from '../core/shareImage';
import type { SportFamily } from '../core/sportProfiles';
import type { RouteShareContent, SurfaceBandPart } from '../planning/routeShareImage';
import { useMapBase } from '../hooks/useMapBase';
import { readRunnerProfile } from '../hooks/useRunnerProfile';
import { runnerName } from '../library/athleteProfile';
import { shareFile } from '../platform/share';
import { jsonStore } from '../platform/storage';
import { lightToken } from '../theme/lightToken';
import { createTileImageLoader, drawShareImage } from './drawShareImage';
import { IconShare } from './icons';
import type { TrackSegment } from './TrackSegmentsLayer';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import './ShareDialog.css';

/** Choix retenus sur l'appareil, par activité : les chiffres de l'image, le fond de carte, la bande du revêtement. */
const STORAGE_KEY = 'tracker.partage';

interface ShareChoice {
  /** Clés des chiffres retenus ; absent, les premiers de la synthèse (`pickShareStats`). */
  stats?: string[];
  map?: boolean;
  /** Bande du revêtement d'un itinéraire ; absente : non (lot 236). */
  surface?: boolean;
}

const readChoice = (activityId: string): ShareChoice =>
  jsonStore.read<Record<string, ShareChoice>>(STORAGE_KEY)?.[activityId] ?? {};

const writeChoice = (activityId: string, choice: ShareChoice): void =>
  jsonStore.write(STORAGE_KEY, { ...jsonStore.read<Record<string, ShareChoice>>(STORAGE_KEY), [activityId]: choice });

interface ShareDialogProps {
  family: SportFamily;
  /** Fichier de la session dans la mémoire : son fond de carte (fiche) est celui de l'image ; sans lui, celui de la famille. */
  file?: string;
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
  /** Chiffres fixes (itinéraire) : tous sur l'image, sans choix à faire. */
  fixedStats?: boolean;
  /** Parcours d'un itinéraire, dessiné à la place de la trace (`segments` vide). */
  course?: RouteShareContent;
  /** Bande du revêtement d'un itinéraire : sa case s'offre, décochée d'office ; absente, pas de case. */
  surfaceBand?: ReadonlyArray<SurfaceBandPart> | null;
  /** Texte de l'image, porté par l'aperçu ; sans lui, une phrase générique. */
  description?: string;
  /** Ce qu'on partage, dans le titre de la fenêtre et du menu de partage : « la session » d'office. */
  what?: string;
}

/**
 * Fenêtre « Partager la session » : l'aperçu de l'image (trace, fond de
 * carte, chiffres), les chiffres à y mettre et le fond, retenus par activité
 * sur l'appareil (six chiffres au plus), et le bouton qui ouvre le menu de partage du téléphone
 * (`platform/share.ts`). Ouverte depuis le « … » de l'analyse et des cartes de fin d'enregistrement ;
 * celle d'un itinéraire (`RouteImageShare`, lot 236) montre son parcours et ses chiffres fixes : seuls le fond
 * et, à pied et à vélo, la bande du revêtement se choisissent.
 */
function ShareDialog({
  family, file, activityId, title, subtitle, fileName, segments, stats, onClose, fixedStats, course, surfaceBand, description,
  what = 'la session',
}: ShareDialogProps) {
  const [choice, setChoice] = useState<ShareChoice>(() => readChoice(activityId));
  /** Nom ou pseudo de Réglages, au pied de l'image. */
  const [author] = useState(() => runnerName(readRunnerProfile()));
  /** Dernière image dessinée, et ce qu'elle montre (`drawKey`). */
  const [image, setImage] = useState<{ blob: Blob; url: string; key: string } | null>(null);
  /** Échec du dessin, pour ce qu'il devait montrer. */
  const [failure, setFailure] = useState<{ text: string; key: string } | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  /** Fond de carte de la session, celui de l'analyse (sinon de la famille) : plan ou satellite. */
  const [base] = useMapBase(family, file);
  const tileImage = useMemo(() => createTileImageLoader(base), [base]);
  const withMap = choice.map ?? true;
  const chosen = fixedStats ? stats.slice(0, SHARE_IMAGE.maxStats) : pickShareStats(stats, choice.stats ?? null);
  /** Bande du revêtement montrée : seulement si l'itinéraire en a une et que la case est cochée. */
  const withBand = Boolean(surfaceBand) && choice.surface === true;
  /** Ce que l'image montre, en texte : un rendu de l'analyse (survol d'un graphe) ne la redessine pas. */
  const drawKey = JSON.stringify(withBand ? [chosen, withMap, base, true] : [chosen, withMap, base]);
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
    // Couleur de la famille dans la palette claire : l'image reste claire en thème sombre.
    const accent = lightToken(`--${family}`, '#1976d2');
    const [shown, map, , banded] = JSON.parse(drawKey) as [ShareStat[], boolean, unknown, boolean?];
    const route = course ? { course, ...(banded && surfaceBand ? { band: surfaceBand } : {}) } : {};
    drawShareImage({ title, subtitle, accent, segments, stats: shown, withMap: map, base, author, ...route }, tileImage)
      .then((blob) => {
        if (cancelled) return;
        setImage((previous) => {
          if (previous) URL.revokeObjectURL(previous.url);
          return { blob, url: URL.createObjectURL(blob), key: drawKey };
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailure({ text: plainError(err, 'Image impossible à produire.'), key: drawKey });
      });
    return () => {
      cancelled = true;
    };
  }, [family, title, subtitle, segments, drawKey, tileImage, base, author, course, surfaceBand]);

  /** Aperçu libéré à la fermeture. */
  const imageRef = useRef(image);
  useEffect(() => {
    imageRef.current = image;
  });
  useEffect(() => () => {
    if (imageRef.current) URL.revokeObjectURL(imageRef.current.url);
  }, []);

  const share = async () => {
    if (!image) return;
    setNote(null);
    try {
      const outcome = await shareFile(image.blob, `${fileName}.png`, `Partager ${what}`);
      if (outcome === 'downloaded') setNote({ text: 'Ce navigateur ne partage pas d\'image : elle est téléchargée.', error: false });
    } catch (err) {
      setNote({ text: `Partage impossible : ${plainError(err, 'erreur inconnue')}`, error: true });
    }
  };

  return (
    <Dialog title={`Partager ${what}`} onClose={onClose} className="share-dialog">

      <div className="share-dialog__preview" aria-busy={drawing}>
        {image
          ? <img src={image.url} alt={description ?? "Aperçu de l'image partagée"} style={{ opacity: drawing ? 0.5 : 1 }} />
          : <span className="share-dialog__wait">Préparation de l'image…</span>}
      </div>

      {/* Sans trace ni parcours (muscu), pas de fond de carte à choisir. */}
      {(segments.length > 0 || course !== undefined) && (
        <label className="share-dialog__check">
          <input type="checkbox" checked={withMap} onChange={(e) => update({ ...choice, map: e.target.checked })} />
          Fond de carte
        </label>
      )}

      {surfaceBand && (
        <label className="share-dialog__check">
          <input type="checkbox" checked={withBand} onChange={(e) => update({ ...choice, surface: e.target.checked })} />
          Bande du revêtement
        </label>
      )}

      {!fixedStats && stats.length > 0 && (
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
    </Dialog>
  );
}

export default ShareDialog;
