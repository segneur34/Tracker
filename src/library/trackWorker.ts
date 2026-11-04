import { handleTrackRequest, type TrackRequest, type TrackResponse } from './trackWorkerProtocol';

/**
 * Worker des traces (lot 126 B) : lit et prépare un GPX, ou le résume, hors du fil de l'affichage. Il ne fait que
 * répondre aux demandes (`trackWorkerProtocol.ts`) ; créé par `trackWorkerClient.ts`. Ni React, ni `platform/`, ni
 * DOM dans ce qu'il importe (`trackWorker.architecture.test.ts`).
 */

/** Le peu du contexte d'un worker qui sert ici, sans la bibliothèque WebWorker de TypeScript. */
interface TrackWorkerScope {
  onmessage: ((event: MessageEvent<TrackRequest>) => void) | null;
  postMessage(message: TrackResponse): void;
}

const scope = globalThis as unknown as TrackWorkerScope;

scope.onmessage = (event) => {
  scope.postMessage(handleTrackRequest(event.data));
};
