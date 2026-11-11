# 208 · Bateau sans foil : « Temps en mouvement » à la place de « Temps en vol »

## Tel que noté

08/11/2026 23:10, Tom : « TRACKER quand on est en mode bateau sans foil il faut pas temps en vol mais temps en mouvement a la place » puis « * dans analyse, général ».

## Où

Analyse voile › onglet « général » (`pages/SailingModule.tsx`, `activeTimeWord`, ligne 331) ; la même formulation est dans l'image de partage d'une fiche (`library/shareStats.ts`, `summaryBaseStats`, ligne 142).

## Aujourd'hui (lu dans le code le 09/11, pas vérifié à l'écran)

- Le libellé suit le foil : « Temps en vol » si `foil`, « Temps actif » sinon. `foil = edits.foil ?? activityFoil` : celui de la session, sinon celui de l'activité. L'activité de départ « Voile » (wingfoil) a le foil coché d'office.
- Le bateau n'a pas de seuil d'activité (`withoutActiveThreshold`, DECISIONS §1 « bateau sans seuil d'activité ») : `hasActiveThreshold` est faux, donc « général » n'affiche ni « Temps actif » ni « Temps en vol » ni ratio. Ce qui est vu à l'écran n'est donc pas expliqué par le code lu.
- Hors voile (course, vélo), le même chiffre s'appelle « Temps en mouvement ».

## Voulu

Pour un bateau sans foil, « général » dit « Temps en mouvement » (le temps où le bateau avance, arrêts complets ôtés, `inMotionS`) et jamais « Temps en vol ».

## Pourquoi

Un bateau ne vole pas : le mot « vol » est faux pour lui.

## Cause trouvée le 11/11 (session « Régate j24 » lue sur le téléphone)

- La fiche de la régate dit `sport: wingfoil`, `activityId: wingfoil`, `analysis.foil: true`, seuil d'activité 1 nœud. Dans les réglages du téléphone, l'activité d'identifiant `wingfoil` s'appelle « Bateau » : c'est l'activité de départ « Voile » renommée par l'utilisateur (il a créé « Wingfoil » à part). Le nom seul a changé, le calcul est resté wingfoil avec foil : la régate est analysée comme une wing, d'où « Temps en vol ». Le code fait ce qu'il dit ; il n'y a pas de bogue de libellé.
- Le calcul d'une activité ne se change pas après sa création (Réglages n'offre le choix qu'à la création).
- Copie de la session, hors dépôt : `D:\memoire Tracker\essais\208-regatej24\`.

## À faire (tranché par l'orchestrateur le 11/11)

1. Calcul bateau : « général » gagne une ligne « Temps en mouvement » (`inMotionS`, même mise en forme que le temps des autres supports), dans l'analyse (`pages/SailingModule.tsx`) et dans la liste de l'image de partage et des fiches (`library/shareStats.ts`, `components/SavedSessionShare.tsx`), sans ratio ni seuil. Le bateau ne dit jamais « Temps en vol » ni « Temps actif ». Lire DECISIONS §1 (liste de « général ») avant.
2. La vraie activité « Bateau » arrive par le 205 ; l'utilisateur y passera sa régate par l'onglet réglages de l'analyse.
3. Test : un résumé de bateau porte « Temps en mouvement » ; un wingfoil avec foil garde « Temps en vol », sans foil « Temps actif ».

## Questions d'origine (répondues ci-dessus)

- Demander à l'utilisateur la session de bateau de son téléphone (GPX, ou la dire dans la bibliothèque) : voir ce qu'il voit, savoir si le foil de la session est coché, quelle activité l'a enregistrée (« Voile » passée en bateau ?).
- Décider : « Temps en mouvement » s'ajoute-t-il au bateau, qui n'a pas de ligne de temps aujourd'hui, ou remplace-t-il le libellé là où il apparaît ? Défaut : l'ajouter à « général » du bateau, sans foil, avec le temps en mouvement de la session.
