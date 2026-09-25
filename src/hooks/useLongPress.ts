import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

/**
 * Appui long sur un élément : `onLongPress` part quand le doigt est resté
 * posé `durationMs`, et le clic qui suit le relâcher est annulé. Un appui plus
 * court laisse passer le clic ordinaire (le bouton garde son rôle). Relâcher,
 * sortir de l'élément ou laisser le système reprendre le geste (défilement)
 * abandonne l'appui.
 *
 * @param getDurationMs lue à chaque appui, pour suivre un réglage changé entre-temps.
 * @param enabled faux : aucun appui long, le clic reste ordinaire.
 */
export const useLongPress = (onLongPress: () => void, getDurationMs: () => number, enabled: boolean) => {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  /** Durée de l'appui en cours, `null` au repos : sert à l'animation de l'anneau. */
  const [pressingMs, setPressingMs] = useState<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setPressingMs(null);
  }, []);

  // Quand l'appui long cesse d'avoir un sens (arrêt) ou au démontage, le minuteur tombe.
  useEffect(() => {
    if (!enabled) return undefined;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [enabled]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      fired.current = false;
      const duration = getDurationMs();
      setPressingMs(duration);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        setPressingMs(null);
        navigator.vibrate?.(60);
        onLongPress();
      }, duration);
    },
    [enabled, getDurationMs, onLongPress]
  );

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
      onClick,
      // Par sécurité : Android ouvre sinon son menu contextuel sur un élément tenu.
      onContextMenu: (e: MouseEvent) => { if (enabled) e.preventDefault(); },
    },
  };
};
