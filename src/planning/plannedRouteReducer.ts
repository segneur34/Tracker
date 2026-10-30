import { openLoop, withLoopReturn, type PlannedRoute, type RouteMode } from './route';

/**
 * État de la planification et son réducteur, purs (lot 72) : l'itinéraire,
 * les types de voie cochés et le mode « Boucle », et leur annulation. Le hook
 * `usePlannedRoute` y ajoute les calculs des tronçons.
 */

/** Profondeur de l'annulation. */
const HISTORY_LIMIT = 50;

/** Ce que « Précédent » rend : l'itinéraire, les types de voie cochés et le mode « Boucle ». */
export interface Snapshot {
  route: PlannedRoute;
  mode: RouteMode;
  loop: boolean;
}

export interface PlannedRouteState extends Snapshot {
  /** États d'avant chaque modification de l'utilisateur, le plus récent à la fin. */
  history: Snapshot[];
}

/** Modification de l'utilisateur ; `loop` : le mode « Boucle » est allumé. */
export type Edit = (r: PlannedRoute, loop: boolean) => PlannedRoute;

export type PlannedRouteAction =
  /** Modification de l'utilisateur : l'état d'avant entre dans l'annulation. */
  | { type: 'edit'; change: Edit }
  /**
   * Types de voie cochés, et la modification de l'itinéraire qui en découle :
   * une seule étape de l'annulation ; `loop` : le mode « Boucle » change avec eux.
   */
  | { type: 'mode'; mode: RouteMode; change: (r: PlannedRoute) => PlannedRoute; loop?: boolean }
  /** Bouton « Boucle » : allumé, l'itinéraire se boucle ; éteint, le retour est retiré. */
  | { type: 'loop'; on: boolean }
  /** Résultat d'un calcul, ou nouvel essai : hors annulation. */
  | { type: 'apply'; change: (r: PlannedRoute) => PlannedRoute }
  | { type: 'undo' }
  /**
   * Nouvel itinéraire (ouvert depuis la mémoire), et ses types de voie et son
   * mode « Boucle » s'ils changent : l'annulation repart de zéro, l'itinéraire
   * est pris tel quel.
   */
  | { type: 'replace'; route: PlannedRoute; mode?: RouteMode; loop?: boolean };

/** État suivant, l'état d'avant gardé pour l'annulation. */
const remember = (state: PlannedRouteState, next: Snapshot): PlannedRouteState => ({
  ...next,
  history: [...state.history.slice(-(HISTORY_LIMIT - 1)), { route: state.route, mode: state.mode, loop: state.loop }],
});

/** Itinéraire remis en ordre en mode « Boucle » ; tel quel sinon. */
const settle = (route: PlannedRoute, mode: RouteMode, loop: boolean): PlannedRoute => (loop ? withLoopReturn(route, mode) : route);

/** Réducteur de l'état de la planification. */
export const plannedRouteReducer = (state: PlannedRouteState, action: PlannedRouteAction): PlannedRouteState => {
  switch (action.type) {
    case 'edit': {
      const route = settle(action.change(state.route, state.loop), state.mode, state.loop);
      return route === state.route ? state : remember(state, { route, mode: state.mode, loop: state.loop });
    }
    case 'mode': {
      const loop = action.loop ?? state.loop;
      const route = settle(action.change(state.route), action.mode, loop);
      if (route === state.route && action.mode === state.mode && loop === state.loop) return state;
      // Sur une carte vide, rien à défaire : les cases changent seules.
      return state.route.waypoints.length === 0 ? { ...state, mode: action.mode, loop } : remember(state, { route, mode: action.mode, loop });
    }
    case 'loop': {
      const route = action.on ? withLoopReturn(state.route, state.mode) : openLoop(state.route);
      if (route === state.route && action.on === state.loop) return state;
      return state.route.waypoints.length === 0 ? { ...state, loop: action.on } : remember(state, { route, mode: state.mode, loop: action.on });
    }
    case 'apply': {
      const route = settle(action.change(state.route), state.mode, state.loop);
      return route === state.route ? state : { ...state, route };
    }
    case 'undo':
      return state.history.length === 0 ? state : { ...state.history[state.history.length - 1], history: state.history.slice(0, -1) };
    case 'replace':
      return { route: action.route, mode: action.mode ?? state.mode, loop: action.loop ?? state.loop, history: [] };
  }
};
