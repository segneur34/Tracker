/**
 * Profil de calcul de l'application pour le serveur BRouter (`brouter.ts`),
 * qui le reçoit en texte et le garde sous un id `custom_…`. Les profils du
 * serveur ne séparent pas assez les types de voie (mesures du 01/10/2026 : le
 * profil `mtb` donne autant de sentiers que de pistes) ; celui-ci suit ceux
 * que l'on coche.
 *
 * Une seule variable, passée dans l'adresse de chaque demande
 * (`profile:calcul=…`, `profileCombination`) : la somme des poids des types
 * cochés (`WAY_TYPE_BIT`), plus `VELO_BIT` pour les règles du vélo (sens
 * interdits respectés, passages à pied pénalisés comme un vélo poussé, voies
 * difficiles évitées) au lieu de celles du piéton. Le profil la décode en
 * `suitsentier`… et `velo`.
 *
 * Pourquoi une seule : le serveur garde ses profils compilés sous une somme
 * des empreintes (`hashCode`) des valeurs passées. Avec une variable à 0 ou 1
 * par type, seul compte le nombre de types cochés : « Route » seule et
 * « Grande route » seule se confondaient, et le serveur rendait le tracé de
 * l'une pour l'autre (mesure du 04/10/2026). Une valeur par combinaison n'a
 * pas ce défaut.
 *
 * Chaque voie est rangée selon ce qu'elle est, pas selon sa seule étiquette
 * `highway` (`WAY_TYPE_HIGHWAYS`, revêtement) ; un type coché coûte 1 par
 * mètre, un type non coché plus (`WAY_COSTS`), et chaque entrée sur un type
 * non coché coûte en plus une longueur fixe. Règles et coûts tirés d'une
 * étude d'environ 250 000 trajets sur 78 parcours de l'Hérault (05/10/2026,
 * §10, point 80) : l'évitement fort d'avant (10 à 30 fois la longueur) faisait
 * de longs détours, et cocher plusieurs types revenait à prendre le plus
 * court.
 *
 * Accès, sens interdits et nœuds repris du profil `trekking` du serveur. Le
 * dénivelé ne compte pas, comme dans `hiking-mountain`. Texte en ASCII : le
 * serveur ne précise pas l'encodage qu'il lit.
 *
 * `processUnusedTags true` : la réponse donne toutes les étiquettes connues du
 * serveur pour chaque voie, pas seulement celles que le profil lit ; on en
 * tire le revêtement (`surface`, `tracktype`, `sac_scale`, `surface.ts`).
 */

/**
 * Types de voie que l'on coche (Sentier, Piste, Route, Grande route), dans
 * l'ordre où un mode de tronçon les écrit (`WaysMode`, `route.ts`) et où la
 * page les montre. Ce module n'importe rien : `route.ts` et `surface.ts` le
 * lisent sans boucle.
 */
export const WAY_TYPES = ['sentier', 'piste', 'route', 'grandeRoute'] as const;
export type WayType = (typeof WAY_TYPES)[number];

/**
 * Valeurs OSM `highway` d'où part chaque type, avant le reclassement selon le
 * revêtement (`buildBrouterProfile`) : une route déclarée non revêtue devient
 * une piste ; une piste revêtue, une route ; un sentier revêtu, un trottoir
 * ou une voie cyclable sans revêtement déclaré, une route ; un sentier
 * compacté, une piste. Toute voie absente d'ici et de `PEDESTRIAN_HIGHWAY`
 * est interdite.
 */
export const WAY_TYPE_HIGHWAYS: Record<WayType, string[]> = {
  sentier: ['path', 'footway', 'bridleway', 'steps'],
  piste: ['track'],
  route: ['residential', 'unclassified', 'tertiary', 'tertiary_link', 'living_street', 'service', 'road', 'cycleway'],
  grandeRoute: ['secondary', 'secondary_link', 'primary', 'primary_link', 'trunk', 'trunk_link'],
};

/**
 * Rue piétonne : une route, sauf déclarée non revêtue. À part des routes, car
 * le revêtement des routes sans précision est supposé asphalté (`surface.ts`),
 * pas le sien.
 */
export const PEDESTRIAN_HIGHWAY = 'pedestrian';

/** Revêtements qui font d'une piste ou d'un sentier une route ; sans `surface`, `tracktype=grade1`. */
export const PAVED_SURFACES = ['asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'cobblestone', 'grass_paver'];
/** Revêtements qui font d'une route une piste ; sans `surface`, `tracktype` de grade2 à grade5. */
export const UNPAVED_SURFACES = [
  'gravel', 'compacted', 'fine_gravel', 'unpaved', 'ground', 'dirt', 'earth', 'grass', 'sand', 'pebblestone', 'mud', 'clay', 'rock', 'stone',
];
/** Revêtements qui font d'un sentier une piste. */
export const ROLLING_PATH_SURFACES = ['compacted', 'fine_gravel'];

/**
 * Variable du profil, décodée de `calcul`, qui dit si un type est coché.
 * Jamais une clé OSM : le profil lit déjà `route=ferry`, et une variable
 * `route` s'y confondrait.
 */
export const WAY_TYPE_VARIABLE: Record<WayType, string> = {
  sentier: 'suitsentier',
  piste: 'suitpiste',
  route: 'suitroute',
  grandeRoute: 'suitgrande',
};

/** Poids de chaque type dans `calcul` : des puissances de deux, pour que chaque combinaison ait sa valeur. */
export const WAY_TYPE_BIT: Record<WayType, number> = { sentier: 1, piste: 2, route: 4, grandeRoute: 8 };
/** Poids des règles du vélo dans `calcul`, au-dessus de tous les types réunis. */
export const VELO_BIT = 16;

/**
 * Rang de difficulté à vélo, du plus facile au plus dur. Un type non coché
 * plus facile que le plus dur des types cochés reste permis ; un plus dur est
 * évité d'autant plus que l'écart est grand. À pied, pas d'échelle.
 */
export const WAY_TYPE_LEVEL: Record<WayType, number> = { sentier: 2, piste: 1, route: 0, grandeRoute: 0 };

/** Valeur de `calcul` pour ces types cochés et ces règles d'accès. */
export const profileCombination = (ways: ReadonlyArray<WayType>, velo: boolean): number =>
  WAY_TYPES.reduce((sum, t) => sum + (ways.includes(t) ? WAY_TYPE_BIT[t] : 0), velo ? VELO_BIT : 0);

/**
 * Décodage de `calcul` dans le profil, qui n'a ni modulo ni opération sur
 * les bits : du poids le plus fort au plus faible, chaque variable vaut 1 si
 * le reste dépasse son poids moins un, et le reste perd ce poids.
 */
const decodeCombination = (): string => {
  const bits = [
    { name: 'velo', bit: VELO_BIT },
    ...[...WAY_TYPES].sort((a, b) => WAY_TYPE_BIT[b] - WAY_TYPE_BIT[a]).map((t) => ({ name: WAY_TYPE_VARIABLE[t], bit: WAY_TYPE_BIT[t] })),
  ];
  const lines: string[] = [];
  let rest = 'calcul';
  bits.forEach(({ name, bit }, i) => {
    lines.push(`assign ${name} = greater ${rest} ${bit - 1}`);
    if (i < bits.length - 1) {
      lines.push(`assign reste${i + 1} = sub ${rest} multiply ${bit} ${name}`);
      rest = `reste${i + 1}`;
    }
  });
  return lines.join('\n');
};

export interface WayCosts {
  /** À vélo, type non coché plus facile que le plus dur des cochés, ou de même rang. */
  bikeEasier: number;
  /** À vélo, type non coché plus dur, pour un écart de rang de 1, de 2… (le dernier vaut au-delà). */
  bikeHarder: number[];
  /** À pied, tout type non coché. */
  foot: number;
  /** Grande route non cochée, à pied comme à vélo. */
  mainRoad: number;
  /** À vélo, voie difficile (`UNRIDEABLE_TAGS`), même de type coché. */
  unrideable: number;
  /** Longueur ajoutée, en mètres, à chaque entrée sur un type non coché. */
  entryM: number;
}

/**
 * Coût par mètre des voies, pour 1 à un type coché : le calcul accepte un
 * détour de cette fois leur longueur pour les éviter. Choisis le 05/10/2026
 * sur l'étude (§10, point 80). Le plus facile à 3 : le gravel cherche la
 * piste sans fuir la route qui la rejoint (2 la suivait moins, 4 allongeait
 * plus souvent un trajet quand on coche un type de plus). La grande route à 8
 * à part : un coût de plus facile envoyait le VTT sur la route des gorges.
 * L'entrée à 200 m retire les petits raccourcis par un type non coché.
 */
export const WAY_COSTS: WayCosts = { bikeEasier: 3, bikeHarder: [10, 30], foot: 3, mainRoad: 8, unrideable: 60, entryM: 200 };

/**
 * Voies difficiles à vélo, évitées plus que tout type non coché, même quand
 * leur type est coché : difficulté VTT (`mtb:scale`) de 3 ou plus ; à défaut,
 * randonnée de montagne exigeante ou alpine (`sac_scale` T3 ou plus : le T2,
 * un simple sentier de montagne, se roule souvent) ; état de la voie
 * (`smoothness`) ; et les escaliers. Valeurs du `lookups.dat` du serveur.
 */
export const UNRIDEABLE_TAGS = {
  mtbScale: ['3', '4', '5', '6'],
  sacScale: ['demanding_mountain_hiking', 'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'],
  smoothness: ['horrible', 'very_horrible', 'impassable'],
} as const;

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

/** Texte du profil, à envoyer au serveur ; `costs` se change pour la mesure. */
export const buildBrouterProfile = (costs: WayCosts = WAY_COSTS): string => {
  const p = PROFILE_PENALTY;
  const u = UNRIDEABLE_TAGS;
  const highways = (t: WayType) => WAY_TYPE_HIGHWAYS[t].join('|');
  /** Numéro de chaque type dans la variable `categorie`, de 1 à 4 dans l'ordre de `WAY_TYPES` ; 0 : voie interdite. */
  const cat = (t: WayType) => WAY_TYPES.indexOf(t) + 1;
  const followed = WAY_TYPES.map((t, i) =>
    i < WAY_TYPES.length - 1 ? `${i === 0 ? 'if' : 'else if'} equal categorie ${cat(t)} then ${WAY_TYPE_VARIABLE[t]}` : `else ${WAY_TYPE_VARIABLE[t]}`
  ).join('\n       ');
  const hardTypes = WAY_TYPES.filter((t) => WAY_TYPE_LEVEL[t] > 0).sort((a, b) => WAY_TYPE_LEVEL[b] - WAY_TYPE_LEVEL[a]);
  const maxLevel = hardTypes.map((t) => `if ${WAY_TYPE_VARIABLE[t]} then ${WAY_TYPE_LEVEL[t]} else `).join('') + '0';
  const level = hardTypes.map((t) => `if equal categorie ${cat(t)} then ${WAY_TYPE_LEVEL[t]} else `).join('') + '0';
  const harder = costs.bikeHarder.map((c, i) =>
    i < costs.bikeHarder.length - 1 ? `else if equal ecart ${i + 1} then ${c}` : `else ${c}`
  ).join('\n       ');
  return `# Profil Tracker : types de voie suivis et regles d'acces, dans une seule variable (calcul).

---context:global

assign calcul = ${WAY_TYPE_BIT.sentier} # %calcul% | types suivis (sentier ${WAY_TYPE_BIT.sentier}, piste ${WAY_TYPE_BIT.piste}, route ${WAY_TYPE_BIT.route}, grande route ${WAY_TYPE_BIT.grandeRoute}), plus ${VELO_BIT} pour le velo | number

${decodeCombination()}

assign niveaumax = ${maxLevel}

assign validForBikes = velo
assign validForFoot = not velo

assign downhillcost 0
assign downhillcutoff 1.5
assign uphillcost 0
assign uphillcutoff 1.5

assign turnInstructionMode 0
assign processUnusedTags true

---context:way

assign revetu = if surface= then tracktype=grade1 else surface=${PAVED_SURFACES.join('|')}
assign nonrevetu = if surface= then tracktype=grade2|grade3|grade4|grade5 else surface=${UNPAVED_SURFACES.join('|')}

assign categorie =
       if highway=${highways('grandeRoute')} then ${cat('grandeRoute')}
       else if highway=${highways('route')}|${PEDESTRIAN_HIGHWAY} then ( if nonrevetu then ${cat('piste')} else ${cat('route')} )
       else if highway=${highways('piste')} then ( if revetu then ${cat('route')} else ${cat('piste')} )
       else if highway=${highways('sentier')} then
         ( if footway=sidewalk|crossing then ${cat('route')}
           else if ( and not highway=steps revetu ) then ${cat('route')}
           else if surface=${ROLLING_PATH_SURFACES.join('|')} then ${cat('piste')}
           else if ( and surface= bicycle=designated ) then ${cat('route')}
           else ${cat('sentier')} )
       else 0

assign aporter =
       if ( not velo ) then false
       else if highway=steps then true
       else if smoothness=${u.smoothness.join('|')} then true
       else if mtb:scale= then sac_scale=${u.sacScale.join('|')}
       else mtb:scale=${u.mtbScale.join('|')}

assign suivie =
       ${followed}

assign niveau = ${level}
assign ecart = sub niveau niveaumax

assign preference =
       if aporter then ${costs.unrideable}
       else if suivie then 1
       else if equal categorie ${cat('grandeRoute')} then ${costs.mainRoad}
       else if ( not velo ) then ${costs.foot}
       else if lesser ecart 1 then ${costs.bikeEasier}
       ${harder}

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
       else if ( equal categorie ${cat('grandeRoute')} ) then ${p.wrongWayMainRoad}
       else ${p.wrongWay}

assign stepspenalty = if ( and velo highway=steps ) then ${p.bikeSteps} else 0

assign turncost = if velo then ( if junction=roundabout then 0 else ${p.bikeTurn} ) else 0

assign initialclassifier = if route=ferry then 3 else if suivie then 1 else 2
assign initialcost = if route=ferry then ${p.ferryBoarding} else if suivie then 0 else ${costs.entryM}

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
