import { useNavigate } from 'react-router-dom';
import { followedTraceFromRoute } from '../recording/followedTrace';
import { followTrace } from './useFollowedTrace';
import { useRecorder } from './useRecorder';
import type { SavedRoute } from './useRouteLibrary';

/**
 * « Partir » sur un itinéraire rangé : il devient la trace suivie, et la page
 * Enregistrer s'ouvre, son activité proposée ; il reste à toucher
 * « Démarrer ». Impossible pendant un enregistrement ou une session en
 * attente, où la trace suivie ne se change pas : `go` rend alors faux, comme
 * pour un itinéraire qui n'a pas assez de points pour être suivi.
 */
export const useGoOnRoute = () => {
  const navigate = useNavigate();
  const idle = useRecorder().status === 'idle';
  const go = (saved: SavedRoute): boolean => {
    const trace = followedTraceFromRoute(saved.record);
    if (!trace || !idle) return false;
    followTrace(trace);
    navigate('/enregistrer');
    return true;
  };
  return { go, canGo: idle };
};
