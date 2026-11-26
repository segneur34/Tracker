/**
 * Les noms provisoires du dossier mémoire du téléphone, tels que son application les écrit et les relit
 * (`MemoryFolderPlugin.java`) :
 * - un fichier neuf est d'abord écrit sous `nom.tracker-new`, puis renommé ; resté seul (création interrompue), il
 *   est caché, puis effacé à la lecture suivante du dossier ;
 * - un fichier remplacé est d'abord écrit sous `nom.tracker-tmp`, à côté de l'original. Si l'original est encore là,
 *   le remplacement a été interrompu avant sa fin : le provisoire, peut-être incomplet, est caché puis effacé. Si
 *   l'original n'y est plus, il avait déjà été retiré : le provisoire, complet, est montré et reprend son nom
 *   (`finishInterruptedReplace`).
 * Les suffixes se comparent en casse exacte, comme sur le téléphone.
 *
 * Le programme Windows, qui écrit dans ce dossier par le câble (élément 217), écrit TOUJOURS sous `nom.tracker-new`,
 * fichier neuf comme remplacement, puis le renomme sur `nom` d'un seul `mv -f` : un provisoire laissé par une coupure
 * n'est jamais repris par le téléphone, qui l'efface, et l'original reste intact jusqu'au renommage. Jamais
 * `.tracker-tmp`, qu'un téléphone pourrait prendre pour un remplacement achevé. La coquille (`bureau/`), qui ne lit pas
 * les sources de l'application, en garde une copie (`commeLeTelephone`, `nomProvisoire` de `bureau/telephone.ts`),
 * comparée à celle-ci par un test.
 */

/** Suffixe du fichier écrit par le téléphone à côté de celui qu'il remplace. */
export const REPLACE_SUFFIX = '.tracker-tmp';

/** Suffixe d'un fichier neuf du téléphone, et de toute écriture du câble, le temps de l'écrire. */
export const NEW_SUFFIX = '.tracker-new';

/** Un nom tel que le téléphone le montre, et le nom que le fichier porte vraiment. */
export interface VisibleName {
  name: string;
  actual: string;
}

const hasSuffix = (name: string, suffix: string): boolean => name.endsWith(suffix) && name.length > suffix.length;

/** Vrai si le nom est celui d'une écriture en cours sur le téléphone. */
export const isRemoteTemp = (name: string): boolean => hasSuffix(name, NEW_SUFFIX) || hasSuffix(name, REPLACE_SUFFIX);

/**
 * Les fichiers d'un dossier du téléphone tels que son application les voit, dans l'ordre des noms reçus : les
 * provisoires cachés, ou montrés sous le nom qu'ils reprennent.
 */
export const phoneVisibleNames = (names: readonly string[]): VisibleName[] => {
  const present = new Set(names);
  const visible: VisibleName[] = [];
  for (const actual of names) {
    if (hasSuffix(actual, NEW_SUFFIX)) continue;
    if (hasSuffix(actual, REPLACE_SUFFIX)) {
      const original = actual.slice(0, -REPLACE_SUFFIX.length);
      if (present.has(original)) continue;
      present.add(original);
      visible.push({ name: original, actual });
      continue;
    }
    visible.push({ name: actual, actual });
  }
  return visible;
};

/** Nom provisoire sous lequel le câble écrit `path`, qu'il existe déjà ou non : toujours `.tracker-new`. */
export const cableTempName = (path: string): string => path + NEW_SUFFIX;
