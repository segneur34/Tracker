/**
 * Licences des composants livrés avec l'application (Réglages › À propos).
 *
 * Deux listes, chargées au dépliage : celle du JS regroupé, écrite par Vite à la construction (`licences.json`), et son
 * complément versionné, ce qui n'est pas du JS (polices, code Android, `outils/licences-hors-js.mjs`).
 *
 * La liste blanche se vérifie sur `package-lock.json` (`licenses.test.ts`) : une dépendance de production hors liste
 * fait échouer les tests, avant de partir dans une APK.
 */

/** Une ligne de la liste. Les trois derniers champs ne viennent que du complément. */
export interface LicenseEntry {
  name: string;
  version: string;
  /** Licence telle que déclarée (SPDX, le plus souvent) ; vide si le paquet n'en déclare pas. */
  identifier: string;
  /** Texte complet de la licence et sa notice ; vide si le paquet n'en fournit pas. */
  text: string;
  /** Mention en plus du texte (« Utilisé sans modification. »). */
  notice?: string;
  /** Adresse des sources ou des conditions. */
  url?: string;
  /** Famille native : ses composants, `groupe:nom:version`. */
  components?: string[];
}

export type LicenseGroup = 'permissive' | 'other';

const PERMISSIVE_LICENSES: ReadonlySet<string> = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD']);
/** Licences admises pour une dépendance de production. */
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([...PERMISSIVE_LICENSES, 'MPL-2.0', 'OFL-1.1', 'Apache-2.0']);
/**
 * Dépendances de production hors liste blanche, connues et nommées : aucune depuis le lot 189, où les composants
 * de carte sous Hippocratic 2.1 ont laissé place à `components/map/`. Une exception devenue inutile fait échouer le
 * test des licences.
 */
export const LICENSE_EXCEPTIONS: readonly string[] = [];

/**
 * Termes d'une expression de licence (`MIT AND ISC AND BSD-3-Clause`). `OR` est découpé comme `AND` : tous les termes
 * doivent être admis, plus strict qu'il ne faudrait, mais une alternative hors liste mérite d'être relue par quelqu'un.
 */
export const licenseTerms = (expression: string): string[] =>
  expression.split(/\s+(?:AND|OR)\s+|[()]/).map((term) => term.trim()).filter(Boolean);

/** Groupe d'affichage : « MIT, ISC, BSD » si tous ses termes le sont, sinon « Autres licences ». */
export const licenseGroup = (identifier: string): LicenseGroup => {
  const terms = licenseTerms(identifier);
  return terms.length > 0 && terms.every((term) => PERMISSIVE_LICENSES.has(term)) ? 'permissive' : 'other';
};

/** Paquet tel que le décrit `package-lock.json`. */
export interface LockedPackage {
  name: string;
  version: string;
  license?: string;
}

interface LockFile {
  packages: Record<string, { version?: string; license?: string; dev?: boolean; devOptional?: boolean }>;
}

/** Paquets de production d'un `package-lock.json` : ni `dev` ni `devOptional`, sans la racine du projet. */
export const productionPackages = (lock: LockFile): LockedPackage[] =>
  Object.entries(lock.packages)
    .filter(([path, entry]) => path !== '' && !entry.dev && !entry.devOptional)
    .map(([path, entry]) => ({ name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length), version: entry.version ?? '', license: entry.license }));

const isAllowed = (license: string | undefined): boolean => {
  const terms = licenseTerms(license ?? '');
  return terms.length > 0 && terms.every((term) => ALLOWED_LICENSES.has(term));
};

/** Paquets dont la licence n'est pas admise, ou absente, les exceptions nommées mises à part. */
export const refusedLicenses = (packages: readonly LockedPackage[], exceptions: readonly string[] = LICENSE_EXCEPTIONS): LockedPackage[] =>
  packages.filter((pkg) => !isAllowed(pkg.license) && !exceptions.includes(pkg.name));

/** Exceptions devenues inutiles : le paquet a disparu, ou sa licence est désormais admise. */
export const uselessExceptions = (packages: readonly LockedPackage[], exceptions: readonly string[] = LICENSE_EXCEPTIONS): string[] =>
  exceptions.filter((name) => {
    const found = packages.filter((pkg) => pkg.name === name);
    return found.length === 0 || found.every((pkg) => isAllowed(pkg.license));
  });

const optionalString = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const toEntry = (raw: unknown): LicenseEntry | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, version, identifier, text, notice, url, components } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || name === '' || typeof version !== 'string') return null;
  return {
    name,
    version,
    // Vite omet ces deux champs quand le paquet ne déclare pas de licence ou n'en livre pas le fichier.
    identifier: optionalString(identifier) ?? '',
    text: optionalString(text) ?? '',
    ...(optionalString(notice) ? { notice: notice as string } : {}),
    ...(optionalString(url) ? { url: url as string } : {}),
    ...(Array.isArray(components) ? { components: components.filter((c): c is string => typeof c === 'string') } : {}),
  };
};

/**
 * Corps d'une réponse en liste de licences, `null` s'il n'en est pas une. Sous `npm run dev`, `licences.json` n'existe
 * pas et le serveur répond par `index.html`, code 200 : c'est ce cas que le `null` signale.
 */
export const parseLicenseList = (body: string): LicenseEntry[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.map(toEntry).filter((entry): entry is LicenseEntry => entry !== null);
};

/**
 * Les deux listes en une, triée par nom. Un paquet présent des deux côtés (le greffon GPS a du JS et du code Android)
 * garde la ligne du complément, seule à porter la notice.
 */
export const mergeLicenseLists = (built: readonly LicenseEntry[] | null, extra: readonly LicenseEntry[] | null): LicenseEntry[] => {
  const byName = new Map<string, LicenseEntry>();
  for (const entry of built ?? []) byName.set(entry.name, entry);
  for (const entry of extra ?? []) byName.set(entry.name, entry);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
};
