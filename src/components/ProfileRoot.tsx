import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildRootModel, layoutKey, rootVisibility, ROOT_STYLE, ROOTLET_MINUTES, MAX_ROOTLETS, type Box, type RootLayout, type RootModel } from '../core/rootPath';
import { useStoredRecord, readStoredRecord } from '../hooks/useStoredRecord';
import { usePrefersReducedMotion } from '../hooks/useNarrowScreen';
import { useAppliedTheme } from '../hooks/useTheme';
import { pushBackLayer } from '../platform/backButton';
import { levelText, type RootGrowth } from '../library/rootGrowth';
import { BLOOM_BESIDE, BLOOM_MAX, BLOOM_STEPS, drawRoot, readRootColors, type RootColors, type RootFrame } from './drawRoot';
import './ProfileRoot.css';
import { formatDecimal, formatDuration } from '../core/units';

/**
 * Racine du Profil (maquette validée le 22/10) : elle part du carré à droite
 * du pseudo (`RootSlot`) et pousse autour des cadres de la page, d'une étape
 * par semaine tenue (`library/rootGrowth.ts`) ; elle recule des semaines
 * manquées (−3, −6, puis la graine), la partie perdue restant dessinée sèche.
 * Le temps de la semaine fait pousser des radicelles et la pousse au-dessus du
 * sol, dont la fleur paraît à la première minute, s'ouvre à l'objectif et
 * continue d'évoluer jusqu'à 4 fois l'objectif (maquette du 31/10), puis un
 * papillon arrive à côté d'elle à 4,6 fois et s'y pose à 5 fois (six étapes) ;
 * après une semaine manquée, ses feuilles tombent et restent mortes au sol, de
 * nouvelles repoussant avec le temps fait.
 *
 * Un canevas posé sur toute la page, au-dessus des cadres (la racine peut en
 * mordre le bord), sans capter le toucher. Les cadres sont lus sur la page
 * (`cardSelectors`, dans l'ordre), mesurés à chaque changement de taille.
 * À l'ouverture, si une période s'est close depuis la dernière visite sur cet
 * appareil, les radicelles flétrissent et la racine avance ou recule sous les
 * yeux ; sinon les radicelles du temps fait depuis repoussent.
 */

/** Dernier état vu sur cet appareil, pour rejouer ce qui a changé depuis. */
interface LastSeen {
  /** Version de la règle sous laquelle l'état a été vu : un autre est ignoré (pas de faux recul rejoué). */
  rules?: number;
  level: number | null;
  period: number | null;
  minutes: number;
}
const SEEN_NAMESPACE = 'tracker.profil';
const SEEN_KEY = 'racine';
/** 2 : la semaine du 25/10 (1 : valeurs d'essai d'un jour, sans version). */
const SEEN_RULES = 2;
/** Sans version : un état d'avant la règle, lu par-dessus ce défaut, n'en prend pas. */
const SEEN_DEFAULT: LastSeen = { level: null, period: null, minutes: 0 };
const readSeen = (): LastSeen => {
  const seen = readStoredRecord(SEEN_NAMESPACE, SEEN_KEY, SEEN_DEFAULT);
  return seen.rules === SEEN_RULES ? seen : SEEN_DEFAULT;
};

const SLOT_CLASS = 'profile-root-slot';

const plural = (n: number, word: string): string => `${word}${n >= 2 ? 's' : ''}`;
/** Nombre et mot liés par une espace insécable : jamais séparés en fin de ligne. */
const count = (n: number, word: string): string => `${levelText(n)} ${plural(n, word)}`;
const minutesText = (min: number): string => formatDuration(Math.round(min) * 60_000);
const ease = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
/** Étape de la fleur pour des minutes de la semaine, en multiples de l'objectif, plafonnée à la dernière. */
const bloomOf = (minutes: number, goalMin: number): number => Math.min(BLOOM_MAX, minutes / Math.max(1, goalMin));
/** Multiple de l'objectif arrondi au dixième par défaut (on ne dit pas « 2 fois » avant d'y être) : « 2 », « 1,5 ». */
const timesText = (goalTimes: number): string => {
  const tenth = Math.floor(goalTimes * 10 + 1e-9) / 10;
  return Number.isInteger(tenth) ? String(tenth) : formatDecimal(tenth, 1);
};

/** Où en est la fleur, en clair (textes de la maquette du 31/10 ; le papillon des étapes 5 et 6, lot 147). */
const flowerText = (growth: RootGrowth, goalMin: number): string => {
  if (growth.minutes <= 0) return 'Pas encore de fleur : elle paraît à la première minute.';
  const reached = Math.min(BLOOM_MAX, Math.floor(growth.goalTimes + 1e-9));
  const at = (times: number) => minutesText(times * goalMin);
  if (reached <= 0) return `Fleur en bouton ; elle s'ouvre à ${minutesText(goalMin)}.`;
  // Fleur épanouie à 4 fois (4e étape), papillon à côté d'elle à 4,6 (5e), posé à 5 fois (6e), tout figé au-delà.
  if (reached >= BLOOM_MAX) return `Papillon posé : étape ${BLOOM_STEPS} sur ${BLOOM_STEPS}.`;
  if (growth.goalTimes + 1e-9 >= BLOOM_BESIDE) return `Le papillon est là : étape ${BLOOM_STEPS - 1} sur ${BLOOM_STEPS} ; il se pose à ${at(BLOOM_MAX)}.`;
  if (reached === BLOOM_MAX - 1) return `Fleur épanouie : étape ${reached} sur ${BLOOM_STEPS} ; un papillon arrive à ${minutesText(Math.ceil(BLOOM_BESIDE * goalMin - 1e-9))}.`;
  return `Fleur à l'étape ${reached} sur ${BLOOM_STEPS} ; la suivante à ${at(reached + 1)}.`;
};

/** Carré à droite du pseudo : le niveau de la racine ; le toucher ouvre le détail. */
export function RootSlot({ growth, open, onToggle }: { growth: RootGrowth; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={SLOT_CLASS} aria-expanded={open} onClick={onToggle}
      aria-label={`Racine : ${levelText(growth.level)} ${plural(growth.level, 'étape')} ; voir le détail`}>
      <span className="profile-root-slot__count num">
        <b>{levelText(growth.level)}</b>
        <small>{plural(growth.level, 'étape')}</small>
      </span>
    </button>
  );
}

/** Ce qu'une semaine manquée coûterait, en clair. */
const lossText = (growth: RootGrowth): string => {
  if (!isFinite(growth.lossStep) || growth.lossStep >= growth.level) return 'elle revient à sa graine';
  return `elle recule de ${count(growth.lossStep, 'étape')}${growth.missedInRow > 0 ? ' de plus' : ''}`;
};

function RootBubble({ growth, goalMin, top, right, onClose }: {
  growth: RootGrowth;
  goalMin: number;
  top: number;
  right: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (ref.current?.contains(target as Node) || target?.closest(`.${SLOT_CLASS}`)) return;
      onClose();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    // Le retour d'Android ferme la bulle, sans quitter le Profil.
    const removeLayer = pushBackLayer(onClose);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
      removeLayer();
    };
  }, [onClose]);

  const left = growth.growthSteps - growth.level;
  const rootlets = Math.min(MAX_ROOTLETS, Math.floor(growth.minutes / ROOTLET_MINUTES));
  const missing = minutesText(goalMin - growth.minutes);
  return (
    <div ref={ref} className="profile-root__bubble" role="status" style={{ top, right }}>
      <strong>Racine : {count(growth.level, 'étape')}</strong>
      <span className="profile-root__muted">
        {left <= 0
          ? "Tous les cadres sont entourés : elle s'épaissit et se ramifie."
          : `Encore ${count(left, 'semaine')} ${plural(left, 'tenue')} pour entourer tous les cadres.`}
      </span>
      {growth.maxLevel > growth.level && (
        <span className="profile-root__muted">
          Partie sèche : {count(growth.maxLevel - growth.level, 'étape')} à regagner.
        </span>
      )}
      <span>
        Cette semaine : {minutesText(growth.minutes)} sur {minutesText(goalMin)}
        {growth.goalTimes >= 1 && ` · ${timesText(growth.goalTimes)} fois l'objectif`}
        {rootlets > 0 && ` · ${count(rootlets, 'radicelle')}`}
      </span>
      <span className="profile-root__bar"><span style={{ width: `${Math.round(growth.progress * 100)}%` }} /></span>
      <span className="profile-root__muted">{flowerText(growth, goalMin)}</span>
      <span className="profile-root__muted">
        {growth.held
          ? 'Objectif tenu : la racine gagne une étape dimanche soir.'
          : growth.level <= 0
            ? `Sans ${missing} de plus d'ici dimanche soir, elle reste à sa graine.`
            : `Sans ${missing} de plus d'ici dimanche soir, ${lossText(growth)}.`}
      </span>
      {growth.losing && (
        <span className="profile-root__muted">
          {growth.missedInRow >= 2 ? `${count(growth.missedInRow, 'semaine')} manquées d'affilée` : 'Semaine dernière manquée'} : ses
          feuilles sont tombées ; de nouvelles repoussent avec le temps de la semaine.
        </span>
      )}
    </div>
  );
}

/** Place laissée sous le point le plus bas de la racine, en pixels. */
const ROOT_BOTTOM_MARGIN = 8;

/** Pixels de l'appareil au plus pour le canevas, qui couvre toute la page : au-delà, sa densité baisse (jamais sous 1). */
const CANVAS_MAX_PIXELS = 4_000_000;

/** Densité du canevas : celle de l'écran, 2 au plus, abaissée pour tenir dans `CANVAS_MAX_PIXELS`. */
const canvasDensity = (width: number, height: number): number => {
  const screen = Math.min(2, window.devicePixelRatio || 1);
  const area = width * height;
  return area <= 0 ? screen : Math.max(Math.min(1, screen), Math.min(screen, Math.sqrt(CANVAS_MAX_PIXELS / area)));
};

/** Ce qui se dessine hors animation. */
const restFrame = (growth: RootGrowth): RootFrame => ({
  level: growth.level, maxLevel: growth.maxLevel, growthSteps: growth.growthSteps,
  minutes: growth.minutes, wither: 0, progress: growth.progress, bloom: Math.min(BLOOM_MAX, growth.goalTimes),
  fallen: growth.losing ? 1 : 0,
});

/** L'état vu à la dernière visite, sur le dessin du moment ; celui-ci tel quel sans visite retenue. */
const seenFrame = (rest: RootFrame, seen: LastSeen, goalMin: number, period: number): RootFrame => (seen.level === null ? rest : {
  ...rest, level: seen.level, maxLevel: Math.max(seen.level, rest.maxLevel), minutes: seen.minutes,
  progress: Math.min(1, seen.minutes / Math.max(1, goalMin)), bloom: bloomOf(seen.minutes, goalMin),
  // Une semaine close depuis : ses feuilles ne tombent qu'en rejouant le recul.
  fallen: seen.period === period ? rest.fallen : 0,
});

function ProfileRoot({ growth, goalMin, cardSelectors, ready, open, onClose }: {
  growth: RootGrowth;
  goalMin: number;
  /** Cadres de la page, dans l'ordre ; ceux qui manquent sont sautés. */
  cardSelectors: readonly string[];
  /** Bibliothèque lue et fiches calculées : la racine peut rejouer ce qui a changé depuis la dernière visite. */
  ready: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<{ key: string; model: RootModel | null; width: number; height: number; dpr: number } | null>(null);
  /** Dernière racine construite, sur la disposition et la largeur seules : la hauteur de la page ne la change pas. */
  const builtRef = useRef<{ key: string; model: RootModel | null } | null>(null);
  const colorsRef = useRef<RootColors | null>(null);
  /** État vu à la dernière visite, relu une fois à l'ouverture ; `playedRef` : ce qui a changé depuis est rejoué. */
  const [seenAtOpen] = useState(readSeen);
  /** Dès le premier dessin, l'état vu (le nouveau niveau ne se montre qu'en y poussant). */
  const frameRef = useRef<RootFrame>(seenFrame(restFrame(growth), seenAtOpen, goalMin, growth.periodIndex));
  /** Place de la bulle, sous le carré, calée sur son bord droit. */
  const [anchor, setAnchor] = useState({ top: 0, right: 0 });
  const playedRef = useRef(false);
  const { update: remember } = useStoredRecord<LastSeen>(SEEN_NAMESPACE, SEEN_KEY, SEEN_DEFAULT);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const built = modelRef.current;
    if (!canvas || !built) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(built.dpr, 0, 0, built.dpr, 0, 0);
    ctx.clearRect(0, 0, built.width, built.height);
    if (built.model && colorsRef.current) drawRoot(ctx, built.model, frameRef.current, colorsRef.current, ROOT_STYLE);
    // Niveau et étape de la fleur dessinés, lus par le banc (`outils/banc/racine.mjs`).
    canvas.dataset.niveau = frameRef.current.level.toFixed(2);
    canvas.dataset.fleur = frameRef.current.bloom.toFixed(2);
    // Longueur visible de la racine mère, en pixels, lue par le banc : la même quelle que soit la période.
    canvas.dataset.longueur = built.model
      ? String(Math.round(rootVisibility(built.model, frameRef.current.level, frameRef.current.growthSteps, ROOT_STYLE.ramifications)[0] ?? 0))
      : '0';
  }, []);

  /** Mesure la page et ses cadres ; reconstruit la racine quand la disposition change. */
  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    const page = canvas?.parentElement;
    if (!canvas || !page) return;
    const origin = page.getBoundingClientRect();
    const boxOf = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.left - origin.left, y: r.top - origin.top, r: r.right - origin.left, b: r.bottom - origin.top };
    };
    const slotEl = page.querySelector(`.${SLOT_CLASS}`);
    if (!slotEl) return;
    const cards = cardSelectors.map((s) => page.querySelector(s)).filter((el): el is Element => el !== null).map(boxOf);
    const layout: RootLayout = { slot: boxOf(slotEl), cards };
    const width = page.offsetWidth;
    const layoutId = `${layoutKey(layout)}|${width}`;
    if (builtRef.current?.key !== layoutId) builtRef.current = { key: layoutId, model: buildRootModel(layout, ROOT_STYLE) };
    const model = builtRef.current.model;
    // Sa longueur ne suit pas la page : une page plus courte que la page de référence descend jusqu'au bas de la racine.
    const style = getComputedStyle(page);
    const padding = style.boxSizing === 'border-box' ? 0
      : ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, k) => sum + (parseFloat(style[k as 'paddingTop']) || 0), 0);
    if (model) page.style.setProperty('min-height', `${Math.ceil(model.bottom + ROOT_BOTTOM_MARGIN - padding)}px`);
    else page.style.removeProperty('min-height');
    const height = page.offsetHeight;
    const key = `${layoutId}x${height}`;
    const top = Math.round(layout.slot.b + 6);
    const right = Math.round(width - layout.slot.r);
    setAnchor((a) => (a.top === top && a.right === right ? a : { top, right }));
    if (modelRef.current?.key === key) return;
    const dpr = canvasDensity(width, height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    colorsRef.current = readRootColors(canvas);
    modelRef.current = { key, model, width, height, dpr };
    paint();
  }, [cardSelectors, paint]);

  // Thème changé (clair, sombre, économe) : les couleurs `--root-*` relues, la racine redessinée telle quelle.
  const theme = useAppliedTheme();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !colorsRef.current) return;
    colorsRef.current = readRootColors(canvas);
    paint();
  }, [theme, paint]);

  useLayoutEffect(() => {
    const page = canvasRef.current?.parentElement;
    if (!page) return;
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(page);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      page.style.removeProperty('min-height');
    };
  }, [measure]);

  // Avant la lecture complète de la bibliothèque : l'état vu à la dernière visite (sans quoi la racine se montrerait
  // à son nouveau niveau, puis reculerait pour rejouer sa pousse). Une fois lue : l'état du moment, après avoir rejoué
  // une fois ce qui a changé depuis cette visite ; il est alors retenu. L'animation vit avec l'effet : un nouveau rendu
  // (ou le double montage du mode strict) l'annule et la reprend.
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const rest = restFrame(growth);
    const seen = playedRef.current || seenAtOpen.level === null ? null : { ...seenAtOpen, level: seenAtOpen.level };
    if (!ready) {
      frameRef.current = seen === null ? rest : seenFrame(rest, seen, goalMin, growth.periodIndex);
      paint();
      return;
    }
    remember({ rules: SEEN_RULES, level: growth.level, period: growth.periodIndex, minutes: growth.minutes });
    const newPeriod = seen !== null && seen.period !== growth.periodIndex;
    if (seen === null || reduced || (!newPeriod && seen.minutes >= growth.minutes)) {
      playedRef.current = true;
      frameRef.current = rest;
      paint();
      return;
    }
    const from = seen.level;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = now - t0;
      let done: boolean;
      if (newPeriod) {
        // Les radicelles de la période close flétrissent, la racine avance ou recule, puis celles d'aujourd'hui poussent.
        const fresh = ease((t - 2400) / 800);
        frameRef.current = {
          ...rest,
          level: from + (growth.level - from) * ease((t - 700) / 1700),
          minutes: t < 2400 ? seen.minutes : growth.minutes * fresh,
          wither: t < 2400 ? Math.min(1, t / 1100) : 0,
          progress: t < 2400 ? 0 : growth.progress * fresh,
          bloom: t < 2400 ? 0 : rest.bloom * fresh,
          // La fleur de la semaine passée se fane avec les radicelles ; si elle est manquée, les feuilles tombent avec le recul.
          fallen: rest.fallen * ease((t - 700) / 1700),
        };
        done = t >= 3200;
      } else {
        const minutes = seen.minutes + (growth.minutes - seen.minutes) * ease(t / 900);
        frameRef.current = { ...rest, minutes, progress: Math.min(1, minutes / Math.max(1, goalMin)), bloom: bloomOf(minutes, goalMin) };
        done = t >= 900;
      }
      if (done) {
        playedRef.current = true;
        frameRef.current = rest;
      } else {
        raf = requestAnimationFrame(step);
      }
      paint();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ready, growth, goalMin, seenAtOpen, remember, paint, reduced]);

  return (
    <>
      <canvas ref={canvasRef} className="profile-root" aria-hidden="true" />
      {open && <RootBubble growth={growth} goalMin={goalMin} top={anchor.top} right={anchor.right} onClose={onClose} />}
    </>
  );
}

export default ProfileRoot;
