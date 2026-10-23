import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { buildRootModel, layoutKey, ROOT_STYLE, ROOTLET_MINUTES, MAX_ROOTLETS, type Box, type RootLayout, type RootModel } from '../core/rootPath';
import { useStoredRecord, readStoredRecord } from '../hooks/useStoredRecord';
import { levelText, type RootGrowth, type RootSettings } from '../library/rootGrowth';
import { drawRoot, readRootColors, type RootColors, type RootFrame } from './drawRoot';
import './ProfileRoot.css';

/**
 * Racine du Profil (maquette validée le 22/10) : elle part du carré à droite
 * du pseudo (`RootSlot`) et pousse autour des cadres de la page, d'une étape
 * par période tenue (`library/rootGrowth.ts`) ; elle recule d'une période
 * manquée, la partie perdue restant dessinée sèche. Le temps de la période en
 * cours fait pousser des radicelles et la pousse au-dessus du sol, dont la
 * fleur s'ouvre quand l'objectif est tenu ; ses feuilles pendent tant que la
 * dernière période close a été manquée et que l'objectif n'est pas tenu.
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
  level: number | null;
  period: number | null;
  minutes: number;
}
const SEEN_NAMESPACE = 'tracker.profil';
const SEEN_KEY = 'racine';
const SEEN_DEFAULT: LastSeen = { level: null, period: null, minutes: 0 };

const SLOT_CLASS = 'profile-root-slot';

const plural = (n: number, word: string): string => `${word}${n >= 2 ? 's' : ''}`;
/** Nombre et mot liés par une espace insécable : jamais séparés en fin de ligne. */
const count = (n: number, word: string): string => `${levelText(n)} ${plural(n, word)}`;
const minutesText = (min: number): string => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};
const ease = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

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

/** Fin de la période en clair, pour la bulle. */
const endOf = (growth: RootGrowth, settings: RootSettings): { at: string; by: string; name: string; past: string } => {
  const days = Math.max(1, Math.round(settings.periodDays));
  if (days === 1) return { at: 'à minuit', by: "d'ici minuit", name: "Aujourd'hui", past: 'hier' };
  if (days === 7) return { at: 'dimanche soir', by: "d'ici dimanche soir", name: 'Cette semaine', past: 'la semaine dernière' };
  const last = new Date(growth.periodEndMs - 1).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return { at: `le ${last} au soir`, by: `d'ici le ${last} au soir`, name: 'Cette période', past: 'à la période passée' };
};

function RootBubble({ growth, settings, top, right, onClose }: {
  growth: RootGrowth;
  settings: RootSettings;
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
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  const growthSteps = Math.max(1, Math.round(settings.growthPeriods));
  const left = growthSteps - growth.level;
  const end = endOf(growth, settings);
  const rootlets = Math.min(MAX_ROOTLETS, Math.floor(growth.minutes / ROOTLET_MINUTES));
  return (
    <div ref={ref} className="profile-root__bubble" role="status" style={{ top, right }}>
      <strong>Racine : {count(growth.level, 'étape')}</strong>
      <span className="profile-root__muted">
        {left <= 0
          ? "Tous les cadres sont entourés : elle s'épaissit et se ramifie."
          : `Encore ${count(left, 'étape')} pour entourer tous les cadres.`}
      </span>
      {growth.maxLevel > growth.level && (
        <span className="profile-root__muted">
          Partie sèche : {count(growth.maxLevel - growth.level, 'étape')} à regagner.
        </span>
      )}
      <span>
        {end.name} : {minutesText(growth.minutes)} sur {minutesText(settings.goalMin)}
        {rootlets > 0 && ` · ${count(rootlets, 'radicelle')}`}
      </span>
      <span className="profile-root__bar"><span style={{ width: `${Math.round(growth.progress * 100)}%` }} /></span>
      <span className="profile-root__muted">
        {growth.held
          ? `Objectif tenu : la racine gagne une étape ${end.at}.`
          : growth.level <= 0
            ? `Sans ${minutesText(settings.goalMin - growth.minutes)} de plus ${end.by}, elle reste à sa graine.`
            : `Sans ${minutesText(settings.goalMin - growth.minutes)} de plus ${end.by}, elle recule de ${count(Math.min(growth.level, growth.lossStep), 'étape')}.`}
      </span>
      {growth.losing && !growth.held && (
        <span className="profile-root__muted">Elle a reculé {end.past} : ses feuilles pendent jusqu'à l'objectif tenu.</span>
      )}
    </div>
  );
}

/** Ce qui se dessine hors animation. */
const restFrame = (growth: RootGrowth, settings: RootSettings): RootFrame => ({
  level: growth.level, maxLevel: growth.maxLevel, growthSteps: Math.max(1, Math.round(settings.growthPeriods)),
  minutes: growth.minutes, wither: 0, progress: growth.progress, buds: growth.held, wilting: growth.losing ? 1 : 0,
});

/** L'état vu à la dernière visite, sur le dessin du moment ; celui-ci tel quel sans visite retenue. */
const seenFrame = (rest: RootFrame, seen: LastSeen, settings: RootSettings): RootFrame => (seen.level === null ? rest : {
  ...rest, level: seen.level, maxLevel: Math.max(seen.level, rest.maxLevel), minutes: seen.minutes,
  progress: Math.min(1, seen.minutes / Math.max(1, settings.goalMin)), buds: false,
});

function ProfileRoot({ growth, settings, cardSelectors, ready, open, onClose }: {
  growth: RootGrowth;
  settings: RootSettings;
  /** Cadres de la page, dans l'ordre ; ceux qui manquent sont sautés. */
  cardSelectors: readonly string[];
  /** Bibliothèque lue et fiches calculées : la racine peut rejouer ce qui a changé depuis la dernière visite. */
  ready: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<{ key: string; model: RootModel | null; width: number; height: number } | null>(null);
  const colorsRef = useRef<RootColors | null>(null);
  /** État vu à la dernière visite, relu une fois à l'ouverture ; `playedRef` : ce qui a changé depuis est rejoué. */
  const [seenAtOpen] = useState(() => readStoredRecord(SEEN_NAMESPACE, SEEN_KEY, SEEN_DEFAULT));
  /** Dès le premier dessin, l'état vu (le nouveau niveau ne se montre qu'en y poussant). */
  const frameRef = useRef<RootFrame>(seenFrame(restFrame(growth, settings), seenAtOpen, settings));
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, built.width, built.height);
    if (built.model && colorsRef.current) drawRoot(ctx, built.model, frameRef.current, colorsRef.current, ROOT_STYLE);
    // Niveau dessiné, lu par le banc (`outils/banc/racine.mjs`).
    canvas.dataset.niveau = frameRef.current.level.toFixed(2);
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
    const height = page.offsetHeight;
    const key = `${layoutKey(layout)}|${width}x${height}`;
    const top = Math.round(layout.slot.b + 6);
    const right = Math.round(width - layout.slot.r);
    setAnchor((a) => (a.top === top && a.right === right ? a : { top, right }));
    if (modelRef.current?.key === key) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    colorsRef.current = readRootColors(canvas);
    modelRef.current = { key, model: buildRootModel(layout, ROOT_STYLE), width, height };
    paint();
  }, [cardSelectors, paint]);

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
    };
  }, [measure]);

  // Avant la lecture complète de la bibliothèque : l'état vu à la dernière visite (sans quoi la racine se montrerait
  // à son nouveau niveau, puis reculerait pour rejouer sa pousse). Une fois lue : l'état du moment, après avoir rejoué
  // une fois ce qui a changé depuis cette visite ; il est alors retenu. L'animation vit avec l'effet : un nouveau rendu
  // (ou le double montage du mode strict) l'annule et la reprend.
  useEffect(() => {
    const rest = restFrame(growth, settings);
    const seen = playedRef.current || seenAtOpen.level === null ? null : { ...seenAtOpen, level: seenAtOpen.level };
    if (!ready) {
      frameRef.current = seen === null ? rest : seenFrame(rest, seen, settings);
      paint();
      return;
    }
    remember({ level: growth.level, period: growth.periodIndex, minutes: growth.minutes });
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
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
          buds: false,
          // La fleur d'hier se ferme ; si la période close est manquée, les feuilles tombent avec le recul.
          wilting: rest.wilting * ease((t - 700) / 1700),
        };
        done = t >= 3200;
      } else {
        const minutes = seen.minutes + (growth.minutes - seen.minutes) * ease(t / 900);
        frameRef.current = { ...rest, minutes, buds: false, progress: Math.min(1, minutes / Math.max(1, settings.goalMin)) };
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
  }, [ready, growth, settings, seenAtOpen, remember, paint]);

  return (
    <>
      <canvas ref={canvasRef} className="profile-root" aria-hidden="true" />
      {open && <RootBubble growth={growth} settings={settings} top={anchor.top} right={anchor.right} onClose={onClose} />}
    </>
  );
}

export default ProfileRoot;
