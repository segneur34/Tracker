import type { RecordPatch, SessionRecord } from './record';
import { PLACE_VERSION, placeSearchOf, type SessionPlace } from './sessionPlace';

/**
 * Nom d'une session (lot 215) : celui que l'utilisateur a saisi, sinon un nom
 * calculé à la lecture, jamais rangé, « Activité · Lieu » (« Wing · Carnon-Plage »,
 * « Course · Montpellier → Sète »), sinon l'activité seule. Changer l'activité
 * change donc le nom tout seul ; effacer le nom saisi rend le nom calculé.
 */

/** Ce qui sépare l'activité du lieu dans le nom calculé. */
export const NAME_SEPARATOR = ' · ';

/** Ce qui sépare le départ de l'arrivée dans un lieu. */
export const PLACE_ARROW = ' → ';

/** Lieu tel qu'il s'écrit (« Montpellier → Sète »), `null` sans lieu ou s'il n'a rien donné. */
export const placeLabel = (place: SessionPlace | null | undefined): string | null => {
  if (!place?.name) return null;
  return place.to ? `${place.name}${PLACE_ARROW}${place.to}` : place.name;
};

/** Nom calculé : « Activité · Lieu », l'activité seule sans lieu, le lieu seul sans activité ; `null` sans l'un ni l'autre. */
export const computedSessionName = (place: SessionPlace | null | undefined, activityName: string | null): string | null => {
  const label = placeLabel(place);
  if (activityName && label) return `${activityName}${NAME_SEPARATOR}${label}`;
  return activityName ?? label;
};

/** Nom montré d'une session : le nom saisi, sinon le nom calculé (`computedSessionName`). */
export const sessionDisplayName = (record: Pick<SessionRecord, 'name' | 'place'>, activityName: string | null): string | null =>
  record.name ?? computedSessionName(record.place, activityName);

/**
 * Ce qui nomme le GPX téléchargé et le fichier de l'image (`AAAA-MM-JJ Activité - Lieu`) : le nom saisi,
 * sinon le lieu ; `null` sans l'un ni l'autre (le fichier garde alors son nom).
 */
export const sessionFileLabel = (record: Pick<SessionRecord, 'name' | 'place'>): string | null =>
  record.name ?? placeLabel(record.place);

/**
 * Changement de la fiche demandé par le champ « Renommer », pré-rempli du nom
 * montré. Champ vidé : plus de nom saisi, le nom calculé revient. Texte
 * inchangé : rien. Texte de la forme « <activité> · X » : X devient le lieu de
 * la session (corrigé par l'utilisateur, il vaudra pour les sessions parties du
 * même endroit) et le nom reste calculé ; « X → Y » donne aussi l'arrivée. Tout
 * autre texte est un nom libre. `fetchedAt` : date de la correction, maintenant par défaut.
 */
export const readRenameDraft = (
  draft: string,
  record: Pick<SessionRecord, 'name' | 'place' | 'sport'>,
  activityName: string | null,
  fetchedAt: string = new Date().toISOString()
): RecordPatch => {
  const text = draft.trim();
  if (text === '') return { name: null };
  if (text === sessionDisplayName(record, activityName)) return {};
  const prefix = activityName ? `${activityName}${NAME_SEPARATOR.trimEnd()}` : null;
  const rest = prefix && text.startsWith(prefix) ? text.slice(prefix.length).trim() : '';
  const search = placeSearchOf(record.sport);
  if (rest === '' || search === null) return { name: text };
  if (rest === placeLabel(record.place)) return { name: null };
  const arrow = rest.indexOf(PLACE_ARROW.trim());
  const name = (arrow < 0 ? rest : rest.slice(0, arrow)).trim();
  const to = arrow < 0 ? '' : rest.slice(arrow + PLACE_ARROW.trim().length).trim();
  if (name === '') return { name: text };
  const place: SessionPlace = {
    name,
    ...(to ? { to } : {}),
    kind: search,
    search,
    source: 'user',
    version: PLACE_VERSION,
    fetchedAt,
  };
  return { name: null, place };
};
