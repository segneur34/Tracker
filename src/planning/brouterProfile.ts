import type { ComputedMode } from './route';

/**
 * Profil de calcul de l'application pour le serveur BRouter (`brouter.ts`),
 * qui le reçoit en texte et le garde sous un id `custom_…`. Les profils du
 * serveur ne séparent pas assez les types de voie (mesures du 01/10/2026 : le
 * profil `mtb` donne autant de sentiers que de pistes) ; celui-ci favorise
 * celui que l'on choisit.
 *
 * Deux variables, passées dans l'adresse de chaque demande
 * (`profile:voie=…&profile:velo=…`) :
 * - `voie` : le type de voie choisi, de 1 à 4 (`WAY_PARAM`) ;
 * - `velo` : 1 pour les règles du vélo (sens interdits respectés, passages à
 *   pied pénalisés comme un vélo poussé), 0 pour celles du piéton.
 *
 * Accès, sens interdits et nœuds repris du profil `trekking` du serveur. Le
 * dénivelé ne compte pas, comme dans `hiking-mountain`. Texte en ASCII : le
 * serveur ne précise pas l'encodage qu'il lit.
 *
 * `processUnusedTags true` : la réponse donne toutes les étiquettes connues du
 * serveur pour chaque voie, pas seulement celles que le profil lit ; on en
 * tire le revêtement (`surface`, `tracktype`, `sac_scale`, `surface.ts`).
 */

/** Catégories de voie du profil, numérotées de 1 à 4 dans cet ordre (variable `categorie`). */
export const WAY_CATEGORIES = ['chemin', 'piste', 'route', 'grande'] as const;
export type WayCategory = (typeof WAY_CATEGORIES)[number];

/** Valeurs OSM `highway` de chaque catégorie ; toute autre voie est interdite. */
export const WAY_CATEGORY_HIGHWAYS: Record<WayCategory, string[]> = {
  chemin: ['path', 'footway', 'bridleway', 'steps', 'pedestrian'],
  piste: ['track'],
  route: ['residential', 'unclassified', 'tertiary', 'tertiary_link', 'living_street', 'service', 'road', 'cycleway'],
  grande: ['secondary', 'secondary_link', 'primary', 'primary_link', 'trunk', 'trunk_link'],
};

/** Valeur de la variable `voie` pour chaque mode calculé. */
export const WAY_PARAM: Record<ComputedMode, number> = { chemin: 1, piste: 2, route: 3, grandeRoute: 4 };

/**
 * Coût par mètre de chaque catégorie selon le mode choisi : 1 pour le type
 * voulu, plus pour les autres. Un coût de 2 fait accepter un détour de deux
 * fois la longueur pour rester sur le type voulu.
 *
 * Réglé le 01/10/2026 sur quatre trajets autour de Montpellier (ville,
 * périphérie, garrigue), pour 1,0 à 1,4 fois la longueur du plus court
 * chemin : le type choisi fait le plus souvent de 55 à 98 % du trajet ; il
 * reste minoritaire là où il manque (pistes en ville, grandes routes en
 * garrigue).
 */
export const WAY_PREFERENCE_COST: Record<ComputedMode, Record<WayCategory, number>> = {
  chemin: { chemin: 1, piste: 1.4, route: 2.5, grande: 4 },
  piste: { chemin: 1.8, piste: 1, route: 2, grande: 4 },
  route: { chemin: 4, piste: 3, route: 1, grande: 2 },
  grandeRoute: { chemin: 5, piste: 4, route: 1.3, grande: 1 },
};

/** Pénalités et coûts du profil, repris de `trekking` (coûts par mètre, sauf mention). */
export const PROFILE_PENALTY = {
  /** Coût d'une voie interdite, pour BRouter. */
  forbidden: 10000,
  /** Vélo poussé sur une voie ouverte aux seuls piétons. */
  pushBike: 4,
  /** Vélo porté dans un escalier. */
  bikeSteps: 40,
  /** Vélo à contresens : rond-point, grande route, autre voie. */
  wrongWayRoundabout: 60,
  wrongWayMainRoad: 50,
  wrongWay: 4,
  /** Virage à vélo, en mètres équivalents (aucun à pied). */
  bikeTurn: 90,
  /** Bac : coût par mètre, et coût fixe à l'embarquement. */
  ferry: 5.67,
  ferryBoarding: 10000,
  /** Nœud (barrière) franchi à pied avec le vélo, et nœud fermé. */
  nodePushBike: 100,
  nodeForbidden: 1000000,
} as const;

const ifCategories = (costs: Record<WayCategory, number>): string =>
  `( if equal categorie 1 then ${costs.chemin} else if equal categorie 2 then ${costs.piste}` +
  ` else if equal categorie 3 then ${costs.route} else ${costs.grande} )`;

/** Texte du profil, à envoyer au serveur. */
export const buildBrouterProfile = (costs: Record<ComputedMode, Record<WayCategory, number>> = WAY_PREFERENCE_COST): string => {
  const p = PROFILE_PENALTY;
  const highways = (c: WayCategory) => WAY_CATEGORY_HIGHWAYS[c].join('|');
  return `# Profil Tracker : type de voie choisi (voie) et regles d'acces (velo).

---context:global

assign voie = 1 # %voie% | 1 chemin, 2 piste, 3 route, 4 grande route | number
assign velo = 0 # %velo% | 1 regles du velo, 0 regles du pieton | number

assign validForBikes = velo
assign validForFoot = not velo

assign downhillcost 0
assign downhillcutoff 1.5
assign uphillcost 0
assign uphillcutoff 1.5

assign turnInstructionMode 0
assign processUnusedTags true

---context:way

assign categorie =
       if highway=${highways('chemin')} then 1
       else if highway=${highways('piste')} then 2
       else if highway=${highways('route')} then 3
       else if highway=${highways('grande')} then 4
       else 0

assign preference =
       if ( equal voie ${WAY_PARAM.chemin} ) then ${ifCategories(costs.chemin)}
       else if ( equal voie ${WAY_PARAM.piste} ) then ${ifCategories(costs.piste)}
       else if ( equal voie ${WAY_PARAM.route} ) then ${ifCategories(costs.route)}
       else ${ifCategories(costs.grandeRoute)}

assign defaultaccess =
       if access= then not motorroad=yes
       else if access=private|no then false
       else true

assign bikeaccess =
       if bicycle= then
       (
         if bicycle_road=yes then true
         else if vehicle= then ( if highway=footway|pedestrian|steps then false else defaultaccess )
         else not vehicle=private|no
       )
       else not bicycle=private|no|dismount|use_sidepath

assign footaccess =
       if bicycle=dismount then true
       else if foot= then defaultaccess
       else not foot=private|no|use_sidepath

assign accesspenalty =
       if velo then
         ( if bikeaccess then 0 else if footaccess then ${p.pushBike} else ${p.forbidden} )
       else
         ( if footaccess then 0 else ${p.forbidden} )

assign badoneway =
       if reversedirection=yes then
         ( if oneway:bicycle=yes then true else if oneway= then junction=roundabout else oneway=yes|true|1 )
       else oneway=-1

assign onewaypenalty =
       if ( not velo ) then 0
       else if ( not badoneway ) then 0
       else if ( or oneway:bicycle=no cycleway=opposite|opposite_lane|opposite_track ) then 0
       else if ( junction=roundabout ) then ${p.wrongWayRoundabout}
       else if ( highway=${highways('grande')} ) then ${p.wrongWayMainRoad}
       else ${p.wrongWay}

assign stepspenalty = if ( and velo highway=steps ) then ${p.bikeSteps} else 0

assign turncost = if velo then ( if junction=roundabout then 0 else ${p.bikeTurn} ) else 0

assign initialclassifier = if route=ferry then 2 else 1
assign initialcost = if ( equal initialclassifier 2 ) then ${p.ferryBoarding} else 0

assign costfactor =
       if ( and highway= not route=ferry ) then ${p.forbidden}
       else if ( highway=motorway|motorway_link|proposed|abandoned|construction ) then ${p.forbidden}
       else if ( route=ferry ) then ${p.ferry}
       else if ( equal categorie 0 ) then ${p.forbidden}
       else add max max onewaypenalty accesspenalty stepspenalty preference

---context:node

assign defaultaccess =
       if access= then true
       else if access=private|no then false
       else true

assign bikeaccess =
       if bicycle= then ( if vehicle= then defaultaccess else not vehicle=private|no )
       else not bicycle=private|no|dismount

assign footaccess =
       if bicycle=dismount then true
       else if foot= then defaultaccess
       else not foot=private|no

assign initialcost =
       if velo then ( if bikeaccess then 0 else if footaccess then ${p.nodePushBike} else ${p.nodeForbidden} )
       else ( if footaccess then 0 else ${p.nodeForbidden} )
`;
};

/** Texte envoyé au serveur. */
export const BROUTER_PROFILE_TEXT = buildBrouterProfile();
