import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { buzz } from '../platform/beeper';

/** Identifiant de l'appui au clavier, qu'aucun doigt ne porte (les `pointerId` sont positifs). */
const KEYBOARD = -1;

/**
 * Appui long sur un élément : `onLongPress` part quand le doigt est resté
 * posé `durationMs`, et le clic qui suit le relâcher est annulé. Un appui plus
 * court laisse passer le clic ordinaire (le bouton garde son rôle). Relâcher,
 * sortir de l'élément ou laisser le système reprendre le geste (défilement)
 * abandonne l'appui. Seul le premier doigt compte : un second, posé pendant
 * l'appui, est ignoré, et ne peut ni le lancer ni l'abandonner. Au clavier,
 * Entrée ou Espace tenus valent un doigt posé (relâcher la touche ou quitter
 * le bouton abandonne).
 *
 * @param getDurationMs lue à chaque appui, pour suivre un réglage changé entre-temps.
 * @param enabled faux : aucun appui long, le clic reste ordinaire.
 */
export const useLongPress = (onLongPress: () => void, getDurationMs: () => number, enabled: boolean) => {
  const timer = useRef<number | null>(null);
  /** Doigt de l'appui en cours, `null` au repos. */
  const pointer = useRef<number | null>(null);
  const fired = useRef(false);
  /** Durée de l'appui en cours, `null` au repos : sert à l'animation de l'anneau. */
  const [pressingMs, setPressingMs] = useState<number | null>(null);

  /** Fin de l'appui de `id` (un doigt, ou le clavier) ; un autre appui en cours n'est pas touché. */
  const release = useCallback((id: number) => {
    if (pointer.current !== null && id !== pointer.current) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    pointer.current = null;
    setPressingMs(null);
  }, []);
  const cancel = useCallback((e: PointerEvent) => release(e.pointerId), [release]);

  // Quand l'appui long cesse d'avoir un sens (arrêt) ou au démontage, le minuteur tombe, et le cadran avec lui.
  useEffect(() => {
    if (!enabled) return undefined;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      pointer.current = null;
      setPressingMs(null);
    };
  }, [enabled]);

  /** Début d'un appui de `id`, ignoré pendant un autre. */
  const press = useCallback(
    (id: number) => {
      if (!enabled || timer.current !== null) return;
      fired.current = false;
      pointer.current = id;
      const duration = getDurationMs();
      setPressingMs(duration);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        pointer.current = null;
        fired.current = true;
        setPressingMs(null);
        void buzz(60).catch(() => undefined);
        onLongPress();
      }, duration);
    },
    [enabled, getDurationMs, onLongPress]
  );

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      press(e.pointerId);
    },
    [press]
  );

  // Clavier : Entrée active le bouton dès l'appui (un appui court y garde son rôle), Espace au lâcher, annulé par
  // `onClick` si l'appui long a abouti.
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) press(KEYBOARD);
    },
    [press]
  );
  const onKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      release(KEYBOARD);
      // Entrée a déjà cliqué à l'appui : aucun clic ne suit son lâcher, à annuler.
      if (e.key === 'Enter') fired.current = false;
    },
    [release]
  );
  const onBlur = useCallback(() => release(KEYBOARD), [release]);

  const onClick = useCallback((e: MouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    e.preventDefault();
  }, []);

  return {
    pressingMs: enabled ? pressingMs : null,
    handlers: {
      onPointerDown,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onKeyDown,
      onKeyUp,
      onBlur,
      onClick,
      // Par sécurité : Android ouvre sinon son menu contextuel sur un élément tenu.
      onContextMenu: (e: MouseEvent) => { if (enabled) e.preventDefault(); },
    },
  };
};
